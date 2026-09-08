import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { EffectDeadlineError, waitForEffect } from './bounded-effect.ts';

// Load the real coordinator/authority. Only platform construction and SDK
// allocation are replaced; tests never start Workerd, Docker or cloud requests.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = specifier === 'cloudflare:workers'
      ? 'export class DurableObject { constructor(ctx, env) { this.ctx=ctx; this.env=env; } }'
      : specifier === '@cloudflare/sandbox'
        ? 'export class Sandbox {} export class ContainerProxy {} export function getSandbox() { throw new Error("unexpected-real-allocation"); }'
        : null;
    return source === null ? nextResolve(specifier, context) : { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
  },
});
const { M0RecoveryCoordinator } = await import('./index.ts');
hooks.deregister();
type State = NonNullable<ReturnType<InstanceType<typeof M0RecoveryCoordinator>['state']>>;

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  let values = new Map<string, unknown>();
  const alarms: number[] = [], owned: Promise<unknown>[] = [];
  const kv = {
    get: <T>(key: string) => structuredClone(values.get(key)) as T | undefined,
    put: (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
    delete: (key: string) => values.delete(key),
    list: <T>({ prefix }: { prefix: string }) => new Map([...values].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))) as Map<string, T>,
  };
  const setAlarm = async (at: number) => { alarms.push(at); };
  const transaction = { get: async <T>(key: string) => kv.get<T>(key), put: async (key: string, value: unknown) => kv.put(key, value), setAlarm };
  const storage = {
    kv, sync: async () => {}, setAlarm,
    transactionSync<T>(run: () => T): T {
      const previous = structuredClone(values);
      try { return run(); } catch (error) { values = previous; throw error; }
    },
    async transaction<T>(run: (tx: typeof transaction) => Promise<T>) { return run(transaction); },
  };
  const ctx = { storage, id: { toString: () => 'a'.repeat(64) }, waitUntil: (promise: Promise<unknown>) => owned.push(promise) };
  const coordinator = new M0RecoveryCoordinator(ctx as unknown as DurableObjectState, {} as never);
  coordinator.operationTimeoutMs = 15;
  coordinator.cleanupTimeoutMs = 15;
  coordinator.faultObservationMs = 15;
  const calls = { mkdir: 0, write: 0, start: 0, destroy: 0, get: 0 };
  const sdk = {
    mkdir: async () => { calls.mkdir++; return { success: true }; },
    writeFile: async () => { calls.write++; return { success: true }; },
    startProcess: async (_command?: string, _options?: unknown) => { calls.start++; return {}; },
    destroy: async () => { calls.destroy++; },
    getProcess: async () => { calls.get++; return null; },
  };
  coordinator.sandbox = () => sdk as unknown as ReturnType<typeof coordinator.sandbox>;
  function state(patch: Partial<State> = {}) {
    const s: State = { phase: 'preparing', generation: 1, runtimeGeneration: 1, mode: 'initial', deadline: Date.now() + 10000,
      reason: null, fault: null, cleanup: 'pending', cleanupAttempts: 0, seed: null, final: null, ...patch };
    coordinator.append(s);
    return s;
  }
  return { coordinator, storage, alarms, owned, calls, sdk, state, settled: async () => { await Promise.all(owned); } };
}

test('closing an uninitialized run fences delayed accept and recovery without allocating', async () => {
  const f = fixture();
  assert.equal((await f.coordinator.cleanup()).status, 200);
  assert.equal(f.storage.kv.get('closed'), true);
  assert.equal((await f.coordinator.accept()).status, 409);
  assert.equal(f.coordinator.state(), null);
  assert.equal(f.alarms.length, 0);
  f.state({ phase: 'interrupted', generation: 2, cleanup: 'destroy_acknowledged', seed: { revision: 'seed', generation: 1, sequence: 1 } });
  assert.equal((await f.coordinator.recover()).status, 409);
  assert.equal(await f.coordinator.schedule(2, ['interrupted'], { phase: 'queued' }), false);
  assert.deepEqual(f.calls, { mkdir: 0, write: 0, start: 0, destroy: 0, get: 0 });
});

