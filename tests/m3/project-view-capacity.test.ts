import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqlProjectViewCapacity,type ProjectViewCapacityStorage} from '../../services/project-views/capacity.ts';
import {PROJECT_VIEW_SESSION_MS,type ProjectViewRuntimeIdentity,type ProjectViewRuntimeStatus} from '../../services/project-views/runtime-protocol.ts';

function identity(sessionId='session-a',userId='invited-a'):ProjectViewRuntimeIdentity{return {schema:'project.view-session/v1',sessionId,operationId:'operation-'+sessionId,scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor:{userId,authVersion:1},packageIdentity:'a'.repeat(64),viewId:'main',policyHash:'b'.repeat(64)};}
function fixture(t:{after(fn:()=>void):void}){
 const dir=mkdtempSync(join(tmpdir(),'project-view-capacity-')),file=join(dir,'state.sqlite');let db=new DatabaseSync(file),now=1000,failSync=false,barrier:Promise<void>|null=null;
 const states=new Map<string,{identity:ProjectViewRuntimeIdentity;status:ProjectViewRuntimeStatus}>(),observed:string[]=[];
 const storage:ProjectViewCapacityStorage={
  sql:{exec(query:string,...args:(string|number|null)[]){if(query.includes('CREATE TABLE')){db.exec(query);return {toArray:()=>[]};}const statement=db.prepare(query),rows=statement.columns().length?statement.all(...args as SQLInputValue[]):(statement.run(...args as SQLInputValue[]),[]);return {toArray:()=>structuredClone(rows)};}},
  transactionSync<T>(action:()=>T){db.exec('BEGIN IMMEDIATE');try{const result=action();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}},
  async sync(){if(failSync){failSync=false;throw Error('lost-storage-ack');}}
 };
 const authority={async status(wanted:ProjectViewRuntimeIdentity){observed.push(wanted.sessionId);if(barrier)await barrier;const found=states.get(wanted.sessionId);if(!found||JSON.stringify(found.identity)!==JSON.stringify(wanted))throw Error('runtime-identity-denied');return structuredClone(found.status);}};
 const core=()=>new SqlProjectViewCapacity(storage,authority,()=>now);
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 function register(id:ProjectViewRuntimeIdentity){states.set(id.sessionId,{identity:structuredClone(id),status:{id:id.sessionId,status:'starting',cleanupConfirmed:false,cleanupProofId:null}});}
 function closed(id:ProjectViewRuntimeIdentity,proofId='cleanup-'+id.sessionId){const found=states.get(id.sessionId)!;found.status={id:id.sessionId,status:'closed',cleanupConfirmed:true,cleanupProofId:proofId};return {cleanupConfirmed:true as const,proofId};}
 return {core,register,closed,states,observed,get now(){return now;},set now(value:number){now=value;},loseAck(){failSync=true;},reopen(){db.close();db=new DatabaseSync(file);},hold(promise:Promise<void>|null){barrier=promise;}};
}

