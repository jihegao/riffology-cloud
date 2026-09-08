import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hash, sourceSnapshot } from './source-inventory.mjs';
import { readProbeSecret } from './storage-cloud.mjs';
import { expectedEntries, treeFor, verifyMutation, verifyRestoration, verifyRecreatedFilesystem } from '../../spikes/m0-files/verification.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'https://riffology-m0-files-staging.jihe-gao.workers.dev';
const limits = { requests: 20, totalMs: 300000, runMs: 200000, readMs: 15000, responseBytes: 131072, totalBytes: 1048576 };

export async function verifyFilesReport(body) {
  assert.equal(body.operation, 'G0-T05-filesystem');
  assert.equal(body.protocol, 'm0-v1');
  assert.equal(body.execution_environment, 'cloudflare-vm');
  assert.equal(body.primitive_checks_passed, true);
  assert.equal(body.failure_stage, null);
  assert.equal(body.failure_code, null);
  assert.equal(body.cleanup, 'destroy_acknowledged');
  const o = body.observations;
  verifyRecreatedFilesystem(o.initial_filesystem, o.recreated_filesystem);
  assert.equal(o.distinct_runtime_boot_verified, true);
  await verifyMutation(o.mutations);
  await verifyRestoration(o.restoration);
  assert.deepEqual(o.expected_tree, await treeFor(expectedEntries()));
  for (const name of ['worker_verified_export', 'worker_verified_restored_export', 'old_generation_rejected']) assert.equal(o[name], true);
  assert.equal(o.destroy_before_restore, 'destroy_acknowledged');
  // Reconstruct manifests from the fixed expected bytes, independently of VM output.
  const objects = new Map();
  const files = expectedEntries().map(e => {
    if (e.kind === 'directory') return { path: e.path, kind: e.kind, mode: e.mode };
    const digest = hash(e.bytes); objects.set(`blobs/${digest}`, e.bytes.byteLength);
    return { path: e.path, kind: e.kind, mode: e.mode, digest, size: e.bytes.byteLength };
  });
  const sessionBytes = Buffer.from('M0 synthetic trusted Session; real Pi integration is a separate gate.');
  const session = { digest: hash(sessionBytes), size: sessionBytes.length };
  objects.set(`blobs/${session.digest}`, session.size);
  let parent = null;
  const receipts = [];
  for (const generation of [1, 2]) {
    const bytes = Buffer.from(JSON.stringify({ schema_version: 1, generation, parent, files, session }));
    const revision = hash(bytes); objects.set(`manifests/${revision}`, bytes.length);
    receipts.push({ revision, sequence: generation, generation }); parent = revision;
  }
  assert.deepEqual(o.initial_receipt, receipts[0]);
  assert.deepEqual(o.restored_receipt, receipts[1]);
  assert.deepEqual(o.current_receipt, receipts[1]);
  assert.deepEqual(o.events, receipts);
  const inventory = o.checkpoint_inventory;
  assert.match(inventory.prefix, /^m0-files\/[a-f0-9]{64}\/$/);
  assert.equal(inventory.truncated, false);
  assert.equal(inventory.retention, 'retained-for-recovery-audit; sandbox cleanup does not delete R2 checkpoints');
  const actual = inventory.objects.map(item => {
    assert.ok(item.key.startsWith(inventory.prefix));
    return [item.key.slice(inventory.prefix.length), item.size];
  }).sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(actual, [...objects].sort(([a], [b]) => a.localeCompare(b)));
  return { checksPassed: true, operations: 20, entries: files.length, r2Objects: objects.size, receipts, distinctGuestBoots: true, sessionScope: 'synthetic; real Pi gate separate' };
}

