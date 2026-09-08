import { TurnDispatcher, type TurnRuntimePort } from '../../services/turn/dispatcher.ts';
import { TurnAlarmLoop } from '../../services/turn/alarm.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TurnJournal } from '../../services/turn/journal.ts';
import { MemoryTurnStore } from '../../services/turn/store.ts';
import { initialWorkspaceBase, turnBaseCheckpoints, type InitialWorkspaceBase, type TurnRecord } from '../../services/turn/protocol.ts';
const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1};
function initial():InitialWorkspaceBase{return {reference:{schemaVersion:1,scope,task:{id:'task-a',tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:100,deadlineAt:10000},runtime:{taskId:'task-a',tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,runtimeId:'runtime-a',leaseId:'lease-a'},markerNonce:'nonce-a',markerSha256:'a'.repeat(64),checkpointRevision:'b'.repeat(64)},filesSha256:'c'.repeat(64)};}
function fixture(){let now=1000,calls=0;const store=new MemoryTurnStore();const journal=new TurnJournal(store,()=>++now,async()=>{calls++;return initial();});return {store,journal,get calls(){return calls;}};}
async function queue(journal:TurnJournal,key:string){const session=(await journal.createSession(scope,actor,'session',{title:'Model'})).session;return (await journal.submit(scope,actor,session.id,key,{message:'Build'})).turn;}
async function checkpoint(journal:TurnJournal,turn:TurnRecord,save=false){const input={turnId:turn.id,dispatchId:turn.dispatchId!,runtimeGeneration:1};await journal.beginCheckpoint(scope,{...input,outcome:'completed'});if(save)return journal.commitCheckpoint(scope,{...input,checkpoint:{revisionId:'revision-a',objectKey:'turns/revision-a.json',filesSha256:'d'.repeat(64),sessionSha256:'e'.repeat(64),committedAt:turn.startedAt!}});return journal.failCheckpoint(scope,{...input,errorCode:'checkpoint-unavailable'});}
test('initial claim freezes source once; concurrent claims and active replay reuse persisted base',async()=>{
 const f=fixture();assert.equal(await f.journal.claim(scope,1),null);assert.equal(f.calls,0);await queue(f.journal,'one');
 const [first,second]=await Promise.all([f.journal.claim(scope,1),f.journal.claim(scope,1)]);assert.equal(f.calls,1);assert.deepEqual(first!.turn.base,{workspace:null,session:null,initial:initial()});assert.equal(second!.replayed,true);assert.deepEqual(second!.turn.base,first!.turn.base);
 const rebuilt=new TurnJournal(f.store,()=>2000,async()=>{throw Error('must not resolve');});assert.equal((await rebuilt.claim(scope,1))!.replayed,true);
});
test('failed persistence retries retain the original initial source across journal reconstruction',async()=>{
 const f=fixture();await queue(f.journal,'one');const first=(await f.journal.claim(scope,1))!.turn;await checkpoint(f.journal,first);
 const rebuilt=new TurnJournal(f.store,()=>3000,async()=>{throw Error('source was replaced');});await queue(rebuilt,'two');const next=(await rebuilt.claim(scope,1))!.turn;assert.deepEqual(next.base,first.base);assert.equal(f.calls,1);
});
test('saved workspace head wins permanently over initial content, including new sessions',async()=>{
 const f=fixture();await queue(f.journal,'one');const first=(await f.journal.claim(scope,1))!.turn;const saved=await checkpoint(f.journal,first,true);
 const rebuilt=new TurnJournal(f.store,()=>3000,async()=>{throw Error('must not reapply initial content');});const session=(await rebuilt.createSession(scope,actor,'second-session',{title:'Second'})).session;await rebuilt.submit(scope,actor,session.id,'two',{message:'Continue'});
 const next=(await rebuilt.claim(scope,1))!.turn;assert.deepEqual(next.base,{workspace:saved.checkpoint,session:null});assert.equal(f.calls,1);
});
test('invalid initial callback fails before dispatch and leaves queued work recoverable',async()=>{
 const f=fixture();const queued=await queue(f.journal,'one');const bad=initial();bad.reference.scope={...scope,tenantId:'other'};
 const invalid=new TurnJournal(f.store,()=>3000,async()=>bad);await assert.rejects(invalid.claim(scope,1),/scope-denied/);assert.equal(f.store.snapshot()!.turns[queued.id]!.status,'queued');assert.equal(f.store.snapshot()!.activeTurnId,null);assert.equal((await f.journal.claim(scope,1))!.replayed,false);
});
test('base protocol rejects mixed, malformed and unexpected initial provenance',()=>{
 const receipt={revisionId:'revision-a',objectKey:'turns/revision.json',filesSha256:'d'.repeat(64),sessionSha256:'e'.repeat(64),committedAt:1000};
 for(const raw of [{workspace:receipt,session:null,initial:initial()},{workspace:null,session:receipt,initial:initial()},{workspace:null,session:null,initial:null},{workspace:null,session:null,initial:{...initial(),extra:true}},{workspace:null,session:null,initial:{...initial(),filesSha256:'invalid'}}])assert.throws(()=>turnBaseCheckpoints(raw));
 assert.deepEqual(initialWorkspaceBase(initial()),initial());assert.deepEqual(turnBaseCheckpoints({workspace:null,session:null}),{workspace:null,session:null});
});
test('persisted journal rejects changed, dropped or cross-scope initial bases',async()=>{
 const f=fixture();await queue(f.journal,'one');const first=(await f.journal.claim(scope,1))!.turn;await checkpoint(f.journal,first);await queue(f.journal,'two');const second=(await f.journal.claim(scope,1))!.turn;
 for(const change of [(state:any)=>{for(const row of Object.values(state.turns) as any[])row.base.initial.filesSha256='f'.repeat(64);},(state:any)=>{state.turns[second.id].base.initial.filesSha256='f'.repeat(64);},(state:any)=>{delete state.turns[second.id].base.initial;},(state:any)=>{state.turns[second.id].base.initial.reference.scope.tenantId='other';}])await assert.rejects(f.store.transact(current=>{change(current);return {state:current!,value:null};}),/invalid-persisted-turn-journal/);
 assert.deepEqual(f.store.snapshot()!.turns[second.id]!.base,first.base);
});

