import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Standalone JS runner boundaries are exercised without network access.
import { parseArguments, validateDeployment } from '../../scripts/m0/model-proxy-cloud.mjs';
// @ts-expect-error Standalone JS runner boundaries are exercised without network access.
import { STAGING_ORIGIN, runModelProxyProbe } from '../../scripts/m0/model-proxy-local.mjs';

test('cloud CLI accepts only explicit secret and reviewed deployment paths', () => {
  assert.deepEqual(parseArguments(['--deployment', 'review.json', '--secrets-file', 'secret.json']), { deploymentFile: 'review.json', secretsFile: 'secret.json' });
  for (const args of [[], ['--origin', 'https://example.com'], ['--secrets-file', 'a'], ['--secrets-file', 'a', '--secrets-file', 'b'], ['--deployment', '--secrets-file', 'a']]) assert.throws(() => parseArguments(args));
});

test('cloud proof must bind recent account, origin, version and exact runtime sources', () => {
  const now = 1000000;
  const snapshot = { files: [{ path: 'spikes/m0-model-proxy/cloud.ts', sha256: 'a'.repeat(64) }, { path: 'docs/readme.md', sha256: 'b'.repeat(64) }] };
  const proof = { verified: true, mode: 'fixture-only', origin: STAGING_ORIGIN, accountId: '8b0d70250211aa10d89e20605a1c7e5e', scriptName: 'riffology-m0-model-proxy-staging', versionId: '11111111-1111-4111-8111-111111111111', bundleSha256: 'c'.repeat(64), verifiedAtMs: now, sourceFiles: [snapshot.files[0]] };
  assert.equal(validateDeployment(proof, snapshot, now).versionId, proof.versionId);
  for (const patch of [{ verified: false }, { mode: 'live' }, { origin: 'https://example.com' }, { accountId: 'other' }, { scriptName: 'other' }, { versionId: 'not-a-version' }, { bundleSha256: '' }, { verifiedAtMs: now + 1 }, { verifiedAtMs: now - 900001 }, { sourceFiles: [] }]) assert.throws(() => validateDeployment({ ...proof, ...patch }, snapshot, now));
  assert.throws(() => validateDeployment(proof, { files: [{ ...snapshot.files[0], sha256: 'd'.repeat(64) }] }, now), /source-mismatch/);
});

test('invalid cloud admission makes zero transport calls before any probe can start', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error('network forbidden'); };
  await assert.rejects(runModelProxyProbe({ origin: 'https://example.com', token: 'x'.repeat(64), fetcher }), /origin-denied/);
  await assert.rejects(runModelProxyProbe({ origin: STAGING_ORIGIN, token: 'x'.repeat(64), fetcher }), /verified-fixture-deployment-required/);
  assert.equal(calls, 0);
});