async function main() {
  const deploymentPath = process.argv[2];
  assert.ok(deploymentPath && process.argv.length === 3, 'one deployment manifest path required');
  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf8'));
  assert.equal(deployment.worker, 'riffology-m0-files-staging');
  assert.match(deployment.version, /^[a-f0-9-]{36}$/);
  assert.match(deployment.bundleSha256, /^[a-f0-9]{64}$/);
  const before = sourceSnapshot(root);
  assert.equal(deployment.sourceSha256, before.sha256, 'deployment source differs');
  const token = readProbeSecret(root, '.local/cloud-staging/files.secrets.json');
  const runId = `files-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const directory = resolve(root, 'docs/evidence/runs', `m0-${runId}`);
  mkdirSync(directory, { mode: 0o700 });
  const journal = resolve(directory, 'actions.ndjson');
  writeFileSync(journal, '', { flag: 'wx', mode: 0o600 });
  const began = Date.now(); let requests = 0, bytes = 0;
  const artifact = { schemaVersion: 1, runId, origin, startedAt: new Date(began).toISOString(), deployment, sourceBefore: before, limits, actions: [], checksPassed: false, gate_decision: 'needs-review', modelCalls: 0 };
  function encode(value) { const text = JSON.stringify(value); assert.ok(!text.includes(token), 'secret output refused'); return text; }
  async function once(action, { method = 'GET', body, auth = true, query = '', ms = limits.readMs } = {}) {
    assert.ok(++requests <= limits.requests && Date.now() - began < limits.totalMs, 'request budget');
    const row = { action, method, ordinal: requests, startedAt: new Date().toISOString() };
    try {
      const response = await fetch(`${origin}/probe/${runId}/${action}${query}`, {
        method, body, headers: auth ? { authorization: `Bearer ${token}` } : {}, redirect: 'error',
        signal: AbortSignal.timeout(Math.max(1, Math.min(ms, limits.totalMs - (Date.now() - began)))),
      });
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength; bytes += next.value.byteLength;
          assert.ok(size <= limits.responseBytes && bytes <= limits.totalBytes, 'response budget'); chunks.push(next.value);
        }
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      const raw = Buffer.concat(chunks).toString('utf8');
      Object.assign(row, { status: response.status, body: JSON.parse(raw), bodySha256: hash(raw), cfRay: response.headers.get('cf-ray') });
    } catch (error) {
      row.error = ['TimeoutError', 'AbortError'].includes(error?.name) ? 'request-timeout' : 'request-failed';
      row.outcome = method === 'POST' ? 'unknown-do-not-replay' : 'read-failed';
    }
    row.finishedAt = new Date().toISOString();
    appendFileSync(journal, encode(row) + '\n'); artifact.actions.push(row); return row;
  }
  let started = false;
  try {
    assert.equal((await once('report', { auth: false })).status, 401);
    assert.equal((await once('run')).status, 405);
    assert.equal((await once('run', { method: 'POST', query: '?unexpected=1' })).status, 404);
    assert.equal((await once('run', { method: 'POST', body: '{}' })).status, 400);
    started = true;
    const run = await once('run', { method: 'POST', ms: limits.runMs }); // Never replay this mutation.
    let report = await once('report');
    for (let i = 0; report.status === 202 && i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000)); report = await once('report');
    }
    artifact.report = report.body;
    assert.equal(report.status, 200);
    if (run.status === 200) assert.deepEqual(run.body, report.body, 'saved report changed');
    else assert.ok(run.error || run.status >= 500, 'unexpected run acknowledgement');
    artifact.verification = await verifyFilesReport(report.body);
    artifact.checksPassed = true;
  } catch { artifact.error = 'cloud-probe-or-independent-verification-failed; inspect recorded actions'; }
  finally {
    if (started) artifact.cleanup = await once('cleanup', { method: 'POST', ms: 30000 }).catch(() => ({ error: 'cleanup-not-confirmed' }));
    artifact.sourceAfter = sourceSnapshot(root);
    artifact.sourceStableDuringRun = before.sha256 === artifact.sourceAfter.sha256;
    artifact.checksPassed &&= artifact.sourceStableDuringRun && artifact.cleanup?.status === 200 && artifact.cleanup.body.cleanup === 'destroy_acknowledged';
    Object.assign(artifact, { requests, responseBytes: bytes, elapsedMs: Date.now() - began, finishedAt: new Date().toISOString() });
    writeFileSync(resolve(directory, 'files-cloud.json'), encode(artifact) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ directory, runId, checksPassed: artifact.checksPassed, requests, elapsedMs: artifact.elapsedMs }));
  if (!artifact.checksPassed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
