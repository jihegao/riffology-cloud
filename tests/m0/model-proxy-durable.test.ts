import assert from 'node:assert/strict';
import test from 'node:test';
import { DurableRunStore } from '../../spikes/m0-model-proxy/durable-store.ts';
import { RunReservationAuthority, type ReservationInput, type RunApproval, type RunLedger } from '../../spikes/m0-model-proxy/authority.ts';

const KEY = 'm0:model:ledger';
const empty = (): RunLedger => ({ approval: 'fixture-policy', heldMicrousd: 0, dispatchCount: 0, calls: {} });
/** API contract double only. These tests are NOT evidence of Cloudflare durability or crash recovery. */
function storageFixture() {
  let values = new Map<string, unknown>(); let durable = new Map<string, unknown>();
  let failPut = false; let failRead = false; let failSync = false; let holdSync = false;
  const events: string[] = []; const pending: { commit: () => void; fail: () => void }[] = [];
  const storage = {
    kv: {
      // Deliberately returns aliases: the adapter must not rely on the double's cloning behavior.
      get: (key: string) => { events.push('get'); if (failRead) throw new Error('injected-read-failure'); return values.get(key); },
      put: (key: string, value: unknown) => { events.push('put'); values.set(key, value); if (failPut) throw new Error('injected-write-failure-after-write'); },
    },
    transactionSync: <T>(operation: () => T) => {
      events.push('transaction-start'); const before = structuredClone(values);
      try { const value = operation(); events.push('transaction-return'); return value; }
      catch (error) { values = before; events.push('transaction-rollback'); throw error; }
    },
    sync: () => {
      events.push('sync-start'); const snapshot = structuredClone(values);
      if (failSync) return Promise.reject(new Error('injected-sync-failure'));
      if (!holdSync) { durable = snapshot; events.push('sync-confirmed'); return Promise.resolve(); }
      return new Promise<void>((resolve, reject) => {
        pending.push({ commit: () => { durable = snapshot; events.push('sync-confirmed'); resolve(); }, fail: () => { reject(new Error('injected-sync-failure')); } });
      });
    },
  } as unknown as DurableObjectStorage;
  return {
    storage, events, pending, store: () => new DurableRunStore(storage),
    peek: (key = KEY) => structuredClone(values.get(key)), persisted: (key = KEY) => structuredClone(durable.get(key)),
    seed: (value: unknown, key = KEY) => values.set(key, value),
    failPut: (value: boolean) => { failPut = value; }, failRead: (value: boolean) => { failRead = value; },
    failSync: (value: boolean) => { failSync = value; }, holdSync: (value: boolean) => { holdSync = value; },
  };
}
const NOW = 1_000_000;
const approval: RunApproval = {
  kind: 'trusted-pi', principal: 'trusted-pi', tenantId: 'tenant-a', workspaceId: 'workspace-a', runId: 'fixed-run', expiresAtMs: NOW + 60_000,
  provider: 'opencode-go', model: 'deepseek-v4-flash', maxRunMicrousd: 1_000_000,
  rate: { provider: 'opencode-go', model: 'deepseek-v4-flash', version: 'synthetic-test-only', source: 'https://rate.example.test/fixture', verifiedAtMs: NOW - 1, expiresAtMs: NOW + 60_000, inputMicrousdPerMillion: 1_000_000, outputMicrousdPerMillion: 2_000_000, boundsAllBillableTokens: true },
};
function input(callId = 'call-one', platformRequestId = 'request-one'): ReservationInput {
  return { invocation: { kind: approval.kind, principal: approval.principal, tenantId: approval.tenantId, workspaceId: approval.workspaceId, runId: approval.runId, callId, expiresAtMs: approval.expiresAtMs }, platformRequestId, payloadHash: 'a'.repeat(64), provider: approval.provider, model: approval.model, inputTokenUpperBound: 20, maxOutputTokens: 256, inputBoundVersion: 'synthetic-test-only' };
}
const authority = (f: ReturnType<typeof storageFixture>, configuration = approval) => new RunReservationAuthority(configuration, f.store(), () => NOW);

test('durable adapter uses transactionSync/kv then waits for explicit sync before resolving', async () => {
  const f = storageFixture(); f.holdSync(true); let resolved = false;
  const result = f.store().transact(current => { assert.equal(current, null); return { state: empty(), value: 'confirmed-only' }; }).then(value => { resolved = true; return value; });
  await Promise.resolve(); assert.equal(resolved, false); assert.equal(f.persisted(), undefined);
  assert.deepEqual(f.events, ['transaction-start', 'get', 'put', 'transaction-return', 'sync-start']);
  f.pending[0]!.commit(); assert.equal(await result, 'confirmed-only'); assert.deepEqual(f.persisted(), empty());
});

test('operation exceptions and storage failures after put roll back and never call sync or resolve success', async () => {
  const f = storageFixture(); f.seed(empty()); const before = f.peek();
  await assert.rejects(f.store().transact(current => { current!.heldMicrousd = 99; throw new Error('operation-failure'); }), /operation-failure/);
  assert.deepEqual(f.peek(), before); assert.ok(f.events.includes('transaction-rollback')); assert.equal(f.events.includes('sync-start'), false);
  f.failPut(true); await assert.rejects(f.store().transact(current => ({ state: { ...current!, heldMicrousd: 123 }, value: 'must-not-return' })), /injected-write-failure/);
  assert.deepEqual(f.peek(), before); assert.equal(f.events.includes('sync-start'), false);
  f.failPut(false); f.failRead(true); let operationCalled = false;
  await assert.rejects(f.store().transact(current => { operationCalled = true; return { state: current!, value: null }; }), /injected-read-failure/);
  assert.equal(operationCalled, false); assert.deepEqual(f.peek(), before);
});

