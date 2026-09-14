import test from 'node:test';
import assert from 'node:assert/strict';
import {createWarmRuntimeWorkerdFixture} from './warm-runtime-workerd-fixture.mjs';
import {warmRuntimeNativeFacadeSource} from './warm-runtime-native-facade.mjs';

test('actual Workerd warm platform: persisted orchestration with instrumented native boundary',{timeout:90000},async t=>{
 const f=await createWarmRuntimeWorkerdFixture(warmRuntimeNativeFacadeSource,stage=>{if(process.env.WARM_FIXTURE_TRACE)console.error(stage);});t.after(()=>f.dispose());const {scope,actor}=await f.create();assert.equal(scope.workspaceGeneration,1);
 await t.test('native fault fixture retains configure and first write before lost acknowledgements across restart',async()=>{
  const actorId='fixture-native-faults',native=(method,args=[])=>f.rpc(method,args,{target:'native',domain:'trustedPi',actorId});
  const identity={scope,sessionId:'fixture-session',turnId:'fixture-turn',dispatchId:'fixture-dispatch'},context={lease:{scope,leaseId:'fixture-lease',leaseEpoch:1,runtimeVersion:'a'.repeat(64)},identity,bindingEpoch:1,filesSha256:'b'.repeat(64)};
  await native('fixtureConfigure',[{standalone:true,configureAckLost:true,writeAckLost:true}]);
  await assert.rejects(native('configureWorkspaceBinding',[{context,deadlineAt:Date.now()+60000}]),/fixture-configure-ack-lost/);
  await assert.rejects(native('writeTurnFile',[identity,'/fixture/input','persisted-input',{}]),/fixture-write-ack-lost/);
  await f.restart();assert.deepEqual((await native('fixtureStats')).context,context);assert.equal((await native('readTurnFile',[identity,'/fixture/input'])).content,'persisted-input');
  await native('destroyWorkspaceBinding',[context]);const stats=await native('fixtureStats');assert.deepEqual(stats.calls.map(call=>call.method),['configure','write','read','destroy']);
 });
 await t.test('independent partial release keeps both slots and global FIFO until the second domain confirms',async()=>{
  const capacity=(method,args=[])=>f.rpc(method,args,{target:'capacity'}),pair=await capacity('requestPair',[scope,'fixture-pair-first']),binding={sessionId:'fixture-session',turnId:'fixture-turn',dispatchId:'fixture-dispatch',bindingEpoch:1};
  await capacity('bind',[pair.ref,binding]);const releasing=await capacity('cancelPair',[pair.ref]),waiting=await capacity('requestPair',[{...scope,workspaceId:'waiting-workspace',projectId:'waiting-project'},'fixture-pair-waiting']);assert.equal(waiting.status,'queued');
  const proof=domain=>({schemaVersion:1,domain,leaseId:pair.ref.leaseId,leaseEpoch:pair.ref.leaseEpoch,kind:'never-started',proofId:'fixture-release-'+domain,observedAt:Date.now(),absentSince:null});
  await capacity('confirmPairReleased',[pair.ref,{project:proof('project')}]);let snapshot=await capacity('pairedSnapshot');assert.equal(snapshot.active.ref.leaseId,releasing.ref.leaseId);assert.equal(snapshot.active.status,'releasing');assert.deepEqual(snapshot.occupied,{project:1,trustedPi:1});assert.equal(snapshot.queue[0].id,waiting.ref.leaseId);
  await capacity('confirmPairReleased',[pair.ref,{trustedPi:proof('trustedPi')}]);snapshot=await capacity('pairedSnapshot');assert.equal(snapshot.active.ref.leaseId,waiting.ref.leaseId);assert.equal(snapshot.active.status,'held');await capacity('cancelPair',[waiting.ref]);assert.deepEqual((await capacity('pairedSnapshot')).occupied,{project:0,trustedPi:0});
 });
 await t.test('actual saved checkpoint permits pure-chat handoff without allocating Project',async()=>{
  const {identity}=await f.submit(scope,actor,'warm-first');
  const journal=await f.until(()=>f.rpc('fixtureJournal',[scope],{scope}),value=>value.turns[identity.turnId]?.persistenceOutcome==='saved'&&value.releaseHold===null,15000).catch(async error=>{console.error('RUNTIME',JSON.stringify(await f.rpc('workspaceRuntimeState',[identity],{target:'runtime',identity})));console.error('NATIVE',JSON.stringify(await f.rpc('stats',[],{target:'native-stats',scope,identity})));console.error('PAIR',JSON.stringify(await f.rpc('pairedSnapshot',[],{target:'capacity'})));throw error;});
  assert.equal(journal.turns[identity.turnId].executionOutcome,'completed');
  const pair=(await f.rpc('pairedSnapshot',[],{target:'capacity'})).active;
  assert.equal(pair.status,'idle');assert.equal(pair.binding.bindingEpoch,1);assert.equal(pair.startClaims.project,null);
  const runtime=await f.rpc('workspaceRuntimeState',[identity],{target:'runtime',identity});assert.deepEqual(runtime.checkpoint,journal.turns[identity.turnId].checkpoint);
 });

 await t.test('RevisionStore committed ACK loss cannot hand off before Journal saved, including restart',async()=>{
  await f.rpc('fixtureMode',['lost'],{target:'revision',scope});
  const {identity}=await f.submit(scope,actor,'warm-commit-lost');
  const committed=await f.until(()=>f.rpc('fixtureCommitStats',[],{target:'revision',scope}),value=>value.committed?.identity?.turnId===identity.turnId,15000);
  assert.ok(committed.committed,'actual RevisionStore accepted the prepared commit');
  let journal=await f.rpc('fixtureJournal',[scope],{scope});assert.notEqual(journal.turns[identity.turnId].persistenceOutcome,'saved');
  let pair=(await f.rpc('pairedSnapshot',[],{target:'capacity'})).active;assert.equal(pair.status,'bound');assert.equal(pair.binding.bindingEpoch,2);assert.equal(pair.handoffProofs,null);
  await f.restart();await f.rpc('fixtureMode',['normal'],{target:'revision',scope});
  journal=await f.until(()=>f.rpc('fixtureJournal',[scope],{scope}),value=>value.turns[identity.turnId]?.persistenceOutcome==='saved'&&value.releaseHold===null,20000);
  pair=(await f.rpc('pairedSnapshot',[],{target:'capacity'})).active;assert.equal(pair.status,'idle');assert.equal(pair.binding.bindingEpoch,2);assert.equal(journal.turns[identity.turnId].executionOutcome,'completed');
 });
 await t.test('handoff accepted with ACK lost is observed after reopen without another binding epoch',async()=>{
  await f.rpc('fixtureHandoffMode',['lost'],{target:'capacity'});const {identity}=await f.submit(scope,actor,'warm-handoff-lost');
  await f.until(()=>f.rpc('pairedSnapshot',[],{target:'capacity'}),value=>value.active?.status==='idle'&&value.active.binding.turnId===identity.turnId,15000);
  const before=await f.rpc('fixtureJournal',[scope],{scope});assert.equal(before.turns[identity.turnId].persistenceOutcome,'saved');
  await f.restart();const after=await f.until(()=>f.rpc('fixtureJournal',[scope],{scope}),value=>value.turns[identity.turnId]?.persistenceOutcome==='saved'&&value.releaseHold===null,20000);
  const pair=(await f.rpc('pairedSnapshot',[],{target:'capacity'})).active;assert.equal(pair.status,'idle');assert.equal(pair.binding.bindingEpoch,3);assert.deepEqual(after.turns[identity.turnId].checkpoint,before.turns[identity.turnId].checkpoint);
  const calls=(await f.rpc('fixtureHandoffStats',[],{target:'capacity'})).filter(call=>call.binding.turnId===identity.turnId);assert.equal(calls.length,1,'lost acknowledgement is reconciled from persisted pair proof');
 });

 await t.test('second Session has a fresh binding and a genuine signed old capability is rejected',async()=>{
  const current=(await f.rpc('pairedSnapshot',[],{target:'capacity'})).active,priorIdentity={scope,...current.binding,generation:scope.workspaceGeneration};delete priorIdentity.bindingEpoch;
  await f.rpc('fixtureConfigure',[{running:true}],{target:'native-current',scope,identity:priorIdentity});
  const first=await f.submit(scope,actor,'warm-cap-first');await f.until(()=>f.rpc('workspaceRuntimeState',[first.identity],{target:'runtime',identity:first.identity}),value=>value.phase==='running');
  const captured=await f.rpc('capture',[],{target:'model-capture',scope,identity:first.identity,actor});assert.equal((await f.rpc('verify',[],{target:'model-verify',captured})).status,503,'valid authority reaches absent provider; no provider is called');
  await f.rpc('fixtureComplete',[first.identity],{target:'native-current',scope,identity:first.identity});await f.until(()=>f.rpc('fixtureJournal',[scope],{scope}),value=>value.turns[first.identity.turnId]?.persistenceOutcome==='saved'&&value.releaseHold===null,15000);
  const second=await f.submit(scope,actor,'warm-cap-second');assert.notEqual(second.sessionId,first.sessionId);await f.until(()=>f.rpc('workspaceRuntimeState',[second.identity],{target:'runtime',identity:second.identity}),value=>value.phase==='running');
  assert.equal((await f.rpc('verify',[],{target:'model-verify',captured})).status,403);const fresh=await f.rpc('capture',[],{target:'model-capture',scope,identity:second.identity,actor});assert.equal((await f.rpc('verify',[],{target:'model-verify',captured:fresh})).status,503);
  await f.rpc('fixtureComplete',[second.identity],{target:'native-current',scope,identity:second.identity});await f.until(()=>f.rpc('fixtureJournal',[scope],{scope}),value=>value.turns[second.identity.turnId]?.persistenceOutcome==='saved'&&value.releaseHold===null,15000);
 });

 await t.test('all three admitted unknown operations stay closed and pending after restart and prevent reuse',async()=>{
  const {identity}=await f.submit(scope,actor,'warm-pending');await f.until(()=>f.rpc('workspaceRuntimeState',[identity],{target:'runtime',identity}),value=>value.phase==='running');
  await f.rpc('pending',[],{target:'pending-operations',identity,actor});
  const closure=await f.rpc('closeWorkspaceRuntime',[{identity}],{scope});assert.equal(closure.settled.length,3);for(const ledger of closure.settled){assert.equal(ledger.closed,true);assert.equal(ledger.pending,1);assert.equal(ledger.unknown,1);}
  await f.rpc('fixtureComplete',[identity],{target:'native-current',scope,identity});await f.until(()=>f.rpc('pairedSnapshot',[],{target:'capacity'}),value=>value.active?.status==='releasing',15000);
  await f.restart();const recovered=await f.rpc('closeWorkspaceRuntime',[{identity}],{scope});for(const ledger of recovered.settled){assert.equal(ledger.closed,true);assert.equal(ledger.pending,1);assert.equal(ledger.unknown,1);}
  const pair=(await f.rpc('pairedSnapshot',[],{target:'capacity'})).active;assert.equal(pair.status,'releasing');assert.equal(pair.handoffProofs,null);assert.equal(pair.startClaims.trustedPi!==null,true);
 });

});

