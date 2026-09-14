#!/usr/bin/env node
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {promises as dns} from 'node:dns';
import {connect as tlsConnect,checkServerIdentity} from 'node:tls';
import {
  PRODUCT_TOOL_BRIDGE_SHA256,
  PRODUCT_TOOL_LEDGER_SCHEMA_SHA256,
  PRODUCT_TOOL_LEDGER_SCHEMA_VERSION,
  PRODUCT_TOOL_PROTOCOL_VERSION,
  validateSecretSources,
} from './vertical-runtime-preflight.mjs';

export const STAGING_CONFIG='infra/wrangler.m3-vertical-staging.jsonc';
export const ACCOUNT_ID='8b0d70250211aa10d89e20605a1c7e5e';
export const WORKER_NAME='riffology-m1-gateway-staging';
export const CONTROL_ORIGIN='https://m1.riff-demo.gaojihe.cn';
export const PREVIEW_ORIGIN='https://preview.m1.riff-demo.gaojihe.cn';
export const PREVIEW_ROUTE='*.preview.m1.riff-demo.gaojihe.cn/*';
export const STAGING_DATABASE=Object.freeze({name:'riffology-catalog-staging-v3-20260911',id:'f122099b-8eaa-4eca-83a0-755de0f8b46b'});
export const STAGING_CHECKPOINT_BUCKET='riffology-workspace-checkpoints-staging-v3-20260911';
export const STAGING_MODEL_BUCKET='riffology-m3-model-content-staging';
export const REQUIRED_SECRETS=Object.freeze([
  'BETTER_AUTH_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','M2_MODEL_PROXY_REQUEST_KEY',
  'M2_TOOL_BRIDGE_REQUEST_KEY','M2_MODEL_TURN_CAPABILITY_KEY','M2_PROJECT_EFFECT_CAPABILITY_KEY',
  'M2_OPENCODE_GO_API_KEY',
]);
export const REQUIRED_BINDINGS=Object.freeze([
  'TENANT_QUOTA','TRUSTED_PI_CAPACITY','WORKSPACE_AGENT','PROJECT_RUNTIME','PRODUCT_TURN_RUNTIME','REVISION_STORE',
  'TOOL_ARTIFACT_STORE','TENANT_MODEL_BUDGET','PROJECT_SANDBOX','TRUSTED_PI_SANDBOX',
  'TOOL_BRIDGE_AGENT','SERVICE_RUN','SERVICE_RUNTIME','SERVICE_SANDBOX',
]);
export const REQUIRED_EXPORTS=Object.freeze([
  'TenantQuota','TrustedPiCapacity','WorkspaceAgent','ProjectRuntime','ProductTurnRuntime','RevisionStore','ToolArtifactStore',
  'TenantModelBudget','ProjectToolSandbox','TrustedPiSandbox','ToolBridgeAgent','ServiceRun','ServiceRuntime','ServiceSandbox',
]);
export const REQUIRED_CONTAINERS=Object.freeze(['ProjectRuntime','ProjectToolSandbox','TrustedPiSandbox','ServiceSandbox']);
export const REQUIRED_MIGRATIONS=Object.freeze([
  '0001_catalog.sql','0002_auth.sql','0003_provisioning.sql','0004_operator_invitations.sql',
  '0005_initial_operator.sql','0006_model_catalog.sql','0007_model_content_checks.sql','0008_preview_routes.sql','0009_model_submissions.sql',
]);
const REGISTRY=`registry.cloudflare.com/${ACCOUNT_ID}/`;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const WORKER_SHA=/^[a-f0-9]{40}$/;
const WORKER_VERSION_ID=/^[a-f0-9-]{36}$/;
export const WORKER_VERSION_METADATA_BINDING='CF_VERSION_METADATA';
export const RELEASE_METADATA_VARS=Object.freeze({
  workerSourceSha:'M2_WORKER_SOURCE_SHA',
  toolBridgeSha256:'M2_TOOL_BRIDGE_SHA256',
  toolProtocolVersion:'M2_TOOL_PROTOCOL_VERSION',
  toolLedgerSchemaVersion:'M2_TOOL_LEDGER_SCHEMA_VERSION',
  toolLedgerSchemaSha256:'M2_TOOL_LEDGER_SCHEMA_SHA256',
});
const check=(name,ok,detail)=>({name,status:ok?'passed':'blocked',...(ok||!detail?{}:{detail})});
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const command=(bin,args,timeout=60_000)=>spawnSync(bin,args,{encoding:'utf8',timeout,maxBuffer:4*1024*1024});
const json=path=>JSON.parse(readFileSync(path,'utf8'));

