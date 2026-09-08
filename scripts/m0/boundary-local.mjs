import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { resolve } from 'node:path';
import { hash, sourceSnapshot } from './source-inventory.mjs';

// The operator starts the documented local Worker. This driver neither starts
// services nor accepts an alternate origin, command, credentials or project code.
export function deadlineBudget(kind, now, businessDeadline, cleanupDeadlineValue, maxRequestMs = 180_000) {
  const deadline = kind === 'cleanup' ? cleanupDeadlineValue : businessDeadline;
  const remainingMs = deadline - now;
  if (remainingMs <= 0) return null;
  return { remainingMs, timeoutMs: Math.min(maxRequestMs, remainingMs) };
}

export function safeDeadlineBody(body) {
  // The positive route can issue a capability when this negative probe fails.
  // Never persist that credential or any unexpected provider response fields.
  return {
    ...(body?.error === 'invalid_body' ? { error: 'invalid_body' } : {}),
    fixtureOnly: body?.fixture_only === true,
    capabilityIssued: typeof body?.capability === 'string' && body.capability.length > 0,
  };
}

export async function runBoundaryProbe({ origin, token, environment, runPrefix = 'm0-boundary', outputName = 'boundary-local.json', deployment, totalRuntimeLimitMs = 600_000 }) {
  if (!/^https?:\/\//.test(origin)) throw new Error('invalid-probe-origin');
  if (!token || token.length < 32) throw new Error('missing-probe-token');
  const root = process.cwd();
  const stamp = new Date().toISOString().replaceAll(/[^0-9]/g, '');
  const runDir = resolve('docs/evidence/runs', `${runPrefix}-${stamp}`);
  await mkdir(runDir, { recursive: false, mode: 0o700 });

function sources() {
  const snapshot = sourceSnapshot(root);
  const files = snapshot.files.filter(file => file.path.startsWith('spikes/m0-cloud/') || file.path.startsWith('services/runtime/') || [
    'scripts/m0/boundary-local.mjs', 'scripts/m0/boundary-cloud.mjs', 'scripts/m0/source-inventory.mjs', 'infra/wrangler.m0.jsonc',
    'infra/m0-trusted.Dockerfile', 'infra/m0-project.Dockerfile', 'package.json', 'package-lock.json',
    'tsconfig.json', '.dockerignore', '.gitignore',
  ].includes(file.path));
  return { sha256: hash(JSON.stringify(files)), files, repositorySourceSha256: snapshot.sha256 };
}
const before = sources();
const result = {
  schemaVersion: 1, startedAt: new Date().toISOString(), environment,
  origin, gate_decision: 'not_evaluated', cloudGatePassed: false, passed: false,
  sourcesBefore: before, cases: [], cleanup: [],
};
if (deployment) result.deployment = deployment;
console.log(JSON.stringify({ runDir, environment: result.environment, cloudGatePassed: false }));
const touchedRuns = [];
const totalDeadline = Date.now() + totalRuntimeLimitMs;
let cleanupDeadline = null;
const requestFn = origin.startsWith('https:') ? httpsRequest : httpRequest;

async function request(path, body, credential = token, { cleanup = false } = {}) {
  const budget = deadlineBudget(cleanup ? 'cleanup' : 'business', Date.now(), totalDeadline, cleanupDeadline);
  if (!budget) throw new Error(cleanup ? 'cleanup-budget-exhausted' : 'probe-total-timeout');
  const headers = { 'content-type': 'application/json' };
  if (credential) headers.authorization = `Bearer ${credential}`;
  const response = await fetch(`${origin}${path}`, {
    method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(budget.timeoutMs),
  });
  if (!response.body) throw new Error('missing-probe-response');
  const reader = response.body.getReader();
  const parts = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 131072) { await reader.cancel(); throw new Error('oversized-probe-response'); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return { httpStatus: response.status, body: JSON.parse(Buffer.concat(parts).toString('utf8')) };
}

function confirmedCleanup(cleanup) {
  assert.ok(cleanup && typeof cleanup === 'object');
  assert.ok(Object.keys(cleanup).length >= 2);
  for (const value of Object.values(cleanup)) assert.equal(value, 'destroy_acknowledged');
}

function isolationAssertions(body) {
  assert.equal(body.operation, 'G0-T02');
  assert.equal(body.observations.isolation_observation_version, 2);
  const facts = body.observations.worker_verified;
  for (const field of [
    'trusted_canary_unchanged', 'synthetic_session_unchanged', 'trusted_service_running',
    'signal_positive_control_delivered', 'trusted_signal_count_unchanged',
    'trusted_control_mutation_count_unchanged', 'trusted_service_instance_unchanged',
    'trusted_service_health_matches', 'trusted_cross_scope_file_unchanged',
    'trusted_attack_marker_absent', 'project_sdk_positive_control_observed',
  ]) assert.equal(facts[field], true, field);
  assert.equal(facts.trusted_service_status, 'running');
  assert.equal(facts.trusted_signal_count_before, 1);
  assert.equal(facts.trusted_signal_count_after, 1);
  for (const field of ['expected_canary_sha256', 'expected_positive_marker_sha256', 'expected_attack_marker_sha256']) assert.match(facts[field], /^[a-f0-9]{64}$/);
  assert.equal(facts.observed_canary_sha256, facts.expected_canary_sha256);
  assert.equal(facts.observed_cross_scope_sha256, facts.expected_canary_sha256);
  assert.equal(facts.observed_positive_marker_sha256, facts.expected_positive_marker_sha256);
  assert.match(body.observations.script_sha256, /^[a-f0-9]{64}$/);
  const diagnostic = body.observations.untrusted_project_observations;
  assert.equal(diagnostic.isolation_observation_version, 2);
  assert.deepEqual(diagnostic.trusted_paths_readable, []);
  assert.deepEqual(diagnostic.platform_secret_variable_names_present, []);
  for (const key of ['trusted_marker_in_process_environment', 'trusted_marker_in_process_command', 'trusted_ipc_connectable', 'trusted_loopback_control_connectable']) assert.equal(diagnostic[key], false, key);
  assert.equal(diagnostic.own_sdk_control_http_reachable, true);
  assert.equal(diagnostic.raw_signal.signal, 'SIGUSR1');
  assert.equal(diagnostic.raw_signal.identity_matched, false, 'the trusted process must not be in the project PID namespace');
  assert.equal(diagnostic.raw_signal.attempted, false);
  assert.ok(['target_not_addressable', 'permission_denied'].includes(diagnostic.raw_signal.outcome));
  const sdk = diagnostic.sdk_control_attempts;
  assert.deepEqual(sdk.map(row => row.name), ['own_sdk_write', 'foreign_session_read', 'foreign_session_write', 'forged_sandbox_write', 'foreign_process_read', 'foreign_process_signal_rpc']);
  for (const row of sdk) {
    assert.equal(row.trusted_marker_returned, false, row.name);
    assert.equal(row.response_truncated, false, row.name);
    assert.ok(Number.isInteger(row.http_status) && row.http_status >= 100 && row.http_status < 600, `${row.name} must reach the live local SDK`);
  }
  assert.equal(sdk[0].sdk_success, true);
  assert.equal(sdk[0].http_status, 200);
  for (const name of ['foreign_session_read', 'foreign_process_read', 'foreign_process_signal_rpc']) {
    const row = sdk.find(row => row.name === name);
    assert.ok(row.http_status >= 400 && row.sdk_success !== true, `${name} must not report successful control`);
  }
  const foreignWrite = sdk.find(row => row.name === 'foreign_session_write');
  assert.ok(facts.project_foreign_session_write_confined === true || (foreignWrite.http_status >= 400 && foreignWrite.sdk_success !== true), 'foreign session write must be rejected or independently verified inside the project Sandbox');
  if (facts.project_foreign_session_write_confined) assert.equal(facts.observed_foreign_session_marker_sha256, facts.expected_attack_marker_sha256);
  const forged = sdk.find(row => row.name === 'forged_sandbox_write');
  assert.ok(facts.project_forged_scope_write_confined === true || (forged.http_status >= 400 && forged.sdk_success !== true), 'forged scope must be rejected or write only inside the project Sandbox');
  if (facts.project_forged_scope_write_confined) assert.equal(facts.observed_forged_marker_sha256, facts.expected_attack_marker_sha256);
  const http = diagnostic.control_http_attempts;
  assert.deepEqual(http.map(row => row.name), ['trusted_loopback_control', 'cross_domain_control_rpc']);
  for (const row of http) assert.ok(row.http_status === null || row.http_status >= 400, `${row.name} must not succeed`);
}

// Complete valid JSON after the Worker body deadline. Miniflare's HTTP proxy
// withholds the response until upload completion, so early delivery is not the
// assertion. The capabilities route never allocates a Sandbox, even on failure.
function slowBodyGuard() {
  return new Promise((resolveRequest, reject) => {
    if (Date.now() >= totalDeadline) return reject(new Error('probe-total-timeout'));
    const started = Date.now();
    let finishUpload;
    let firstChunkFlushedAt;
    let completionAt;
    const req = requestFn(`${origin}/probes/capabilities`, { method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json', 'transfer-encoding': 'chunked',
    } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(new Error('oversized-guard-response')); });
      res.on('error', reject);
      res.on('end', () => {
        clearTimeout(timeout); clearTimeout(finishUpload);
        try { resolveRequest({ httpStatus: res.statusCode, body: safeDeadlineBody(JSON.parse(body)), elapsedMs: Date.now() - started, uploadCompletionDelayMs: 2100, firstChunkFlushedAfterMs: firstChunkFlushedAt === undefined ? null : firstChunkFlushedAt - started, completionAfterFirstChunkMs: completionAt === undefined || firstChunkFlushedAt === undefined ? null : completionAt - firstChunkFlushedAt, responseDeliveryBeforeUploadEndRequired: false }); }
        catch { reject(new Error('invalid-guard-response')); }
        req.destroy();
      });
    });
    const timeout = setTimeout(() => req.destroy(new Error('slow-body-guard-timeout')), Math.min(5000, Math.max(1, totalDeadline - Date.now())));
    req.on('error', error => { clearTimeout(timeout); clearTimeout(finishUpload); reject(error); });
    req.write('{"run_id":"deadline-guard","tenant":"alpha",', error => {
      if (error) { req.destroy(error); return; }
      // Start the body delay after the first write has flushed, so connecting
      // through a TLS proxy cannot consume the intended server-side gap.
      firstChunkFlushedAt = Date.now();
      finishUpload = setTimeout(() => { completionAt = Date.now(); req.end('"kind":"file"}'); }, 2100);
    });
  });
}