for(const fault of ['configure','write'])test('actual Workspace cleanup after '+fault+' persisted before ACK loss and restart',{timeout:60000},async t=>{
 const f=await createWarmRuntimeWorkerdFixture(warmRuntimeNativeFacadeSource,()=>{},{FIXTURE_NATIVE_OPTIONS:JSON.stringify({[fault+'AckLost']:true})});t.after(()=>f.dispose());const {scope,actor}=await f.create();const {identity}=await f.submit(scope,actor,'warm-'+fault+'-fault');
 await f.until(()=>f.rpc('workspaceRuntimeState',[identity],{target:'runtime',identity}),value=>value.phase==='unknown');
 const stats=await f.rpc('stats',[],{target:'native-stats',scope,identity});assert.ok(stats.context);assert.equal(stats.calls.filter(call=>call.method==='configure').length,1);if(fault==='write')assert.equal(stats.calls.filter(call=>call.method==='write').length,1);
 const ref=(await f.rpc('pairedSnapshot',[],{target:'capacity'})).active.ref;
 await f.rpc('cancelTurn',[{scope,actor,turnId:identity.turnId}],{scope});
 if(fault==='configure'){
  await f.until(()=>f.rpc('pairedSnapshot',[],{target:'capacity'}),value=>value.occupied.project===0&&value.occupied.trustedPi===0);await f.restart();assert.deepEqual((await f.rpc('pairedSnapshot',[],{target:'capacity'})).occupied,{project:0,trustedPi:0});
 }else{
  await f.until(()=>f.rpc('stats',[],{target:'native-stats',scope,identity}),value=>value.calls.some(call=>call.method==='destroy-lease'));
  assert.equal((await f.rpc('pairedSnapshot',[],{target:'capacity'})).active.status,'releasing');
  await f.restart();await f.rpc('drainRuntimeLease',[{ref}],{scope});const recovered=await f.rpc('stats',[],{target:'native-stats',scope,identity});assert.ok(recovered.calls.filter(call=>call.method==='destroy-lease').length>=2);assert.equal(recovered.calls.filter(call=>call.method==='write').length,1);assert.equal(recovered.calls.filter(call=>call.method==='start').length,0);assert.equal(recovered.calls.filter(call=>call.method==='configure').length,1,'cleanup must not reactivate configuration');assert.equal((await f.rpc('pairedSnapshot',[],{target:'capacity'})).active.status,'releasing','real release guard is not shortened by the fixture');
 }
 const journal=await f.rpc('fixtureJournal',[scope],{scope});assert.equal(journal.turns[identity.turnId].checkpoint,null);assert.notEqual(journal.turns[identity.turnId].persistenceOutcome,'saved');assert.equal(journal.workspaceHead,null);
});

