import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import { ProductTurnRuntimeCore, productTurnRuntimeLimits, turnCheckpointOperationId, type ProductTurnReleaseTiming, type ProductTurnRuntimeStorage, type TurnCheckpointPort, type TurnCheckpointResolution, type TurnExecutionObservation, type TurnExecutionPort } from '../../services/turn-runtime/core.ts';
import { turnRuntimeActorName, type TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';
import { TurnDispatcher } from '../../services/turn/dispatcher.ts';
import { TurnJournal } from '../../services/turn/journal.ts';
import { MemoryTurnStore } from '../../services/turn/store.ts';
import type { CheckpointReceipt, TurnScope } from '../../services/turn/protocol.ts';
import type { TurnOperationTelemetryEvent, TurnOperationTrace } from '../../services/turn/operation-telemetry.ts';
import type { TrustedPiCapacityPort } from '../../services/capacity/client.ts';

const scope:TurnScope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2};
const identity:TurnRuntimeIdentity={scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2};
const actor={userId:'user-a',authVersion:1};
const base={workspace:null,session:null};
const request=(message='Build model')=>({...identity,actor,message,base});
const stop={confirmationId:'stop-a',observedAt:1002,nativeRunning:false as const,fenced:true as const};
const event={eventId:'event-a',type:'assistant.message' as const,at:1002,payload:{text:'fixture result'}};
const terminal=(id:TurnRuntimeIdentity=identity,outcome:'completed'|'failed'|'cancelled'|'interrupted'='completed'):TurnExecutionObservation=>({identity:id,phase:'terminal',outcome,executionErrorCode:outcome==='completed'?null:'fixture-failure',events:[event],stopped:stop});

