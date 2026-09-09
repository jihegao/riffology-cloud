import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewVerticalFixture} from './preview-vertical-fixture.mjs';

// Workspace, Catalog ACL, TurnJournal and Observer journal are real Workerd
// components. The Executor byte-return port is a fixture; R2 has separate tests.
async function setup(t,{mode='completed',mutate}={}){
 const f=await createPreviewVerticalFixture({observer:true,observerExecutor:true});t.after(()=>f.dispose());
 const actor={userId:'user-a',authVersion:1},identity=await f.call('observerTurn',[f.scope,actor]);
 const command={schemaVersion:1,purpose:'observer',scope:f.scope,sessionId:identity.sessionId,turnId:identity.turnId,dispatchId:identity.dispatchId,commandId:'historical-command',previewId:'historical-preview',operation:'snapshot',deadlineAt:Date.now()-1000};
 if(mutate)mutate(command);
 const receipts=await f.call('seedObserverArtifact',[command,mode]);
 const input={scope:f.scope,actor,turnId:identity.turnId,commandId:command.commandId,part:'state'};
 const read=patch=>f.call('readObserverArtifact',[{...input,...patch}]);
 const stats=()=>f.call('executorReadStats',[],{input:command});
 return {...f,actor,identity,command,receipts,read,stats};
}

test('completed historical artifacts remain readable with terminal Turn, no live Preview and closed execution gate',{timeout:25000},async t=>{
 const f=await setup(t);const terminal=await f.call('terminalObserver',[f.identity]);assert.equal(terminal.status,'failed');
 await f.call('observerGate',[false]);
 const state=await f.read();assert.deepEqual(state.receipt,f.receipts.state);assert.deepEqual(JSON.parse(new TextDecoder().decode(Uint8Array.from(state.content))),{simulation_state_id:'historical-state',sequence:1,state:{queue:3}});
 assert.deepEqual(await f.call('executorLateReadCapability',[],{input:f.command}),{denied:true});
 const view=await f.read({part:'view'});assert.deepEqual(view.receipt,f.receipts.view);
 assert.equal(JSON.parse(new TextDecoder().decode(Uint8Array.from(view.content))).text,'Historical view');
 assert.deepEqual(await f.call('executorDiagnostics',[],{input:f.command}),{executions:0,stops:0});
 assert.deepEqual((await f.diagnostics()).observerForwards,[]);
 await f.restart();assert.deepEqual((await f.read()).receipt,f.receipts.state);
});

test('Workspace historical reads reject another user, stale or incorrect caller version, missing commands and revoked membership',{timeout:25000},async t=>{
 const f=await setup(t);
 await assert.rejects(f.read({actor:{userId:'user-b',authVersion:1}}));
 await assert.rejects(f.read({actor:{userId:'user-a',authVersion:2}}));
 await assert.rejects(f.read({commandId:'missing-command'}));
 await assert.rejects(f.read({turnId:'missing-turn'}));
 assert.equal((await f.stats()).reads,0);
 await f.read();await f.revokeMembership();await assert.rejects(f.read());assert.equal((await f.stats()).reads,1);
});

test('unknown and orphan observer records cannot grant historical byte access',{timeout:25000},async t=>{
 for(const mode of ['unknown','orphan']){
  const f=await setup(t,{mode});await assert.rejects(f.read());assert.equal((await f.stats()).reads,0);
 }
});

test('command session identity must match the historical Turn identity',{timeout:25000},async t=>{
 const f=await setup(t,{mutate:command=>{command.sessionId='wrong-session';}});
 await assert.rejects(f.read(),/observer-artifact-read-denied/);assert.equal((await f.stats()).reads,0);
});

test('Workspace validates returned receipt and bytes and closes retained capability on failure',{timeout:25000},async t=>{
 const f=await setup(t);
 for(const mode of ['read-wrong-receipt','read-wrong-content']){
  await f.call('executorConfigure',[],{input:f.command,value:mode});
  await assert.rejects(f.read(),/observer-artifact-read-denied/);
  assert.deepEqual(await f.call('executorLateReadCapability',[],{input:f.command}),{denied:true});
 }
});

test('membership withdrawal during a held read prevents content publication and late capability use',{timeout:25000},async t=>{
 const f=await setup(t);await f.call('executorConfigure',[],{input:f.command,value:'read-hold'});
 const pending=f.read(),rejected=assert.rejects(pending);const until=Date.now()+3000;
 while(!(await f.stats()).reads){if(Date.now()>until)throw Error('fixture-read-not-started');await new Promise(resolve=>setTimeout(resolve,20));}
 await f.revokeMembership();await f.call('executorConfigure',[],{input:f.command,value:'read'});await rejected;
 assert.deepEqual(await f.call('executorLateReadCapability',[],{input:f.command}),{denied:true});
});


test('current authentication version retains access to a Turn and Session created with an older version',{timeout:25000},async t=>{
 const f=await setup(t);await f.call('terminalObserver',[f.identity]);
 await f.rotateAuthVersion(2);
 const current=await f.read({actor:{userId:'user-a',authVersion:2}});
 assert.deepEqual(current.receipt,f.receipts.state);
 assert.deepEqual(JSON.parse(new TextDecoder().decode(Uint8Array.from(current.content))),{simulation_state_id:'historical-state',sequence:1,state:{queue:3}});
 await assert.rejects(f.read({actor:{userId:'user-a',authVersion:1}}));
 assert.equal((await f.stats()).reads,1);
});
