import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hash } from './source-inventory.mjs';
import { readProbeSecret } from './storage-cloud.mjs';
import { PROJECT_ISOLATION } from '../../spikes/m0-cloud/runtime.ts';

// T02's project-to-trusted boundary is independent of the ingress upload test.
// This probe does not reclassify a public body-deadline failure as passed.
const deployment = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert.equal(process.argv.length, 3);
assert.equal(deployment.worker, 'riffology-m0-probe-staging');
assert.match(deployment.version, /^[a-f0-9-]{36}$/);
for (const file of deployment.files) assert.equal(hash(readFileSync(file.path)), file.sha256, file.path);
const token = readProbeSecret(process.cwd(), '.local/cloud-staging/boundary.secrets.json');
const origin = 'https://riffology-m0-probe-staging.jihe-gao.workers.dev';
const runId = `isolation-${Date.now()}-${randomBytes(20).toString('hex')}`.slice(0, 47) + '-';
const directory = `docs/evidence/runs/m0-${runId.slice(0, -1)}`;
mkdirSync(directory, { mode: 0o700 });
const files = [...deployment.files, ...['scripts/m0/isolation-cloud.mjs', 'scripts/m0/storage-cloud.mjs', 'scripts/m0/source-inventory.mjs'].map(path => ({ path, sha256: hash(readFileSync(path)) }))];
const began = Date.now(); let requestCount = 0, responseBytes = 0, touched = false;
const artifact = { schemaVersion: 1, startedAt: new Date(began).toISOString(), runId, origin, deployment, sources: files, actions: [], passed: false, gateDecision: 'needs-review', modelCalls: 0, limits: { requests: 5, businessMs: 180000, cleanupMs: 30000, responseBytes: 131072 } };
function safe(value) { const text = JSON.stringify(value); assert.ok(!text.includes(token)); return text; }
async function once(operation, { auth = true, extra = false, cleanup = false } = {}) {
  assert.ok(++requestCount <= artifact.limits.requests);
  const row = { operation, ordinal: requestCount, startedAt: new Date().toISOString() };
  try {
    const budget = cleanup ? 30000 : Math.min(150000, 180000 - (Date.now() - began));
    assert.ok(budget > 0);
    const response = await fetch(`${origin}/probes/${operation}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ run_id: runId, ...(extra ? { command: 'never-executed' } : {}) }), redirect: 'error', signal: AbortSignal.timeout(budget),
    });
    const reader = response.body.getReader(); const chunks = []; let length = 0;
    try { while (true) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; responseBytes += next.value.byteLength; assert.ok(length <= 131072 && responseBytes <= 262144); chunks.push(next.value); } }
    finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    const raw = Buffer.concat(chunks).toString('utf8'); assert.ok(!raw.includes(token));
    Object.assign(row, { httpStatus: response.status, cfRay: response.headers.get('cf-ray'), bodySha256: hash(raw), body: JSON.parse(raw) });
  } catch { row.error = 'request-or-response-failed'; row.outcome = 'unknown-do-not-replay'; }
  row.finishedAt = new Date().toISOString(); artifact.actions.push(row);
  writeFileSync(`${directory}/action-${requestCount}.json`, safe(row) + '\n', { flag: 'wx', mode: 0o600 });
  return row;
}
function destroyed(value) { assert.ok(Object.keys(value).length >= 2); assert.ok(Object.values(value).every(x => x === 'destroy_acknowledged')); }
try {
  assert.equal((await once('isolation', { auth: false })).httpStatus, 401);
  assert.equal((await once('isolation', { extra: true })).httpStatus, 400);
  touched = true;
  const response = await once('isolation'); // One mutation only. Cleanup is independently bounded.
  assert.equal(response.httpStatus, 200);
  const body = response.body; assert.equal(body.run_id, runId); assert.equal(body.operation, 'G0-T02'); assert.equal(body.status, 'observations_collected'); destroyed(body.cleanup);
  const o = body.observations, f = o.worker_verified, p = o.untrusted_project_observations;
  assert.equal(o.isolation_observation_version, 2); assert.equal(o.script_sha256, hash(PROJECT_ISOLATION));
  assert.equal(o.execution_environment, 'cloudflare-vm');
  assert.equal(o.topology, 'separate_trusted_and_project_sandbox_instances');
  const required = ['trusted_canary_unchanged', 'synthetic_session_unchanged', 'trusted_service_running', 'signal_positive_control_delivered', 'trusted_signal_count_unchanged', 'trusted_control_mutation_count_unchanged', 'trusted_service_instance_unchanged', 'trusted_service_health_matches', 'trusted_cross_scope_file_unchanged', 'trusted_attack_marker_absent', 'project_sdk_positive_control_observed'];
  for (const name of required) assert.equal(f[name], true, name);
  assert.equal(f.trusted_signal_count_before, 1); assert.equal(f.trusted_signal_count_after, 1); assert.equal(f.trusted_service_status, 'running');
  assert.equal(f.observed_canary_sha256, f.expected_canary_sha256); assert.equal(f.observed_cross_scope_sha256, f.expected_canary_sha256); assert.equal(f.observed_positive_marker_sha256, f.expected_positive_marker_sha256);
  assert.deepEqual(p.trusted_paths_readable, []); assert.deepEqual(p.platform_secret_variable_names_present, []);
  for (const name of ['trusted_marker_in_process_environment', 'trusted_marker_in_process_command', 'trusted_ipc_connectable', 'trusted_loopback_control_connectable']) assert.equal(p[name], false, name);
  assert.equal(p.own_sdk_control_http_reachable, true); assert.equal(p.raw_signal.identity_matched, false); assert.equal(p.raw_signal.attempted, false); assert.ok(['target_not_addressable', 'permission_denied'].includes(p.raw_signal.outcome));
  assert.equal(f.trusted_boot_identity_unchanged, true);
  assert.match(f.trusted_boot_id_sha256, /^[a-f0-9]{64}$/);
  assert.equal(p.raw_signal.target_boot_id_sha256, f.trusted_boot_id_sha256);
  assert.match(p.raw_signal.local_boot_id_sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(p.raw_signal.local_boot_id_sha256, f.trusted_boot_id_sha256);
  assert.equal(p.raw_signal.kernel_identity_matched, false);
  const sdk = p.sdk_control_attempts;
  assert.deepEqual(sdk.map(x => x.name), ['own_sdk_write', 'foreign_session_read', 'foreign_session_write', 'forged_sandbox_write', 'foreign_process_read', 'foreign_process_signal_rpc']);
  for (const row of sdk) { assert.equal(row.trusted_marker_returned, false); assert.equal(row.response_truncated, false); assert.ok(Number.isInteger(row.http_status) && row.http_status >= 100 && row.http_status < 600); }
  assert.equal(sdk[0].http_status, 200); assert.equal(sdk[0].sdk_success, true);
  for (const name of ['foreign_session_read', 'foreign_process_read', 'foreign_process_signal_rpc']) { const row = sdk.find(x => x.name === name); assert.ok(row.http_status >= 400 && row.sdk_success !== true); }
  artifact.projectLocalWrites = [];
  for (const [name, confined, observed] of [['foreign_session_write', 'project_foreign_session_write_confined', 'observed_foreign_session_marker_sha256'], ['forged_sandbox_write', 'project_forged_scope_write_confined', 'observed_forged_marker_sha256']]) {
    const row = sdk.find(x => x.name === name);
    if (row.http_status >= 400 && row.sdk_success !== true) artifact.projectLocalWrites.push({ name, outcome: 'rejected' });
    else { assert.equal(f[confined], true); assert.equal(f[observed], f.expected_attack_marker_sha256); artifact.projectLocalWrites.push({ name, outcome: 'project-only-write; trusted target unchanged', httpStatus: row.http_status }); }
  }
  assert.deepEqual(p.control_http_attempts.map(x => x.name), ['trusted_loopback_control', 'cross_domain_control_rpc']);
  for (const row of p.control_http_attempts) assert.ok(row.http_status === null || row.http_status >= 400);
  artifact.verification = { trustedPreservationChecks: required.length, projectSdkRequests: sdk.length, rawSignal: p.raw_signal.outcome, controlHttpRequests: p.control_http_attempts.length, trustedSensitiveReads: 0, crossVmControlEffects: 0 };
  artifact.passed = true;
} catch { artifact.error = 'cloud-isolation-or-independent-verification-failed; inspect action receipts'; }
finally {
  if (touched) { artifact.cleanup = await once('cleanup', { cleanup: true }); try { assert.equal(artifact.cleanup.httpStatus, 200); destroyed(artifact.cleanup.body.cleanup); } catch { artifact.passed = false; } }
  artifact.sourceStable = files.every(file => hash(readFileSync(file.path)) === file.sha256);
  artifact.passed &&= artifact.sourceStable;
  Object.assign(artifact, { finishedAt: new Date().toISOString(), elapsedMs: Date.now() - began, requestCount, responseBytes });
  writeFileSync(`${directory}/isolation-cloud.json`, safe(artifact) + '\n', { flag: 'wx', mode: 0o600 });
}
console.log(JSON.stringify({ directory, runId, passed: artifact.passed, elapsedMs: artifact.elapsedMs, requestCount }));
if (!artifact.passed) process.exitCode = 1;
