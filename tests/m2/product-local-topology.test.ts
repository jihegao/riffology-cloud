import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

type Config={name:string;vars:Record<string,string>;durable_objects:{bindings:Array<{name:string;class_name:string}>};services:Array<{binding:string;service:string;entrypoint:string}>;containers:Array<{class_name:string;image:string}>;exports:Record<string,{container?:string}>;r2_buckets:Array<{binding:string}>;secrets:{required:string[]}};
const config=JSON.parse(readFileSync(new URL('../../infra/wrangler.m2-product-local.jsonc',import.meta.url),'utf8')) as Config;

test('complete local product topology names every authority while both release gates default closed',()=>{
  assert.equal(config.name,'riffology-m2-product-local');assert.equal(config.vars.M2_TURNS_ENABLED,'false');assert.equal(config.vars.M2_MODEL_PROVIDER_ENABLED,'false');
  assert.equal(config.vars.M2_MODEL_BUDGET_POLICY_VERSION,config.vars.MODEL_BUDGET_POLICY_VERSION);
  assert.deepEqual(new Set(config.durable_objects.bindings.map(value=>value.name)),new Set(['TENANT_QUOTA','WORKSPACE_AGENT','PROJECT_RUNTIME','PRODUCT_TURN_RUNTIME','REVISION_STORE','TOOL_ARTIFACT_STORE','TENANT_MODEL_BUDGET','PROJECT_SANDBOX','TRUSTED_PI_SANDBOX','TOOL_BRIDGE_AGENT']));
  assert.deepEqual(config.services,[{binding:'TOOL_BRIDGE',service:config.name,entrypoint:'ToolBridgeService'},{binding:'MODEL_PROXY',service:config.name,entrypoint:'ModelProxyService'}]);
  assert.deepEqual(config.containers.map(value=>value.class_name),['ProjectRuntime','ProjectToolSandbox','TrustedPiSandbox']);assert.equal(config.r2_buckets[0]?.binding,'WORKSPACE_CHECKPOINTS');
  assert.equal(config.containers[0]?.image,'../services/runtime/Dockerfile.cloud');assert.doesNotMatch(JSON.stringify(config),/m0-|Dockerfile\.local/);
  assert.match(readFileSync(new URL('../../services/runtime/Dockerfile.cloud',import.meta.url),'utf8'),/^EXPOSE 8080$/m);
  assert.equal(config.exports.ProjectToolSandbox?.container,'riffology-m2-project-sandbox-local');assert.equal(config.exports.TrustedPiSandbox?.container,'riffology-m2-trusted-pi-local');
});

test('candidate config declares every private key and no secret value',()=>{
  assert.deepEqual(new Set(config.secrets.required),new Set(['BETTER_AUTH_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','M2_MODEL_PROXY_REQUEST_KEY','M2_TOOL_BRIDGE_REQUEST_KEY','M2_MODEL_TURN_CAPABILITY_KEY','M2_PROJECT_EFFECT_CAPABILITY_KEY','M2_OPENCODE_GO_API_KEY']));
  for(const name of config.secrets.required)assert.equal(Object.hasOwn(config.vars,name),false);
});
