import test from 'node:test';
import assert from 'node:assert/strict';
import {TurnDispatcher, type TurnRuntimePort, type TurnRuntimeReceipt, type ManagedTurnStopReceipt} from '../../services/turn/dispatcher.ts';
import {TurnJournal} from '../../services/turn/journal.ts';
import {MemoryTurnStore} from '../../services/turn/store.ts';

const scope={tenantId:'tenant-managed',projectId:'project-managed',workspaceId:'workspace-managed',workspaceGeneration:1};
const actor={userId:'user-managed',authVersion:1};
const checkpoint={revisionId:'revision-managed',objectKey:'turns/managed/revision.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1005};
const stopped:ManagedTurnStopReceipt={kind:'remote-terminal',confirmationId:'remote-proof',observedAt:1004,remoteSessionId:'sess_remote',remoteTurnId:'turn_remote',terminalStatus:'completed'};
const candidateReports=[
 ['legacy v1',{status:'checked',schemaVersion:1,traceValidation:'not-provided',execution:'not-recomputed'}],
 ['stdlib v2',{status:'checked',schemaVersion:2,traceValidation:'validated',execution:'not-recomputed',profileId:'python-stdlib/v1'}],
 ['Mesa v2',{status:'checked',schemaVersion:2,traceValidation:'validated',execution:'not-recomputed',profileId:'mesa-3.5.1/v1'}],
 ['invalid candidate',{status:'invalid',diagnostic:{file:'candidate.json',path:'preview.trace.snapshots[1].agents[0].lane',reason:'runtime-agent-invalid'}}],
 ['design v3',{status:'checked',schemaVersion:3,operation:'design',traceValidation:'not-provided',execution:'not-recomputed'}],
 ['model v3',{status:'checked',schemaVersion:3,operation:'model',traceValidation:'validated',execution:'not-recomputed',profileId:'python-stdlib/v1'}],
] as const;
const accounting=(candidateValidation:unknown)=>({backend:'managed-agents',usage:{status:'unknown',reason:'missing'},billing:'pending',resources:'session-retained',candidateValidation});
type Input=Parameters<TurnRuntimePort['accept']>[0];
function receipt(input:Pick<Input,'scope'|'sessionId'|'turnId'|'dispatchId'|'generation'|'capacityLease'>){
 const {capacityLease,scope,sessionId,turnId,dispatchId,generation}=input;const identity={scope,sessionId,turnId,dispatchId,generation};
 return {schemaVersion:1,backend:'managed-agents',...identity,phase:'terminal',outcome:'completed',events:[],executionErrorCode:null,checkpoint,persistenceErrorCode:null,stopped,resourceDisposition:{status:'released',...capacityLease,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,proofId:'managed-lease-release',releasedAt:1006}} satisfies TurnRuntimeReceipt;
}
async function fixture(transform:(value:TurnRuntimeReceipt)=>unknown=value=>value){
 let now=1000;const store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>++now),calls:string[]=[];
 const session=(await journal.createSession(scope,actor,'session-request',{title:'Managed'})).session;
 const turn=(await journal.submit(scope,actor,session.id,'turn-request',{message:'Build synthetic model'})).turn;
 const emit=(input:Parameters<TurnRuntimePort['observe']>[0])=>transform(receipt({...input,capacityLease:input.capacityLease!})) as TurnRuntimeReceipt;
 const runtime:TurnRuntimePort={accept:async input=>{calls.push('accept');return emit(input);},observe:async input=>{calls.push('observe');return emit(input);},cancel:async input=>{calls.push('cancel');return emit(input);}};
 return {store,journal,turn,calls,runtime,setClock(value:number){now=value;},dispatcher:new TurnDispatcher(journal,runtime)};
}
test('Managed remote terminal proof publishes checkpoint through the real Journal without native fence',async()=>{
 const f=await fixture();const saved=await f.dispatcher.tick(scope,1);
 assert.equal(saved?.status,'completed');assert.equal(saved?.persistenceOutcome,'saved');assert.deepEqual(saved?.checkpoint,checkpoint);
 assert.equal(f.store.snapshot()!.activeTurnId,null);assert.equal(f.store.snapshot()!.releaseHold,null);assert.deepEqual(f.calls,['accept']);
});
for(const [name,candidateValidation]of candidateReports)test(`Managed ${name} report after file commit publishes the original Revision through Dispatcher and Journal`,async()=>{
 const f=await fixture(),event={eventId:'reported-candidate',type:'provider.status' as const,at:1006,payload:accounting(candidateValidation)};
 f.runtime.accept=async input=>{f.calls.push('accept');f.setClock(1100);return {...receipt(input),events:[event]};};
 const saved=await f.dispatcher.tick(scope,1),state=f.store.snapshot()!;
 assert.equal(saved?.status,'completed');assert.equal(saved?.persistenceOutcome,'saved');assert.deepEqual(saved?.checkpoint,checkpoint);
 assert.deepEqual(state.workspaceHead,checkpoint);assert.deepEqual(state.sessions[f.turn.sessionId]!.head,checkpoint);assert.equal(state.activeTurnId,null);assert.equal(state.releaseHold,null);assert.deepEqual(f.calls,['accept']);
 const persisted=state.events.find(row=>row.eventId===event.eventId)!;assert.equal(persisted.at,event.at);assert.deepEqual(persisted.payload,event.payload);
 assert.equal(await f.dispatcher.tick(scope,1),null);assert.deepEqual(f.calls,['accept']);
});
test('Managed terminal checkpoint does not release a separate pending lease',async()=>{
 let released=false;
 const f=await fixture(value=>({...value,resourceDisposition:released?value.resourceDisposition:{status:'release-pending',operationId:value.resourceDisposition.operationId,leaseId:value.resourceDisposition.leaseId,turnId:value.turnId,dispatchId:value.dispatchId,generation:value.generation,reasonCode:'managed-release-pending',since:1005,nextAttemptAt:2000}}));
 assert.equal((await f.dispatcher.tick(scope,1))?.status,'completed');assert.equal(f.store.snapshot()!.releaseHold?.turnId,f.turn.id);
 assert.equal((await f.dispatcher.tick(scope,1))?.id,f.turn.id);assert.equal(f.store.snapshot()!.releaseHold?.status,'release-pending');
 released=true;assert.equal(await f.dispatcher.tick(scope,1),null);assert.equal(f.store.snapshot()!.releaseHold,null);assert.deepEqual(f.calls,['accept','observe','observe']);
});
for(const [name,change] of Object.entries({
 'missing remote proof':(r:TurnRuntimeReceipt)=>({...r,stopped:null}),
 'native fence masquerading as Managed':(r:TurnRuntimeReceipt)=>({...r,stopped:{confirmationId:'fake',observedAt:1004,nativeRunning:false,fenced:true}}),
 'remote proof masquerading as Pi':(r:TurnRuntimeReceipt)=>({...r,backend:'pi'}),
 'remote status different from outcome':(r:TurnRuntimeReceipt)=>({...r,stopped:{...stopped,terminalStatus:'cancelled'}}),
 'native retirement masquerading as Managed':(r:TurnRuntimeReceipt)=>({...r,retirement:'workspace-native-unresolved'}),
 'unversioned Managed receipt':(r:TurnRuntimeReceipt)=>{const x={...r};delete x.schemaVersion;return x;},
 'extra native fence in remote proof':(r:TurnRuntimeReceipt)=>({...r,stopped:{...stopped,fenced:true}}),
 'wrong local dispatch identity':(r:TurnRuntimeReceipt)=>({...r,dispatchId:'another-dispatch'}),
 'wrong lease':(r:TurnRuntimeReceipt)=>({...r,resourceDisposition:{...r.resourceDisposition,leaseId:'another-lease'}}),
}))test(`Managed rejects ${name} before Journal checkpoint`,async()=>{
 const f=await fixture(change);await assert.rejects(f.dispatcher.tick(scope,1),/invalid-turn-runtime|turn-runtime-receipt-scope-denied/);
 assert.equal(f.store.snapshot()!.turns[f.turn.id]!.checkpoint,null);assert.equal(f.store.snapshot()!.turns[f.turn.id]!.status,'running');
});
test('Managed cancellation remains nonterminal while original remote outcome is unknown',async()=>{
 let terminal=false;const f=await fixture(r=>terminal?{...r,outcome:'cancelled',stopped:{...stopped,terminalStatus:'cancelled'}}:{...r,phase:'unknown',outcome:null,checkpoint:null,stopped:null,resourceDisposition:{status:'active',operationId:r.resourceDisposition.operationId,leaseId:r.resourceDisposition.leaseId,turnId:r.turnId,dispatchId:r.dispatchId,generation:r.generation}});
 await f.dispatcher.tick(scope,1);const pending=await f.dispatcher.cancel(scope,actor,f.turn);assert.equal(pending.status,'cancelling');assert.equal(pending.checkpoint,null);
 terminal=true;const cancelled=await f.dispatcher.tick(scope,1);assert.equal(cancelled?.status,'cancelled');assert.equal(cancelled?.persistenceOutcome,'saved');assert.deepEqual(f.calls,['accept','cancel','cancel']);
});

