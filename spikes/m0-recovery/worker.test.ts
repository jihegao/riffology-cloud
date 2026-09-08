import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIONS, handleRecoveryRequest, observationStream, recoverySandboxId, type RecoveryOperations } from './worker.ts';

const env = { M0_PROBE_TOKEN: 'synthetic-recovery-bearer-0000000000000000', ENVIRONMENT: 'staging', PROTOCOL_VERSION: 'm0-v1' };
const headers = { authorization: `Bearer ${env.M0_PROBE_TOKEN}` };

test('recovery management rejects unauthorized, unsafe and cross-environment input before object allocation', async () => {
  let allocations = 0;
  const operations: RecoveryOperations = { invoke: async () => { allocations++; return { status: 202, body: {} }; }, events: async () => { allocations++; return { events: [], terminal: true }; } };
  for (const action of ACTIONS) {
    const method = ['report', 'events'].includes(action) ? 'GET' : 'POST';
    const request = () => new Request(`http://localhost/probe/run-123456/${action}`, { method, headers });
    assert.equal((await handleRecoveryRequest(new Request(request(), { headers: {} }), env, operations)).status, 401);
    assert.equal((await handleRecoveryRequest(request(), { ...env, ENVIRONMENT: 'production' }, operations)).status, 503);
    assert.equal((await handleRecoveryRequest(request(), { ...env, PROTOCOL_VERSION: 'unknown' }, operations)).status, 503);
  }
  for (const pathname of ['/probe/short/accept', '/probe/run-123456/exec', '/probe/run-123456/accept?command=x']) {
    assert.equal((await handleRecoveryRequest(new Request(`http://localhost${pathname}`, { method: 'POST', headers }), env, operations)).status, 404);
  }
  assert.equal((await handleRecoveryRequest(new Request('http://localhost/probe/run-123456/accept', { method: 'POST', headers, body: '{}' }), env, operations)).status, 400);
  assert.equal((await handleRecoveryRequest(new Request('http://localhost/probe/run-123456/events', { headers: { ...headers, 'last-event-id': '-1' } }), env, operations)).status, 400);
  assert.equal(allocations, 0);
  assert.equal((await handleRecoveryRequest(new Request('http://localhost/probe/run-123456/accept', { method: 'POST', headers }), env, operations)).status, 202);
  assert.equal(allocations, 1);
  assert.ok(recoverySandboxId('a'.repeat(64), 1).length <= 63);
  assert.notEqual(recoverySandboxId('a'.repeat(64), 1), recoverySandboxId('a'.repeat(64), 2));
  assert.throws(() => recoverySandboxId('caller-id', 1), /invalid/);
});

test('observation cancellation does not mutate the producer; reconnect uses durable event cursor', async () => {
  const history = [{ sequence: 1, generation: 1, kind: 'phase' as const, phase: 'queued', reason: null, at: 'synthetic' }];
  let terminal = false;
  const read = async (cursor: number) => ({ events: history.filter(event => event.sequence > cursor), terminal });
  const first = observationStream(read, 0).body!.getReader();
  const chunk = new TextDecoder().decode((await first.read()).value);
  assert.match(chunk, /id: 1\nevent: turn/);
  await first.cancel();
  // The independent producer progresses after the only observer disconnects.
  history.push({ sequence: 2, generation: 1, kind: 'phase', phase: 'completed', reason: null, at: 'synthetic' });
  terminal = true;
  const reconnected = await observationStream(read, 1).text();
  assert.doesNotMatch(reconnected, /id: 1\n/);
  assert.match(reconnected, /id: 2\n/);
  assert.equal(history.length, 2);
});

test('empty cloud body streams reach dispatch; stalled noncooperative bodies release the reader', async () => {
  let calls = 0;
  const operations: RecoveryOperations = { invoke: async () => { calls++; return { status: 202, body: {} }; }, events: async () => ({ events: [], terminal: true }) };
  const empty = new ReadableStream({ start(controller) { controller.close(); } });
  const request = (body: ReadableStream) => new Request('http://localhost/probe/run-123456/accept', { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
  assert.equal((await handleRecoveryRequest(request(empty), env, operations)).status, 202);
  assert.equal(empty.locked, false);
  const stalled = new ReadableStream({ cancel: () => new Promise(() => {}) });
  assert.equal((await handleRecoveryRequest(request(stalled), env, operations)).status, 400);
  assert.equal(stalled.locked, false);
  assert.equal(calls, 1);
});

test('prearmed fault routes accept only the two fixed authenticated empty POST actions', async () => {
  const invoked: string[] = [];
  const operations: RecoveryOperations = { invoke: async (_run, action) => { invoked.push(action); return { status: 202, body: {} }; }, events: async () => ({ events: [], terminal: true }) };
  for (const action of ['accept-process', 'accept-container']) {
    const url = `http://localhost/probe/run-123456/${action}`;
    assert.equal((await handleRecoveryRequest(new Request(url, { method: 'GET', headers }), env, operations)).status, 405);
    assert.equal((await handleRecoveryRequest(new Request(url + '?delay=1', { method: 'POST', headers }), env, operations)).status, 404);
    assert.equal((await handleRecoveryRequest(new Request(url, { method: 'POST', headers, body: '{"kind":"other"}' }), env, operations)).status, 400);
    const body = new ReadableStream({ start(controller) { controller.close(); } });
    assert.equal((await handleRecoveryRequest(new Request(url, { method: 'POST', headers, body, duplex: 'half' } as RequestInit), env, operations)).status, 202);
  }
  assert.deepEqual(invoked, ['accept-process', 'accept-container']);
});
