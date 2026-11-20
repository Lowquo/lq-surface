#!/usr/bin/env node
// Packages the built playground (examples/playground/dist) into the ZIP that the JUCE example
// embeds with juce_add_binary_data. Pure Node (>= 22), no Python and no third-party packages.
//
// The archive is deterministic: entries are sorted by path, every timestamp is fixed to the
// earliest DOS date (1980-01-01 00:00:00), no extra fields or OS-specific attributes are written,
// and compression uses a fixed zlib level. Identical inputs therefore produce byte-identical ZIPs.
//
// Usage: node scripts/pack-juce.mjs [--dist <dir>] [--out <file>]
import { deflateRawSync, crc32, constants as zlibConstants } from 'node:zlib';
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`Missing value for ${name}`);
  return resolve(value);
}

const dist = argValue('--dist', join(root, 'examples', 'playground', 'dist'));
const target = argValue('--out', join(root, 'examples', 'juce-plugin', 'resources', 'surface-ui.zip'));

if (typeof crc32 !== 'function') {
  throw new Error('node:zlib crc32 is unavailable; Node.js 22 or newer is required');
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`Missing ${relative(root, join(dist, 'index.html'))}; run "npm run build" first.`);
  process.exit(1);
}

/** Collects regular files below `dir`, refusing symlinks and skipping dotfiles (e.g. .DS_Store). */
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`Refusing to package symlink: ${full}`);
    if (stat.isDirectory()) collect(full, out);
    else if (stat.isFile()) out.push(full);
  }
  return out;
}

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const MAX_32 = 0xffffffff;

const files = collect(dist)
  .map((full) => ({ full, name: relative(dist, full).split(sep).join('/') }))
  // Byte-wise ordinal sort, independent of locale.
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

if (files.length > 0xffff) throw new Error('Too many files for a non-ZIP64 archive');

const localParts = [];
const centralParts = [];
let offset = 0;

for (const { full, name } of files) {
  if (name.includes('..') || name.includes('\\') || name.startsWith('/')) {
    throw new Error(`Unsafe archive path: ${name}`);
  }
  const data = readFileSync(full);
  const deflated = deflateRawSync(data, { level: 9, strategy: zlibConstants.Z_DEFAULT_STRATEGY });
  const useDeflate = deflated.length < data.length;
  const payload = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;
  const checksum = crc32(data) >>> 0;
  const nameBytes = Buffer.from(name, 'utf8');
  const utf8Flag = /[^\x20-\x7e]/.test(name) ? 0x0800 : 0;

  if (data.length >= MAX_32 || payload.length >= MAX_32 || offset >= MAX_32) {
    throw new Error('Archive too large for a non-ZIP64 archive');
  }

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // local file header signature
  local.writeUInt16LE(20, 4); // version needed to extract (2.0)
  local.writeUInt16LE(utf8Flag, 6); // general purpose flags
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28); // extra field length
  localParts.push(local, nameBytes, payload);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); // central directory header signature
  central.writeUInt16LE(20, 4); // version made by: MS-DOS / 2.0 (no Unix permission bits)
  central.writeUInt16LE(20, 6); // version needed to extract
  central.writeUInt16LE(utf8Flag, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30); // extra field length
  central.writeUInt16LE(0, 32); // comment length
  central.writeUInt16LE(0, 34); // disk number start
  central.writeUInt16LE(0, 36); // internal attributes
  central.writeUInt32LE(0, 38); // external attributes
  central.writeUInt32LE(offset, 42); // local header offset
  centralParts.push(central, nameBytes);

  offset += local.length + nameBytes.length + payload.length;
}

const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
if (offset + centralSize >= MAX_32) throw new Error('Archive too large for a non-ZIP64 archive');

const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
end.writeUInt16LE(0, 4); // this disk
end.writeUInt16LE(0, 6); // disk with central directory
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20); // comment length

const zip = Buffer.concat([...localParts, ...centralParts, end]);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, zip);

const digest = createHash('sha256').update(zip).digest('hex');
console.log(`Wrote ${relative(root, target)} (${zip.length.toLocaleString('en-US')} bytes, ${files.length} files, sha256 ${digest})`);
