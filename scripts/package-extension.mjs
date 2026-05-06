#!/usr/bin/env node
// Cross-platform extension packager.
// Produces dist/qa-annotator-extension-v<version>.zip containing only the
// runtime files: manifest.json, src/, assets/, README.md.
// Excludes plugins/, docs/, scripts/, planning docs.
//
// Usage:
//   node scripts/package-extension.mjs              # version from manifest.json
//   node scripts/package-extension.mjs 0.2.0        # override version

import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
process.chdir(REPO_ROOT);

const manifestPath = resolve(REPO_ROOT, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('✗ manifest.json not found at repo root.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const VERSION = process.argv[2] || manifest.version;
if (!VERSION) {
  console.error('✗ Could not determine extension version.');
  process.exit(1);
}

const INCLUDE_PATHS = ['manifest.json', 'src', 'assets', 'README.md'];
const EXCLUDE_PATTERNS = [/\.DS_Store$/, /Thumbs\.db$/, /\.gitkeep$/];

const DIST_DIR = resolve(REPO_ROOT, 'dist');
const ZIP_NAME = `qa-annotator-extension-v${VERSION}.zip`;
const ZIP_PATH = join(DIST_DIR, ZIP_NAME);

mkdirSync(DIST_DIR, { recursive: true });
if (existsSync(ZIP_PATH)) rmSync(ZIP_PATH);

// --- collect files ----------------------------------------------------
function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (EXCLUDE_PATTERNS.some((re) => re.test(entry.name))) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

const files = [];
for (const p of INCLUDE_PATHS) {
  const full = resolve(REPO_ROOT, p);
  if (!existsSync(full)) {
    console.error(`✗ ${p} does not exist.`);
    process.exit(1);
  }
  if (statSync(full).isDirectory()) walk(full, files);
  else files.push(full);
}

// --- ZIP writer (store-mode, same algorithm as src/lib/zip-store.js) ---
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const u16 = (n) => Buffer.from([n & 0xFF, (n >>> 8) & 0xFF]);
const u32 = (n) => Buffer.from([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]);

function dosTime(d) { return ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F); }
function dosDate(d) { return (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F); }

const now = new Date();
const localChunks = [];
const central = [];
let offset = 0;

for (const abs of files) {
  const rel = relative(REPO_ROOT, abs).split(sep).join('/');
  const data = readFileSync(abs);
  const crc = crc32(data);
  const size = data.length;
  const time = dosTime(now);
  const date = dosDate(now);
  const nameBuf = Buffer.from(rel, 'utf8');

  const lfh = Buffer.concat([
    u32(0x04034B50),
    u16(20), u16(0), u16(0),
    u16(time), u16(date),
    u32(crc), u32(size), u32(size),
    u16(nameBuf.length), u16(0),
    nameBuf
  ]);
  localChunks.push(lfh, data);

  central.push(Buffer.concat([
    u32(0x02014B50),
    u16(20), u16(20), u16(0), u16(0),
    u16(time), u16(date),
    u32(crc), u32(size), u32(size),
    u16(nameBuf.length), u16(0), u16(0),
    u16(0), u16(0), u32(0),
    u32(offset),
    nameBuf
  ]));

  offset += lfh.length + data.length;
}

const cdBuf = Buffer.concat(central);
const eocd = Buffer.concat([
  u32(0x06054B50),
  u16(0), u16(0),
  u16(files.length), u16(files.length),
  u32(cdBuf.length), u32(offset),
  u16(0)
]);

const zipBuf = Buffer.concat([...localChunks, cdBuf, eocd]);
writeFileSync(ZIP_PATH, zipBuf);

const sizeKB = (zipBuf.length / 1024).toFixed(1);
console.log(`\n✓ Packaged ${ZIP_PATH} (${sizeKB} KB · ${files.length} files)\n`);
console.log('Contents:');
for (const abs of files.slice(0, 30)) {
  console.log('  ' + relative(REPO_ROOT, abs).split(sep).join('/'));
}
if (files.length > 30) console.log(`  ... and ${files.length - 30} more`);

console.log('\nNext steps:');
console.log('  Manual install:  chrome://extensions → Developer mode → Load unpacked → unzipped folder');
console.log('  GitHub release:  gh release create v' + VERSION + ' "' + ZIP_PATH + '"');
console.log('  Web Store:       https://chrome.google.com/webstore/devconsole → upload "' + ZIP_PATH + '"');
