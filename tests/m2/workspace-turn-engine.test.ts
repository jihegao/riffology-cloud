import assert from 'node:assert/strict';
import test from 'node:test';
import type { TurnRuntimePort, TurnRuntimeReceipt } from '../../services/turn/dispatcher.ts';
import { TurnJournal } from '../../services/turn/journal.ts';
import { MemoryTurnStore } from '../../services/turn/store.ts';
import type { TurnScope } from '../../services/turn/protocol.ts';
import { WorkspaceTurnEngine } from '../../services/workspace/turns.ts';

const scope:TurnScope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1};
function fixture(startGuard?:import('../../services/turn/dispatcher.ts').TurnStartGuard,onTerminal?:(turn:import('../../services/turn/protocol.ts').TurnRecord)=>Promise<void>){let now=1000,failSchedule=false,cancelCalls=0,observeCalls=0,acceptCalls=0;const scheduled:number[]=[];const store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>now);
  const terminal=(input:{scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number},outcome:'completed'|'cancelled',lease:{operationId:string;leaseId:string}):TurnRuntimeReceipt=>({scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,phase:'terminal',outcome,executionErrorCode:null,events:[],checkpoint:{revisionId:`revision-${input.turnId}`,objectKey:`checkpoint-${input.turnId}`,filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:now},persistenceErrorCode:null,stopped:{confirmationId:`stop-${input.turnId}`,observedAt:now,nativeRunning:false,fenced:true},resourceDisposition:{status:'released',...lease,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,proofId:`proof-${input.turnId}`,releasedAt:now}});
  const lease=(turnId:string)=>store.snapshot()!.turns[turnId]!.resourceLease!;
  const runtime:TurnRuntimePort={accept:async input=>{acceptCalls++;return terminal(input,'completed',input.capacityLease);},observe:async input=>{observeCalls++;return terminal(input,'cancelled',lease(input.turnId));},cancel:async input=>{cancelCalls++;return terminal(input,'cancelled',lease(input.turnId));}};
  const engine=new WorkspaceTurnEngine(journal,runtime,{schedule:async at=>{if(failSchedule)throw Error('alarm-storage-failed');scheduled.push(at);},clear:async()=>{scheduled.push(-1);}},()=>now,{pollMs:10,retryMs:20},null,null,undefined,startGuard,onTerminal);
  return {store,journal,engine,scheduled,fail(value=true){failSchedule=value;},get calls(){return {acceptCalls,cancelCalls,observeCalls};}};
}

test('engine arms before submit and a terminal turn immediately wakes the queue',async()=>{
  const f=fixture(),session=(await f.journal.createSession(scope,actor,'session-key',{title:'Session'})).session;
  const submitted=await f.engine.submit(scope,actor,session.id,'turn-key',{message:'Build model'});assert.equal(submitted.turn.status,'queued');assert.deepEqual(f.scheduled,[1001]);
  const terminal=await f.engine.alarm(scope,1);assert.equal(terminal?.status,'completed');assert.equal(f.calls.acceptCalls,1);assert.deepEqual(f.scheduled,[1001,1020,1001]);
  assert.equal(await f.engine.alarm(scope,1),null);assert.equal(f.scheduled.at(-1),-1);
});

test('failed alarm arm leaves no queued turn or idempotency intent',async()=>{
  const f=fixture(),session=(await f.journal.createSession(scope,actor,'session-key',{title:'Session'})).session;f.fail();
  await assert.rejects(f.engine.submit(scope,actor,session.id,'turn-key',{message:'Build model'}),/alarm-storage-failed/);
  const state=f.store.snapshot()!;assert.deepEqual(state.turns,{});assert.deepEqual(state.turnIntents,{});
});

test('engine cancellation persists the fence before one runtime cancel',async()=>{
  const f=fixture(),session=(await f.journal.createSession(scope,actor,'session-key',{title:'Session'})).session,submitted=await f.engine.submit(scope,actor,session.id,'turn-key',{message:'Build model'});
  // Claim directly to hold a running turn, then cancel through the integration surface.
  await f.journal.claim(scope,1);const cancelled=await f.engine.cancel(scope,actor,submitted.turn.id);
  assert.equal(cancelled.status,'cancelled');assert.equal(f.calls.cancelCalls,1);assert.equal(f.store.snapshot()!.turns[submitted.turn.id]!.cancelRequestedAt!==null,true);
});

