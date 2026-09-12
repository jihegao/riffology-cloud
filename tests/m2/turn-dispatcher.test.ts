import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnDispatcher, type TurnCapacityPort, type TurnRuntimePort, type TurnRuntimeReceipt } from '../../services/turn/dispatcher.ts';
import { MemoryTurnStore } from '../../services/turn/store.ts';
import { TurnJournal } from '../../services/turn/journal.ts';
import type { TurnBaseCheckpoints, TurnScope } from '../../services/turn/protocol.ts';
import type { ToolArtifactReferenceInput, ToolArtifactReferenceReceipt } from '../../services/artifacts/protocol.ts';
import type { TurnOperationTelemetryEvent } from '../../services/turn/operation-telemetry.ts';

const scope:TurnScope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const actor={userId:'user-a',authVersion:1};
const checkpoint={revisionId:'revision-one',objectKey:'checkpoint-one',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1005};
const stop={confirmationId:'stop-one',observedAt:1004,nativeRunning:false as const,fenced:true as const};
const artifact={schemaVersion:1 as const,artifactId:`artifact-${'a'.repeat(60)}`,operation:'list' as const,mediaType:'application/json' as const,bytes:20_000,sha256:'c'.repeat(64),createdAt:1002};
type RuntimeInput={scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number;message?:string;base?:TurnBaseCheckpoints;capacityLease?:{operationId:string;leaseId:string}};
function receipt(input:RuntimeInput,overrides:Record<string,unknown>={}):TurnRuntimeReceipt{const phase=(overrides.phase??'running') as TurnRuntimeReceipt['phase'],lease=input.capacityLease??{operationId:`operation-${input.dispatchId}`,leaseId:`lease-${input.dispatchId}`},resourceDisposition=overrides.resourceDisposition??(phase==='terminal'||phase==='absent'?{status:'released',...lease,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,proofId:`proof-${input.dispatchId}`,releasedAt:1006}:{status:'active',...lease,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation});return {scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,phase:'running',outcome:null,executionErrorCode:null,events:[],checkpoint:null,persistenceErrorCode:null,stopped:null,resourceDisposition,...overrides} as unknown as TurnRuntimeReceipt;}
function fixture(){
  let now=1000;
  const store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>++now),calls:string[]=[],acceptedInputs:RuntimeInput[]=[],leases=new Map<string,{operationId:string;leaseId:string}>();
  let accept=(input:RuntimeInput):Promise<TurnRuntimeReceipt>=>Promise.resolve(receipt(input));
  let observe=(input:RuntimeInput):Promise<TurnRuntimeReceipt>=>Promise.resolve(receipt(input,{phase:'unknown'}));
  let cancel=(input:RuntimeInput):Promise<TurnRuntimeReceipt>=>Promise.resolve(receipt(input,{phase:'unknown'}));
  const runtime:TurnRuntimePort={accept:async input=>{calls.push('accept');leases.set(input.dispatchId,input.capacityLease);acceptedInputs.push(structuredClone(input));return accept(input);},observe:async input=>{calls.push('observe');return observe({...input,capacityLease:leases.get(input.dispatchId)??store.snapshot()?.turns[input.turnId]?.resourceLease??undefined});},cancel:async input=>{calls.push('cancel');return cancel({...input,capacityLease:leases.get(input.dispatchId)??store.snapshot()?.turns[input.turnId]?.resourceLease??undefined});}};
  return {store,journal,calls,acceptedInputs,runtime,setAccept(value:typeof accept){accept=value;},setObserve(value:typeof observe){observe=value;},setCancel(value:typeof cancel){cancel=value;}};
}
async function queued(f:ReturnType<typeof fixture>,key='turn-key'){const session=(await f.journal.createSession(scope,actor,`session-${key}`,{title:'Session'})).session;return (await f.journal.submit(scope,actor,session.id,key,{message:'Build model'})).turn;}