test('old events use a valid phase and stale writes exercise actual checkpoint authority', async () => {
  const f = fixture();
  f.state({ phase: 'finishing', generation: 2, runtimeGeneration: 2, mode: 'recovery' });
  f.storage.kv.put('pending-session-digest', { generation: 2, kind: 'final', digest: 'b'.repeat(64) });
  await f.coordinator.commit({ revision: 'c'.repeat(64), parent: null, generation: 2 });
  assert.equal(f.coordinator.state()?.phase, 'completed', 'current-generation write positive control commits');
  const result = await f.coordinator.lateEvent();
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { suppliedGeneration: 1, currentGeneration: 2, accepted: false, stateUnchanged: true, eventCountUnchanged: true,
    attemptedPhase: 'completed', phaseWasCurrent: true, writeAccepted: false, writeRejection: 'stale-generation', currentUnchanged: true, receiptEventsUnchanged: true });
  assert.ok(f.coordinator.transition(2, ['completed'], {}), 'identical phase and fresh generation is accepted');
});

test('settled effects clear ownership and permit the next operation', async () => {
  const f = fixture(), s = f.state();
  assert.equal(await f.coordinator.effect(s, 'first', async () => 1), 1);
  assert.equal(await f.coordinator.effect(s, 'second', async () => 2), 2);
  assert.equal(f.coordinator.activeEffect, null);
  assert.equal(f.storage.kv.get('effect-intent'), undefined);
  await f.settled();
});

test('closing or expiring after blob upload rolls back checkpoint publication', async () => {
  for (const reason of ['closed', 'expired']) {
    const f = fixture();
    f.state({ phase: 'finishing', deadline: reason === 'expired' ? Date.now() - 1 : Date.now() + 10000 });
    f.storage.kv.put('pending-session-digest', { generation: 1, kind: 'final', digest: 'b'.repeat(64) });
    if (reason === 'closed') f.storage.kv.put('closed', true);
    await assert.rejects(f.coordinator.commit({ revision: 'c'.repeat(64), parent: null, generation: 1 }), /closed-or-expired/);
    assert.equal(await f.coordinator.current(), null);
    assert.equal(f.storage.kv.list({ prefix: 'events/' }).size, 0);
    assert.equal(f.coordinator.state()?.phase, 'finishing');
  }
});

for (const operation of ['mkdir', 'start'] as const) {
  test(`late ${operation} cannot continue dispatch or race destruction`, async () => {
    const f = fixture(), delayed = deferred<{ success: true }>();
    f.state();
    if (operation === 'mkdir') f.sdk.mkdir = async () => { f.calls.mkdir++; return delayed.promise; };
    else f.sdk.startProcess = async (_command, options) => {
      f.calls.start++;
      assert.equal((options as { timeout: number }).timeout, 60000);
      return delayed.promise;
    };
    await f.coordinator.alarm();
    assert.equal(f.coordinator.state()?.phase, 'interrupting');
    assert.equal(f.storage.kv.get<{ outcome: string }>('effect-intent')?.outcome, 'unknown');
    await f.coordinator.alarm();
    assert.equal(f.coordinator.state()?.cleanup, 'cleanup_not_confirmed');
    assert.equal(f.calls.destroy, 0, 'no destroy acknowledgement while creation can arrive late');
    assert.equal((await f.coordinator.recover()).status, 409);
    delayed.resolve({ success: true });
    await f.settled();
    assert.equal(f.coordinator.state()?.cleanup, 'pending');
    await f.coordinator.alarm();
    assert.equal(f.calls.destroy, 1);
    assert.equal(f.coordinator.state()?.cleanup, 'destroy_acknowledged');
    assert.equal(f.calls.start, operation === 'start' ? 1 : 0);
    assert.equal(f.calls.write, operation === 'start' ? 2 : 0);
    assert.equal(f.storage.kv.get('effect-intent'), undefined);
  });
}

test('fault observation is bounded and late rejection is owned before cleanup', async () => {
  const f = fixture(), delayed = deferred<null>();
  f.state({ phase: 'interrupting', generation: 2, fault: 'process' });
  f.sdk.getProcess = async () => { f.calls.get++; return delayed.promise; };
  await f.coordinator.alarm();
  assert.equal(f.calls.destroy, 0);
  assert.equal(f.coordinator.state()?.cleanup, 'cleanup_not_confirmed');
  assert.equal(f.storage.kv.get<{ windowHit: boolean }>('fault-receipt')?.windowHit, false);
  delayed.reject(new Error('late-sdk-rejection'));
  await f.settled();
  await f.coordinator.alarm();
  assert.equal(f.calls.destroy, 1);
  assert.equal(f.coordinator.state()?.cleanup, 'destroy_acknowledged');
  assert.equal(f.storage.kv.get<{ windowHit: boolean }>('fault-receipt')?.windowHit, false, 'cleanup reconciliation does not rewrite a missed fault window');
});

