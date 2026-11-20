#!/usr/bin/env node
// prepublishOnly guard for the lq-surface packages. npm runs it, in the package directory, before
// every `npm publish` of @lowquo/surface, @lowquo/surface-controls or @lowquo/surface-juce.
//
// - `npm publish --dry-run` is always allowed (npm sets npm_config_dry_run=true).
// - A real publish needs the maintainer's explicit approval for exactly this version:
//     LQ_SURFACE_RELEASE_APPROVED=<version>
//   and must run from a clean git checkout whose HEAD is tagged v<version>.
//
// See docs/releasing.md. No dependencies beyond Node built-ins.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const id = `${manifest.name}@${manifest.version}`;

if (process.env.npm_config_dry_run === 'true') {
  console.log(`release-guard: dry run of ${id}: allowed`);
  process.exit(0);
}

const refuse = (reason) => {
  console.error(`release-guard: refusing to publish ${id}: ${reason}`);
  console.error('release-guard: publishing needs explicit maintainer approval; follow docs/releasing.md.');
  process.exit(1);
};

const approved = (process.env.LQ_SURFACE_RELEASE_APPROVED ?? '').trim();
if (!approved) refuse('LQ_SURFACE_RELEASE_APPROVED is not set');
if (approved !== manifest.version) refuse(`LQ_SURFACE_RELEASE_APPROVED is "${approved}", but this package is ${manifest.version}`);

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const status = git('status', '--porcelain');
if (status === null) refuse('not inside a git checkout (publish from a clean clone of the release tag)');
if (status !== '') refuse('the git working tree has uncommitted changes');
const tags = (git('tag', '--points-at', 'HEAD') ?? '').split('\n').filter(Boolean);
if (!tags.includes(`v${manifest.version}`)) refuse(`HEAD is not tagged v${manifest.version} (tags at HEAD: ${tags.join(', ') || 'none'})`);

console.log(`release-guard: ${id} approved for publishing from tag v${manifest.version}`);