for(const legacy of [false,true])test('gate-off pair cancellation persists before delayed admission'+(legacy?' alongside an unchanged legacy ticket':''),{timeout:60000},async t=>{
 const f=await createWarmRuntimeWorkerdFixture(warmRuntimeNativeFacadeSource,()=>{},{M2_WORKSPACE_RUNTIME_REUSE_ENABLED:'false'});t.after(()=>f.dispose());const {scope}=await f.create();const capacity=(method,args=[])=>f.rpc(method,args,{target:'capacity'});
 const coldIdentity={tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,sessionId:'cold-session',operationId:'cold-operation',turnId:'cold-turn',generation:1};const cold=legacy?await capacity('request',[coldIdentity]):null;
 const cancelled=await capacity('cancelPairRequest',[scope,'late-pair']);assert.equal(cancelled.lease,null);assert.ok(cancelled.cancelledAt>0);
 if(cold)assert.deepEqual((await capacity('lookup',[coldIdentity])).ticket,cold.ticket);
 await f.restart({M2_WORKSPACE_RUNTIME_REUSE_ENABLED:'true'});
 await assert.rejects(capacity('requestPair',[scope,'late-pair']),/request-cancelled/);assert.equal((await capacity('cancelPairRequest',[scope,'late-pair'])).cancelledAt,cancelled.cancelledAt);
 if(cold)assert.deepEqual((await capacity('lookup',[coldIdentity])).ticket,cold.ticket);
 const snapshot=await capacity('pairedSnapshot');assert.deepEqual(snapshot.occupied,{project:legacy?1:0,trustedPi:legacy?1:0});assert.equal(snapshot.active,null);
});