test('durable unknown intent after eviction is quarantined without replay or misleading cleanup', async () => {
  const f = fixture();
  f.state({ phase: 'launching' });
  f.storage.kv.put('effect-intent', { sequence: 1, generation: 1, runtimeGeneration: 1, operation: 'start-process', startedAt: Date.now(), outcome: 'pending' });
  await f.coordinator.alarm();
  await f.coordinator.alarm();
  assert.equal(f.coordinator.state()?.phase, 'interrupted');
  assert.equal(f.coordinator.state()?.cleanup, 'cleanup_not_confirmed');
  assert.equal(f.coordinator.state()?.reason, 'effect-outcome-unknown');
  assert.equal((await f.coordinator.recover()).status, 409);
  assert.deepEqual(f.calls, { mkdir: 0, write: 0, start: 0, destroy: 0, get: 0 });
});

test('late destroy acknowledgement settles cleanup without starting another teardown', async () => {
  const f = fixture(), delayed = deferred<void>();
  f.state({ phase: 'interrupting', generation: 2 });
  f.sdk.destroy = async () => { f.calls.destroy++; return delayed.promise; };
  await f.coordinator.alarm();
  assert.equal(f.coordinator.state()?.cleanup, 'cleanup_not_confirmed');
  assert.equal(f.calls.destroy, 1);
  await f.coordinator.cleanup();
  await f.coordinator.alarm();
  assert.equal(f.calls.destroy, 1, 'operator retry cannot overlap the real teardown');
  delayed.resolve();
  await f.settled();
  assert.equal(f.coordinator.state()?.cleanup, 'destroy_acknowledged');
  await f.coordinator.alarm();
  assert.equal(f.calls.destroy, 1);
  assert.equal(f.storage.kv.get<{ responseTimedOut: boolean }>('last-effect')?.responseTimedOut, true);
});

test('cleanup fencing during a successful SDK await prevents later writes or start', async () => {
  const f = fixture(), delayed = deferred<{ success: true }>(), dispatched = deferred<void>();
  f.state();
  f.sdk.mkdir = async () => { f.calls.mkdir++; dispatched.resolve(); return delayed.promise; };
  const alarm = f.coordinator.alarm();
  await dispatched.promise;
  await f.coordinator.cleanup();
  delayed.resolve({ success: true });
  await alarm;
  await f.coordinator.alarm();
  assert.equal(f.calls.mkdir, 1);
  assert.equal(f.calls.write, 0);
  assert.equal(f.calls.start, 0);
  assert.equal(f.calls.destroy, 1);
  assert.equal(f.coordinator.state()?.cleanup, 'destroy_acknowledged');
});

test('expired turn and cleanup during intent persistence never dispatch', async () => {
  const f = fixture(), s = f.state({ deadline: Date.now() - 1 });
  await assert.rejects(f.coordinator.effect(s, 'write', async () => { f.calls.write++; }), /expired/);
  const current = f.state();
  let first = true;
  f.storage.sync = async () => { if (first) { first = false; f.storage.kv.put('closed', true); } };
  await assert.rejects(f.coordinator.effect(current, 'write', async () => { f.calls.write++; }), /expired/);
  assert.equal(f.calls.write, 0);
  assert.equal(f.storage.kv.get('effect-intent'), undefined);
});

test('deadline helper clears timers on early completion and consumes late rejection', async () => {
  assert.equal(await waitForEffect(Promise.resolve(1), 5000), 1);
  const delayed = deferred<number>();
  await assert.rejects(waitForEffect(delayed.promise, 5), EffectDeadlineError);
  delayed.reject(new Error('late'));
  await Promise.resolve();
});

