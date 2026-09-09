import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ServiceRunStorage,ServiceRunSpec,ServiceRuntimeReference} from '../../services/run/service.ts';
import {SqlServiceRuntimeSupervisor,type ServiceNativeBackend} from '../../services/run/runtime-supervisor.ts';
import type {ServiceRuntimeInput,ServiceRuntimeObservation} from '../../services/run/runtime-protocol.ts';
const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const actor={userId:'user-a',authVersion:1};
function spec():ServiceRunSpec{return {plan:{schemaVersion:1,kind:'service',source:{kind:'saved-turn',identity:{scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'turn-dispatch',generation:1},revision:{revisionId:'revision-a',objectKey:'saved/revision',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1}},declaration:{schemaVersion:1,runtime:'python',entrypoint:'app/main.py',dependencyLock:'app/requirements.lock',port:8080,healthPath:'/health'},declarationSha256:'c'.repeat(64),entrypointSha256:'d'.repeat(64),dependencyLockSha256:'e'.repeat(64)},runtimeImage:'registry.example/runtime@sha256:'+'f'.repeat(64),maxDurationMs:5000};}
function reference(runId:string):ServiceRuntimeReference{return {runId,runtimeId:'runtime-a',dispatchId:'dispatch-a',leaseId:'lease-a',generation:1,deadlineAt:5000};}
function fixture(t:{after(fn:()=>void):void}){
 const dir=mkdtempSync(join(tmpdir(),'m3-service-')),path=join(dir,'state.sqlite');let db=new DatabaseSync(path),now=1000,fail=false;
 const storage={sql:{exec(query:string,...args:(string|number|null)[]){if(query.includes('CREATE TABLE')){db.exec(query);return {toArray:()=>[]};}const statement=db.prepare(query);const rows=statement.columns().length?statement.all(...args):(statement.run(...args),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},async sync(){if(fail){fail=false;throw Error('injected-ack-loss');}}} as unknown as ServiceRunStorage;
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 return {host:(backend:ServiceNativeBackend)=>new SqlServiceRuntimeSupervisor(storage,scope,backend,()=>now),storage,get db(){return db;},set now(n:number){now=n;},failNextSync(){fail=true;},reopen(){db.close();db=new DatabaseSync(path);}};
}
function input():ServiceRuntimeInput{const ref=reference('run-a');return {reference:ref,scope,spec:spec(),lease:{tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,operation:'service-run',operationId:ref.dispatchId,deadlineAt:ref.deadlineAt,runId:ref.runId,leaseId:ref.leaseId}};}
function observation(i:ServiceRuntimeInput,status:ServiceRuntimeObservation['status']):ServiceRuntimeObservation{return {reference:i.reference,scope:i.scope,status,stop:status==='stopped'?{reference:i.reference,scope:i.scope,confirmationId:'stop-a',observedAt:1000,fenced:true}:null};}
function backend(){let starts=0,stops=0;return {get starts(){return starts;},get stops(){return stops;},async start(i:ServiceRuntimeInput){starts++;return observation(i,'healthy');},async observe(i:ServiceRuntimeInput){return observation(i,'absent');},async fenceAndStop(i:ServiceRuntimeInput){stops++;return observation(i,'stopped');}};}
test('start is persisted once across concurrent calls, lost backend ack and reconstruction',async t=>{
 const f=fixture(t),b=backend(),h=f.host(b);await Promise.all([h.start(input()),h.start(input())]);assert.equal(b.starts,1);
 f.reopen();await f.host(b).start(input());assert.equal(b.starts,1);
});
test('lost start ack never causes a second native start',async t=>{
 const f=fixture(t),b=backend();b.start=async i=>{throw Error('lost-native-ack');};let calls=0;const original=b.start;b.start=async i=>{calls++;return original(i);};
 await assert.rejects(f.host(b).start(input()),/lost-native-ack/);f.reopen();assert.equal((await f.host(b).start(input())).status,'absent');assert.equal(calls,1);
});
test('stop before start durably rejects all later starts including after reconstruction',async t=>{
 const f=fixture(t),b=backend(),h=f.host(b);assert.equal((await h.stop(input())).status,'stopped');f.reopen();const h2=f.host(b);assert.equal((await h2.start(input())).status,'stopped');assert.equal(b.starts,0);assert.equal(b.stops,1);
 assert.equal((await h2.stop(input())).status,'stopped');assert.equal(b.stops,1);
});
test('stop does not wait for a hung start and late healthy ack cannot resurrect service',async t=>{
 const f=fixture(t),b=backend();let resolve!:(x:ServiceRuntimeObservation)=>void,entered!:()=>void;const enteredPromise=new Promise<void>(r=>entered=r);
 b.start=async()=>{entered();return new Promise(r=>resolve=r);};const h=f.host(b),pending=h.start(input());await enteredPromise;
 assert.equal((await h.stop(input())).status,'stopped');resolve(observation(input(),'healthy'));assert.equal((await pending).status,'stopped');
});
test('absent or failed native stop retains fence without inventing stop proof',async t=>{
 const f=fixture(t),b=backend(),h=f.host(b);b.fenceAndStop=async i=>observation(i,'absent');assert.equal((await h.stop(input())).status,'unknown');assert.equal((await h.start(input())).status,'unknown');assert.equal(b.starts,0);
 b.fenceAndStop=async()=>{throw Error('native-stop-unavailable');};await assert.rejects(h.stop(input()),/unavailable/);f.reopen();assert.equal((await f.host(b).start(input())).status,'unknown');
});
test('full immutable identity includes scope, lease, image and source bytes',async t=>{
 const f=fixture(t),b=backend(),h=f.host(b);await h.observe(input());
 for(const mutate of [(i:ServiceRuntimeInput)=>{i.reference.runtimeId='old-runtime';},(i:ServiceRuntimeInput)=>{i.spec.plan.entrypointSha256='0'.repeat(64);},(i:ServiceRuntimeInput)=>{i.spec.runtimeImage='other@sha256:'+'0'.repeat(64);}]){const changed=input();mutate(changed);await assert.rejects(h.start(changed),/identity-conflict/);}
 const wrong=input();wrong.lease.leaseId='wrong';await assert.rejects(h.stop(wrong),/scope-denied/);assert.equal(b.starts,0);
 assert.throws(()=>new SqlServiceRuntimeSupervisor(f.storage,{...scope,tenantId:'other'},b),/scope-denied/);
});
test('unfenced, foreign, future and pre-fence proofs fail closed',async t=>{
 const f=fixture(t),b=backend(),h=f.host(b);b.observe=async i=>observation(i,'stopped');await assert.rejects(h.observe(input()),/unfenced-stop/);
 b.fenceAndStop=async i=>({...observation(i,'stopped'),scope:{...scope,projectId:'other'}});await assert.rejects(h.stop(input()),/scope-denied/);
 b.fenceAndStop=async i=>{const o=observation(i,'stopped');o.stop!.observedAt=1001;return o;};await assert.rejects(h.stop(input()),/stop-receipt/);
 b.fenceAndStop=async i=>{const o=observation(i,'stopped');o.stop!.observedAt=999;return o;};await assert.rejects(h.stop(input()),/unfenced-stop/);
});
test('durability ack loss never sends an unacknowledged start and preserves stop fence',async t=>{
 const f=fixture(t),b=backend(),h=f.host(b);await h.observe(input());f.failNextSync();await assert.rejects(h.start(input()),/ack-loss/);assert.equal(b.starts,0);await h.start(input());assert.equal(b.starts,0);
 f.failNextSync();await assert.rejects(h.stop(input()),/ack-loss/);assert.equal(b.stops,0);await h.start(input());assert.equal(b.starts,0);assert.equal((await h.stop(input())).status,'stopped');
});
test('expired dispatch is never sent to native start',async t=>{const f=fixture(t),b=backend(),h=f.host(b);f.now=5000;assert.equal((await h.start(input())).status,'unknown');assert.equal(b.starts,0);});
test('stop committed during start durability wait suppresses native dispatch',async t=>{
 const f=fixture(t),b=backend(),h=f.host(b);await h.observe(input());
 const normal=f.storage.sync.bind(f.storage);let release!:()=>void,entered!:()=>void;const entering=new Promise<void>(r=>entered=r);let hold=true;
 f.storage.sync=async()=>{if(hold){hold=false;entered();await new Promise<void>(r=>release=r);}await normal();};
 const starting=h.start(input());await entering;assert.equal((await h.stop(input())).status,'stopped');release();assert.equal((await starting).status,'stopped');assert.equal(b.starts,0);
});
test('failed SQLite start transaction can retry only because no native dispatch occurred',async t=>{
 const f=fixture(t),b=backend(),h=f.host(b);await h.observe(input());
 f.db.exec("CREATE TRIGGER abort_attempt BEFORE UPDATE OF attempted ON service_runtime_fence BEGIN SELECT RAISE(ABORT,'injected-sql-error'); END");
 await assert.rejects(h.start(input()),/sql-error/);assert.equal(b.starts,0);f.db.exec('DROP TRIGGER abort_attempt');assert.equal((await h.start(input())).status,'healthy');assert.equal(b.starts,1);
});
test('caller mutation after invocation cannot replace frozen source',async t=>{
 const f=fixture(t),b=backend(),h=f.host(b),original=input();let seen:ServiceRuntimeInput|undefined;b.start=async i=>{seen=i;return observation(i,'healthy');};
 const work=h.start(original);original.spec.plan.entrypointSha256='0'.repeat(64);original.reference.runtimeId='changed';assert.equal((await work).status,'healthy');assert.deepEqual(seen,input());
});
