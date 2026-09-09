import test from 'node:test';
import assert from 'node:assert/strict';
import {TurnJournal} from '../../services/turn/journal.ts';
import {MemoryTurnStore} from '../../services/turn/store.ts';
import {SqlObserverCalls} from '../../services/preview/observer-calls.ts';
import type {ObserverCommand} from '../../services/preview/observer-protocol.ts';
import {fixture,scope} from './run-fixture.ts';

const owner={userId:'user-a',authVersion:1};
const digest='a'.repeat(64);
function command(commandId='call-a'):ObserverCommand{return {schemaVersion:1,purpose:'observer',scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',commandId,previewId:'preview-a',operation:'snapshot',deadlineAt:15000};}

test('historical observer identity is owner scoped and remains readable after terminal completion',async()=>{
 let now=1000;const journal=new TurnJournal(new MemoryTurnStore(),()=>++now);
 const session=(await journal.createSession(scope,owner,'session-key',{title:'history'})).session;
 const queued=(await journal.submit(scope,owner,session.id,'turn-key',{message:'run'})).turn;
 const running=(await journal.claim(scope,1))!.turn;
 const identity=await journal.observerHistoryIdentity(scope,{...owner,authVersion:99},queued.id);
 assert.deepEqual(identity,{scope,sessionId:session.id,turnId:queued.id,dispatchId:running.dispatchId,generation:1});
 await journal.beginCheckpoint(scope,{turnId:queued.id,dispatchId:running.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 await journal.commitCheckpoint(scope,{turnId:queued.id,dispatchId:running.dispatchId!,runtimeGeneration:1,checkpoint:{revisionId:'r',objectKey:'o',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:running.startedAt!}});
 assert.deepEqual(journal.observerHistoryIdentity(scope,owner,queued.id),identity);
 assert.throws(()=>journal.observerHistoryIdentity({...scope,workspaceId:'other'},owner,queued.id),/scope/);
 assert.throws(()=>journal.observerHistoryIdentity(scope,{userId:'other',authVersion:1},queued.id),/denied/);
});

test('historical observer identity rejects missing or inconsistent session linkage',async()=>{
 const store=new MemoryTurnStore(),journal=new TurnJournal(store);
 const session=(await journal.createSession(scope,owner,'session-key',{title:'history'})).session;
 const turn=(await journal.submit(scope,owner,session.id,'turn-key',{message:'run'})).turn;
 assert.throws(()=>journal.observerHistoryIdentity(scope,owner,'missing'),/denied/);
 assert.throws(()=>journal.observerHistoryIdentity(scope,owner,session.id),/denied/);
 assert.throws(()=>journal.observerHistoryIdentity(scope,owner,turn.id),/denied/);
 await journal.claim(scope,1);
 const valid=store.read()!;
 for(const corrupt of [
  (s:typeof valid)=>{s.turns[turn.id]!.id='wrong';},
  (s:typeof valid)=>{s.sessions[session.id]!.actorAuthVersion=2;},
  (s:typeof valid)=>{s.sessions[session.id]!.scope={...scope,workspaceId:'wrong'};},
  (s:typeof valid)=>{s.sessions[session.id]!.actorUserId='other';},
  (s:typeof valid)=>{s.turns[turn.id]!.runtimeGeneration=2;},
 ]){
  const state=structuredClone(valid);corrupt(state);let writes=0;
  const reader=new TurnJournal({read:()=>structuredClone(state),transact:async()=>{writes++;throw Error('read-only');}});
  assert.throws(()=>reader.observerHistoryIdentity(scope,owner,turn.id),/denied/);
  assert.equal(writes,0);
 }
});

test('lookup reads historical calls after deadline and does not mutate storage',async t=>{
 const f=fixture(t),host=()=>new SqlObserverCalls(f.storage,scope,()=>f.now),h=host(),c=command();
 await h.accept(c,digest);const before=Number((f.db.prepare('SELECT COUNT(*) AS n FROM observer_calls').get() as {n:number}).n);f.now=20000;
 const found=await h.lookup({turnId:c.turnId,dispatchId:c.dispatchId,commandId:c.commandId});
 assert.equal(found?.status,'accepted');assert.equal(Number((f.db.prepare('SELECT COUNT(*) AS n FROM observer_calls').get() as {n:number}).n),before);
 assert.equal(await h.lookup({turnId:'missing',dispatchId:c.dispatchId,commandId:c.commandId}),null);
 await assert.rejects(()=>h.lookup({turnId:c.turnId,dispatchId:c.dispatchId,commandId:'bad id'}),/reference-denied/);
 await assert.rejects(()=>h.lookup({...({turnId:c.turnId,dispatchId:c.dispatchId,commandId:c.commandId}),extra:'x'} as never),/reference-denied/);
});
