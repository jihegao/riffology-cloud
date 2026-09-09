import assert from 'node:assert/strict';
import test from 'node:test';
import { matchedServiceRun, readServiceRun } from '../../services/run/view.ts';
import type { ServiceRunRecord, ServiceRuntimeReference } from '../../services/run/service.ts';
import type { ServiceRunTask } from '../../services/run/host.ts';
import { actor, scope } from './run-fixture.ts';
import { spec } from './run-fixture.ts';

function task(): ServiceRunTask {
  return { runId: 'run-a', scope, actor, requestKey: 'request-a', spec: spec() };
}

function record(input = task()): ServiceRunRecord {
  return {
    id: input.runId,
    kind: 'service',
    scope: structuredClone(input.scope),
    actor: structuredClone(input.actor),
    spec: structuredClone(input.spec),
    status: 'running',
    createdAt: 1000,
    updatedAt: 2000,
    startedAt: 1100,
    stopRequestedAt: null,
    runtime: {
      runId: input.runId,
      runtimeId: 'runtime-a',
      dispatchId: 'dispatch-a',
      leaseId: 'lease-a',
      generation: 1,
      deadlineAt: 5000,
    },
    errorCode: null,
  };
}

function withDispose<T extends object>(value: T, dispose: () => void, getter = false): T {
  if (getter) Object.defineProperty(value, Symbol.dispose, { enumerable: true, get: dispose });
  else Object.defineProperty(value, Symbol.dispose, { enumerable: true, value: dispose });
  return value;
}

test('matchedServiceRun accepts a matching record, detaches it, and handles null', () => {
  const input = record(), result = matchedServiceRun(input, task());
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.notEqual(result!.scope, input.scope);
  result!.scope.tenantId = 'changed';
  assert.equal(input.scope.tenantId, 'tenant-a');
  assert.equal(matchedServiceRun(null, task()), null);
});

test('matchedServiceRun rejects mismatched identity, scope, actor, spec, or runtime run id', () => {
  const base = task();
  const cases: Array<[string, (r: ServiceRunRecord) => void]> = [
    ['id', r => { r.id = 'run-other'; }],
    ['scope', r => { r.scope = { ...r.scope, tenantId: 'tenant-other' }; }],
    ['actor', r => { r.actor = { ...r.actor, authVersion: 2 }; }],
    ['spec', r => { r.spec = { ...r.spec, maxDurationMs: 6000 }; }],
    ['runtime', r => { (r.runtime as ServiceRuntimeReference).runId = 'run-other'; }],
  ];
  for (const [name, change] of cases) {
    const raw = record(base);
    change(raw);
    assert.throws(() => matchedServiceRun(raw, base), /service-view-conflict|scope-denied/, name);
  }
});

test('matchedServiceRun rejects invalid timestamps, status, and extra fields', () => {
  const invalid: Array<[string, (r: ServiceRunRecord) => void]> = [
    ['createdAt', r => { r.createdAt = 0; }],
    ['updatedAt', r => { r.updatedAt = -1; }],
    ['startedAt', r => { r.startedAt = Number.NaN; }],
    ['stopRequestedAt', r => { r.stopRequestedAt = Number.POSITIVE_INFINITY; }],
    ['status', r => { r.status = 'invalid' as ServiceRunRecord['status']; }],
    ['extra', r => { (r as ServiceRunRecord & { extra?: string }).extra = 'unexpected'; }],
  ];
  for (const [name, change] of invalid) {
    const raw = record();
    change(raw);
    assert.throws(() => matchedServiceRun(raw, task()), /service-view-conflict|invalid-turn-integer/, name);
  }
});

