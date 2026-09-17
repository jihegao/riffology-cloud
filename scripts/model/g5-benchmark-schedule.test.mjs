import test from 'node:test';
import assert from 'node:assert/strict';
import { frozenSchedule, compileSchedule, nextAdmission, rejectExecute, fixtureSha256 } from './g5-benchmark-schedule.mjs';
import { profileDigest } from '../../services/model-proxy/production-profile.ts';
// Synthetic profile exercises local arithmetic only; not account/price/privacy evidence.
async function proposal() {
  const hash='a'.repeat(64);
  const profile={schemaVersion:1,profileVersion:'test-v1',inferenceProvider:'openai',model:'test-model',protocol:'openai-responses',billing:'platform-byok',gateway:{kind:'cloudflare',accountId:'a'.repeat(32),gatewayId:'test'},secrets:{provider:'PRODUCTION_OPENAI_API_KEY',gateway:'PRODUCTION_AI_GATEWAY_TOKEN'},acceptance:{evidenceSha256:hash,privacyReviewSha256:hash},rates:{version:'test-rate',currency:'USD',inputNanodollarsPerToken:1,outputNanodollarsPerToken:1},limits:{maxInputTokens:8192,maxOutputTokens:1024}};
  return {groupIntentTasks:3,extraTurns:0,taskCap:64,dispatchCap:146,runCap:39,productionManifest:{profile,profileSha256:await profileDigest(profile),runtimeSha256:hash,taskFixturesSha256:fixtureSha256,privacyEvidenceSha256:hash,gatewayNoRetryEvidenceSha256:hash,operator:'synthetic-test',accountReference:'synthetic-test',authorizationReference:'NOT-LIVE-AUTHORIZATION',rateCardSource:'https://example.invalid/test',rateCardCheckedAt:'2026-09-16T00:00:00Z',deadline:'2026-09-17T00:00:00Z',maxCallsPerTask:8,concurrency:1,globalCapNanodollars:19990089550,turnCapNanodollars:5000000000,targets:{p95TurnMs:1,maxCostPerAcceptedTaskNanodollars:1}}};
}
test('repetition dependency schedule, complete admission counts and probe-inclusive arithmetic',async()=>{
 const p=await proposal(), s=await compileSchedule(p);
 assert.equal(s.schedule.length,18);assert.equal(s.schedule.reduce((n,t)=>n+t.explicitRuns,0),39);
 assert.deepEqual(s.schedule.map(t=>t.repeat),[...Array(6).fill(1),...Array(6).fill(2),...Array(6).fill(3)]);
 assert.equal(s.schedule[6].dependsOn,null);assert.equal(s.schedule[5].dependsOn,'repeat-1/measured-evidence');
 assert.deepEqual([s.limits.normalAdmissionTasks,s.limits.probeTasks,s.limits.maximumAdmissionTasks],[63,1,64]);assert.equal(s.limits.maximumNanodollars,146*9216);assert.equal(s.limits.dispatchCap,146);
 p.groupIntentTasks=0;await assert.rejects(compileSchedule(p),/group-intent-classification-required/);
 p.groupIntentTasks=3;
 p.taskCap=62;await assert.rejects(compileSchedule(p),/task-cap-conflict/);
 p.taskCap=64;p.productionManifest.globalCapNanodollars=144*9216;
 await assert.rejects(compileSchedule(p),/probe-inclusive-budget-too-small/);
});
test('chained rollover runs the complete normal suite with zero probe Tasks',async()=>{
 const p=await proposal();p.taskCap=63;p.dispatchCap=145;p.productionManifest.globalCapNanodollars=145*9216;
 const s=await compileSchedule(p);
 assert.deepEqual([s.limits.normalAdmissionTasks,s.limits.probeTasks,s.limits.maximumAdmissionTasks],[63,0,63]);
 assert.deepEqual([s.limits.normalDispatches,s.limits.totalDispatches,s.limits.dispatchCap],[144,144,145]);
 assert.equal(s.limits.maximumNanodollars,145*9216);assert.deepEqual(s.probes,[]);
 const normal=s.schedule.map(t=>({id:t.fixtureId,status:'accepted',dispatches:2}));
 assert.deepEqual(nextAdmission(s,normal),{state:'complete'});
 p.dispatchCap=146;await assert.rejects(compileSchedule(p),/frozen-dispatch-or-run-cap/);
});
test('unknown final probe stops; no post-stop admission, no replay, unqualified predecessor blocks dependencies',async()=>{
 const s=await compileSchedule(await proposal());
 const normal=s.schedule.map(t=>({id:t.fixtureId,status:'accepted',dispatches:2}));
 assert.equal(nextAdmission(s,normal).next,'missing-usage');
 const failed=[...normal.slice(0,2),{...normal[2],status:'failed'}];
 assert.equal(nextAdmission(s,failed).state,'blocked');
 assert.throws(()=>nextAdmission(s,[...failed,normal[3]]),/admission-after-unqualified-terminal/);
 const cancelled=[{...normal[0],status:'cancelled'}];
 assert.equal(nextAdmission(s,cancelled).state,'blocked');
 assert.equal(nextAdmission(s,[...normal.slice(0,17),{...normal[17],status:'failed'}]).state,'blocked');
 const unknown=[...normal,{id:'missing-usage',status:'unknown',dispatches:1}];
 assert.deepEqual(nextAdmission(s,unknown),{state:'stopped',reason:'unknown-charge',preserveReservation:true});
 assert.throws(()=>nextAdmission(s,[...unknown,{id:'transport-uncertain',status:'failed',dispatches:1}]),/too-many-terminal-records|admission-after-stop/);
 assert.throws(()=>nextAdmission(s,[{id:s.schedule[0].fixtureId,status:'accepted',dispatches:9}]),/dispatch-bound/);
});
test('unresolved manifest and execute refuse before any external side effect',async()=>{
 await assert.rejects(compileSchedule({productionManifest:{profile:null}}));
 assert.throws(rejectExecute,/execute-disabled/);
 assert.equal(frozenSchedule()[0].primarySeed,104729);
});
