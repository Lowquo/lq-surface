#!/usr/bin/env node
// Validates what `npm publish` would ship for each publishable workspace package,
// then installs the packed tarballs into a throwaway consumer project and checks
// that they import in Node and type-check for TypeScript consumers.
//
// Usage: npm run check:pack [-- --contents-only] [-- --keep]
//   --contents-only  only inspect `npm pack --dry-run` output (no install, no network)
//   --keep           keep the temporary consumer project for inspection
//
// No dependencies beyond Node built-ins. Works on Linux, macOS and Windows.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const contentsOnly = args.has('--contents-only');
const keep = args.has('--keep');

// Files allowed in a tarball outside dist/. npm always adds package.json, and
// README/LICENSE from the package directory.
const ROOT_FILES = new Set(['package.json', 'README.md', 'LICENSE']);
const REQUIRED = ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'];
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];
// Browser packages are only required to type-check; every other package must
// also import under plain Node ESM.
const BROWSER_ONLY = new Set(['@lowquo/surface-controls']);
// Any attempt to fetch @lowquo/* from a registry during the smoke test must fail
// instead of silently installing someone else's package. Port 9 is "discard".
const BLACKHOLE_REGISTRY = 'http://127.0.0.1:9/';

let failures = 0;
const fail = (msg) => { failures++; console.error(`  FAIL ${msg}`); };
const ok = (msg) => console.log(`  ok   ${msg}`);
const note = (msg) => console.log(`  note ${msg}`);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const toPosix = (p) => p.split(path.sep).join('/');
const normaliseEol = (s) => s.replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// Spawning npm portably. Under `npm run`, npm_execpath points at npm-cli.js, so we
// run it with the current node binary and never need a shell. Otherwise fall back
// to `npm` (`npm.cmd` through a shell on Windows, since Node refuses to spawn .cmd
// files directly).

function childEnv() {
  // Drop variables injected by the parent `npm run` (local prefix, lifecycle,
  // package fields, log level...) so child npm processes behave as if run fresh.
  const keepNpm = /^npm_config_(cache|userconfig|globalconfig|registry|proxy|https_proxy|noproxy|strict_ssl|cafile|ca)$/i;
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^npm_/i.test(key) && !keepNpm.test(key)) continue;
    if (/^INIT_CWD$/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}

