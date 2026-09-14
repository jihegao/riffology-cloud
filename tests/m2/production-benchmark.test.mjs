import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { benchmarkPlan } from '../../scripts/model/benchmark-plan.mjs';
import { profile } from './production-profile-fixture.ts';
import { profileDigest } from '../../services/model-proxy/production-profile.ts';
test('offline benchmark requires external inputs and bounds every one of 18 attempts',async()=>{
 const template=JSON.parse(await readFile(new URL('../../docs/production-model-benchmark.example.json',import.meta.url),'utf8'));await assert.rejects(benchmarkPlan(template));
 const input={profile,profileSha256:await profileDigest(profile),runtimeSha256:'a'.repeat(64),taskFixturesSha256:'b'.repeat(64),privacyEvidenceSha256:'c'.repeat(64),gatewayNoRetryEvidenceSha256:'d'.repeat(64),operator:'fixture',accountReference:'fixture-account',authorizationReference:'fixture-offline-only',rateCardSource:'https://example.test/fixture-not-price',rateCardCheckedAt:'2026-09-14',deadline:'2026-09-15',maxCallsPerTask:4,concurrency:1,globalCapNanodollars:2000000,turnCapNanodollars:100000,targets:{p95TurnMs:30000,maxCostPerAcceptedTaskNanodollars:100000}};
 const plan=await benchmarkPlan(input);assert.equal(plan.attempts.length,18);assert.equal(plan.kind,'offline-evaluation-plan-not-authorization');assert.equal(plan.maximumNanodollars,1476000);
 for(const patch of [{globalCapNanodollars:1},{profileSha256:'f'.repeat(64)},{concurrency:5},{privacyEvidenceSha256:null},{operator:null}])await assert.rejects(benchmarkPlan({...input,...patch}));
});