for (const kind of ['process', 'container'] as const) {
  test(`prearmed ${kind} consumes once on real streaming observation and uses existing cleanup`, async () => {
    const f = fixture();
    f.coordinator.operationTimeoutMs = 1000;
    f.coordinator.faultObservationMs = 1000;
    f.coordinator.cleanupTimeoutMs = 1000;
    assert.equal((await f.coordinator.accept(kind)).status, 202);
    const armed = f.storage.kv.get<{ status: string; triggeredAt: number | null }>('fault-plan');
    assert.equal(armed?.status, 'armed');
    assert.equal(armed?.triggeredAt, null);
    const sequence = f.storage.kv.get('turn-sequence');
    assert.equal((await f.coordinator.accept(kind)).status, 202);
    assert.equal((await f.coordinator.accept(kind === 'process' ? 'container' : 'process')).status, 409);
    assert.equal((await f.coordinator.accept()).status, 409);
    assert.deepEqual(f.storage.kv.get('fault-plan'), armed);
    assert.equal(f.storage.kv.get('turn-sequence'), sequence);
    assert.equal((await f.coordinator.fault(kind, 'durable-prearmed')).status, 409, 'queued is not streaming evidence');
    assert.equal(f.calls.start, 0, 'accept only persists intent');
    f.state({ phase: 'streaming' });
    let killed = 0, generation = 1;
    const started = Date.now();
    const process = { getStatus: async () => killed ? 'killed' : 'running', kill: async (signal: string) => { assert.equal(signal, 'SIGKILL'); killed++; } };
    const sdk = { ...f.sdk, getProcess: async () => process,
      readFile: async () => ({ success: true, content: JSON.stringify({ schemaVersion: 1, generation, stage: 'streaming', requestCount: 2, contextRestored: false, streamStartedAt: started }) }),
      exists: async () => ({ success: true, exists: false }) };
    f.coordinator.sandbox = () => sdk as unknown as ReturnType<typeof f.coordinator.sandbox>;
    await f.coordinator.alarm();
    assert.equal(f.coordinator.state()?.phase, 'interrupting');
    assert.equal(f.coordinator.state()?.generation, 2);
    const consumed = f.storage.kv.get<{ status: string; triggeredAt: number }>('fault-plan');
    assert.equal(consumed?.status, 'triggered');
    assert.ok(consumed!.triggeredAt >= started);
    assert.equal((await f.coordinator.fault(kind, 'durable-prearmed')).status, 409);
    await f.coordinator.alarm();
    assert.equal(f.coordinator.state()?.phase, 'interrupted');
    assert.equal(f.coordinator.state()?.cleanup, 'destroy_acknowledged');
    assert.equal(f.storage.kv.get<{ windowHit: boolean }>('fault-receipt')?.windowHit, true);
    assert.equal(killed, kind === 'process' ? 1 : 0);
    assert.equal(f.calls.destroy, 1);
    assert.deepEqual(f.storage.kv.get('fault-plan'), consumed);
    await f.coordinator.alarm();
    assert.equal(f.calls.destroy, 1);
    // A recovered generation cannot consume the initial one-shot plan again.
    killed = 0; generation = 2;
    f.state({ phase: 'streaming', generation: 2, runtimeGeneration: 2, mode: 'recovery' });
    await f.coordinator.alarm();
    assert.equal(f.coordinator.state()?.phase, 'streaming');
    assert.equal(killed, 0);
    assert.equal((await f.coordinator.fault(kind)).status, 409, 'external trigger cannot masquerade as prearmed');
    assert.deepEqual(((await f.coordinator.report()).body as { fault_plan: unknown }).fault_plan, consumed);
  });
}

test('missing the actual stream leaves the plan armed and does not fabricate an injection', async () => {
  const f = fixture();
  await f.coordinator.accept('process');
  f.state({ phase: 'streaming' });
  const sdk = { ...f.sdk, getProcess: async () => ({ getStatus: async () => 'completed' }),
    readFile: async () => ({ success: true, content: JSON.stringify({ schemaVersion: 1, generation: 1, stage: 'completed', requestCount: 2, contextRestored: false }) }) };
  f.coordinator.sandbox = () => sdk as unknown as ReturnType<typeof f.coordinator.sandbox>;
  await f.coordinator.alarm();
  assert.equal(f.coordinator.state()?.phase, 'finishing');
  assert.equal(f.storage.kv.get<{ status: string }>('fault-plan')?.status, 'armed');
  assert.equal(f.storage.kv.get('fault-receipt'), undefined);
  assert.equal(f.calls.destroy, 0);
});
