import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlTenantQuota, type QuotaStorage } from '../../services/quota/core.ts';
import { WorkspaceCoordinator, type WorkspaceState } from '../../services/workspace/coordinator.ts';
import { canonicalWorkspaceMarker, workspaceDigest, type RuntimeIdentity, type RuntimeInitialize, type RuntimeObservation, type WorkspaceProjection, type WorkspaceTask } from '../../services/workspace/protocol.ts';
import type { WorkspaceStore } from '../../services/workspace/store.ts';

// Actual file-backed SQLite and transactions exercise persistence; native
// Container and Catalog authority are explicit contract doubles in this suite.
function fixture(t: { after(fn: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), 'm1-workspace-sqlite-')), filename = join(directory, 'workspace.sqlite');
  let db = new DatabaseSync(filename), now = 10_000, failFlush = false, failEffect: 'acquire' | 'release' | null = null;
  const setup = () => db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY,value TEXT NOT NULL);'); setup();
  t.after(() => { db.close(); rmSync(directory, { recursive: true }); });
  const store: WorkspaceStore = {
    read() { const row = db.prepare('SELECT value FROM state WHERE id=1').get(); return row ? JSON.parse(row.value as string) as WorkspaceState : null; },
    async update(operation) {
      db.exec('BEGIN IMMEDIATE'); let next: WorkspaceState;
      try { next = operation(structuredClone(store.read())); db.prepare('INSERT INTO state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(next)); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
      if (failFlush || (failEffect !== null && next.effect?.kind === failEffect)) throw Error('injected-lost-storage-ack'); return structuredClone(next);
    },
  };
  const storage = {
    sql: { exec(query: string, ...bindings: (string | number | null)[]) {
      if (query.includes('CREATE TABLE')) { db.exec(query); return { toArray: () => [] }; }
      const statement = db.prepare(query); const rows = statement.columns().length ? statement.all(...bindings) : (statement.run(...bindings), []);
      return { toArray: () => structuredClone(rows) };
    } },
    transactionSync<T>(operation: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const value = operation(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } },
    async sync() {},
  } as unknown as QuotaStorage;
  const quota = new SqlTenantQuota(storage, { tenantId: 'tenant-a', capacity: 1, version: 'm1' }, () => now);
  const task: WorkspaceTask = { id: 'task-a', tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'workspace-a', generation: 1,
    starterVersion: 'blank-v1', authVersion: 1, createdAt: now, deadlineAt: now + 1_000 };
  const calls: string[] = [], projections: WorkspaceProjection[] = [];
  let observation: RuntimeObservation | null = null, permitted = true, known = true, initializeCount = 0, stopCount = 0;
  let loseInitialize = false, loseAcquire = false, loseDispatch = false, loseRelease = false, loseStop = false, projectFailures = 0, pending = false, stopUnconfirmed = false, forgedMarker = false, forgedModelReceipt = false;
  const runtime = {
    async initialize(input: RuntimeInitialize) {
      initializeCount++; calls.push('initialize');
      if (observation?.stop) return structuredClone(observation);
      const markerSha256 = await workspaceDigest(canonicalWorkspaceMarker(input.identity, input.markerNonce));
      const content=input.task.modelContent;
      observation = { identity: input.identity, phase: pending ? 'pending' : 'runtime_ready', ready: pending ? null : {
        receiptId: 'runtime-receipt', initializedAt: now, layoutVersion: 'm1-empty-v1', markerSha256: forgedMarker ? '0'.repeat(64) : markerSha256, checkpointRevision: 'a'.repeat(64),
        ...(content?{modelContent:{...content,namespace:'model-content',bytes:100,verifiedSha256:forgedModelReceipt?'e'.repeat(64):content.contentSha256,fileCount:1,contentBytes:1}}:{}) }, stop: null, failureCode: null };
      if (loseInitialize) throw Error('lost-initialize-response'); return structuredClone(observation);
    },
    async observe(identity: RuntimeIdentity): Promise<RuntimeObservation> {
      calls.push('observe'); return structuredClone(observation ?? { identity, phase: 'pending', ready: null, stop: null, failureCode: null });
    },
    async stop(identity: RuntimeIdentity) {
      stopCount++; calls.push('stop');
      observation ??= { identity, phase: 'pending', ready: null, stop: null, failureCode: null };
      if (!stopUnconfirmed) { observation.phase = 'stopped'; observation.stop = { confirmationId: 'native-stop', observedAt: now, nativeRunning: false, fenced: true }; }
      if (loseStop) throw Error('lost-stop-response'); return structuredClone(observation);
    },
  };
  const ports = {
    catalog: {
      async taskKnown() { return known; }, async verifyTask() { calls.push('authority'); return permitted; },
      async project(receipt: WorkspaceProjection) { calls.push('project'); if (projectFailures-- > 0) throw Error('catalog-unavailable'); projections.push(structuredClone(receipt)); return { applied: true }; },
    },
    quota: {
      async acquire(input: Parameters<SqlTenantQuota['acquire']>[0]) { calls.push('acquire'); const r = await quota.acquire(input); if (loseAcquire) throw Error('lost-acquire-response'); return r; },
      async lookup(tenantId: string, operationId: string) { assert.equal(tenantId, task.tenantId); calls.push('lookup'); return quota.lookup(operationId); },
      async dispatch(input: Parameters<SqlTenantQuota['dispatch']>[0]) { calls.push('dispatch'); const r = await quota.dispatch(input); if (loseDispatch) throw Error('lost-dispatch-response'); return r; },
      markUnknown: (input: Parameters<SqlTenantQuota['markUnknown']>[0]) => quota.markUnknown(input),
      async confirmStopped(input: Parameters<SqlTenantQuota['confirmStopped']>[0], proof: Parameters<SqlTenantQuota['confirmStopped']>[1]) {
        calls.push('release'); const r = await quota.confirmStopped(input, proof); if (loseRelease) throw Error('lost-release-response'); return r;
      },
    }, runtime: () => runtime, hold(_promise: Promise<unknown>) {},
  };
  let host = new WorkspaceCoordinator(store, ports, () => now, { rpcMs: 10, pollMs: 1, cleanupMs: 100, maxCalls: 40 });
  async function drain(max = 50) { for (let i = 0; i < max && host.report()?.wakeAt !== null; i++) await host.alarm(); return host.report()!; }
  return { task, store, quota, calls, projections, ports, runtime, drain,
    get host() { return host; }, get initializeCount() { return initializeCount; }, get stopCount() { return stopCount; },
    get observation() { return observation; }, setObservation(value: RuntimeObservation) { observation = value; },
    advance(ms: number) { now += ms; }, revoke() { permitted = false; }, unknownTask() { known = false; },
    lose(kind: 'initialize' | 'acquire' | 'dispatch' | 'release' | 'stop') { if (kind === 'initialize') loseInitialize = true; if (kind === 'acquire') loseAcquire = true; if (kind === 'dispatch') loseDispatch = true; if (kind === 'release') loseRelease = true; if (kind === 'stop') loseStop = true; },
    setPending() { pending = true; }, unconfirmedStop(value = true) { stopUnconfirmed = value; }, forgeMarker() { forgedMarker = true; }, forgeModelReceipt() { forgedModelReceipt = true; },
    failProjects(count: number) { projectFailures = count; }, failFlush(value: boolean) { failFlush = value; }, failEffect(kind: 'acquire' | 'release' | null) { failEffect = kind; },
    reopen() { db.close(); db = new DatabaseSync(filename); setup(); host = new WorkspaceCoordinator(store, ports, () => now, { rpcMs: 10, pollMs: 1, cleanupMs: 100, maxCalls: 40 }); },
  };
}

test('one durable acceptance initializes once, checkpoints, stops and releases before ready projection', async t => {
  const f = fixture(t), [a, b] = await Promise.all([f.host.accept(f.task), f.host.accept(f.task)]); assert.equal(a.runtimeId, b.runtimeId);
  const state = await f.drain(); assert.equal(state.projection?.outcome, 'ready'); assert.equal(state.projectionConfirmed, true);
  assert.equal(state.quotaReleased, true); assert.equal((await f.quota.snapshot()).occupied, 0); assert.equal(f.initializeCount, 1); assert.equal(f.stopCount, 1);
  assert.ok(f.calls.indexOf('initialize') < f.calls.indexOf('stop')); assert.ok(f.calls.indexOf('stop') < f.calls.indexOf('release')); assert.ok(f.calls.indexOf('release') < f.calls.indexOf('project'));
  assert.equal(f.projections[0]?.runtimeReceipt?.markerSha256, await workspaceDigest(canonicalWorkspaceMarker(state.identity!, state.markerNonce)));
  f.reopen(); assert.deepEqual(await f.host.accept(f.task), state); await f.host.alarm(); assert.equal(f.initializeCount, 1);
  await assert.rejects(f.host.accept({ ...f.task, generation: 2 }), /conflict/); await assert.rejects(f.host.stop({ ...f.task, projectId: 'other' }), /conflict/);
});
test('a frozen model source survives coordinator restart and conflicts on any changed source field', async t => {
  const f=fixture(t),modelTask:WorkspaceTask={...f.task,modelContent:{modelVersionId:'version-a',modelId:'queue',version:'2.1.0',contentRef:'r2://models/queue/2.1.0.tar',contentSha256:'d'.repeat(64)}};
  const accepted=await f.host.accept(modelTask);assert.deepEqual(accepted.task,modelTask);
  f.reopen();assert.deepEqual(f.host.report()?.task,modelTask);assert.deepEqual((await f.host.accept(modelTask)).task,modelTask);
  await assert.rejects(f.host.accept({...modelTask,modelContent:{...modelTask.modelContent!,contentRef:'r2://models/queue/changed.tar'}}),/conflict/);
  await assert.rejects(f.host.accept({...modelTask,modelContent:{...modelTask.modelContent!,extra:'client-value'} as WorkspaceTask['modelContent']}),/invalid-workspace-task/);
  const ready=await f.drain();assert.equal(ready.projection?.outcome,'ready');assert.equal(ready.runtimeReceipt?.modelContent?.verifiedSha256,modelTask.modelContent!.contentSha256);
  const bad=fixture(t),badTask:WorkspaceTask={...bad.task,modelContent:structuredClone(modelTask.modelContent)};bad.forgeModelReceipt();await bad.host.accept(badTask);
  assert.equal((await bad.drain()).projection?.reasonCode,'runtime-unknown');
});
test('unknown task never pins an actor; authentic expired or revoked tasks persist a no-runtime failure', async t => {
  const a = fixture(t); a.unknownTask(); await assert.rejects(a.host.accept(a.task), /not-known/); assert.equal(a.host.report(), null);
  const b = fixture(t); b.advance(1_001); await b.host.accept(b.task); assert.equal((await b.drain()).projection?.reasonCode, 'deadline'); assert.equal(b.calls.includes('acquire'), false);
  const c = fixture(t); c.revoke(); await c.host.accept(c.task); assert.equal((await c.drain()).projection?.reasonCode, 'authority-revoked'); assert.equal(c.calls.includes('acquire'), false);
});
test('revocation after quota dispatch is rechecked before initialize and stops the identity before release', async t => {
  const f = fixture(t); await f.host.accept(f.task); await f.host.alarm(); await f.host.alarm();
  assert.equal(f.host.report()?.lease?.status, 'dispatched'); f.revoke(); const state = await f.drain();
  assert.equal(f.initializeCount, 0); assert.equal(f.stopCount, 1); assert.equal(state.projection?.reasonCode, 'authority-revoked'); assert.equal(state.quotaReleased, true);
});
test('committed acquire with lost reply is observed without another acquire after disk reopen', async t => {
  const f = fixture(t); f.lose('acquire'); await f.host.accept(f.task); await f.host.alarm(); f.reopen(); const s = await f.drain();
  assert.equal(s.projection?.outcome, 'ready'); assert.equal(f.calls.filter(v => v === 'acquire').length, 1); assert.ok(f.calls.includes('lookup'));
});
test('lost dispatch response or eviction after authorization cannot be reused to initialize', async t => {
  for (const lose of [true, false]) {
    const f = fixture(t); if (lose) f.lose('dispatch'); await f.host.accept(f.task); await f.host.alarm(); await f.host.alarm(); f.reopen();
    const state = await f.drain(); assert.equal(f.initializeCount, 0); assert.equal(f.calls.filter(v => v === 'dispatch').length, 1);
    assert.equal(state.projection?.outcome, 'failed'); assert.equal(state.quotaReleased, true);
  }
});
test('lost initialization reply survives disk reopen and only observes the same persisted runtime receipt', async t => {
  const f = fixture(t); f.lose('initialize'); await f.host.accept(f.task); await f.host.alarm(); await f.host.alarm(); await f.host.alarm();
  const identity = f.host.report()?.identity; assert.equal(f.initializeCount, 1); f.reopen(); const state = await f.drain();
  assert.deepEqual(state.identity, identity); assert.equal(state.projection?.outcome, 'ready'); assert.equal(f.initializeCount, 1); assert.ok(f.calls.includes('observe'));
});
test('lost stop and quota release replies are reconciled from persisted receipts without duplicate effects', async t => {
  const f = fixture(t); f.lose('stop'); f.lose('release'); await f.host.accept(f.task); const state = await f.drain();
  assert.equal(state.projection?.outcome, 'ready'); assert.equal(f.stopCount, 1); assert.equal(f.calls.filter(v => v === 'release').length, 1); assert.equal((await f.quota.snapshot()).occupied, 0);
});
test('pending runtime at deadline is fenced and native-stop proof is required to return its quota', async t => {
  const f = fixture(t); f.setPending(); await f.host.accept(f.task); await f.host.alarm(); await f.host.alarm(); await f.host.alarm();
  f.unconfirmedStop(); f.advance(1_001); await f.host.alarm(); assert.equal((await f.quota.snapshot()).occupied, 1); assert.equal(f.host.report()?.quotaReleased, false);
  f.advance(100); const state = await f.drain(); assert.equal(state.projection?.outcome, 'unknown'); assert.equal(state.wakeAt, null); assert.equal(f.stopCount, 1);
  const observed = f.observation!; f.setObservation({ ...observed, phase: 'stopped', stop: { confirmationId: 'late-stop', observedAt: 11_101, nativeRunning: false, fenced: true } });
  await f.host.reconcile(f.task); const repaired = await f.drain(); assert.equal(repaired.projection?.outcome, 'failed'); assert.equal(repaired.quotaReleased, true); assert.equal(f.initializeCount, 1); assert.equal(f.stopCount, 1);
});
test('cancel during unresolved initialize persists a fence request; late response never becomes ready', async t => {
  const f = fixture(t); let complete!: (r: RuntimeObservation) => void;
  const original = f.runtime.initialize.bind(f.runtime); f.runtime.initialize = async input => { const value = await original(input); return new Promise(resolve => { complete = () => resolve(value); }); };
  await f.host.accept(f.task); await f.host.alarm(); await f.host.alarm(); const tick = f.host.alarm();
  for (let i = 0; i < 20 && !complete; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.ok(complete); await f.host.stop(f.task); await tick; complete(f.observation!);
  const state = await f.drain(); assert.equal(state.projection?.outcome, 'stopped'); assert.equal(state.projection?.reasonCode, 'stop-requested'); assert.equal(state.quotaReleased, true);
});
test('malformed checkpoint never projects ready; independent valid stop proof still allows cleanup', async t => {
  const f = fixture(t); f.forgeMarker(); await f.host.accept(f.task); const state = await f.drain();
  assert.equal(state.projection?.outcome, 'failed'); assert.equal(state.quotaReleased, true); assert.equal((await f.quota.snapshot()).occupied, 0);
  assert.equal(f.projections.some(r => r.outcome === 'ready'), false); assert.equal(f.stopCount, 1);
});
test('storage acknowledgement failure before external effect leaves only intent and never sends the effect', async t => {
  const f = fixture(t); await f.host.accept(f.task); await f.host.alarm(); await f.host.alarm();
  // Fail the initialize intent write's sync, after its authority read succeeds.
  const old = f.ports.catalog.verifyTask; f.ports.catalog.verifyTask = async () => { f.failFlush(true); return old(); };
  await assert.rejects(f.host.alarm(), /lost-storage-ack/); assert.equal(f.initializeCount, 0);
  f.failFlush(false); f.ports.catalog.verifyTask = old; f.reopen(); const state = await f.drain();
  assert.equal(f.initializeCount, 0); assert.equal(state.projection?.outcome, 'failed'); assert.equal(state.quotaReleased, true);
});
test('three failed projection acknowledgements can recover from repeated accept without replaying runtime', async t => {
  const f = fixture(t); f.failProjects(3); await f.host.accept(f.task); const before = await f.drain();
  assert.equal(before.projectionConfirmed, false); assert.equal(before.wakeAt, null); const receipt = before.projection;
  f.reopen(); await f.host.accept(f.task); const state = await f.drain(); assert.equal(state.projectionConfirmed, true); assert.deepEqual(state.projection, receipt);
  assert.equal(f.initializeCount, 1); assert.equal(f.stopCount, 1);
});
test('unconfirmed acquisition eventually exposes unknown and retains the operation identity on reconcile', async t => {
  const f = fixture(t); f.ports.quota.acquire = async () => { throw Error('transport-lost-before-receipt'); };
  await f.host.accept(f.task); await f.host.alarm(); f.advance(1_101); let state = await f.drain();
  assert.equal(state.projection?.outcome, 'unknown'); assert.equal(state.quotaReleased, false); assert.equal(state.wakeAt, null);
  const runtimeId = state.runtimeId; await f.host.reconcile(f.task); state = await f.drain(); assert.equal(state.runtimeId, runtimeId);
  assert.equal(f.initializeCount, 0); assert.equal(f.calls.includes('dispatch'), false);
});
test('intent committed before acquire or release sends is recovered by lookup then one identical idempotent retry', async t => {
  for (const kind of ['acquire', 'release'] as const) {
    const f = fixture(t); await f.host.accept(f.task);
    if (kind === 'release') { await f.host.alarm(); await f.host.alarm(); await f.host.alarm(); await f.host.alarm(); assert.ok(f.host.report()?.stopReceipt); }
    f.failEffect(kind); await assert.rejects(f.host.alarm(), /lost-storage-ack/);
    assert.equal(f.calls.filter(v => v === kind).length, 0);
    const before = f.host.report()!; assert.equal(kind === 'acquire' ? before.acquireAttempts : before.releaseAttempts, 1);
    f.failEffect(null); f.reopen(); const after = await f.drain(); assert.equal(after.projection?.outcome, 'ready');
    assert.equal(kind === 'acquire' ? after.acquireAttempts : after.releaseAttempts, 2);
    assert.equal(f.calls.filter(v => v === kind).length, 1); assert.ok(f.calls.includes('lookup'));
    assert.equal(after.runtimeId, before.runtimeId); assert.equal(f.initializeCount, 1); assert.equal(f.stopCount, 1);
  }
});
test('quota retry reservations are capped at three durably, including after explicit reconciliation', async t => {
  for (const kind of ['acquire', 'release'] as const) {
    const f = fixture(t); let count = 0;
    if (kind === 'acquire') f.ports.quota.acquire = async () => { count++; throw Error('quota-unavailable'); };
    else f.ports.quota.confirmStopped = async () => { count++; throw Error('quota-unavailable'); };
    await f.host.accept(f.task); const state = await f.drain(); assert.equal(state.projection?.outcome, 'unknown'); assert.equal(count, 3);
    f.reopen(); await f.host.reconcile(f.task); await f.drain(); assert.equal(count, 3); assert.equal(f.host.report()?.quotaReleased, false);
  }
});