test('dispatcher commits a terminal receipt only after native stop and checkpoint proof',async()=>{
  const f=fixture();await queued(f);f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint}));
  const result=await new TurnDispatcher(f.journal,f.runtime).tick(scope,1);
  assert.equal(result?.status,'completed');assert.equal(result?.persistenceOutcome,'saved');assert.deepEqual(f.calls,['accept']);assert.deepEqual(f.acceptedInputs[0]!.base,{workspace:null,session:null});assert.equal(f.store.snapshot()!.activeTurnId,null);
});
test('dispatcher reconciles an exact release hold before it claims queued work',async()=>{
  const f=fixture(),first=await queued(f,'release-first');let released=false;f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint,resourceDisposition:{status:'release-pending',...input.capacityLease!,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,reasonCode:'trusted-pi-release-pending',since:1005,nextAttemptAt:2000}}));
  f.setObserve(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint,resourceDisposition:released?{status:'released',...input.capacityLease!,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,proofId:'release-proof',releasedAt:2001}:{status:'release-pending',...input.capacityLease!,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,reasonCode:'trusted-pi-release-pending',since:1005,nextAttemptAt:2000}}));
  const dispatcher=new TurnDispatcher(f.journal,f.runtime);await dispatcher.tick(scope,1);const second=await queued(f,'release-second');assert.equal(f.store.snapshot()!.releaseHold?.turnId,first.id);assert.equal(dispatcher.nextWakeAt(scope),2000);
  assert.equal((await dispatcher.tick(scope,1))?.id,first.id);assert.equal(f.store.snapshot()!.turns[second.id]!.status,'queued');assert.deepEqual(f.calls,['accept','observe']);released=true;f.setAccept(async input=>receipt(input));
  const next=await dispatcher.tick(scope,1);assert.equal(next?.id,second.id);assert.equal(next?.status,'running');assert.equal(f.store.snapshot()!.releaseHold,null);assert.deepEqual(f.calls,['accept','observe','observe','accept']);
});
test('dispatcher emits independent checkpoint, hold age, blocked start and release metrics',async()=>{
  const f=fixture();await queued(f,'release-metrics');let released=false;f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint,resourceDisposition:{status:'release-pending',...input.capacityLease!,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,reasonCode:'trusted-pi-release-pending',since:1005,nextAttemptAt:2000}}));
  f.setObserve(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint,resourceDisposition:released?{status:'released',...input.capacityLease!,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,proofId:'release-proof',releasedAt:2001}:{status:'release-pending',...input.capacityLease!,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,reasonCode:'trusted-pi-release-pending',since:1005,nextAttemptAt:2000}}));
  const events:TurnOperationTelemetryEvent[]=[],dispatcher=new TurnDispatcher(f.journal,f.runtime,null,null,()=>2001,event=>events.push(event));await dispatcher.tick(scope,1);await queued(f,'release-metrics-second');released=true;f.setAccept(async input=>receipt(input));await dispatcher.tick(scope,1);
  assert.deepEqual(events.map(event=>event.metric),['checkpoint_result','release_hold_count','release_hold_age','hold_start_attempts','queued_behind_release','release_result','release_confirmation_delay']);assert.equal(events.find(event=>event.metric==='hold_start_attempts')?.value,0);assert.equal(events.find(event=>event.metric==='queued_behind_release')?.value,1);assert.equal(events.find(event=>event.metric==='release_hold_age')?.durationMs,996);assert.equal(events.find(event=>event.metric==='release_confirmation_delay')?.reasonCategory,'release_confirmed');assert.equal(new Set(events.map(event=>event.correlationId)).size,1);
});
test('capacity wait persists opaque admission state and acquired lease is consumed with the FIFO claim',async()=>{
  const f=fixture(),turn=await queued(f,'capacity-first');let available=false;const capacity:TurnCapacityPort={
    async acquire(input){return available?{status:'acquired',turnId:input.turnId,generation:input.generation,ticketId:'ticket-one',operationId:input.operationId!,leaseId:'lease-one'}:{status:'waiting',turnId:input.turnId,generation:input.generation,ticketId:'ticket-one',operationId:input.operationId!,reasonCode:'trusted-pi-capacity-unavailable',since:1005,nextAttemptAt:2000};},
    async releaseNeverStarted(){throw Error('unexpected-never-started');},
  },dispatcher=new TurnDispatcher(f.journal,f.runtime,null,capacity);
  assert.equal(await dispatcher.tick(scope,1),null);assert.equal(f.store.snapshot()!.resourceWait?.ticketId,'ticket-one');assert.equal(dispatcher.nextWakeAt(scope),2000);assert.deepEqual(f.calls,[]);
  const operationId=f.store.snapshot()!.resourceWait!.operationId;available=true;const running=await dispatcher.tick(scope,1);assert.equal(running?.id,turn.id);assert.deepEqual(running?.resourceLease,{operationId,leaseId:'lease-one'});assert.equal(f.store.snapshot()!.resourceWait,null);assert.deepEqual(f.acceptedInputs[0]!.capacityLease,{operationId,leaseId:'lease-one'});
});
test('capacity acquire transport loss reuses the operation reserved before RPC',async()=>{
  const f=fixture(),turn=await queued(f,'capacity-transport'),operations:string[]=[],capacity:TurnCapacityPort={
    async acquire(input){operations.push(input.operationId!);if(operations.length===1)throw Error('capacity-response-lost');return {status:'acquired',turnId:input.turnId,generation:input.generation,ticketId:'ticket-transport',operationId:input.operationId!,leaseId:'lease-transport'};},
    async releaseNeverStarted(){throw Error('unexpected-never-started');},
  },dispatcher=new TurnDispatcher(f.journal,f.runtime,null,capacity);
  await assert.rejects(dispatcher.tick(scope,1),/capacity-response-lost/);const reserved=f.store.snapshot()!.resourceWait!;assert.equal(reserved.turnId,turn.id);assert.equal(reserved.ticketId,null);assert.ok(reserved.operationId);
  const running=await dispatcher.tick(scope,1);assert.equal(running?.id,turn.id);assert.deepEqual(operations,[reserved.operationId,reserved.operationId]);assert.deepEqual(running?.resourceLease,{operationId:reserved.operationId,leaseId:'lease-transport'});
});
test('queued Stop persists a tombstone until exact never-started capacity cleanup is acknowledged',async()=>{
  const f=fixture(),turn=await queued(f,'capacity-cancel'),released:any[]=[];let lose=true;const capacity:TurnCapacityPort={
    async acquire(input){return {status:'waiting',turnId:input.turnId,generation:input.generation,ticketId:'ticket-cancel',operationId:input.operationId!,reasonCode:'trusted-pi-capacity-unavailable',since:1001,nextAttemptAt:2000};},
    async releaseNeverStarted(input){released.push(structuredClone(input));if(lose){lose=false;throw Error('capacity-cancel-response-lost');}return {proofId:'never-started-proof',releasedAt:2001};},
  },dispatcher=new TurnDispatcher(f.journal,f.runtime,null,capacity);
  await dispatcher.tick(scope,1);await assert.rejects(dispatcher.cancel(scope,actor,turn),/capacity-cancel-response-lost/);let state=f.store.snapshot()!;assert.equal(state.turns[turn.id]!.status,'queued');assert.ok(state.turns[turn.id]!.cancelRequestedAt);assert.equal(state.resourceWait?.operationId,released[0].operationId);assert.deepEqual(f.calls,[]);
  const cancelled=await dispatcher.tick(scope,1);state=f.store.snapshot()!;assert.equal(cancelled?.status,'cancelled');assert.equal(state.resourceWait,null);assert.equal(state.turns[turn.id]!.cancelDisposition,'cancelled');assert.equal(released.length,2);assert.deepEqual(released[1],released[0]);assert.deepEqual(f.calls,[]);
});
test('claimed lease plus absent Runtime cancels capacity without accepting or starting Pi',async()=>{
  const f=fixture(),turn=await queued(f,'capacity-claimed-cancel'),released:any[]=[];const capacity:TurnCapacityPort={
    async acquire(input){return {status:'acquired',turnId:input.turnId,generation:input.generation,ticketId:'ticket-held',operationId:input.operationId!,leaseId:'lease-held'};},
    async releaseNeverStarted(input){released.push(structuredClone(input));return {proofId:'never-started-held',releasedAt:2001};},
  },dispatcher=new TurnDispatcher(f.journal,f.runtime,null,capacity);f.setAccept(async()=>{throw Error('runtime-accept-not-delivered');});await assert.rejects(dispatcher.tick(scope,1),/runtime-accept-not-delivered/);f.setCancel(async input=>receipt(input,{phase:'absent'}));
  const cancelled=await dispatcher.cancel(scope,actor,turn);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.cancelDisposition,'cancelled');assert.equal(cancelled.errorCode,'turn-native-never-started');assert.equal(cancelled.persistenceOutcome,null);assert.equal(f.store.snapshot()!.activeTurnId,null);assert.deepEqual(f.calls,['accept','cancel']);assert.deepEqual(released,[{scope,sessionId:turn.sessionId,turnId:turn.id,generation:1,ticketId:null,operationId:cancelled.resourceLease!.operationId,leaseId:'lease-held',reasonCode:'turn-cancelled-before-runtime-accept',observedAt:cancelled.cancelRequestedAt}]);
});
test('R2 receipt materialization is reconciled after a journal commit failure',async()=>{
  const f=fixture();await queued(f);f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint}));
  f.setObserve(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint}));
  let commitAttempts=0;
  const journal=new Proxy(f.journal,{get(target,key,receiver){
    if(key!=='commitCheckpoint'){const value=Reflect.get(target,key,receiver);return typeof value==='function'?value.bind(target):value;}
    return async (...args:Parameters<TurnJournal['commitCheckpoint']>)=>{commitAttempts++;if(commitAttempts===1)throw Error('journal-commit-unavailable');return target.commitCheckpoint(...args);};
  }});
  const dispatcher=new TurnDispatcher(journal,f.runtime);
  await assert.rejects(dispatcher.tick(scope,1),/journal-commit-unavailable/);
  assert.equal(f.store.snapshot()!.turns[f.store.snapshot()!.activeTurnId!]!.status,'checkpointing');
  const recovered=await dispatcher.tick(scope,1);
  assert.equal(recovered?.status,'completed');assert.equal(recovered?.persistenceOutcome,'saved');assert.equal(commitAttempts,2);assert.deepEqual(f.calls,['accept','observe']);
});
test('lost journal commit response leaves the durable saved Turn authoritative',async()=>{
  const f=fixture();const turn=await queued(f);f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint}));
  let loseResponse=true;
  const journal=new Proxy(f.journal,{get(target,key,receiver){
    if(key!=='commitCheckpoint'){const value=Reflect.get(target,key,receiver);return typeof value==='function'?value.bind(target):value;}
    return async (...args:Parameters<TurnJournal['commitCheckpoint']>)=>{const saved=await target.commitCheckpoint(...args);if(loseResponse){loseResponse=false;throw Error('journal-response-lost');}return saved;};
  }});
  const dispatcher=new TurnDispatcher(journal,f.runtime);
  await assert.rejects(dispatcher.tick(scope,1),/journal-response-lost/);
  const durable=f.store.snapshot()!.turns[turn.id]!;
  assert.equal(durable.status,'completed');assert.equal(durable.persistenceOutcome,'saved');assert.equal(f.store.snapshot()!.activeTurnId,null);
  assert.equal(await dispatcher.tick(scope,1),null);assert.deepEqual(f.calls,['accept']);
});
test('dispatcher accepts a canonical hierarchical R2 checkpoint key',async()=>{
  const f=fixture();await queued(f);const nested={...checkpoint,objectKey:'turns/tenant-a/workspace-a/1/revision-one.json'};
  f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint:nested}));
  const result=await new TurnDispatcher(f.journal,f.runtime).tick(scope,1);assert.equal(result?.checkpoint?.objectKey,nested.objectKey);
});
test('dispatcher rejects traversal and noncanonical checkpoint keys before commit',async()=>{
  for(const [index,objectKey] of ['/absolute.json','turns/../escape.json','turns//double.json','turns/bad key.json'].entries()){
    const f=fixture();await queued(f,`invalid-key-${index}`);f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint:{...checkpoint,objectKey}}));
    await assert.rejects(new TurnDispatcher(f.journal,f.runtime).tick(scope,1),/checkpoint-object-key/);
  }
});
test('lost accept response is observed as unknown and never accepted a second time',async()=>{
  const f=fixture();await queued(f);f.setAccept(async()=>{throw Error('transport-lost-after-accept');});const dispatcher=new TurnDispatcher(f.journal,f.runtime);
  await assert.rejects(dispatcher.tick(scope,1),/transport-lost/);const replay=await dispatcher.tick(scope,1);
  assert.equal(replay?.status,'running');assert.deepEqual(f.calls,['accept','observe']);assert.equal(f.store.snapshot()!.activeTurnId,replay!.id);
});
test('replayed claim resends the same immutable dispatch only after runtime proves absence',async()=>{
  const f=fixture();await queued(f);f.setAccept(async()=>{throw Error('transport-lost');});const dispatcher=new TurnDispatcher(f.journal,f.runtime);await assert.rejects(dispatcher.tick(scope,1));
  f.setObserve(async input=>receipt(input,{phase:'absent'}));f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint}));
  const result=await dispatcher.tick(scope,1);assert.equal(result?.status,'completed');assert.deepEqual(f.calls,['accept','observe','accept']);
});
test('mismatched receipt identity is rejected before runtime events mutate the journal',async()=>{
  const f=fixture();await queued(f);f.setAccept(async input=>({...receipt(input,{events:[{eventId:'event-one',type:'assistant.delta',at:1003,payload:{text:'bad'}}]}),turnId:'wrong'}));
  await assert.rejects(new TurnDispatcher(f.journal,f.runtime).tick(scope,1),/receipt-scope-denied/);assert.deepEqual(f.store.snapshot()!.events.map(item=>item.type),['turn.queued','turn.started']);
});
test('mismatched Pi session identity is rejected before runtime events mutate the journal',async()=>{
  const f=fixture();await queued(f);f.setAccept(async input=>({...receipt(input,{events:[{eventId:'event-one',type:'assistant.delta',at:1003,payload:{text:'bad'}}]}),sessionId:'wrong-session'}));
  await assert.rejects(new TurnDispatcher(f.journal,f.runtime).tick(scope,1),/receipt-scope-denied/);assert.deepEqual(f.store.snapshot()!.events.map(item=>item.type),['turn.queued','turn.started']);
});
test('artifact references are retained before tool completion enters the journal and replay idempotently',async()=>{
  const f=fixture();const turn=await queued(f);f.setAccept(async input=>receipt(input,{events:[{eventId:'event-artifact',type:'tool.completed',at:1003,payload:{toolCallId:'call-a',name:'project_list',isError:false,artifact}}]}));
  const order:string[]=[],references=new Map<string,ToolArtifactReferenceReceipt>();
  const journal=new Proxy(f.journal,{get(target,key,receiver){if(key!=='appendRuntime'){const value=Reflect.get(target,key,receiver);return typeof value==='function'?value.bind(target):value;}return async (...args:Parameters<TurnJournal['appendRuntime']>)=>{order.push('append');return target.appendRuntime(...args);};}});
  const port={retain:async(input:ToolArtifactReferenceInput)=>{order.push('retain');const key=`${input.kind}:${input.referenceId}`,prior=references.get(key);if(prior)return prior;const saved={schemaVersion:1 as const,artifactId:input.artifactId,kind:input.kind,referenceId:input.referenceId,retainedAt:1002,releasedAt:null};references.set(key,saved);return saved;}};
  const dispatcher=new TurnDispatcher(journal,f.runtime,port);await dispatcher.tick(scope,1);assert.deepEqual(order,['retain','append']);assert.equal(references.size,1);
  f.setObserve(async input=>receipt(input,{events:[{eventId:'event-artifact',type:'tool.completed',at:1003,payload:{toolCallId:'call-a',name:'project_list',isError:false,artifact}}]}));await dispatcher.tick(scope,1);assert.deepEqual(order,['retain','append','retain','append']);assert.equal(references.size,1);assert.equal(f.store.snapshot()!.turns[turn.id]!.status,'running');
});
test('artifact retain failure prevents the tool completion event from entering the journal',async()=>{
  const f=fixture();await queued(f);f.setAccept(async input=>receipt(input,{events:[{eventId:'event-artifact',type:'tool.completed',at:1003,payload:{toolCallId:'call-a',name:'project_list',isError:false,artifact}}]}));
  await assert.rejects(new TurnDispatcher(f.journal,f.runtime,{retain:async()=>{throw Error('artifact-reference-unavailable');}}).tick(scope,1),/artifact-reference-unavailable/);
  assert.deepEqual(f.store.snapshot()!.events.map(item=>item.type),['turn.queued','turn.started']);
});
test('malformed artifact receipt and missing reference store fail before journal mutation',async()=>{
  for(const [index,value,error] of [[0,{...artifact,artifactId:'../escape'},/invalid-tool-artifact-id/],[1,artifact,/reference-store-not-configured/]] as const){
    const f=fixture();await queued(f,`artifact-invalid-${index}`);f.setAccept(async input=>receipt(input,{events:[{eventId:'event-artifact',type:'tool.completed',at:1003,payload:{toolCallId:'call-a',name:'project_list',isError:false,artifact:value}}]}));
    await assert.rejects(new TurnDispatcher(f.journal,f.runtime,index===0?{retain:async()=>{throw Error('unexpected-retain');}}:null).tick(scope,1),error);assert.deepEqual(f.store.snapshot()!.events.map(item=>item.type),['turn.queued','turn.started']);
  }
});
test('terminal receipt without fenced native-stop proof fails closed and keeps the turn active',async()=>{
  const f=fixture();const turn=await queued(f);f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'completed',checkpoint,stopped:null}));
  await assert.rejects(new TurnDispatcher(f.journal,f.runtime).tick(scope,1),/invalid-turn-runtime-receipt/);assert.equal(f.store.snapshot()!.turns[turn.id]!.status,'running');assert.equal(f.store.snapshot()!.activeTurnId,turn.id);
});
test('persistence failure is terminal but preserves the execution result separately',async()=>{
  const f=fixture();await queued(f);f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,persistenceErrorCode:'r2-write-failed'}));
  const result=await new TurnDispatcher(f.journal,f.runtime).tick(scope,1);assert.equal(result?.status,'failed');assert.equal(result?.executionOutcome,'completed');assert.equal(result?.persistenceOutcome,'failed');assert.equal(result?.persistenceErrorCode,'r2-write-failed');
});
test('recovery hold observes a late commit only to release the workspace and never rewrites the failed turn',async()=>{
  const f=fixture(),dispatcher=new TurnDispatcher(f.journal,f.runtime),savedTurn=await queued(f,'saved-head');
  f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint}));
  const saved=await dispatcher.tick(scope,1);assert.equal(saved?.id,savedTurn.id);assert.deepEqual(f.store.snapshot()!.workspaceHead,checkpoint);
  const turn=await queued(f,'late-commit'),claim=await f.journal.claim(scope,1);
  await f.journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:claim!.turn.dispatchId!,runtimeGeneration:1,outcome:'completed'});
  await f.journal.failCheckpoint(scope,{turnId:turn.id,dispatchId:claim!.turn.dispatchId!,runtimeGeneration:1,errorCode:'turn-checkpoint-recovery-hold'});
  const lateCheckpoint={...checkpoint,revisionId:'revision-late',objectKey:'checkpoint-late',committedAt:1010};
  f.setObserve(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint:lateCheckpoint,resourceDisposition:{status:'released',...claim!.turn.resourceLease!,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,proofId:'late-release-proof',releasedAt:1011}}));
  const observed=await dispatcher.tick(scope,1);
  assert.equal(observed?.status,'failed');assert.equal(observed?.checkpoint,null);assert.equal(f.journal.recovery(scope),null);
  assert.deepEqual(f.store.snapshot()!.workspaceHead,checkpoint);assert.equal(f.store.snapshot()!.sessions[turn.sessionId]!.head,null);
  const accepted=await f.journal.submit(scope,actor,turn.sessionId,'after-hold',{message:'new work'});assert.equal(accepted.turn.status,'queued');assert.deepEqual(f.calls,['accept','observe']);
});
test('unknown checkpoint stays active and a later immutable receipt completes the same turn',async()=>{
  const f=fixture();const turn=await queued(f),dispatcher=new TurnDispatcher(f.journal,f.runtime);f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,persistenceErrorCode:'turn-checkpoint-unknown'}));
  const pending=await dispatcher.tick(scope,1);assert.equal(pending?.status,'checkpointing');assert.equal(pending?.executionOutcome,'completed');assert.equal(pending?.persistenceOutcome,null);assert.equal(f.store.snapshot()!.activeTurnId,turn.id);
  f.setObserve(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint}));const saved=await dispatcher.tick(scope,1);assert.equal(saved?.status,'completed');assert.equal(saved?.persistenceOutcome,'saved');assert.equal(saved?.checkpoint?.revisionId,checkpoint.revisionId);assert.equal(f.store.snapshot()!.activeTurnId,null);assert.deepEqual(f.calls,['accept','observe']);
});
test('a deterministic missing base remains terminal because no checkpoint can appear later',async()=>{
  const f=fixture();await queued(f);f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'failed',executionErrorCode:'turn-base-unavailable',stopped:stop,persistenceErrorCode:'turn-checkpoint-unknown'}));
  const failed=await new TurnDispatcher(f.journal,f.runtime).tick(scope,1);assert.equal(failed?.status,'failed');assert.equal(failed?.errorCode,'turn-base-unavailable');assert.equal(failed?.persistenceOutcome,'failed');assert.equal(failed?.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(f.store.snapshot()!.activeTurnId,null);
});
test('an unresolved native start fails without checkpoint materialization and establishes the exact release hold',async()=>{
  const f=fixture();const turn=await queued(f,'native-start-unresolved');f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'failed',executionErrorCode:'turn-native-start-unresolved',stopped:stop,persistenceErrorCode:'turn-checkpoint-unknown',resourceDisposition:{status:'recovery-hold',...input.capacityLease!,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,reasonCode:'project-workspace-release-unconfirmed',since:1005,nextAttemptAt:61_005}}));
  const failed=await new TurnDispatcher(f.journal,f.runtime).tick(scope,1),state=f.store.snapshot()!;assert.equal(failed?.status,'failed');assert.equal(failed?.errorCode,'turn-native-start-unresolved');assert.equal(failed?.persistenceOutcome,'failed');assert.equal(failed?.checkpoint,null);assert.equal(state.activeTurnId,null);assert.equal(state.releaseHold?.turnId,turn.id);assert.equal(state.releaseHold?.status,'recovery-hold');assert.equal(state.recoveryHold,null);
});
test('an unresolved observed execution is terminally non-persistable and establishes the exact release hold',async()=>{
  const f=fixture();const turn=await queued(f,'native-execution-unresolved');f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'failed',executionErrorCode:'turn-native-execution-unresolved',stopped:stop,persistenceErrorCode:'turn-checkpoint-unknown',resourceDisposition:{status:'recovery-hold',...input.capacityLease!,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,reasonCode:'project-workspace-release-unconfirmed',since:1005,nextAttemptAt:61_005}}));
  const failed=await new TurnDispatcher(f.journal,f.runtime).tick(scope,1),state=f.store.snapshot()!;assert.equal(failed?.status,'failed');assert.equal(failed?.errorCode,'turn-native-execution-unresolved');assert.equal(failed?.persistenceOutcome,'failed');assert.equal(failed?.checkpoint,null);assert.equal(state.activeTurnId,null);assert.equal(state.releaseHold?.turnId,turn.id);assert.equal(state.releaseHold?.status,'recovery-hold');assert.equal(state.recoveryHold,null);
});
test('an absent native execution after cancellation fails terminally and releases the active turn',async()=>{
  const f=fixture();const turn=await queued(f),dispatcher=new TurnDispatcher(f.journal,f.runtime);await dispatcher.tick(scope,1);
  f.setCancel(async input=>receipt(input,{phase:'terminal',outcome:'interrupted',executionErrorCode:'turn-native-execution-absent',stopped:stop,persistenceErrorCode:'turn-checkpoint-unknown'}));
  const failed=await dispatcher.cancel(scope,actor,f.store.snapshot()!.turns[turn.id]!);
  assert.equal(failed.status,'failed');assert.equal(failed.executionOutcome,'interrupted');assert.equal(failed.errorCode,'turn-native-execution-absent');assert.equal(failed.persistenceOutcome,'failed');assert.equal(failed.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(f.store.snapshot()!.activeTurnId,null);
});
test('runtime execution errors and checkpoint errors are not conflated',async()=>{
  const f=fixture();await queued(f);f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'failed',executionErrorCode:'provider-timeout',stopped:stop,checkpoint}));
  const result=await new TurnDispatcher(f.journal,f.runtime).tick(scope,1);assert.equal(result?.status,'failed');assert.equal(result?.errorCode,'provider-timeout');assert.equal(result?.persistenceOutcome,'saved');assert.equal(result?.persistenceErrorCode,null);
});
test('cancellation returns the committed terminal record and requires stop proof',async()=>{
  const f=fixture();const turn=await queued(f),dispatcher=new TurnDispatcher(f.journal,f.runtime);await dispatcher.tick(scope,1);
  f.setCancel(async input=>receipt(input,{phase:'terminal',outcome:'cancelled',stopped:stop,checkpoint}));const result=await dispatcher.cancel(scope,actor,f.store.snapshot()!.turns[turn.id]!);
  assert.equal(result.status,'cancelled');assert.equal(result.cancelDisposition,'cancelled');assert.equal(result.persistenceOutcome,'saved');assert.deepEqual(f.calls,['accept','cancel']);
});
test('a natural terminal receipt racing Stop persists already-terminal with one checkpoint and no replayed side effect',async()=>{
 for(const outcome of ['completed','failed'] as const){const f=fixture();const turn=await queued(f),dispatcher=new TurnDispatcher(f.journal,f.runtime);await dispatcher.tick(scope,1);f.setCancel(async input=>receipt(input,{phase:'terminal',outcome,executionErrorCode:outcome==='failed'?'native-failed':null,stopped:stop,checkpoint}));const result=await dispatcher.cancel(scope,actor,f.store.snapshot()!.turns[turn.id]!);assert.equal(result.cancelDisposition,'already-terminal');assert.equal(f.store.snapshot()!.events.filter(row=>row.turnId===turn.id&&row.type===`turn.${outcome}`).length,1);assert.deepEqual(f.calls,['accept','cancel']);const replay=await dispatcher.cancel(scope,actor,result);assert.equal(replay.cancelDisposition,'already-terminal');assert.deepEqual(f.calls,['accept','cancel']);}
});
test('unknown cancellation is replayed through the Runtime-owned once-only fence',async()=>{
  const f=fixture();const turn=await queued(f),dispatcher=new TurnDispatcher(f.journal,f.runtime);await dispatcher.tick(scope,1);
  const first=await dispatcher.cancel(scope,actor,f.store.snapshot()!.turns[turn.id]!);assert.equal(first.status,'cancelling');
  const second=await dispatcher.cancel(scope,actor,f.store.snapshot()!.turns[turn.id]!);assert.equal(second.status,'cancelling');
  await dispatcher.tick(scope,1);assert.deepEqual(f.calls,['accept','cancel','cancel','cancel']);
});
test('concurrent cancellation requests replay the same Runtime cancel intent',async()=>{
  const f=fixture();const turn=await queued(f),dispatcher=new TurnDispatcher(f.journal,f.runtime);await dispatcher.tick(scope,1);
  let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});f.setCancel(async input=>{await blocked;return receipt(input,{phase:'unknown'});});
  const stale=f.store.snapshot()!.turns[turn.id]!,first=dispatcher.cancel(scope,actor,stale),second=dispatcher.cancel(scope,actor,stale);
  for(let attempt=0;attempt<20&&f.calls.filter(call=>call==='cancel').length<2;attempt++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.deepEqual(f.calls,['accept','cancel','cancel']);release();assert.equal((await first).status,'cancelling');assert.equal((await second).status,'cancelling');
});
test('a crash after persisting Stop but before its first Runtime RPC recreates only the exact accept and cancels it',async()=>{
  const f=fixture(),turn=await queued(f),claimed=(await f.journal.claim(scope,1))!.turn;
  await f.journal.cancelWithDisposition(scope,actor,turn.id);let cancels=0;f.setCancel(async input=>++cancels===1?receipt(input,{phase:'absent'}):receipt(input,{phase:'terminal',outcome:'cancelled',stopped:stop,checkpoint}));
  const result=await new TurnDispatcher(f.journal,f.runtime).tick(scope,1);
  assert.equal(claimed.status,'running');assert.equal(result?.status,'cancelled');assert.equal(result?.cancelDisposition,'cancelled');assert.deepEqual(f.calls,['cancel','accept','cancel']);assert.equal(f.acceptedInputs.length,1);
});
test('Stop racing the first pending accept cannot leave a naturally running Turn',async()=>{
  const f=fixture(),turn=await queued(f),dispatcher=new TurnDispatcher(f.journal,f.runtime);let accepts=0,releaseFirst!:()=>void;const blocked=new Promise<void>(resolve=>{releaseFirst=resolve;});
  f.setAccept(async input=>{accepts++;if(accepts===1)await blocked;return receipt(input);});let cancels=0;f.setCancel(async input=>++cancels===1?receipt(input,{phase:'absent'}):receipt(input,{phase:'terminal',outcome:'cancelled',stopped:stop,checkpoint}));
  const accepting=dispatcher.tick(scope,1);for(let attempt=0;attempt<20&&!f.calls.includes('accept');attempt++)await new Promise(resolve=>setTimeout(resolve,1));
  const cancelled=await dispatcher.cancel(scope,actor,f.store.snapshot()!.turns[turn.id]!);releaseFirst();await accepting;
  assert.equal(cancelled.status,'cancelled');assert.equal(f.store.snapshot()!.turns[turn.id]!.status,'cancelled');assert.deepEqual(f.calls,['accept','cancel','accept','cancel']);
});
test('generation mismatch and queued cancellation never call the runtime',async()=>{
  const f=fixture();const turn=await queued(f),dispatcher=new TurnDispatcher(f.journal,f.runtime);await assert.rejects(dispatcher.tick(scope,2),/generation-conflict/);
  const cancelled=await dispatcher.cancel(scope,actor,turn);assert.equal(cancelled.status,'cancelled');assert.deepEqual(f.calls,[]);
});

