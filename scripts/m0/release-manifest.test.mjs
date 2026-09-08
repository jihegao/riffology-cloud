import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(new URL('../..', import.meta.url).pathname);
const script = resolve(root, 'scripts/m0/release-manifest.mjs');
const images = resolve(root, 'docs/evidence/runs/m0-initial/artifacts/local-images.json');
const digest = v => createHash('sha256').update(v).digest('hex');
const hash = f => digest(readFileSync(f));
const run = args => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
function checks(dir) {
  const raw = execFileSync('rg', ['--files', '--hidden', 'services', 'spikes', 'scripts', 'tests', 'infra', 'ui', '-g', '!.dev.vars*', '-g', '!**/.wrangler/**', '-g', '!**/.local/**'], { cwd: root, encoding: 'utf8' }).trim();
  const paths = (raw ? raw.split('\n') : []).concat(['package.json', 'package-lock.json', 'tsconfig.json', 'Dockerfile.trusted-pi.cloud', '.dockerignore', '.gitignore']).sort();
  const files = paths.map(path => ({ path, sha256: hash(resolve(root, path)) }));
  const data = { schemaVersion: 1, environment: 'local', gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceStableDuringCheck: true, passed: true, sources: { sha256: digest(JSON.stringify(files)), files } };
  const file = resolve(dir, 'checks.json'); writeFileSync(file, JSON.stringify(data, null, 2)); return file;
}
function fixture() { const dir = mkdtempSync(resolve(root, '.local/manifest-test-')); mkdirSync(resolve(dir, 'boundary')); mkdirSync(resolve(dir, 'storage')); const boundary = resolve(dir, 'boundary/index.js'); const storage = resolve(dir, 'storage/index.js'); writeFileSync(boundary, 'export default { role: "boundary", build: 1 };\n'); writeFileSync(storage, 'export default { role: "storage", build: 1 };\n'); return { dir, boundary, storage, checks: checks(dir), out: resolve(dir, 'candidate.json') }; }
const create = (f, out = f.out) => run(['create', '--boundary-bundle', f.boundary, '--storage-bundle', f.storage, '--images-input', images, '--checks', f.checks, '--out', out]);
function baseline() { const f = fixture(); assert.equal(create(f).status, 0); const result = run(['verify', '--manifest', f.out]); assert.equal(result.status, 0, result.stderr); const manifest = JSON.parse(readFileSync(f.out)); assert.equal(manifest.canPromote, false); return { f, manifest }; }
function altered(b, name, mutate) { const out = resolve(b.f.dir, `${name}.json`); const m = structuredClone(b.manifest); mutate(m, b.f); writeFileSync(out, JSON.stringify(m)); return { ...b.f, out }; }
function fails(f, text) { const result = run(['verify', '--manifest', f.out]); assert.equal(result.status, 1); assert.match(result.stderr, new RegExp(text)); }

test('valid candidate verifies and is never promotable', () => {
  const b = baseline();
  try { assert.equal(b.manifest.deployed, false); } finally { rmSync(b.f.dir, { recursive: true, force: true }); }
});

test('artifact, lock, and source tampering are independently rejected', () => {
  const cases = [
    ['boundary', (m, f) => writeFileSync(f.boundary, 'tampered'), 'boundary.*hash'],
    ['storage', (m, f) => writeFileSync(f.storage, 'tampered'), 'storage.*hash'],
    ['lock', m => { m.files.packageLock.sha256 = '0'.repeat(64); }, 'package-lock.*hash'],
    ['source', m => { m.sourceTree.files[0].sha256 = '0'.repeat(64); }, 'source'],
  ];
  for (const [name, mutate, message] of cases) {
    const b = baseline();
    try { fails(altered(b, name, mutate), message); } finally { rmSync(b.f.dir, { recursive: true, force: true }); }
  }
});

test('checks flags and checks hash are independently rejected', () => {
  for (const [name, mutate, message, updateManifestHash] of [
    ['flag', data => { data.passed = false; }, 'passed', true],
    ['source-hash', data => { data.sources.sha256 = '0'.repeat(64); }, 'hash', true],
    ['hash-without-update', data => { data.passed = false; }, 'checks.*hash', false],
  ]) {
    const b = baseline();
    try {
      const data = JSON.parse(readFileSync(b.f.checks)); mutate(data); writeFileSync(b.f.checks, JSON.stringify(data));
      if (updateManifestHash) { b.manifest.checks.sha256 = hash(b.f.checks); writeFileSync(b.f.out, JSON.stringify(b.manifest)); }
      fails(b.f, message);
    } finally { rmSync(b.f.dir, { recursive: true, force: true }); }
  }
});

test('required fields, versions, missing artifact, source omission, and invalid image fail', () => {
  const cases = [
    ['required', m => { delete m.protocol; }, 'required'],
    ['versions', m => { m.versions.pi = 'wrong'; }, 'version'],
    ['missing', (m, f) => unlinkSync(f.boundary), 'boundary'],
    ['omission', m => m.sourceTree.files.pop(), 'source'],
    ['image', m => { m.images[0].digest = 'sha256:bad'; }, 'image'],
  ];
  for (const [name, mutate, message] of cases) { const b = baseline(); try { fails(altered(b, name, mutate), message); } finally { rmSync(b.f.dir, { recursive: true, force: true }); } }
});

test('symlink parent and repository escape paths fail', () => {
  const cases = [
    ['symlink', (m, f) => { symlinkSync(resolve(f.dir, 'boundary'), resolve(f.dir, 'link')); m.files.boundaryBundle.path = relative(root, resolve(f.dir, 'link/index.js')); }, 'symlink'],
    ['escape', m => { m.files.boundaryBundle.path = '../package.json'; }, 'path|repository'],
  ];
  for (const [name, mutate, message] of cases) { const b = baseline(); try { fails(altered(b, name, mutate), message); } finally { rmSync(b.f.dir, { recursive: true, force: true }); } }
});
