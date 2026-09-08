import assert from 'node:assert/strict';
import test from 'node:test';
import { boundarySandboxId, issueCapability, objectId, RESOURCE_KINDS, verifyCapability } from './auth.ts';
import { handleProbeRequest, type ProbeOperations } from './worker.ts';

const SECRET = 'm0-unit-test-only-secret-not-for-deployment-123456';
const RUN = 'test-run-20260905';
const env = { M0_PROBE_TOKEN: SECRET, ENVIRONMENT: 'staging', PROTOCOL_VERSION: 'm0-v1' };
function harness() {
  const calls: string[] = [];
  const operations = Object.fromEntries(['isolation', 'tenancy', 'egress', 'cleanup'].map(name => [name, async (run: string) => { calls.push(`${name}:${run}`); return { gate_decision: 'not_evaluated' }; }])) as unknown as ProbeOperations;
  return { operations, calls };
}
function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://probe.invalid${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${SECRET}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}

test('health exposes only static non-sensitive version metadata without starting a VM', async () => {
  const h = harness();
  const response = await handleProbeRequest(new Request('https://probe.invalid/health'), {}, h.operations);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { service: 'riffology-m0-probe', protocol: 'm0-v1', sandbox_sdk: '0.12.9', product_backend: false });
  assert.deepEqual(h.calls, []);
});

test('missing, incorrect and weak credentials fail before any VM allocation', async () => {
  const h = harness();
  for (const header of ['', 'Bearer wrong-secret', `Basic ${SECRET}`, `Bearer ${SECRET}extra`, `Bearer ${'a'.repeat(2000)}`]) {
    assert.equal((await handleProbeRequest(request('/probes/isolation', { run_id: RUN }, { authorization: header }), env, h.operations)).status, 401);
  }
  assert.equal((await handleProbeRequest(request('/probes/isolation', { run_id: RUN }), { ...env, M0_PROBE_TOKEN: 'short' }, h.operations)).status, 401);
  assert.deepEqual(h.calls, []);
});

test('probe refuses production or mismatched protocol configuration', async () => {
  const h = harness();
  for (const badEnv of [{ ...env, ENVIRONMENT: 'production' }, { ...env, PROTOCOL_VERSION: 'm0-v2' }]) {
    assert.equal((await handleProbeRequest(request('/probes/isolation', { run_id: RUN }), badEnv, h.operations)).status, 503);
  }
  assert.deepEqual(h.calls, []);
});

test('only predefined operation and constrained run ID are accepted', async () => {
  const h = harness();
  for (const body of [{ run_id: '../other-tenant' }, { run_id: RUN, sandbox_id: 'other' }, { run_id: RUN, command: 'echo unsafe' }, { run_id: 'x'.repeat(49) }, { run_id: RUN, extra: null }]) {
    assert.equal((await handleProbeRequest(request('/probes/isolation', body), env, h.operations)).status, 400);
  }
  assert.equal((await handleProbeRequest(request('/probes/exec', { run_id: RUN }), env, h.operations)).status, 404);
  assert.equal((await handleProbeRequest(request('/probes/isolation?token=bad', { run_id: RUN }), env, h.operations)).status, 400);
  assert.deepEqual(h.calls, []);
  assert.equal((await handleProbeRequest(request('/probes/isolation', { run_id: RUN }), env, h.operations)).status, 200);
  assert.deepEqual(h.calls, [`isolation:${RUN}`]);
});

test('oversized JSON, malformed JSON and absent content type are rejected without side effects', async () => {
  const h = harness();
  const inputs = [request('/probes/egress', { run_id: RUN, padding: 'x'.repeat(1024) }), new Request('https://probe.invalid/probes/egress', { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: '{' }), request('/probes/egress', { run_id: RUN }, { 'content-type': 'text/plain' })];
  for (const input of inputs) assert.equal((await handleProbeRequest(input, env, h.operations)).status, 400);
  assert.deepEqual(h.calls, []);
});

test('a stalled request body has a total deadline and cannot block cancellation or allocate a VM', { timeout: 5000 }, async () => {
  const h = harness();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"run_id":"')); },
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  });
  const input = new Request('https://probe.invalid/probes/isolation', {
    method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const started = Date.now();
  const response = await handleProbeRequest(input, env, h.operations);
  assert.equal(response.status, 400);
  assert.equal(cancelled, true);
  assert.ok(Date.now() - started < 4000);
  assert.deepEqual(h.calls, []);
});

