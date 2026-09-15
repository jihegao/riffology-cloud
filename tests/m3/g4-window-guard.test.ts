import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {G4WindowGuard,readG4WindowSnapshot,g4WindowPolicy,type G4WindowPolicy,type G4Task} from '../../services/model-budget/g4-window.ts';
import {SqlTenantModelBudget,modelCallReference,type ModelBudgetStorage,type ModelCallRequest} from '../../services/model-budget/core.ts';
const policy={schemaVersion:1,windowId:'g4-only-20260915',tenantId:'tenant-a',userId:'user-a',provider:'opencode-go',model:'gpt-5.6-luna',rateCardSha256:'a'.repeat(64),inputNanodollarsPerToken:500,outputNanodollarsPerToken:1800,totalNanodollars:20000000000,turnNanodollars:5000000000,maxUpstreamDispatches:32,maxServerRuns:16,durationMs:7200000} as G4WindowPolicy;
const key=(n:number)=>n.toString(16).padStart(64,'0');
const task=(kind:G4Task['kind'],n:number):G4Task=>({tenantId:'tenant-a',userId:'user-a',kind,key:key(n),digest:key(n+1000)});
const request=(n:number):ModelCallRequest=>({schemaVersion:1,identity:{scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-'+n,dispatchId:'dispatch-'+n,generation:1},actor:{userId:'user-a',authVersion:1},callId:'call-'+n,requestId:'request-'+n,deadlineAt:100000,provider:'opencode-go',model:'gpt-5.6-luna',payloadSha256:key(n),inputTokenUpperBound:60,maxOutputTokens:20,inputBoundVersion:'utf8-provider-payload-plus-4096-v1',budgetPolicyVersion:'token-v1'});
function fixture(t: {after(fn:()=>void):void}){
 const dir=mkdtempSync(join(tmpdir(),'g4-sqlite-'));let db=new DatabaseSync(join(dir,'ledger.sqlite')),now=1000,failSync=false,onSync:(()=>void)|null=null;
 const storage={sql:{exec(query:string,...args:(string|number|null)[]){if(query.startsWith('CREATE TABLE')){db.exec(query);return {toArray:()=>[]};}const s=db.prepare(query),rows=s.columns().length?s.all(...args):(s.run(...args),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},async sync(){if(onSync){const callback=onSync;onSync=null;callback();}if(failSync){failSync=false;throw Error('ack-lost-after-commit');}}} as ModelBudgetStorage;
 const guard=(p:G4WindowPolicy|null=policy)=>new G4WindowGuard(storage,p,()=>now);
 const token=()=>new SqlTenantModelBudget(storage,{tenantId:'tenant-a',version:'token-v1',maxReservationAttemptsPerTurn:8,maxDispatchedCallsPerTurn:8,maxInputTokensPerCall:262144,maxOutputTokensPerCall:4096,maxReservedTokensPerTurn:532480},()=>now,()=>crypto.randomUUID(),policy);
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});return {storage,guard,token,advance:(n:number)=>now+=n,loseAck:()=>failSync=true,afterNextSync:(fn:()=>void)=>onSync=fn,restart:()=>{db.close();db=new DatabaseSync(join(dir,'ledger.sqlite'));}};
}
test('strict fixed Go policy rejects null, type coercion, cap inflation and route replacement',()=>{
 assert.equal(g4WindowPolicy(undefined),null);assert.deepEqual(g4WindowPolicy(policy),policy);
 for(const p of [null,{...policy,durationMs:'7200000'},{...policy,totalNanodollars:20000000001},{...policy,provider:'openai'},{...policy,extra:true}])assert.throws(()=>g4WindowPolicy(p));
});
test('first Project intent fixes deadline, dedup survives restart, removed/rotated policy never resets it',t=>{
 const f=fixture(t),g=f.guard();assert.equal(g.snapshot().startedAt,null);f.storage.transactionSync(()=>g.taskSync(task('project',1)));f.advance(7200000);f.restart();const restored=f.guard();assert.equal(restored.snapshot().startedAt,1000);
 assert.equal(f.storage.transactionSync(()=>restored.taskSync(task('project',1))).replayed,true);
 assert.throws(()=>f.storage.transactionSync(()=>restored.taskSync(task('turn',2))),/deadline/);
 assert.throws(()=>f.storage.transactionSync(()=>f.guard(null).taskSync(task('project',2))),/configuration-removed/);
 assert.throws(()=>f.storage.transactionSync(()=>f.guard({...policy,windowId:'new-window'}).taskSync(task('project',2))),/policy-conflict/);
 assert.equal(restored.snapshot().tasks.length,1,'reads never admit tasks');
});
test('shared Run cap counts sixteen distinct service/experiment/group intents, replay/conflict cannot reset slots',t=>{
 const f=fixture(t),g=f.guard();for(let n=1;n<=16;n++)f.storage.transactionSync(()=>g.taskSync(task('run',n)));
 f.restart();assert.equal(f.storage.transactionSync(()=>f.guard().taskSync(task('run',16))).replayed,true);
 assert.throws(()=>f.storage.transactionSync(()=>f.guard().taskSync(task('run',17))),/run-limit/);
 assert.throws(()=>f.storage.transactionSync(()=>f.guard().taskSync({...task('run',1),digest:key(999)})),/intent-conflict/);
 assert.throws(()=>f.storage.transactionSync(()=>f.guard().taskSync({...task('run',18),userId:'other'})),/scope-denied/);
});
test('32 actual dispatch fences are durable, concurrent duplicate is observe-only; 33rd never reserves',async t=>{
 const f=fixture(t);let core=f.token();for(let n=1;n<=32;n++){const r=(await core.reserve(request(n))).record,ref=modelCallReference(r);const ds=await Promise.all([core.dispatch(ref),core.dispatch(ref)]);assert.equal(ds.filter(v=>v.authorized).length,1);await core.finish(ref,{outcome:'completed',errorCode:null,providerRequestId:'go-'+n,usage:{kind:'verified',inputTokens:10,outputTokens:5,source:'provider-usage',observedAt:1000}});}
 f.restart();core=f.token();await assert.rejects(core.reserve(request(33)),/dispatch-limit/);const s=core.g4.snapshot();assert.equal(s.calls.length,32);assert.equal(s.calls.filter(r=>r.dispatch_at!==null).length,32);
});
test('lost dispatch ACK/restart preserves dollar hold and blocks all fresh tasks, never redispatches',async t=>{
 const f=fixture(t),core=f.token(),ref=modelCallReference((await core.reserve(request(1))).record);f.loseAck();await assert.rejects(core.dispatch(ref),/ack-lost/);f.restart();const restored=f.token();assert.equal((await restored.dispatch(ref)).authorized,false);
 await assert.rejects(restored.reserve(request(2)),/charge-unsettled/);assert.throws(()=>f.storage.transactionSync(()=>restored.g4.taskSync(task('run',1))),/charge-unsettled/);await restored.markUnknown(ref);const held=restored.g4.snapshot().calls[0];assert.equal(held.accounted,66000);assert.equal(held.state,'unknown');
 await restored.finish(ref,{outcome:'completed',errorCode:null,providerRequestId:'go-a',usage:{kind:'verified',inputTokens:10,outputTokens:5,source:'provider-usage',observedAt:1000}});assert.equal(restored.g4.snapshot().calls[0].accounted,14000);assert.equal((await restored.reserve(request(2))).replayed,false);
});
test('lost reserve ACK remains resumable same key; unknown usage never frees money, timeout never clears hold',async t=>{
 const f=fixture(t),core=f.token();f.loseAck();await assert.rejects(core.reserve(request(1)),/ack-lost/);f.restart();const r=await f.token().reserve(request(1));assert.equal(r.replayed,true);const ref=modelCallReference(r.record);await f.token().dispatch(ref);await f.token().finish(ref,{outcome:'failed',errorCode:'provider-rejected',providerRequestId:null,usage:{kind:'unknown',observedAt:1000}});f.advance(7200001);f.restart();assert.equal(f.guard().snapshot().calls[0].accounted,66000);assert.equal(f.guard().snapshot().calls[0].state,'unknown');
});
test('dollar Turn5/global20 caps and policy failures rollback reservation state atomically',t=>{
 const f=fixture(t),g=f.guard();const huge={...request(1),inputTokenUpperBound:10000001,maxOutputTokens:20};assert.throws(()=>f.storage.transactionSync(()=>g.reserveSync(huge,key(1),key(100))),/money-cap/);assert.equal(g.snapshot().startedAt,null);assert.equal(g.snapshot().calls.length,0);
 for(let n=1;n<=8;n++){f.storage.transactionSync(()=>g.reserveSync({...request(n),inputTokenUpperBound:5000000,maxOutputTokens:0},key(n),key(n+100)));f.storage.transactionSync(()=>g.dispatchSync(key(n)));f.storage.transactionSync(()=>g.finishSync(key(n),{outcome:'completed',errorCode:null,providerRequestId:'go-'+n,usage:{kind:'verified',inputTokens:5000000,outputTokens:0,source:'provider-usage',observedAt:1000}}));}
 assert.throws(()=>f.storage.transactionSync(()=>g.reserveSync(request(9),key(9),key(109))),/money-cap/);assert.equal(g.snapshot().calls.length,8);
});

test('before-first-task budget snapshot is strictly read-only and does not create tables',t=>{const f=fixture(t);const before=f.storage.sql.exec('SELECT name FROM sqlite_master').toArray();assert.equal(readG4WindowSnapshot(f.storage,policy).startedAt,null);assert.deepEqual(f.storage.sql.exec('SELECT name FROM sqlite_master').toArray(),before);});

test('dispatch flush crossing frozen two-hour deadline never authorizes Provider even within call deadline',async t=>{const f=fixture(t),g=f.guard();f.storage.transactionSync(()=>g.taskSync(task('project',1)));f.advance(7100000);const core=f.token(),ref=modelCallReference((await core.reserve({...request(1),deadlineAt:7300000})).record);f.afterNextSync(()=>f.advance(101000));const result=await core.dispatch(ref);assert.equal(result.authorized,false);assert.equal(result.controlledWindowDeadlineAt,7201000);assert.equal(core.g4.snapshot().calls[0].state,'unknown');});
