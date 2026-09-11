import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableTurnStore } from '../../services/turn/store.ts';
import { TurnJournal } from '../../services/turn/journal.ts';
const KEY='m2:turn-journal',scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1};
function fixture(){
 let values=new Map<string,unknown>(),durable=new Map<string,unknown>(),failSync=false,hold=false;const pending:Array<{commit():void;fail():void}>=[],events:string[]=[];
 const storage={
  kv:{get:(key:string)=>{events.push('get');return values.get(key);},put:(key:string,value:unknown)=>{events.push('put');values.set(key,value);}},
  transactionSync:<T>(operation:()=>T)=>{events.push('transaction-start');const before=structuredClone(values);try{return operation();}catch(error){values=before;events.push('rollback');throw error;}},
  sync:()=>{
   events.push('sync');const snapshot=structuredClone(values);
   if(failSync)return Promise.reject(Error('injected-sync-failure'));
   if(!hold){durable=snapshot;return Promise.resolve();}
   return new Promise<void>((resolve,reject)=>pending.push({commit(){durable=snapshot;resolve();},fail(){reject(Error('injected-sync-failure'));}}));
  },
 } as unknown as DurableObjectStorage;
 return {storage,store:()=>new DurableTurnStore(storage),events,pending,hold:(v:boolean)=>{hold=v;},failSync:(v:boolean)=>{failSync=v;},peek:()=>structuredClone(values.get(KEY)),persisted:()=>structuredClone(durable.get(KEY)),seed:(v:unknown)=>values.set(KEY,v)};
}
test('durable turn store acknowledges only after SQLite sync and detaches aliases',async()=>{
 const f=fixture();f.hold(true);const journal=new TurnJournal(f.store(),()=>1000);let resolved=false;
 const result=journal.createSession(scope,actor,'session-key',{title:'Session'}).then(value=>{resolved=true;return value;});
 for(let i=0;i<20&&f.pending.length===0;i++)await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(resolved,false);assert.ok(f.peek());assert.equal(f.persisted(),undefined);assert.deepEqual(f.events.slice(-4),['transaction-start','get','put','sync']);
 f.pending[0]!.commit();const created=await result;assert.equal(created.replayed,false);created.session.title='mutated';assert.equal((f.persisted() as any).sessions[created.session.id].title,'Session');
});
test('sync uncertainty preserves an idempotent accepted session for readback',async()=>{
 const f=fixture(),first=new TurnJournal(f.store(),()=>1000);f.failSync(true);await assert.rejects(first.createSession(scope,actor,'same',{title:'Session'}),/sync-failure/);assert.ok(f.peek());
 f.failSync(false);const rebuilt=new TurnJournal(f.store(),()=>2000),replay=await rebuilt.createSession(scope,actor,'same',{title:'Session'});assert.equal(replay.replayed,true);assert.equal(Object.keys((f.persisted() as any).sessions).length,1);
});
test('legacy v1 queued state migrates on the next mutation without inventing a base',async()=>{
 const source=fixture(),journal=new TurnJournal(source.store(),()=>1000),session=(await journal.createSession(scope,actor,'legacy-session',{title:'Legacy'})).session;
 await journal.submit(scope,actor,session.id,'legacy-turn',{message:'Queued'});const legacy=source.peek() as any;
 legacy.schemaVersion=1;delete legacy.workspaceHead;for(const row of Object.values(legacy.sessions) as any[]){delete row.head;}for(const row of Object.values(legacy.turns) as any[]){delete row.base;}
 const target=fixture();target.seed(legacy);const rebuilt=new TurnJournal(target.store(),()=>2000);assert.equal((await rebuilt.view(scope)).turns[Object.keys(legacy.turns)[0]].status,'queued');
 await rebuilt.createSession(scope,actor,'new-session',{title:'New'});const migrated=target.persisted() as any;assert.equal(migrated.schemaVersion,5);assert.equal(migrated.resourceWait,null);assert.equal(migrated.releaseHold,null);assert.equal(migrated.recoveryHold,null);assert.equal(migrated.workspaceHead,null);assert.equal(migrated.sessions[session.id].head,null);assert.equal(migrated.turns[Object.keys(migrated.turns)[0]].base,null);assert.equal(migrated.turns[Object.keys(migrated.turns)[0]].resourceLease,null);assert.equal(migrated.turns[Object.keys(migrated.turns)[0]].startedSequence,null);assert.equal(migrated.turns[Object.keys(migrated.turns)[0]].terminalSequence,null);
});
test('legacy saved heads and claimed bases migrate by journal sequence, not remote checkpoint time',async()=>{
 const source=fixture(),clock=(()=>{let now=1000;return()=>++now;})(),journal=new TurnJournal(source.store(),clock);
 const firstSession=(await journal.createSession(scope,actor,'legacy-first-session',{title:'First'})).session;
 const first=(await journal.submit(scope,actor,firstSession.id,'legacy-first-turn',{message:'First'})).turn;
 const firstClaim=(await journal.claim(scope,1))!.turn;
 await journal.beginCheckpoint(scope,{turnId:first.id,dispatchId:firstClaim.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 const firstCheckpoint={revisionId:'legacy-revision-one',objectKey:'turns/one.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1004};
 await journal.commitCheckpoint(scope,{turnId:first.id,dispatchId:firstClaim.dispatchId!,runtimeGeneration:1,checkpoint:firstCheckpoint});
 const secondSession=(await journal.createSession(scope,actor,'legacy-second-session',{title:'Second'})).session;
 const second=(await journal.submit(scope,actor,secondSession.id,'legacy-second-turn',{message:'Second'})).turn;
 const secondClaim=(await journal.claim(scope,1))!.turn;
 await journal.beginCheckpoint(scope,{turnId:second.id,dispatchId:secondClaim.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 // This remote timestamp predates the first checkpoint even though the local
 // journal commits this Turn later. Cross-DO clocks must not reverse lineage.
 const secondCheckpoint={revisionId:'legacy-revision-two',objectKey:'turns/two.json',filesSha256:'c'.repeat(64),sessionSha256:'d'.repeat(64),committedAt:1008};
 await journal.commitCheckpoint(scope,{turnId:second.id,dispatchId:secondClaim.dispatchId!,runtimeGeneration:1,checkpoint:secondCheckpoint});
 const third=(await journal.submit(scope,actor,firstSession.id,'legacy-third-turn',{message:'Third'})).turn;
 const thirdClaim=(await journal.claim(scope,1))!.turn;
 const legacy=source.peek() as any;legacy.schemaVersion=1;delete legacy.workspaceHead;
 for(const row of Object.values(legacy.sessions) as any[])delete row.head;
 for(const row of Object.values(legacy.turns) as any[])delete row.base;
 // Explicitly make the later checkpoint look older to the removed v1 logic.
 legacy.turns[second.id].checkpoint.committedAt=1003;
 const missingTerminal=structuredClone(legacy),firstTerminal=missingTerminal.events.findIndex((event:any)=>event.turnId===first.id&&event.type==='turn.completed');
 missingTerminal.events.splice(firstTerminal,1);const missingTarget=fixture();missingTarget.seed(missingTerminal);
 await assert.rejects(missingTarget.store().transact(state=>({state:state!,value:null})),/invalid-persisted/);
 const duplicateTerminal=structuredClone(legacy),original=duplicateTerminal.events.find((event:any)=>event.turnId===first.id&&event.type==='turn.completed');
 duplicateTerminal.events.push({...structuredClone(original),sequence:duplicateTerminal.nextSequence,eventId:'legacy-duplicate-terminal'});duplicateTerminal.nextSequence++;
 const duplicateTarget=fixture();duplicateTarget.seed(duplicateTerminal);
 await assert.rejects(duplicateTarget.store().transact(state=>({state:state!,value:null})),/invalid-persisted/);
 const target=fixture();target.seed(legacy);const rebuilt=new TurnJournal(target.store(),()=>2000);
 await rebuilt.createSession(scope,actor,'legacy-migration-commit',{title:'Migrated'});
 const migrated=target.persisted() as any;
 assert.deepEqual(migrated.workspaceHead,legacy.turns[second.id].checkpoint);
 assert.deepEqual(migrated.sessions[firstSession.id].head,legacy.turns[first.id].checkpoint);
 assert.deepEqual(migrated.sessions[secondSession.id].head,legacy.turns[second.id].checkpoint);
 assert.deepEqual(migrated.turns[second.id].base,{workspace:legacy.turns[first.id].checkpoint,session:null});
 assert.deepEqual(migrated.turns[third.id].base,{workspace:legacy.turns[second.id].checkpoint,session:legacy.turns[first.id].checkpoint});
 assert.equal(thirdClaim.base?.workspace?.revisionId,'legacy-revision-two');
});
test('missing SQLite APIs, malformed state and async callbacks fail closed',async()=>{
 assert.throws(()=>new DurableTurnStore({} as DurableObjectStorage),/sqlite-turn-storage/);const f=fixture();f.seed({schemaVersion:1});
 await assert.rejects(f.store().transact(()=>{throw Error('must-not-run');}),/invalid-persisted/);assert.deepEqual(f.peek(),{schemaVersion:1});
 const clean=fixture();await assert.rejects(clean.store().transact((async()=>({state:{} as any,value:null})) as any),/synchronous/);assert.equal(clean.peek(),undefined);
});
test('nested corruption, broken references and inconsistent active state fail closed',async()=>{
 const base=fixture(),journal=new TurnJournal(base.store(),()=>1000),session=(await journal.createSession(scope,actor,'session-key',{title:'Session'})).session;
 await journal.submit(scope,actor,session.id,'turn-key',{message:'Message'});const good=base.peek() as any;
 const corruptions=[
  (state:any)=>{state.scope.workspaceGeneration=0;},
  (state:any)=>{state.sessions[session.id].actorAuthVersion='1';},
  (state:any)=>{state.turns[Object.keys(state.turns)[0]].sessionId='missing';},
  (state:any)=>{state.turnIntents[Object.keys(state.turnIntents)[0]].turnId='missing';},
  (state:any)=>{state.events[0].sequence=2;},
  (state:any)=>{state.nextSequence=99;},
  (state:any)=>{state.activeTurnId=Object.keys(state.turns)[0];},
 ];
  for(const mutate of corruptions){const f=fixture(),bad=structuredClone(good);mutate(bad);f.seed(bad);await assert.rejects(f.store().transact(state=>({state:state!,value:null})),/invalid-persisted/);}
});
test('saved heads and claimed bases cannot roll back or cross sessions',async()=>{
 const source=fixture(),journal=new TurnJournal(source.store(),(()=>{let now=1000;return()=>++now;})()),firstSession=(await journal.createSession(scope,actor,'first-session',{title:'First'})).session;
 const first=(await journal.submit(scope,actor,firstSession.id,'first-turn',{message:'First'})).turn,firstClaim=(await journal.claim(scope,1))!.turn;
 await journal.beginCheckpoint(scope,{turnId:first.id,dispatchId:firstClaim.dispatchId!,runtimeGeneration:1,outcome:'completed'});
 const checkpoint={revisionId:'revision-one',objectKey:'turns/one.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1005};
 await journal.commitCheckpoint(scope,{turnId:first.id,dispatchId:firstClaim.dispatchId!,runtimeGeneration:1,checkpoint});
 const secondSession=(await journal.createSession(scope,actor,'second-session',{title:'Second'})).session,second=(await journal.submit(scope,actor,secondSession.id,'second-turn',{message:'Second'})).turn;
 await journal.claim(scope,1);const good=source.peek() as any;
 const corruptions=[
  (state:any)=>{state.workspaceHead=null;},
  (state:any)=>{state.sessions[firstSession.id].head=null;},
  (state:any)=>{state.turns[second.id].base.session=structuredClone(checkpoint);},
  (state:any)=>{state.turns[second.id].base.workspace={...checkpoint,revisionId:'forged-revision'};},
 ];
 for(const mutate of corruptions){const target=fixture(),bad=structuredClone(good);mutate(bad);target.seed(bad);await assert.rejects(target.store().transact(state=>({state:state!,value:null})),/invalid-persisted/);}
});