test('dispatcher rejects mismatched or released retain acknowledgements before journal append',async()=>{
  for(const override of [{artifactId:`artifact-${'b'.repeat(60)}`},{kind:'tool_effect'},{referenceId:'wrong-event'},{releasedAt:1004}]){
    const f=fixture();await queued(f);
    f.setAccept(async input=>receipt(input,{events:[{eventId:'event-artifact',type:'tool.completed',at:1003,payload:{isError:false,artifact}}]}));
    const port={retain:async(input:ToolArtifactReferenceInput)=>({schemaVersion:1 as const,artifactId:input.artifactId,kind:input.kind,referenceId:input.referenceId,retainedAt:1002,releasedAt:null,...override} as ToolArtifactReferenceReceipt)};
    await assert.rejects(new TurnDispatcher(f.journal,f.runtime,port).tick(scope,1),/reference-receipt-conflict/);
    assert.deepEqual(f.store.snapshot()!.events.map(item=>item.type),['turn.queued','turn.started']);
  }
});

test('failed tool cannot retain an artifact even when its receipt shape is valid',async()=>{
  const f=fixture();await queued(f);let retains=0;
  f.setAccept(async input=>receipt(input,{events:[{eventId:'event-artifact',type:'tool.completed',at:1003,payload:{isError:true,artifact}}]}));
  await assert.rejects(new TurnDispatcher(f.journal,f.runtime,{retain:async()=>{retains++;throw Error('unexpected-retain');}}).tick(scope,1),/invalid-tool-artifact-completion/);
  assert.equal(retains,0);assert.deepEqual(f.store.snapshot()!.events.map(item=>item.type),['turn.queued','turn.started']);
});