function fixture(t:TestContext,releaseTiming:Partial<ProductTurnReleaseTiming>={retryMs:0,assignmentGuardMs:0,quietMs:0},capacity:TrustedPiCapacityPort|null=null,trace?:TurnOperationTrace){
  const dir=mkdtempSync(join(tmpdir(),'m2-turn-runtime-')),file=join(dir,'state.db'),telemetry:TurnOperationTelemetryEvent[]=[];t.after(()=>rmSync(dir,{recursive:true,force:true}));let db=new DatabaseSync(file),now=1000,starts=0,observes=0,cancels=0,fences=0,releases=0,prepares=0,commits=0,checkpointObserves=0,abandons=0,writes=0,syncs=0,releaseError=false,projectReleaseError=false,releaseRunning=false,fenceUnknown=false,alarmCalls=0,alarmFailsAfter:number|null=null,alarm:number|null=null,abandonStatus:'committed'|'aborted'|'pending'|'unavailable'|'conflict'='aborted';
  let startResult:TurnExecutionObservation={identity,phase:'running',outcome:null,events:[event]},observeResult:TurnExecutionObservation={identity,phase:'running',outcome:null},cancelResult:TurnExecutionObservation=terminal(identity,'cancelled'),cancelWait:Promise<void>|null=null,fenceWait:Promise<void>|null=null,startError=false,dynamicTerminal=false,prepareError=false,commitError=false,commitAbsent=false,observedCheckpoint:CheckpointReceipt|null=null;
  const configure=()=>db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');configure();
  const storage={sql:{exec(query:string,...bindings:(string|number|null)[]){if(!query.startsWith('SELECT'))writes++;if(query.includes('CREATE TABLE')){db.exec(query);return {toArray:()=>[]};}const statement=db.prepare(query),rows=statement.columns().length?statement.all(...bindings):(statement.run(...bindings),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}},async sync(){syncs++;},async setAlarm(at:number){alarmCalls++;if(alarmFailsAfter!==null&&alarmCalls>alarmFailsAfter)throw Error('lost-release-alarm-write');alarm=at;},async deleteAlarm(){alarm=null;}} as unknown as ProductTurnRuntimeStorage;
  const execution:TurnExecutionPort={async start(input){starts++;assert.equal(input.message,'Build model');assert.deepEqual(input.actor,actor);if(startError)throw Error('lost-start-response');const {actor:_,message:__,base:___,executionDeadlineAt:____,...runtimeIdentity}=input;return structuredClone(dynamicTerminal?terminal(runtimeIdentity):startResult);},async observe(){observes++;return structuredClone(observeResult);},async cancel(){cancels++;if(cancelWait)await cancelWait;return structuredClone(cancelResult);},async fenceUnresolvedStart(id,outcome){fences++;assert.deepEqual(id,identity);if(fenceWait)await fenceWait;return fenceUnknown?{identity:id,phase:'unknown',outcome:null}:{...terminal(id,outcome),executionErrorCode:'turn-native-start-unresolved',events:[]};},async release(){releases++;if(projectReleaseError)throw Error('project-workspace-release-unconfirmed');if(releaseError)throw Error('lost-release-response');return {running:releaseRunning};}};
  const receipt=():CheckpointReceipt=>({revisionId:'revision-a',objectKey:'turns/tenant-a/workspace-a/2/turn-a/dispatch-a.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:Math.max(1005,now+1)});
  const checkpointIntent=(value:TurnRuntimeIdentity)=>({operationId:turnCheckpointOperationId(value),inputSha256:'c'.repeat(64)});
  const checkpoints:TurnCheckpointPort={async prepare(input){prepares++;if(prepareError)throw Error('checkpoint-prepare-unavailable');return checkpointIntent(input.identity);},async commit(input,intent){commits++;assert.deepEqual(intent,checkpointIntent(input.identity));if(commitError)throw Error('lost-checkpoint-response');if(commitAbsent)return {status:'absent'};return {status:'committed',receipt:receipt()};},async reconcile(value,intent){checkpointObserves++;assert.deepEqual(intent,checkpointIntent(value));return structuredClone(observedCheckpoint?{status:'committed',receipt:observedCheckpoint}:{status:'absent'}) as TurnCheckpointResolution;},async abandon(value,intent){abandons++;assert.deepEqual(intent,checkpointIntent(value));return abandonStatus==='committed'?{status:'committed',receipt:receipt()}:{status:abandonStatus};}};
  const host=(retention:any=null)=>new ProductTurnRuntimeCore(storage,execution,checkpoints,()=>++now,false,releaseTiming,capacity,trace??(event=>telemetry.push(event)),retention);
  return {host,execution,telemetry,get writes(){return writes;},get syncs(){return syncs;},get currentTime(){return now;},clock(v:number){now=v;},row(){return JSON.parse(db.prepare('SELECT value FROM product_turn_runtime').get()!.value as string);},runtimeRow(){const row=db.prepare('SELECT value FROM product_turn_runtime').get();return row?JSON.parse(row.value as string):null;},releaseRow(){const row=db.prepare('SELECT value FROM product_turn_release').get();return row?JSON.parse(row.value as string):null;},recoveryRow(){const row=db.prepare("SELECT value FROM product_turn_checkpoint_recovery WHERE singleton=1").get();return row?JSON.parse(row.value as string):null;},setRecovery(value:unknown){db.prepare('UPDATE product_turn_checkpoint_recovery SET value=? WHERE singleton=1').run(JSON.stringify(value));},get alarm(){return alarm;},alarmFails(v:boolean){alarmFailsAfter=v?alarmCalls+2:null;},get starts(){return starts;},get observes(){return observes;},get cancels(){return cancels;},get fences(){return fences;},get releases(){return releases;},get prepares(){return prepares;},get commits(){return commits;},get checkpointObserves(){return checkpointObserves;},get abandons(){return abandons;},abandonStatus(v:typeof abandonStatus){abandonStatus=v;},start(v:TurnExecutionObservation){startResult=v;},dynamicTerminal(v=true){dynamicTerminal=v;},observe(v:TurnExecutionObservation){observeResult=v;},cancel(v:TurnExecutionObservation){cancelResult=v;},waitCancel(v:Promise<void>|null){cancelWait=v;},waitFence(v:Promise<void>|null){fenceWait=v;},startError(v:boolean){startError=v;},fenceUnknown(v:boolean){fenceUnknown=v;},prepareError(v:boolean){prepareError=v;},releaseError(v:boolean){releaseError=v;},projectReleaseError(v:boolean){projectReleaseError=v;},releaseRunning(v:boolean){releaseRunning=v;},commitError(v:boolean){commitError=v;},commitAbsent(v:boolean){commitAbsent=v;},observedCheckpoint(v:CheckpointReceipt|null){observedCheckpoint=v;},sql(query:string){db.exec(query);},reopen(){db.close();db=new DatabaseSync(file);configure();}};
}

function capacityFixture(){
  const calls:string[]=[],lease={operationId:'capacity-operation-a',leaseId:'capacity-lease-a'},ticket={tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,sessionId:identity.sessionId,operationId:lease.operationId,turnId:identity.turnId,generation:identity.generation,ticketId:'capacity-ticket-a',leaseId:lease.leaseId,dispatchId:null as string|null,status:'held' as 'held'|'dispatched'|'released'|'cancelled',requestedAt:900,acquiredAt:901,dispatchedAt:null as number|null,finishedAt:null as number|null};let loseDispatch=false;
  const capacity={
    async lookup(){calls.push('capacity.lookup');return {outcome:'replayed' as const,ticket:structuredClone(ticket)};},
    async dispatch(reference:any){calls.push('capacity.dispatch');assert.equal(reference.dispatchId,identity.dispatchId);ticket.status='dispatched';ticket.dispatchId=identity.dispatchId;ticket.dispatchedAt=902;if(loseDispatch)throw Error('lost-capacity-dispatch-response');return {authorized:true,ticket:structuredClone(ticket)};},
    async confirmReleased(reference:any,proof:any){calls.push('capacity.confirmReleased');assert.equal(reference.dispatchId,identity.dispatchId);assert.equal(proof.kind,'runtime-released');assert.equal(proof.proofId,lease.leaseId);ticket.status='released';ticket.finishedAt=proof.observedAt;return {changed:true,ticket:structuredClone(ticket),next:null};},
  } as unknown as TrustedPiCapacityPort;
  return {capacity,lease,ticket,calls,loseDispatch(value=true){loseDispatch=value;}};
}

test('terminal accept reserves one execution and returns one immutable hierarchical checkpoint',async t=>{
  const f=fixture(t);f.start(terminal());const host=f.host(),first=await host.accept(request()),replay=await host.accept(request());
  assert.equal(first.phase,'terminal');assert.equal(first.outcome,'completed');assert.equal(first.checkpoint?.objectKey,'turns/tenant-a/workspace-a/2/turn-a/dispatch-a.json');assert.deepEqual(replay,first);assert.equal(f.starts,1);assert.equal(f.commits,1);
});

test('known absent commit enters restart-safe reconcile without requiring the in-memory snapshot',async t=>{
  const f=fixture(t);f.start(terminal());f.commitAbsent(true);const host=f.host(),waiting=await host.accept(request()),recovery=f.recoveryRow();assert.equal(waiting.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(recovery.stage,'reconcile');assert.equal(f.row().checkpointCommitReserved,true);assert.equal(f.commits,1);assert.equal(f.checkpointObserves,0);
  f.reopen();f.observedCheckpoint({revisionId:'revision-a',objectKey:'turns/tenant-a/workspace-a/2/turn-a/dispatch-a.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1100});f.clock(recovery.nextAttemptAt-1);const saved=await f.host().observe(identity);assert.ok(saved.checkpoint);assert.equal(f.commits,1);assert.equal(f.checkpointObserves,1);
});

test('capacity dispatch is confirmed before native start and exact release proof frees the same lease',async t=>{
  const c=capacityFixture(),f=fixture(t,{retryMs:0,assignmentGuardMs:0,quietMs:0},c.capacity);f.start(terminal());const saved=await f.host().accept({...request(),capacityLease:c.lease});
  assert.equal(f.starts,1);assert.deepEqual(c.calls,['capacity.lookup','capacity.dispatch','capacity.lookup','capacity.confirmReleased']);assert.deepEqual(saved.resourceDisposition,{status:'released',operationId:c.lease.operationId,leaseId:c.lease.leaseId,turnId:identity.turnId,dispatchId:identity.dispatchId,generation:identity.generation,proofId:c.lease.leaseId,releasedAt:c.ticket.finishedAt});
});

test('lost capacity dispatch response recovers only by lookup and starts Pi once',async t=>{
  const c=capacityFixture(),f=fixture(t,{retryMs:0,assignmentGuardMs:0,quietMs:0},c.capacity),host=f.host();c.loseDispatch();await assert.rejects(host.accept({...request(),capacityLease:c.lease}),/lost-capacity-dispatch-response/);assert.equal(f.starts,0);assert.equal(c.ticket.status,'dispatched');
  c.loseDispatch(false);f.reopen();const recovered=await f.host().observe(identity);assert.equal(recovered.phase,'running');assert.equal(f.starts,1);assert.equal(c.calls.filter(call=>call==='capacity.dispatch').length,1);assert.equal(c.calls.filter(call=>call==='capacity.lookup').length,2);
});

test('capacity ticket identity mismatch is rejected before native start',async t=>{
  const c=capacityFixture();c.ticket.generation=1;const f=fixture(t,{retryMs:0,assignmentGuardMs:0,quietMs:0},c.capacity);
  await assert.rejects(f.host().accept({...request(),capacityLease:c.lease}),/capacity-scope-denied/);assert.equal(f.starts,0);assert.equal(c.calls.includes('capacity.dispatch'),false);
});

test('late accept after exact capacity cancellation leaves no orphan Runtime row',async t=>{
  const c=capacityFixture();c.ticket.status='cancelled';c.ticket.finishedAt=999;const f=fixture(t,{retryMs:0,assignmentGuardMs:0,quietMs:0},c.capacity),host=f.host();
  await assert.rejects(host.accept({...request(),capacityLease:c.lease}),/capacity-dispatch-unconfirmed/);assert.equal(f.starts,0);assert.equal(f.runtimeRow(),null);
  const absent=await f.host().observe({...identity,capacityLease:c.lease});assert.equal(absent.phase,'absent');assert.deepEqual({operationId:absent.resourceDisposition.operationId,leaseId:absent.resourceDisposition.leaseId,status:absent.resourceDisposition.status},{...c.lease,status:'released'});
});

test('lost start response persists unknown and reopen observes without another start',async t=>{
  const f=fixture(t);f.startError(true);const host=f.host();await assert.rejects(host.accept(request()),/lost-start-response/);assert.equal(f.starts,1);
  f.reopen();f.startError(false);f.observe(terminal());const recovered=await f.host().observe(identity);assert.equal(recovered.phase,'terminal');assert.equal(recovered.outcome,'completed');assert.equal(f.starts,1);assert.equal(f.observes,1);
});
test('schema 4 runtime migrates conservatively and preserves exact identity without another start',async t=>{
 const f=fixture(t),host=f.host();await host.accept(request());f.sql("UPDATE product_turn_runtime SET value=json_remove(json_set(value,'$.schemaVersion',4),'$.nativeProcessObservedAt','$.nativeStartFenceReserved')");f.reopen();f.observe({identity,phase:'running',outcome:null});const recovered=await f.host().observe(identity);assert.equal(recovered.phase,'running');assert.equal(f.starts,1);assert.equal(f.observes,1);assert.equal(f.fences,0);assert.equal(f.row().schemaVersion,5);assert.ok(f.row().nativeProcessObservedAt);await assert.rejects(f.host().observe({...identity,dispatchId:'dispatch-b'}),/scope-denied/);assert.equal(f.observes,1);
});
test('unobservable native start stays fail closed until its fixed deadline then fences without checkpoint allocation',async t=>{
 const f=fixture(t),host=f.host();f.startError(true);await assert.rejects(host.accept(request()),/lost-start-response/);const deadline=f.row().executionDeadlineAt;assert.equal(f.row().nativeStartReserved,true);assert.equal(f.row().nativeProcessObservedAt,null);assert.equal(f.fences,0);
 f.observe({identity,phase:'unknown',outcome:null});f.clock(deadline-2);const waiting=await host.observe(identity);assert.equal(waiting.phase,'unknown');assert.equal(f.observes,1);assert.equal(f.fences,0);assert.equal(f.starts,1);
 f.reopen();f.clock(deadline-1);const ended=await f.host().observe(identity);assert.equal(ended.phase,'terminal');assert.equal(ended.outcome,'failed');assert.equal(ended.executionErrorCode,'turn-native-start-unresolved');assert.equal(ended.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(ended.stopped?.fenced,true);assert.equal(f.fences,1);assert.equal(f.starts,1);assert.equal(f.prepares,0);assert.equal(f.commits,0);assert.equal(f.row().nativeStartFenceReserved,true);
 assert.deepEqual(f.telemetry.map(({metric,stage,reasonCategory,value,correlationId})=>({metric,stage,reasonCategory,value,correlationId})),[{metric:'native_start_fence',stage:'native-start',reasonCategory:'native_start_unresolved',value:1,correlationId:'legacy'}]);
 assert.deepEqual(await f.host().observe(identity),ended);assert.equal(f.fences,1);
});

test('a previously observed execution becomes execution-unresolved at its fixed deadline without checkpoint allocation',async t=>{
 const f=fixture(t),host=f.host();await host.accept(request());const deadline=f.row().executionDeadlineAt;assert.ok(f.row().nativeProcessObservedAt);f.observe({identity,phase:'unknown',outcome:null});
 f.clock(deadline-2);const waiting=await host.observe(identity);assert.equal(waiting.phase,'unknown');assert.equal(f.observes,1);assert.equal(f.fences,0);
 f.reopen();f.clock(deadline-1);const ended=await f.host().observe(identity);assert.equal(ended.phase,'terminal');assert.equal(ended.outcome,'failed');assert.equal(ended.executionErrorCode,'turn-native-execution-unresolved');assert.equal(ended.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(ended.checkpoint,null);assert.equal(ended.stopped?.fenced,true);assert.equal(f.fences,1);assert.equal(f.starts,1);assert.equal(f.prepares,0);assert.equal(f.commits,0);assert.equal(f.row().nativeStartFenceReserved,true);assert.ok(f.row().nativeProcessObservedAt);
 assert.deepEqual(f.telemetry.map(({metric,stage,reasonCategory,value})=>({metric,stage,reasonCategory,value})),[{metric:'native_execution_fence',stage:'native-execution',reasonCategory:'native_execution_unresolved',value:1}]);
 assert.deepEqual(await f.host().observe(identity),ended);assert.equal(f.fences,1);
});

test('an unconfirmed execution deadline fence stays unknown across reopen and retries the exact actor',async t=>{
 const f=fixture(t),host=f.host();await host.accept(request());const deadline=f.row().executionDeadlineAt;f.fenceUnknown(true);f.clock(deadline-1);const waiting=await host.observe(identity);assert.equal(waiting.phase,'unknown');assert.equal(waiting.executionErrorCode,null);assert.equal(f.fences,1);assert.equal(f.prepares,0);assert.equal(f.row().nativeStartFenceReserved,true);assert.ok(f.row().nativeProcessObservedAt);
 f.reopen();f.fenceUnknown(false);f.clock(deadline);const ended=await f.host().observe(identity);assert.equal(ended.phase,'terminal');assert.equal(ended.executionErrorCode,'turn-native-execution-unresolved');assert.equal(ended.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(ended.checkpoint,null);assert.equal(f.fences,2);assert.equal(f.starts,1);assert.equal(f.prepares,0);assert.equal(f.commits,0);
 assert.deepEqual(f.telemetry.map(({metric,reasonCategory,value})=>({metric,reasonCategory,value})),[{metric:'native_execution_fence',reasonCategory:'native_execution_unresolved',value:0},{metric:'native_execution_fence',reasonCategory:'native_execution_unresolved',value:1}]);
});

test('concurrent deadline observations coalesce one exact execution fence',async t=>{
 const f=fixture(t),host=f.host();await host.accept(request());const deadline=f.row().executionDeadlineAt;let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});f.waitFence(blocked);f.clock(deadline-1);const first=host.observe(identity);for(let attempt=0;attempt<20&&f.fences===0;attempt++)await new Promise(resolve=>setTimeout(resolve,1));const follower=host.observe(identity);assert.equal(f.fences,1);release();const [a,b]=await Promise.all([first,follower]);assert.equal(a.executionErrorCode,'turn-native-execution-unresolved');assert.deepEqual(b,a);assert.equal(f.fences,1);assert.equal(f.prepares,0);assert.equal(f.commits,0);
});

test('Stop on a previously observed execution preserves interrupted through the deadline fence',async t=>{
 const f=fixture(t),host=f.host();await host.accept(request());const deadline=f.row().executionDeadlineAt;f.cancel({identity,phase:'unknown',outcome:null});const waiting=await host.cancel(identity);assert.equal(waiting.phase,'unknown');assert.equal(f.cancels,1);assert.equal(f.fences,0);
 f.reopen();f.clock(deadline-1);const ended=await f.host().cancel(identity);assert.equal(ended.phase,'terminal');assert.equal(ended.outcome,'interrupted');assert.equal(ended.executionErrorCode,'turn-native-execution-unresolved');assert.equal(ended.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(ended.checkpoint,null);assert.equal(f.fences,1);assert.equal(f.cancels,1);assert.equal(f.prepares,0);assert.equal(f.commits,0);
});

test('Stop on an unresolved native start settles interrupted at the same deadline and Project uncertainty holds release',async t=>{
 const f=fixture(t,{retryMs:0,assignmentGuardMs:0,quietMs:0,holdRetryMs:60}),host=f.host();f.startError(true);await assert.rejects(host.accept(request()),/lost-start-response/);const deadline=f.row().executionDeadlineAt;f.cancel({identity,phase:'unknown',outcome:null});const stopping=await host.cancel(identity);assert.equal(stopping.phase,'unknown');assert.equal(f.cancels,1);assert.equal(f.fences,0);
 f.projectReleaseError(true);f.clock(deadline-1);const held=await host.observe(identity);assert.equal(held.outcome,'interrupted');assert.equal(held.executionErrorCode,'turn-native-start-unresolved');assert.equal(held.resourceDisposition.status,'recovery-hold');assert.equal(f.releaseRow().reasonCode,'project-workspace-release-unconfirmed');assert.equal(f.prepares,0);assert.equal(f.fences,1);
 assert.deepEqual(f.telemetry.map(({metric,stage,reasonCategory,value})=>({metric,stage,reasonCategory,value})),[{metric:'release_result',stage:'release',reasonCategory:'project_cleanup_unconfirmed',value:0},{metric:'native_start_fence',stage:'native-start',reasonCategory:'native_start_unresolved',value:1}]);
 const retry=f.releaseRow().nextAttemptAt;f.projectReleaseError(false);f.clock(retry-1);const released=await host.observe(identity);assert.equal(released.resourceDisposition.status,'released');assert.equal(f.fences,1);assert.equal(f.starts,1);
});

test('a throwing operation telemetry sink cannot change unresolved-start terminal state',async t=>{
 const f=fixture(t,{retryMs:0,assignmentGuardMs:0,quietMs:0},null,()=>{throw Error('telemetry-must-not-escape');}),host=f.host();f.startError(true);await assert.rejects(host.accept(request()),/lost-start-response/);const deadline=f.row().executionDeadlineAt;f.clock(deadline-1);
 const ended=await host.observe(identity);assert.equal(ended.phase,'terminal');assert.equal(ended.executionErrorCode,'turn-native-start-unresolved');assert.equal(f.fences,1);
});

test('a throwing operation telemetry sink cannot prevent Project recovery hold',async t=>{
 const f=fixture(t,{retryMs:0,assignmentGuardMs:0,quietMs:0,holdRetryMs:60},null,()=>{throw Error('telemetry-must-not-escape');}),host=f.host();f.start(terminal());f.projectReleaseError(true);
 const ended=await host.accept(request());assert.equal(ended.phase,'terminal');assert.equal(ended.resourceDisposition.status,'recovery-hold');assert.equal(f.releaseRow().reasonCode,'project-workspace-release-unconfirmed');
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

test('concurrent Runtime cancel calls coalesce while crash recovery can replay the exact lower-level fence',async t=>{
  const f=fixture(t),host=f.host();await host.accept(request());let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});f.waitCancel(blocked);
  const first=host.cancel(identity);for(let attempt=0;attempt<20&&f.cancels===0;attempt++)await new Promise(resolve=>setTimeout(resolve,1));const follower=host.cancel(identity);
  assert.equal(f.cancels,1);release();const [a,b]=await Promise.all([first,follower]);assert.equal(a.outcome,'cancelled');assert.deepEqual(b,a);assert.equal(f.cancels,1);assert.equal(f.observes,0);
});

test('a nonterminal Stop observation is retried after Runtime reopen until the durable native fence proves terminal',async t=>{
  const f=fixture(t),host=f.host();await host.accept(request());f.cancel({identity,phase:'running',outcome:null});assert.equal((await host.cancel(identity)).phase,'running');assert.equal(f.cancels,1);
  f.reopen();f.cancel(terminal(identity,'cancelled'));assert.equal((await f.host().cancel(identity)).outcome,'cancelled');assert.equal(f.cancels,2);
});

test('a fenced cancellation reconciles an absent native execution without checkpoint allocation',async t=>{
  const f=fixture(t),host=f.host();await host.accept(request());f.cancel({identity,phase:'unknown',outcome:null});
  const first=await host.cancel(identity);assert.equal(first.phase,'unknown');assert.equal(f.cancels,1);
  f.observe({identity,phase:'absent',outcome:null});f.cancel({...terminal(identity,'interrupted'),executionErrorCode:'turn-native-execution-absent',events:[]});
  const settled=await host.observe(identity);assert.equal(settled.phase,'terminal');assert.equal(settled.outcome,'interrupted');assert.equal(settled.executionErrorCode,'turn-native-execution-absent');assert.equal(settled.persistenceErrorCode,'turn-checkpoint-unknown');
  assert.equal(f.observes,0);assert.equal(f.cancels,2);assert.equal(f.prepares,0);assert.equal(f.commits,0);assert.equal(f.checkpointObserves,0);
  assert.deepEqual(await host.observe(identity),settled);assert.equal(f.cancels,2);
});

test('checkpoint response loss reconciles immutable receipt and unresolved persistence remains observable',async t=>{
  const f=fixture(t);f.start(terminal());f.commitError(true);f.observedCheckpoint({revisionId:'revision-a',objectKey:'turns/tenant-a/workspace-a/2/turn-a/dispatch-a.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1100});const host=f.host(),pending=await host.accept(request()),retry=f.recoveryRow();assert.equal(pending.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(f.checkpointObserves,0);assert.equal((await host.observe(identity)).checkpoint,null);assert.equal(f.checkpointObserves,0);f.clock(retry.nextAttemptAt-1);const recovered=await host.observe(identity);assert.equal(recovered.checkpoint?.revisionId,'revision-a');assert.equal(recovered.persistenceErrorCode,null);assert.equal(f.commits,1);assert.equal(f.checkpointObserves,1);
  const other=fixture(t);other.start(terminal());other.commitError(true);const unknown=await other.host().accept(request());assert.equal(unknown.checkpoint,null);assert.equal(unknown.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(unknown.outcome,'completed');
  assert.equal(other.releases,0);assert.equal((await other.host().observe(identity)).persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(other.commits,1);assert.equal(other.checkpointObserves,0);assert.equal(other.releases,0);
  let next=other.recoveryRow();other.clock(next.nextAttemptAt-1);await other.host().observe(identity);assert.equal(other.checkpointObserves,1);other.observedCheckpoint({revisionId:'revision-a',objectKey:'turns/tenant-a/workspace-a/2/turn-a/dispatch-a.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1100});next=other.recoveryRow();other.clock(next.nextAttemptAt-1);const late=await other.host().observe(identity);assert.equal(late.checkpoint?.revisionId,'revision-a');assert.equal(late.persistenceErrorCode,null);assert.equal(other.commits,1);assert.equal(other.checkpointObserves,2);
});

test('checkpoint descriptor survives reopen and prevents a second materialization attempt',async t=>{
 const f=fixture(t);f.start(terminal());f.commitError(true);const first=await f.host().accept(request());assert.equal(first.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(f.prepares,1);assert.equal(f.commits,1);
 const retry=f.recoveryRow();f.reopen();f.observedCheckpoint({revisionId:'revision-a',objectKey:'turns/tenant-a/workspace-a/2/turn-a/dispatch-a.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1100});assert.equal((await f.host().observe(identity)).checkpoint,null);assert.equal(f.checkpointObserves,0);f.clock(retry.nextAttemptAt-1);const recovered=await f.host().observe(identity);assert.equal(recovered.checkpoint?.revisionId,'revision-a');assert.equal(f.prepares,1);assert.equal(f.commits,1);assert.equal(f.checkpointObserves,1);
});

test('checkpoint recovery has a two minute user deadline and persists exact abandonment',async t=>{
 const f=fixture(t);f.start(terminal());f.commitError(true);const host=f.host(),first=await host.accept(request()),recovery=f.recoveryRow();assert.equal(first.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(recovery.schemaVersion,2);assert.equal(recovery.stage,'reconcile');assert.equal(recovery.deadlineAt,f.row().settledAt+120000);assert.ok(recovery.nextAttemptAt<=recovery.deadlineAt);
 f.clock(recovery.deadlineAt-1);const ended=await host.observe(identity);assert.equal(ended.persistenceErrorCode,'turn-checkpoint-aborted');assert.equal(f.abandons,1);assert.equal(f.recoveryRow(),null);
});

test('legacy checkpoint recovery normalizes its deadline to the persisted terminal boundary',async t=>{
 const f=fixture(t);f.start(terminal());f.commitError(true);await f.host().accept(request());const runtime=f.row(),current=f.recoveryRow(),firstFailedAt=runtime.settledAt+5000;
 f.setRecovery({schemaVersion:1,operationId:current.operationId,firstFailedAt,attempts:current.attempts,lastErrorCode:current.lastReason,nextAttemptAt:firstFailedAt+1000,deadlineAt:firstFailedAt+120000});
 f.reopen();const migratedDeadline=runtime.settledAt+120000;f.clock(migratedDeadline-1);const ended=await f.host().observe(identity);assert.equal(ended.persistenceErrorCode,'turn-checkpoint-aborted');assert.equal(f.recoveryRow(),null);assert.equal(f.abandons,1);
});

test('unavailable abandonment ends the user wait but retains durable recovery maintenance',async t=>{
 const f=fixture(t);f.start(terminal());f.commitError(true);f.abandonStatus('unavailable');const host=f.host();await host.accept(request());const recovery=f.recoveryRow();f.clock(recovery.deadlineAt-1);const held=await host.observe(identity);assert.equal(held.persistenceErrorCode,'turn-checkpoint-recovery-hold');assert.equal(f.recoveryRow().lastReason,'revision-unavailable');assert.equal(f.recoveryRow().stage,'abandon');assert.ok(f.alarm!==null&&f.alarm<=f.recoveryRow().nextAttemptAt);
});

test('prepare failures keep one fixed deadline, honor backoff across reopen, and terminate without a descriptor',async t=>{
 const f=fixture(t);f.start(terminal());f.prepareError(true);const host=f.host(),first=await host.accept(request()),initial=f.recoveryRow(),deadline=initial.deadlineAt;
 assert.equal(first.persistenceErrorCode,'turn-checkpoint-unknown');assert.deepEqual({stage:initial.stage,operationId:initial.operationId,inputSha256:initial.inputSha256,attempts:initial.attempts},{stage:'prepare',operationId:null,inputSha256:null,attempts:1});assert.equal(deadline,f.row().settledAt+120000);assert.equal(f.prepares,1);assert.equal(f.commits,0);
 await host.observe(identity);assert.equal(f.prepares,1);f.reopen();await f.host().observe(identity);assert.equal(f.prepares,1);f.clock(initial.nextAttemptAt-1);await f.host().observe(identity);const retried=f.recoveryRow();assert.equal(f.prepares,2);assert.equal(retried.attempts,2);assert.equal(retried.deadlineAt,deadline);
 f.clock(deadline-1);const ended=await f.host().observe(identity);assert.equal(ended.persistenceErrorCode,'turn-checkpoint-prepare-failed');assert.equal(f.recoveryRow(),null);assert.equal(f.prepares,2);assert.equal(f.commits,0);assert.equal(f.checkpointObserves,0);assert.equal(f.releases,1);
});

test('prepare retry delay grows exponentially to thirty seconds without early store access',async t=>{
 const f=fixture(t);f.start(terminal());f.prepareError(true);const host=f.host();await host.accept(request());const delays:number[]=[];
 for(let attempt=0;attempt<5;attempt++){const before=f.recoveryRow(),calls=f.prepares;await host.observe(identity);assert.equal(f.prepares,calls);f.clock(before.nextAttemptAt-1);await host.observe(identity);const after=f.recoveryRow();delays.push(after.nextAttemptAt-before.nextAttemptAt);}
 assert.deepEqual(delays,[2000,4000,8000,16000,30000]);assert.equal(f.recoveryRow().deadlineAt,f.row().settledAt+120000);
});

test('a late committed resolution clears the recovery hold without replaying prepare or commit',async t=>{
 const f=fixture(t);f.start(terminal());f.commitError(true);f.abandonStatus('unavailable');const host=f.host();await host.accept(request());let recovery=f.recoveryRow();f.clock(recovery.deadlineAt-1);const held=await host.observe(identity);assert.equal(held.persistenceErrorCode,'turn-checkpoint-recovery-hold');assert.equal(f.releases,1);
 recovery=f.recoveryRow();f.abandonStatus('committed');f.clock(recovery.nextAttemptAt-1);const resolved=await host.observe(identity);assert.equal(resolved.checkpoint?.revisionId,'revision-a');assert.equal(resolved.persistenceErrorCode,null);assert.equal(f.recoveryRow(),null);assert.equal(f.prepares,1);assert.equal(f.commits,1);assert.equal(f.abandons,2);
});

test('checkpoint commit durably precedes exact Sandbox release and requires a quiet absent observation',async t=>{
 const f=fixture(t,{retryMs:5,assignmentGuardMs:20,quietMs:10});f.start(terminal());const host=f.host(),first=await host.accept(request());
 assert.equal(first.phase,'terminal');assert.equal(f.commits,1);assert.equal(f.releases,1);assert.ok(f.row().checkpoint);const intent=f.releaseRow();assert.equal(intent.attempts,1);assert.ok(intent.absentSince);assert.equal(f.alarm,intent.nextAttemptAt);
 f.clock(Math.max(intent.begunAt+20,intent.absentSince+10));const settled=await host.observe(identity);assert.equal(settled.phase,'terminal');assert.equal(settled.checkpoint?.revisionId,'revision-a');assert.equal(f.releases,2);assert.ok(f.releaseRow().releasedAt);assert.equal(f.releaseRow().status,'released');assert.equal(f.alarm,null);assert.equal(f.starts,1);assert.equal(f.commits,1);
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

test('release deadline enters recovery hold and continues at the sixty second cadence',async t=>{
 const f=fixture(t,{retryMs:5,assignmentGuardMs:20,quietMs:10,deadlineMs:30,holdRetryMs:60});f.start(terminal());const host=f.host(),first=await host.accept(request()),pending=f.releaseRow();assert.equal(first.resourceDisposition.status,'release-pending');assert.equal(f.releases,1);
 f.clock(pending.deadlineAt);const held=await host.observe(identity),hold=f.releaseRow();assert.equal(held.resourceDisposition.status,'recovery-hold');assert.equal(hold.reasonCode,'trusted-pi-release-deadline-exceeded');assert.equal(hold.nextAttemptAt,hold.deadlineAt+61);assert.equal(f.releases,1);
 f.clock(hold.nextAttemptAt);const released=await host.observe(identity);assert.equal(released.resourceDisposition.status,'released');assert.equal(f.releases,2);assert.equal(f.alarm,null);
});

test('an unavailable base never allocates checkpoint materialization, including after reopen',async t=>{
 const f=fixture(t);f.start({...terminal(identity,'failed'),executionErrorCode:'turn-base-unavailable',events:[]});const first=await f.host().accept(request());assert.equal(first.phase,'terminal');assert.equal(first.outcome,'failed');assert.equal(first.executionErrorCode,'turn-base-unavailable');assert.equal(first.checkpoint,null);assert.equal(first.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(f.prepares,0);assert.equal(f.commits,0);assert.equal(f.checkpointObserves,0);
 assert.equal(f.releases,1);f.reopen();const replay=await f.host().observe(identity);assert.deepEqual(replay,first);assert.equal(f.prepares,0);assert.equal(f.commits,0);assert.equal(f.checkpointObserves,0);assert.equal(f.releases,1);
});

test('legacy checkpoint reservation without an exact descriptor terminates in a recovery hold and releases execution capacity',async t=>{
 const f=fixture(t);f.start(terminal());const completed=await f.host().accept(request());assert.ok(completed.checkpoint);f.sql("UPDATE product_turn_runtime SET value=json_set(value,'$.schemaVersion',1,'$.checkpointReserved',json('true'),'$.checkpoint',json('null'))");f.sql("UPDATE product_turn_runtime SET value=json_remove(value,'$.checkpointIntent','$.checkpointCommitReserved','$.legacyCheckpointUnknown','$.executionDeadlineAt','$.actor','$.resourceLease','$.capacityManaged','$.capacityDispatchReserved','$.capacityDispatchConfirmed','$.nativeStartReserved','$.nativeProcessObservedAt','$.nativeStartFenceReserved')");f.sql('DELETE FROM product_turn_release');
 f.reopen();const held=await f.host().observe(identity);assert.equal(held.checkpoint,null);assert.equal(held.persistenceErrorCode,'turn-checkpoint-recovery-hold');assert.equal(f.prepares,1);assert.equal(f.commits,1);assert.equal(f.releases,2);
 const replay=await f.host().observe(identity);assert.equal(replay.persistenceErrorCode,'turn-checkpoint-recovery-hold');assert.equal(f.prepares,1);assert.equal(f.commits,1);
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
  const f=fixture(t);f.dynamicTerminal();let journalNow=998;const journal=new TurnJournal(new MemoryTurnStore(),()=>journalNow=Math.max(journalNow+1,f.currentTime)),session=(await journal.createSession(scope,actor,'session-key',{title:'Session'})).session;await journal.submit(scope,actor,session.id,'turn-key',{message:'Build model'});
  const result=await new TurnDispatcher(journal,f.host()).tick(scope,2);assert.equal(result?.status,'completed');assert.equal(result?.persistenceOutcome,'saved');assert.equal(f.starts,1);
});

test('product runtime module imports no Pi SDK, provider, network or M0 probe implementation',()=>{
  const source=readFileSync(new URL('../../services/turn-runtime/core.ts',import.meta.url),'utf8'),imports=source.split('\n').filter(line=>line.startsWith('import ')).join('\n');assert.doesNotMatch(imports,/pi-coding-agent|pi-server|fetch|provider|m0-/i);
});


test('observer deadline persists across replay and reopen; authority performs zero durable writes or reconciliation',async t=>{
 const f=fixture(t),host=f.host();let deadline:number|undefined;const start=f.execution.start;f.execution.start=async input=>{deadline=input.executionDeadlineAt;return start(input);};
 await host.accept(request());assert.equal(deadline,601001);const before=f.row();assert.equal(before.schemaVersion,5);let queries=0;f.execution.currentObserverExecution=async id=>{assert.deepEqual(id,identity);queries++;return {expiresAt:deadline!};};
 const operations=[f.starts,f.observes,f.prepares,f.commits,f.writes,f.syncs];assert.deepEqual(await host.currentObserverExecution(identity),{expiresAt:deadline});assert.deepEqual(f.row(),before);assert.deepEqual([f.starts,f.observes,f.prepares,f.commits,f.writes,f.syncs],operations);
 f.reopen();const recovered=f.host();assert.deepEqual(await recovered.currentObserverExecution(identity),{expiresAt:deadline});await recovered.accept(request());assert.equal(f.starts,1);assert.equal(f.row().executionDeadlineAt,deadline);assert.equal(queries,2);
});

test('observer authority denies absent, legacy, unknown, terminal, cancelled and mismatched identities',async t=>{
 for(const kind of ['absent','legacy','unknown','terminal','cancelled','identity']){
  const f=fixture(t),host=f.host();let queried=0;f.execution.currentObserverExecution=async()=>{queried++;return {expiresAt:601001};};
  if(kind!=='absent')await host.accept(request());
  if(kind==='legacy')f.sql("UPDATE product_turn_runtime SET value=json_remove(json_set(value,'$.schemaVersion',2),'$.executionDeadlineAt','$.actor','$.resourceLease','$.capacityManaged','$.capacityDispatchReserved','$.capacityDispatchConfirmed','$.nativeStartReserved','$.nativeProcessObservedAt','$.nativeStartFenceReserved')");
  if(kind==='unknown')f.sql("UPDATE product_turn_runtime SET value=json_set(value,'$.phase','unknown')");
  if(kind==='terminal')await host.cancel(identity);
  if(kind==='cancelled')f.sql("UPDATE product_turn_runtime SET value=json_set(value,'$.cancelRequestedAt',1002)");
  const before=kind==='absent'?null:f.row();await assert.rejects(host.currentObserverExecution(kind==='identity'?{...identity,dispatchId:'other'}:identity));assert.equal(queried,0);if(before)assert.deepEqual(f.row(),before);
  if(kind==='legacy'){await host.observe(identity);assert.equal(f.row().schemaVersion,5);assert.equal(f.row().executionDeadlineAt,undefined);}
 }
});

test('observer authority rejects missing native query, expiry mismatch and cancellation or deadline during await',async t=>{
 for(const kind of ['missing','mismatch','expired','late-expiry','late-cancel']){
 const f=fixture(t),host=f.host();await host.accept(request());
  if(kind==='expired')f.clock(601001);
  if(kind==='late-cancel')f.cancel({identity,phase:'unknown',outcome:null});
  if(kind!=='missing')f.execution.currentObserverExecution=async()=>{if(kind==='late-expiry')f.clock(601001);if(kind==='late-cancel')await host.cancel(identity);return {expiresAt:kind==='mismatch'?601002:601001};};
  await assert.rejects(host.currentObserverExecution(identity),/observer-denied/);
 }
});

test('schema 3 invalid absolute deadline fails closed before native calls',async t=>{
 const f=fixture(t),host=f.host();await host.accept(request());f.sql("UPDATE product_turn_runtime SET value=json_set(value,'$.executionDeadlineAt',700000)");let queried=false;f.execution.currentObserverExecution=async()=>{queried=true;return {expiresAt:700000};};await assert.rejects(host.currentObserverExecution(identity),/invalid-persisted/);assert.equal(queried,false);
});

const retiring:any={identity,phase:'retiring',outcome:'interrupted',executionErrorCode:'turn-native-execution-unresolved',events:[],stopped:null};
test('warm unresolved retirement survives pre-finish restart without checkpoint or invented native stop',async t=>{
 const f=fixture(t);let settlements=0;const retention={async settle(input:any){settlements++;assert.equal(input.checkpoint,null);return {status:'release-pending',...input.resourceLease,turnId:identity.turnId,dispatchId:identity.dispatchId,generation:identity.generation,reasonCode:'workspace-runtime-draining',since:1001,nextAttemptAt:2000};}};
 await f.host(retention).accept(request());f.cancel(retiring);const result=await f.host(retention).cancel(identity);assert.equal(result.phase,'terminal');assert.equal(result.stopped,null);assert.equal(result.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(f.prepares,0);assert.equal(f.releases,0);assert.ok(settlements>0);
 const row=f.row();row.persistenceErrorCode=null;f.sql("UPDATE product_turn_runtime SET value='"+JSON.stringify(row).replaceAll("'","''")+"'");f.reopen();const recovered=await f.host(retention).observe(identity);assert.equal(recovered.persistenceErrorCode,'turn-checkpoint-unknown');assert.equal(recovered.stopped,null);assert.equal(f.prepares,0);await assert.rejects(f.host().observe(identity),/workspace-runtime-retention-required/);
});
test('cold execution and forged warm retirement combinations remain rejected',async t=>{
 const f=fixture(t);await f.host().accept(request());f.cancel(retiring);await assert.rejects(f.host().cancel(identity),/invalid-product-turn-execution-receipt/);
 for(const override of [{outcome:'completed'},{stopped:stop},{events:[event]},{executionErrorCode:'anything'}]){f.cancel({...retiring,...override});await assert.rejects(f.host({settle(){throw Error('must-not-settle');}}).cancel(identity),/invalid-product-turn-execution-receipt/);}
});
