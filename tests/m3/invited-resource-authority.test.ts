import assert from 'node:assert/strict';
import test from 'node:test';
import {SqlTenantQuota,leaseReference,readTenantNativeExecutionQuiet,type LeaseRequest} from '../../services/quota/core.ts';
import {G5WindowGuard,readG5NativeExecutionQuiet} from '../../services/model-budget/g5-window.ts';
import {fixture} from './run-fixture.ts';
test('historical quota and G5 proof on untouched original actors creates no schema or pin',t=>{
 const f=fixture(t),tables=()=>f.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
 assert.deepEqual(tables(),[]);assert.deepEqual(readTenantNativeExecutionQuiet(f.storage,'tenant-a',f.now),{tenantId:'tenant-a',quiescent:true});
 assert.deepEqual(readG5NativeExecutionQuiet(f.storage),{schemaVersion:1,quiescent:true,tenantIds:[],tasks:0});assert.deepEqual(tables(),[]);
});
for(const operation of ['simulation-run','service-run'] as const)for(const state of ['held','dispatched','unknown'] as const)test(`original ${operation} ${state} denies new native capacity without mutating original rows`,async t=>{
 const f=fixture(t),core=new SqlTenantQuota(f.storage,{tenantId:'tenant-a',capacity:2,version:'original-v1'},()=>f.now),request:LeaseRequest={tenantId:'tenant-a',projectId:'old-project',workspaceId:'old-workspace',generation:1,operation,operationId:'old-run',runId:'old-run',deadlineAt:f.now+600000};
 const lease=(await core.acquire(request)).lease!,reference=leaseReference(lease);
 if(state!=='held')await core.dispatch(reference);if(state==='unknown')await core.markUnknown(reference);
 const before=JSON.stringify(f.db.prepare('SELECT * FROM quota_leases').all());
 assert.throws(()=>readTenantNativeExecutionQuiet(f.storage,'tenant-a',f.now),/quota-native-execution-unconfirmed/);assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM quota_leases').all()),before);
 await core.confirmStopped(reference,{kind:state==='held'?'never-started':'runtime-stopped',confirmationId:'original-proof',observedAt:f.now});assert.equal(readTenantNativeExecutionQuiet(f.storage,'tenant-a',f.now).quiescent,true);
});
test('healthy original workspace preview lease retains its separate rule; expired or unknown lease never proves quiet',async t=>{
 const f=fixture(t),core=new SqlTenantQuota(f.storage,{tenantId:'tenant-a',capacity:2,version:'original-v1'},()=>f.now),request:LeaseRequest={tenantId:'tenant-a',projectId:'old-project',workspaceId:'old-workspace',generation:1,operation:'workspace-runtime',operationId:'old-workspace',deadlineAt:f.now+1000};
 const lease=(await core.acquire(request)).lease!;assert.equal(readTenantNativeExecutionQuiet(f.storage,'tenant-a',f.now).quiescent,true);f.now+=1000;
 assert.throws(()=>readTenantNativeExecutionQuiet(f.storage,'tenant-a',f.now),/quota-native-execution-unconfirmed/);await core.markUnknown(leaseReference(lease));assert.throws(()=>readTenantNativeExecutionQuiet(f.storage,'tenant-a',f.now),/quota-native-execution-unconfirmed/);
});
test('historical closed G5 window unknown native grant is read-only and cannot be excluded by current window or tenant',t=>{
 const f=fixture(t);new G5WindowGuard(f.storage,null,()=>f.now);
 f.db.prepare("INSERT INTO g5_windows VALUES('old-window','{}',1,1)").run();
 f.db.prepare("INSERT INTO g5_tasks(window_id,key,document,bound_id,accepted_at,state,start_at,start_grant,start_confirmed) VALUES('old-window',?,?,?,1,'started',2,'grant',0)").run('a'.repeat(64),JSON.stringify({tenantId:'old-revoked-tenant',kind:'service'}),'old-run');
 const before=JSON.stringify(f.db.prepare('SELECT * FROM g5_tasks').all());assert.throws(()=>readG5NativeExecutionQuiet(f.storage),/g5-window-native-execution-unconfirmed/);assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM g5_tasks').all()),before);
 f.db.prepare('UPDATE g5_tasks SET start_confirmed=1').run();assert.deepEqual(readG5NativeExecutionQuiet(f.storage),{schemaVersion:1,quiescent:true,tenantIds:['old-revoked-tenant'],tasks:1});assert.equal(f.db.prepare('SELECT closed FROM g5_windows').get()!.closed,1);
});
