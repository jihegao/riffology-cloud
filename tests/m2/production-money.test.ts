import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ProductionMoneyLedger, moneyReference, type MoneyPolicy } from '../../services/model-budget/production-money.ts';
import type { ModelBudgetStorage, ModelCallRequest } from '../../services/model-budget/core.ts';
import { productionProfile, profileDigest, conservativeCost } from '../../services/model-proxy/production-profile.ts';
import { profile } from './production-profile-fixture.ts';
function request(callId='call-a',userId='user-a',tenantId='tenant-a',turnId='turn-a'):ModelCallRequest{return {schemaVersion:1,identity:{scope:{tenantId,projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId,dispatchId:'dispatch-a',generation:1},actor:{userId,authVersion:1},callId,requestId:`request-${callId}`,deadlineAt:10000,provider:'openai',model:'fixture-model',payloadSha256:'f'.repeat(64),inputTokenUpperBound:60,maxOutputTokens:20,inputBoundVersion:'bound-v1',budgetPolicyVersion:'tokens-v1'};}
async function fixture(t:{after(fn:()=>void):void},caps={turn:1000,user:1000,tenant:1000,global:1000}){
 const db=new DatabaseSync(':memory:'); t.after(()=>db.close());
 const storage={sql:{exec(q:string,...args:(string|number)[]){const st=db.prepare(q);const rows=st.columns().length?st.all(...args):(st.run(...args),[]);return {toArray:()=>structuredClone(rows),[Symbol.iterator]:()=>rows[Symbol.iterator]()};}},transactionSync<T>(fn:()=>T):T{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},async sync(){}} as unknown as ModelBudgetStorage;
 const policy:MoneyPolicy={version:'policy-v1',period:'2026-09',enabled:true,profileSha256:await profileDigest(profile),caps};
 return {policy,host:(p=policy)=>new ProductionMoneyLedger(storage,p,()=>1000)};
}
test('production profile requires accepted fixed route, safe integer prices and explicit model',()=>{
 assert.equal(conservativeCost(profile,60,20),220);
 for(const patch of [{model:''},{acceptance:{}},{rates:{...profile.rates,inputNanodollarsPerToken:0.1}},{gateway:{...profile.gateway,accountId:'evil.example/path'}},{billing:'unified-billing'}])assert.throws(()=>productionProfile({...profile,...patch}));
 assert.throws(()=>productionProfile({...profile,rates:{...profile.rates,inputNanodollarsPerToken:Number.MAX_SAFE_INTEGER}}),/overflow/);
});
test('money durable fence, immutable route, conservative receipt and replay',async t=>{
 const f=await fixture(t),a=f.host();const reservation=await a.reserve({request:request(),profile}),ref=moneyReference(reservation.record);
 assert.equal(reservation.record.accounted,220);assert.equal((await a.reserve({request:request(),profile})).replayed,true);
 assert.equal((await a.dispatch(ref)).authorized,true);assert.equal((await f.host().dispatch(ref)).authorized,false);
 await a.markUnknown(ref,'deadline');assert.equal((await f.host().lookup(ref)).accounted,220);
 await assert.rejects(a.reserve({request:request(),profile:{...profile,profileVersion:'v2'}}),/conflict/);
 const terminal={inputTokens:10,outputTokens:16,providerRequestId:'req-1',evidence:'provider-usage-conservative-price' as const};
 assert.equal((await f.host().finish(ref,terminal)).accounted,100);assert.equal((await a.finish(ref,terminal)).state,'recorded');
 await assert.rejects(a.finish(ref,{...terminal,outputTokens:17}),/conflict/);
});
for(const dimension of ['turn','user','tenant','global'] as const)test(`money enforces ${dimension} cap across independent calls`,async t=>{
 const caps={turn:2000,user:2000,tenant:2000,global:2000};caps[dimension]=300;const f=await fixture(t,caps),a=f.host();await a.reserve({request:request(),profile});
 const r=request('call-b',dimension==='global'?'user-b':'user-a',dimension==='global'?'tenant-b':'tenant-a',dimension==='turn'?'turn-a':'turn-b');
 await assert.rejects(a.reserve({request:r,profile}),/cap-exceeded/);
});
test('unknown reservations survive period changes; stop allows history but never a new dispatch',async t=>{
 const f=await fixture(t,{turn:300,user:300,tenant:300,global:300}),a=f.host(),ref=moneyReference((await a.reserve({request:request(),profile})).record);await a.dispatch(ref);await a.markUnknown(ref,'cancelled');
 const next=f.host({...f.policy,version:'policy-v2',period:'2026-10'});await assert.rejects(next.reserve({request:request('call-b'),profile}),/cap/);
 const stopped=f.host({...f.policy,enabled:false});assert.equal((await stopped.lookup(ref)).state,'unknown');await assert.rejects(stopped.reserve({request:request('call-c'),profile}),/stopped/);
});
test('first concrete unknown category survives later generic settlement uncertainty',async t=>{
 const f=await fixture(t),a=f.host(),first=moneyReference((await a.reserve({request:request(),profile})).record);await a.dispatch(first);await a.markUnknown(first,'rate-limited');await a.markUnknown(first,'outcome-unknown');await a.markUnknown(first,'provider-failure');assert.equal((await a.lookup(first)).errorCategory,'rate-limited');
 const second=moneyReference((await a.reserve({request:request('call-b'),profile})).record);await a.dispatch(second);await a.markUnknown(second,'outcome-unknown');await a.markUnknown(second,'missing-usage');await a.markUnknown(second,'malformed-stream');assert.equal((await a.lookup(second)).errorCategory,'missing-usage');
});
test('configured route or cap changes cannot redirect admitted calls; recorded turn usage spans periods',async t=>{
 const f=await fixture(t,{turn:250,user:2000,tenant:2000,global:2000}),a=f.host(),ref=moneyReference((await a.reserve({request:request(),profile})).record);
 await assert.rejects(f.host({...f.policy,version:'policy-v2',profileSha256:'f'.repeat(64)}).dispatch(ref),/route-changed/);
 await assert.rejects(f.host({...f.policy,caps:{...f.policy.caps,global:3000}}).dispatch(ref),/policy-conflict/);
 await a.dispatch(ref);await a.finish(ref,{inputTokens:60,outputTokens:20,providerRequestId:'req-1',evidence:'provider-usage-conservative-price'});
 await assert.rejects(f.host({...f.policy,version:'next',period:'2026-10'}).reserve({request:request('call-b'),profile}),/cap/);
});