export function createStagingConfigOverlay(root,{turnsEnabled=true,workerSha=null}={}){
  const sourcePath=resolve(root,STAGING_CONFIG),config=json(sourcePath);
  config.vars={...config.vars,M2_TURNS_ENABLED:turnsEnabled?'true':'false'};
  if(workerSha!==null){
    config.vars={...config.vars,
      [RELEASE_METADATA_VARS.workerSourceSha]:workerSha,
      [RELEASE_METADATA_VARS.toolBridgeSha256]:PRODUCT_TOOL_BRIDGE_SHA256,
      [RELEASE_METADATA_VARS.toolProtocolVersion]:PRODUCT_TOOL_PROTOCOL_VERSION,
      [RELEASE_METADATA_VARS.toolLedgerSchemaVersion]:PRODUCT_TOOL_LEDGER_SCHEMA_VERSION,
      [RELEASE_METADATA_VARS.toolLedgerSchemaSha256]:PRODUCT_TOOL_LEDGER_SCHEMA_SHA256,
    };
  }
  const path=resolve(root,'infra',`.vertical-runtime-${turnsEnabled?'release':'paused'}-${crypto.randomUUID()}.jsonc`);
  writeFileSync(path,`${JSON.stringify(config,null,2)}\n`,{encoding:'utf8',mode:0o600,flag:'wx'});
  let removed=false;
  return {path,config,remove(){if(removed)return;removed=true;rmSync(path,{force:true});}};
}

export function validateStagingTopology(config,migrations,{release=false}={}){
  const routes=config.routes??[],custom=routes.filter(value=>value?.custom_domain===true),control=custom.find(value=>value.pattern===new URL(CONTROL_ORIGIN).hostname),previewBase=custom.find(value=>value.pattern===new URL(PREVIEW_ORIGIN).hostname),preview=routes.find(value=>value?.zone_name==='gaojihe.cn');
  const bindings=(config.durable_objects?.bindings??[]).map(value=>value.name);
  const exports=Object.keys(config.exports??{}).filter(name=>config.exports[name]?.type==='durable-object');
  const containers=config.containers??[],classes=containers.map(value=>value.class_name);
  const images=containers.every(value=>typeof value.image==='string'&&value.image.startsWith(REGISTRY)&&DIGEST.test(value.image.split('@')[1]??'')&&value.instance_type==='basic'&&value.max_instances===1);
  const services=config.services??[],serviceBindings=services.map(value=>value.binding);
  const releaseGates=['M2_TURNS_ENABLED','M2_MODEL_PROVIDER_ENABLED','M3_SERVICE_ENABLED','M3_PREVIEW_ENABLED','M3_PREVIEW_WS_ENABLED'];
  const gatesValid=release
    ? releaseGates.every(name=>config.vars?.[name]==='true')&&config.vars?.M3_OBSERVER_ENABLED==='false'
    : config.vars?.M2_TURNS_ENABLED==='false'&&releaseGates.slice(1).every(name=>config.vars?.[name]==='true')&&config.vars?.M3_OBSERVER_ENABLED==='false';
  const budget=config.vars?.M2_MODEL_BUDGET_POLICY_VERSION==='m2-token-vertical-v2'&&config.vars?.MODEL_BUDGET_POLICY_VERSION==='m2-token-vertical-v2'&&config.vars?.MODEL_BUDGET_MAX_RESERVATION_ATTEMPTS_PER_TURN==='8'&&config.vars?.MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN==='8'&&config.vars?.MODEL_BUDGET_MAX_INPUT_TOKENS_PER_CALL==='262144'&&config.vars?.MODEL_BUDGET_MAX_OUTPUT_TOKENS_PER_CALL==='4096'&&config.vars?.MODEL_BUDGET_MAX_RESERVED_TOKENS_PER_TURN==='532480';
  const r2=config.r2_buckets??[],service=containers.find(value=>value.class_name==='ServiceSandbox');
  return [
    check('worker-identity',config.name===WORKER_NAME&&config.account_id===ACCOUNT_ID&&config.workers_dev===false&&config.preview_urls===false,'use-existing-dedicated-staging-worker'),
    check('staging-origins',config.vars?.APP_ORIGIN===CONTROL_ORIGIN&&config.vars?.M3_PREVIEW_ORIGIN===PREVIEW_ORIGIN&&routes.length===3&&control&&previewBase&&preview?.pattern===PREVIEW_ROUTE,'declare-control-and-preview-base-custom-domains-plus-the-preview-wildcard-route'),
    check(release?'execution-gates-controlled-release':'turn-admission-paused',gatesValid,release?'release-requires-five-vertical-gates-true-and-observer-false':'maintenance-requires-turn-admission-false-with-read-and-preview-gates-retained'),
    check('tenant-capacity',config.vars?.TENANT_QUOTA_CAPACITY==='1'&&config.vars?.TRUSTED_PI_CAPACITY_LIMIT==='1'&&config.vars?.TRUSTED_PI_CAPACITY_POLICY_VERSION==='m2-trusted-pi-v1'&&containers.every(value=>value.max_instances===1),'retain-single-tenant-and-application-trusted-pi-capacity'),
    check('turn-operation-telemetry',config.vars?.M2_TURN_OPERATION_TELEMETRY==='true','enable-bounded-turn-lifecycle-metrics'),
    check('worker-version-metadata',config.version_metadata?.binding===WORKER_VERSION_METADATA_BINDING,'bind-queryable-worker-version-metadata'),
    check('model-budget',budget,'retain-reviewed-token-and-turn-budget'),
    check('required-secrets',same(config.secrets?.required??[],REQUIRED_SECRETS),'declare-only-the-eight-reviewed-secrets'),
    check('durable-bindings',same(bindings,REQUIRED_BINDINGS),'declare-complete-m2-m3-durable-bindings'),
    check('durable-exports',same(exports,REQUIRED_EXPORTS),'declare-complete-m2-m3-durable-exports'),
    check('container-images',same(classes,REQUIRED_CONTAINERS)&&images,'use-four-account-registry-digest-pinned-linux-amd64-images'),
    check('service-image-pin',typeof config.vars?.M3_SERVICE_IMAGE==='string'&&config.vars.M3_SERVICE_IMAGE===service?.image,'service-policy-must-pin-deployed-service-image'),
    check('private-services',same(serviceBindings,['MODEL_PROXY','TOOL_BRIDGE'])&&services.every(value=>value.service===WORKER_NAME)&&services.find(value=>value.binding==='MODEL_PROXY')?.entrypoint==='ModelProxyService'&&services.find(value=>value.binding==='TOOL_BRIDGE')?.entrypoint==='ToolBridgeService','use-only-two-self-bound-private-services'),
    check('dedicated-storage',config.d1_databases?.length===1&&config.d1_databases[0]?.database_name===STAGING_DATABASE.name&&config.d1_databases[0]?.database_id===STAGING_DATABASE.id&&r2.length===2&&r2.some(value=>value.binding==='WORKSPACE_CHECKPOINTS'&&value.bucket_name===STAGING_CHECKPOINT_BUCKET)&&r2.some(value=>value.binding==='MODEL_CONTENT'&&value.bucket_name===STAGING_MODEL_BUCKET)&&STAGING_CHECKPOINT_BUCKET!==STAGING_MODEL_BUCKET,'use-dedicated-staging-d1-and-r2-buckets'),
    check('recovery-cron',same(config.triggers?.crons??[],['* * * * *']),'retain-one-bounded-staging-recovery-sweep'),
    check('catalog-migrations',same(migrations,REQUIRED_MIGRATIONS),'include-catalog-migrations-0001-through-0009'),
    check('no-local-runtime-inputs',!JSON.stringify(config).includes('127.0.0.1')&&!JSON.stringify(config).includes('localhost')&&!Object.hasOwn(config.vars??{},'M1_GOOGLE_OAUTH_EGRESS_CAPABILITY')&&!Object.keys(config.vars??{}).some(name=>name.startsWith('M3_VERTICAL_')),'remove-loopback-local-proxy-and-vertical-telemetry-inputs'),
  ];
}

