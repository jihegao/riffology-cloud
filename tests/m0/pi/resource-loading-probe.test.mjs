import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runResourceLoadingProbe } from '../../../services/runtime/resource-loading-probe.mjs';

test('real SDK startup and restore reject discoverable malicious resources; normal discovery is a positive control', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'riffology-resource-loading-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  let defaultFetchCalls = 0, result;
  globalThis.fetch = async () => { defaultFetchCalls++; throw new Error('unexpected-default-network'); };
  try { result = await runResourceLoadingProbe({ trustedCwd: directory }); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(defaultFetchCalls, 0);
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.sdkVersion, '0.85.0');
  assert.equal(result.requests, 2);
  assert.equal(result.realProviderCalls, 0);
  assert.deepEqual(result.phases.map(row => row.phase), ['startup', 'restored']);
  assert.ok(result.fixtureFiles.length >= 8);
  for (const row of result.fixtureFiles) { assert.match(row.sha256, /^[a-f0-9]{64}$/); assert.ok(row.bytes > 0 && row.bytes < 4096); }
  const serialized = JSON.stringify(result);
  assert.ok(serialized.length < 8192);
  assert.ok(!serialized.includes(directory));
  assert.ok(!serialized.includes('m0-resource-synthetic-credential'));
  assert.ok(!serialized.includes('M0_UNTRUSTED_RESOURCE_CONTENT'));
});

test('probe refuses nonempty or nonabsolute work directories before writing fixtures', async t => {
  await assert.rejects(runResourceLoadingProbe({ trustedCwd: 'relative' }), /invalid-probe-directory/);
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'riffology-resource-loading-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'existing'), 'preserve');
  await assert.rejects(runResourceLoadingProbe({ trustedCwd: directory }), /empty-and-canonical/);
});
