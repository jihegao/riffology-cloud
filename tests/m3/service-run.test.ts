import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqlServiceRunJournal,type ServiceRunStorage,type ServiceRunSpec,type ServiceRuntimeReference} from '../../services/run/service.ts';
const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const actor={userId:'user-a',authVersion:1};
function spec():ServiceRunSpec{return {plan:{schemaVersion:1,kind:'service',identity:{scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'turn-dispatch',generation:1},revision:{revisionId:'revision-a',objectKey:'saved/revision',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1},declaration:{schemaVersion:1,runtime:'python',entrypoint:'app/main.py',dependencyLock:'app/requirements.lock',port:8080,healthPath:'/health'},declarationSha256:'c'.repeat(64),entrypointSha256:'d'.repeat(64),dependencyLockSha256:'e'.repeat(64)},runtimeImage:'registry.example/runtime@sha256:'+'f'.repeat(64),maxDurationMs:5000};}
function reference(runId:string):ServiceRuntimeReference{return {runId,runtimeId:'runtime-a',dispatchId:'dispatch-a',leaseId:'lease-a',generation:1,deadlineAt:5000};}
function fixture(t:{after(fn:()=>void):void}){
 const dir=mkdtempSync(join(tmpdir(),'m3-service-')),path=join(dir,'state.sqlite');let db=new DatabaseSync(path),now=1000,fail=false,seq=0;
 const storage={sql:{exec(query:string,...args:(string|number|null)[]){if(query.includes('CREATE TABLE')){db.exec(query);return {toArray:()=>[]};}const statement=db.prepare(query);const rows=statement.columns().length?statement.all(...args):(statement.run(...args),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},async sync(){if(fail){fail=false;throw Error('injected-ack-loss');}}} as unknown as ServiceRunStorage;
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 return {host:()=>new SqlServiceRunJournal(storage,scope,()=>now,()=>`run-${++seq}`),storage,get db(){return db;},set now(n:number){now=n;},failNextSync(){fail=true;},reopen(){db.close();db=new DatabaseSync(path);}};
}
test('service creation freezes source/image and durable intent across reopen',async t=>{
 const f=fixture(t),h=f.host(),input=spec(),r=await h.create(actor,'key-a',input);input.plan.declaration.entrypoint='app/changed.py';
 assert.equal(r.spec.plan.declaration.entrypoint,'app/main.py');f.reopen();const h2=f.host();assert.deepEqual(await h2.create(actor,'key-a',spec()),r);
 await assert.rejects(h2.create(actor,'key-a',input),/intent-conflict/);
 const invalid=spec();invalid.plan.identity.scope={...scope,tenantId:'tenant-b'};await assert.rejects(h2.create(actor,'cross',invalid),/scope-denied/);
 assert.throws(()=>new SqlServiceRunJournal(f.storage,{...scope,projectId:'other'}),/scope-denied/);
 await assert.rejects(h2.create(actor,'mutable-image',{...spec(),runtimeImage:'runtime:latest'}),/runtime-image/);
});
test('concurrent begin and lost persistence acknowledgement never grant a second dispatch',async t=>{
 const f=fixture(t),h=f.host(),r=await h.create(actor,'key-a',spec()),ref=reference(r.id);
 const starts=await Promise.all([h.begin(ref),h.begin(ref)]);assert.deepEqual(starts.map(x=>x.dispatch),[true,false]);
 await assert.rejects(h.begin({...ref,runtimeId:'replacement'}),/start-conflict/);
 const second=await h.create(actor,'key-b',spec()),secondRef={...reference(second.id),runtimeId:'runtime-b'};
 f.failNextSync();await assert.rejects(h.begin(secondRef),/ack-loss/);f.reopen();const recovered=await f.host().begin(secondRef);assert.equal(recovered.dispatch,false);assert.equal(recovered.record.status,'starting');
});
test('stop fences late health and unknown work until matching stopped proof',async t=>{
 const f=fixture(t),h=f.host(),r=await h.create(actor,'key-a',spec()),ref=reference(r.id);await h.begin(ref);await h.healthy(ref);
 assert.equal((await h.unknown(ref)).status,'unknown');assert.equal((await h.requestStop(r.id)).status,'stopping');
 await assert.rejects(h.healthy(ref),/health-denied/);assert.equal((await h.unknown(ref)).status,'stopping');
 await assert.rejects(h.confirmStopped({...ref,leaseId:'other'},{confirmationId:'stop-a',observedAt:1000,outcome:'stopped',errorCode:null}),/scope-denied/);
 const proof={confirmationId:'stop-a',observedAt:1000,outcome:'stopped' as const,errorCode:null};assert.equal((await h.confirmStopped(ref,proof)).status,'stopped');
 f.reopen();const restored=f.host();assert.equal((await restored.confirmStopped(ref,proof)).status,'stopped');
 await assert.rejects(restored.confirmStopped(ref,{...proof,confirmationId:'stop-b'}),/stop-conflict/);await assert.rejects(restored.healthy(ref),/health-denied/);
});
test('cancel before dispatch never starts and expired service cannot be healthy',async t=>{
 const f=fixture(t),h=f.host(),r=await h.create(actor,'key-a',spec());assert.equal((await h.requestStop(r.id)).status,'cancelled');await assert.rejects(h.begin(reference(r.id)),/start-denied/);
 const second=await h.create(actor,'key-b',spec()),ref=reference(second.id);await h.begin(ref);f.now=5000;await assert.rejects(h.healthy(ref),/health-denied/);assert.equal((await h.get(second.id)).status,'starting');
 assert.equal((await h.confirmStopped(ref,{confirmationId:'expired-stop',observedAt:5000,outcome:'failed',errorCode:'deadline-exceeded'})).status,'failed');
});
test('SQLite failure rolls back start record and its dispatch fence together',async t=>{
 const f=fixture(t),h=f.host(),r=await h.create(actor,'key-a',spec()),ref=reference(r.id);
 f.db.exec("CREATE TRIGGER abort_start BEFORE UPDATE OF start_json ON service_runs BEGIN SELECT RAISE(ABORT,'injected-sql-failure'); END");
 await assert.rejects(h.begin(ref),/sql-failure/);assert.equal((await h.get(r.id)).status,'queued');
 f.db.exec('DROP TRIGGER abort_start');assert.equal((await h.begin(ref)).dispatch,true);
});
test('stop proof is detached before await and cannot predate the recorded dispatch',async t=>{
 const f=fixture(t),h=f.host(),r=await h.create(actor,'key-a',spec()),ref=reference(r.id);f.now=2000;await h.begin(ref);f.now=3000;
 await assert.rejects(h.confirmStopped(ref,{confirmationId:'too-old',observedAt:1500,outcome:'stopped',errorCode:null}),/stop-proof/);
 const proof={confirmationId:'valid-stop',observedAt:2500,outcome:'stopped' as const,errorCode:null};
 const saving=h.confirmStopped(ref,proof);Object.assign(proof,{outcome:'running',observedAt:9000});
 assert.equal((await saving).status,'stopped');assert.equal((await h.get(r.id)).status,'stopped');
});
