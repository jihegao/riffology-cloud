import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// Operator starts only the documented localhost Worker. No deployment, container
// startup, arbitrary origin, user source or paid model is accepted by this driver.
const origin = 'http://127.0.0.1:8793';
const token = (await readFile(resolve('infra/.dev.vars.staging'), 'utf8')).match(/^M0_PROBE_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token || token.length < 32) throw new Error('missing-local-probe-token');
const headers = { authorization: `Bearer ${token}` };
const stamp = new Date().toISOString().replaceAll(/[^0-9]/g, '');
const runDir = resolve('docs/evidence/runs', `m0-recovery-${stamp}`);
await mkdir(runDir, { recursive: false, mode: 0o700 });
console.log(JSON.stringify({ runDir, environment: 'local-docker-workerd', cloudGatePassed: false }));
async function request(runId, action) {
  const response = await fetch(`${origin}/probe/${runId}/${action}`, { method: action === 'report' ? 'GET' : 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  return { httpStatus: response.status, body: await response.json() };
}
async function poll(runId, predicate, budget = 190000) {
  const deadline = Date.now() + budget;
  let previous;
  while (Date.now() < deadline) {
    const result = await request(runId, 'report');
    const state = result.body.state;
    const label = `${state?.mode}/${state?.phase}/${state?.cleanup}/${result.body.runtime_status?.stage}`;
    if (label !== previous) { console.log(JSON.stringify({ runId, state: label })); previous = label; }
    if (predicate(result)) return result;
    if (result.httpStatus >= 400) throw new Error(`report-status-${result.httpStatus}`);
    await sleep(750);
  }
  throw new Error('report-observation-timeout');
}
function settled(result) { return result.httpStatus === 200 && ['completed', 'interrupted'].includes(result.body.state?.phase); }
function assertOrdered(events) { assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1)); }
const results = [];
for (const scenario of ['disconnect', 'process', 'container']) {
  const runId = `recovery-${stamp}-${scenario}`;
  const artifact = { schemaVersion: 1, runId, scenario, startedAt: new Date().toISOString(), environment: 'local-docker-workerd', provider: 'local-SSE-fixture', gate_decision: 'not_evaluated', passed: false };
  try {
    artifact.accepted = await request(runId, 'accept');
    assert.equal(artifact.accepted.httpStatus, 202);
    assert.equal(artifact.accepted.body.executionOwner, 'durable-alarm');
    const abort = new AbortController();
    const stream = await fetch(`${origin}/probe/${runId}/events`, { headers, redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /event: turn/);
    const cursor = Number(/^id: (\d+)/m.exec(first)?.[1]);
    assert.ok(cursor >= 1);
    await reader.cancel(); abort.abort();
    artifact.observationDisconnected = { afterSequence: cursor, completedAt: new Date().toISOString() };
    if (scenario !== 'disconnect') {
      artifact.streaming = await poll(runId, result => result.body.state?.phase === 'streaming' && result.body.runtime_status?.generation === 1 && result.body.runtime_status?.stage === 'streaming');
      artifact.fault = await request(runId, `kill-${scenario}`);
      assert.equal(artifact.fault.httpStatus, 202);
      artifact.interrupted = await poll(runId, settled);
      assert.equal(artifact.interrupted.body.state.phase, 'interrupted');
      assert.equal(artifact.interrupted.body.state.cleanup, 'destroy_acknowledged');
      assert.equal(artifact.interrupted.body.state.generation, 2);
      assert.equal(artifact.interrupted.body.current.revision, artifact.interrupted.body.state.seed.revision);
      assert.equal(artifact.interrupted.body.fault_receipt.windowHit, true, 'fault must hit the actual open stream, not a completed Pi turn');
      if (scenario === 'process') assert.equal(artifact.interrupted.body.fault_receipt.killed, true);
      else assert.equal(artifact.interrupted.body.fault_receipt.cleanup, 'destroy_acknowledged');
      artifact.staleEvent = await request(runId, 'late-event');
      assert.equal(artifact.staleEvent.httpStatus, 409);
      assert.deepEqual({ accepted: artifact.staleEvent.body.accepted, stateUnchanged: artifact.staleEvent.body.stateUnchanged, eventCountUnchanged: artifact.staleEvent.body.eventCountUnchanged }, { accepted: false, stateUnchanged: true, eventCountUnchanged: true });
      artifact.recoveryAccepted = await request(runId, 'recover');
      assert.equal(artifact.recoveryAccepted.httpStatus, 202);
      assert.equal(artifact.recoveryAccepted.body.replayInterruptedRequest, false);
    }
    artifact.final = await poll(runId, settled);
    const final = artifact.final.body;
    assert.equal(final.state.phase, 'completed');
    assert.equal(final.state.cleanup, 'destroy_acknowledged');
    assert.equal(final.current.sequence, 2);
    assert.equal(final.current.revision, final.state.final.revision);
    assert.match(final.seed_sha256, /^[a-f0-9]{64}$/);
    assert.match(final.final_sha256, /^[a-f0-9]{64}$/);
    assert.equal(final.runtime_status.requestCount, scenario === 'disconnect' ? 2 : 1);
    if (scenario !== 'disconnect') {
      assert.equal(final.state.mode, 'recovery');
      assert.equal(final.runtime_status.contextSeenOnRecovery, true);
      assert.equal(final.runtime_status.contextRestored, true);
      assert.notEqual(final.runtime_sandbox_id, artifact.interrupted.body.runtime_sandbox_id, 'recovery uses a new physical Sandbox identity');
    }
    assertOrdered(final.events);
    assert.equal(final.events.filter(event => event.kind === 'phase' && event.phase === 'completed').length, 1);
    const reconnect = await fetch(`${origin}/probe/${runId}/events`, { headers: { ...headers, 'last-event-id': String(cursor) }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    assert.equal(reconnect.status, 200);
    const replayed = [...(await reconnect.text()).matchAll(/^data: (.+)$/gm)].map(match => JSON.parse(match[1]));
    assert.deepEqual(replayed, final.events.filter(event => event.sequence > cursor));
    artifact.reconnect = { afterSequence: cursor, replayedSequences: replayed.map(event => event.sequence), exactReplay: true };
    const duplicate = await request(runId, 'accept');
    assert.equal(duplicate.httpStatus, 202);
    const unchanged = await request(runId, 'report');
    assert.deepEqual(unchanged.body.events, final.events);
    assert.deepEqual(unchanged.body.current, final.current);
    artifact.duplicateAccept = { stateUnchanged: true, eventCountUnchanged: true, receiptUnchanged: true };
    artifact.passed = true;
  } catch (error) {
    artifact.error = error instanceof Error ? error.message : 'unknown-error';
    try { artifact.failureReport = await request(runId, 'report'); } catch { artifact.failureReport = { error: 'unavailable' }; }
  } finally {
    try {
      artifact.cleanup = await request(runId, 'cleanup');
      artifact.cleanupFinal = await poll(runId, settled, 90000);
      if (artifact.cleanupFinal.body.state.cleanup !== 'destroy_acknowledged') artifact.passed = false;
    } catch { artifact.passed = false; artifact.cleanupUnconfirmed = true; }
    artifact.finishedAt = new Date().toISOString();
    await writeFile(resolve(runDir, `${scenario}.json`), JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' });
  }
  results.push({ scenario, passed: artifact.passed, error: artifact.error ?? null });
  console.log(JSON.stringify(results.at(-1)));
  if (!artifact.passed) break;
}
const summary = { observedAt: new Date().toISOString(), environment: 'local-docker-workerd', results, passed: results.length === 3 && results.every(result => result.passed), cloudGatePassed: false };
await writeFile(resolve(runDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(summary, null, 2));
if (!summary.passed) process.exitCode = 1;
