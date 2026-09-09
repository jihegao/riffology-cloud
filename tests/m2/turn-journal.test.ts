import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnJournal } from '../../services/turn/journal.ts';
import { TURN_EVENT_BYTES_LIMIT, TURN_EVENT_LIMIT } from '../../services/turn/protocol.ts';
import { MemoryTurnStore } from '../../services/turn/store.ts';
const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1};
function fixture(){let now=1000;const store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>++now);return {store,journal};}
async function session(journal:TurnJournal,key='session-key'){return (await journal.createSession(scope,actor,key,{title:'Model session'})).session;}
async function queued(journal:TurnJournal,key='turn-key'){const s=await session(journal);return (await journal.submit(scope,actor,s.id,key,{message:'Build a queue model'})).turn;}
test('session and turn submissions are durable idempotent intents with payload conflict',async()=>{
 const f=fixture(),s=await session(f.journal),same=await f.journal.createSession(scope,actor,'session-key',{title:'Model session'});assert.equal(same.replayed,true);assert.equal(same.session.id,s.id);
 await assert.rejects(f.journal.createSession(scope,actor,'session-key',{title:'Different'}),/idempotency/);
 const first=await f.journal.submit(scope,actor,s.id,'turn-key',{message:'hello'}),again=await f.journal.submit(scope,actor,s.id,'turn-key',{message:'hello'});assert.equal(again.replayed,true);assert.equal(again.turn.id,first.turn.id);
 await assert.rejects(f.journal.submit(scope,actor,s.id,'turn-key',{message:'changed'}),/idempotency/);assert.equal(Object.keys(f.store.snapshot()!.turns).length,1);
});
test('one workspace-wide claim serializes turns across sessions and survives claim replay',async()=>{
 const f=fixture(),one=await queued(f.journal,'one'),s2=await session(f.journal,'session-two'),two=(await f.journal.submit(scope,actor,s2.id,'two',{message:'second'})).turn;
 const claimed=await f.journal.claim(scope,1);assert.equal(claimed!.turn.id,one.id);assert.equal(claimed!.replayed,false);
 const replay=await f.journal.claim(scope,1);assert.equal(replay!.turn.id,one.id);assert.equal(replay!.turn.dispatchId,claimed!.turn.dispatchId);assert.equal(replay!.replayed,true);assert.equal(f.store.snapshot()!.turns[two.id]!.status,'queued');
 await assert.rejects(f.journal.claim({...scope,workspaceGeneration:2},2),/scope/);
});
test('runtime events are scoped, deduplicated and assigned durable monotonic sequence',async()=>{
 const f=fixture(),turn=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn,input={turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,eventId:'event-one',type:'assistant.delta' as const,at:claim.startedAt!,payload:{text:'hello'}};
 const first=await f.journal.appendRuntime(scope,input),again=await f.journal.appendRuntime(scope,input);assert.equal(first.event.sequence,3);assert.equal(again.replayed,true);assert.equal(again.event.sequence,3);
 await assert.rejects(f.journal.appendRuntime(scope,{...input,payload:{text:'changed'}}),/event-conflict/);
 await assert.rejects(f.journal.appendRuntime(scope,{...input,eventId:'event-two',dispatchId:'wrong'}),/scope-denied/);
 const replay=await f.journal.replay(scope,1,10);assert.deepEqual(replay.events.map(item=>item.sequence),[2,3]);assert.equal(replay.hasMore,false);
});
test('queued cancellation never dispatches; running cancellation persists a fence before checkpoint',async()=>{
 const f=fixture(),first=await queued(f.journal,'one'),s2=await session(f.journal,'session-two'),second=(await f.journal.submit(scope,actor,s2.id,'two',{message:'two'})).turn;
 await f.journal.cancel(scope,actor,first.id);assert.equal(f.store.snapshot()!.turns[first.id]!.status,'cancelled');const claim=(await f.journal.claim(scope,1))!.turn;assert.equal(claim.id,second.id);
 const cancelling=await f.journal.cancel(scope,actor,second.id);assert.equal(cancelling.status,'cancelling');assert.ok(cancelling.cancelRequestedAt);
 await assert.rejects(f.journal.beginCheckpoint(scope,{turnId:second.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,outcome:'completed'}),/cancellation-not-honored/);
});
test('execution result is not a saved terminal result until immutable checkpoint commit',async()=>{
 const f=fixture(),turn=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn;
 const pending=await f.journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,outcome:'failed',errorCode:'provider-timeout'});assert.equal(pending.status,'checkpointing');assert.equal(pending.finishedAt,null);assert.equal(f.store.snapshot()!.activeTurnId,turn.id);
 const checkpoint={revisionId:'revision-one',objectKey:'checkpoint-one',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:pending.updatedAt};
 const saved=await f.journal.commitCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,checkpoint});assert.equal(saved.status,'failed');assert.equal(saved.checkpoint?.revisionId,'revision-one');assert.equal(f.store.snapshot()!.activeTurnId,null);
 const savedReplay=await f.journal.commitCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,checkpoint});assert.deepEqual(savedReplay,saved);
 const final=f.store.snapshot()!.events.at(-1)!;assert.equal(final.type,'turn.failed');assert.equal(final.payload.saved,true);
});
test('latest workspace Revision resolves to its private runtime identity without exposing it in the public view',async()=>{
 const f=fixture();assert.equal(await f.journal.workspaceRevision(scope),null);const turn=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn;
 await f.journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,outcome:'completed'});const checkpoint={revisionId:'revision-files',objectKey:'turns/files.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:claim.startedAt!};
 await f.journal.commitCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,checkpoint});assert.deepEqual(await f.journal.workspaceRevision(scope),{identity:{scope,sessionId:turn.sessionId,turnId:turn.id,dispatchId:claim.dispatchId,generation:1},receipt:checkpoint});
 const view=await f.journal.view(scope) as any;assert.equal(view.workspaceHead,undefined);assert.equal(view.turns[turn.id].dispatchId,undefined);
});
test('remote checkpoint materialization may precede the local checkpointing record',async()=>{
 const f=fixture(),turn=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn;
 const checkpoint={revisionId:'revision-remote',objectKey:'turns/remote.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:claim.startedAt!};
 const pending=await f.journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 assert.ok(pending.updatedAt>checkpoint.committedAt);
 const saved=await f.journal.commitCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,checkpoint});
 assert.equal(saved.status,'completed');assert.ok(saved.finishedAt!>checkpoint.committedAt);
 const terminal=f.store.snapshot()!.events.at(-1)!;assert.equal(terminal.at,saved.finishedAt);assert.equal(terminal.type,'turn.completed');
});
test('claim freezes the latest workspace head and the matching session head',async()=>{
 const f=fixture(),firstSession=await session(f.journal),first=(await f.journal.submit(scope,actor,firstSession.id,'first',{message:'first'})).turn,firstClaim=(await f.journal.claim(scope,1))!.turn;
 assert.deepEqual(firstClaim.base,{workspace:null,session:null});
 const firstPending=await f.journal.beginCheckpoint(scope,{turnId:first.id,dispatchId:firstClaim.dispatchId!,runtimeGeneration:1,outcome:'completed'}),firstCheckpoint={revisionId:'revision-one',objectKey:'turns/one.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:firstPending.updatedAt};
 await f.journal.commitCheckpoint(scope,{turnId:first.id,dispatchId:firstClaim.dispatchId!,runtimeGeneration:1,checkpoint:firstCheckpoint});
 const secondSession=await session(f.journal,'second-session'),other=(await f.journal.submit(scope,actor,secondSession.id,'other',{message:'other'})).turn,same=(await f.journal.submit(scope,actor,firstSession.id,'same',{message:'same'})).turn;
 const otherClaim=(await f.journal.claim(scope,1))!.turn;assert.equal(otherClaim.id,other.id);assert.deepEqual(otherClaim.base,{workspace:firstCheckpoint,session:null});
 const otherPending=await f.journal.beginCheckpoint(scope,{turnId:other.id,dispatchId:otherClaim.dispatchId!,runtimeGeneration:1,outcome:'completed'}),otherCheckpoint={revisionId:'revision-two',objectKey:'turns/two.json',filesSha256:'c'.repeat(64),sessionSha256:'d'.repeat(64),committedAt:otherPending.updatedAt};
 await f.journal.commitCheckpoint(scope,{turnId:other.id,dispatchId:otherClaim.dispatchId!,runtimeGeneration:1,checkpoint:otherCheckpoint});
 const sameClaim=(await f.journal.claim(scope,1))!.turn;assert.equal(sameClaim.id,same.id);assert.deepEqual(sameClaim.base,{workspace:otherCheckpoint,session:firstCheckpoint});
 const state=f.store.snapshot()!;assert.deepEqual(state.workspaceHead,otherCheckpoint);assert.deepEqual(state.sessions[firstSession.id]!.head,firstCheckpoint);assert.deepEqual(state.sessions[secondSession.id]!.head,otherCheckpoint);
});
test('checkpoint intent and persistence failure are idempotent and preserve execution outcome',async()=>{
 const f=fixture(),turn=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn,runtime={turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,eventId:'failed-checkpoint-event',type:'assistant.message' as const,at:claim.startedAt!,payload:{text:'completed execution'}};await f.journal.appendRuntime(scope,runtime);const input={turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,outcome:'completed' as const};
 const pending=await f.journal.beginCheckpoint(scope,input),replayed=await f.journal.beginCheckpoint(scope,input);assert.deepEqual(replayed,pending);
 await assert.rejects(f.journal.beginCheckpoint(scope,{...input,outcome:'failed',errorCode:'runtime-failed'}),/outcome-conflict/);
 const failed=await f.journal.failCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,errorCode:'r2-write-failed'});assert.equal(failed.status,'failed');assert.equal(failed.executionOutcome,'completed');assert.equal(failed.persistenceOutcome,'failed');assert.equal(failed.persistenceErrorCode,'r2-write-failed');assert.equal(f.store.snapshot()!.activeTurnId,null);
 assert.equal(Object.keys(f.store.snapshot()!.eventReceipts).length,0);await assert.rejects(f.journal.appendRuntime(scope,runtime),/scope-denied/);
 const failureReplay=await f.journal.failCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,errorCode:'r2-write-failed'});assert.deepEqual(failureReplay,failed);
 await assert.rejects(f.journal.failCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,errorCode:'different'}),/checkpoint-conflict/);
});
test('public view excludes idempotency hashes, dispatch capability and actor auth version',async()=>{
 const f=fixture(),turn=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn,view=await f.journal.view(scope);const publicTurn=view.turns[turn.id] as any,publicSession=view.sessions[turn.sessionId] as any;
 assert.equal(publicTurn.requestKey,undefined);assert.equal(publicTurn.payloadSha256,undefined);assert.equal(publicTurn.dispatchId,undefined);assert.equal(publicTurn.base,undefined);assert.equal(publicTurn.startedSequence,undefined);assert.equal(publicTurn.terminalSequence,undefined);assert.equal(publicSession.actorUserId,undefined);assert.equal(publicSession.actorAuthVersion,undefined);
 const started=(await f.journal.replay(scope,0,10)).events.find(row=>row.type==='turn.started')!;assert.deepEqual(started.payload,{});assert.ok(claim.dispatchId);
});
test('actor version, session ownership, generation and malformed payloads fail closed',async()=>{
 const f=fixture(),s=await session(f.journal);
 await assert.rejects(f.journal.submit(scope,{...actor,authVersion:2},s.id,'x',{message:'x'}),/session-not-found/);
 await assert.rejects(f.journal.submit(scope,actor,s.id,'x',{message:'\u0000'}),/message/);
 const t=(await f.journal.submit(scope,actor,s.id,'ok',{message:'ok'})).turn,c=await f.journal.claim(scope,1);
 await assert.rejects(f.journal.appendRuntime(scope,{turnId:t.id,dispatchId:c!.turn.dispatchId!,runtimeGeneration:2,eventId:'bad-generation',type:'provider.status',at:1010,payload:{state:'x'}}),/scope-denied/);
 await assert.rejects(f.journal.cancel(scope,{...actor,userId:'other'},t.id),/not-found/);
});

