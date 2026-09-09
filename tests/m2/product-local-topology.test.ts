import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

type Config={name:string;vars:Record<string,string>;durable_objects:{bindings:Array<{name:string;class_name:string}>};services:Array<{binding:string;service:string;entrypoint:string}>;containers:Array<{class_name:string;image:string;image_build_context?:string}>;exports:Record<string,{container?:string}>;r2_buckets:Array<{binding:string}>;secrets:{required:string[]}};
const config=JSON.parse(readFileSync(new URL('../../infra/wrangler.m2-product-local.jsonc',import.meta.url),'utf8')) as Config;

test('complete local product topology names Turn, Service and Preview authorities while execution gates default closed',()=>{
  assert.equal(config.name,'riffology-m2-product-local');assert.equal(config.vars.M2_TURNS_ENABLED,'false');assert.equal(config.vars.M2_MODEL_PROVIDER_ENABLED,'false');
  assert.equal(config.vars.M3_SERVICE_ENABLED,'false');assert.equal(config.vars.M3_PREVIEW_ENABLED,'false');assert.equal(config.vars.M3_PREVIEW_WS_ENABLED,'false');
  assert.equal(config.vars.M2_MODEL_BUDGET_POLICY_VERSION,config.vars.MODEL_BUDGET_POLICY_VERSION);
  assert.deepEqual(new Set(config.durable_objects.bindings.map(value=>value.name)),new Set(['TENANT_QUOTA','WORKSPACE_AGENT','PROJECT_RUNTIME','PRODUCT_TURN_RUNTIME','REVISION_STORE','TOOL_ARTIFACT_STORE','TENANT_MODEL_BUDGET','PROJECT_SANDBOX','TRUSTED_PI_SANDBOX','TOOL_BRIDGE_AGENT','SERVICE_RUN','SERVICE_RUNTIME','SERVICE_SANDBOX']));
  assert.deepEqual(config.services,[{binding:'TOOL_BRIDGE',service:config.name,entrypoint:'ToolBridgeService'},{binding:'MODEL_PROXY',service:config.name,entrypoint:'ModelProxyService'}]);
  assert.deepEqual(config.containers.map(value=>value.class_name),['ProjectRuntime','ProjectToolSandbox','TrustedPiSandbox','ServiceSandbox']);assert.equal(config.r2_buckets[0]?.binding,'WORKSPACE_CHECKPOINTS');
  assert.equal(config.containers[0]?.image,'../services/runtime/Dockerfile.cloud');assert.doesNotMatch(JSON.stringify(config),/m0-|Dockerfile\.local/);
  assert.equal(config.containers.find(value=>value.class_name==='ServiceSandbox')?.image_build_context,'..');
  assert.match(readFileSync(new URL('../../services/runtime/Dockerfile.cloud',import.meta.url),'utf8'),/^EXPOSE 8080$/m);
  assert.equal(config.exports.ProjectToolSandbox?.container,'riffology-m2-project-sandbox-local');assert.equal(config.exports.TrustedPiSandbox?.container,'riffology-m2-trusted-pi-local');assert.equal(config.exports.ServiceSandbox?.container,'riffology-m3-service-local');
  assert.match(readFileSync(new URL('../../services/gateway/index.ts',import.meta.url),'utf8'),/export \{ ServiceRun \} from '\.\.\/run\/durable\.ts';[\s\S]*export \{ ServiceRuntime \} from '\.\.\/run\/runtime-durable\.ts';[\s\S]*export \{ ServiceSandbox \} from '\.\.\/run\/service-sandbox\.ts';/);
  assert.match(readFileSync(new URL('../../Dockerfile.trusted-pi.cloud',import.meta.url),'utf8'),/release-unconfigured\.mjs \/opt\/riffology\/trusted-pi\/trusted-pi-release\.mjs/);
  const vertical=readFileSync(new URL('../../Dockerfile.trusted-pi.vertical',import.meta.url),'utf8');assert.match(vertical,/release-candidate\.mjs \/opt\/riffology\/trusted-pi\/trusted-pi-release\.mjs/);assert.doesNotMatch(vertical,/release-unconfigured\.mjs/);
});

test('candidate config declares every private key and no secret value',()=>{
  assert.deepEqual(new Set(config.secrets.required),new Set(['BETTER_AUTH_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','M2_MODEL_PROXY_REQUEST_KEY','M2_TOOL_BRIDGE_REQUEST_KEY','M2_MODEL_TURN_CAPABILITY_KEY','M2_PROJECT_EFFECT_CAPABILITY_KEY','M2_OPENCODE_GO_API_KEY']));
  for(const name of config.secrets.required)assert.equal(Object.hasOwn(config.vars,name),false);
});
