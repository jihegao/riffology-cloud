#!/usr/bin/env node
import { open, mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateInitialWorkspaceArchive } from '../../services/workspace/initial-archive.ts';

export const LIMITS = Object.freeze({ maxBytes: 8 * 1024 * 1024, maxFiles: 4096, maxFileBytes: 1024 * 1024 });
const ROOTS = new Set(['model', 'app', 'experiments', 'docs']);
const badChars = /[\u0000-\u001f\u007f]/u;

const fail = (message) => { throw new Error(message); };
function checkRelative(rel) {
  if (!rel || rel.normalize('NFC') !== rel || rel.length > 512 || badChars.test(rel) || rel.startsWith('/') || rel.includes('\\')) fail(`invalid path: ${rel}`);
  const parts = rel.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..') || !ROOTS.has(parts[0])) fail(`invalid path: ${rel}`);
}

async function walk(root, current = root, output = []) {
  const info = await lstat(current);
  if (info.isSymbolicLink() || !info.isDirectory()) fail(`source root must be a directory: ${current}`);
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    checkRelative(rel);
    const stat = await lstat(full);
    if (stat.isSymbolicLink() || stat.isSocket() || stat.isFIFO() || stat.isBlockDevice() || stat.isCharacterDevice()) fail(`unsupported file: ${rel}`);
    if (stat.isDirectory()) await walk(root, full, output);
    else if (stat.isFile()) {
      if (stat.nlink !== 1) fail(`hardlink is not allowed: ${rel}`);
      if (stat.size > LIMITS.maxFileBytes) fail(`file too large: ${rel}`);
      output.push({ rel, full, size: stat.size });
    } else fail(`unsupported file: ${rel}`);
  }
  return output;
}

export async function buildModelPackage(inputDir, outputFile) {
  const root = path.resolve(inputDir);
  const out = path.resolve(outputFile);
  if (out === root || out.startsWith(`${root}${path.sep}`)) fail('output must be outside source directory');
  const files = await walk(root);
  if (files.length < 1) fail('source directory contains no files');
  if (files.length > LIMITS.maxFiles) fail('too many files');
  files.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  let total = 0;
  const rows = [];
  // Include the platform README in the archive entry budget even though its
  // actual contents are generated independently when a workspace is created.
  const archiveFiles = { 'README.md': new Uint8Array() };
  for (const file of files) {
    const bytes = await readFile(file.full);
    if (bytes.length !== file.size) fail(`file changed while reading: ${file.rel}`);
    total += bytes.length;
    if (total > LIMITS.maxBytes) fail('package too large');
    archiveFiles[file.rel] = bytes;
    rows.push({ path: file.rel, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), contentBase64: bytes.toString('base64') });
  }
  validateInitialWorkspaceArchive(archiveFiles);
  const manifest = { schemaVersion: 1, files: rows };
  const serialized = JSON.stringify(manifest);
  if (Buffer.byteLength(serialized) > LIMITS.maxBytes) fail('serialized package too large');
  await mkdir(path.dirname(out), { recursive: true });
  try { await open(out, 'wx', 0o600).then((h) => h.close()); } catch (e) { if (e.code === 'EEXIST') fail(`output exists: ${out}`); throw e; }
  await writeFile(out, serialized, { encoding: 'utf8', mode: 0o600 });
  await chmod(out, 0o600);
  return { output: out, bytes: Buffer.byteLength(serialized), sha256: crypto.createHash('sha256').update(serialized).digest('hex'), fileCount: rows.length, contentBytes: total };
}

function usage() { console.error('Usage: node scripts/m1/model-package.mjs --input <directory> --output <file>'); }
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2); const inputIndex = args.indexOf('--input'); const outputIndex = args.indexOf('--output');
  if (inputIndex < 0 || outputIndex < 0 || !args[inputIndex + 1] || !args[outputIndex + 1]) { usage(); process.exitCode = 2; }
  else buildModelPackage(args[inputIndex + 1], args[outputIndex + 1]).then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(`model-package: ${e.message}`); process.exitCode = 1; });
}