test('state and return values are detached from both callback aliases and storage aliases', async () => {
  const f = storageFixture(); f.seed(empty()); f.holdSync(true);
  let currentAlias!: RunLedger; let nextAlias!: RunLedger; const returned = { evidence: { state: 'original' } };
  const pending = f.store().transact(current => { currentAlias = current!; nextAlias = { ...current!, heldMicrousd: 532 }; return { state: nextAlias, value: returned }; });
  currentAlias.approval = 'mutated-input'; nextAlias.heldMicrousd = 1; returned.evidence.state = 'mutated-output';
  assert.equal((f.peek() as RunLedger).heldMicrousd, 532); assert.equal((f.peek() as RunLedger).approval, 'fixture-policy');
  f.pending[0]!.commit(); const value = await pending; assert.equal(value.evidence.state, 'original'); value.evidence.state = 'after-return';
  assert.equal((f.persisted() as RunLedger).heldMicrousd, 532); assert.equal(returned.evidence.state, 'mutated-output');
});

test('serialization failure or an accidental async operation cannot leave a write behind', async () => {
  const f = storageFixture(); f.seed(empty());
  await assert.rejects(f.store().transact(current => ({ state: { ...current!, heldMicrousd: 12 }, value: () => 'uncloneable' })), /clone|cloned/i);
  assert.deepEqual(f.peek(), empty()); assert.equal(f.events.includes('put'), false);
  const accidentalAsync = async (current: RunLedger | null) => ({ state: current!, value: 'invalid-async' });
  await assert.rejects(f.store().transact(accidentalAsync as unknown as Parameters<DurableRunStore['transact']>[0]), /must-be-synchronous/);
  assert.deepEqual(f.peek(), empty()); assert.equal(f.events.includes('put'), false);
});

test('sync rejection stays uncertain and does not undo or replay a possibly committed dispatch intent', async () => {
  const f = storageFixture(); const first = authority(f); await first.reserve(input()); const held = (f.persisted() as RunLedger).heldMicrousd;
  f.failSync(true); await assert.rejects(first.markDispatched('call-one', 'request-one'), /injected-sync-failure/);
  assert.equal((f.peek() as RunLedger).calls['call-one']?.state, 'dispatched'); assert.equal((f.peek() as RunLedger).dispatchCount, 1);
  assert.equal((f.persisted() as RunLedger).calls['call-one']?.state, 'reserved', 'double deliberately models an unacknowledged flush, not confirmed rollback');
  f.failSync(false); const rebuilt = authority(f); const duplicate = await rebuilt.reserve(input('call-one', 'another-request'));
  assert.equal(duplicate.created, false); assert.equal(duplicate.receipt.state, 'dispatched');
  await assert.rejects(rebuilt.markDispatched('call-one', 'request-one'), /dispatch-state-conflict/);
  assert.equal((f.peek() as RunLedger).heldMicrousd, held); assert.equal((f.peek() as RunLedger).dispatchCount, 1);
});

test('concurrent duplicate reservations across adapter instances share one ledger and one dispatch', async () => {
  const f = storageFixture(); const a = authority(f); const b = authority(f);
  const results = await Promise.all([a.reserve(input()), b.reserve(input('call-one', 'request-two'))]);
  assert.deepEqual(results.map(result => result.created), [true, false]); assert.equal(results[1]!.receipt.platformRequestId, 'request-one');
  assert.equal((f.peek() as RunLedger).heldMicrousd, 532); assert.equal(Object.keys((f.peek() as RunLedger).calls).length, 1);
  const attempts = await Promise.allSettled([a.markDispatched('call-one', 'request-one'), b.markDispatched('call-one', 'request-one')]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1); assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
  assert.equal((f.persisted() as RunLedger).dispatchCount, 1);
});

test('reconstructed authorities retain run ceiling and reject approval/budget drift', async () => {
  const f = storageFixture(); await authority(f).reserve(input());
  await authority(f).reserve(input('call-two', 'request-two')); await authority(f).reserve(input('call-three', 'request-three'));
  await assert.rejects(authority(f).reserve(input('call-four', 'request-four')), /run-dispatch-limit/);
  const before = f.peek(); const prior = await authority(f).reserve(input()); assert.equal(prior.created, false);
  await assert.rejects(authority(f, { ...approval, maxRunMicrousd: 999_999 }).reserve(input()), /durable-approval-conflict/);
  assert.deepEqual(f.peek(), before); assert.equal((f.persisted() as RunLedger).heldMicrousd, 1596);
});

test('custom fixed storage key stays isolated; missing backend and malformed saved ledgers never become empty budgets', async () => {
  const f = storageFixture(); f.seed(empty());
  const custom = new DurableRunStore(f.storage, 'm0:model:other'); await custom.transact(() => ({ state: { ...empty(), heldMicrousd: 123 }, value: null }));
  assert.deepEqual(f.peek(), empty()); assert.equal((f.peek('m0:model:other') as RunLedger).heldMicrousd, 123);
  assert.throws(() => new DurableRunStore({} as DurableObjectStorage), /sqlite-durable-storage-required/);
  assert.throws(() => new DurableRunStore(f.storage, ''), /invalid-run-ledger-key/);
  for (const invalid of [null, {}, { ...empty(), heldMicrousd: -1 }, { ...empty(), dispatchCount: NaN }, { ...empty(), dispatchCount: 4 }, { ...empty(), calls: [] }]) {
    f.seed(invalid); let called = false;
    await assert.rejects(f.store().transact(() => { called = true; return { state: empty(), value: null }; }), /invalid-persisted-run-ledger/);
    assert.equal(called, false); assert.deepEqual(f.peek(), invalid);
  }
});
