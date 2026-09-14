import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runPreflight, validateSecretFile, validateStagingConfig } from '../../scripts/m1/staging-preflight.mjs';

const config = {
  name:'riffology-m1-gateway-staging', account_id:'8b0d70250211aa10d89e20605a1c7e5e', workers_dev:false, preview_urls:false,
  routes:[{pattern:'m1.riff-demo.gaojihe.cn',custom_domain:true}],
  assets:{directory:'../services/web',binding:'ASSETS',run_worker_first:true},
  secrets:{required:['BETTER_AUTH_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET']},
  vars:{APP_ORIGIN:'https://m1.riff-demo.gaojihe.cn',TENANT_QUOTA_CAPACITY:'1',TENANT_QUOTA_POLICY_VERSION:'m1-v1',M2_TURNS_ENABLED:'false'},
  d1_databases:[{binding:'CATALOG',database_name:'riffology-catalog-staging',database_id:'993f2fd9-a135-4a93-9caa-10828dec6635',migrations_dir:'../services/catalog/migrations'}],
  durable_objects:{bindings:[{name:'TENANT_QUOTA',class_name:'TenantQuota'},{name:'WORKSPACE_AGENT',class_name:'WorkspaceAgent'},{name:'PROJECT_RUNTIME',class_name:'ProjectRuntime'},{name:'PRODUCT_TURN_RUNTIME',class_name:'ProductTurnRuntime'},{name:'REVISION_STORE',class_name:'RevisionStore'}]},
  containers:[{name:'riffology-m1-project-staging',class_name:'ProjectRuntime',image:'../services/runtime/Dockerfile.cloud',instance_type:'basic',max_instances:2}],
  exports:{TenantQuota:{type:'durable-object',storage:'sqlite'},WorkspaceAgent:{type:'durable-object',storage:'sqlite'},ProductTurnRuntime:{type:'durable-object',storage:'sqlite'},RevisionStore:{type:'durable-object',storage:'sqlite'},ProjectRuntime:{type:'durable-object',storage:'sqlite',container:'riffology-m1-project-staging'}},
  r2_buckets:[{binding:'WORKSPACE_CHECKPOINTS',bucket_name:'riffology-m1-workspace-checkpoints-staging'}],
};
const dockerfile='FROM node:22.19.0-bookworm-slim@sha256:'+ 'a'.repeat(64)+'\nWORKDIR /workspace\nUSER node\n';
const migrations=['0001_catalog.sql','0002_auth.sql','0003_provisioning.sql','0004_operator_invitations.sql','0005_initial_operator.sql','0006_model_catalog.sql','0007_model_content_checks.sql','0008_preview_routes.sql','0009_model_submissions.sql'];

test('staging contract accepts the isolated M1 topology',()=>{
  assert.equal(validateStagingConfig(config,dockerfile,migrations).every(item=>item.status==='passed'),true);
  assert.equal(validateStagingConfig(config,dockerfile,[...migrations,'0010_unreviewed.sql']).find(item=>item.name==='catalog-migrations').status,'failed');
});
test('repository staging files pass every check before deployment credentials',()=>{
  const result=runPreflight();
  assert.equal(result.status,'blocked');
  assert.deepEqual(result.checks.filter(item=>item.status!=='passed'),[
    {name:'deployment-secrets',status:'blocked',detail:'secrets-file-not-supplied'},
  ]);
});
test('staging contract rejects old worker routes, fallback, M0 storage, cron, and expanded capacity',()=>{
  const bad=structuredClone(config);
  bad.name='riffology-demo';bad.workers_dev=true;bad.routes=[{pattern:'*.preview.riff-demo.gaojihe.cn/*'}];
  bad.d1_databases[0].database_name='local-catalog';bad.r2_buckets[0].bucket_name='riffology-m0-checkpoints-staging';
  bad.triggers={crons:['* * * * *']};bad.containers[0].max_instances=3;
  bad.vars.M2_TURNS_ENABLED='true';
  bad.migrations=[{tag:'legacy',new_sqlite_classes:['TenantQuota']}];delete bad.exports.WorkspaceAgent;
  const failures=validateStagingConfig(bad,dockerfile,migrations).filter(item=>item.status==='failed').map(item=>item.name);
  for(const name of ['worker-name','no-legacy-or-fallback','single-custom-domain','dedicated-d1','dedicated-r2','do-exports','container-budget','cron-disabled','turn-runtime-gate'])assert.ok(failures.includes(name));
});
test('secret validation checks names and file mode without returning values',()=>{
  const dir=mkdtempSync(resolve(tmpdir(),'riffology-m1-secret-test-')),path=resolve(dir,'secrets.json');
  writeFileSync(path,JSON.stringify({BETTER_AUTH_SECRET:'a'.repeat(32),GOOGLE_CLIENT_ID:'b'.repeat(16),GOOGLE_CLIENT_SECRET:'c'.repeat(16)}));
  chmodSync(path,0o600);assert.equal(validateSecretFile(path).status,'passed');
  chmodSync(path,0o644);assert.equal(validateSecretFile(path).detail,'secrets-file-permissions');
  assert.equal(JSON.stringify(validateSecretFile(path)).includes('aaaa'),false);
});