test('claim timestamps the selected queued Turn after asynchronous initial resolution',async()=>{
 let now=1000,release!:()=>void,entered!:()=>void;
 const waiting=new Promise<void>(resolve=>{release=resolve;}),resolving=new Promise<void>(resolve=>{entered=resolve;});
 const store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>++now,async()=>{entered();await waiting;return initial();});
 const first=await queue(journal,'before-lookup');const pending=journal.claim(scope,1);await resolving;
 now=2000;await journal.cancel(scope,actor,first.id);const replacement=await queue(journal,'during-lookup');
 now=3000;release();const claimed=(await pending)!.turn;
 assert.equal(claimed.id,replacement.id);assert.equal(claimed.startedAt,3001);assert.ok(claimed.startedAt!>replacement.createdAt);
 const state=store.snapshot()!;assert.equal(state.turns[first.id]!.status,'cancelled');assert.equal(state.turns[first.id]!.base,null);
 assert.equal(state.events.at(-1)!.type,'turn.started');assert.equal(state.events.at(-1)!.at,claimed.startedAt);
 assert.deepEqual(claimed.base,{workspace:null,session:null,initial:initial()});
});

test('stable initial failure is durable, idempotent, undispatched and advances the alarm queue',async()=>{
 let now=1000,calls=0,cleared=0;const store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>++now,async()=>{throw Error('turn-initial-base-unavailable');});
 const first=await queue(journal,'one'),second=await queue(journal,'two');
 const runtime:TurnRuntimePort={async accept(){calls++;throw Error('unexpected accept');},async observe(){calls++;throw Error('unexpected observe');},async cancel(){calls++;throw Error('unexpected cancel');}};
 const scheduled:number[]=[],loop=new TurnAlarmLoop(new TurnDispatcher(journal,runtime),{async schedule(at){scheduled.push(at);},async clear(){cleared++;}},()=>now,{retryMs:20,pollMs:10});
 const failed=(await loop.alarm(scope,1))!;assert.equal(failed.id,first.id);assert.equal(failed.status,'failed');assert.equal(failed.errorCode,'turn-initial-base-unavailable');
 for(const field of ['dispatchId','runtimeGeneration','base','startedAt','startedSequence','checkpoint','persistenceOutcome','persistenceErrorCode'] as const)assert.equal(failed[field],null);
 assert.equal(scheduled.at(-1),now+1);assert.equal((await loop.alarm(scope,1))!.id,second.id);assert.equal(await loop.alarm(scope,1),null);assert.equal(cleared,1);assert.equal(calls,0);
 const rebuilt=new TurnJournal(store,()=>4000,async()=>{throw Error('should not resolve on replay');}),session=(await rebuilt.createSession(scope,actor,'session',{title:'Model'})).session;
 const replay=await rebuilt.submit(scope,actor,session.id,'one',{message:'Build'});assert.equal(replay.replayed,true);assert.deepEqual(replay.turn,failed);
 const events=(await rebuilt.replay(scope)).events;assert.equal(events.filter(row=>row.type==='turn.failed').length,2);assert.equal(events.filter(row=>row.type==='turn.started').length,0);assert.equal((await rebuilt.view(scope)).turns[first.id]!.errorCode,'turn-initial-base-unavailable');assert.equal(await rebuilt.workspaceRevision(scope),null);
 await assert.rejects(store.transact(state=>{state!.turns[first.id]!.errorCode='arbitrary-error';return {state:state!,value:null};}),/invalid-persisted-turn-journal/);
});
test('transient initial transport error retains queued intent and scheduled retry',async()=>{
 const store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>1000,async()=>{throw Error('rpc-transport-unavailable');});const queued=await queue(journal,'one');let calls=0;
 const runtime:TurnRuntimePort={async accept(){calls++;throw Error('unexpected');},async observe(){calls++;throw Error('unexpected');},async cancel(){calls++;throw Error('unexpected');}};
 const scheduled:number[]=[],loop=new TurnAlarmLoop(new TurnDispatcher(journal,runtime),{async schedule(at){scheduled.push(at);},async clear(){throw Error('unexpected clear');}},()=>1000,{retryMs:20});
 await assert.rejects(loop.alarm(scope,1),/rpc-transport-unavailable/);assert.deepEqual(scheduled,[1020]);assert.equal(store.snapshot()!.turns[queued.id]!.status,'queued');assert.equal(store.snapshot()!.events.length,1);assert.equal(calls,0);
});
test('saved head arriving during failed initial lookup takes priority over stale source failure',async()=>{
 let now=1000,release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;}),resolving=new Promise<void>(resolve=>{entered=resolve;});
 const store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>++now,async()=>{entered();await waiting;throw Error('turn-initial-base-unavailable');});await queue(journal,'one');const pending=journal.claim(scope,1);await resolving;
 const other=new TurnJournal(store,()=>++now,async()=>initial()),claimed=(await other.claim(scope,1))!.turn,saved=await checkpoint(other,claimed,true);const next=await queue(other,'two');release();
 const result=(await pending)!.turn;assert.equal(result.id,next.id);assert.equal(result.status,'running');assert.deepEqual(result.base,{workspace:saved.checkpoint,session:saved.checkpoint});assert.equal(result.errorCode,null);
});