test('journal failure after artifact retain recovers by observing and retaining the same event',async()=>{
  const f=fixture();await queued(f);
  const events=[{eventId:'event-artifact',type:'tool.completed' as const,at:1003,payload:{isError:false,artifact}}];
  f.setAccept(async input=>receipt(input,{events}));f.setObserve(async input=>receipt(input,{events}));
  let appends=0;const retained:ToolArtifactReferenceInput[]=[];
  const journal=new Proxy(f.journal,{get(target,key){if(key==='appendRuntime')return async(...args:Parameters<TurnJournal['appendRuntime']>)=>{if(++appends===1)throw Error('journal-unavailable');return target.appendRuntime(...args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const port={retain:async(input:ToolArtifactReferenceInput)=>{retained.push(structuredClone(input));return {schemaVersion:1 as const,artifactId:input.artifactId,kind:input.kind,referenceId:input.referenceId,retainedAt:1002,releasedAt:null};}};
  const dispatcher=new TurnDispatcher(journal,f.runtime,port);
  await assert.rejects(dispatcher.tick(scope,1),/journal-unavailable/);
  assert.deepEqual(f.store.snapshot()!.events.map(item=>item.type),['turn.queued','turn.started']);
  await dispatcher.tick(scope,1);
  assert.deepEqual(f.calls,['accept','observe']);assert.deepEqual(retained[0],retained[1]);
  assert.equal(f.store.snapshot()!.events.filter(item=>item.type==='tool.completed').length,1);
});