test('authenticated repeat cancel on a saved terminal turn records already-terminal and nudges its exact runtime release',async()=>{
  const f=fixture(),session=(await f.journal.createSession(scope,actor,'session-key',{title:'Session'})).session,submitted=await f.engine.submit(scope,actor,session.id,'turn-key',{message:'Build model'});
  const saved=await f.engine.alarm(scope,1);assert.equal(saved?.status,'completed');const before=structuredClone(f.store.snapshot());
  const stopped=await f.engine.cancel(scope,actor,submitted.turn.id);assert.equal(stopped.status,'completed');assert.equal(stopped.cancelDisposition,'already-terminal');assert.equal(f.calls.observeCalls,1);assert.equal(f.calls.cancelCalls,0);const after=structuredClone(f.store.snapshot())!;const expected=structuredClone(before)!;expected.turns[submitted.turn.id]!.cancelRequestedAt=1000;expected.turns[submitted.turn.id]!.cancelDisposition='already-terminal';assert.deepEqual(after,expected);
  await assert.rejects(f.engine.cancel(scope,{userId:'user-b',authVersion:1},submitted.turn.id),/turn-not-found/);assert.equal(f.calls.observeCalls,1);
});

test('repeat cancel never destroys for a terminal turn without a saved checkpoint',async()=>{
  const f=fixture(),session=(await f.journal.createSession(scope,actor,'session-key',{title:'Session'})).session,submitted=await f.engine.submit(scope,actor,session.id,'turn-key',{message:'Build model'}),claimed=(await f.journal.claim(scope,1))!.turn;
  await f.journal.beginCheckpoint(scope,{turnId:claimed.id,dispatchId:claimed.dispatchId!,runtimeGeneration:1,outcome:'failed',errorCode:'fixture-failed'});await f.journal.failCheckpoint(scope,{turnId:claimed.id,dispatchId:claimed.dispatchId!,runtimeGeneration:1,errorCode:'turn-checkpoint-unknown'});
  assert.equal((await f.engine.cancel(scope,actor,submitted.turn.id)).persistenceOutcome,'failed');assert.equal(f.calls.observeCalls,0);assert.equal(f.calls.cancelCalls,0);
});

test('engine keeps polling an unknown checkpoint and wakes the queue only after recovery',async()=>{
  let now=1000,observeCalls=0,available=false;const scheduled:number[]=[];const store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>now),runtime:TurnRuntimePort={
    async accept(input){return {scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,phase:'terminal',outcome:'completed',executionErrorCode:null,events:[],checkpoint:null,persistenceErrorCode:'turn-checkpoint-unknown',stopped:{confirmationId:'stop-one',observedAt:now,nativeRunning:false,fenced:true},resourceDisposition:{status:'released',...input.capacityLease,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,proofId:'proof-one',releasedAt:now}};},
    async observe(input){observeCalls++;const lease=store.snapshot()!.turns[input.turnId]!.resourceLease!;return {scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,phase:'terminal',outcome:'completed',executionErrorCode:null,events:[],checkpoint:available?{revisionId:'revision-one',objectKey:'checkpoint-one',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:now}:null,persistenceErrorCode:available?null:'turn-checkpoint-unknown',stopped:{confirmationId:'stop-one',observedAt:now,nativeRunning:false,fenced:true},resourceDisposition:{status:'released',...lease,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,proofId:'proof-one',releasedAt:now}};},
    async cancel(){throw Error('unexpected-cancel');},
  },engine=new WorkspaceTurnEngine(journal,runtime,{schedule:async at=>{scheduled.push(at);},clear:async()=>{scheduled.push(-1);}},()=>now,{pollMs:10,retryMs:20}),session=(await journal.createSession(scope,actor,'checkpoint-session',{title:'Session'})).session;
  await engine.submit(scope,actor,session.id,'checkpoint-turn',{message:'Build model'});const pending=await engine.alarm(scope,1);assert.equal(pending?.status,'checkpointing');assert.equal(scheduled.at(-1),1010);
  now=1010;available=true;const saved=await engine.alarm(scope,1);assert.equal(saved?.status,'completed');assert.equal(saved?.persistenceOutcome,'saved');assert.equal(observeCalls,1);assert.equal(scheduled.at(-1),1011);
});

test('queued admission persists route before dispatch, expired native start stays zero',async()=>{let routeSaved=false;const f=fixture(async()=>{assert.equal(routeSaved,true);throw Error('g5-window-deadline');});const session=(await f.journal.createSession(scope,actor,'g5-session',{title:'Synthetic'})).session;await f.engine.submit(scope,actor,session.id,'g5-turn',{message:'synthetic nonce'},undefined,async()=>{routeSaved=true;});assert.equal(f.calls.acceptCalls,0);await assert.rejects(f.engine.alarm(scope,1),/g5-window-deadline/);assert.equal(f.calls.acceptCalls,0);});
test('terminal callback only runs after actual terminal saved state, not enqueue',async()=>{const records:unknown[]=[];const f=fixture(undefined,async turn=>{records.push({status:turn.status,persistence:turn.persistenceOutcome});});const session=(await f.journal.createSession(scope,actor,'g5-terminal-session',{title:'Synthetic'})).session;await f.engine.submit(scope,actor,session.id,'g5-terminal',{message:'nonce'});assert.equal(records.length,0);await f.engine.alarm(scope,1);assert.deepEqual(records,[{status:'completed',persistence:'saved'}]);});