export function configuredImages(config){return (config.containers??[]).map(value=>({name:value.class_name,reference:value.image}));}
export function workerVersionTag(workerSha){return WORKER_SHA.test(workerSha??'')?`source-${workerSha}`:null;}
export function validateWorkerSource(root,workerSha,{release=false}={}){
  if(!release)return null;
  const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
  const dirty=spawnSync('git',['status','--porcelain=v1','--untracked-files=no'],{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
  const current=head.status===0?head.stdout.trim():null,trackedClean=dirty.status===0&&dirty.stdout.trim()==='';
  return check('worker-source-sha',typeof workerSha==='string'&&WORKER_SHA.test(workerSha)&&WORKER_SHA.test(current??'')&&workerSha===current&&trackedClean,'release-requires-clean-index-and-tracked-worktree-at-exact-worker-sha');
}
const byName=(a,b)=>String(a.name).localeCompare(String(b.name))||JSON.stringify(a).localeCompare(JSON.stringify(b));
export function canonicalDeployedResources(config){
  const bindings=[];
  for(const [name,text] of Object.entries(config.vars??{}))bindings.push({name,type:'plain_text',text:String(text)});
  for(const name of config.secrets?.required??[])bindings.push({name,type:'secret_text'});
  if(typeof config.assets?.binding==='string')bindings.push({name:config.assets.binding,type:'assets'});
  if(typeof config.version_metadata?.binding==='string')bindings.push({name:config.version_metadata.binding,type:'version_metadata'});
  for(const value of config.d1_databases??[])bindings.push({name:value.binding,type:'d1',databaseId:value.database_id});
  for(const value of config.r2_buckets??[])bindings.push({name:value.binding,type:'r2_bucket',bucketName:value.bucket_name});
  for(const value of config.services??[])bindings.push({name:value.binding,type:'service',service:value.service,entrypoint:value.entrypoint,environment:value.environment??'production'});
  for(const value of config.durable_objects?.bindings??[])bindings.push({name:value.name,type:'durable_object_namespace',className:value.class_name});
  const exports=Object.entries(config.exports??{}).map(([name,value])=>({name,type:value.type,storage:value.storage??null,container:value.container??null})).sort(byName);
  const containers=(config.containers??[]).map(value=>({name:value.name,className:value.class_name})).sort(byName);
  const handlers=[...Object.keys(config.exports??{}).map(name=>({name,handler:'class'})),...(config.services??[]).map(value=>({name:value.entrypoint,handler:'fetch'}))].sort(byName);
  return {bindings:bindings.sort(byName),exports,containers,handlers};
}
function observedDeployedResources(version){
  const resources=version?.resources,rawBindings=resources?.bindings,rawExports=resources?.script_runtime?.exports,rawContainers=resources?.script_runtime?.containers,rawHandlers=resources?.script?.named_handlers;
  if(!Array.isArray(rawBindings)||!rawExports||typeof rawExports!=='object'||Array.isArray(rawExports)||!Array.isArray(rawContainers)||!Array.isArray(rawHandlers))return null;
  const bindings=[];
  for(const value of rawBindings){
    if(!value||typeof value.name!=='string'||typeof value.type!=='string')return null;
    if(value.type==='plain_text')bindings.push({name:value.name,type:value.type,text:value.text});
    else if(value.type==='secret_text'||value.type==='assets'||value.type==='version_metadata')bindings.push({name:value.name,type:value.type});
    else if(value.type==='d1')bindings.push({name:value.name,type:value.type,databaseId:value.database_id??value.id});
    else if(value.type==='r2_bucket')bindings.push({name:value.name,type:value.type,bucketName:value.bucket_name});
    else if(value.type==='service')bindings.push({name:value.name,type:value.type,service:value.service,entrypoint:value.entrypoint,environment:value.environment??'production'});
    else if(value.type==='durable_object_namespace')bindings.push({name:value.name,type:value.type,className:value.class_name});
    else return null;
  }
  const exports=Object.entries(rawExports).map(([name,value])=>({name,type:value?.type,storage:value?.storage??null,container:value?.container??null})).sort(byName);
  const containers=rawContainers.map(value=>({name:value?.name,className:value?.class_name})).sort(byName);
  const handlers=[];for(const value of rawHandlers){if(typeof value?.name!=='string'||!Array.isArray(value.handlers))return null;for(const handler of value.handlers)handlers.push({name:value.name,handler});}
  return {bindings:bindings.sort(byName),exports,containers,handlers:handlers.sort(byName)};
}
function containerImagesMatch(manifest,containerApps){
  if(!Array.isArray(containerApps))return false;
  const expected=manifest?.containerImages??[];
  if(!Array.isArray(expected)||expected.length!==REQUIRED_CONTAINERS.length)return false;
  return expected.every(image=>{
    const configured=(manifest?.deployedResources?.containers??[]).find(value=>value.className===image.name),matches=containerApps.filter(value=>value?.name===configured?.name);
    return matches.length===1&&typeof matches[0]?.id==='string'&&matches[0].id.length>0&&matches[0]?.image===image.reference;
  });
}
export function buildReleaseManifest(config,workerSha){
  return {
    schemaVersion:1,
    workerSourceSha:typeof workerSha==='string'?workerSha:null,
    workerVersionTag:workerVersionTag(workerSha),
    workerVersionMetadataBinding:WORKER_VERSION_METADATA_BINDING,
    toolBridgeSha256:PRODUCT_TOOL_BRIDGE_SHA256,
    toolProtocolVersion:PRODUCT_TOOL_PROTOCOL_VERSION,
    toolLedgerSchemaVersion:PRODUCT_TOOL_LEDGER_SCHEMA_VERSION,
    toolLedgerSchemaSha256:PRODUCT_TOOL_LEDGER_SCHEMA_SHA256,
    containerImages:configuredImages(config),
    deployedResources:canonicalDeployedResources(config),
  };
}
export function validateReleaseManifest(config,manifest){
  const expectedImages=configuredImages(config);
  const toolBridge=config.services?.find(value=>value.binding==='TOOL_BRIDGE');
  const releaseMetadata=config.vars?.[RELEASE_METADATA_VARS.workerSourceSha]===manifest?.workerSourceSha&&config.vars?.[RELEASE_METADATA_VARS.toolBridgeSha256]===PRODUCT_TOOL_BRIDGE_SHA256&&config.vars?.[RELEASE_METADATA_VARS.toolProtocolVersion]===PRODUCT_TOOL_PROTOCOL_VERSION&&config.vars?.[RELEASE_METADATA_VARS.toolLedgerSchemaVersion]===PRODUCT_TOOL_LEDGER_SCHEMA_VERSION&&config.vars?.[RELEASE_METADATA_VARS.toolLedgerSchemaSha256]===PRODUCT_TOOL_LEDGER_SCHEMA_SHA256;
  const valid=manifest?.schemaVersion===1&&WORKER_SHA.test(manifest?.workerSourceSha??'')&&manifest?.workerVersionTag===workerVersionTag(manifest?.workerSourceSha)&&manifest?.workerVersionMetadataBinding===WORKER_VERSION_METADATA_BINDING&&config.version_metadata?.binding===WORKER_VERSION_METADATA_BINDING&&manifest?.toolBridgeSha256===PRODUCT_TOOL_BRIDGE_SHA256&&manifest?.toolProtocolVersion===PRODUCT_TOOL_PROTOCOL_VERSION&&manifest?.toolLedgerSchemaVersion===PRODUCT_TOOL_LEDGER_SCHEMA_VERSION&&manifest?.toolLedgerSchemaSha256===PRODUCT_TOOL_LEDGER_SCHEMA_SHA256&&same((manifest?.containerImages??[]).map(value=>`${value.name}:${value.reference}`),expectedImages.map(value=>`${value.name}:${value.reference}`))&&expectedImages.every(value=>typeof value.reference==='string'&&DIGEST.test(value.reference.split('@')[1]??''))&&JSON.stringify(manifest?.deployedResources)===JSON.stringify(canonicalDeployedResources(config))&&releaseMetadata&&config.exports?.ToolBridgeAgent?.storage==='sqlite'&&toolBridge?.service===config.name&&toolBridge?.entrypoint==='ToolBridgeService';
  return check('candidate-release-manifest',valid,'bridge-hash-protocol-ledger-schema-container-digests-or-tool-bridge-wiring-mismatch');
}
export function validateWorkerVersionResources(manifest,version,{turnsEnabled=true,containerApps=null}={}){
  const id=version?.id,observed=observedDeployedResources(version),expected=structuredClone(manifest?.deployedResources??null),expectedGate=turnsEnabled?'true':'false';
  if(expected?.bindings){const gate=expected.bindings.find(value=>value.name==='M2_TURNS_ENABLED'&&value.type==='plain_text');if(gate)gate.text=expectedGate;}
  const handlersValid=expected!==null&&observed!==null&&expected.handlers.every(required=>observed.handlers.some(value=>JSON.stringify(value)===JSON.stringify(required)));
  const resourcesValid=expected!==null&&observed!==null&&JSON.stringify({...observed,handlers:undefined})===JSON.stringify({...expected,handlers:undefined})&&handlersValid;
  const valid=WORKER_VERSION_ID.test(id??'')&&version?.annotations?.['workers/tag']===manifest?.workerVersionTag&&resourcesValid&&containerImagesMatch(manifest,containerApps);
  return check('worker-version-resources',valid,`candidate-requires-exact-tagged-turns-${turnsEnabled?'enabled':'disabled'}-resources-and-container-images`);
}
export function validateDeployedWorkerVersion(manifest,version,deployment,{turnsEnabled=true,containerApps=null}={}){
  const id=version?.id,versions=deployment?.versions??[],resources=validateWorkerVersionResources(manifest,version,{turnsEnabled,containerApps});
  const valid=resources.status==='passed'&&versions.length===1&&versions[0]?.version_id===id&&versions[0]?.percentage===100;
  return check('deployed-worker-version',valid,`release-requires-exact-tagged-turns-${turnsEnabled?'enabled':'disabled'}-resources-container-images-and-sole-100-percent-version`);
}
export function validatePredeployGateClosed(version,deployment){
  const id=version?.id,versions=deployment?.versions??[],bindings=version?.resources?.bindings??[];
  const valid=WORKER_VERSION_ID.test(id??'')&&versions.length===1&&versions[0]?.version_id===id&&versions[0]?.percentage===100&&bindings.some(value=>value?.type==='plain_text'&&value?.name==='M2_TURNS_ENABLED'&&value?.text==='false');
  return check('predeploy-turn-gate-closed',valid,'release-predeploy-requires-current-sole-100-percent-version-with-turn-admission-false');
}

export function inspectTrustedPiImageContent(reference,password,runner=spawnSync){
  if(typeof password!=='string'||password.length<16||typeof reference!=='string'||!reference.startsWith(REGISTRY)||!DIGEST.test(reference.split('@')[1]??''))throw Error('invalid-managed-image-input');
  const directory=mkdtempSync(resolve(tmpdir(),'riffology-registry-login-'));
  try{
    const context=runner('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}'],{encoding:'utf8',timeout:10_000,maxBuffer:1024*1024,env:process.env}),dockerHost=context.status===0?context.stdout.trim():'';
    if(!/^(?:unix|npipe|tcp):\/\//.test(dockerHost))throw Error('managed-image-docker-context-unavailable');
    const options={encoding:'utf8',timeout:60_000,maxBuffer:4*1024*1024,env:{...process.env,DOCKER_CONFIG:directory,DOCKER_HOST:dockerHost}};
    const login=runner('docker',['login','registry.cloudflare.com','--username','v1','--password-stdin'],{...options,input:password});
    if(login.status!==0)throw Error('managed-image-docker-login-failed');
    const probe=`const{readFile}=await import('node:fs/promises');const{createHash}=await import('node:crypto');const bytes=await readFile('/opt/riffology/trusted-pi/product-tool-bridge.mjs');process.stdout.write(JSON.stringify({toolBridgeSha256:createHash('sha256').update(bytes).digest('hex')}))`;
    const result=runner('docker',['run','--rm','--pull=always','--platform','linux/amd64','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--entrypoint','node',reference,'--input-type=module','-e',probe],options);
    if(result.status!==0)throw Error('managed-image-content-probe-failed');
    let value;try{value=JSON.parse(result.stdout);}catch{throw Error('managed-image-content-probe-invalid');}
    if(value?.toolBridgeSha256!==PRODUCT_TOOL_BRIDGE_SHA256)throw Error('managed-image-tool-bridge-mismatch');
    return {toolBridgeSha256:value.toolBridgeSha256};
  }finally{rmSync(directory,{recursive:true,force:true});}
}
export async function inspectManagedImage(reference,password,fetcher=fetch){
  if(typeof password!=='string'||password.length<16||typeof reference!=='string'||!reference.startsWith(REGISTRY))throw Error('invalid-managed-image-input');
  const [path,digest]=reference.slice('registry.cloudflare.com/'.length).split('@');if(!path||!DIGEST.test(digest??''))throw Error('invalid-managed-image-reference');
  const headers={authorization:`Basic ${Buffer.from(`v1:${password}`).toString('base64')}`,accept:'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json'};
  const base=`https://registry.cloudflare.com/v2/${path}`;
  const get=async url=>{const response=await fetcher(url,{headers,redirect:'manual'});if(!response.ok)throw Error(`managed-image-http-${response.status}`);return response;};
  let response=await get(`${base}/manifests/${digest}`);if(response.headers.get('docker-content-digest')!==digest)throw Error('managed-image-digest-mismatch');
  let manifest=await response.json(),manifestDigest=digest;
  if(Array.isArray(manifest.manifests)){
    const candidates=manifest.manifests.filter(value=>value?.platform?.os==='linux'&&value?.platform?.architecture==='amd64');
    if(candidates.length!==1||!DIGEST.test(candidates[0]?.digest??''))throw Error('managed-image-linux-amd64-manifest-missing');
    manifestDigest=candidates[0].digest;response=await get(`${base}/manifests/${manifestDigest}`);if(response.headers.get('docker-content-digest')!==manifestDigest)throw Error('managed-image-digest-mismatch');manifest=await response.json();
  }
  if(!DIGEST.test(manifest?.config?.digest??''))throw Error('managed-image-config-missing');
  const configResponse=await get(`${base}/blobs/${manifest.config.digest}`),image=await configResponse.json();
  if(image.os!=='linux'||image.architecture!=='amd64')throw Error('managed-image-platform-mismatch');
  return {digest,os:image.os,architecture:image.architecture};
}

async function validatePreviewDomain(release){
  const label=`p-${crypto.randomUUID().replaceAll('-','').slice(0,40)}`,host=`${label}.${new URL(PREVIEW_ORIGIN).hostname}`;
  let dnsOk=false;
  try{const values=[...await dns.resolve4(host),...await dns.resolve6(host).catch(()=>[])];dnsOk=values.length>0&&!values.some(value=>/^127\.|^::1$|^::ffff:127\./i.test(value));}catch{}
  let tlsOk=false;
  if(dnsOk)tlsOk=await new Promise(resolve=>{
    const socket=tlsConnect({host,port:443,servername:host,rejectUnauthorized:true});
    const timer=setTimeout(()=>{socket.destroy();resolve(false);},10_000);
    socket.once('secureConnect',()=>{const valid=socket.authorized&&checkServerIdentity(host,socket.getPeerCertificate())===undefined;clearTimeout(timer);socket.destroy();resolve(valid);});
    socket.once('error',()=>{clearTimeout(timer);resolve(false);});
  });
  return [
    check('preview-dns',dnsOk,'deploy-preview-base-custom-domain-and-wildcard-route'),
    tlsOk?check('preview-tls-san',true):release?check('preview-tls-san',false,'wait-for-free-managed-certificate-covering-preview-base-and-next-level-wildcard'):{name:'preview-tls-san',status:'pending',detail:'expected-until-the-gates-false-deploy-creates-the-preview-base-custom-domain'},
  ];
}
function parseJsonOutput(result){if(result.status!==0)throw Error('cloud-command-failed');return JSON.parse(result.stdout);}
export async function retryJsonCommand(runner,bin,args,{attempts=3,sleepFn=ms=>new Promise(resolve=>setTimeout(resolve,ms)),retryMs=2_000}={}){
  if(typeof runner!=='function'||typeof bin!=='string'||!Array.isArray(args)||!Number.isSafeInteger(attempts)||attempts<1||attempts>5||typeof sleepFn!=='function'||!Number.isSafeInteger(retryMs)||retryMs<0||retryMs>30_000)throw Error('cloud-command-retry-input-invalid');
  for(let attempt=1;attempt<=attempts;attempt++){try{return parseJsonOutput(runner(bin,args));}catch{if(attempt===attempts)throw Error('cloud-command-retries-exhausted');await sleepFn(retryMs);}}
}
async function cloudChecks(root,config,release,releaseManifest,workerVersionId,configPath,releasePhase=null){
  const wrangler=resolve(root,'node_modules/.bin/wrangler'),args=['--config',configPath];
  const checks=[];
  try{const rows=parseJsonOutput(command(wrangler,['d1','list','--json',...args]));checks.push(check('cloud-d1',rows.some(value=>value.name===STAGING_DATABASE.name&&value.uuid===STAGING_DATABASE.id),'create-reviewed-staging-d1'));}catch{checks.push(check('cloud-d1',false,'cloud-d1-query-failed'));}
  for(const bucket of [STAGING_CHECKPOINT_BUCKET,STAGING_MODEL_BUCKET]){const result=command(wrangler,['r2','bucket','info',bucket,...args]);checks.push(check(`cloud-r2:${bucket}`,result.status===0,`create-r2-bucket:${bucket}`));}
  try{const rows=await retryJsonCommand(command,wrangler,['secret','list','--format','json',...args]);const names=rows.map(value=>value.name);checks.push(check('cloud-secrets',REQUIRED_SECRETS.every(name=>names.includes(name)),`upload-missing-worker-secrets:${REQUIRED_SECRETS.filter(name=>!names.includes(name)).join(',')}`));}catch{checks.push(check('cloud-secrets',false,'cloud-secret-query-failed'));}
  const migrations=command(wrangler,['d1','migrations','list',STAGING_DATABASE.name,'--remote',...args]);
  const pending=migrations.status===0?[...migrations.stdout.matchAll(/\b(\d{4}_[A-Za-z0-9_.-]+\.sql)\b/g)].map(value=>value[1]):[];
  checks.push(check('cloud-catalog-migrations',migrations.status===0&&pending.length===0,pending.length?`apply-remote-migrations:${[...new Set(pending)].join(',')}`:'remote-migration-query-failed'));
  const credentials=command(wrangler,['containers','registries','credentials','registry.cloudflare.com','--pull','--expiration-minutes','5','--json',...args]);
  if(credentials.status!==0){for(const image of configuredImages(config))checks.push(check(`cloud-container-image:${image.name}`,false,'managed-registry-credentials-unavailable'));if(release)checks.push(check('cloud-trusted-pi-bridge-content',false,'managed-registry-credentials-unavailable'));}
  else{
    let password=null;try{password=JSON.parse(credentials.stdout).password;}catch{}
    for(const image of configuredImages(config)){
      if(typeof password!=='string'){checks.push(check(`cloud-container-image:${image.name}`,false,'managed-registry-credentials-invalid'));continue;}
      try{await inspectManagedImage(image.reference,password);checks.push(check(`cloud-container-image:${image.name}`,true));}
      catch(error){checks.push(check(`cloud-container-image:${image.name}`,false,error instanceof Error?error.message:'managed-image-inspection-failed'));}
    }
    if(release){
      const trusted=configuredImages(config).find(value=>value.name==='TrustedPiSandbox');
      if(typeof password!=='string'||!trusted)checks.push(check('cloud-trusted-pi-bridge-content',false,'trusted-pi-image-or-registry-credentials-unavailable'));
      else try{inspectTrustedPiImageContent(trusted.reference,password);checks.push(check('cloud-trusted-pi-bridge-content',true));}
      catch(error){checks.push(check('cloud-trusted-pi-bridge-content',false,error instanceof Error?error.message:'managed-image-content-probe-failed'));}
    }
  }
  if(releasePhase==='predeploy'){
    try{
      const deployment=await retryJsonCommand(command,wrangler,['deployments','status','--json',...args]),versions=deployment?.versions??[],activeId=versions.length===1&&versions[0]?.percentage===100?versions[0]?.version_id:null;
      if(!WORKER_VERSION_ID.test(activeId??''))checks.push(check('predeploy-turn-gate-closed',false,'release-predeploy-requires-one-active-worker-version'));
      else{const version=await retryJsonCommand(command,wrangler,['versions','view',activeId,'--json',...args]);checks.push(validatePredeployGateClosed(version,deployment));}
    }catch{checks.push(check('predeploy-turn-gate-closed',false,'current-worker-version-query-failed'));}
  }
  if(releasePhase==='postdeploy'){
    if(!WORKER_VERSION_ID.test(workerVersionId??''))checks.push(check('deployed-worker-version',false,'release-cloud-check-requires---worker-version-id'));
    else try{
      const version=await retryJsonCommand(command,wrangler,['versions','view',workerVersionId,'--json',...args]),deployment=await retryJsonCommand(command,wrangler,['deployments','status','--json',...args]),containerApps=await retryJsonCommand(command,wrangler,['containers','list','--json',...args]);
      checks.push(validateDeployedWorkerVersion(releaseManifest,version,deployment,{containerApps}));
    }catch{checks.push(check('deployed-worker-version',false,'worker-version-or-deployment-query-failed'));}
  }
  checks.push(...await validatePreviewDomain(release));
  return checks;
}
function dryRun(root,configPath,versionTag=null){const out=mkdtempSync(resolve(tmpdir(),'riffology-m3-staging-dry-run-'));try{return command(resolve(root,'node_modules/.bin/wrangler'),['deploy','--config',configPath,'--dry-run','--containers-rollout=none','--outdir',out,...(versionTag?['--tag',versionTag]:[])],120_000);}finally{rmSync(out,{recursive:true,force:true});}}

export async function runPreflight({root=resolve(fileURLToPath(new URL('../..',import.meta.url))),cloud=false,dryRunEnabled=false,release=false,releasePhase=null,workerSha=null,workerVersionId=null,secretFiles=[],opencodeAuthFile=null,stagingConfigPath=null}={}){
  const effectiveReleasePhase=releasePhase??(release?'predeploy':null),releaseEnabled=effectiveReleasePhase!==null;
  if(effectiveReleasePhase!==null&&!['predeploy','postdeploy'].includes(effectiveReleasePhase))throw Error('invalid-release-phase');
  if(effectiveReleasePhase==='postdeploy'&&!cloud)throw Error('postdeploy-release-requires-cloud');
  if(effectiveReleasePhase==='predeploy'&&workerVersionId!==null)throw Error('worker-version-id-postdeploy-only');
  if(effectiveReleasePhase==='postdeploy'&&!WORKER_VERSION_ID.test(workerVersionId??''))throw Error('postdeploy-release-requires-worker-version-id');
  if(!releaseEnabled&&workerSha!==null)throw Error('worker-sha-release-only');
  if(!releaseEnabled&&workerVersionId!==null)throw Error('worker-version-id-release-only');
  const ownedOverlay=releaseEnabled&&stagingConfigPath===null?createStagingConfigOverlay(root,{turnsEnabled:true,workerSha}):null;
  const configPath=stagingConfigPath===null?(ownedOverlay?.path??resolve(root,STAGING_CONFIG)):resolve(stagingConfigPath);
  try{
    const baseConfig=json(resolve(root,STAGING_CONFIG)),config=json(configPath);
    const migrationNames=(await import('node:fs')).readdirSync(resolve(root,'services/catalog/migrations')).filter(name=>name.endsWith('.sql'));
    const checks=[];
    if(releaseEnabled)checks.push(check('checked-config-default-closed',validateStagingTopology(baseConfig,migrationNames).every(value=>value.status==='passed'),'checked-in-staging-config-must-remain-valid-with-turn-admission-false'));
    checks.push(...validateStagingTopology(config,migrationNames,{release:releaseEnabled}));
    let releaseManifest;
    if(releaseEnabled){
      releaseManifest=buildReleaseManifest(config,workerSha);
      checks.push(validateWorkerSource(root,workerSha,{release:true}),validateReleaseManifest(config,releaseManifest));
    }
    checks.push(validateSecretSources(secretFiles.map(path=>resolve(root,path)),opencodeAuthFile?resolve(root,opencodeAuthFile):null));
    if(dryRunEnabled){const result=dryRun(root,configPath,releaseManifest?.workerVersionTag??null);checks.push(check('wrangler-dry-run',result.status===0,result.status===0?undefined:'wrangler-dry-run-failed'));}
    if(cloud)checks.push(...await cloudChecks(root,config,releaseEnabled,releaseManifest,effectiveReleasePhase==='postdeploy'?workerVersionId:null,configPath,effectiveReleasePhase));
    return {schemaVersion:1,observedAt:new Date().toISOString(),phase:releaseEnabled?`release-${effectiveReleasePhase}`:'paused',status:checks.some(value=>value.status==='blocked')?'blocked':'passed',...(releaseEnabled?{releaseManifest}:{}),...(effectiveReleasePhase==='postdeploy'?{workerVersionId}:{}),checks};
  }finally{ownedOverlay?.remove();}
}

async function main(){
  const args=process.argv.slice(2),secretFiles=args.filter(arg=>arg.startsWith('--secrets-file=')).map(arg=>arg.slice('--secrets-file='.length)),opencodeAuthFile=args.find(arg=>arg.startsWith('--opencode-auth-file='))?.slice('--opencode-auth-file='.length)??null,output=args.find(arg=>arg.startsWith('--output='))?.slice('--output='.length)??null,workerSha=args.find(arg=>arg.startsWith('--worker-sha='))?.slice('--worker-sha='.length)??null,workerVersionId=args.find(arg=>arg.startsWith('--worker-version-id='))?.slice('--worker-version-id='.length)??null,releasePhase=args.find(arg=>arg.startsWith('--release-phase='))?.slice('--release-phase='.length)??null;
  if(args.some(arg=>!['--cloud','--dry-run','--release'].includes(arg)&&!arg.startsWith('--release-phase=')&&!arg.startsWith('--secrets-file=')&&!arg.startsWith('--opencode-auth-file=')&&!arg.startsWith('--output=')&&!arg.startsWith('--worker-sha=')&&!arg.startsWith('--worker-version-id=')))throw Error('unsupported-argument');
  if(args.includes('--release')&&releasePhase!==null)throw Error('choose-release-or-release-phase');
  const result=await runPreflight({cloud:args.includes('--cloud'),dryRunEnabled:args.includes('--dry-run'),release:args.includes('--release'),releasePhase,workerSha,workerVersionId,secretFiles,opencodeAuthFile});const encoded=JSON.stringify(result,null,2)+'\n';if(output)writeFileSync(resolve(output),encoded,{mode:0o600});process.stdout.write(encoded);if(result.status!=='passed')process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'vertical-staging-preflight-failed'}\n`);process.exitCode=1;});
