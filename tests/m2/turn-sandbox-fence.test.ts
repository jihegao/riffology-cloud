import assert from 'node:assert/strict';
import test from 'node:test';
import {TurnSandboxFence} from '../../services/sandbox/turn-fence.ts';
import type {TurnRuntimeIdentity} from '../../services/turn-runtime/identity.ts';

const identity:TurnRuntimeIdentity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2};
function fixture(){
 let values=new Map<string,unknown>();
 const storage={kv:{get:(key:string)=>structuredClone(values.get(key)),put:(key:string,value:unknown)=>values.set(key,structuredClone(value))},transactionSync<T>(operation:()=>T){const prior=structuredClone(values);try{return operation();}catch(error){values=prior;throw error;}},async sync(){}} as unknown as DurableObjectStorage;
 return {storage,reopen:()=>new TurnSandboxFence(storage)};
}

test('durable actor fence keeps release pending until an older operation settles and prevents late work after restart',async()=>{
 const f=fixture(),gate=f.reopen();let begin!:()=>void,finish!:()=>void,cleanups=0,ran=0;
 const started=new Promise<void>(resolve=>{begin=resolve;}),deferred=new Promise<string>(resolve=>{finish=()=>resolve('late-result');});
 const pending=gate.run(identity,async()=>{ran++;begin();return deferred;},async()=>{cleanups++;return {running:false};});
 await started;
 assert.deepEqual(await gate.fence(identity,async()=>{cleanups++;return {running:false};}),{running:true});
 finish();await assert.rejects(pending,/turn-sandbox-fenced/);assert.equal(ran,1);assert.equal(cleanups,2);
 assert.deepEqual(await gate.fence(identity,async()=>({running:false})),{running:false});
 const rebuilt=f.reopen();await assert.rejects(rebuilt.run(identity,async()=>{ran++;return 'must-not-run';},async()=>({running:false})),/turn-sandbox-fenced/);assert.equal(ran,1);
 await assert.rejects(rebuilt.fence({...identity,generation:3,scope:{...identity.scope,workspaceGeneration:3}},async()=>({running:false})),/scope-denied/);
});

test('a fence delivered before start rejects the operation without invoking it',async()=>{
 const f=fixture(),gate=f.reopen();await gate.fence(identity,async()=>({running:false}));let ran=false;
 await assert.rejects(gate.run(identity,async()=>{ran=true;},async()=>({running:false})),/turn-sandbox-fenced/);assert.equal(ran,false);
});

test('native cancel confirmation persists across actor rebuild and replays only observation',async()=>{
 const f=fixture(),gate=f.reopen();let signals=0;
 assert.deepEqual(await gate.cancelOnce(identity,async()=>{signals++;return true;}),{dispatched:true});assert.equal(signals,1);
 assert.deepEqual(await f.reopen().cancelOnce(identity,async()=>{signals++;return true;}),{dispatched:false});assert.equal(signals,1);
 await assert.rejects(f.reopen().cancelOnce({...identity,dispatchId:'dispatch-b'},async()=>{signals++;return true;}),/scope-denied/);assert.equal(signals,1);
});

test('native cancel pending state retries a failure before signal delivery',async()=>{
 const f=fixture();let attempts=0,signals=0;
 await assert.rejects(f.reopen().cancelOnce(identity,async()=>{attempts++;throw Error('injected-get-process-failure');}),/injected-get-process-failure/);
 assert.deepEqual(await f.reopen().cancelOnce(identity,async()=>{attempts++;signals++;return true;}),{dispatched:true});
 assert.equal(attempts,2);assert.equal(signals,1);
});

test('native cancel response loss reobserves the exact process before confirming',async()=>{
 const active=fixture();let signals=0;
 await assert.rejects(active.reopen().cancelOnce(identity,async()=>{signals++;throw Error('lost-kill-response');}),/lost-kill-response/);
 assert.deepEqual(await active.reopen().cancelOnce(identity,async()=>{signals++;return true;}),{dispatched:true});assert.equal(signals,2);
 const terminal=fixture();let terminalSignals=0;
 await assert.rejects(terminal.reopen().cancelOnce(identity,async()=>{terminalSignals++;throw Error('lost-kill-response');}),/lost-kill-response/);
 assert.deepEqual(await terminal.reopen().cancelOnce(identity,async()=>false),{dispatched:false});assert.equal(terminalSignals,1);
});