test('Managed rejects a structurally valid Pi native handoff without publishing its checkpoint',async()=>{
 const f=await fixture(r=>({...r,resourceDisposition:{status:'handed-off',operationId:r.resourceDisposition.operationId,leaseId:r.resourceDisposition.leaseId,turnId:r.turnId,dispatchId:r.dispatchId,generation:r.generation,lease:{scope,leaseId:r.resourceDisposition.leaseId,leaseEpoch:1,runtimeVersion:'c'.repeat(64)},binding:{sessionId:r.sessionId,turnId:r.turnId,dispatchId:r.dispatchId,bindingEpoch:1},checkpoint,proof:{project:{schemaVersion:1,bindingEpoch:'d'.repeat(64),status:'quiescent',remaining:0},trustedPi:{schemaVersion:1,bindingEpoch:'d'.repeat(64),status:'quiescent',remaining:0}},handedOffAt:1006}}));
 await assert.rejects(f.dispatcher.tick(scope,1),/invalid-turn-runtime-receipt/);assert.equal(f.store.snapshot()!.turns[f.turn.id]!.checkpoint,null);
});

test('Managed journal claim before runtime accept recovers exact original only after explicit absence',async()=>{
 const f=await fixture();await f.journal.claim(scope,1);f.runtime.observe=async i=>{f.calls.push('observe');return {...receipt({...i,capacityLease:i.capacityLease!}),phase:'absent',outcome:null,checkpoint:null,stopped:null};};
 const saved=await f.dispatcher.tick(scope,1);assert.equal(saved?.status,'completed');assert.deepEqual(f.calls,['observe','accept']);
});
test('Managed Stop after journal claim before accept completes never-started without paid accept or native fence',async()=>{
 const f=await fixture();await f.journal.claim(scope,1);f.runtime.cancel=async i=>{f.calls.push('cancel');return {...receipt({...i,capacityLease:i.capacityLease!}),phase:'absent',outcome:null,checkpoint:null,stopped:null};};
 const cancelled=await f.dispatcher.cancel(scope,actor,f.turn);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.checkpoint,null);assert.equal(cancelled.persistenceOutcome,null);assert.equal(f.store.snapshot()!.activeTurnId,null);assert.deepEqual(f.calls,['cancel']);
});