test('matchedServiceRun enforces timestamp order and status/runtime combinations', () => {
  const inverted: Array<[string, (r: ServiceRunRecord) => void]> = [
    ['updated before created', r => { r.updatedAt = 900; }],
    ['started before created', r => { r.startedAt = 900; }],
    ['stop requested before start', r => { r.stopRequestedAt = 1050; }],
    ['runtime deadline before start', r => { (r.runtime as ServiceRuntimeReference).deadlineAt = 1050; }],
    ['running without runtime', r => { r.runtime = null; r.startedAt = null; }],
    ['queued with runtime', r => { r.status = 'queued'; }],
    ['cancelled without stop request', r => { r.status = 'cancelled'; }],
    ['stopping without stop request', r => { r.status = 'stopping'; }],
  ];
  for (const [name, change] of inverted) {
    const raw = record();
    change(raw);
    assert.throws(() => matchedServiceRun(raw, task()), /service-view-conflict/, name);
  }

  const queued = record();
  queued.status = 'queued'; queued.runtime = null; queued.startedAt = null;
  assert.doesNotThrow(() => matchedServiceRun(queued, task()));
  const cancelled = { ...queued, status: 'cancelled' as const, stopRequestedAt: 1000 };
  assert.doesNotThrow(() => matchedServiceRun(cancelled, task()));
  const failed = { ...queued, status: 'failed' as const };
  assert.doesNotThrow(() => matchedServiceRun(failed, task()));
  const automaticStop = { ...record(), status: 'stopped' as const, stopRequestedAt: null };
  assert.doesNotThrow(() => matchedServiceRun(automaticStop, task()));
});

test('matchedServiceRun releases top-level RPC results on success and failure without invoking getters', () => {
  let disposed = 0;
  const ok = withDispose(record(), () => { disposed++; });
  matchedServiceRun(ok, task());
  assert.equal(disposed, 1);

  const bad = withDispose(Object.assign(record(), { status: 'invalid' as ServiceRunRecord['status'] }), () => {
    disposed++;
    throw Error('dispose-failed');
  });
  assert.throws(() => matchedServiceRun(bad, task()), /dispose-failed/);
  assert.equal(disposed, 2);

  let getterCalls = 0;
  const getterRaw = Object.defineProperty(record(), 'scope', {
    enumerable: true,
    get() { getterCalls++; throw Error('scope-getter-invoked'); },
  });
  withDispose(getterRaw, () => { disposed++; });
  assert.throws(() => matchedServiceRun(getterRaw, task()), /service-view-conflict/);
  assert.equal(getterCalls, 0);
  assert.equal(disposed, 3);

  let disposeGetterCalls = 0;
  const disposeGetterRaw = Object.defineProperty(record(), Symbol.dispose, {
    enumerable: true,
    get() { disposeGetterCalls++; return () => { disposed++; }; },
  });
  assert.doesNotThrow(() => matchedServiceRun(disposeGetterRaw, task()));
  assert.equal(disposeGetterCalls, 0);
  assert.equal(disposed, 3);
});

test('readServiceRun returns validated data and converts reader failures to service-view-unavailable', async () => {
  const input = task();
  let held: Promise<unknown>[] = [];
  const raw = withDispose(record(), () => {});
  const result = await readServiceRun(input, async () => raw, promise => { held.push(promise); }, 5_000);
  assert.deepEqual(result, record());
  assert.equal(held.length, 1);
  await assert.rejects(readServiceRun(input, async () => { throw Error('reader-failed'); }, () => {}, 5_000), /service-view-unavailable/);
});

test('readServiceRun times out and disposes a late response held by the caller', async () => {
  const input = task();
  let resolve!: (value: unknown) => void;
  const pending = new Promise<unknown>(r => { resolve = r; });
  const held: Promise<unknown>[] = [];
  let disposed = 0;
  await assert.rejects(readServiceRun(input, () => pending, promise => { held.push(promise); }, 5), /service-view-unavailable/);
  assert.equal(held.length, 1);
  resolve(withDispose(record(), () => { disposed++; }));
  await Promise.all(held);
  assert.equal(disposed, 1);
});
