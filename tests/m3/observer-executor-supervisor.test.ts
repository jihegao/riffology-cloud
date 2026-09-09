import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,scope} from './run-fixture.ts';
import {SqlObserverExecutorSupervisor,type ObserverExecutorBackend,type ObserverExecutorResult} from '../../services/preview/observer-executor-supervisor.ts';
import type {ObserverCommand} from '../../services/preview/observer-protocol.ts';
function command():ObserverCommand{return {schemaVersion:1,purpose:'observer',scope:{...scope},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-a',previewId:'preview-a',operation:'snapshot',deadlineAt:5000};}
const receipt=():ObserverExecutorResult=>({stopped:true,result:{text:'done'}});
function backend(){let executions=0,stops=0;return {get executions(){return executions;},get stops(){return stops;},async execute(){executions++;return receipt();},async fenceAndStop(){stops++;return true;}};}
function setup(t:Parameters<typeof fixture>[0]){const f=fixture(t);return {...f,host:(b:ObserverExecutorBackend,c=command())=>new SqlObserverExecutorSupervisor(f.storage,c,b,()=>f.now),f};}
test('completed execution is durable and replay does not invoke browser again',async t=>{
 const {f,host}=setup(t),b=backend(),h=host(b);const first=await h.execute();first.result.text='caller mutation';f.reopen();assert.deepEqual(await host(b).execute(),receipt());assert.equal(b.executions,1);
});
test('concurrent requests and reconstruction never repeat an uncertain execution',async t=>{
 const {f,host}=setup(t);let release!:(v:ObserverExecutorResult)=>void,entered!:()=>void,calls=0;const started=new Promise<void>(r=>entered=r);
 const b={async execute(){calls++;entered();return new Promise<ObserverExecutorResult>(r=>release=r);},async fenceAndStop(){return true;}};
 const h=host(b),pending=h.execute();await started;await assert.rejects(h.execute(),/unknown/);await assert.rejects(host(b).execute(),/unknown/);release(receipt());await pending;f.reopen();await host(b).execute();assert.equal(calls,1);
});
test('lost execution acknowledgement remains unknown across restart',async t=>{
 const {f,host}=setup(t);let calls=0;const b={async execute():Promise<ObserverExecutorResult>{calls++;throw Error('backend-ack-loss');},async fenceAndStop(){return true;}};
 await assert.rejects(host(b).execute(),/backend-ack-loss/);f.reopen();await assert.rejects(host(b).execute(),/unknown/);assert.equal(calls,1);
});
test('stop before execute persists fence and invokes native fence even without a start',async t=>{
 const {f,host}=setup(t),b=backend(),h=host(b);assert.equal(await h.stop(),true);await assert.rejects(h.execute(),/fenced/);f.reopen();assert.equal(await host(b).stop(),true);await assert.rejects(host(b).execute(),/fenced/);assert.equal(b.executions,0);assert.equal(b.stops,1);
});
test('stop is independent of hung execute and a late result cannot overwrite fence',async t=>{
 const {f,host}=setup(t);let release!:(v:ObserverExecutorResult)=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r);
 const h=host({async execute(){entered();return new Promise<ObserverExecutorResult>(r=>release=r);},async fenceAndStop(){return true;}}),pending=h.execute();await started;assert.equal(await h.stop(),true);release(receipt());await assert.rejects(pending,/fenced/);
 assert.equal(f.db.prepare('SELECT result_json FROM observer_executor').get()!.result_json,null);
});
test('false and throwing native stop retain fence but never claim stopped',async t=>{
 const {host}=setup(t),b=backend();b.fenceAndStop=async()=>false;const h=host(b);assert.equal(await h.stop(),false);await assert.rejects(h.execute(),/fenced/);b.fenceAndStop=async()=>{throw Error('stop-offline');};await assert.rejects(h.stop(),/stop-offline/);
});
test('lost attempted durability acknowledgement prevents dispatch and retry',async t=>{
 const {f,host}=setup(t),b=backend(),h=host(b);await Promise.resolve();f.failNextSync();await assert.rejects(h.execute(),/ack-loss/);assert.equal(b.executions,0);f.reopen();await assert.rejects(host(b).execute(),/unknown/);
});
test('stop fence and proof acknowledgement loss cannot return true',async t=>{
 const {f,host}=setup(t),b=backend(),h=host(b);await Promise.resolve();f.failNextSync();await assert.rejects(h.stop(),/ack-loss/);assert.equal(b.stops,0);await assert.rejects(h.execute(),/fenced/);
 b.fenceAndStop=async()=>{f.failNextSync();return true;};await assert.rejects(h.stop(),/ack-loss/);f.reopen();assert.equal(await host(b).stop(),true);
});
test('stop during attempted durability wait prevents delayed dispatch',async t=>{
 const {f,host}=setup(t),b=backend(),h=host(b);await Promise.resolve();let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>entered=r),normal=f.storage.sync.bind(f.storage);let hold=true;
 f.storage.sync=async()=>{if(hold){hold=false;entered();await new Promise<void>(r=>release=r);}await normal();};
 const pending=h.execute();await waiting;assert.equal(await h.stop(),true);release();await assert.rejects(pending,/fenced/);assert.equal(b.executions,0);
});
test('deadline is rechecked after durability wait',async t=>{
 const {f,host}=setup(t),b=backend(),h=host(b);await Promise.resolve();const normal=f.storage.sync.bind(f.storage);f.storage.sync=async()=>{f.now=5000;await normal();};await assert.rejects(h.execute(),/expired/);assert.equal(b.executions,0);
});
test('constructor freezes input and binds every command field',async t=>{
 const {f,host}=setup(t),b=backend(),c=command();let seen:ObserverCommand|undefined;const h=host({...b,async execute(input){seen=input;input.scope.tenantId='backend mutation';return receipt();}},c);c.scope.projectId='caller mutation';await h.execute();assert.equal(seen!.previewId,'preview-a');f.reopen();await host(b).execute();
 for(const change of [(v:ObserverCommand)=>{v.deadlineAt++;},(v:ObserverCommand)=>{v.operation='reload';},(v:ObserverCommand)=>{v.scope.tenantId='other';}]){const changed=command();change(changed);assert.throws(()=>host(b,changed),/conflict/);}
});
test('persisted corruption and malformed native results fail closed',async t=>{
 const {f,host}=setup(t),b=backend();await host(b).execute();f.db.exec('UPDATE observer_executor SET stopped=1,fenced=0');assert.throws(()=>host(b),/persisted-invalid/);
});
test('native result validation rejects nonfinite, oversized, getters and sparse arrays',async t=>{
 for(const value of [{number:Infinity},{text:'界'.repeat(30000)},{get text(){throw Error('getter-invoked');}},{items:new Array(2)},{items:Object.assign(new Array(1),{'4294967295':'not an array index'})}]){
  const {host}=setup(t),b={async execute(){return {stopped:true as const,result:value} as unknown as ObserverExecutorResult;},async fenceAndStop(){return true;}};await assert.rejects(host(b).execute(),/result-denied/);await assert.rejects(host(b).execute(),/unknown/);
 }
});
test('lost completion persistence acknowledgement can replay durable result without execution',async t=>{
 const {f,host}=setup(t);let executions=0;const b={async execute(){executions++;f.failNextSync();return receipt();},async fenceAndStop(){return true;}};
 await assert.rejects(host(b).execute(),/ack-loss/);f.reopen();assert.deepEqual(await host(b).execute(),receipt());assert.equal(executions,1);
});
test('stop committed during completion sync suppresses late success publication',async t=>{
 const {f,host}=setup(t);let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>entered=r),normal=f.storage.sync.bind(f.storage);let hold=false;
 f.storage.sync=async()=>{if(hold){hold=false;entered();await new Promise<void>(r=>release=r);}await normal();};
 const h=host({async execute(){hold=true;return receipt();},async fenceAndStop(){return true;}}),pending=h.execute();await waiting;assert.equal(await h.stop(),true);release();await assert.rejects(pending,/fenced/);f.reopen();await assert.rejects(host(backend()).execute(),/fenced/);
});