for(const reused of [false,true])for(const loss of ['before','after'])test('actual pair binding '+loss+' delivery fault cleans '+(reused?'retained prior native binding':'first unstarted lease')+' without a new native start',{timeout:60000},async t=>{
 const f=await createWarmRuntimeWorkerdFixture(warmRuntimeNativeFacadeSource);t.after(()=>f.dispose());const {scope,actor}=await f.create();const capacity=(method,args=[])=>f.rpc(method,args,{target:'capacity'});let priorLease=null;
 if(reused){const prior=await f.submit(scope,actor,'prior-binding');await f.until(()=>f.rpc('fixtureJournal',[scope],{scope}),value=>value.turns[prior.identity.turnId]?.persistenceOutcome==='saved'&&value.releaseHold===null);priorLease=(await f.rpc('workspaceRuntimeBinding',[{identity:prior.identity}],{scope})).lease;}
 const originalHead=(await f.rpc('fixtureJournal',[scope],{scope})).workspaceHead;await capacity('fixtureBindMode',[loss]);const {identity}=await f.submit(scope,actor,'lost-binding');await f.until(()=>f.rpc('workspaceRuntimeState',[identity],{target:'runtime',identity}),value=>value.phase==='unknown');
 const initial=(await capacity('pairedSnapshot')).active;assert.equal(initial.status,loss==='after'?'bound':reused?'idle':'held');assert.equal(initial.binding?.bindingEpoch??null,loss==='after'?(reused?2:1):reused?1:null);
 await f.rpc('cancelTurn',[{scope,actor,turnId:identity.turnId}],{scope});
 if(reused){await f.until(()=>capacity('pairedSnapshot'),value=>value.active?.status==='releasing');const stats=await f.until(()=>f.rpc('fixtureStats',[],{target:'native-lease',lease:priorLease}),value=>value.calls.some(call=>call.method==='destroy-lease'));assert.equal(stats.calls.filter(call=>call.method==='start').length,1);await f.restart();await f.rpc('drainRuntimeLease',[{ref:initial.ref}],{scope});assert.equal((await capacity('pairedSnapshot')).active.status,'releasing');const after=await f.rpc('fixtureStats',[],{target:'native-lease',lease:priorLease});assert.equal(after.calls.filter(call=>call.method==='start').length,1);assert.equal(after.calls.filter(call=>call.method==='configure').length,1);}
 else {await f.until(()=>capacity('pairedSnapshot'),value=>value.occupied.project===0&&value.occupied.trustedPi===0);await f.restart();assert.deepEqual((await capacity('pairedSnapshot')).occupied,{project:0,trustedPi:0});}
 const calls=(await capacity('fixtureBindStats')).filter(call=>call.binding.turnId===identity.turnId);assert.equal(calls.length,1);const journal=await f.rpc('fixtureJournal',[scope],{scope});assert.equal(journal.turns[identity.turnId].checkpoint,null);assert.notEqual(journal.turns[identity.turnId].persistenceOutcome,'saved');assert.deepEqual(journal.workspaceHead,originalHead);
});
