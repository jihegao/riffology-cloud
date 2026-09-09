import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewVerticalFixture} from './preview-vertical-fixture.mjs';

// Real Workspace, TurnJournal, D1, ServiceRun and Preview bindings. The dedicated
// ProductTurnRuntime authority is explicitly a fixture; no browser or Pi runs.
async function setup(t,options={}){
 const f=await createPreviewVerticalFixture({observer:true,...options});t.after(()=>f.dispose());
 const actor={userId:'user-a',authVersion:1},identity=await f.call('observerTurn',[f.scope,actor]);
 const binding=await f.call('bindPreview',[{scope:f.scope,actor,key:'observer-preview',runId:f.runId,expectedPreviewId:null}]);
 const command=()=>({schemaVersion:1,purpose:'observer',scope:f.scope,sessionId:identity.sessionId,turnId:identity.turnId,dispatchId:identity.dispatchId,commandId:'command-a',previewId:binding.previewId,operation:'snapshot',deadlineAt:Date.now()+14000});
 return {...f,actor,identity,binding,command,authorize:body=>f.call('authorizeObserverCommand',[body??command()]),calls:()=>f.call('observerCalls',[],{input:identity})};
}

test('Workspace Observer gate defaults closed; real current Turn authorizes exact runtime and registered paths',{timeout:25000},async t=>{
 const f=await setup(t);await assert.rejects(f.authorize(),/observer-disabled/);assert.deepEqual(await f.calls(),[]);
 await f.call('observerGate',[true]);const command=f.command(),authorized=await f.authorize(command);
 assert.deepEqual(authorized.command,command);assert.deepEqual(authorized.actor,f.actor);assert.equal(authorized.binding.previewId,f.binding.previewId);assert.equal(authorized.runtime.reference.runId,f.runId);assert.deepEqual(authorized.paths,{pagePath:'/observe',statePath:'/state'});assert.ok(authorized.expiresAt<=command.deadlineAt);assert.deepEqual(await f.calls(),[f.identity,f.identity]);
 await assert.rejects(f.authorize({...f.command(),dispatchId:'wrong-dispatch'}),/observer-authority-denied/);assert.equal((await f.calls()).length,2);
 await f.call('cancelObserver',[f.scope,f.actor,f.identity.turnId]);await assert.rejects(f.authorize(),/observer-authority-denied/);assert.equal((await f.calls()).length,2);
 const runtime=await f.diagnostics();assert.equal(runtime.starts,1);assert.deepEqual(runtime.forwards,[]);assert.deepEqual(runtime.wsForwards,[]);
});

test('Workspace Observer rejects revoked/replaced Preview and revoked D1 membership',{timeout:25000},async t=>{
 const f=await setup(t);await f.call('observerGate',[true]);await f.authorize();
 await f.call('revokePreview',[{scope:f.scope,previewId:f.binding.previewId,reason:'operator'}]);await assert.rejects(f.authorize(),/observer-authority-denied/);
 const replacement=await f.call('bindPreview',[{scope:f.scope,actor:f.actor,key:'replacement-preview',runId:f.runId,expectedPreviewId:f.binding.previewId}]);assert.notEqual(replacement.previewId,f.binding.previewId);
 await assert.rejects(f.authorize(),/observer-authority-denied/);await f.authorize({...f.command(),previewId:replacement.previewId});
 await f.revokeMembership();const before=(await f.calls()).length;await assert.rejects(f.authorize({...f.command(),previewId:replacement.previewId}),/observer-authority-denied/);assert.equal((await f.calls()).length,before);
});


test('Workspace private forwarding requires a registered running call and never uses browser forwarding',{timeout:30000},async t=>{
 const f=await setup(t);await f.call('observerGate',[true]);const command=f.command();
 const grant=await f.authorize(command),host='p-'+(await import('node:crypto')).createHash('sha256').update(command.previewId).digest('hex').slice(0,40),url='https://'+host+'.preview.example.test/state';
 const forward=(input={command,targetDigest:grant.targetDigest},request={url,headers:{cookie:'private=1',authorization:'Bearer private','x-riff-observer':'forged'}})=>f.call('observerForward',[],{input,request});
 await assert.rejects(forward(),/observer-route-denied/);
 await f.call('observerClaim',[command,false]);await assert.rejects(forward(),/observer-call-not-running/);
 await f.call('observerClaim',[command,true]);const response=await forward();assert.equal(response.status,200);assert.equal(JSON.parse(response.body).sequence,0);assert.equal(response.headers['set-cookie'],undefined);assert.equal(response.headers['x-private'],undefined);
 const diagnostics=await f.diagnostics();assert.equal(diagnostics.observerForwards.length,1);assert.deepEqual(diagnostics.forwards,[]);
 const sent=diagnostics.observerForwards[0];assert.equal(sent.input.purpose,'observer');assert.equal(sent.input.runtime.reference.runId,f.runId);assert.equal(sent.url,'http://localhost:8080/state');assert.equal(sent.headers['x-riff-observer'],'read-only');assert.equal(sent.headers.cookie,undefined);assert.equal(sent.headers.authorization,undefined);
 await assert.rejects(forward({command,targetDigest:'f'.repeat(64)}),/observer-target-stale/);
 await assert.rejects(forward(undefined,{url:url+'?x=1'}),/observer-http-denied/);
 await f.call('finishObserver',[command]);await assert.rejects(forward(),/observer-call-not-running/);assert.equal((await f.diagnostics()).observerForwards.length,1);
});

