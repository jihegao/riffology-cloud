import {compileG5ProductionOverlay} from './g5-production-overlay.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileG5Freeze,persistG5Freeze} from './g5-window-freeze.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
function input(){return {profile:{schemaVersion:1,profileVersion:'offline-fixture-v1',inferenceProvider:'openai',model:'gpt-5.6-luna',protocol:'openai-responses',billing:'platform-byok',gateway:{kind:'cloudflare',accountId:'b'.repeat(32),gatewayId:'offline-fixture'},secrets:{provider:'PRODUCTION_OPENAI_API_KEY',gateway:'PRODUCTION_AI_GATEWAY_TOKEN'},acceptance:{evidenceSha256:hash('fixture-acceptance-not-actual'),privacyReviewSha256:hash('fixture-privacy-not-actual')},rates:{version:'fixture-rate',currency:'USD',inputNanodollarsPerToken:250,outputNanodollarsPerToken:1200},limits:{maxInputTokens:262144,maxOutputTokens:4096}},principals:[{tenantId:'10000000-0000-4000-8000-000000000001',userId:'20000000-0000-4000-8000-000000000001'},{tenantId:'10000000-0000-4000-8000-000000000002',userId:'20000000-0000-4000-8000-000000000002'}],windowIds:{A:'g5-offline-fixture-A',B:'g5-offline-fixture-B'},authorizationReference:'offline-contract-fixture-not-live-approval',sourceSha256:hash('source-fixture'),rateCardSha256:hash('rate-fixture'),targets:{p95TurnMs:60000,maxCostPerAcceptedTaskNanodollars:1000000000}};}
const base={name:'existing-worker',vars:{MODEL_BUDGET_POLICY_VERSION:'old-g4',MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN:'8',G4_CONTROLLED_WINDOW_JSON:'old-historical-fence',OTHER_LIVE_VAR:'keep'},durable_objects:{bindings:[{name:'TENANT_MODEL_BUDGET',class_name:'TenantModelBudget',namespace_id:'original-ns'}]},exports:{TenantModelBudget:{type:'durable-object',storage:'sqlite'}},secrets:{required:['LEGACY_SECRET']},routes:[{pattern:'existing.example'}],containers:[{name:'keep',image:'old-sha'}],migrations:[{tag:'old',new_sqlite_classes:['TenantModelBudget']}]};
test('closed overlay preserves legacy IDs/runtime and shares monetary epoch across phases',async()=>{
 const value=input(),bundle=await compileG5Freeze(value);
 assert.equal(bundle.sanitizedManifest.kind,'closed-frozen-window-not-admission');
 const a=await compileG5ProductionOverlay(base,bundle,'A',{sourceSha256:value.sourceSha256}),b=await compileG5ProductionOverlay(base,bundle,'B',{sourceSha256:value.sourceSha256});
 assert.deepEqual(a.routes,base.routes);assert.deepEqual(a.containers,base.containers);assert.deepEqual(a.migrations,base.migrations);assert.deepEqual(a.durable_objects.bindings[0],base.durable_objects.bindings[0]);
 assert.equal(a.vars.MODEL_BUDGET_POLICY_VERSION,'old-g4');assert.equal(a.vars.G4_CONTROLLED_WINDOW_JSON,'old-historical-fence');assert.equal(a.vars.OTHER_LIVE_VAR,'keep');
 assert.equal(a.vars.M2_MODEL_PROVIDER,'openai');assert.equal(a.vars.M3_SERVICE_ENABLED,'false');assert.equal(a.vars.G5_ADMISSION_ENABLED,'false');
 assert.equal(a.vars.PRODUCTION_MONEY_POLICY_JSON,b.vars.PRODUCTION_MONEY_POLICY_JSON);
 assert.equal(a.durable_objects.bindings.length,4);assert.ok(a.secrets.required.includes('PRODUCTION_AI_GATEWAY_TOKEN'));
 assert.deepEqual(base.vars,{MODEL_BUDGET_POLICY_VERSION:'old-g4',MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN:'8',G4_CONTROLLED_WINDOW_JSON:'old-historical-fence',OTHER_LIVE_VAR:'keep'});
});
test('source drift, forged bundle, enabled gate and conflicting existing binding reject',async()=>{
 const value=input(),bundle=await compileG5Freeze(value);
 await assert.rejects(compileG5ProductionOverlay(base,bundle,'A',{sourceSha256:hash('other-source')}));
 const changed=structuredClone(bundle);changed.privatePolicies.patches.A.G5_ADMISSION_ENABLED='true';
 await assert.rejects(compileG5ProductionOverlay(base,changed,'A',{sourceSha256:value.sourceSha256}));
 const conflicting=structuredClone(base);conflicting.durable_objects.bindings.push({name:'G5_TOKEN_BUDGET',class_name:'TenantModelBudget'});
 await assert.rejects(compileG5ProductionOverlay(conflicting,bundle,'A',{sourceSha256:value.sourceSha256}),/binding-conflict/);
});