const BODY_OBSERVATION = 'x-m0-body-read-observation';
function observation(response: Response): Record<string, number | string> {
  const value = response.headers.get(BODY_OBSERVATION);
  assert.ok(value);
  const parsed = JSON.parse(value) as Record<string, number | string>;
  assert.deepEqual(Object.keys(parsed).sort(), ['version', 'authMs', 'readStartMs', 'firstReadMs', 'eofMs', 'timerMs', 'chunks', 'bytes', 'outcome'].sort());
  for (const [key, field] of Object.entries(parsed)) if (key !== 'outcome') {
    assert.equal(typeof field, 'number');
    assert.ok(Number.isInteger(field) && Number(field) >= -1);
  }
  return parsed;
}
function controlledCapabilityBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let readStarted!: () => void;
  const reading = new Promise<void>(resolve => { readStarted = resolve; });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    pull() { readStarted(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const input = new Request('https://probe.invalid/probes/capabilities', {
    method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  return { input, reading, controller, cancelled: () => cancelled };
}

test('body observations are fixed metadata on only the authorized capability route', async () => {
  const h = harness();
  const valid = { run_id: RUN, tenant: 'alpha', kind: 'file' };
  const response = await handleProbeRequest(request('/probes/capabilities', valid), env, h.operations);
  assert.equal(response.status, 200);
  const metrics = observation(response);
  assert.equal(metrics.outcome, 'complete');
  assert.equal(metrics.bytes, new TextEncoder().encode(JSON.stringify(valid)).byteLength);
  assert.equal(metrics.timerMs, -1);
  assert.ok(Number(metrics.eofMs) >= Number(metrics.readStartMs));
  const payload = await response.json() as { capability: string };
  assert.ok(!response.headers.get(BODY_OBSERVATION)!.includes(payload.capability));
  assert.ok(!response.headers.get(BODY_OBSERVATION)!.includes(SECRET));
  const reflected = 'must-not-appear-in-observation';
  const invalid = await handleProbeRequest(request('/probes/capabilities', { ...valid, diagnostic: reflected }, { [BODY_OBSERVATION]: reflected }), env, h.operations);
  assert.equal(invalid.status, 400);
  assert.equal(observation(invalid).outcome, 'complete');
  assert.ok(!invalid.headers.get(BODY_OBSERVATION)!.includes(reflected));
  for (const [input, config] of [
    [request('/probes/capabilities', valid, { authorization: '' }), env],
    [request('/probes/capabilities', valid, { authorization: 'Bearer project-fixture-capability' }), env],
    [request('/probes/capabilities', valid), { ...env, ENVIRONMENT: 'production' }],
    [request('/probes/capabilities?diagnostic=1', valid), env],
    [request('/probes/isolation', { run_id: RUN }), env],
    [request('/probes/capabilities'), env],
  ] as const) assert.equal((await handleProbeRequest(input, config, h.operations)).headers.get(BODY_OBSERVATION), null);
  assert.deepEqual(h.calls, [`isolation:${RUN}`]);
});

test('completed valid JSON clears its body timer', { timeout: 3000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clearTimer = t.mock.method(globalThis, 'clearTimeout');
  const h = harness();
  const stream = controlledCapabilityBody();
  const pending = handleProbeRequest(stream.input, env, h.operations);
  await stream.reading;
  t.mock.timers.tick(900);
  stream.controller.enqueue(new TextEncoder().encode(JSON.stringify({ run_id: RUN, tenant: 'alpha', kind: 'file' })));
  stream.controller.close();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(observation(response).outcome, 'complete');
  assert.equal(observation(response).timerMs, -1);
  assert.equal(clearTimer.mock.callCount(), 1);
  assert.notEqual(clearTimer.mock.calls[0]!.arguments[0], undefined);
  t.mock.timers.tick(1000);
  assert.equal(stream.cancelled(), false);
  assert.deepEqual(h.calls, []);
});

test('the body deadline wins when valid JSON arrives after expiry', { timeout: 3000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const stream = controlledCapabilityBody();
  const pending = handleProbeRequest(stream.input, env, h.operations);
  await stream.reading;
  t.mock.timers.tick(1000);
  // Resolve the pending read in the same turn, after the deadline rejection.
  stream.controller.enqueue(new TextEncoder().encode(JSON.stringify({ run_id: RUN, tenant: 'alpha', kind: 'file' })));
  stream.controller.close();
  const response = await pending;
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_body' });
  assert.equal(observation(response).outcome, 'deadline');
  assert.notEqual(observation(response).timerMs, -1);
  assert.equal(observation(response).eofMs, -1);
  assert.deepEqual(h.calls, []);
});

test('received chunks do not reset the total body deadline', { timeout: 3000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const stream = controlledCapabilityBody();
  const pending = handleProbeRequest(stream.input, env, h.operations);
  await stream.reading;
  for (const fragment of ['{', ' ', ' ']) {
    t.mock.timers.tick(300);
    stream.controller.enqueue(new TextEncoder().encode(fragment));
    // Let Promise.race consume each chunk and start the following read.
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  t.mock.timers.tick(100);
  const response = await pending;
  assert.equal(response.status, 400);
  const metrics = observation(response);
  assert.equal(metrics.outcome, 'deadline');
  assert.equal(metrics.chunks, 3);
  assert.equal(metrics.bytes, 3);
  assert.equal(stream.cancelled(), true);
  assert.deepEqual(h.calls, []);
});

test('size and JSON failures are distinguishable from a body deadline without reflecting input', async () => {
  const h = harness();
  for (const [text, outcome] of [['x'.repeat(1025), 'size_limit'], ['{private-diagnostic-value', 'invalid_json']] as const) {
    const input = new Request('https://probe.invalid/probes/capabilities', {
      method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: text,
    });
    const response = await handleProbeRequest(input, env, h.operations);
    assert.equal(response.status, 400);
    const metrics = observation(response);
    assert.equal(metrics.outcome, outcome);
    assert.equal(metrics.timerMs, -1);
    assert.ok(!response.headers.get(BODY_OBSERVATION)!.includes(text));
  }
  assert.deepEqual(h.calls, []);
});

const INTERNAL_BODY_PATH = '/probes/body-reader-diagnostics';
function internalBodyRequest(headers: Record<string, string> = {}) {
  return new Request(`https://probe.invalid${INTERNAL_BODY_PATH}`, { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, ...headers } });
}
test('internal body diagnostics cannot bypass operator, staging, method or parameter guards', async t => {
  const h = harness();
  const timers = t.mock.method(globalThis, 'setTimeout');
  const inputs = [
    [internalBodyRequest({ authorization: '' }), env, 401],
    [internalBodyRequest({ authorization: 'Bearer fixture-project-capability' }), env, 401],
    [internalBodyRequest(), { ...env, ENVIRONMENT: 'production' }, 503],
    [internalBodyRequest(), { ...env, PROTOCOL_VERSION: 'different' }, 503],
    [request(INTERNAL_BODY_PATH), env, 404],
    [new Request(`https://probe.invalid${INTERNAL_BODY_PATH}?delay=0`, { method: 'POST', headers: { authorization: `Bearer ${SECRET}` } }), env, 400],
    [request(INTERNAL_BODY_PATH, {}), env, 400],
    [request(INTERNAL_BODY_PATH, { body: 'private-marker', delay: 0, url: 'https://outside.invalid/' }), env, 400],
    [internalBodyRequest({ 'content-length': '5' }), env, 400],
    [internalBodyRequest({ 'transfer-encoding': 'chunked' }), env, 400],
  ] as const;
  for (const [input, config, expected] of inputs) {
    const response = await handleProbeRequest(input, config, h.operations);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get(BODY_OBSERVATION), null);
    assert.ok(!await response.text().then(value => value.includes('private-marker') || value.includes(SECRET)));
  }
  assert.ok(timers.mock.calls.every(call => call.arguments[1] === 1000), 'only ingress read deadline, never diagnostic source/watchdog timers');
  assert.deepEqual(h.calls, []);
});

test('diagnostic ingress accepts EOF streams and rejects stalled bodies without awaiting cancellation', { timeout: 4000 }, async () => {
  const h = harness();
  const closed = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const stalled = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } });
  for (const [body, expected] of [[closed, 200], [stalled, 400]] as const) {
    const input = new Request(`https://probe.invalid${INTERNAL_BODY_PATH}`, {
      method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-length': '0' }, body, duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const began = Date.now();
    const response = await handleProbeRequest(input, env, h.operations);
    assert.equal(response.status, expected);
    assert.ok(Date.now() - began < 2000);
    assert.equal(body.locked, false);
  }
  assert.deepEqual(h.calls, []);
});

test('internal fixed streams exercise the real reader deadline and clean all timers and locks', { timeout: 4000 }, async t => {
  const h = harness();
  const scheduled = t.mock.method(globalThis, 'setTimeout');
  const cleared = t.mock.method(globalThis, 'clearTimeout');
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected-network-call'); });
  const response = await handleProbeRequest(internalBodyRequest({ 'content-length': '0' }), env, h.operations);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes(SECRET) && !text.includes('"probe"') && !text.includes('invalid/'));
  const value = JSON.parse(text);
  assert.equal(value.scope, 'cloud-internal-handler');
  assert.equal(value.public_ingress_deadline, 'not_validated');
  assert.equal(value.gate_decision, 'not_evaluated');
  assert.equal(value.status, 'expected_observations_collected');
  assert.equal(value.bodyDeadlineMs, 1000);
  assert.equal(value.totalLimitMs, 2500);
  assert.equal(value.totalDeadlineFired, 0);
  assert.equal(value.vmCalls + value.modelCalls + value.capabilitiesIssued, 0);
  assert.deepEqual(value.cases.map((row: { scenario: string }) => row.scenario), ['complete', 'drip', 'stalled']);
  const [complete, drip, stalled] = value.cases;
  assert.equal(complete.parseResult, 'accepted');
  assert.equal(complete.fixedValueMatched, 1);
  assert.equal(complete.observation.timerMs, -1);
  assert.equal(complete.cleanup.sourceState, 'closed');
  for (const row of [drip, stalled]) {
    assert.equal(row.parseResult, 'rejected');
    assert.equal(row.observation.outcome, 'deadline');
    assert.equal(row.observation.eofMs, -1);
    assert.ok(row.observation.timerMs >= 900 && row.observation.timerMs < 2500);
    assert.equal(row.cleanup.sourceState, 'cancelled');
  }
  assert.equal(drip.observation.chunks, 4);
  assert.equal(stalled.observation.chunks, 1);
  for (const row of value.cases) {
    assert.equal(row.cleanup.pendingSourceTimers, 0);
    assert.equal(row.cleanup.streamLocked, 0);
  }
  // Clear all three reader timers, the total watchdog, and the unsent drip tail.
  const owned = scheduled.mock.calls.filter(call => [1000, 1200, 2500].includes(Number(call.arguments[1]))).map(call => call.result);
  for (const timer of owned) assert.ok(cleared.mock.calls.some(call => call.arguments[0] === timer));
  assert.equal(network.mock.callCount(), 0);
  assert.deepEqual(h.calls, []);
});

