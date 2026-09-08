import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlTenantQuota, leaseReference, MAX_LEASE_MS, type QuotaStorage, type LeaseRequest, type Lease } from '../../services/quota/core.ts';

function fixture(t: { after: (fn: () => void) => void }, capacity = 2) {
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
  const policy = { tenantId: 'tenant-a', capacity, version: 'invite-v1' };
  const host = () => new SqlTenantQuota(storage, policy, () => now);
  t.after(() => { database.close(); rmSync(directory, { recursive: true }); });
  return { storage, policy, host, get now() { return now; }, advance(value: number) { now = value; }, failSync(value: boolean) { failSync = value; },
    sql(query: string) { database.exec(query); }, reopen() { database.close(); database = new DatabaseSync(filename); configure(); } };
}
const workspace = (operationId = 'workspace-op', generation = 1): LeaseRequest => ({tenantId:'tenant-a', projectId:'project-a', workspaceId:'workspace-a', operation:'workspace-runtime', operationId,generation,deadlineAt:2_000});
const service = (operationId = 'service-op', generation = 1, runId = 'run-a'): LeaseRequest => ({...workspace(operationId,generation), operation:'service-run',runId});
async function acquired(host: SqlTenantQuota, input: LeaseRequest): Promise<Lease> {
  const result = await host.acquire(input); assert.equal(result.outcome,'acquired'); assert.ok(result.lease); return result.lease;
}
const proof = (confirmationId: string) => ({kind:'runtime-stopped' as const,confirmationId,observedAt:1_000});

test('independent service and workspace coexist, share capacity and survive reopen without generation pollution', async t => {
  const f=fixture(t), h=f.host();
  const a=await acquired(h,service('service-op',9));
  const b=await acquired(h,workspace());
  assert.equal((await h.snapshot()).occupied,2);
  assert.equal((await h.acquire(service('second-service',1,'run-b'))).denial,'quota-exhausted');
  assert.equal((await h.acquire(service('same-service',10))).denial,'run-held');
  assert.equal((await h.acquire(workspace('same-workspace',2))).denial,'workspace-held');
  f.reopen(); const next=f.host(); assert.equal((await next.snapshot()).occupied,2);
  assert.deepEqual((await next.acquire(service('service-op',9))).lease,a);
  await next.confirmStopped(leaseReference(b),proof('workspace-stop'));
  assert.equal((await acquired(next,workspace('replacement',2))).generation,2);
  assert.equal((await next.lookup('service-op'))?.lease?.generation,9);
});

test('workspace and service compete transactionally for the last tenant slot', async t => {
  const f=fixture(t,1), a=f.host(), b=f.host();
  const results=await Promise.all([a.acquire(service()),b.acquire(workspace())]);
  assert.deepEqual(results.map(r=>r.outcome).sort(),['acquired','denied']);
  assert.equal(results.find(r=>r.outcome==='denied')?.denial,'quota-exhausted');
  assert.equal((await a.snapshot()).occupied,1);
});

test('run ownership and generations fence replacements; old confirmation cannot release a new runtime', async t => {
  const f=fixture(t), h=f.host(), old=await acquired(h,service());
  await h.confirmStopped(leaseReference(old),proof('old-stop'));
  const current=await acquired(h,service('new-op',2));
  assert.equal((await h.confirmStopped(leaseReference(old),proof('old-stop'))).released,false);
  for(const changed of [{runId:'other-run'},{workspaceId:'other-workspace'},{projectId:'other-project'},{generation:1},{leaseId:old.leaseId}]) {
    const forged={...leaseReference(current),...changed};
    await assert.rejects(h.dispatch(forged),/scope-denied/);
    await assert.rejects(h.confirmStopped(forged,proof('forged-stop')),/scope-denied/);
  }
  await assert.rejects(h.acquire(service('stale',1)),/stale-generation/);
  await assert.rejects(h.acquire({...service('reown',3),workspaceId:'workspace-b'}),/owner-conflict/);
  await assert.rejects(h.acquire({...workspace('reown-workspace'),projectId:'project-b'}),/owner-conflict/);
  await assert.rejects(h.acquire({...service('reown-project',3),projectId:'project-b'}),/owner-conflict/);
  await assert.rejects(h.acquire({...service('cross-tenant',3),tenantId:'tenant-b'}),/scope-denied/);
  assert.equal((await h.snapshot()).occupied,1);
});