for(const usage of [{status:'unknown',reason:'missing'},{status:'observed',inputTokens:10,outputTokens:2,totalTokens:12,settlement:'pending'}])test(`Managed late ${usage.status} accounting restores an already-checkpointing Turn without changing immutable events`,async()=>{
 const f=await fixture();const claimed=(await f.journal.claim(scope,1))!.turn;
 f.setClock(1100);
 const event={eventId:'persisted-usage',type:'provider.status' as const,at:1006,payload:{backend:'managed-agents',usage,billing:'pending',resources:'session-retained'}};
 await f.journal.appendRuntime(scope,{turnId:claimed.id,dispatchId:claimed.dispatchId!,runtimeGeneration:1,...event});
 await f.journal.beginCheckpoint(scope,{turnId:claimed.id,dispatchId:claimed.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 // Simulate a process restart after append + beginCheckpoint committed, with
 // admission closed and the hosted Session already deleted. Only observe is used.
 const before=f.store.snapshot()!.events.find(e=>e.eventId===event.eventId)!;
 f.runtime.accept=async()=>{throw Error('new-input-forbidden');};
 f.runtime.observe=async i=>{f.calls.push('observe');return {...receipt({...i,capacityLease:i.capacityLease!}),events:[event]};};
 const saved=await new TurnDispatcher(f.journal,f.runtime,null,null,()=>2000,undefined,async()=>{throw Error('admission-closed');}).tick(scope,1);
 assert.equal(saved?.status,'completed');assert.deepEqual(saved?.checkpoint,checkpoint);assert.deepEqual(f.store.snapshot()!.sessions[claimed.sessionId]!.head,checkpoint);assert.equal(f.store.snapshot()!.activeTurnId,null);assert.deepEqual(f.calls,['observe']);
 assert.deepEqual(f.store.snapshot()!.events.find(e=>e.eventId===event.eventId),before);assert.equal(f.store.snapshot()!.events.filter(e=>e.eventId===event.eventId).length,1);assert.deepEqual(before.payload.usage,usage);
});
for(const [name,candidateValidation]of candidateReports)for(const usage of [{status:'unknown',reason:'invalid'},{status:'observed',inputTokens:10,outputTokens:2,totalTokens:12,settlement:'pending'}])test(`Managed restored ${name}/${usage.status} report uses observe only and preserves its original event`,async()=>{
 const f=await fixture(),claimed=(await f.journal.claim(scope,1))!.turn;f.setClock(1100);
 const event={eventId:'persisted-candidate-report',type:'provider.status' as const,at:1006,payload:{...accounting(candidateValidation),usage}};
 await f.journal.appendRuntime(scope,{turnId:claimed.id,dispatchId:claimed.dispatchId!,runtimeGeneration:1,...event});
 await f.journal.beginCheckpoint(scope,{turnId:claimed.id,dispatchId:claimed.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 const snapshot=f.store.snapshot()!,before=snapshot.events.find(row=>row.eventId===event.eventId)!;
 const restoredStore=new MemoryTurnStore();await restoredStore.transact(()=>({state:snapshot,value:null}));
 const restoredJournal=new TurnJournal(restoredStore,()=>2000);
 f.runtime.accept=async()=>{throw Error('new-input-forbidden');};
 f.runtime.observe=async input=>{f.calls.push('observe');return {...receipt({...input,capacityLease:input.capacityLease!}),events:[event]};};
 const restoredDispatcher=new TurnDispatcher(restoredJournal,f.runtime,null,null,()=>2000,undefined,async()=>{throw Error('admission-closed');});
 const saved=await restoredDispatcher.tick(scope,1),state=restoredStore.snapshot()!;
 assert.equal(saved?.status,'completed');assert.deepEqual(saved?.checkpoint,checkpoint);assert.deepEqual(state.workspaceHead,checkpoint);assert.deepEqual(state.sessions[claimed.sessionId]!.head,checkpoint);assert.equal(state.activeTurnId,null);assert.deepEqual(f.calls,['observe']);
 assert.deepEqual(state.events.find(row=>row.eventId===event.eventId),before);assert.equal(state.events.filter(row=>row.eventId===event.eventId).length,1);
 assert.equal(await restoredDispatcher.tick(scope,1),null);assert.deepEqual(f.calls,['observe']);
});
for(const [name,type,payload] of [
 ['unrelated provider status','provider.status',{state:'running'}],
 ['additional execution field','provider.status',{backend:'managed-agents',usage:{status:'unknown',reason:'missing'},billing:'pending',resources:'session-retained',execution:'completed'}],
 ['wrong backend','provider.status',{backend:'pi',usage:{status:'unknown',reason:'missing'},billing:'pending',resources:'session-retained'}],
 ['invalid usage totals','provider.status',{backend:'managed-agents',usage:{status:'observed',inputTokens:10,outputTokens:2,totalTokens:99,settlement:'pending'},billing:'pending',resources:'session-retained'}],
 ['late tool event','tool.completed',{backend:'managed-agents',usage:{status:'unknown',reason:'missing'},billing:'pending',resources:'session-retained'}],
 ['late assistant output','assistant.message',{text:'later execution'}],
 ['extra execution beside a valid candidate report','provider.status',{...accounting(candidateReports[1][1]),execution:'completed'}],
 ['foreign backend with a valid candidate report','provider.status',{...accounting(candidateReports[1][1]),backend:'pi'}],
 ['incorrect usage with a valid candidate report','provider.status',{...accounting(candidateReports[1][1]),usage:{status:'observed',inputTokens:10,outputTokens:2,totalTokens:99,settlement:'pending'}}],
 ['extra usage execution data','provider.status',{...accounting(candidateReports[1][1]),usage:{status:'unknown',reason:'missing',executedAt:1006}}],
 ['settled billing with a candidate report','provider.status',{...accounting(candidateReports[1][1]),billing:'settled'}],
 ['active resources with a candidate report','provider.status',{...accounting(candidateReports[1][1]),resources:'running'}],
 ['null candidate report','provider.status',accounting(null)],
 ['array candidate report','provider.status',accounting([candidateReports[1][1]])],
 ['extra execution in a candidate report','provider.status',accounting({...candidateReports[1][1],executedAt:1006})],
 ['false recomputed claim','provider.status',accounting({...candidateReports[1][1],execution:'recomputed'})],
 ['false verified status','provider.status',accounting({...candidateReports[1][1],status:'verified'})],
 ['false legacy trace validation','provider.status',accounting({...candidateReports[0][1],traceValidation:'validated'})],
 ['unexpected legacy profile','provider.status',accounting({...candidateReports[0][1],profileId:'python-stdlib/v1'})],
 ['missing v2 trace validation','provider.status',accounting({...candidateReports[1][1],traceValidation:'not-provided'})],
 ['v3 missing operation','provider.status',accounting({...candidateReports[1][1],schemaVersion:3})],
 ['unknown candidate profile','provider.status',accounting({...candidateReports[1][1],profileId:'arbitrary-python/v1'})],
 ['missing candidate profile','provider.status',accounting({...candidateReports[0][1],schemaVersion:2,traceValidation:'validated'})],
 ['missing invalid diagnostic','provider.status',accounting({status:'invalid'})],
 ['extra invalid metadata','provider.status',accounting({...candidateReports[3][1],execution:'completed'})],
 ['extra diagnostic execution','provider.status',accounting({status:'invalid',diagnostic:{...candidateReports[3][1].diagnostic,executedAt:1006}})],
 ['empty diagnostic','provider.status',accounting({status:'invalid',diagnostic:{file:'',path:'$',reason:'invalid-json'}})],
 ['non-text diagnostic','provider.status',accounting({status:'invalid',diagnostic:{file:'candidate.json',path:'$',reason:1}})],
 ['oversized diagnostic file','provider.status',accounting({status:'invalid',diagnostic:{file:'x'.repeat(129),path:'$',reason:'invalid-json'}})],
 ['oversized diagnostic path','provider.status',accounting({status:'invalid',diagnostic:{file:'candidate.json',path:'x'.repeat(257),reason:'invalid-json'}})],
 ['oversized diagnostic reason','provider.status',accounting({status:'invalid',diagnostic:{file:'candidate.json',path:'$',reason:'x'.repeat(129)}})],
 ['late tool with valid report','tool.completed',accounting(candidateReports[1][1])],
 ['late assistant with valid report','assistant.message',accounting(candidateReports[1][1])],
] as const)test(`Managed checkpoint still rejects ${name} occurring after file commit`,async()=>{
 const f=await fixture();const claimed=(await f.journal.claim(scope,1))!.turn;f.setClock(1100);const event={eventId:'late-execution',type,at:1006,payload};await f.journal.appendRuntime(scope,{turnId:claimed.id,dispatchId:claimed.dispatchId!,runtimeGeneration:1,...event});await f.journal.beginCheckpoint(scope,{turnId:claimed.id,dispatchId:claimed.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 f.runtime.observe=async i=>({...receipt({...i,capacityLease:i.capacityLease!}),events:[event]});await assert.rejects(f.dispatcher.tick(scope,1),/invalid-checkpoint-receipt/);assert.equal(f.store.snapshot()!.turns[claimed.id]!.checkpoint,null);assert.equal(f.store.snapshot()!.turns[claimed.id]!.status,'checkpointing');
});


test('explicit unchanged completion survives restart, keeps both heads and releases the same lease',async()=>{
 const f=await fixture();const first=await f.dispatcher.tick(scope,1);f.setClock(2000);
 const next=(await f.journal.submit(scope,actor,f.turn.sessionId,'answer-request',{message:'Explain the design'})).turn;
 f.runtime.accept=async input=>({...receipt(input),checkpoint:null,unchanged:input.base});
 const answer=await f.dispatcher.tick(scope,1),state=f.store.snapshot()!;
 assert.equal(answer?.persistenceOutcome,'unchanged');assert.equal(answer?.status,'completed');assert.equal(answer?.checkpoint,null);
 assert.deepEqual(state.workspaceHead,first!.checkpoint);assert.deepEqual(state.sessions[next.sessionId]!.head,first!.checkpoint);assert.equal(state.activeTurnId,null);assert.equal(state.releaseHold,null);
 assert.deepEqual(state.events.at(-1)!.payload,{saved:false,unchanged:true,errorCode:null});
 const restored=new MemoryTurnStore();await restored.transact(()=>({state,value:null}));
 assert.equal(await new TurnDispatcher(new TurnJournal(restored,()=>2100),f.runtime).tick(scope,1),null);
 const follow=(await f.journal.submit(scope,actor,next.sessionId,'followup-request',{message:'Edit it'})).turn;
 const claimed=await f.journal.claim(scope,1);assert.equal(claimed?.turn.id,follow.id);assert.deepEqual(claimed?.turn.base?.workspace,first!.checkpoint);
});
for(const kind of ['missing-proof','pi','with-checkpoint','wrong-base','release-pending'] as const)test('unchanged receipt boundary: '+kind,async()=>{
 const f=await fixture();
 f.runtime.accept=async input=>{const r={...receipt(input),checkpoint:null,unchanged:input.base};
  if(kind==='missing-proof')return {...r,stopped:null} as TurnRuntimeReceipt;
  if(kind==='pi')return {...r,backend:'pi'} as unknown as TurnRuntimeReceipt;
  if(kind==='with-checkpoint')return {...r,checkpoint};
  if(kind==='wrong-base')return {...r,unchanged:{workspace:checkpoint,session:null}};
  return {...r,resourceDisposition:{operationId:input.capacityLease.operationId,leaseId:input.capacityLease.leaseId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,status:'release-pending',reasonCode:'managed-release-pending',since:1005,nextAttemptAt:2000}} as TurnRuntimeReceipt;
 };
 if(kind==='release-pending'){assert.equal((await f.dispatcher.tick(scope,1))?.persistenceOutcome,'unchanged');assert.equal(f.store.snapshot()!.releaseHold?.turnId,f.turn.id);}
 else {await assert.rejects(f.dispatcher.tick(scope,1),/invalid-turn-runtime-receipt|turn-runtime-scope-denied/);assert.equal(f.store.snapshot()!.workspaceHead,null);}
});
