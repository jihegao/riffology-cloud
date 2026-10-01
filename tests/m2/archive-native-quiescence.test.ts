import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {SqlTenantQuota,leaseReference,readProjectNativeQuiescence,type QuotaStorage,type LeaseRequest} from '../../services/quota/core.ts';
import {G5WindowGuard,readG5ProjectNativeQuiescence} from '../../services/model-budget/g5-window.ts';
import type {ModelBudgetStorage} from '../../services/model-budget/core.ts';
import type {TurnScope} from '../../services/turn/protocol.ts';

const scope:TurnScope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-new',workspaceGeneration:7};
function fixture(t:{after(fn:()=>void):void}){
 const db=new DatabaseSync(':memory:');let syncs=0;t.after(()=>db.close());
 const storage={sql:{exec(query:string,...bindings:(string|number|null)[]){
  if(query.includes('CREATE TABLE')){db.exec(query);return {toArray:()=>[]};}
  const statement=db.prepare(query),rows=statement.columns().length?statement.all(...bindings):(statement.run(...bindings),[]);
  return {toArray:()=>structuredClone(rows)};
 }},transactionSync<T>(fn:()=>T){db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}},sync:async()=>{syncs++;}} as unknown as QuotaStorage&ModelBudgetStorage;
 const snapshot=()=>JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all().map(row=>[row,...(row.sql&&String(row.sql).startsWith('CREATE TABLE')?db.prepare(`SELECT * FROM ${row.name}`).all():[])]));
 return {db,storage,snapshot,get syncs(){return syncs;}};
}

test('before-first-execution archive proofs leave both original ledgers entirely uninitialized',t=>{
 const f=fixture(t),before=f.snapshot();
 assert.deepEqual(readProjectNativeQuiescence(f.storage,scope),{scope,quiescent:true,unreleasedLeases:0});
 assert.deepEqual(readG5ProjectNativeQuiescence(f.storage,scope),{scope,quiescent:true,unconfirmedStarts:0,ambiguousStarts:0});
 assert.equal(f.snapshot(),before);assert.equal(f.syncs,0);
});

test('original quota includes orphan resources and earlier project generations without rewriting them',async t=>{
 const f=fixture(t),quota=new SqlTenantQuota(f.storage,{tenantId:scope.tenantId,capacity:4,version:'original-v1'},()=>1000);await quota.ready();
 const refs=[];
 for(const operation of ['workspace-runtime','simulation-run','service-run'] as const){
  const request:LeaseRequest={tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:'workspace-old',generation:1,operationId:'orphan-'+operation,deadlineAt:2000,...(operation==='workspace-runtime'?{operation}:{operation,runId:'orphan-'+operation})};
  const lease=(await quota.acquire(request)).lease!;const ref=leaseReference(lease);refs.push(ref);await quota.dispatch(ref);await quota.markUnknown(ref);
 }
 const before=f.snapshot(),syncs=f.syncs;
 assert.deepEqual(readProjectNativeQuiescence(f.storage,scope),{scope,quiescent:false,unreleasedLeases:3});
 assert.equal(f.snapshot(),before);assert.equal(f.syncs,syncs);
 for(const ref of refs)await quota.confirmStopped(ref,{kind:'runtime-stopped',confirmationId:'stop-'+ref.operationId,observedAt:1000});
 const request={tenantId:scope.tenantId,projectId:'project-other',workspaceId:'workspace-other',generation:1,operation:'simulation-run' as const,operationId:'other-unknown',runId:'other-unknown',deadlineAt:2000};
 const ref=leaseReference((await quota.acquire(request)).lease!);await quota.dispatch(ref);await quota.markUnknown(ref);
 const unchanged=f.snapshot();assert.deepEqual(readProjectNativeQuiescence(f.storage,scope),{scope,quiescent:true,unreleasedLeases:0});assert.equal(f.snapshot(),unchanged);
 assert.throws(()=>readProjectNativeQuiescence(f.storage,{...scope,tenantId:'tenant-other'}),/native-execution-unconfirmed/);
});

test('incomplete original native ledgers cannot become positive archive proofs',t=>{
 const f=fixture(t);f.db.exec('CREATE TABLE quota_meta(singleton INTEGER,tenant_id TEXT)');
 assert.throws(()=>readProjectNativeQuiescence(f.storage,scope),/native-execution-unconfirmed/);
 f.db.exec('CREATE TABLE g5_tasks(key TEXT)');assert.throws(()=>readG5ProjectNativeQuiescence(f.storage,scope),/schema-incomplete/);
});

function seedG5(f:ReturnType<typeof fixture>,key:string,kind:string,tenantId:string,projectId:string|null,parent:string|null=null){
 const identity=projectId===null?null:{scope:{...scope,tenantId,projectId,workspaceId:'workspace-old',workspaceGeneration:1},sessionId:'session-'+key,turnId:'turn-'+key,dispatchId:'dispatch-'+key,generation:1};
 const document={tenantId,userId:'owner',kind,key,intentKeySha256:'a'.repeat(64),digest:'b'.repeat(64)};
 f.db.prepare("INSERT INTO g5_tasks(window_id,key,document,bound_id,accepted_at,state,parent_turn_key,runtime_identity,start_at,start_grant,start_confirmed) VALUES('historical',?,?,?,?, 'started',?,?,1000,?,0)").run(key,JSON.stringify(document),identity?.turnId??'run-'+key,1000,parent,identity===null?null:JSON.stringify(identity),'grant-'+key);
}

test('G5 project-correlated native grants include earlier generations and preserve source receipts',t=>{
 const f=fixture(t);new G5WindowGuard(f.storage,null);seedG5(f,'parent','turn',scope.tenantId,scope.projectId);seedG5(f,'child','simulation',scope.tenantId,null,'parent');seedG5(f,'unrelated','turn',scope.tenantId,'project-other');
 const before=f.snapshot();assert.deepEqual(readG5ProjectNativeQuiescence(f.storage,scope),{scope,quiescent:false,unconfirmedStarts:2,ambiguousStarts:0});assert.equal(f.snapshot(),before);assert.equal(f.syncs,0);
 f.db.prepare("UPDATE g5_tasks SET start_confirmed=1 WHERE key IN ('parent','child')").run();const unchanged=f.snapshot();
 assert.deepEqual(readG5ProjectNativeQuiescence(f.storage,scope),{scope,quiescent:true,unconfirmedStarts:0,ambiguousStarts:0});assert.equal(f.snapshot(),unchanged);
});

test('legacy G5 simulation/service grants with no project proof block only their tenant',t=>{
 const f=fixture(t);new G5WindowGuard(f.storage,null);seedG5(f,'ambiguous-run','simulation',scope.tenantId,null);seedG5(f,'ambiguous-service','service',scope.tenantId,null);seedG5(f,'foreign-run','simulation','tenant-other',null);
 const before=f.snapshot();assert.deepEqual(readG5ProjectNativeQuiescence(f.storage,scope),{scope,quiescent:false,unconfirmedStarts:2,ambiguousStarts:2});assert.equal(f.snapshot(),before);
 assert.deepEqual(readG5ProjectNativeQuiescence(f.storage,{...scope,tenantId:'tenant-clean'}),{scope:{...scope,tenantId:'tenant-clean'},quiescent:true,unconfirmedStarts:0,ambiguousStarts:0});assert.equal(f.snapshot(),before);
});