test('simultaneous users/projects compete for one durable slot; deadline expiry does not return capacity',async t=>{
 const f=fixture(t),core=f.core(),a=identity(),b=identity('session-b','invited-b');b.scope={...b.scope,tenantId:'tenant-b',projectId:'project-b',workspaceId:'workspace-b'};f.register(a);f.register(b);await core.ready;
 let allow!:()=>void;f.hold(new Promise(resolve=>{allow=resolve;}));
 const first=core.acquire({identity:a,expiresAt:f.now+PROJECT_VIEW_SESSION_MS}),second=core.acquire({identity:b,expiresAt:f.now+PROJECT_VIEW_SESSION_MS});allow();
 const results=await Promise.allSettled([first,second]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(String((results[1] as PromiseRejectedResult).reason),/capacity-full/);assert.equal((await core.snapshot()).occupied,1);
 f.now+=PROJECT_VIEW_SESSION_MS+1;f.hold(null);f.reopen();const restarted=f.core();await assert.rejects(restarted.acquire({identity:b,expiresAt:f.now+PROJECT_VIEW_SESSION_MS}),/capacity-full/);assert.deepEqual(await restarted.snapshot(),{occupied:1,released:0,records:1});
});
test('same identity is idempotent, but reused session/operation and deadline changes fail closed',async t=>{
 const f=fixture(t),core=f.core(),id=identity();f.register(id);const input={identity:id,expiresAt:f.now+PROJECT_VIEW_SESSION_MS};await core.acquire(input);await core.acquire(input);assert.equal((await core.snapshot()).records,1);
 for(const changed of [{...id,actor:{...id.actor,authVersion:2}},{...id,scope:{...id.scope,projectId:'foreign'}},{...id,packageIdentity:'c'.repeat(64)},{...id,sessionId:'replacement'},{...id,operationId:'replacement'}])await assert.rejects(core.acquire({...input,identity:changed}),/identity-conflict/);
 await assert.rejects(core.acquire({...input,expiresAt:input.expiresAt-1}),/identity-conflict/);
});
test('persisted slot survives lost acquire ACK and SQLite reopen without another grant',async t=>{
 const f=fixture(t),core=f.core(),id=identity();f.register(id);const input={identity:id,expiresAt:f.now+PROJECT_VIEW_SESSION_MS};await core.ready;f.loseAck();await assert.rejects(core.acquire(input),/lost-storage-ack/);f.reopen();const restarted=f.core();await restarted.acquire(input);assert.deepEqual(await restarted.snapshot(),{occupied:1,released:0,records:1});
});
test('release requires the original runtime terminal proof; fake scope, unknown, stale and reused proof cannot release',async t=>{
 const f=fixture(t),core=f.core(),id=identity();f.register(id);await core.acquire({identity:id,expiresAt:f.now+PROJECT_VIEW_SESSION_MS});const proof={cleanupConfirmed:true as const,proofId:'cleanup-a'};
 await assert.rejects(core.release({identity:id,proof}),/cleanup-unconfirmed/);
 f.states.get(id.sessionId)!.status={id:id.sessionId,status:'unknown',cleanupConfirmed:false,cleanupProofId:null};await assert.rejects(core.release({identity:id,proof}),/cleanup-unconfirmed/);
 await assert.rejects(core.release({identity:{...id,scope:{...id.scope,workspaceGeneration:2}},proof}),/identity-conflict/);
 f.closed(id,'correct-proof');await assert.rejects(core.release({identity:id,proof}),/cleanup-unconfirmed/);assert.equal((await core.snapshot()).occupied,1);
 await core.release({identity:id,proof:{cleanupConfirmed:true,proofId:'correct-proof'}});await core.release({identity:id,proof:{cleanupConfirmed:true,proofId:'correct-proof'}});
 const other=identity('session-b');f.register(other);await core.acquire({identity:other,expiresAt:f.now+PROJECT_VIEW_SESSION_MS});f.closed(other,'correct-proof');await assert.rejects(core.release({identity:other,proof:{cleanupConfirmed:true,proofId:'correct-proof'}}),/proof-reused/);assert.equal((await core.snapshot()).occupied,1);
});
test('lost release ACK retains terminal tombstone through restart and prevents reacquisition',async t=>{
 const f=fixture(t),core=f.core(),id=identity();f.register(id);const input={identity:id,expiresAt:f.now+PROJECT_VIEW_SESSION_MS};await core.acquire(input);const proof=f.closed(id);f.loseAck();await assert.rejects(core.release({identity:id,proof}),/lost-storage-ack/);f.reopen();const restarted=f.core();await restarted.release({identity:id,proof});await assert.rejects(restarted.acquire(input),/session-terminal/);await assert.rejects(restarted.release({identity:id,proof:{cleanupConfirmed:true,proofId:'different'}}),/proof-conflict/);assert.deepEqual(await restarted.snapshot(),{occupied:0,released:1,records:1});
});
test('untrusted admission cannot create capacity; malformed deadlines and unbound runtime identity are rejected',async t=>{
 const f=fixture(t),core=f.core(),id=identity();
 await assert.rejects(core.acquire({identity:id,expiresAt:f.now+PROJECT_VIEW_SESSION_MS}),/runtime-identity-denied/);
 f.register(id);for(const expiresAt of [NaN,Infinity,f.now,f.now+PROJECT_VIEW_SESSION_MS+1])await assert.rejects(core.acquire({identity:id,expiresAt}),/deadline-invalid/);
 f.states.get(id.sessionId)!.status.id='foreign';await assert.rejects(core.acquire({identity:id,expiresAt:f.now+PROJECT_VIEW_SESSION_MS}),/runtime-denied/);assert.deepEqual(await core.snapshot(),{occupied:0,released:0,records:0});
});
test('cleanup arriving before acquire leaves a terminal fence that survives restart and blocks its late admission',async t=>{
 const f=fixture(t),core=f.core(),id=identity();f.register(id);const proof=f.closed(id);await core.release({identity:id,proof});f.reopen();const restarted=f.core();
 await assert.rejects(restarted.acquire({identity:id,expiresAt:f.now+PROJECT_VIEW_SESSION_MS}),/session-terminal/);assert.deepEqual(await restarted.snapshot(),{occupied:0,released:1,records:1});
 const next=identity('session-b','invited-b');f.register(next);await restarted.acquire({identity:next,expiresAt:f.now+PROJECT_VIEW_SESSION_MS});assert.deepEqual(await restarted.snapshot(),{occupied:1,released:1,records:2});
});
test('in-flight admission and concurrent original cleanup cannot leave an extra grant or clear another session',async t=>{
 const f=fixture(t),core=f.core(),id=identity();f.register(id);await core.ready;let resume!:()=>void;f.hold(new Promise(resolve=>{resume=resolve;}));
 const acquisition=core.acquire({identity:id,expiresAt:f.now+PROJECT_VIEW_SESSION_MS});await Promise.resolve();const proof=f.closed(id),release=core.release({identity:id,proof});f.hold(null);resume();
 await assert.rejects(acquisition,/runtime-denied/);await release;assert.deepEqual(await core.snapshot(),{occupied:0,released:1,records:1});
 const next=identity('session-b');f.register(next);await core.acquire({identity:next,expiresAt:f.now+PROJECT_VIEW_SESSION_MS});await core.release({identity:id,proof});assert.deepEqual(await core.snapshot(),{occupied:1,released:1,records:2});
});
