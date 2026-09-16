import {GROUP_RESERVATION} from '../../services/simulation/group-state.ts';
import {simulationToken} from '../../services/simulation/native.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SimulationHost,publicExperiment,publishSimulationResult,type SimulationPorts} from '../../services/simulation/host.ts';
import {modelVersion,digest,type SimulationPlan} from '../../services/simulation/source.ts';
import {SqlTenantQuota} from '../../services/quota/core.ts';
import {fixture,scope,actor,spec as serviceSpec} from './run-fixture.ts';
import {SIMULATION_WAKE_KEY,TURN_WAKE_KEY} from '../../services/workspace/shared-alarm.ts';
const spec={schemaVersion:1 as const,researchQuestion:'Queue?',scope:'One queue',entities:['customer'],mechanisms:['FCFS'],assumptions:[],parameters:{servers:{type:'integer' as const,default:1,minimum:1,maximum:4}},metrics:{wait:{unit:'min'}},limitations:[],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
const plan:SimulationPlan={source:serviceSpec().plan.source,spec,specSha256:'1'.repeat(64),entrypointSha256:'2'.repeat(64),dependencyLockSha256:'3'.repeat(64)};
function setup(t:Parameters<typeof fixture>[0]){
 const q=fixture(t),quota=new SqlTenantQuota(q.storage,{tenantId:scope.tenantId,capacity:1,version:'v1'},()=>q.now);
 const dir=mkdtempSync(join(tmpdir(),'simulation-host-')),file=join(dir,'state.db');let db=new DatabaseSync(file),fail=false;db.exec('CREATE TABLE kv(k TEXT PRIMARY KEY,v TEXT)');
 const get=async<T,>(key:string):Promise<T|undefined>=>{const row=db.prepare('SELECT v FROM kv WHERE k=?').get(key);return row?JSON.parse(String(row.v)):undefined;};
 const put=async(key:string,value:unknown)=>{db.prepare('INSERT OR REPLACE INTO kv VALUES(?,?)').run(key,JSON.stringify(value));};
 const list=async<T,>(options:{prefix:string})=>new Map(db.prepare('SELECT k,v FROM kv WHERE k LIKE ? ORDER BY k').all(options.prefix+'%').map(r=>[String(r.k),JSON.parse(String(r.v)) as T]));
 const transaction={get,put,list,delete:async(key:string)=>{db.prepare('DELETE FROM kv WHERE k=?').run(key);},setAlarm:async(at:number)=>put('alarm',at),deleteAlarm:async()=>{db.prepare("DELETE FROM kv WHERE k='alarm'").run();}};
 const storage={...transaction,transaction:async<T,>(fn:(tx:typeof transaction)=>Promise<T>)=>{db.exec('BEGIN IMMEDIATE');try{const value=await fn(transaction);db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}},sync:async()=>{if(fail){fail=false;throw Error('lost-ack');}}} as unknown as DurableObjectStorage;
 let starts=0,stops=0,publishes=0,observes=0,nativeResult=false,failStart=false,failRelease=false;
 const stopped=()=>({status:'stopped' as const,stop:{confirmationId:'a'.repeat(64),observedAt:q.now,fenced:true as const},result:nativeResult?{exitCode:0,result:{schemaVersion:1,metrics:{wait:2}},pythonVersion:'3.11.1'}:null});
 const ports:SimulationPorts={quota:{acquire:r=>quota.acquire(r),lookup:(_t,id)=>quota.lookup(id),dispatch:r=>quota.dispatch(r),confirmStopped:async(r,p)=>{const result=await quota.confirmStopped(r,p);if(failRelease){failRelease=false;throw Error('lost-release-ack');}return result;}},start:async()=>{starts++;if(failStart)throw Error('lost-start-ack');return {status:'running',result:null,stop:null};},observe:async()=>{observes++;return nativeResult?stopped():{status:'running',result:null,stop:null};},stop:async()=>{stops++;return stopped();},destroy:async()=>{},running:async()=>false,publish:async()=>{publishes++;return {metrics:{wait:2},artifactSha256:'9'.repeat(64)};},authorize:async()=>true,hold:()=>{}};
 const host=()=>new SimulationHost(storage,scope,ports,()=>q.now,{durationMs:10000,releaseGuardMs:100,quietMs:50});
 const request={...modelVersion(plan),parameters:{servers:2},seed:42};
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 return {q,storage,ports,host,request,get starts(){return starts;},get observes(){return observes;},get stops(){return stops;},get publishes(){return publishes;},complete(){nativeResult=true;},loseStart(){failStart=true;},loseRelease(){failRelease=true;},loseSync(){fail=true;},reopen(){db.close();db=new DatabaseSync(file);}};
}
test('durable receipt and shared alarm survive lost ack/reopen; same key freezes one run',async t=>{
 const f=setup(t),h=f.host();await f.storage.put(TURN_WAKE_KEY,1200);f.loseSync();await assert.rejects(h.submit(actor,'key',f.request,plan,'image',()=>true),/lost-ack/);f.reopen();
 const r=await f.host().submit(actor,'key',f.request,plan,'image',()=>{throw Error('must not refreeze');});assert.equal((await h.list()).items.length,1);assert.equal(await f.storage.get('alarm'),1200);assert.equal(await f.storage.get(SIMULATION_WAKE_KEY),3000);assert.equal(f.starts,0);
 await assert.rejects(h.submit(actor,'key',{...f.request,seed:43},plan,'image',()=>true),/conflict/);assert.equal(r.input.seed,42);
});
test('parameter validation and head conflicts reject before quota or native side effects',async t=>{
 const f=setup(t),h=f.host();await assert.rejects(h.submit(actor,'invalid',{...f.request,parameters:{servers:99}},plan,'image',()=>true));await assert.rejects(h.submit(actor,'stale',f.request,plan,'image',()=>false),/stale/);assert.equal((await h.list()).items.length,0);assert.equal((await f.ports.quota.lookup(scope.tenantId,'invalid')),null);assert.equal(f.starts,0);
});
test('lost start acknowledgement only observes original native execution after reopen',async t=>{
 const f=setup(t),h=f.host(),r=await h.submit(actor,'run',f.request,plan,'image',()=>true);f.loseStart();await h.alarm();assert.equal((await h.get(r.runId)).status,'unknown');f.reopen();await f.host().alarm();assert.equal(f.starts,1);assert.equal(f.observes,1);assert.equal((await h.get(r.runId)).status,'running');
});
test('completed result persists before release; release ack retry uses identical proof',async t=>{
 const f=setup(t),h=f.host(),r=await h.submit(actor,'run',f.request,plan,'image',()=>true);await h.alarm();f.complete();await h.alarm();assert.equal((await h.get(r.runId)).status,'completed');assert.equal((await h.get(r.runId)).released,false);assert.equal(f.publishes,1);
 await h.alarm();f.q.now+=101;f.loseRelease();await h.alarm();assert.equal((await h.get(r.runId)).released,false);f.q.now+=20;f.reopen();await f.host().alarm();assert.equal((await h.get(r.runId)).released,true);assert.equal(f.starts,1);assert.equal(publicExperiment(await h.get(r.runId),'f'.repeat(64)).stale,true);
});
test('cancel accepted run without execution; cancel running requires native proof',async t=>{
 const f=setup(t),h=f.host(),r=await h.submit(actor,'cancel-before',f.request,plan,'image',()=>true);await h.cancel(r.runId);await h.alarm();assert.equal(f.starts,0);assert.equal((await h.get(r.runId)).status,'cancelled');
 const second=await h.submit(actor,'cancel-after',f.request,plan,'image',()=>true);await h.alarm();await h.cancel(second.runId);await h.alarm();assert.equal(f.stops,1);assert.equal((await h.get(second.runId)).status,'cancelled');assert.equal((await h.get(second.runId)).released,false);
});
test('invalid output never becomes a completed finding',async t=>{
 const f=setup(t),h=f.host(),r=await h.submit(actor,'bad',f.request,plan,'image',()=>true);await h.alarm();f.complete();f.ports.publish=async()=>{throw Error('simulation-result-invalid');};await h.alarm();assert.equal((await h.get(r.runId)).status,'failed');assert.equal((await h.get(r.runId)).result,null);
});
test('result store copies exact frozen metadata and verifies conditional write acknowledgement',async t=>{
 const f=setup(t),r=await f.host().submit(actor,'publish',f.request,plan,'image',()=>true);let key='',body='';const bucket={put:async(k:string,b:string)=>{key=k;body=b;},get:async()=>({size:body.length,text:async()=>body})} as unknown as R2Bucket;
 const result=await publishSimulationResult(bucket,r,{exitCode:0,result:{schemaVersion:1,metrics:{wait:2}},pythonVersion:'3.11.1'});assert.match(key,/simulation-results-v1\/tenant-a\/project-a\/workspace-a/);assert.equal(JSON.parse(body).parameters.servers,2);assert.equal(JSON.parse(body).version.revisionId,'revision-a');assert.equal(result.metrics.wait,2);
 for(const invalid of [{exitCode:1,result:{schemaVersion:1,metrics:{wait:2}},pythonVersion:'3.11.1'},{exitCode:0,result:{schemaVersion:1,metrics:{}},pythonVersion:'3.11.1'}])await assert.rejects(publishSimulationResult(bucket,r,invalid),/invalid/);
});
test('explicit quota dispatch refusal never starts Python and retains release accounting',async t=>{
 const f=setup(t),dispatch=f.ports.quota.dispatch;f.ports.quota.dispatch=async r=>({...await dispatch(r),authorized:false});const h=f.host(),run=await h.submit(actor,'refused',f.request,plan,'image',()=>true);await h.alarm();assert.equal(f.starts,0);assert.equal((await h.get(run.runId)).released,false);await h.alarm();assert.equal(f.starts,0);assert.equal((await h.get(run.runId)).released,true);
});
test('lost acquire acknowledgement plus cancellation reconciles the original lease',async t=>{
 const f=setup(t),acquire=f.ports.quota.acquire;let lose=true;f.ports.quota.acquire=async r=>{const reply=await acquire(r);if(lose){lose=false;throw Error('lost-acquire');}return reply;};const h=f.host(),run=await h.submit(actor,'acquire-lost',f.request,plan,'image',()=>true);await h.alarm();assert.equal((await h.get(run.runId)).released,false);await h.cancel(run.runId);f.reopen();await f.host().alarm();const final=await f.host().get(run.runId);assert.equal(final.released,true);assert.ok(final.lease);assert.equal(f.starts,0);
});
for(const consumed of [false,true])test(`dispatch exception (${consumed?'consumed grant':'before grant'}) fails without any native operation after reopen`,async t=>{
 const f=setup(t),dispatch=f.ports.quota.dispatch;let dispatches=0,nativeCalls=0;
 f.ports.quota.dispatch=async lease=>{dispatches++;if(consumed)await dispatch(lease);throw Error('dispatch-ack-lost');};
 for(const op of ['start','observe','stop','destroy','running'] as const)f.ports[op]=async()=>{nativeCalls++;throw Error('native-must-not-be-called');};
 const h=f.host(),r=await h.submit(actor,'dispatch-error',f.request,plan,'image',()=>true);await h.alarm();
 assert.equal((await h.get(r.runId)).dispatchClaimed,true);assert.equal((await h.get(r.runId)).startClaimed,false);
 f.loseRelease();f.reopen();await f.host().alarm();assert.equal((await h.get(r.runId)).released,false);
 const proof=(await h.get(r.runId)).releaseProof;f.reopen();await f.host().alarm();await f.host().alarm();
 const final=await h.get(r.runId);assert.equal(final.status,'failed');assert.equal(final.errorCode,'simulation-dispatch-unconfirmed');assert.equal(final.released,true);assert.deepEqual(final.releaseProof,proof);
 assert.equal(dispatches,1);assert.equal(nativeCalls,0);assert.equal((await f.ports.quota.lookup(scope.tenantId,`sim-${r.runId}-0`))?.lease?.status,'stopped');
});
test('dispatch timeout releases without native work even when the grant arrives later',async t=>{
 const f=setup(t),dispatch=f.ports.quota.dispatch;let dispatches=0,resolve!:(v:Awaited<ReturnType<typeof dispatch>>)=>void,entered!:()=>void;
 const reached=new Promise<void>(r=>{entered=r;});let grant:Awaited<ReturnType<typeof dispatch>>;
 f.ports.quota.dispatch=async lease=>{dispatches++;grant=await dispatch(lease);entered();return new Promise(r=>{resolve=r;});};
 const h=f.host(),r=await h.submit(actor,'dispatch-timeout',f.request,plan,'image',()=>true);
 t.mock.timers.enable({apis:['setTimeout']});const advance=h.alarm();await reached;t.mock.timers.tick(15001);await advance;
 assert.equal((await h.get(r.runId)).startClaimed,false);f.reopen();await f.host().alarm();assert.equal((await h.get(r.runId)).released,true);
 resolve(grant!);await Promise.resolve();await f.host().alarm();assert.equal(dispatches,1);assert.equal(f.starts,0);assert.equal(f.observes,0);assert.equal(f.stops,0);
});
test('dispatch intent survives storage acknowledgement loss without acquiring a fresh authorization',async t=>{
 const f=setup(t),acquire=f.ports.quota.acquire;let dispatches=0;f.ports.quota.dispatch=async()=>{dispatches++;throw Error('must-not-dispatch');};
 const h=f.host(),r=await h.submit(actor,'dispatch-sync',f.request,plan,'image',()=>true);
 const lease=(await acquire({tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:scope.workspaceGeneration,operation:'simulation-run',operationId:`sim-${r.runId}-0`,runId:r.runId,deadlineAt:r.input.deadlineAt})).lease!;
 const {leaseReference}=await import('../../services/quota/core.ts');await f.storage.put('simulation:run:'+r.runId,{...r,lease:leaseReference(lease),quotaClaimed:true});
 f.loseSync();await h.alarm();f.reopen();await f.host().alarm();assert.equal((await h.get(r.runId)).released,true);assert.equal(dispatches,0);assert.equal(f.starts,0);assert.equal(f.observes,0);
});
test('legacy ambiguous start intent remains observation-only rather than claiming no native start',async t=>{
 const f=setup(t),h=f.host(),r=await h.submit(actor,'legacy',f.request,plan,'image',()=>true);f.loseStart();await h.alarm();const legacy=await h.get(r.runId);delete legacy.dispatchClaimed;await f.storage.put('simulation:run:'+r.runId,legacy);f.reopen();await f.host().alarm();assert.equal(f.starts,1);assert.equal(f.observes,1);assert.equal((await h.get(r.runId)).released,false);
});
test('cancel during quota dispatch settles without native start or observe',async t=>{
 const f=setup(t),dispatch=f.ports.quota.dispatch,h=f.host(),r=await h.submit(actor,'cancel-dispatch',f.request,plan,'image',()=>true);
 f.ports.quota.dispatch=async lease=>{const response=await dispatch(lease);await h.cancel(r.runId);return response;};await h.alarm();f.reopen();await f.host().alarm();assert.equal((await h.get(r.runId)).status,'cancelled');assert.equal((await h.get(r.runId)).released,true);assert.equal(f.starts,0);assert.equal(f.observes,0);assert.equal(f.stops,0);
});
test('overlapping alarms on the Workspace-owned host cannot dispatch twice',async t=>{
 const f=setup(t),h=f.host(),dispatch=f.ports.quota.dispatch;let dispatches=0,resolve!:(v:Awaited<ReturnType<typeof dispatch>>)=>void,entered!:()=>void;
 const reached=new Promise<void>(r=>{entered=r;});let grant:Awaited<ReturnType<typeof dispatch>>;
 f.ports.quota.dispatch=async lease=>{dispatches++;grant=await dispatch(lease);entered();return new Promise(r=>{resolve=r;});};
 const r=await h.submit(actor,'overlapping-alarm',f.request,plan,'image',()=>true),first=h.alarm();await reached;await h.alarm();assert.equal(dispatches,1);assert.equal(f.starts,0);assert.equal(f.observes,0);resolve(grant!);await first;assert.equal(f.starts,1);assert.equal((await h.get(r.runId)).startClaimed,true);
});

test('root native facts persist separately from model outputs and reject absent child or mismatched stop',async t=>{
 const f=setup(t),r=await f.host().submit(actor,'observed',f.request,plan,'image',()=>true);let body='';const bucket={put:async(_k:string,b:string)=>{body=b;},get:async()=>({size:body.length,text:async()=>body})} as unknown as R2Bucket;
 const token=await simulationToken(r.input),nativeObservation={schemaVersion:1,runId:r.runId,token,filesSha256:modelVersion(plan).filesSha256,child:{pid:12,startTicks:40,uid:[10001,10001,10001,10001],gid:[10001,10001,10001,10001],noNewPrivileges:1,rlimitAS:[536870912,536870912],rlimitNPROC:[64,64],pidfd:'unobserved',network:{seccompMode:2,childSetupAcknowledged:true,specificFilterObserved:false,platformFallbackConfigured:false}},stop:{confirmationId:await digest('simulation-stop:'+token),observedAt:10,fenced:true},sealed:true,quiescent:true};
 const raw={exitCode:0,result:{schemaVersion:1,metrics:{wait:2}},pythonVersion:'3.11.1',nativeObservation};await publishSimulationResult(bucket,r,raw);assert.deepEqual(JSON.parse(body).nativeObservation,nativeObservation);
 for(const bad of [{...nativeObservation,child:null},{...nativeObservation,stop:{...nativeObservation.stop,confirmationId:'f'.repeat(64)}}])await assert.rejects(publishSimulationResult(bucket,r,{...raw,nativeObservation:bad}),/invalid/);
 await assert.rejects(publishSimulationResult(bucket,r,{exitCode:0,pythonVersion:'3.11.1',result:{...raw.result,nativeObservation}}),/invalid/);
});

test('each childRun persists own admission route; expired start guard prevents quota/native dispatch after reopen',async t=>{const f=setup(t);let admissions=0,acquires=0;f.ports.admitRun=async(_actor,_key,_request,runId)=>{admissions++;return {kind:'g5',taskKey:await digest(runId),windowId:'g5',profileSha256:'a'.repeat(64)};};f.ports.beforeStart=async(record)=>{assert.ok(record.budgetRoute);throw Error('g5-window-deadline');};const acquire=f.ports.quota.acquire;f.ports.quota.acquire=async request=>{acquires++;return acquire(request);};await f.storage.put(GROUP_RESERVATION+'group-a',['run-a','run-b']);const first=await f.host().submit(actor,'child-a',f.request,plan,'image',()=>true,{groupId:'group-a',runId:'run-a',permit:async()=>true});const second=await f.host().submit(actor,'child-b',f.request,plan,'image',()=>true,{groupId:'group-a',runId:'run-b',permit:async()=>true});assert.equal(admissions,2);assert.notEqual(first.budgetRoute?.taskKey,second.budgetRoute?.taskKey);f.reopen();await f.host().alarm();assert.equal(acquires,0);assert.equal(f.starts,0);});
