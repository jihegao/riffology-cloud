import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqlInvitedRunCapacity} from '../../services/simulation/invited-capacity.ts';
import {invitedRunsPolicy,INVITED_RUN_CONFIRMATION_GRACE_MS,type InvitedRunsPolicy} from '../../services/simulation/invited-policy.ts';
import {leaseReference,type LeaseRequest,type QuotaStorage} from '../../services/quota/core.ts';
const policy:InvitedRunsPolicy={schemaVersion:1,policyId:'beta-runs-v1',enabled:true,maxActiveRuns:1,maxRunsPerUser:1,maxGroupRuns:8,durationMs:600000,releaseGuardMs:360000,quietMs:30000};
const actor={userId:'invited-a',authVersion:1};
function fixture(t:{after(fn:()=>void):void}){
 const dir=mkdtempSync(join(tmpdir(),'invited-runs-')),file=join(dir,'state.sqlite');let db=new DatabaseSync(file),now=1000,fail=false;
 const storage={sql:{exec(query:string,...args:(string|number|null)[]){let rows:Record<string,unknown>[]=[];if(query.includes('CREATE TABLE'))db.exec(query);else{const statement=db.prepare(query);if(statement.columns().length)rows=statement.all(...args);else statement.run(...args);}return {toArray:()=>structuredClone(rows),one:()=>structuredClone(rows[0])};}},transactionSync<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},async sync(){if(fail){fail=false;throw Error('lost-ack');}}} as unknown as QuotaStorage;
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const request=(operationId='run-1',tenantId='tenant-a',runId=operationId):LeaseRequest=>({tenantId,projectId:'project-a',workspaceId:'workspace-a',generation:1,operation:'simulation-run',operationId,runId,deadlineAt:now+600000});
 return {core:(p=policy)=>new SqlInvitedRunCapacity(storage,p,()=>now),request,get now(){return now;},set now(value:number){now=value;},loseAck(){fail=true;},reopen(){db.close();db=new DatabaseSync(file);}};
}
test('resource policy has no cost/call quotas and bounds the one-container route',()=>{
 assert.deepEqual(invitedRunsPolicy(policy),policy);
 for(const bad of [{...policy,maxActiveRuns:2},{...policy,maxGroupRuns:81},{...policy,quietMs:1},{...policy,releaseGuardMs:1},{...policy,durationMs:900000},{...policy,maxCalls:100}])assert.throws(()=>invitedRunsPolicy(bad));
});
test('lost acquire/dispatch/release ACKs recover the same durable lease without a second grant',async t=>{
 const f=fixture(t),h=f.core();await h.ready;const request=f.request();f.loseAck();await assert.rejects(h.acquire(request,actor),/lost-ack/);f.reopen();const lease=(await f.core().acquire(request,actor)).lease!,ref=leaseReference(lease);assert.equal((await h.snapshot()).occupied,1);
 f.loseAck();await assert.rejects(h.dispatch(ref),/lost-ack/);f.reopen();assert.equal((await f.core().dispatch(ref)).authorized,false);
 const proof={kind:'runtime-stopped' as const,confirmationId:'proof-a',observedAt:f.now};f.loseAck();await assert.rejects(h.confirmStopped(ref,proof),/lost-ack/);f.reopen();assert.equal((await f.core().confirmStopped(ref,proof)).released,false);assert.equal((await h.snapshot()).occupied,0);
});
test('one user cannot evade occupied capacity with another project, tenant, identity version or concurrent request',async t=>{
 const f=fixture(t),h=f.core(),first=(await h.acquire(f.request(),actor)).lease!;
 const sameUser=await h.acquire({...f.request('run-2','tenant-b'),projectId:'project-b',workspaceId:'workspace-b'},actor);assert.equal(sameUser.denial,'run-held');
 assert.equal((await h.acquire(f.request('run-3','tenant-c'),{userId:'invited-b',authVersion:1})).denial,'quota-exhausted');
 await assert.rejects(h.acquire(f.request(),{...actor,authVersion:2}),/idempotency-conflict/);
 await assert.rejects(h.dispatch({...leaseReference(first),projectId:'different'}),/lease-denied/);
 assert.equal((await h.snapshot()).occupied,1);
});
test('never-started cancellation releases safely; dispatched cancellation needs runtime proof',async t=>{
 const f=fixture(t),h=f.core(),first=(await h.acquire(f.request(),actor)).lease!,ref=leaseReference(first);
 assert.equal((await h.confirmStopped(ref,{kind:'never-started',confirmationId:'cancel-before',observedAt:f.now})).released,true);
 const second=(await h.acquire(f.request('run-2'),actor)).lease!,ref2=leaseReference(second);await h.dispatch(ref2);
 await assert.rejects(h.confirmStopped(ref2,{kind:'never-started',confirmationId:'false-proof',observedAt:f.now}),/stop-invalid/);
 await h.confirmStopped(ref2,{kind:'runtime-stopped',confirmationId:'cancel-after',observedAt:f.now});assert.equal((await h.snapshot()).occupied,0);
});
test('unknown execution persists global stop across restart and policy changes, released facts alone do not auto-resume',async t=>{
 const f=fixture(t),h=f.core(),lease=(await h.acquire(f.request(),actor)).lease!,ref=leaseReference(lease);await h.dispatch(ref);await h.markUnknown(ref);f.reopen();
 assert.equal((await f.core().snapshot()).paused,true);await assert.rejects(h.acquire(f.request('other','new-tenant'),{userId:'invited-b',authVersion:1}),/paused/);
 await assert.rejects(f.core({...policy,policyId:'replacement'}).acquire(f.request('bypass'),actor),/policy-conflict/);await assert.rejects(h.resume(),/release-unconfirmed/);
 await h.confirmStopped(ref,{kind:'runtime-stopped',confirmationId:'isolated-stop',observedAt:f.now});assert.equal((await h.snapshot()).paused,true);await h.resume();assert.equal((await h.acquire(f.request('after-review'),actor)).outcome,'acquired');
});
test('expired execution plus release guard quarantines without returning capacity; disable retains lookup and release',async t=>{
 const f=fixture(t),h=f.core(),lease=(await h.acquire(f.request(),actor)).lease!,ref=leaseReference(lease);await h.dispatch(ref);f.now+=600000;
 assert.equal((await h.snapshot()).paused,false);f.now+=360000+INVITED_RUN_CONFIRMATION_GRACE_MS;assert.equal((await h.snapshot()).unknown,1);assert.equal((await h.snapshot()).occupied,1);
 f.reopen();const disabled=f.core({...policy,enabled:false});assert.equal((await disabled.lookup(ref.tenantId,ref.operationId))?.lease?.status,'unknown');await disabled.confirmStopped(ref,{kind:'runtime-stopped',confirmationId:'late-stop',observedAt:f.now});assert.equal((await disabled.snapshot()).occupied,0);
});
test('meter-only execution records observed duration and preserves all historical receipts beyond arbitrary call totals',async t=>{
 const f=fixture(t),h=f.core();for(let i=0;i<30;i++){const lease=(await h.acquire(f.request('run-'+i),actor)).lease!,ref=leaseReference(lease);await h.dispatch(ref);f.now+=20;await h.confirmStopped(ref,{kind:'runtime-stopped',confirmationId:'proof-'+i,observedAt:f.now});}
 const snapshot=await h.snapshot();assert.equal(snapshot.observed.runs,30);assert.equal(snapshot.observed.dispatched,30);assert.equal(snapshot.observed.released,30);assert.equal(snapshot.observed.supervisedMs,600);assert.equal(snapshot.leases.length,30);assert.equal(Object.hasOwn(snapshot.observed,'cost'),false);
});
test('semantically identical reordered policy is accepted while duration changes fail closed',async t=>{
 const f=fixture(t),h=f.core();await h.ready;const reordered=Object.fromEntries(Object.entries(policy).reverse()) as InvitedRunsPolicy;assert.equal((await f.core(reordered).acquire(f.request(),actor)).outcome,'acquired');
 await assert.rejects(f.core({...policy,durationMs:500000}).acquire(f.request('new'),actor),/policy-conflict/);
});