test('release proof stays pending while an earlier native cancel can still resume',async()=>{
 const f=fixture(),gate=f.reopen();let began!:()=>void,finish!:()=>void;const started=new Promise<void>(resolve=>{began=resolve;}),blocked=new Promise<void>(resolve=>{finish=resolve;});
 const cancelling=gate.cancelOnce(identity,async()=>{began();await blocked;return true;});await started;
 assert.deepEqual(await gate.fence(identity,async()=>({running:false})),{running:true});finish();await assert.rejects(cancelling,/turn-sandbox-fenced/);
 assert.deepEqual(await gate.fence(identity,async()=>({running:false})),{running:false});
});

test('dispatch identity is recovered only from the exact durable binding',async()=>{
 const gate=fixture().reopen();await gate.run(identity,async()=>undefined,async()=>({running:false}));
 assert.deepEqual(gate.identityForDispatch({scope:identity.scope,turnId:identity.turnId,dispatchId:identity.dispatchId}),identity);
 assert.throws(()=>gate.identityForDispatch({scope:identity.scope,turnId:identity.turnId,dispatchId:'dispatch-b'}),/scope-denied/);
});

test('a failed late-operation cleanup leaves the durable fence closed and the next release retries cleanup',async()=>{
 const f=fixture(),gate=f.reopen();let begin!:()=>void,finish!:()=>void,cleanupAttempts=0;
 const started=new Promise<void>(resolve=>{begin=resolve;}),deferred=new Promise<void>(resolve=>{finish=resolve;});
 const pending=gate.run(identity,async()=>{begin();await deferred;},async()=>{cleanupAttempts++;throw Error('cleanup-unavailable');});
 await started;await assert.rejects(gate.fence(identity,async()=>{cleanupAttempts++;throw Error('cleanup-unavailable');}),/cleanup-unavailable/);
 finish();await assert.rejects(pending,/turn-sandbox-fenced/);assert.equal(cleanupAttempts,2);
 assert.equal(f.reopen().isFenced(identity),true);
 assert.deepEqual(await f.reopen().fence(identity,async()=>{cleanupAttempts++;return {running:false};}),{running:false});assert.equal(cleanupAttempts,3);
});

test('legacy Project dispatches bind without a session and an exact release upgrades and fences them',async()=>{
 const f=fixture(),gate=f.reopen(),dispatch={scope:identity.scope,turnId:identity.turnId,dispatchId:identity.dispatchId};let ran=0;
 assert.equal(gate.isDispatchFenced(dispatch),false);assert.equal(await gate.runDispatch(dispatch,async()=>++ran,async()=>({running:false})),1);
 const rebuilt=f.reopen();assert.equal(rebuilt.isDispatchFenced(dispatch),false);assert.throws(()=>rebuilt.identityForDispatch(dispatch),/unbound/);
 await assert.rejects(rebuilt.runDispatch({...dispatch,scope:{...identity.scope,workspaceGeneration:3}},async()=>++ran,async()=>({running:false})),/generation-conflict|scope-denied/);
 assert.deepEqual(await rebuilt.fence(identity,async()=>({running:false})),{running:false});assert.deepEqual(rebuilt.identityForDispatch(dispatch),identity);
 await assert.rejects(f.reopen().runDispatch(dispatch,async()=>++ran,async()=>({running:false})),/turn-sandbox-fenced/);assert.equal(ran,1);
});

test('a deferred Project dispatch cannot return across abort and keeps release pending until cleanup',async()=>{
 const f=fixture(),gate=f.reopen(),dispatch={scope:identity.scope,turnId:identity.turnId,dispatchId:identity.dispatchId};let begin!:()=>void,finish!:()=>void,cleanups=0;
 const started=new Promise<void>(resolve=>{begin=resolve;}),deferred=new Promise<void>(resolve=>{finish=resolve;});
 const pending=gate.runDispatch(dispatch,async()=>{begin();await deferred;},async()=>{cleanups++;return {running:false};});await started;
 assert.deepEqual(await gate.fence(identity,async()=>{cleanups++;return {running:false};}),{running:true});finish();await assert.rejects(pending,/turn-sandbox-fenced/);assert.equal(cleanups,2);
 assert.deepEqual(await gate.fence(identity,async()=>({running:false})),{running:false});
});
