import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileG5Freeze,persistG5Freeze} from './g5-window-freeze.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const rollover=targetWindowId=>{const sourceTurnKey=hash('old-turn'),binding={schemaVersion:1,sourceWindowId:'g5-old-window-20260916',sourceCallKey:hash('old-call'),sourceTurnKey,sourceProjectId:'old-project-id',sourceSessionId:'old-session-id',sourceTurnId:'old-turn-id',sourceIntentKeySha256:hash('old-intent'),sourceTasks:2,sourceDispatches:1,sourceSimulationRuns:0,sourceServiceRuns:0,sourceReservedNanodollars:9_910_450,sourceMoneyPeriod:'g5-money-period-20260916',sourceAuthorityReceiptSha256:hash('old-authority'),authorizationSha256:hash('rollover-authorization'),targetWindowId,newIntentNamespace:`${targetWindowId}-`};return {...binding,receiptSha256:createHash('sha256').update(JSON.stringify({purpose:'g5-a-one-time-rollover-v1',...binding})).digest('hex')};};
function input(){const target='g5-offline-fixture-A';return {profile:{schemaVersion:1,profileVersion:'offline-fixture-v1',inferenceProvider:'openai',model:'gpt-5.6-luna',protocol:'openai-responses',billing:'platform-byok',gateway:{kind:'cloudflare',accountId:'b'.repeat(32),gatewayId:'offline-fixture'},secrets:{provider:'PRODUCTION_OPENAI_API_KEY',gateway:'PRODUCTION_AI_GATEWAY_TOKEN'},acceptance:{evidenceSha256:hash('fixture-acceptance-not-actual'),privacyReviewSha256:hash('fixture-privacy-not-actual')},rates:{version:'fixture-rate',currency:'USD',inputNanodollarsPerToken:250,outputNanodollarsPerToken:1200},limits:{maxInputTokens:262144,maxOutputTokens:4096}},principals:[{tenantId:'10000000-0000-4000-8000-000000000001',userId:'20000000-0000-4000-8000-000000000001'},{tenantId:'10000000-0000-4000-8000-000000000002',userId:'20000000-0000-4000-8000-000000000002'}],windowIds:{A:target,B:'g5-offline-fixture-B'},authorizationReference:'offline-contract-fixture-not-live-approval',sourceSha256:hash('source-fixture'),rateCardSha256:hash('rate-fixture'),targets:{p95TurnMs:60000,maxCostPerAcceptedTaskNanodollars:1000000000},rollover:rollover(target)};}
test('strict two-window freeze preserves shared epoch, closed-first and sanitized identities',async()=>{
 const value=input(),out=await compileG5Freeze(value),a=out.privatePolicies.windows.A,b=out.privatePolicies.windows.B;
 assert.equal(a.maxTasks,64);assert.equal(a.maxUpstreamDispatches,146);assert.equal(a.totalNanodollars,19_990_089_550);assert.equal(b.maxTasks,24);assert.equal(a.maxSimulationRuns,39);assert.equal(b.maxSimulationRuns,0);assert.equal(a.durationMs,7200000);
 assert.equal(out.sanitizedManifest.maximumNanodollars.A,10285875200);assert.equal(out.sanitizedManifest.maximumNanodollars.B,11835801600);assert.equal(a.rollover.newIntentNamespace,`${a.windowId}-`);assert.equal(out.privatePolicies.money.period,a.rollover.sourceMoneyPeriod);
 assert.equal(out.privatePolicies.money.caps.global,40000000000);assert.equal(out.privatePolicies.money.enabled,false);
 for(const patch of Object.values(out.closedFirstPatch))assert.equal(patch.G5_ADMISSION_ENABLED,'false');
 const publicBytes=JSON.stringify(out.sanitizedManifest);for(const p of value.principals)for(const id of Object.values(p))assert.equal(publicBytes.includes(id),false);
 assert.equal(publicBytes.includes(value.authorizationReference),false);assert.equal(publicBytes.includes(value.profile.gateway.accountId),false);
});
test('incomplete/same-principal/fakehash/openflag/price/target drift fail closed',async()=>{
 for(const mutate of [v=>delete v.authorizationReference,v=>v.sourceSha256='a'.repeat(64),v=>v.G5_ADMISSION_ENABLED='true',v=>v.principals[1].tenantId=v.principals[0].tenantId,v=>v.principals[1].userId=v.principals[0].userId,v=>v.profile.rates.inputNanodollarsPerToken=200,v=>v.targets.maxCostPerAcceptedTaskNanodollars=1]){const v=input();mutate(v);await assert.rejects(compileG5Freeze(v));}
});
test('rollover receipt, residual occupancy, money period and new intent namespace are immutable',async()=>{for(const mutate of [v=>v.rollover.receiptSha256=hash('forged-rollover'),v=>v.rollover.sourceTasks=1,v=>v.rollover.sourceReservedNanodollars++,v=>v.rollover.sourceMoneyPeriod='g5-other-period-20260916',v=>v.rollover.newIntentNamespace=`${v.rollover.sourceWindowId}-`,v=>v.rollover.sourceAuthorityReceiptSha256='f'.repeat(64)]){const value=input();mutate(value);await assert.rejects(compileG5Freeze(value));}});
test('private wx writes recover identical partial output and never overwrite changed policy',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'g5-freeze-test-')),directory=join(parent,'bundle'),out=await compileG5Freeze(input());
 await persistG5Freeze(directory,out);await persistG5Freeze(directory,out);
 assert.equal((await stat(directory+'/private-policies.json')).mode&0o777,0o600);
 const before=await readFile(directory+'/private-policies.json','utf8');
 const modified=structuredClone(out);modified.privatePolicies.money.period='other-period';
 await assert.rejects(persistG5Freeze(directory,modified),/output-conflict/);assert.equal(await readFile(directory+'/private-policies.json','utf8'),before);
});