function quoteForCmd(arg) {
  return /^[\w@+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;
}

function run(command, commandArgs, { cwd, timeout = 300_000 } = {}) {
  const options = { cwd, env: childEnv(), timeout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  let result;
  const execPath = process.env.npm_execpath;
  if (command === 'npm' && execPath && /npm-cli\.c?js$/.test(execPath) && existsSync(execPath)) {
    result = spawnSync(process.execPath, [execPath, ...commandArgs], options);
  } else if (command === 'npm' && process.platform === 'win32') {
    // One pre-quoted command line: passing an args array with `shell: true` is deprecated (DEP0190).
    result = spawnSync(['npm.cmd', ...commandArgs.map(quoteForCmd)].join(' '), { ...options, shell: true });
  } else {
    result = spawnSync(command, commandArgs, options);
  }
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function parseJsonOutput(stdout) {
  try { return JSON.parse(stdout); } catch { /* lifecycle output before the JSON */ }
  const start = stdout.indexOf('\n[');
  if (start >= 0) return JSON.parse(stdout.slice(start + 1));
  throw new Error(`could not parse npm JSON output:\n${stdout}`);
}

// ---------------------------------------------------------------------------
// Minimal semver range check for internal workspace dependency ranges.

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim());
  return m ? m.slice(1, 4).map(Number) : null;
}
function cmp(a, b) { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }
function satisfies(version, range) {
  const v = parseVersion(version);
  const r = range.trim();
  if (!v) return undefined;
  if (r === '*' || r === '') return true;
  if (r.startsWith('workspace:') || r.startsWith('file:')) return undefined;
  const op = /^(\^|~|>=|=)?\s*(\d+\.\d+\.\d+)$/.exec(r);
  if (!op) return undefined;
  const base = parseVersion(op[2]);
  if (cmp(v, base) < 0) return false;
  switch (op[1]) {
    case '>=': return true;
    case undefined: case '=': return cmp(v, base) === 0;
    case '~': return v[0] === base[0] && v[1] === base[1];
    case '^':
      if (base[0] > 0) return v[0] === base[0];
      if (base[1] > 0) return v[0] === 0 && v[1] === base[1];
      return v[0] === 0 && v[1] === 0 && v[2] === base[2];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Package discovery and static checks.

// Root `workspaces` entries, supporting the plain "dir" and "dir/*" forms used here.
function workspacePackages() {
  const dirs = [];
  for (const pattern of readJson(path.join(root, 'package.json')).workspaces ?? []) {
    if (pattern.endsWith('/*')) {
      const parent = path.join(root, ...pattern.slice(0, -2).split('/'));
      if (existsSync(parent)) {
        for (const d of readdirSync(parent, { withFileTypes: true })) if (d.isDirectory()) dirs.push(path.join(parent, d.name));
      }
    } else if (!pattern.includes('*')) dirs.push(path.join(root, ...pattern.split('/')));
    else throw new Error(`unsupported workspaces pattern "${pattern}"`);
  }
  return dirs
    .filter((dir) => existsSync(path.join(dir, 'package.json')))
    .map((dir) => ({ dir, rel: toPosix(path.relative(root, dir)), manifest: readJson(path.join(dir, 'package.json')) }));
}

// Workspace links must never fall back to the registry: the @lowquo scope is not
// yet registered on npm, so a registry copy would be someone else's package.
function checkWorkspaceLinks(workspaces, packages) {
  console.log('\nWorkspace links');
  const failuresBefore = failures;
  const lockPath = path.join(root, 'package-lock.json');
  if (!existsSync(lockPath)) { fail('package-lock.json is missing'); return; }
  const scopes = [...new Set(packages.map((p) => p.manifest.name.split('/')[0]).filter((s) => s.startsWith('@')))];
  const internal = (name) => packages.some((p) => p.manifest.name === name) || scopes.some((s) => name.startsWith(`${s}/`));
  for (const [key, entry] of Object.entries(readJson(lockPath).packages ?? {})) {
    const name = /node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key)?.[1];
    if (name && internal(name) && !entry.link) fail(`package-lock.json resolves ${key} from ${entry.resolved ?? 'a registry'} instead of the workspace`);
  }
  const versions = new Map(packages.map((p) => [p.manifest.name, p.manifest.version]));
  for (const ws of workspaces) {
    const { manifest } = ws;
    for (const [name, range] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies })) {
      if (!versions.has(name)) continue;
      const verdict = satisfies(versions.get(name), range);
      if (verdict === false) fail(`${ws.rel} depends on ${name}@${range} but the workspace has ${versions.get(name)}`);
      else if (verdict === undefined) note(`${ws.rel}: cannot evaluate range ${name}@${range}; check it by hand`);
    }
  }
  if (failures === failuresBefore) ok(`every ${scopes.join(', ')} entry in package-lock.json is a workspace link; internal ranges match`);
}

