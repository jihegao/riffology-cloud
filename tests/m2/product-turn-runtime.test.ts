import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import { ProductTurnRuntimeCore, productTurnRuntimeLimits, turnCheckpointOperationId, type ProductTurnRuntimeStorage, type TurnCheckpointPort, type TurnExecutionObservation, type TurnExecutionPort } from '../../services/turn-runtime/core.ts';
import { turnRuntimeActorName, type TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';
import { TurnDispatcher } from '../../services/turn/dispatcher.ts';
import { TurnJournal } from '../../services/turn/journal.ts';
import { MemoryTurnStore } from '../../services/turn/store.ts';
import type { CheckpointReceipt, TurnScope } from '../../services/turn/protocol.ts';

const scope:TurnScope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2};
const identity:TurnRuntimeIdentity={scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2};
const actor={userId:'user-a',authVersion:1};
const base={workspace:null,session:null};
const request=(message='Build model')=>({...identity,actor,message,base});
const stop={confirmationId:'stop-a',observedAt:1002,nativeRunning:false as const,fenced:true as const};
const event={eventId:'event-a',type:'assistant.message' as const,at:1002,payload:{text:'fixture result'}};
const terminal=(id:TurnRuntimeIdentity=identity,outcome:'completed'|'failed'|'cancelled'|'interrupted'='completed'):TurnExecutionObservation=>({identity:id,phase:'terminal',outcome,executionErrorCode:outcome==='completed'?null:'fixture-failure',events:[event],stopped:stop});