test('internal diagnostic total watchdog terminates owned streams when reader timers do not fire', { timeout: 3000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = globalThis.setTimeout;
  let readersStarted = 0;
  // Deliberate timer fault: leave reader timeouts pending beyond the watchdog.
  t.mock.method(globalThis, 'setTimeout', (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay === 1000) readersStarted++;
    return original(callback, delay === 1000 ? 10000 : delay, ...args);
  });
  const h = harness();
  const pending = handleProbeRequest(internalBodyRequest(), env, h.operations);
  for (let attempt = 0; readersStarted < 3 && attempt < 100; attempt++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(readersStarted, 3);
  t.mock.timers.tick(2500);
  const response = await pending;
  assert.equal(response.status, 504);
  const value = await response.json() as { status: string; totalDeadlineFired: number; public_ingress_deadline: string; cases: Array<{ cleanup: { pendingSourceTimers: number; streamLocked: number; sourceState: string } }> };
  assert.equal(value.status, 'diagnostic_total_deadline');
  assert.equal(value.totalDeadlineFired, 1);
  assert.equal(value.public_ingress_deadline, 'not_validated');
  for (const row of value.cases) {
    assert.equal(row.cleanup.pendingSourceTimers, 0);
    assert.equal(row.cleanup.streamLocked, 0);
    assert.notEqual(row.cleanup.sourceState, 'open');
  }
  t.mock.timers.tick(10000);
  assert.deepEqual(h.calls, []);
});

