import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnDispatcher, type TurnRuntimePort, type TurnRuntimeReceipt } from '../../services/turn/dispatcher.ts';
import { MemoryTurnStore } from '../../services/turn/store.ts';
import { TurnJournal } from '../../services/turn/journal.ts';
import type { TurnBaseCheckpoints, TurnScope } from '../../services/turn/protocol.ts';
import type { ToolArtifactReferenceInput, ToolArtifactReferenceReceipt } from '../../services/artifacts/protocol.ts';

const scope:TurnScope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const actor={userId:'user-a',authVersion:1};
const checkpoint={revisionId:'revision-one',objectKey:'checkpoint-one',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1005};
const stop={confirmationId:'stop-one',observedAt:1004,nativeRunning:false as const,fenced:true as const};
const artifact={schemaVersion:1 as const,artifactId:`artifact-${'a'.repeat(60)}`,operation:'list' as const,mediaType:'application/json' as const,bytes:20_000,sha256:'c'.repeat(64),createdAt:1002};
type RuntimeInput={scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number;message?:string;base?:TurnBaseCheckpoints};
function receipt(input:RuntimeInput,overrides:Partial<TurnRuntimeReceipt>={}):TurnRuntimeReceipt{return {scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,phase:'running',outcome:null,...overrides};}
function fixture(){
  let now=1000;
  const store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>++now),calls:string[]=[],acceptedInputs:RuntimeInput[]=[];
  let accept=(input:RuntimeInput):Promise<TurnRuntimeReceipt>=>Promise.resolve(receipt(input));
  let observe=(input:RuntimeInput):Promise<TurnRuntimeReceipt>=>Promise.resolve(receipt(input,{phase:'unknown'}));
  let cancel=(input:RuntimeInput):Promise<TurnRuntimeReceipt>=>Promise.resolve(receipt(input,{phase:'unknown'}));
  const runtime:TurnRuntimePort={accept:async input=>{calls.push('accept');acceptedInputs.push(structuredClone(input));return accept(input);},observe:async input=>{calls.push('observe');return observe(input);},cancel:async input=>{calls.push('cancel');return cancel(input);}};
  return {store,journal,calls,acceptedInputs,runtime,setAccept(value:typeof accept){accept=value;},setObserve(value:typeof observe){observe=value;},setCancel(value:typeof cancel){cancel=value;}};
}
async function queued(f:ReturnType<typeof fixture>,key='turn-key'){const session=(await f.journal.createSession(scope,actor,`session-${key}`,{title:'Session'})).session;return (await f.journal.submit(scope,actor,session.id,key,{message:'Build model'})).turn;}

test('dispatcher commits a terminal receipt only after native stop and checkpoint proof',async()=>{
  const f=fixture();await queued(f);f.setAccept(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint}));
  const result=await new TurnDispatcher(f.journal,f.runtime).tick(scope,1);
  assert.equal(result?.status,'completed');assert.equal(result?.persistenceOutcome,'saved');assert.deepEqual(f.calls,['accept']);assert.deepEqual(f.acceptedInputs[0]!.base,{workspace:null,session:null});assert.equal(f.store.snapshot()!.activeTurnId,null);
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
  const f=fixture(),turn=await queued(f),claim=await f.journal.claim(scope,1);
  await f.journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:claim!.turn.dispatchId!,runtimeGeneration:1,outcome:'completed'});
  await f.journal.failCheckpoint(scope,{turnId:turn.id,dispatchId:claim!.turn.dispatchId!,runtimeGeneration:1,errorCode:'turn-checkpoint-recovery-hold'});
  f.setObserve(async input=>receipt(input,{phase:'terminal',outcome:'completed',stopped:stop,checkpoint}));
  const dispatcher=new TurnDispatcher(f.journal,f.runtime),observed=await dispatcher.tick(scope,1);
  assert.equal(observed?.status,'failed');assert.equal(observed?.checkpoint,null);assert.equal(f.journal.recovery(scope),null);
  const accepted=await f.journal.submit(scope,actor,turn.sessionId,'after-hold',{message:'new work'});assert.equal(accepted.turn.status,'queued');assert.deepEqual(f.calls,['observe']);
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
  assert.equal(result.status,'cancelled');assert.equal(result.persistenceOutcome,'saved');assert.deepEqual(f.calls,['accept','cancel']);
});
test('unknown cancellation is sent once and later calls reconcile without accept or duplicate cancel',async()=>{
  const f=fixture();const turn=await queued(f),dispatcher=new TurnDispatcher(f.journal,f.runtime);await dispatcher.tick(scope,1);
  const first=await dispatcher.cancel(scope,actor,f.store.snapshot()!.turns[turn.id]!);assert.equal(first.status,'cancelling');
  const second=await dispatcher.cancel(scope,actor,f.store.snapshot()!.turns[turn.id]!);assert.equal(second.status,'cancelling');
  await dispatcher.tick(scope,1);assert.deepEqual(f.calls,['accept','cancel','observe','observe']);
});
test('concurrent cancellation requests send one runtime cancel and the stale follower only observes',async()=>{
  const f=fixture();const turn=await queued(f),dispatcher=new TurnDispatcher(f.journal,f.runtime);await dispatcher.tick(scope,1);
  let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});f.setCancel(async input=>{await blocked;return receipt(input,{phase:'unknown'});});
  const stale=f.store.snapshot()!.turns[turn.id]!,first=dispatcher.cancel(scope,actor,stale),second=dispatcher.cancel(scope,actor,stale);
  for(let attempt=0;attempt<20&&!f.calls.includes('observe');attempt++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.deepEqual(f.calls,['accept','cancel','observe']);release();assert.equal((await first).status,'cancelling');assert.equal((await second).status,'cancelling');
});
test('an absent runtime is never reaccepted after a cancellation fence',async()=>{
  const f=fixture();const turn=await queued(f),dispatcher=new TurnDispatcher(f.journal,f.runtime);await dispatcher.tick(scope,1);await dispatcher.cancel(scope,actor,f.store.snapshot()!.turns[turn.id]!);
  f.setObserve(async input=>receipt(input,{phase:'absent'}));const result=await dispatcher.tick(scope,1);
  assert.equal(result?.status,'cancelling');assert.deepEqual(f.calls,['accept','cancel','observe']);
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
