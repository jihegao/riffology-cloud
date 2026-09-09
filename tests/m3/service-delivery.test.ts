import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,scope,actor,spec} from './run-fixture.ts';
import {SqlServiceIntentJournal} from '../../services/workspace/service-intents.ts';
import {ServiceIntentDelivery,type ServiceDeliveryPorts} from '../../services/workspace/service-delivery.ts';
import type {ServiceRunTask} from '../../services/run/host.ts';
function ack(task:ServiceRunTask,stopping=false){return {id:task.runId,scope:task.scope,actor:task.actor,spec:task.spec,status:stopping?'cancelled':'queued',stopRequestedAt:stopping?1000:null};}
async function setup(t:Parameters<typeof fixture>[0]){
 const f=fixture(t),j=new SqlServiceIntentJournal(f.storage,scope,()=>f.now,()=> 'intent-a'),s=spec();
 const intent=await j.create(actor,'request-a',{runtimeImage:s.runtimeImage,maxDurationMs:s.maxDurationMs},()=>s.plan.source);
 const calls:string[]=[],tasks:ServiceRunTask[]=[],held:Promise<unknown>[]=[];
 const ports:ServiceDeliveryPorts={async resolve(){calls.push('resolve');return s.plan;},async accept(task){calls.push('accept');tasks.push(task);return ack(task);},async acceptStopped(task){calls.push('acceptStopped');tasks.push(task);return ack(task,true);},async stop(task){calls.push('stop');return ack(task,true);},hold(p){held.push(p);}};
 return {f,j,s,intent,calls,tasks,ports,held,engine:(timeout=1000)=>new ServiceIntentDelivery(j,ports,()=>f.now,timeout)};
}
test('source is resolved once and a queued Host ack settles delivery without claiming running',async t=>{
 const f=await setup(t);let disposed=0;f.ports.resolve=async()=>Object.assign(structuredClone(f.s.plan),{[Symbol.dispose](){disposed++;}});
 assert.equal(await f.engine().advance(),null);assert.equal(disposed,1);assert.deepEqual(f.calls,['accept']);assert.equal((await f.j.get(f.intent.runId)).status,'delivered');
 await f.engine().advance();assert.deepEqual(f.calls,['accept']);
});
test('deterministic preview source failures settle before Host delivery instead of retrying to deadline',async t=>{
 for(const [cause,code] of [
  ['preview-declaration-missing','service-preview-declaration-missing'],
  ['preview-declaration-invalid','service-preview-declaration-invalid'],
  ['preview-declaration-target-missing','service-preview-files-missing'],
  ['preview-declaration-target-invalid','service-preview-files-invalid'],
  ['invalid-workspace-file-archive','service-preview-source-invalid'],
 ] as const){
  await t.test(cause,async t=>{const f=await setup(t);f.ports.resolve=async()=>{throw Error(cause);};
   assert.equal(await f.engine().advance(),null);const intent=await f.j.get(f.intent.runId);
   assert.equal(intent.status,'failed');assert.equal(intent.errorCode,code);assert.equal(intent.nextAttemptAt,null);assert.deepEqual(f.calls,[]);
  });
 }
});
test('transport failures during preview resolution remain retryable',async t=>{
 const f=await setup(t);f.ports.resolve=async()=>{throw Error('revision-store-unavailable');};
 assert.equal(await f.engine().advance(),6000);const intent=await f.j.get(f.intent.runId);
 assert.equal(intent.status,'resolving');assert.equal(intent.errorCode,'service-delivery-unconfirmed');
});
test('lost accept confirmation followed by cancellation uses acceptStopped on the same immutable task',async t=>{
 const f=await setup(t);f.ports.accept=async task=>{f.tasks.push(task);throw Error('lost-ack');};
 await f.engine().advance();assert.equal((await f.j.get(f.intent.runId)).status,'delivery-unknown');
 await f.j.requestStop(f.intent.runId);await f.engine().advance();assert.deepEqual(f.calls,['resolve','acceptStopped']);assert.deepEqual(f.tasks[0],f.tasks[1]);
 const r=await f.j.get(f.intent.runId);assert.equal(r.status,'delivered');assert.equal(r.stopForwardedAt,1000);assert.equal(await f.j.nextWake(),null);
});
test('stop during source resolution prevents any delivery',async t=>{
 const f=await setup(t);f.ports.resolve=async()=>{await f.j.requestStop(f.intent.runId);return f.s.plan;};
 await f.engine().advance();assert.equal((await f.j.get(f.intent.runId)).status,'cancelled');assert.deepEqual(f.calls,[]);
});
test('stop during an in-flight normal acceptance is durably forwarded before settlement',async t=>{
 const f=await setup(t);f.ports.accept=async task=>{await f.j.requestStop(f.intent.runId);return ack(task);};
 await f.engine().advance();assert.deepEqual(f.calls,['resolve','stop']);assert.equal((await f.j.get(f.intent.runId)).stopForwardedAt,1000);
});
test('conflicting Host response never settles unknown delivery',async t=>{
 const f=await setup(t);f.ports.accept=async task=>({...ack(task),id:'wrong-run'});
 await f.engine().advance();assert.equal((await f.j.get(f.intent.runId)).status,'delivery-unknown');assert.equal(await f.j.nextWake(),6000);
});
test('timeout retains unknown intent and disposes a late RPC result without settling it',async t=>{
 const f=await setup(t);let resolve!:(v:unknown)=>void,task!:ServiceRunTask,disposed=0;
 f.ports.accept=async input=>{task=input;return new Promise(r=>{resolve=r;});};
 await f.engine(5).advance();assert.equal((await f.j.get(f.intent.runId)).status,'delivery-unknown');
 resolve({...ack(task),[Symbol.dispose](){disposed++;}});await Promise.all(f.held);assert.equal(disposed,1);assert.equal((await f.j.get(f.intent.runId)).status,'delivery-unknown');
});
test('unconfirmed stop acknowledgement retains the cleanup wakeup',async t=>{
 const f=await setup(t);await f.engine().advance();await f.j.requestStop(f.intent.runId);f.ports.stop=async task=>ack(task);
 await f.engine().advance();assert.equal((await f.j.get(f.intent.runId)).stopForwardedAt,null);assert.notEqual(await f.j.nextWake(),null);
});