test('Workspace private Observer forwarding rejects a cancelled Turn and closed plugin gate',{timeout:30000},async t=>{
 const f=await setup(t);await f.call('observerGate',[true]);const command=f.command(),grant=await f.call('observerClaim',[command,true]);
 const host='p-'+(await import('node:crypto')).createHash('sha256').update(command.previewId).digest('hex').slice(0,40);
 const forward=()=>f.call('observerForward',[],{input:{command,targetDigest:grant.targetDigest},request:{url:'https://'+host+'.preview.example.test/observe'}});
 await f.call('observerGate',[false]);await assert.rejects(forward(),/observer-disabled/);
 await f.call('observerGate',[true]);await f.call('cancelObserver',[f.scope,f.actor,f.identity.turnId]);await assert.rejects(forward(),/observer-authority-denied/);
 assert.deepEqual((await f.diagnostics()).observerForwards,[]);
});


test('Workspace withdrawal during a pending Observer read reaches the final port through cancellation RPC',{timeout:30000},async t=>{
 const f=await setup(t);await f.call('observerGate',[true]);const command=f.command(),grant=await f.call('observerClaim',[command,true]);
 const host='p-'+(await import('node:crypto')).createHash('sha256').update(command.previewId).digest('hex').slice(0,40);await f.holdObserver(true);
 const pending=f.call('observerForward',[],{input:{command,targetDigest:grant.targetDigest},request:{url:'https://'+host+'.preview.example.test/state'}});
 const rejected=assert.rejects(pending,/observer-/);
 const deadline=Date.now()+5000;while(!(await f.diagnostics()).observerForwards.length){if(Date.now()>=deadline)throw Error('fixture-forward-not-started');await new Promise(resolve=>setTimeout(resolve,20));}
 await f.call('cancelObserver',[f.scope,f.actor,f.identity.turnId]);await rejected;
 assert.equal((await f.diagnostics()).observerCancelled,true);assert.equal((await f.diagnostics()).starts,1);
});


test('Workspace observation refuses missing executor before acceptance and does not expose an HTTP observation route',{timeout:30000},async t=>{
 const f=await setup(t);const command=f.command();
 await assert.rejects(f.call('observePreview',[command]),/observer-disabled/);
 await f.call('observerGate',[true]);
 await assert.rejects(f.call('observePreview',[command]),/observer-executor-not-configured/);
 assert.equal(await f.call('observerRecord',[command]),null);
 const response=await f.mf.dispatchFetch('https://app.example.test/api/observer',{method:'POST',body:JSON.stringify(command)});
 assert.notEqual(response.status,200);
});

test('Workspace durable observation executes through private RPC capabilities and replays without executing again',{timeout:30000},async t=>{
 const f=await setup(t,{observerExecutor:true});await f.call('observerGate',[true]);const command=f.command();
 await assert.rejects(f.call('observePreview',[command]),/observer-route-denied/);assert.equal(await f.call('observerRecord',[command]),null);
 await f.call('observerRoute',[command]);
 const completed=await f.call('observePreview',[command]);assert.equal(completed.status,'completed');assert.equal(completed.result.sequence,0);
 assert.deepEqual(await f.call('executorLateCapability',[],{input:command}),{denied:true,cancelled:true,forwardDenied:true});
 await f.restart();await f.call('observerGate',[true]);
 assert.deepEqual(await f.call('observePreview',[command]),completed);
 assert.deepEqual(await f.call('executorDiagnostics',[],{input:command}),{executions:1,stops:0});
 const diagnostics=await f.diagnostics();assert.equal(diagnostics.observerForwards.length,1);assert.equal(diagnostics.observerForwards[0].headers.cookie,undefined);assert.deepEqual(diagnostics.forwards,[]);
 await f.revokeMembership();await assert.rejects(f.call('observePreview',[command]),/observer-authority-denied/);
 assert.deepEqual(await f.call('executorDiagnostics',[],{input:command}),{executions:1,stops:0});
});

test('Workspace observation holds unknown execution when stop is unproven and refuses duplicate execution',{timeout:30000},async t=>{
 const f=await setup(t,{observerExecutor:true});await f.call('observerGate',[true]);const command=f.command();await f.call('observerRoute',[command]);
 await f.call('executorConfigure',[],{input:command,value:'unknown'});
 const unknown=await f.call('observePreview',[command]);assert.equal(unknown.status,'unknown');assert.equal(unknown.result,null);
 assert.deepEqual(await f.call('executorLateCapability',[],{input:command}),{denied:true,cancelled:true,forwardDenied:true});
 await f.restart();await f.call('observerGate',[true]);
 assert.deepEqual(await f.call('observePreview',[command]),unknown);
 assert.deepEqual(await f.call('executorDiagnostics',[],{input:command}),{executions:1,stops:1});
 await assert.rejects(f.call('observePreview',[{...command,commandId:'command-b'}]),/observer-call-busy/);
});