test('v3 compaction preserves terminal state and requires a snapshot for expired cursors',async()=>{
 const f=fixture(),turn=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn;
 const runtimeInput={turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,eventId:'event-before-compaction',type:'assistant.message' as const,at:claim.startedAt!,payload:{text:'saved response'}};const original=await f.journal.appendRuntime(scope,runtimeInput);
 await f.journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 const checkpoint={revisionId:'revision-v3',objectKey:'turns/v3.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:claim.startedAt!+1};
 await f.journal.commitCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,checkpoint});
 const compacted=await f.journal.compact(scope,1);assert.equal(compacted.removed,4);const state=f.store.snapshot()!;assert.equal(state.schemaVersion,3);assert.equal(state.oldestSequence,state.nextSequence-1);assert.equal(state.turns[turn.id]!.status,'completed');assert.deepEqual(state.workspaceHead,checkpoint);assert.deepEqual(state.sessions[turn.sessionId]!.head,checkpoint);assert.ok(state.turns[turn.id]!.startedSequence!<state.turns[turn.id]!.terminalSequence!);
 assert.equal(state.eventReceipts[runtimeInput.eventId],undefined);const sequence=state.nextSequence;await assert.rejects(f.journal.appendRuntime(scope,runtimeInput),/scope-denied/);assert.equal(f.store.snapshot()!.nextSequence,sequence);assert.equal(original.event.sequence,3);
 const expired=await f.journal.replay(scope,0,10);assert.equal(expired.snapshotRequired,true);assert.equal(expired.events.length,0);const page=await f.journal.replay(scope,state.oldestSequence-1,10);assert.equal(page.snapshotRequired,false);assert.equal(page.events.length,1);
});

