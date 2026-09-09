import test from 'node:test';
import assert from 'node:assert/strict';
import {SqlObserverCalls} from '../../services/preview/observer-calls.ts';
import {ObserverCallHost,type ObserverExecutionPorts} from '../../services/preview/observer-host.ts';
import type {ObserverCommand} from '../../services/preview/observer-protocol.ts';
import {fixture,scope} from './run-fixture.ts';

const digest='a'.repeat(64);
function command(id='call-a'):ObserverCommand{return {schemaVersion:1,purpose:'observer',scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',commandId:id,previewId:'preview-a',operation:'snapshot',deadlineAt:15000};}
function ports(overrides:Partial<ObserverExecutionPorts>={}):ObserverExecutionPorts{
 return {authorize:async()=>({targetDigest:digest,expiresAt:14000}),execute:async()=>({stopped:true,result:{value:'ok'}}),stop:async()=>true,...overrides};
}
function setup(t:Parameters<typeof fixture>[0],overrides:Partial<ObserverExecutionPorts>={}){
 const f=fixture(t), calls=new SqlObserverCalls(f.storage,scope,()=>f.now);
 return {f,calls,host:new ObserverCallHost(calls,ports(overrides),()=>f.now)};
}
function deferred<T>(){let resolve!: (value:T)=>void;let reject!: (error:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}

test('concurrent reconstructed hosts claim one durable execution',async t=>{
 const f=fixture(t);let executions=0;
 const calls1=new SqlObserverCalls(f.storage,scope,()=>f.now);const calls2=new SqlObserverCalls(f.storage,scope,()=>f.now);
 const execute=async()=>{executions++;return {stopped:true as const,result:{value:'ok'}};};
 const a=new ObserverCallHost(calls1,ports({execute}),()=>f.now),b=new ObserverCallHost(calls2,ports({execute}),()=>f.now);
 const [first,second]=await Promise.all([a.run(command()),b.run(command())]);
 assert.equal(executions,1);assert.equal(first.status,'completed');assert.equal(second.status,'running');
 f.reopen();const reopened=new ObserverCallHost(new SqlObserverCalls(f.storage,scope,()=>f.now),ports({execute}),()=>f.now);
 assert.equal((await reopened.run(command())).status,'completed');assert.equal(executions,1);
});

test('successful result is reauthorized against the target before completion is returned',async t=>{
 const f=fixture(t);let authorizations=0;
 const calls=new SqlObserverCalls(f.storage,scope,()=>f.now);
 const h=new ObserverCallHost(calls,ports({authorize:async()=>({targetDigest:++authorizations<3?digest:'b'.repeat(64),expiresAt:14000})}),()=>f.now);
 assert.equal((await h.run(command())).status,'failed');
 assert.equal((await calls.snapshot(command()))?.status,'failed');
});

test('target staleness after claim prevents execution',async t=>{
 const {f,calls}=setup(t);let authorizations=0,executions=0;
 const h=new ObserverCallHost(calls,ports({authorize:async()=>({targetDigest:++authorizations===1?digest:'b'.repeat(64),expiresAt:14000}),execute:async()=>{executions++;return {stopped:true,result:{value:'unexpected'}};}}),()=>f.now);
 assert.equal((await h.run(command())).status,'failed');
 assert.equal((await calls.snapshot(command()))?.status,'failed');
 assert.equal(executions,0);
});

test('executor failure with confirmed stop fails, while unconfirmed stop remains unknown and occupies the slot',async t=>{
 const confirmed=setup(t,{execute:async()=>{throw Error('executor-boom');},stop:async()=>true});
 assert.equal((await confirmed.host.run(command())).status,'failed');
 assert.equal((await confirmed.calls.snapshot(command()))?.status,'failed');

 let stopped=false;const uncertain=setup(t,{execute:async()=>{throw Error('executor-boom');},stop:async()=>stopped});
 assert.equal((await uncertain.host.run(command('call-b'))).status,'unknown');
 assert.equal((await uncertain.calls.snapshot(command('call-b')))?.status,'unknown');
 await assert.rejects(uncertain.host.run(command('call-c')),/observer-call-busy/);
 assert.equal((await uncertain.host.reconcile(command('call-b')))?.status,'unknown');
 stopped=true;assert.equal((await uncertain.host.reconcile(command('call-b')))?.status,'failed');
 assert.equal((await uncertain.calls.snapshot(command('call-b')))?.status,'failed');
 assert.equal((await uncertain.host.run(command('call-c'))).status,'failed');
});

test('timeout of a pending executor is durable and a late result cannot overwrite failed or unknown',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const late=deferred<{stopped:true;result:{value:string}}>();const executeStarted=deferred<void>();let stop=false;
 const f=fixture(t),calls=new SqlObserverCalls(f.storage,scope,()=>f.now),h=new ObserverCallHost(calls,ports({execute:async()=>{executeStarted.resolve();return late.promise;},stop:async()=>stop}),()=>f.now);
 const pending=h.run(command());await executeStarted.promise;t.mock.timers.tick(14001);await Promise.resolve();
 t.mock.timers.tick(2001);await pending;
 assert.equal((await calls.snapshot(command()))?.status,'unknown');
 late.resolve({stopped:true,result:{value:'late'}});await Promise.resolve();
 assert.equal((await calls.snapshot(command()))?.status,'unknown');
 stop=true;assert.equal((await h.reconcile(command()))?.status,'failed');
 assert.equal((await pending).status,'unknown');
 assert.equal((await calls.snapshot(command()))?.status,'failed');
});

test('lost completion acknowledgement preserves completed state and does not return it unverified',async t=>{
 const f=fixture(t),calls=new SqlObserverCalls(f.storage,scope,()=>f.now),h=new ObserverCallHost(calls,ports({execute:async()=>{f.failNextSync();return {stopped:true,result:{value:'ok'}};}}),()=>f.now);
 await assert.rejects(h.run(command()),/observer-result-unavailable/);
 const reopened=new ObserverCallHost(new SqlObserverCalls(f.storage,scope,()=>f.now),ports(),()=>f.now);
 assert.equal((await reopened.run(command())).status,'completed');
});

test('stopped true from executor makes post-execution stale authorization a failed call',async t=>{
 const f=fixture(t);let authorizations=0;
 const h=new ObserverCallHost(new SqlObserverCalls(f.storage,scope,()=>f.now),ports({authorize:async()=>({targetDigest:++authorizations===3? 'b'.repeat(64):digest,expiresAt:14000}),stop:async()=>false}),()=>f.now);
 assert.equal((await h.run(command())).status,'failed');
 assert.equal((await new SqlObserverCalls(f.storage,scope,()=>f.now).snapshot(command()))?.status,'failed');
});

test('stale authorization after durable completion is not returned without verification',async t=>{
 const f=fixture(t);let authorizations=0;
 const calls=new SqlObserverCalls(f.storage,scope,()=>f.now);
 const h=new ObserverCallHost(calls,ports({authorize:async()=>({targetDigest:++authorizations===4?'b'.repeat(64):digest,expiresAt:14000})}),()=>f.now);
 await assert.rejects(h.run(command()),/observer-result-unavailable/);
 assert.equal((await calls.snapshot(command()))?.status,'completed');
});

test('expired or overlong deadlines are rejected before authorization or execution',async t=>{
 const f=fixture(t);let authorized=0,executed=0;
 const h=new ObserverCallHost(new SqlObserverCalls(f.storage,scope,()=>f.now),ports({authorize:async()=>{authorized++;return {targetDigest:digest,expiresAt:14000};},execute:async()=>{executed++;return {stopped:true,result:{value:'bad'}};}}),()=>f.now);
 await assert.rejects(h.run({...command(),deadlineAt:1000}),/observer-command-denied/);
 await assert.rejects(h.run({...command('call-b'),deadlineAt:16001}),/observer-command-denied/);
 assert.equal(authorized,0);assert.equal(executed,0);
});

test('executor context is fenced after success and cannot reauthorize late work',async t=>{
 const f=fixture(t);let authorityCalls=0;let context!: {signal:AbortSignal;authorize():Promise<{targetDigest:string;expiresAt:number}>};
 const calls=new SqlObserverCalls(f.storage,scope,()=>f.now);
 const h=new ObserverCallHost(calls,ports({authorize:async()=>{authorityCalls++;return {targetDigest:digest,expiresAt:14000};},execute:async(_command,c)=>{context=c;return {stopped:true,result:{value:'ok'}};}}),()=>f.now);
 assert.equal((await h.run(command())).status,'completed');
 const callsAfterRun=authorityCalls;assert.equal(context.signal.aborted,true);
 await assert.rejects(context.authorize(),/observer-cancelled/);assert.equal(authorityCalls,callsAfterRun);
});

test('expiry after durable accept survives restart and requires stop reconciliation before releasing the slot',async t=>{
 const f=fixture(t),sync=f.storage.sync.bind(f.storage);let syncs=0,executions=0;
 f.storage.sync=async()=>{await sync();if(++syncs===2)f.now=15000;};
 const calls=()=>new SqlObserverCalls(f.storage,scope,()=>f.now);
 const p=ports({authorize:async()=>({targetDigest:digest,expiresAt:19000}),execute:async()=>{executions++;return {stopped:true,result:{value:'unexpected'}};},stop:async()=>false});
 await assert.rejects(new ObserverCallHost(calls(),p,()=>f.now).run(command()),/observer-call-expired/);
 assert.equal((await calls().snapshot(command()))?.status,'accepted');assert.equal(executions,0);
 f.reopen();const h=new ObserverCallHost(calls(),p,()=>f.now);
 await assert.rejects(h.run({...command('next'),deadlineAt:20000}),/observer-call-busy/);
 assert.equal((await h.reconcile(command()))?.status,'accepted');
 p.stop=async()=>true;assert.equal((await h.reconcile(command()))?.status,'failed');
});