test('expired or uncertain service stop retains capacity and cannot be released by never-started', async t => {
  const f=fixture(t,1),h=f.host(),a=await acquired(h,service());
  await h.dispatch(leaseReference(a));f.advance(2_001);
  assert.equal((await h.reconcile()).unknown,1);f.reopen();const next=f.host();
  assert.equal((await next.snapshot()).available,0);
  await assert.rejects(next.confirmStopped(leaseReference(a),{kind:'never-started',confirmationId:'wrong',observedAt:2_001}),/stop-not-confirmed/);
  await next.confirmStopped(leaseReference(a),{...proof('confirmed'),observedAt:2_001});
  assert.equal((await next.snapshot()).available,1);
});

test('service requires explicit run id and workspace requests reject service fields', async t => {
  const f=fixture(t),h=f.host();
  const {runId:ignored,...missing}=service() as LeaseRequest & {runId:string};
  for(const input of [missing,{...service(),runId:''},{...workspace(),runId:'run-a'}]) await assert.rejects(h.acquire(input as LeaseRequest));
  await acquired(h,workspace());
  await assert.rejects(h.acquire(service('workspace-op')),/idempotency-conflict/);
});

test('legacy SQLite schema migrates existing active and stopped leases plus denied intents without losing replay', async t => {
  const f=fixture(t);
  f.sql(`CREATE TABLE quota_meta(singleton INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,capacity INTEGER NOT NULL,policy_version TEXT NOT NULL);
    INSERT INTO quota_meta VALUES(1,'tenant-a',2,'invite-v1');
    CREATE TABLE quota_workspaces(workspace_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,generation INTEGER NOT NULL);
    INSERT INTO quota_workspaces VALUES('workspace-a','project-a',2);
    CREATE TABLE quota_operations(operation_id TEXT PRIMARY KEY,request_json TEXT NOT NULL,lease_id TEXT,denial TEXT,
      CHECK((lease_id IS NULL AND denial IN ('quota-exhausted','workspace-held')) OR (lease_id IS NOT NULL AND denial IS NULL)));
    CREATE TABLE quota_leases(lease_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,workspace_id TEXT NOT NULL,
      request_json TEXT NOT NULL,status TEXT NOT NULL,acquired_at INTEGER NOT NULL,deadline_at INTEGER NOT NULL,
      dispatched_at INTEGER,unknown_at INTEGER,stopped_at INTEGER,confirmation_id TEXT UNIQUE,confirmation_json TEXT);
    CREATE UNIQUE INDEX quota_workspace_occupied ON quota_leases(workspace_id) WHERE status!='stopped';`);
  const canonical=(r:LeaseRequest)=>JSON.stringify({tenantId:r.tenantId,projectId:r.projectId,workspaceId:r.workspaceId,generation:r.generation,
    operation:r.operation,operationId:r.operationId,deadlineAt:r.deadlineAt});
  const old=workspace('old-op',1),active=workspace('active-op',2),denied=workspace('denied-op',3);
  const savedProof={kind:'runtime-stopped',confirmationId:'old-confirmation',observedAt:1_000};
  f.storage.sql.exec("INSERT INTO quota_leases VALUES(?,?,?,?,'stopped',1000,2000,1000,NULL,1000,?,?)",'old-lease',old.operationId,old.workspaceId,canonical(old),'old-confirmation',JSON.stringify(savedProof));
  f.storage.sql.exec("INSERT INTO quota_leases VALUES(?,?,?,?,'dispatched',1000,2000,1000,NULL,NULL,NULL,NULL)",'active-lease',active.operationId,active.workspaceId,canonical(active));
  for(const r of [old,active]) f.storage.sql.exec('INSERT INTO quota_operations VALUES(?,?,?,NULL)',r.operationId,canonical(r),r===old?'old-lease':'active-lease');
  f.storage.sql.exec("INSERT INTO quota_operations VALUES(?,?,NULL,'workspace-held')",denied.operationId,canonical(denied));
  f.reopen(); const h=f.host();
  assert.equal((await h.acquire(active)).lease?.leaseId,'active-lease');
  assert.equal((await h.acquire(old)).lease?.status,'stopped');
  assert.equal((await h.acquire(denied)).denial,'workspace-held');
  await assert.rejects(h.acquire(workspace('late-op',1)),/stale-generation/);
  await acquired(h,service());
  f.reopen();const reopened=f.host();assert.equal((await reopened.snapshot()).occupied,2);
  assert.equal((await reopened.lookup('old-op'))?.lease?.confirmation?.confirmationId,'old-confirmation');
  const activeLease=(await reopened.lookup('active-op'))!.lease!;
  await reopened.confirmStopped(leaseReference(activeLease),proof('active-confirmed'));
  await acquired(reopened,workspace('workspace-replacement',3));
  assert.equal((await reopened.lookup('denied-op'))?.denial,'workspace-held');
});