test('terminal receipts do not accumulate across turns while active receipts survive compaction',async()=>{
 const f=fixture(),firstSession=await session(f.journal),first=(await f.journal.submit(scope,actor,firstSession.id,'receipt-first',{message:'first'})).turn,firstClaim=(await f.journal.claim(scope,1))!.turn;
 const firstEvent={turnId:first.id,dispatchId:firstClaim.dispatchId!,runtimeGeneration:1,eventId:'receipt-first-event',type:'assistant.message' as const,at:firstClaim.startedAt!,payload:{text:'first'}};await f.journal.appendRuntime(scope,firstEvent);
 await f.journal.beginCheckpoint(scope,{turnId:first.id,dispatchId:firstClaim.dispatchId!,runtimeGeneration:1,outcome:'completed'});const checkpoint={revisionId:'receipt-revision',objectKey:'turns/receipt.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:firstClaim.startedAt!};await f.journal.commitCheckpoint(scope,{turnId:first.id,dispatchId:firstClaim.dispatchId!,runtimeGeneration:1,checkpoint});
 assert.deepEqual(f.store.snapshot()!.eventReceipts,{});
 const second=(await f.journal.submit(scope,actor,firstSession.id,'receipt-second',{message:'second'})).turn,secondClaim=(await f.journal.claim(scope,1))!.turn,secondEvent={turnId:second.id,dispatchId:secondClaim.dispatchId!,runtimeGeneration:1,eventId:'receipt-second-event',type:'assistant.delta' as const,at:secondClaim.startedAt!,payload:{text:'second'}};
 const appended=await f.journal.appendRuntime(scope,secondEvent);await f.journal.compact(scope,1);const replayed=await f.journal.appendRuntime(scope,secondEvent);assert.equal(replayed.replayed,true);assert.deepEqual(replayed.event,appended.event);assert.deepEqual(Object.keys(f.store.snapshot()!.eventReceipts),['receipt-second-event']);
});

test('event append automatically compacts the retained count window without losing idempotency receipts',async()=>{
 const f=fixture(),turn=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn;
 const first={turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,eventId:'automatic-event-0',type:'assistant.delta' as const,at:claim.startedAt!,payload:{text:'first'}},original=await f.journal.appendRuntime(scope,first);
 for(let index=1;index<TURN_EVENT_LIMIT;index++)await f.journal.appendRuntime(scope,{...first,eventId:`automatic-event-${index}`,payload:{text:String(index)}});
 const state=f.store.snapshot()!;assert.equal(state.events.length,TURN_EVENT_LIMIT);assert.ok(state.oldestSequence>1);assert.ok(state.retentionBytes<=TURN_EVENT_BYTES_LIMIT);
 const expired=await f.journal.replay(scope,0,10);assert.equal(expired.snapshotRequired,true);
 const replayed=await f.journal.appendRuntime(scope,first);assert.equal(replayed.replayed,true);assert.deepEqual(replayed.event,original.event);assert.equal(f.store.snapshot()!.nextSequence,state.nextSequence);
});

test('event append automatically compacts by retained bytes before the journal becomes invalid',async()=>{
 const f=fixture(),turn=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn,payload={text:'x'.repeat(15_000)};
 for(let index=0;index<320;index++)await f.journal.appendRuntime(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,eventId:`byte-event-${index}`,type:'assistant.delta',at:claim.startedAt!,payload});
 const state=f.store.snapshot()!;assert.ok(state.events.length<322);assert.ok(state.oldestSequence>1);assert.ok(state.retentionBytes<=TURN_EVENT_BYTES_LIMIT);assert.equal((await f.journal.replay(scope,0,10)).snapshotRequired,true);
});

