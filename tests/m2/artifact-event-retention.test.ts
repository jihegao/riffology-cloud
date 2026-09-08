import test from 'node:test';
import assert from 'node:assert/strict';
import {TurnJournal} from '../../services/turn/journal.ts';
import {MemoryTurnStore} from '../../services/turn/store.ts';
import type {ToolArtifactReferenceInput} from '../../services/artifacts/protocol.ts';

async function fixture(){
  let now=1000;const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1},store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>++now);
  const {session}=await journal.createSession(scope,actor,'session-key',{title:'Session'});
  await journal.submit(scope,actor,session.id,'turn-key',{message:'Read a large result'});
  const {turn}=(await journal.claim(scope,1))!;
  const reference:ToolArtifactReferenceInput={schemaVersion:1,scope,artifactId:`artifact-${'a'.repeat(60)}`,turnId:turn.id,dispatchId:turn.dispatchId!,kind:'turn_event',referenceId:'artifact-event'};
  const artifact={schemaVersion:1,artifactId:reference.artifactId,operation:'read',mediaType:'application/json',bytes:20000,sha256:'b'.repeat(64),createdAt:1000};
  await journal.appendRuntime(scope,{turnId:turn.id,dispatchId:turn.dispatchId!,runtimeGeneration:1,eventId:reference.referenceId,type:'tool.completed',at:turn.startedAt!,payload:{isError:false,artifact}});
  const finish=async()=>{await journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:turn.dispatchId!,runtimeGeneration:1,outcome:'failed',errorCode:'provider-disabled'});await journal.failCheckpoint(scope,{turnId:turn.id,dispatchId:turn.dispatchId!,runtimeGeneration:1,errorCode:'checkpoint-failed'});};
  return {scope,store,journal,reference,finish};
}

test('event reference remains protected while active even after event-window compaction',async()=>{
  const f=await fixture();await f.journal.compact(f.scope,1,1);
  assert.deepEqual(await f.journal.artifactEventReleaseEligibility(f.reference),{eligible:false,reason:'turn-active'});
});

test('terminal event becomes eligible only after its retained history has been compacted',async()=>{
  const f=await fixture();await f.finish();
  assert.deepEqual(await f.journal.artifactEventReleaseEligibility(f.reference),{eligible:false,reason:'event-retained'});
  await f.journal.compact(f.scope,1,4096);
  const before=f.store.snapshot();
  assert.deepEqual(await f.journal.artifactEventReleaseEligibility(f.reference),{eligible:true,reason:'event-retired'});
  assert.deepEqual(f.store.snapshot(),before,'eligibility is read-only');
  const reopened=new TurnJournal(f.store);
  assert.deepEqual(await reopened.artifactEventReleaseEligibility(f.reference),{eligible:true,reason:'event-retired'});
});

test('release prerequisite rejects foreign scope, unknown Turn, wrong dispatch and effect references',async()=>{
  const f=await fixture();await f.finish();await f.journal.compact(f.scope,1,4096);
  for(const scope of [{...f.scope,tenantId:'tenant-b'},{...f.scope,workspaceGeneration:2}])await assert.rejects(f.journal.artifactEventReleaseEligibility({...f.reference,scope}),/scope-conflict/);
  for(const override of [{turnId:'unknown-turn'},{dispatchId:'wrong-dispatch'}])await assert.rejects(f.journal.artifactEventReleaseEligibility({...f.reference,...override}),/runtime-scope-denied/);
  await assert.rejects(f.journal.artifactEventReleaseEligibility({...f.reference,kind:'tool_effect'}),/event-reference-required/);
});

test('retirement never calls Store for retained events and reconciles a lost release response',async()=>{
  const {releaseRetiredArtifactEvent}=await import('../../services/artifacts/event-retirement.ts');
  const f=await fixture();let calls=0;const inputs:ToolArtifactReferenceInput[]=[];
  const saved={schemaVersion:1 as const,artifactId:f.reference.artifactId,kind:'turn_event' as const,referenceId:f.reference.referenceId,retainedAt:1000,releasedAt:1100};
  const store={release:async(input:ToolArtifactReferenceInput)=>{inputs.push(structuredClone(input));if(++calls===1)throw Error('release-ack-lost');return saved;}};
  assert.deepEqual(await releaseRetiredArtifactEvent(f.journal,store,f.reference),{released:false,reason:'turn-active'});assert.equal(calls,0);
  await f.finish();assert.deepEqual(await releaseRetiredArtifactEvent(f.journal,store,f.reference),{released:false,reason:'event-retained'});assert.equal(calls,0);
  await f.journal.compact(f.scope,1,4096);
  await assert.rejects(releaseRetiredArtifactEvent(f.journal,store,f.reference),/release-ack-lost/);
  assert.deepEqual(await releaseRetiredArtifactEvent(new TurnJournal(f.store),store,f.reference),{released:true,receipt:saved});
  assert.deepEqual(inputs[0],inputs[1]);
});
