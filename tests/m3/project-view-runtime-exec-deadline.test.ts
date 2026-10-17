import assert from 'node:assert/strict';
import test from 'node:test';
import {startProjectViewExec} from '../../services/project-views/exec-deadline.ts';

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
function fixture(){
 let now=1000,aborts=0,lateAborts=0,exited=false;const active=new Set<()=>void>(),all:Array<()=>void>=[],delays:number[]=[];
 const exit=deferred<number>(),process={exitCode:exit.promise};let signal:AbortSignal|undefined;
 return {exit,process,options:{clock:()=>now,schedule(action:()=>void,delay:number){active.add(action);all.push(action);delays.push(delay);return ()=>active.delete(action);}},execute:async(value:AbortSignal)=>{signal=value;value.addEventListener('abort',()=>{aborts++;if(exited)lateAborts++;});return process;},get active(){return active.size;},get aborts(){return aborts;},get lateAborts(){return lateAborts;},get signal(){return signal;},get delays(){return delays;},set now(value:number){now=value;},finish(code=0){exited=true;exit.resolve(code);},fail(){exited=true;exit.reject(Error('process-lost'));},fire(){for(const action of [...active]){active.delete(action);action();}},deliverCancelledCallbacks(){for(const action of all)action();}};
}

for(const outcome of ['resolve','reject'])test('exec '+outcome+' clears its deadline and even an already-queued timeout cannot abort the exited process',async()=>{
 const f=fixture();await startProjectViewExec(f.execute,6000,f.options);assert.equal(f.active,1);assert.deepEqual(f.delays,[5000]);
 if(outcome==='resolve')f.finish();else f.fail();await tick();assert.equal(f.active,0);
 f.deliverCancelledCallbacks();assert.equal(f.aborts,0);assert.equal(f.lateAborts,0);
});

test('an already-exited exec result cancels the newly scheduled timer before it can signal',async()=>{
 const f=fixture();f.finish();await startProjectViewExec(f.execute,6000,f.options);await tick();assert.equal(f.active,0);f.deliverCancelledCallbacks();assert.equal(f.aborts,0);
});

test('exec setup rejection leaves no timer or orphan abort signal',async()=>{
 const f=fixture();await assert.rejects(startProjectViewExec(async signal=>{await f.execute(signal);throw Error('exec-setup-failed');},6000,f.options),/exec-setup-failed/);
 assert.equal(f.active,0);f.deliverCancelledCallbacks();assert.equal(f.aborts,0);assert.equal(f.signal?.aborted,false);
});

test('inspect/setup failure and explicit session close detach the exec timer before container destruction',async()=>{
 for(const reason of ['inspect-failed','session-closed']){
  const f=fixture(),timed=await startProjectViewExec(f.execute,6000,f.options);
  if(reason==='inspect-failed')await assert.rejects((async()=>{try{throw Error(reason);}catch(error){timed.dispose();throw error;}})(),/inspect-failed/);else timed.dispose();
  assert.equal(f.active,0);f.finish();await tick();f.deliverCancelledCallbacks();assert.equal(f.lateAborts,0);assert.equal(f.aborts,0);
 }
});

test('the original deadline still aborts a live process exactly once',async()=>{
 const f=fixture();await startProjectViewExec(f.execute,6000,f.options);f.now=6000;f.fire();assert.equal(f.aborts,1);assert.equal(f.signal?.aborted,true);assert.equal(f.active,0);
 f.finish(137);await tick();f.deliverCancelledCallbacks();assert.equal(f.aborts,1);assert.equal(f.lateAborts,0);
});

test('pending exec setup never arms an unobservable timer and an expired late handle is rejected without a late abort',async()=>{
 const f=fixture(),ready=deferred<{exitCode:Promise<number>}>();
 const starting=startProjectViewExec(async signal=>{await f.execute(signal);return ready.promise;},6000,f.options);
 await tick();assert.equal(f.active,0);f.now=7000;ready.resolve(f.process);await assert.rejects(starting,/exec-expired/);
 assert.deepEqual(f.delays,[]);assert.equal(f.aborts,0);f.finish();await tick();f.deliverCancelledCallbacks();assert.equal(f.lateAborts,0);
});

test('an already expired deadline never executes a native process',async()=>{
 const f=fixture();f.now=6000;await assert.rejects(startProjectViewExec(f.execute,6000,f.options),/exec-expired/);assert.equal(f.signal,undefined);assert.equal(f.active,0);assert.equal(f.aborts,0);
});