test('all legal run ID lengths, including trailing hyphens, map injectively to SDK-safe IDs', () => {
  const runs = ['a1234567', 'a'.repeat(48), 'a'.repeat(47) + '-', 'a'.repeat(47) + 'b', 'a123456-'];
  const ids = new Set<string>();
  for (const run of runs) {
    for (const role of ['trusted', 'alpha', 'bravo'] as const) {
      const id = boundarySandboxId(run, role);
      assert.ok(id.length <= 55);
      assert.match(id, /^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
      assert.equal(id.slice(5, -2), run, 'the complete run ID survives without truncation');
      assert.equal(ids.has(id), false);
      ids.add(id);
      assert.equal(boundarySandboxId(run, role), id);
    }
  }
  assert.throws(() => boundarySandboxId('a'.repeat(49), 'trusted'), /InvalidProbeScope/);
  assert.throws(() => boundarySandboxId('../unsafe', 'trusted'), /InvalidProbeScope/);
});

test('all fixture resource kinds enforce tenant, object, run and resource-type scope', async () => {
  const h = harness();
  for (const kind of RESOURCE_KINDS) {
    const issue = await handleProbeRequest(request('/probes/capabilities', { run_id: RUN, tenant: 'alpha', kind }), env, h.operations);
    const { capability } = await issue.json() as { capability: string };
    const headers = { 'x-m0-capability': capability };
    const ownPath = `/fixtures/${RUN}/alpha/${kind}/${objectId('alpha', kind)}`;
    assert.equal((await handleProbeRequest(request(ownPath, undefined, headers), env, h.operations)).status, 200);
    assert.equal((await handleProbeRequest(request(`/fixtures/${RUN}/bravo/${kind}/${objectId('bravo', kind)}`, undefined, headers), env, h.operations)).status, 403);
    assert.equal((await handleProbeRequest(request(`/fixtures/${RUN}/alpha/${kind}/${objectId('bravo', kind)}`, undefined, headers), env, h.operations)).status, 403);
    assert.equal((await handleProbeRequest(request(`/fixtures/another-run/alpha/${kind}/${objectId('alpha', kind)}`, undefined, headers), env, h.operations)).status, 403);
    const otherKind = kind === 'file' ? 'log' : 'file';
    assert.equal((await handleProbeRequest(request(`/fixtures/${RUN}/alpha/${otherKind}/${objectId('alpha', otherKind)}`, undefined, headers), env, h.operations)).status, 403);
    assert.equal((await handleProbeRequest(request(ownPath), env, h.operations)).status, 403);
  }
  assert.deepEqual(h.calls, []);
});

test('expired, modified and noncanonical signed capabilities are rejected', async () => {
  const now = Date.now();
  const scope = { run_id: RUN, tenant: 'alpha' as const, kind: 'file' as const, object_id: objectId('alpha', 'file') };
  const token = await issueCapability(SECRET, RUN, 'alpha', 'file', now);
  assert.equal(await verifyCapability(SECRET, token, scope, now), true);
  assert.equal(await verifyCapability(SECRET, token, scope, now + 300000), false);
  assert.equal(await verifyCapability('other-key', token, scope, now), false);
  assert.equal(await verifyCapability(SECRET, token.replace('ey', 'ez'), scope, now), false);
  assert.equal(await verifyCapability(SECRET, `${token}=`, scope, now), false);
  assert.equal(await verifyCapability(SECRET, `${token}.extra`, scope, now), false);
});

test('runtime exception output does not leak SDK messages or return successful gate decisions', async () => {
  const h = harness();
  h.operations.isolation = async () => { throw new Error('secret output should not escape'); };
  const response = await handleProbeRequest(request('/probes/isolation', { run_id: RUN }), env, h.operations);
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.ok(!text.includes('secret output'));
  assert.equal(JSON.parse(text).gate_decision, 'not_evaluated');
});

test('runtime and cleanup failure observations are returned with an unsuccessful HTTP status', async () => {
  const h = harness();
  for (const status of ['probe_error', 'cleanup_incomplete']) {
    h.operations.isolation = async () => ({ status, gate_decision: 'not_evaluated', cleanup: { alpha: 'cleanup_not_confirmed' } });
    const response = await handleProbeRequest(request('/probes/isolation', { run_id: RUN }), env, h.operations);
    assert.equal(response.status, 502);
    assert.equal((await response.json() as { status: string }).status, status);
  }
});