test('Workspace alarm retries unknown Observer after restart and clears its wake only after stop proof',{timeout:30000},async t=>{
 const f=await setup(t,{observerExecutor:true});await f.call('observerGate',[true]);const command=f.command();await f.call('observerRoute',[command]);
 await f.call('executorConfigure',[],{input:command,value:'unknown'});
 assert.equal((await f.call('observePreview',[command])).status,'unknown');
 const armed=await f.call('observerAlarm');assert.ok(armed.wake>Date.now());assert.ok(armed.physical<=armed.wake);
 await f.restart();await f.call('observerMaintenanceDue');
 assert.equal((await f.call('observerRecord',[command])).status,'unknown');assert.ok((await f.call('observerAlarm')).wake>Date.now());
 await f.call('executorConfigure',[],{input:command,value:'stopped'});await f.call('observerGate',[false]);await f.call('unready');await f.revokeMembership();
 await f.call('observerMaintenanceDue');
 const stopped=await f.call('observerRecord',[command]);assert.equal(stopped.status,'failed');assert.equal(stopped.errorCode,'observer-execution-reconciled');assert.equal((await f.call('observerAlarm')).wake,null);
 const stats=await f.call('executorDiagnostics',[],{input:command});assert.equal(stats.executions,1);assert.ok(stats.stops>=3);
});

test('an accepted Observer persists its wake and cancellation maintenance does not dispatch a browser',{timeout:30000},async t=>{
 const f=await setup(t,{observerExecutor:true});await f.call('observerGate',[true]);const command=f.command();
 // Inject the crash window after the production journal/wake transaction and
 // before start; the maintenance path below is the real Workspace alarm.
 assert.equal((await f.call('observerAccept',[command])).status,'accepted');assert.ok((await f.call('observerAlarm')).wake!==null);
 await f.restart();await f.call('cancelObserver',[f.scope,f.actor,f.identity.turnId]);await f.call('executorConfigure',[],{input:command,value:'stopped'});
 await f.call('observerMaintenanceDue');assert.equal((await f.call('observerRecord',[command])).status,'failed');assert.equal((await f.call('observerAlarm')).wake,null);
 assert.equal((await f.call('executorDiagnostics',[],{input:command})).executions,0);
});

test('Observer acceptance rolls back when shared alarm projection cannot commit',{timeout:30000},async t=>{
 const f=await setup(t,{observerExecutor:true});await f.call('observerGate',[true]);const command=f.command();await f.call('observerRoute',[command]);
 await f.call('corruptTurnWake',['invalid']);await assert.rejects(f.call('observePreview',[command]),/invalid-workspace-alarm-time/);
 assert.equal(await f.call('observerRecord',[command]),null);assert.equal((await f.call('observerAlarm')).wake,null);
 assert.equal((await f.call('executorDiagnostics',[],{input:command})).executions,0);
 await f.call('corruptTurnWake',[null]);assert.equal((await f.call('observePreview',[command])).status,'completed');assert.equal((await f.call('observerAlarm')).wake,null);
});

test('idle Observer alarm cleanup cannot erase a concurrently accepted call wake',{timeout:30000},async t=>{
 const f=await setup(t,{observerExecutor:true});await f.call('observerGate',[true]);
 for(let i=0;i<3;i++){
  const command={...f.command(),commandId:'race-'+i};await f.call('observerRoute',[command]);await f.call('executorConfigure',[],{input:command,value:'unknown'});
  const [record]=await Promise.all([f.call('observePreview',[command]),f.call('observerMaintenanceDue')]);assert.equal(record.status,'unknown');
  assert.equal((await f.call('observerRecord',[command])).status,'unknown');assert.ok((await f.call('observerAlarm')).wake>Date.now());
  await f.call('executorConfigure',[],{input:command,value:'stopped'});await f.call('observerMaintenanceDue');assert.equal((await f.call('observerAlarm')).wake,null);
 }
});

test('persisted Observer wake is delivered automatically after Workerd restart',{timeout:20000},async t=>{
 const f=await setup(t,{observerExecutor:true});await f.call('observerGate',[true]);const command=f.command();await f.call('observerRoute',[command]);
 await f.call('executorConfigure',[],{input:command,value:'unknown'});assert.equal((await f.call('observePreview',[command])).status,'unknown');
 await f.restart();await f.call('executorConfigure',[],{input:command,value:'stopped'});
 // Do not invoke alarm or rewrite its time. Observe real local alarm delivery.
 const until=Date.now()+9000;let record;
 do{record=await f.call('observerRecord',[command]);if(record.status==='failed')break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<until);
 assert.equal(record.status,'failed');assert.equal((await f.call('observerAlarm')).wake,null);assert.equal((await f.call('executorDiagnostics',[],{input:command})).executions,1);
});
