import test from 'node:test';
import assert from 'node:assert/strict';
import {TurnDispatcher, type TurnRuntimePort, type TurnRuntimeReceipt, type ManagedTurnStopReceipt} from '../../services/turn/dispatcher.ts';
import {TurnJournal} from '../../services/turn/journal.ts';
import {MemoryTurnStore} from '../../services/turn/store.ts';

const scope={tenantId:'tenant-managed',projectId:'project-managed',workspaceId:'workspace-managed',workspaceGeneration:1};
const actor={userId:'user-managed',authVersion:1};
const checkpoint={revisionId:'revision-managed',objectKey:'turns/managed/revision.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1005};
const stopped:ManagedTurnStopReceipt={kind:'remote-terminal',confirmationId:'remote-proof',observedAt:1004,remoteSessionId:'sess_remote',remoteTurnId:'turn_remote',terminalStatus:'completed'};
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
for(const [name,type,payload] of [
 ['unrelated provider status','provider.status',{state:'running'}],
 ['additional execution field','provider.status',{backend:'managed-agents',usage:{status:'unknown',reason:'missing'},billing:'pending',resources:'session-retained',execution:'completed'}],
 ['wrong backend','provider.status',{backend:'pi',usage:{status:'unknown',reason:'missing'},billing:'pending',resources:'session-retained'}],
 ['invalid usage totals','provider.status',{backend:'managed-agents',usage:{status:'observed',inputTokens:10,outputTokens:2,totalTokens:99,settlement:'pending'},billing:'pending',resources:'session-retained'}],
 ['late tool event','tool.completed',{backend:'managed-agents',usage:{status:'unknown',reason:'missing'},billing:'pending',resources:'session-retained'}],
 ['late assistant output','assistant.message',{text:'later execution'}],
] as const)test(`Managed checkpoint still rejects ${name} occurring after file commit`,async()=>{
 const f=await fixture();const claimed=(await f.journal.claim(scope,1))!.turn;f.setClock(1100);const event={eventId:'late-execution',type,at:1006,payload};await f.journal.appendRuntime(scope,{turnId:claimed.id,dispatchId:claimed.dispatchId!,runtimeGeneration:1,...event});await f.journal.beginCheckpoint(scope,{turnId:claimed.id,dispatchId:claimed.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 f.runtime.observe=async i=>({...receipt({...i,capacityLease:i.capacityLease!}),events:[event]});await assert.rejects(f.dispatcher.tick(scope,1),/invalid-checkpoint-receipt/);assert.equal(f.store.snapshot()!.turns[claimed.id]!.checkpoint,null);assert.equal(f.store.snapshot()!.turns[claimed.id]!.status,'checkpointing');
});