test('synchronous saved-head snapshot excludes active work and is detached for intent freezing',async()=>{
 const f=fixture();assert.equal(f.journal.workspaceRevisionSnapshot(scope),null);
 const first=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn;
 const pending=await f.journal.beginCheckpoint(scope,{turnId:first.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 const receipt={revisionId:'head-one',objectKey:'turns/head-one.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:pending.updatedAt};
 assert.equal(f.journal.workspaceRevisionSnapshot(scope),null);
 await f.journal.commitCheckpoint(scope,{turnId:first.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,checkpoint:receipt});
 const frozen=f.journal.workspaceRevisionSnapshot(scope)!;assert.equal(frozen instanceof Promise,false);
 await f.journal.submit(scope,actor,first.sessionId,'next-head',{message:'next edit'});await f.journal.claim(scope,1);
 assert.deepEqual(f.journal.workspaceRevisionSnapshot(scope),frozen);
 frozen.receipt.filesSha256='c'.repeat(64);frozen.identity.scope.projectId='other-project';
 assert.equal(f.journal.workspaceRevisionSnapshot(scope)!.receipt.filesSha256,receipt.filesSha256);
 assert.equal(f.journal.workspaceRevisionSnapshot(scope)!.identity.scope.projectId,scope.projectId);
 assert.throws(()=>f.journal.workspaceRevisionSnapshot({...scope,workspaceId:'other-workspace'}),/scope/);
});
