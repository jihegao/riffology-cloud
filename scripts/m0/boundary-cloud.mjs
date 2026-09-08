#!/usr/bin/env node
// Cloud driver: validate an operator-created deployment receipt before any request.
import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { runBoundaryProbe } from './boundary-local.mjs';

const root = process.cwd();
const localRoot = resolve(root, '.local');
const pathSeparator = process.platform === 'win32' ? '\\' : '/';
const usage = 'Usage: node scripts/m0/boundary-cloud.mjs --secrets-file <.local-secret-file> <verified-deployment-record.json>';

if (process.argv.length !== 5 || process.argv[2] !== '--secrets-file') throw new Error(usage);
const secretPath = resolve(process.argv[3]);
const recordPath = resolve(process.argv[4]);

async function assertSafeLocalFile(target, label) {
  const targetRelative = relative(localRoot, target);
  if (targetRelative === '..' || targetRelative.startsWith(`..${pathSeparator}`)) throw new Error(`${label}-must-be-under-repo-.local`);
  const rootRelative = relative(root, target);
  let current = root;
  for (const part of rootRelative.split(pathSeparator)) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`${label}-path-must-not-contain-symlink`);
  }
  const info = await lstat(target);
  if (!info.isFile()) throw new Error(`${label}-must-be-a-regular-file`);
}

await assertSafeLocalFile(secretPath, 'secret-file');
await assertSafeLocalFile(recordPath, 'deployment-record');
const secretMode = (await lstat(secretPath)).mode & 0o777;
assert.equal(secretMode, 0o600, 'secret-file-must-be-0600');
const secrets = JSON.parse(await readFile(secretPath, 'utf8'));
assert.deepEqual(Object.keys(secrets).sort(), ['M0_PROBE_TOKEN']);
assert.equal(typeof secrets.M0_PROBE_TOKEN, 'string');
assert.ok(secrets.M0_PROBE_TOKEN.length >= 32);

const deployment = JSON.parse(await readFile(recordPath, 'utf8'));
assert.equal(deployment.schemaVersion, 1);
assert.equal(deployment.environment, 'staging');
assert.equal(deployment.verified, true);
assert.equal(deployment.accountId, '8b0d70250211aa10d89e20605a1c7e5e');
assert.equal(deployment.workerName, 'riffology-m0-probe-staging');
assert.equal(deployment.workerUrl, 'https://riffology-m0-probe-staging.jihe-gao.workers.dev');
const workerUrl = new URL(deployment.workerUrl);
assert.equal(workerUrl.pathname, '/');
assert.equal(workerUrl.search, '');
assert.equal(workerUrl.hash, '');
assert.match(deployment.version, /^[A-Za-z0-9._:-]{1,200}$/);
assert.match(deployment.bundleSha256, /^[a-f0-9]{64}$/);
assert.match(deployment.configSha256, /^[a-f0-9]{64}$/);
assert.ok(Array.isArray(deployment.imageDigests) && deployment.imageDigests.length > 0);
for (const digest of deployment.imageDigests) assert.match(digest, /^sha256:[a-f0-9]{64}$/);

await runBoundaryProbe({
  origin: workerUrl.origin,
  token: secrets.M0_PROBE_TOKEN,
  environment: 'staging-cloud-workerd',
  runPrefix: 'm0-boundary-cloud',
  outputName: 'boundary-cloud.json',
  deployment: {
    accountId: deployment.accountId,
    workerName: deployment.workerName,
    workerUrl: workerUrl.origin,
    version: deployment.version,
    bundleSha256: deployment.bundleSha256,
    configSha256: deployment.configSha256,
    imageDigests: deployment.imageDigests,
  },
});
