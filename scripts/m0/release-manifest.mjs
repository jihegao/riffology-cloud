#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, safePath, sourceSnapshot } from './source-inventory.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const digestPattern = /^[a-f0-9]{64}$/;
const fail = message => { throw new Error(message); };
const fileHash = path => hash(readFileSync(path));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const readJSON = path => {
  const bytes = readFileSync(path);
  if (bytes.length > 4 * 1024 * 1024) fail('JSON artifact too large');
  return JSON.parse(bytes.toString('utf8'));
};
const same = (actual, expected, message) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, keys, label) {
  if (!object(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail(`${label} required fields are invalid`);
}
function artifact(input, label) {
  const path = safePath(root, input, label);
  return { path: relative(root, path), sha256: fileHash(path) };
}
function artifactPath(entry, label) {
  exactKeys(entry, ['path', 'sha256'], label);
  if (typeof entry.path !== 'string' || isAbsolute(entry.path) || entry.path.includes('\\') || entry.path !== relative(root, resolve(root, entry.path)) || !digestPattern.test(entry.sha256)) fail(`${label} path or hash is invalid`);
  const path = safePath(root, resolve(root, entry.path), label);
  if (fileHash(path) !== entry.sha256) fail(`${label} hash mismatch`);
  return path;
}
function versions() {
  const packages = readJSON(safePath(root, resolve(root, 'package-lock.json'), 'package-lock')).packages;
  const names = { pi: '@earendil-works/pi-coding-agent', piServer: '@earendil-works/pi-server', sandbox: '@cloudflare/sandbox', containers: '@cloudflare/containers', wrangler: 'wrangler' };
  return Object.fromEntries(Object.entries(names).map(([name, dependency]) => {
    const version = packages?.[`node_modules/${dependency}`]?.version;
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) fail(`missing locked version: ${dependency}`);
    return [name, version];
  }));
}
function images(path) {
  const input = readJSON(path);
  if (!Array.isArray(input.images) || input.images.length < 2 || input.images.length > 16) fail('images input requires trusted and project image records');
  const result = input.images.map((item, index) => {
    if (!object(item) || !/^sha256:[a-f0-9]{64}$/.test(item.id)) fail(`image ${index} digest is invalid`);
    if (!['amd64', 'arm64'].includes(item.architecture)) fail(`image ${index} architecture is invalid`);
    if (!Array.isArray(item.tags) || !item.tags.every(tag => typeof tag === 'string' && tag.length <= 256)) fail(`image ${index} tags are invalid`);
    return { digest: item.id, architecture: item.architecture, tags: item.tags };
  });
  if (new Set(result.map(item => item.digest)).size !== result.length) fail('duplicate image digest');
  return result;
}
function checks(path, gitHead) {
  const record = readJSON(path);
  if (record.schemaVersion !== 1 || record.environment !== 'local' || record.passed !== true || record.sourceStableDuringCheck !== true) fail('checks require passed=true, sourceStableDuringCheck=true and local schemaVersion=1');
  if (record.gitHead !== gitHead) fail('checks git HEAD differs from current HEAD');
  const source = sourceSnapshot(root);
  if (!object(record.sources) || !Array.isArray(record.sources.files) || !record.sources.files.length) fail('checks source inventory is required');
  if (record.sources.sha256 !== source.sha256) fail('checks source hash mismatch');
  same(record.sources, source, 'checks source inventory differs from complete current source tree');
  return source;
}
const trust = 'Local integrity manifest only; build provenance is unverified. This is not a signature, staging gate, or deployment proof.';
function create(options) {
  const gitHead = git('rev-parse', 'HEAD');
  const files = {
    boundaryBundle: artifact(options['boundary-bundle'], 'boundary bundle'),
    storageBundle: artifact(options['storage-bundle'], 'storage bundle'),
    imagesInput: artifact(options['images-input'], 'images input'),
    packageLock: artifact(resolve(root, 'package-lock.json'), 'package-lock'),
  };
  const checkRecord = artifact(options.checks, 'checks');
  const sourceTree = checks(resolve(root, checkRecord.path), gitHead);
  const manifest = {
    schemaVersion: 1, protocol: 'm0-v1', checkpointFormat: 1, environment: 'local', deployed: false, canPromote: false,
    createdAt: new Date().toISOString(), gitHead, gitDirty: git('status', '--porcelain').length > 0,
    files, versions: versions(), images: images(resolve(root, files.imagesInput.path)), sourceTree,
    checks: { ...checkRecord, passed: true, sourceStableDuringCheck: true }, trust,
  };
  const out = safePath(root, options.out, 'manifest', true);
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  return { created: true, path: out, canPromote: false, gitHead };
}
function verify(input) {
  const manifest = readJSON(safePath(root, input, 'manifest'));
  exactKeys(manifest, ['schemaVersion','protocol','checkpointFormat','environment','deployed','canPromote','createdAt','gitHead','gitDirty','files','versions','images','sourceTree','checks','trust'], 'manifest');
  if (manifest.schemaVersion !== 1 || manifest.protocol !== 'm0-v1' || manifest.checkpointFormat !== 1 || manifest.environment !== 'local' || manifest.deployed !== false || manifest.canPromote !== false || typeof manifest.gitDirty !== 'boolean' || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) || manifest.trust !== trust) fail('manifest required fields are invalid');
  const gitHead = git('rev-parse', 'HEAD');
  if (manifest.gitHead !== gitHead) fail('git HEAD changed');
  exactKeys(manifest.files, ['boundaryBundle','storageBundle','imagesInput','packageLock'], 'artifact');
  for (const [name, entry] of Object.entries(manifest.files)) artifactPath(entry, name === 'packageLock' ? 'package-lock' : name);
  if (manifest.files.packageLock.path !== 'package-lock.json') fail('package-lock path changed');
  exactKeys(manifest.checks, ['path','sha256','passed','sourceStableDuringCheck'], 'checks');
  if (manifest.checks.passed !== true || manifest.checks.sourceStableDuringCheck !== true) fail('checks passed flags changed');
  const checkPath = artifactPath({ path: manifest.checks.path, sha256: manifest.checks.sha256 }, 'checks');
  same(manifest.sourceTree, checks(checkPath, gitHead), 'source tree changed');
  same(manifest.versions, versions(), 'dependency versions changed');
  same(manifest.images, images(resolve(root, manifest.files.imagesInput.path)), 'image metadata changed');
  return { verified: true, canPromote: false, gitHead, gitDirtyNow: git('status','--porcelain').length > 0, buildProvenance: 'unverified' };
}
try {
  const argv = process.argv.slice(2), command = argv.shift(), options = {};
  const allowed = command === 'create' ? ['boundary-bundle','storage-bundle','images-input','checks','out'] : ['manifest'];
  while (argv.length) {
    const option = argv.shift();
    if (!option.startsWith('--') || !allowed.includes(option.slice(2)) || Object.hasOwn(options, option.slice(2)) || !argv.length) fail('invalid or duplicate argument');
    options[option.slice(2)] = argv.shift();
  }
  if (!['create','verify'].includes(command) || allowed.some(key => typeof options[key] !== 'string')) fail('usage: create --boundary-bundle FILE --storage-bundle FILE --images-input FILE --checks FILE --out FILE | verify --manifest FILE');
  console.log(JSON.stringify(command === 'create' ? create(options) : verify(options.manifest), null, 2));
} catch (error) {
  console.error(`release-manifest: ${error.message}`);
  process.exitCode = 1;
}