try {
  const invalidRun = 'boundary-invalid';
  const guards = [
    { name: 'missing-auth', path: '/probes/isolation', body: { run_id: invalidRun }, credential: '', status: 401 },
    { name: 'wrong-auth', path: '/probes/isolation', body: { run_id: invalidRun }, credential: randomBytes(32).toString('hex'), status: 401 },
    { name: 'query', path: '/probes/isolation?unexpected=1', body: { run_id: invalidRun }, status: 400 },
    { name: 'extra-field', path: '/probes/isolation', body: { run_id: invalidRun, command: 'not-executed' }, status: 400 },
    { name: 'overlong-id', path: '/probes/isolation', body: { run_id: 'a'.repeat(49) }, status: 400 },
    { name: 'malformed-json', path: '/probes/isolation', body: '{', status: 400 },
  ];
  for (const guard of guards) {
    const response = await request(guard.path, guard.body, guard.credential);
    result.cases.push({ name: guard.name, expectedStatus: guard.status, response });
    assert.equal(response.httpStatus, guard.status, guard.name);
  }
  const completeBody = await request('/probes/capabilities', { run_id: 'deadline-guard', tenant: 'alpha', kind: 'file' });
  const capabilityIssued = typeof completeBody.body.capability === 'string' && completeBody.body.capability.length > 0;
  result.cases.push({ name: 'complete-body-positive-control', expectedStatus: 200,
    response: { httpStatus: completeBody.httpStatus, fixtureOnly: completeBody.body.fixture_only === true, capabilityIssued } });
  assert.equal(completeBody.httpStatus, 200);
  assert.equal(capabilityIssued, true);
  const slowBody = await slowBodyGuard();
  result.cases.push({ name: 'streaming-body-deadline', expectedStatus: 400, response: slowBody });
  assert.equal(slowBody.httpStatus, 400);
  assert.equal(slowBody.body.error, 'invalid_body');
  assert.ok(slowBody.elapsedMs < 5000);
  for (const operation of ['isolation', 'tenancy']) {
    // Exercise both SDK ID edges in the actual run: maximum input length and a
    // trailing hyphen, which the public run contract accepts.
    const runId = `${`boundary-${stamp}-${randomBytes(16).toString('hex')}`.slice(0, 47)}-`;
    assert.equal(runId.length, 48);
    touchedRuns.push(runId);
    console.log(JSON.stringify({ operation, runId, state: 'dispatching-once' }));
    const response = await request(`/probes/${operation}`, { run_id: runId });
    const entry = { name: operation, runId, response, passed: false };
    result.cases.push(entry);
    assert.equal(response.httpStatus, 200, operation);
    assert.equal(response.body.status, 'observations_collected');
    assert.equal(response.body.gate_decision, 'not_evaluated');
    confirmedCleanup(response.body.cleanup);
    if (operation === 'isolation') isolationAssertions(response.body);
    else {
      const facts = response.body.observations.worker_verified;
      assert.equal(facts.alpha_content_matches, true);
      assert.equal(facts.bravo_content_matches, true);
      assert.equal(facts.contents_differ, true);
    }
    entry.passed = true;
    console.log(JSON.stringify({ operation, passed: true }));
  }
  result.passed = true;
} catch (error) {
  // Do not mirror arbitrary transport or platform exceptions, which may contain
  // authentication material; preserve only a fixed class and assertion label.
  result.error = error instanceof assert.AssertionError ? { kind: 'assertion-failed', message: error.message.slice(0, 250) } : { kind: 'probe-or-transport-failed' };
} finally {
  cleanupDeadline = Date.now() + 60_000;
  for (const runId of touchedRuns) {
    try {
      const response = await request('/probes/cleanup', { run_id: runId }, token, { cleanup: true });
      result.cleanup.push({ runId, response });
      assert.equal(response.httpStatus, 200);
      confirmedCleanup(response.body.cleanup);
    } catch {
      result.passed = false;
      result.cleanup.push({ runId, cleanup: 'not-confirmed' });
    }
  }
  result.sourcesAfter = sources();
  result.probeSourceStableDuringRun = result.sourcesAfter.sha256 === before.sha256;
  if (!result.probeSourceStableDuringRun) result.passed = false;
  result.finishedAt = new Date().toISOString();
  result.limits = [
    environment.includes('cloud') ? 'Staging cloud reports are diagnostic and do not close the G0 gate.' : 'Local Docker/Workerd is not a cloud VM isolation gate.',
    'Project reports are diagnostic; the Worker performs independent preservation checks.',
    'Cleanup acknowledgement does not prove a timed-out operation or all development proxy helpers have terminated.',
    'This probe uses synthetic sessions and identities, with no paid model or production login.',
    `The ${origin.startsWith('https:') ? 'HTTPS' : 'HTTP'} proxy delivers the body-deadline rejection after upload completion; early response delivery is not established.`,
    `Total runtime is bounded at ${totalRuntimeLimitMs}ms.`,
  ];
  await writeFile(resolve(runDir, outputName), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ runDir, passed: result.passed, probeSourceStableDuringRun: result.probeSourceStableDuringRun, cloudGatePassed: false }));
if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const localToken = (await readFile(resolve('infra/.dev.vars.staging'), 'utf8')).match(/^M0_PROBE_TOKEN=(.+)$/m)?.[1]?.trim();
  try {
    await runBoundaryProbe({ origin: 'http://127.0.0.1:8789', token: localToken, environment: 'local-docker-workerd' });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'probe-failed');
    process.exitCode = 1;
  }
}