// Every path a consumer's resolver may load: exports targets plus legacy fields.
function entryTargets(manifest) {
  const targets = new Set();
  const walk = (node) => {
    if (typeof node === 'string') { if (node.startsWith('./')) targets.add(node.slice(2)); }
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(manifest.exports);
  for (const field of ['main', 'module', 'types', 'typings']) {
    if (typeof manifest[field] === 'string') targets.add(manifest[field].replace(/^\.\//, ''));
  }
  if (typeof manifest.bin === 'string') targets.add(manifest.bin.replace(/^\.\//, ''));
  else if (manifest.bin) Object.values(manifest.bin).forEach((b) => targets.add(b.replace(/^\.\//, '')));
  return [...targets];
}

function typesConditionOrder(exportsField, where = 'exports') {
  const problems = [];
  if (exportsField && typeof exportsField === 'object' && !Array.isArray(exportsField)) {
    const keys = Object.keys(exportsField);
    if (keys.includes('types') && keys[0] !== 'types') problems.push(`${where}: "types" must be the first condition`);
    for (const key of keys) problems.push(...typesConditionOrder(exportsField[key], `${where}["${key}"]`));
  }
  return problems;
}

function packageNameOf(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:') || specifier.startsWith('#')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function importedPackages(source) {
  const found = new Set();
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\/\/\/\s*<reference\s+types\s*=\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) {
    const name = packageNameOf(m[1]);
    if (name) found.add(name);
  }
  return found;
}

function installedManifest(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (existsSync(file)) return readJson(file);
    if (dir === root || path.dirname(dir) === dir) return null;
  }
}

function shipsOwnTypes(manifest) {
  if (!manifest) return false;
  if (manifest.types || manifest.typings) return true;
  return JSON.stringify(manifest.exports ?? {}).includes('"types"');
}

function typesPackageFor(name) {
  return `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`;
}

function checkContents(pkg) {
  const { manifest } = pkg;
  const failuresBefore = failures;
  console.log(`\n${manifest.name}@${manifest.version} (${pkg.rel})`);

  // Manifest hygiene for publishing.
  if (manifest.license !== 'MIT') fail(`license is ${JSON.stringify(manifest.license)}, expected "MIT"`);
  if (manifest.type !== 'module') fail('"type": "module" is required: dist/*.js is ESM');
  if (manifest.name.startsWith('@') && manifest.publishConfig?.access !== 'public') {
    fail('scoped package needs "publishConfig": { "access": "public" } (scoped packages default to restricted)');
  }
  if (manifest.repository?.directory !== pkg.rel) fail(`repository.directory should be "${pkg.rel}"`);
  for (const field of ['description', 'homepage', 'bugs', 'author']) if (!manifest[field]) fail(`missing "${field}"`);
  for (const script of INSTALL_SCRIPTS) if (manifest.scripts?.[script]) fail(`library must not declare an "${script}" script`);
  for (const problem of typesConditionOrder(manifest.exports)) fail(problem);

  // Packaged LICENSE must match the repository licence.
  const licence = path.join(pkg.dir, 'LICENSE');
  if (existsSync(licence) && existsSync(path.join(root, 'LICENSE'))) {
    if (normaliseEol(readFileSync(licence, 'utf8')) !== normaliseEol(readFileSync(path.join(root, 'LICENSE'), 'utf8'))) {
      fail(`${pkg.rel}/LICENSE differs from the repository LICENSE`);
    }
  }

  // What would actually be published.
  const packed = run('npm', ['pack', '--dry-run', '--json'], { cwd: pkg.dir });
  if (packed.status !== 0) { fail(`npm pack --dry-run failed:\n${packed.stderr}`); return; }
  const [info] = parseJsonOutput(packed.stdout);
  const files = info.files.map((f) => f.path.replace(/\\/g, '/'));
  const fileSet = new Set(files);

  for (const required of REQUIRED) if (!fileSet.has(required)) fail(`tarball is missing ${required}`);
  for (const target of entryTargets(manifest)) {
    if (target.includes('*')) {
      const re = new RegExp(`^${target.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`);
      if (!files.some((f) => re.test(f))) fail(`no packed file matches entry pattern ./${target}`);
    } else if (!fileSet.has(target)) fail(`entry point ./${target} (package.json exports/types/main) is not in the tarball`);
  }
  for (const file of files) {
    if (/(^|\/)(src|test|tests|__tests__)\//.test(file)) fail(`tarball contains source/test file ${file}`);
    else if (file.endsWith('.tsbuildinfo')) fail(`tarball contains build cache ${file}`);
    else if (!file.startsWith('dist/') && !ROOT_FILES.has(file)) fail(`tarball contains unexpected file ${file}`);
  }

  // Every bare import in shipped JS and .d.ts must be declared, and types for a
  // package without bundled types must come from a declared @types package.
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  for (const file of files.filter((f) => /\.(m|c)?js$|\.d\.(m|c)?ts$/.test(f))) {
    const source = readFileSync(path.join(pkg.dir, file), 'utf8');
    for (const name of importedPackages(source)) {
      if (!declared.has(name)) { fail(`${file} imports "${name}", which is not a dependency or peerDependency`); continue; }
      if (/\.d\.(m|c)?ts$/.test(file) && !shipsOwnTypes(installedManifest(name, pkg.dir)) && !declared.has(typesPackageFor(name))) {
        fail(`${file} exposes types from "${name}", which has no bundled types; declare ${typesPackageFor(name)} (an optional peer is enough)`);
      }
    }
  }

  const summary = `${info.filename}: ${info.entryCount} files, ${info.size} B packed, ${info.unpackedSize} B unpacked`;
  if (failures === failuresBefore) ok(summary);
  else note(summary);
  console.log(`       ${files.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Tarball smoke test in a consumer project outside the repository.

function installedVersion(name, fallback) {
  const manifest = installedManifest(name, root);
  return manifest?.version ?? fallback;
}

function smokeTest(packages) {
  console.log('\nTarball smoke test');
  const work = mkdtempSync(path.join(tmpdir(), 'lq-surface-pack-'));
  const tarballs = path.join(work, 'tarballs');
  const consumer = path.join(work, 'consumer');
  mkdirSync(tarballs);
  mkdirSync(consumer);
  let passed = false;
  try {
    const deps = {};
    for (const pkg of packages) {
      const packed = run('npm', ['pack', '--json', '--pack-destination', tarballs], { cwd: pkg.dir });
      if (packed.status !== 0) { fail(`npm pack ${pkg.manifest.name} failed:\n${packed.stderr}`); return; }
      const [info] = parseJsonOutput(packed.stdout);
      deps[pkg.manifest.name] = `file:../tarballs/${info.filename}`;
    }
    ok(`packed ${Object.keys(deps).length} tarballs into ${tarballs}`);

    const rootManifest = readJson(path.join(root, 'package.json'));
    const devRange = (name) => rootManifest.devDependencies?.[name] ?? 'latest';
    const consumerManifest = {
      name: 'lq-surface-pack-consumer',
      version: '0.0.0',
      private: true,
      type: 'module',
      dependencies: { ...deps, three: installedVersion('three', '*') },
      devDependencies: {
        '@types/three': installedVersion('@types/three', devRange('@types/three')),
        typescript: installedVersion('typescript', devRange('typescript')),
      },
      // Belt and braces: pin every @lowquo/* (including transitive) to the tarballs.
      overrides: { ...deps },
    };
    writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify(consumerManifest, null, 2)}\n`);
    const scopes = [...new Set(packages.map((p) => p.manifest.name.split('/')[0]).filter((s) => s.startsWith('@')))];
    writeFileSync(path.join(consumer, '.npmrc'), [...scopes.map((s) => `${s}:registry=${BLACKHOLE_REGISTRY}`), 'audit=false', 'fund=false', ''].join('\n'));

    const install = run('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline', '--ignore-scripts'], { cwd: consumer });
    if (install.status !== 0) { fail(`npm install in consumer failed:\n${install.stdout}\n${install.stderr}`); return; }
    ok('installed tarballs with three, @types/three and typescript');

    // Prove @lowquo/* came from the local tarballs, never a registry.
    const lock = readJson(path.join(consumer, 'package-lock.json'));
    for (const pkg of packages) {
      const entries = Object.entries(lock.packages).filter(([key]) => key.endsWith(`node_modules/${pkg.manifest.name}`));
      if (entries.length !== 1) fail(`${pkg.manifest.name} installed ${entries.length} times (expected exactly once): ${entries.map(([k]) => k).join(', ')}`);
      for (const [key, entry] of entries) {
        if (!String(entry.resolved ?? '').startsWith('file:')) fail(`${key} resolved from ${entry.resolved}, not a local tarball`);
        if (entry.version !== pkg.manifest.version) fail(`${key} is ${entry.version}, expected ${pkg.manifest.version}`);
      }
      const installedDir = path.join(consumer, 'node_modules', ...pkg.manifest.name.split('/'));
      if (lstatSync(installedDir).isSymbolicLink()) fail(`${pkg.manifest.name} is a symlink; expected an extracted tarball`);
    }
    const ls = run('npm', ['ls', '--all', '--json'], { cwd: consumer });
    if (ls.status !== 0) fail(`npm ls reports an invalid tree (missing or mismatched peers?):\n${ls.stdout}\n${ls.stderr}`);
    else ok('@lowquo/* resolved only from local tarballs; npm ls tree is valid');

    // Node ESM import of the non-browser packages.
    const nodePackages = packages.filter((p) => !BROWSER_ONLY.has(p.manifest.name));
    writeFileSync(path.join(consumer, 'smoke.mjs'), [
      ...nodePackages.map((p, i) => `import * as m${i} from '${p.manifest.name}';`),
      `const modules = { ${nodePackages.map((p, i) => `'${p.manifest.name}': m${i}`).join(', ')} };`,
      'for (const [name, mod] of Object.entries(modules)) {',
      '  const keys = Object.keys(mod);',
      '  if (keys.length === 0) throw new Error(`${name} has no runtime exports`);',
      '  console.log(`${name}: ${keys.join(", ")}`);',
      '}',
      '',
    ].join('\n'));
    const smoke = run(process.execPath, ['smoke.mjs'], { cwd: consumer });
    if (smoke.status !== 0) fail(`Node ESM import failed:\n${smoke.stderr}`);
    else {
      ok(`Node ${process.version} ESM import works:`);
      for (const line of smoke.stdout.trim().split('\n')) console.log(`       ${line}`);
    }

    // Informational: importing browser packages in Node (SSR, test runners) and CommonJS require().
    for (const name of BROWSER_ONLY) {
      if (!packages.some((p) => p.manifest.name === name)) continue;
      writeFileSync(path.join(consumer, 'browser.mjs'), `await import('${name}');\n`);
      const browserImport = run(process.execPath, ['browser.mjs'], { cwd: consumer });
      note(`Node import of ${name} (with three installed): ${browserImport.status === 0 ? 'works' : `fails: ${browserImport.stderr.split('\n').find((l) => /Error/.test(l)) ?? 'see --keep'}`}`);
    }
    writeFileSync(path.join(consumer, 'require.cjs'), "require('@lowquo/surface');\n");
    const cjs = run(process.execPath, ['require.cjs'], { cwd: consumer });
    note(`CommonJS require('@lowquo/surface'): ${cjs.status === 0 ? 'works' : `not supported (${(/ERR_[A-Z_]+/.exec(cjs.stderr) ?? ['error'])[0]}); packages are ESM-only`}`);

    // Type-check a consumer that touches every package's public surface.
    writeFileSync(path.join(consumer, 'consumer.ts'), [
      ...packages.map((p, i) => `import * as p${i} from '${p.manifest.name}';`),
      ...packages.map((p, i) => `import type * as t${i} from '${p.manifest.name}';`),
      `export type PublicApi = { ${packages.map((p, i) => `'${p.manifest.name}': typeof t${i}`).join('; ')} };`,
      `export const api: PublicApi = { ${packages.map((p, i) => `'${p.manifest.name}': p${i}`).join(', ')} };`,
      '',
    ].join('\n'));
    const base = {
      target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], strict: true, noEmit: true,
      skipLibCheck: false, types: [], verbatimModuleSyntax: true, isolatedModules: true,
    };
    const variants = {
      bundler: { module: 'ESNext', moduleResolution: 'bundler' },
      nodenext: { module: 'NodeNext', moduleResolution: 'NodeNext' },
    };
    const tsManifest = readJson(path.join(consumer, 'node_modules', 'typescript', 'package.json'));
    const tscBin = path.join(consumer, 'node_modules', 'typescript', typeof tsManifest.bin === 'string' ? tsManifest.bin : tsManifest.bin.tsc);
    for (const [variant, options] of Object.entries(variants)) {
      const config = `tsconfig.${variant}.json`;
      writeFileSync(path.join(consumer, config), `${JSON.stringify({ compilerOptions: { ...base, ...options }, files: ['consumer.ts'] }, null, 2)}\n`);
      const tsc = run(process.execPath, [tscBin, '-p', config], { cwd: consumer });
      if (tsc.status !== 0) fail(`TypeScript ${tsManifest.version} (moduleResolution ${variant}) rejects the packed types:\n${tsc.stdout}${tsc.stderr}`);
      else ok(`TypeScript ${tsManifest.version} type-checks all public types with moduleResolution "${variant}" (skipLibCheck false)`);
    }
    passed = failures === 0;
  } finally {
    if (keep || !passed) console.log(`  note consumer project kept at ${work}`);
    else rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  }
}

// ---------------------------------------------------------------------------

const workspaces = workspacePackages();
const packages = workspaces.filter((p) => p.manifest.private !== true);

const missingBuild = packages.filter((p) => !existsSync(path.join(p.dir, 'dist', 'index.js')));
if (missingBuild.length) {
  console.error(`Missing build output for ${missingBuild.map((p) => p.manifest.name).join(', ')}; run \`npm run build:packages\` first.`);
  process.exit(1);
}

console.log(`Checking ${packages.length} publishable packages with npm ${run('npm', ['--version'], { cwd: root }).stdout.trim()} / Node ${process.version}`);
for (const pkg of packages) checkContents(pkg);
checkWorkspaceLinks(workspaces, packages);
if (!contentsOnly && failures === 0) smokeTest(packages);
else if (!contentsOnly) console.log('\nSkipping tarball smoke test because content checks failed.');

console.log(failures ? `\ncheck:pack failed with ${failures} problem(s).` : '\ncheck:pack passed.');
process.exit(failures ? 1 : 0);