function fixture(t:TestContext,releaseTiming={retryMs:0,assignmentGuardMs:0,quietMs:0}){
  const dir=mkdtempSync(join(tmpdir(),'m2-turn-runtime-')),file=join(dir,'state.db');t.after(()=>rmSync(dir,{recursive:true,force:true}));let db=new DatabaseSync(file),now=1000,starts=0,observes=0,cancels=0,releases=0,prepares=0,commits=0,checkpointObserves=0,writes=0,syncs=0,releaseError=false,releaseRunning=false,alarmFails=false,alarm:number|null=null;
  let startResult:TurnExecutionObservation={identity,phase:'running',outcome:null,events:[event]},observeResult:TurnExecutionObservation={identity,phase:'running',outcome:null},cancelResult:TurnExecutionObservation=terminal(identity,'cancelled'),startError=false,dynamicTerminal=false,commitError=false,observedCheckpoint:CheckpointReceipt|null=null;
  const configure=()=>db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');configure();
  const storage={sql:{exec(query:string,...bindings:(string|number|null)[]){if(!query.startsWith('SELECT'))writes++;if(query.includes('CREATE TABLE')){db.exec(query);return {toArray:()=>[]};}const statement=db.prepare(query),rows=statement.columns().length?statement.all(...bindings):(statement.run(...bindings),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}},async sync(){syncs++;},async setAlarm(at:number){if(alarmFails)throw Error('lost-release-alarm-write');alarm=at;},async deleteAlarm(){alarm=null;}} as unknown as ProductTurnRuntimeStorage;
  const execution:TurnExecutionPort={async start(input){starts++;assert.equal(input.message,'Build model');assert.deepEqual(input.actor,actor);if(startError)throw Error('lost-start-response');const {actor:_,message:__,base:___,executionDeadlineAt:____,...runtimeIdentity}=input;return structuredClone(dynamicTerminal?terminal(runtimeIdentity):startResult);},async observe(){observes++;return structuredClone(observeResult);},async cancel(){cancels++;return structuredClone(cancelResult);},async release(){releases++;if(releaseError)throw Error('lost-release-response');return {running:releaseRunning};}};
  const receipt=():CheckpointReceipt=>({revisionId:'revision-a',objectKey:'turns/tenant-a/workspace-a/2/turn-a/dispatch-a.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1005});
  const checkpointIntent=(value:TurnRuntimeIdentity)=>({operationId:turnCheckpointOperationId(value),inputSha256:'c'.repeat(64)});
  const checkpoints:TurnCheckpointPort={async prepare(input){prepares++;return checkpointIntent(input.identity);},async commit(input,intent){commits++;assert.deepEqual(intent,checkpointIntent(input.identity));if(commitError)throw Error('lost-checkpoint-response');return receipt();},async reconcile(value,intent){checkpointObserves++;assert.deepEqual(intent,checkpointIntent(value));return structuredClone(observedCheckpoint);}};
  const host=()=>new ProductTurnRuntimeCore(storage,execution,checkpoints,()=>++now,false,releaseTiming);
  return {host,execution,get writes(){return writes;},get syncs(){return syncs;},clock(v:number){now=v;},row(){return JSON.parse(db.prepare('SELECT value FROM product_turn_runtime').get()!.value as string);},releaseRow(){const row=db.prepare('SELECT value FROM product_turn_release').get();return row?JSON.parse(row.value as string):null;},get alarm(){return alarm;},alarmFails(v:boolean){alarmFails=v;},get starts(){return starts;},get observes(){return observes;},get cancels(){return cancels;},get releases(){return releases;},get prepares(){return prepares;},get commits(){return commits;},get checkpointObserves(){return checkpointObserves;},start(v:TurnExecutionObservation){startResult=v;},dynamicTerminal(v=true){dynamicTerminal=v;},observe(v:TurnExecutionObservation){observeResult=v;},cancel(v:TurnExecutionObservation){cancelResult=v;},startError(v:boolean){startError=v;},releaseError(v:boolean){releaseError=v;},releaseRunning(v:boolean){releaseRunning=v;},commitError(v:boolean){commitError=v;},observedCheckpoint(v:CheckpointReceipt|null){observedCheckpoint=v;},sql(query:string){db.exec(query);},reopen(){db.close();db=new DatabaseSync(file);configure();}};
}

test('terminal accept reserves one execution and returns one immutable hierarchical checkpoint',async t=>{
  const f=fixture(t);f.start(terminal());const host=f.host(),first=await host.accept(request()),replay=await host.accept(request());
  assert.equal(first.phase,'terminal');assert.equal(first.outcome,'completed');assert.equal(first.checkpoint?.objectKey,'turns/tenant-a/workspace-a/2/turn-a/dispatch-a.json');assert.deepEqual(replay,first);assert.equal(f.starts,1);assert.equal(f.commits,1);
});

test('lost start response persists unknown and reopen observes without another start',async t=>{
  const f=fixture(t);f.startError(true);const host=f.host();await assert.rejects(host.accept(request()),/lost-start-response/);assert.equal(f.starts,1);
  f.reopen();f.startError(false);f.observe(terminal());const recovered=await f.host().observe(identity);assert.equal(recovered.phase,'terminal');assert.equal(recovered.outcome,'completed');assert.equal(f.starts,1);assert.equal(f.observes,1);
});

test('runtime actor and durable row bind full scope, dispatch, generation and message digest',async t=>{
  const f=fixture(t),host=f.host();await host.accept(request());
  await assert.rejects(host.accept(request('Different')),/idempotency-conflict/);
  await assert.rejects(host.accept({...request(),actor:{...actor,authVersion:2}}),/idempotency-conflict/);
  await assert.rejects(host.accept({...request(),base:{workspace:{revisionId:'revision-base',objectKey:'turns/base.json',filesSha256:'c'.repeat(64),sessionSha256:'d'.repeat(64),committedAt:1},session:null}}),/idempotency-conflict/);
  await assert.rejects(host.observe({...identity,sessionId:'session-b'}),/scope-denied/);
  await assert.rejects(host.observe({...identity,dispatchId:'dispatch-b'}),/scope-denied/);
  await assert.rejects(host.cancel({...identity,scope:{...scope,tenantId:'tenant-b'}}),/scope-denied/);
  await assert.rejects(host.observe({...identity,generation:3}),/generation-conflict/);
  assert.notEqual(await turnRuntimeActorName(identity),await turnRuntimeActorName({...identity,dispatchId:'dispatch-b'}));
  assert.notEqual(await turnRuntimeActorName(identity),await turnRuntimeActorName({...identity,sessionId:'session-b'}));
});

test('cancel fence calls native cancel once and accepts an already completed natural receipt',async t=>{
  const f=fixture(t),host=f.host();await host.accept(request());const cancelled=await host.cancel(identity);assert.equal(cancelled.outcome,'cancelled');assert.equal(f.cancels,1);
  assert.deepEqual(await host.cancel(identity),cancelled);assert.equal(f.cancels,1);
  const other=fixture(t),otherHost=other.host();await otherHost.accept(request());other.cancel(terminal(identity,'completed'));const natural=await otherHost.cancel(identity);assert.equal(natural.phase,'terminal');assert.equal(natural.outcome,'completed');assert.ok(natural.checkpoint);assert.deepEqual(await otherHost.observe(identity),natural);
});

test('a fenced cancellation reconciles an absent native execution without checkpoint allocation',async t=>{
  const f=fixture(t),host=f.host();await host.accept(request());f.cancel({identity,phase:'unknown',outcome:null});
  const first=await host.cancel(identity);assert.equal(first.phase,'unknown');assert.equal(f.cancels,1);
  f.observe({identity,phase:'absent',outcome:null});f.cancel({...terminal(identity,'interrupted'),executionErrorCode:'turn-native-execution-absent',events:[]});
  const settled=await host.observe(identity);assert.equal(settled.phase,'terminal');assert.equal(settled.outcome,'interrupted');assert.equal(settled.executionErrorCode,'turn-native-execution-absent');assert.equal(settled.persistenceErrorCode,'turn-checkpoint-unknown');
  assert.equal(f.observes,1);assert.equal(f.cancels,2);assert.equal(f.prepares,0);assert.equal(f.commits,0);assert.equal(f.checkpointObserves,0);
  assert.deepEqual(await host.observe(identity),settled);assert.equal(f.cancels,2);
});

test('checkpoint response loss reconciles immutable receipt and unresolved persistence remains observable',async t=>{
  const f=fixture(t);f.start(terminal());f.commitError(true);f.observedCheckpoint({revisionId:'revision-a',objectKey:'turns/tenant-a/workspace-a/2/turn-a/dispatch-a.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1100});const recovered=await f.host().accept(request());assert.equal(recovered.checkpoint?.revisionId,'revision-a');assert.equal(recovered.persistenceErrorCode,null);assert.equal(f.commits,1);assert.equal(f.checkpointObserves,1);
  const other=fixture(t);other.start(terminal());other.commitError(true);const unknown=await other.host().accept(request());assert.equal(unknown.checkpoint,null);assert.equal(unknown.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(unknown.outcome,'completed');
  assert.equal(other.releases,0);assert.equal((await other.host().observe(identity)).persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(other.commits,1);assert.equal(other.checkpointObserves,2);assert.equal(other.releases,0);
  other.observedCheckpoint({revisionId:'revision-a',objectKey:'turns/tenant-a/workspace-a/2/turn-a/dispatch-a.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1100});const late=await other.host().observe(identity);assert.equal(late.checkpoint?.revisionId,'revision-a');assert.equal(late.persistenceErrorCode,null);assert.equal(other.commits,1);assert.equal(other.checkpointObserves,3);
});

test('checkpoint descriptor survives reopen and prevents a second materialization attempt',async t=>{
 const f=fixture(t);f.start(terminal());f.commitError(true);const first=await f.host().accept(request());assert.equal(first.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(f.prepares,1);assert.equal(f.commits,1);
 f.reopen();f.observedCheckpoint({revisionId:'revision-a',objectKey:'turns/tenant-a/workspace-a/2/turn-a/dispatch-a.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1100});const recovered=await f.host().observe(identity);assert.equal(recovered.checkpoint?.revisionId,'revision-a');assert.equal(f.prepares,1);assert.equal(f.commits,1);assert.equal(f.checkpointObserves,2);
});

test('checkpoint commit durably precedes exact Sandbox release and requires a quiet absent observation',async t=>{
 const f=fixture(t,{retryMs:5,assignmentGuardMs:20,quietMs:10});f.start(terminal());const host=f.host(),first=await host.accept(request());
 assert.equal(first.phase,'terminal');assert.equal(f.commits,1);assert.equal(f.releases,1);assert.ok(f.row().checkpoint);const intent=f.releaseRow();assert.equal(intent.attempts,1);assert.ok(intent.absentSince);assert.equal(f.alarm,intent.nextAttemptAt);
 f.clock(Math.max(intent.begunAt+20,intent.absentSince+10));const settled=await host.observe(identity);assert.equal(settled.phase,'terminal');assert.equal(settled.checkpoint?.revisionId,'revision-a');assert.equal(f.releases,2);assert.ok(f.releaseRow().confirmedAt);assert.equal(f.alarm,null);assert.equal(f.starts,1);assert.equal(f.commits,1);
});

test('lost release response retries only destroy observation after the saved checkpoint',async t=>{
 const f=fixture(t);f.start(terminal());f.releaseError(true);const host=f.host();assert.equal((await host.accept(request())).phase,'terminal');
 assert.ok(f.row().checkpoint);assert.equal(f.releases,1);assert.equal(f.starts,1);assert.equal(f.commits,1);f.releaseError(false);f.reopen();
 const settled=await f.host().observe(identity);assert.equal(settled.phase,'terminal');assert.equal(f.releases,2);assert.equal(f.starts,1);assert.equal(f.commits,1);
});

test('release alarm is durable before intent and a failed arm performs no destroy or orphaned intent',async t=>{
 const f=fixture(t,{retryMs:5,assignmentGuardMs:20,quietMs:10});f.start(terminal());f.alarmFails(true);const host=f.host();await assert.rejects(host.accept(request()),/lost-release-alarm-write/);
 assert.ok(f.row().checkpoint);assert.equal(f.releaseRow(),null);assert.equal(f.releases,0);f.alarmFails(false);
 assert.equal((await host.observe(identity)).phase,'terminal');assert.ok(f.releaseRow());assert.equal(f.releases,1);assert.ok(f.alarm);
});

test('a running post-destroy probe stays pending and a later absent probe completes the same release',async t=>{
 const f=fixture(t);f.start(terminal());f.releaseRunning(true);const host=f.host();assert.equal((await host.accept(request())).phase,'terminal');assert.equal(f.releaseRow().absentSince,null);
 f.releaseRunning(false);const settled=await host.observe(identity);assert.equal(settled.phase,'terminal');assert.equal(f.releases,2);assert.equal(f.starts,1);
});

test('an unavailable base never allocates checkpoint materialization, including after reopen',async t=>{
 const f=fixture(t);f.start({...terminal(identity,'failed'),executionErrorCode:'turn-base-unavailable',events:[]});const first=await f.host().accept(request());assert.equal(first.phase,'terminal');assert.equal(first.outcome,'failed');assert.equal(first.executionErrorCode,'turn-base-unavailable');assert.equal(first.checkpoint,null);assert.equal(first.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(f.prepares,0);assert.equal(f.commits,0);assert.equal(f.checkpointObserves,0);
 assert.equal(f.releases,0);f.reopen();const replay=await f.host().observe(identity);assert.deepEqual(replay,first);assert.equal(f.prepares,0);assert.equal(f.commits,0);assert.equal(f.checkpointObserves,0);assert.equal(f.releases,0);
});

test('legacy checkpoint reservation without an exact descriptor remains fail closed',async t=>{
 const f=fixture(t);f.start(terminal());const completed=await f.host().accept(request());assert.ok(completed.checkpoint);f.sql("UPDATE product_turn_runtime SET value=json_set(value,'$.schemaVersion',1,'$.checkpointReserved',json('true'),'$.checkpoint',json('null'))");f.sql("UPDATE product_turn_runtime SET value=json_remove(value,'$.checkpointIntent','$.checkpointCommitReserved','$.legacyCheckpointUnknown','$.executionDeadlineAt')");
 f.reopen();const unknown=await f.host().observe(identity);assert.equal(unknown.checkpoint,null);assert.equal(unknown.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(f.prepares,1);assert.equal(f.commits,1);
});

test('running events replay stably and conflicting event ids fail closed',async t=>{
  const f=fixture(t),host=f.host(),running=await host.accept(request());assert.deepEqual(running.events,[event]);f.observe({identity,phase:'running',outcome:null,events:[event]});assert.deepEqual((await host.observe(identity)).events,[event]);
  f.observe({identity,phase:'running',outcome:null,events:[{...event,payload:{text:'changed'}}]});await assert.rejects(host.observe(identity),/event-conflict/);
});

test('runtime rejects event and stop times outside the observed execution window',async t=>{
  const early=fixture(t);early.start({identity,phase:'running',outcome:null,events:[{...event,at:999}]});await assert.rejects(early.host().accept(request()),/event-time/);
  const future=fixture(t);future.start({identity,phase:'running',outcome:null,events:[{...event,at:9999}]});await assert.rejects(future.host().accept(request()),/event-time/);
  const stoppedEarly=fixture(t);stoppedEarly.start({...terminal(),stopped:{...stop,observedAt:999}});await assert.rejects(stoppedEarly.host().accept(request()),/stop-time/);
  const stoppedFuture=fixture(t);stoppedFuture.start({...terminal(),stopped:{...stop,observedAt:9999}});await assert.rejects(stoppedFuture.host().accept(request()),/stop-time/);
});
test('runtime rejects a claimed base from the future before reserving execution',async t=>{
  const f=fixture(t),future={revisionId:'revision-future',objectKey:'turns/future.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:9999};
  await assert.rejects(f.host().accept({...request(),base:{workspace:future,session:null}}),/base-time/);assert.equal(f.starts,0);
});

test('runtime bounds cumulative durable event count and bytes before SQLite write',async t=>{
  const count=fixture(t),events=Array.from({length:productTurnRuntimeLimits.maxEvents+1},(_,i)=>({eventId:`event-${i}`,type:'assistant.delta' as const,at:1002,payload:{text:'x'}}));count.start({identity,phase:'running',outcome:null,events});await assert.rejects(count.host().accept(request()),/event-limit/);
  const bytes=fixture(t),large=Array.from({length:150},(_,i)=>({eventId:`large-${i}`,type:'assistant.delta' as const,at:1002,payload:{text:'x'.repeat(15000)}}));bytes.start({identity,phase:'running',outcome:null,events:large});await assert.rejects(bytes.host().accept(request()),/event-limit/);
});

test('corrupted durable runtime state fails closed before native observation',async t=>{
  const f=fixture(t),host=f.host();await host.accept(request());f.sql("UPDATE product_turn_runtime SET value='{}'");await assert.rejects(host.observe(identity),/invalid-persisted/);assert.equal(f.observes,0);
});

test('product runtime completes the existing dispatcher contract without a model call',async t=>{
  const f=fixture(t);f.dynamicTerminal();const journal=new TurnJournal(new MemoryTurnStore(),(()=>{let n=999;return()=>++n;})()),session=(await journal.createSession(scope,actor,'session-key',{title:'Session'})).session;await journal.submit(scope,actor,session.id,'turn-key',{message:'Build model'});
  const result=await new TurnDispatcher(journal,f.host()).tick(scope,2);assert.equal(result?.status,'completed');assert.equal(result?.persistenceOutcome,'saved');assert.equal(f.starts,1);
});

test('product runtime module imports no Pi SDK, provider, network or M0 probe implementation',()=>{
  const source=readFileSync(new URL('../../services/turn-runtime/core.ts',import.meta.url),'utf8'),imports=source.split('\n').filter(line=>line.startsWith('import ')).join('\n');assert.doesNotMatch(imports,/pi-coding-agent|pi-server|fetch|provider|m0-/i);
});


test('observer deadline persists across replay and reopen; authority performs zero durable writes or reconciliation',async t=>{
 const f=fixture(t),host=f.host();let deadline:number|undefined;const start=f.execution.start;f.execution.start=async input=>{deadline=input.executionDeadlineAt;return start(input);};
 await host.accept(request());assert.equal(deadline,601001);const before=f.row();assert.equal(before.schemaVersion,3);let queries=0;f.execution.currentObserverExecution=async id=>{assert.deepEqual(id,identity);queries++;return {expiresAt:deadline!};};
 const operations=[f.starts,f.observes,f.prepares,f.commits,f.writes,f.syncs];assert.deepEqual(await host.currentObserverExecution(identity),{expiresAt:deadline});assert.deepEqual(f.row(),before);assert.deepEqual([f.starts,f.observes,f.prepares,f.commits,f.writes,f.syncs],operations);
 f.reopen();const recovered=f.host();assert.deepEqual(await recovered.currentObserverExecution(identity),{expiresAt:deadline});await recovered.accept(request());assert.equal(f.starts,1);assert.equal(f.row().executionDeadlineAt,deadline);assert.equal(queries,2);
});

test('observer authority denies absent, legacy, unknown, terminal, cancelled and mismatched identities',async t=>{
 for(const kind of ['absent','legacy','unknown','terminal','cancelled','identity']){
  const f=fixture(t),host=f.host();let queried=0;f.execution.currentObserverExecution=async()=>{queried++;return {expiresAt:601001};};
  if(kind!=='absent')await host.accept(request());
  if(kind==='legacy')f.sql("UPDATE product_turn_runtime SET value=json_remove(json_set(value,'$.schemaVersion',2),'$.executionDeadlineAt')");
  if(kind==='unknown')f.sql("UPDATE product_turn_runtime SET value=json_set(value,'$.phase','unknown')");
  if(kind==='terminal')await host.cancel(identity);
  if(kind==='cancelled')f.sql("UPDATE product_turn_runtime SET value=json_set(value,'$.cancelRequestedAt',1002)");
  const before=kind==='absent'?null:f.row();await assert.rejects(host.currentObserverExecution(kind==='identity'?{...identity,dispatchId:'other'}:identity));assert.equal(queried,0);if(before)assert.deepEqual(f.row(),before);
  if(kind==='legacy'){await host.observe(identity);assert.equal(f.row().schemaVersion,2);assert.equal(f.row().executionDeadlineAt,undefined);}
 }
});

test('observer authority rejects missing native query, expiry mismatch and cancellation or deadline during await',async t=>{
 for(const kind of ['missing','mismatch','expired','late-expiry','late-cancel']){
  const f=fixture(t),host=f.host();await host.accept(request());
  if(kind==='expired')f.clock(601001);
  if(kind!=='missing')f.execution.currentObserverExecution=async()=>{if(kind==='late-expiry')f.clock(601001);if(kind==='late-cancel')await host.cancel(identity);return {expiresAt:kind==='mismatch'?601002:601001};};
  await assert.rejects(host.currentObserverExecution(identity),/observer-denied/);
 }
});

test('schema 3 invalid absolute deadline fails closed before native calls',async t=>{
 const f=fixture(t),host=f.host();await host.accept(request());f.sql("UPDATE product_turn_runtime SET value=json_set(value,'$.executionDeadlineAt',700000)");let queried=false;f.execution.currentObserverExecution=async()=>{queried=true;return {expiresAt:700000};};await assert.rejects(host.currentObserverExecution(identity),/invalid-persisted/);assert.equal(queried,false);
});
