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
test('submission receipt is a read-only exact actor, session and idempotency-key lookup',async()=>{
 const f=fixture(),s=await session(f.journal),submitted=await f.journal.submit(scope,actor,s.id,'receipt-key',{message:'accepted before reply loss'}),before=f.store.snapshot();
 const receipt=await f.journal.receipt(scope,actor,s.id,'receipt-key');assert.equal(receipt.turn.id,submitted.turn.id);assert.deepEqual(f.store.snapshot(),before);
 await assert.rejects(f.journal.receipt(scope,actor,s.id,'other-key'),/receipt-not-found/);
 await assert.rejects(f.journal.receipt(scope,{...actor,authVersion:2},s.id,'receipt-key'),/receipt-not-found/);
 const other=await session(f.journal,'other-session');await assert.rejects(f.journal.receipt(scope,actor,other.id,'receipt-key'),/receipt-not-found/);
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
test('queued cancellation never dispatches; running cancellation accepts a raced natural terminal outcome',async()=>{
 const f=fixture(),first=await queued(f.journal,'one'),s2=await session(f.journal,'session-two'),second=(await f.journal.submit(scope,actor,s2.id,'two',{message:'two'})).turn;
 await f.journal.cancel(scope,actor,first.id);assert.equal(f.store.snapshot()!.turns[first.id]!.status,'cancelled');assert.equal(f.store.snapshot()!.turns[first.id]!.cancelDisposition,'cancelled');const claim=(await f.journal.claim(scope,1))!.turn;assert.equal(claim.id,second.id);
 const cancelling=await f.journal.cancel(scope,actor,second.id);assert.equal(cancelling.status,'cancelling');assert.ok(cancelling.cancelRequestedAt);
 const pending=await f.journal.beginCheckpoint(scope,{turnId:second.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,outcome:'completed'});assert.equal(pending.status,'checkpointing');
 const checkpointing=f.store.snapshot()!.events.at(-1)!;assert.equal(checkpointing.type,'turn.checkpointing');assert.equal(checkpointing.payload.cancelDisposition,'already-terminal');assert.equal(pending.cancelDisposition,'already-terminal');
});
test('cancel disposition covers every fenced outcome and a late Stop does not duplicate terminal state',async()=>{
 for(const [outcome,disposition] of [['cancelled','cancelled'],['interrupted','interrupted'],['completed','already-terminal'],['failed','already-terminal']] as const){
  const f=fixture(),turn=await queued(f.journal,`fenced-${outcome}`),claim=(await f.journal.claim(scope,1))!.turn;await f.journal.cancel(scope,actor,turn.id);
  const pending=await f.journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,outcome,...(outcome==='failed'?{errorCode:'native-failed'}:{})});assert.equal(pending.cancelDisposition,disposition);
 }
 const f=fixture(),turn=await queued(f.journal,'late-stop'),claim=(await f.journal.claim(scope,1))!.turn;await f.journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,outcome:'completed'});const checkpoint={revisionId:'late-stop-revision',objectKey:'turns/late-stop.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:claim.startedAt!};await f.journal.commitCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,checkpoint});const terminalEvents=()=>f.store.snapshot()!.events.filter(row=>row.turnId===turn.id&&row.type==='turn.completed').length;
 assert.equal(terminalEvents(),1);const stopped=await f.journal.cancel(scope,actor,turn.id);assert.equal(stopped.cancelDisposition,'already-terminal');assert.equal(terminalEvents(),1);assert.equal((await f.journal.cancel(scope,actor,turn.id)).cancelDisposition,'already-terminal');assert.equal(terminalEvents(),1);
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
test('recovery hold ends the active spinner, queues new turns and exposes only redacted recovery state',async()=>{
 const f=fixture(),turn=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn;await f.journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 const failed=await f.journal.failCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,errorCode:'turn-checkpoint-recovery-hold'});assert.equal(failed.status,'failed');assert.equal(f.store.snapshot()!.activeTurnId,null);assert.equal(await f.journal.claim(scope,1),null);
 const queuedBehind=await f.journal.submit(scope,actor,turn.sessionId,'blocked',{message:'blocked'});assert.equal(queuedBehind.turn.status,'queued');assert.equal(await f.journal.claim(scope,1),null);const view=await f.journal.view(scope);assert.equal(view.schemaVersion,3);assert.deepEqual(Object.keys(view.recoveryHold??{}),['status','reasonCode','since','nextAttemptAt']);assert.equal((view.recoveryHold as any).turnId,undefined);
 assert.ok(f.journal.recovery(scope));await f.journal.advanceRecovery(scope,'aborted');assert.equal((await f.journal.view(scope)).recoveryHold,null);
});
test('release hold is committed atomically, blocks claim, redacts capability fields and clears only by exact identity',async()=>{
 const f=fixture(),first=await queued(f.journal,'release-first'),claim=(await f.journal.claim(scope,1))!.turn,lease=claim.resourceLease!;await f.journal.beginCheckpoint(scope,{turnId:first.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 const pending={status:'release-pending' as const,...lease,turnId:first.id,dispatchId:claim.dispatchId!,generation:1,reasonCode:'trusted-pi-release-pending',since:1010,nextAttemptAt:1020},checkpoint={revisionId:'release-revision',objectKey:'turns/release.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:claim.startedAt!};
 await f.journal.commitCheckpoint(scope,{turnId:first.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,checkpoint,resourceDisposition:pending});const second=await f.journal.submit(scope,actor,first.sessionId,'release-second',{message:'queued behind release'});assert.equal(second.turn.status,'queued');assert.equal(await f.journal.claim(scope,1),null);
 const view=await f.journal.view(scope);assert.equal(view.schemaVersion,3);assert.deepEqual(Object.keys(view.releaseHold??{}),['status','reasonCode','since','nextAttemptAt']);assert.equal((view.releaseHold as any).leaseId,undefined);assert.equal((view.turns[first.id] as any).resourceLease,undefined);
 for(const disposition of [{...pending,operationId:'wrong-operation'},{...pending,leaseId:'wrong-lease'},{...pending,turnId:second.turn.id},{...pending,dispatchId:'wrong-dispatch'},{...pending,generation:2}])await assert.rejects(f.journal.advanceRelease(scope,disposition),/resource-disposition-conflict/);
 const released={status:'released' as const,...lease,turnId:first.id,dispatchId:claim.dispatchId!,generation:1,proofId:'release-proof',releasedAt:1030};await f.journal.advanceRelease(scope,released);assert.equal(f.store.snapshot()!.releaseHold,null);assert.equal((await f.journal.claim(scope,1))!.turn.id,second.turn.id);await assert.rejects(f.journal.advanceRelease(scope,released),/resource-hold-not-found/);
});
test('resource wait blocks ordinary claim and an exact atomic lease consume starts only the FIFO turn',async()=>{
 const f=fixture(),first=await queued(f.journal,'wait-first'),s=await session(f.journal,'wait-session'),second=(await f.journal.submit(scope,actor,s.id,'wait-second',{message:'second'})).turn,candidate=f.journal.admissionCandidate(scope)!;assert.equal(candidate.turn.id,first.id);
 const waiting={turnId:first.id,ticketId:'ticket-one',operationId:'operation-one',reasonCode:'trusted-pi-capacity-unavailable',since:1010,nextAttemptAt:1020};await f.journal.beginResourceWait(scope,waiting);assert.equal(await f.journal.claim(scope,1),null);assert.equal(f.journal.admissionCandidate(scope)!.wait?.ticketId,'ticket-one');
 const view=await f.journal.view(scope);assert.deepEqual(Object.keys(view.resourceWait??{}),['status','reasonCode','since','nextAttemptAt']);assert.equal((view.resourceWait as any).ticketId,undefined);await assert.rejects(f.journal.consumeResourceLeaseAndClaim(scope,1,{...waiting,leaseId:'lease-one',ticketId:'wrong-ticket'}),/resource-wait-conflict/);
 const claimed=(await f.journal.consumeResourceLeaseAndClaim(scope,1,{turnId:first.id,ticketId:'ticket-one',operationId:'operation-one',leaseId:'lease-one'}))!.turn;assert.equal(claimed.id,first.id);assert.deepEqual(claimed.resourceLease,{operationId:'operation-one',leaseId:'lease-one'});assert.equal(f.store.snapshot()!.resourceWait,null);assert.equal(f.store.snapshot()!.turns[second.id]!.status,'queued');
});
test('public view excludes idempotency hashes and capability values while exposing only current continuation eligibility',async()=>{
 const f=fixture(),turn=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn,view=await f.journal.view(scope,actor),stale=await f.journal.view(scope,{...actor,authVersion:2});const publicTurn=view.turns[turn.id] as any,publicSession=view.sessions[turn.sessionId] as any;
 assert.equal(publicTurn.requestKey,undefined);assert.equal(publicTurn.payloadSha256,undefined);assert.equal(publicTurn.dispatchId,undefined);assert.equal(publicTurn.base,undefined);assert.equal(publicTurn.startedSequence,undefined);assert.equal(publicTurn.terminalSequence,undefined);assert.deepEqual(publicTurn.actor,{userId:'user-a'});assert.equal(publicSession.actorUserId,undefined);assert.equal(publicSession.actorAuthVersion,undefined);
 assert.equal(publicSession.canContinue,true);assert.equal(stale.sessions[turn.sessionId]!.canContinue,false);assert.equal((await f.journal.view(scope)).sessions[turn.sessionId]!.canContinue,undefined);
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

test('v6 compaction preserves terminal state and requires a snapshot for expired cursors',async()=>{
 const f=fixture(),turn=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn;
 const runtimeInput={turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,eventId:'event-before-compaction',type:'assistant.message' as const,at:claim.startedAt!,payload:{text:'saved response'}};const original=await f.journal.appendRuntime(scope,runtimeInput);
 await f.journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 const checkpoint={revisionId:'revision-v3',objectKey:'turns/v3.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:claim.startedAt!+1};
 await f.journal.commitCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,checkpoint});
 const compacted=await f.journal.compact(scope,1);assert.equal(compacted.removed,4);const state=f.store.snapshot()!;assert.equal(state.schemaVersion,9);assert.equal(state.oldestSequence,state.nextSequence-1);assert.equal(state.turns[turn.id]!.status,'completed');assert.deepEqual(state.workspaceHead,checkpoint);assert.deepEqual(state.sessions[turn.sessionId]!.head,checkpoint);assert.ok(state.turns[turn.id]!.startedSequence!<state.turns[turn.id]!.terminalSequence!);
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

test('issue 77: journal replays reordered nested payloads without weakening event identity',async()=>{
 const f=fixture(),turn=await queued(f.journal),claim=(await f.journal.claim(scope,1))!.turn;
 const input={turnId:turn.id,dispatchId:claim.dispatchId!,runtimeGeneration:1,eventId:'reordered-event',type:'provider.status' as const,at:claim.startedAt!,payload:{status:'running',usage:{input:1,output:2}}};
 const first=await f.journal.appendRuntime(scope,input);
 const again=await f.journal.appendRuntime(scope,{...input,payload:{usage:{output:2,input:1},status:'running'}});
 assert.equal(again.replayed,true);assert.equal(again.event.sequence,first.event.sequence);
 await assert.rejects(f.journal.appendRuntime(scope,{...input,at:input.at+1}),/event-conflict/);
 await assert.rejects(f.journal.appendRuntime(scope,{...input,payload:{status:'running',usage:{input:1,output:3}}}),/event-conflict/);
});

test('issue 77: checkpoint compare-and-swap rejects a stale base and retains the newer head',async()=>{
 const f=fixture(),s=await session(f.journal);
 const finish=async(key:string)=>{
  await f.journal.submit(scope,actor,s.id,key,{message:key});const turn=(await f.journal.claim(scope,1))!.turn;
  const input={turnId:turn.id,dispatchId:turn.dispatchId!,runtimeGeneration:1};
  await f.journal.beginCheckpoint(scope,{...input,outcome:'completed'});
  const checkpoint={revisionId:key,objectKey:`turns/${key}`,filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:turn.startedAt!};
  await f.journal.commitCheckpoint(scope,{...input,checkpoint});return checkpoint;
 };
 const older=await finish('older'),newer=await finish('newer');
 await f.journal.submit(scope,actor,s.id,'stale',{message:'stale'});const turn=(await f.journal.claim(scope,1))!.turn;
 const input={turnId:turn.id,dispatchId:turn.dispatchId!,runtimeGeneration:1};await f.journal.beginCheckpoint(scope,{...input,outcome:'completed'});
 // A valid persisted older parent can arise in a migrated/externally prepared
 // candidate. The product commit must check the current authority as well.
 await f.store.transact(state=>{state!.turns[turn.id]!.base={workspace:older,session:older};return {state:state!,value:null};});
 await assert.rejects(f.journal.commitCheckpoint(scope,{...input,checkpoint:{...newer,revisionId:'candidate',committedAt:turn.startedAt!}}),/turn-checkpoint-base-conflict/);
 assert.deepEqual(f.store.snapshot()!.workspaceHead,newer);assert.equal(f.store.snapshot()!.turns[turn.id]!.persistenceOutcome,null);
});
