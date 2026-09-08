import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlTenantQuota, leaseReference, MAX_LEASE_MS, type QuotaStorage, type LeaseRequest, type Lease } from '../../services/quota/core.ts';

const request = (projectId = 'project-a', workspaceId = 'workspace-a', operationId = 'operation-a', generation = 1): LeaseRequest =>
  ({ tenantId: 'tenant-a', projectId, workspaceId, operationId, generation, operation: 'workspace-runtime', deadlineAt: 2_000 });
function fixture(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'm1-quota-sqlite-')), filename = join(directory, 'quota.sqlite');
  let database = new DatabaseSync(filename), now = 1_000, failSync = false;
  const configure = () => database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;'); configure();
  // Actual on-disk SQLite statements and rollback. This is not a substitute for
  // Workerd output gates: sync failures below are an explicit contract double.
  const storage = {
    sql: { exec(query: string, ...bindings: (string | number | null)[]) {
      if (query.includes('CREATE TABLE')) { database.exec(query); return { toArray: () => [] }; }
      const statement = database.prepare(query), rows = statement.columns().length ? statement.all(...bindings) : (statement.run(...bindings), []);
      return { toArray: () => structuredClone(rows) };
    } },
    transactionSync<T>(operation: () => T): T { database.exec('BEGIN IMMEDIATE'); try { const value = operation(); database.exec('COMMIT'); return value; }
      catch (error) { database.exec('ROLLBACK'); throw error; } },
    async sync() { if (failSync) throw Error('injected-sync-unknown'); },
  } as unknown as QuotaStorage;
  const policy = { tenantId: 'tenant-a', capacity: 1, version: 'invite-v1' };
  const host = () => new SqlTenantQuota(storage, policy, () => now);
  t.after(() => { database.close(); rmSync(directory, { recursive: true }); });
  return { storage, policy, host, get now() { return now; }, advance(value: number) { now = value; }, failSync(value: boolean) { failSync = value; },
    sql(query: string) { database.exec(query); }, reopen() { database.close(); database = new DatabaseSync(filename); configure(); } };
}
async function acquired(host: SqlTenantQuota, input = request()): Promise<Lease> {
  const r = await host.acquire(input); assert.equal(r.outcome, 'acquired'); assert.ok(r.lease); return r.lease;
}
test('one tenant and two projects racing for the last slot share one real SQLite transaction boundary', async t => {
  const f = fixture(t), a = f.host(), b = f.host();
  const results = await Promise.all([a.acquire(request()), b.acquire(request('project-b', 'workspace-b', 'operation-b'))]);
  assert.deepEqual(results.map(r => r.outcome).sort(), ['acquired', 'denied']);
  assert.equal(results.find(r => r.outcome === 'denied')?.denial, 'quota-exhausted');
  assert.equal((await a.snapshot()).occupied, 1); assert.equal((await b.snapshot()).available, 0);
});
test('same operation is durable and payload conflicts; a denied attempt is not silently retried after capacity returns', async t => {
  const f = fixture(t), h = f.host(), lease = await acquired(h);
  const duplicate = await h.acquire(request()); assert.equal(duplicate.outcome, 'replayed'); assert.equal(duplicate.lease?.leaseId, lease.leaseId);
  await assert.rejects(h.acquire({ ...request(), deadlineAt: 2_001 }), /idempotency-conflict/);
  const denied = request('project-b', 'workspace-b', 'operation-b'); assert.equal((await h.acquire(denied)).denial, 'quota-exhausted');
  await h.confirmStopped(leaseReference(lease), { kind: 'never-started', confirmationId: 'stop-a', observedAt: f.now });
  assert.equal((await h.acquire(denied)).outcome, 'replayed'); assert.equal((await h.acquire(denied)).denial, 'quota-exhausted');
  assert.equal((await h.acquire({ ...denied, operationId: 'new-operation-b' })).outcome, 'acquired');
});
test('actual disk reopen retains lease, operation denial, generation fence and policy pin', async t => {
  const f = fixture(t), h = f.host(), lease = await acquired(h);
  await h.dispatch(leaseReference(lease)); f.reopen(); const next = f.host();
  assert.equal((await next.lookup('operation-a'))?.lease?.status, 'dispatched'); assert.equal((await next.snapshot()).occupied, 1);
  assert.equal((await next.dispatch(leaseReference(lease))).authorized, false);
  const wrongPolicy = new SqlTenantQuota(f.storage, { ...f.policy, capacity: 2 }, () => f.now);
  assert.equal((await wrongPolicy.snapshot()).configuredPolicyMatches, false);
  await assert.rejects(wrongPolicy.acquire(request('project-b', 'workspace-b', 'operation-b')), /policy-conflict/);
  await wrongPolicy.confirmStopped(leaseReference(lease), { kind: 'runtime-stopped', confirmationId: 'stop-a', observedAt: f.now });
  assert.equal((await next.snapshot()).available, 1);
  assert.throws(() => new SqlTenantQuota(f.storage, { ...f.policy, tenantId: 'tenant-b' }), /tenant-conflict/);
});
test('TTL and explicit loss retain quota; unknown cannot use never-started, only confirmed stop releases', async t => {
  const f = fixture(t), h = f.host(), lease = await acquired(h); await h.dispatch(leaseReference(lease)); f.advance(2_100);
  assert.equal((await h.snapshot()).unknown, 1); assert.equal((await h.reconcile()).leases[0]?.status, 'unknown');
  assert.equal((await h.snapshot()).available, 0); assert.equal((await h.dispatch(leaseReference(lease))).authorized, false);
  await assert.rejects(h.confirmStopped(leaseReference(lease), { kind: 'never-started', confirmationId: 'stop-a', observedAt: f.now }), /stop-not-confirmed/);
  const proof = { kind: 'runtime-stopped' as const, confirmationId: 'stop-a', observedAt: f.now };
  assert.equal((await h.confirmStopped(leaseReference(lease), proof)).released, true);
  assert.equal((await h.confirmStopped(leaseReference(lease), proof)).released, false); assert.equal((await h.snapshot()).available, 1);
  const next = await acquired(h, { ...request('project-a', 'workspace-a', 'operation-next', 2), deadlineAt: 3_000 });
  await h.markUnknown(leaseReference(next)); await assert.rejects(h.confirmStopped(leaseReference(next), { kind: 'never-started', confirmationId: 'stop-b', observedAt: f.now }), /stop-not-confirmed/);
  assert.equal((await h.snapshot()).occupied, 1);
});
test('late old generation and wrong scope cannot dispatch or release a replacement lease', async t => {
  const f = fixture(t), h = f.host(), old = await acquired(h), proof = { kind: 'never-started' as const, confirmationId: 'stop-old', observedAt: f.now };
  await h.confirmStopped(leaseReference(old), proof);
  const current = await acquired(h, request('project-a', 'workspace-a', 'operation-new', 2));
  assert.equal((await h.confirmStopped(leaseReference(old), proof)).released, false); assert.equal((await h.snapshot()).occupied, 1);
  for (const changed of [{ generation: 1 }, { workspaceId: 'workspace-other' }, { projectId: 'project-other' }, { operationId: 'other-op' }, { leaseId: old.leaseId }]) {
    const forged = { ...leaseReference(current), ...changed };
    await assert.rejects(h.confirmStopped(forged, { ...proof, confirmationId: 'stop-forged' }), /scope-denied/);
    await assert.rejects(h.dispatch(forged), /scope-denied/);
  }
  await assert.rejects(h.acquire(request('project-a', 'workspace-a', 'operation-late', 1)), /stale-generation/);
  await assert.rejects(h.acquire(request('project-b', 'workspace-a', 'operation-reowned', 3)), /owner-conflict/);
  assert.equal((await h.snapshot()).occupied, 1);
});
test('never-started atomically stops before dispatch; only one concurrent dispatch gets authorization', async t => {
  const f = fixture(t), h = f.host(), lease = await acquired(h), ref = leaseReference(lease);
  const race = await Promise.all([h.dispatch(ref), h.dispatch(ref)]); assert.equal(race.filter(r => r.authorized).length, 1);
  await assert.rejects(h.confirmStopped(ref, { kind: 'never-started', confirmationId: 'bad', observedAt: f.now }), /stop-not-confirmed/);
  await h.confirmStopped(ref, { kind: 'runtime-stopped', confirmationId: 'stopped', observedAt: f.now });
  const next = await acquired(h, request('project-a', 'workspace-a', 'operation-next', 2));
  const stopped = h.confirmStopped(leaseReference(next), { kind: 'never-started', confirmationId: 'never', observedAt: f.now });
  const delayed = h.dispatch(leaseReference(next)); assert.equal((await stopped).released, true); assert.equal((await delayed).authorized, false);
});
test('an actual SQLite trigger abort rolls back the lease, idempotency row and workspace generation together', async t => {
  const f = fixture(t), h = f.host(); await h.ready();
  f.sql("CREATE TRIGGER fail_acquire BEFORE INSERT ON quota_operations BEGIN SELECT RAISE(ABORT, 'injected-operation-write'); END;");
  await assert.rejects(h.acquire(request()), /injected-operation-write/); assert.equal(await h.lookup('operation-a'), null); assert.equal((await h.snapshot()).occupied, 0);
  f.sql('DROP TRIGGER fail_acquire'); const lease = await acquired(h); assert.equal(lease.generation, 1);
});
test('flush uncertainty never reports authorization or replays a committed dispatch', async t => {
  const f = fixture(t), h = f.host(), lease = await acquired(h); f.failSync(true);
  await assert.rejects(h.dispatch(leaseReference(lease)), /sync-unknown/); f.failSync(false); f.reopen(); const next = f.host();
  assert.equal((await next.lookup('operation-a'))?.lease?.status, 'dispatched'); assert.equal((await next.dispatch(leaseReference(lease))).authorized, false);
  assert.equal((await next.snapshot()).occupied, 1);
});
test('dispatch deadline expiring during its final durable flush cannot return stale authorization', async t => {
  const f = fixture(t), h = f.host(), lease = await acquired(h); let flushes = 0;
  f.storage.sync = async () => { if (++flushes === 2) f.advance(2_001); };
  const dispatch = await h.dispatch(leaseReference(lease)); assert.equal(dispatch.authorized, false); assert.equal(dispatch.lease.expired, true);
  assert.equal((await h.snapshot()).occupied, 1);
});
test('confirmed stop during final dispatch flush fences its stale reply and cannot affect a replacement', async t => {
  const f = fixture(t), h = f.host(), lease = await acquired(h); let flushes = 0;
  f.storage.sync = async () => {
    if (++flushes === 2) {
      await h.confirmStopped(leaseReference(lease), { kind: 'runtime-stopped', confirmationId: 'stop-in-flush', observedAt: f.now });
      await acquired(h, request('project-a', 'workspace-a', 'operation-replacement', 2));
    }
  };
  const reply = await h.dispatch(leaseReference(lease)); assert.equal(reply.authorized, false); assert.equal(reply.lease.status, 'stopped');
  const view = await h.snapshot(); assert.equal(view.occupied, 1); assert.equal(view.leases[0]?.generation, 2);
});
test('unknown acquisition acknowledgement survives disk reopen without allocating another lease', async t => {
  const f = fixture(t), h = f.host(); await h.ready(); f.failSync(true);
  await assert.rejects(h.acquire(request()), /sync-unknown/); f.failSync(false); f.reopen(); const next = f.host();
  const saved = await next.lookup('operation-a'); assert.ok(saved?.lease);
  const repeated = await next.acquire(request()); assert.equal(repeated.outcome, 'replayed'); assert.equal(repeated.lease?.leaseId, saved.lease.leaseId);
  assert.equal((await next.snapshot()).occupied, 1);
});
test('invalid limits, operation, extra fields and reusable stop evidence fail closed', async t => {
  const f = fixture(t), h = f.host();
  for (const change of [{ tenantId: 'tenant-b' }, { generation: NaN }, { generation: Infinity }, { deadlineAt: f.now }, { deadlineAt: f.now + MAX_LEASE_MS + 1 }, { operation: 'recharge' }, { capacity: 9 }]) {
    await assert.rejects(h.acquire({ ...request(), ...change } as LeaseRequest));
  }
  const old = await acquired(h), confirmation = { kind: 'never-started' as const, confirmationId: 'fixed-stop', observedAt: f.now };
  await h.confirmStopped(leaseReference(old), confirmation); const next = await acquired(h, request('project-a', 'workspace-a', 'next-op', 2));
  await assert.rejects(h.confirmStopped(leaseReference(next), confirmation), /confirmation-reused/);
  await assert.rejects(h.confirmStopped(leaseReference(next), { ...confirmation, confirmationId: 'future', observedAt: f.now + 1 }), /observation-time/);
  assert.equal((await h.snapshot()).occupied, 1);
});
