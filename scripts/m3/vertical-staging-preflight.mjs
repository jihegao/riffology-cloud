#!/usr/bin/env node
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {promises as dns} from 'node:dns';
import {connect as tlsConnect,checkServerIdentity} from 'node:tls';
import {validateSecretSources} from './vertical-runtime-preflight.mjs';

export const STAGING_CONFIG='infra/wrangler.m3-vertical-staging.jsonc';
export const ACCOUNT_ID='8b0d70250211aa10d89e20605a1c7e5e';
export const WORKER_NAME='riffology-m1-gateway-staging';
export const CONTROL_ORIGIN='https://m1.riff-demo.gaojihe.cn';
export const PREVIEW_ORIGIN='https://preview.m1.riff-demo.gaojihe.cn';
export const PREVIEW_ROUTE='*.preview.m1.riff-demo.gaojihe.cn/*';
export const REQUIRED_SECRETS=Object.freeze([
  'BETTER_AUTH_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','M2_MODEL_PROXY_REQUEST_KEY',
  'M2_TOOL_BRIDGE_REQUEST_KEY','M2_MODEL_TURN_CAPABILITY_KEY','M2_PROJECT_EFFECT_CAPABILITY_KEY',
  'M2_OPENCODE_GO_API_KEY',
]);
export const REQUIRED_BINDINGS=Object.freeze([
  'TENANT_QUOTA','WORKSPACE_AGENT','PROJECT_RUNTIME','PRODUCT_TURN_RUNTIME','REVISION_STORE',
  'TOOL_ARTIFACT_STORE','TENANT_MODEL_BUDGET','PROJECT_SANDBOX','TRUSTED_PI_SANDBOX',
  'TOOL_BRIDGE_AGENT','SERVICE_RUN','SERVICE_RUNTIME','SERVICE_SANDBOX',
]);
export const REQUIRED_EXPORTS=Object.freeze([
  'TenantQuota','WorkspaceAgent','ProjectRuntime','ProductTurnRuntime','RevisionStore','ToolArtifactStore',
  'TenantModelBudget','ProjectToolSandbox','TrustedPiSandbox','ToolBridgeAgent','ServiceRun','ServiceRuntime','ServiceSandbox',
]);
export const REQUIRED_CONTAINERS=Object.freeze(['ProjectRuntime','ProjectToolSandbox','TrustedPiSandbox','ServiceSandbox']);
export const REQUIRED_MIGRATIONS=Object.freeze([
  '0001_catalog.sql','0002_auth.sql','0003_provisioning.sql','0004_operator_invitations.sql',
  '0005_initial_operator.sql','0006_model_catalog.sql','0007_model_content_checks.sql','0008_preview_routes.sql',
]);
const REGISTRY=`registry.cloudflare.com/${ACCOUNT_ID}/`;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const check=(name,ok,detail)=>({name,status:ok?'passed':'blocked',...(ok||!detail?{}:{detail})});
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const command=(bin,args,timeout=60_000)=>spawnSync(bin,args,{encoding:'utf8',timeout,maxBuffer:4*1024*1024});
const json=path=>JSON.parse(readFileSync(path,'utf8'));

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
    : [...releaseGates,'M3_OBSERVER_ENABLED'].every(name=>config.vars?.[name]==='false');
  const budget=config.vars?.M2_MODEL_BUDGET_POLICY_VERSION==='m2-token-vertical-v2'&&config.vars?.MODEL_BUDGET_POLICY_VERSION==='m2-token-vertical-v2'&&config.vars?.MODEL_BUDGET_MAX_RESERVATION_ATTEMPTS_PER_TURN==='8'&&config.vars?.MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN==='8'&&config.vars?.MODEL_BUDGET_MAX_INPUT_TOKENS_PER_CALL==='262144'&&config.vars?.MODEL_BUDGET_MAX_OUTPUT_TOKENS_PER_CALL==='4096'&&config.vars?.MODEL_BUDGET_MAX_RESERVED_TOKENS_PER_TURN==='532480';
  const r2=config.r2_buckets??[],service=containers.find(value=>value.class_name==='ServiceSandbox');
  return [
    check('worker-identity',config.name===WORKER_NAME&&config.account_id===ACCOUNT_ID&&config.workers_dev===false&&config.preview_urls===false,'use-existing-dedicated-staging-worker'),
    check('staging-origins',config.vars?.APP_ORIGIN===CONTROL_ORIGIN&&config.vars?.M3_PREVIEW_ORIGIN===PREVIEW_ORIGIN&&routes.length===3&&control&&previewBase&&preview?.pattern===PREVIEW_ROUTE,'declare-control-and-preview-base-custom-domains-plus-the-preview-wildcard-route'),
    check(release?'execution-gates-controlled-release':'execution-gates-closed',gatesValid,release?'release-requires-five-vertical-gates-true-and-observer-false':'foundation-requires-all-six-execution-gates-false'),
    check('tenant-capacity',config.vars?.TENANT_QUOTA_CAPACITY==='1'&&containers.every(value=>value.max_instances===1),'retain-single-tenant-runtime-capacity'),
    check('model-budget',budget,'retain-reviewed-token-and-turn-budget'),
    check('required-secrets',same(config.secrets?.required??[],REQUIRED_SECRETS),'declare-only-the-eight-reviewed-secrets'),
    check('durable-bindings',same(bindings,REQUIRED_BINDINGS),'declare-complete-m2-m3-durable-bindings'),
    check('durable-exports',same(exports,REQUIRED_EXPORTS),'declare-complete-m2-m3-durable-exports'),
    check('container-images',same(classes,REQUIRED_CONTAINERS)&&images,'use-four-account-registry-digest-pinned-linux-amd64-images'),
    check('service-image-pin',typeof config.vars?.M3_SERVICE_IMAGE==='string'&&config.vars.M3_SERVICE_IMAGE===service?.image,'service-policy-must-pin-deployed-service-image'),
    check('private-services',same(serviceBindings,['MODEL_PROXY','TOOL_BRIDGE'])&&services.every(value=>value.service===WORKER_NAME)&&services.find(value=>value.binding==='MODEL_PROXY')?.entrypoint==='ModelProxyService'&&services.find(value=>value.binding==='TOOL_BRIDGE')?.entrypoint==='ToolBridgeService','use-only-two-self-bound-private-services'),
    check('dedicated-storage',config.d1_databases?.length===1&&config.d1_databases[0]?.database_name==='riffology-catalog-staging'&&config.d1_databases[0]?.database_id==='993f2fd9-a135-4a93-9caa-10828dec6635'&&r2.some(value=>value.binding==='WORKSPACE_CHECKPOINTS'&&value.bucket_name==='riffology-m1-workspace-checkpoints-staging')&&r2.some(value=>value.binding==='MODEL_CONTENT'&&value.bucket_name==='riffology-m3-model-content-staging'),'use-dedicated-staging-d1-and-r2-buckets'),
    check('recovery-cron',same(config.triggers?.crons??[],['* * * * *']),'retain-one-bounded-staging-recovery-sweep'),
    check('catalog-migrations',same(migrations,REQUIRED_MIGRATIONS),'include-catalog-migrations-0001-through-0008'),
    check('no-local-runtime-inputs',!JSON.stringify(config).includes('127.0.0.1')&&!JSON.stringify(config).includes('localhost')&&!Object.hasOwn(config.vars??{},'M1_GOOGLE_OAUTH_EGRESS_CAPABILITY')&&!Object.keys(config.vars??{}).some(name=>name.startsWith('M3_VERTICAL_')),'remove-loopback-local-proxy-and-vertical-telemetry-inputs'),
  ];
}

export function configuredImages(config){return (config.containers??[]).map(value=>({name:value.class_name,reference:value.image}));}
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
async function cloudChecks(root,config,release){
  const wrangler=resolve(root,'node_modules/.bin/wrangler'),args=['--config',resolve(root,STAGING_CONFIG)];
  const checks=[];
  try{const rows=parseJsonOutput(command(wrangler,['d1','list','--json',...args]));checks.push(check('cloud-d1',rows.some(value=>value.name==='riffology-catalog-staging'&&value.uuid==='993f2fd9-a135-4a93-9caa-10828dec6635'),'create-reviewed-staging-d1'));}catch{checks.push(check('cloud-d1',false,'cloud-d1-query-failed'));}
  for(const bucket of ['riffology-m1-workspace-checkpoints-staging','riffology-m3-model-content-staging']){const result=command(wrangler,['r2','bucket','info',bucket,...args]);checks.push(check(`cloud-r2:${bucket}`,result.status===0,`create-r2-bucket:${bucket}`));}
  try{const rows=parseJsonOutput(command(wrangler,['secret','list','--format','json',...args]));const names=rows.map(value=>value.name);checks.push(check('cloud-secrets',REQUIRED_SECRETS.every(name=>names.includes(name)),`upload-missing-worker-secrets:${REQUIRED_SECRETS.filter(name=>!names.includes(name)).join(',')}`));}catch{checks.push(check('cloud-secrets',false,'cloud-secret-query-failed'));}
  const migrations=command(wrangler,['d1','migrations','list','riffology-catalog-staging','--remote',...args]);
  const pending=migrations.status===0?[...migrations.stdout.matchAll(/\b(\d{4}_[A-Za-z0-9_.-]+\.sql)\b/g)].map(value=>value[1]):[];
  checks.push(check('cloud-catalog-migrations',migrations.status===0&&pending.length===0,pending.length?`apply-remote-migrations:${[...new Set(pending)].join(',')}`:'remote-migration-query-failed'));
  const credentials=command(wrangler,['containers','registries','credentials','registry.cloudflare.com','--pull','--expiration-minutes','5','--json',...args]);
  if(credentials.status!==0){for(const image of configuredImages(config))checks.push(check(`cloud-container-image:${image.name}`,false,'managed-registry-credentials-unavailable'));}
  else{
    let password=null;try{password=JSON.parse(credentials.stdout).password;}catch{}
    for(const image of configuredImages(config)){
      if(typeof password!=='string'){checks.push(check(`cloud-container-image:${image.name}`,false,'managed-registry-credentials-invalid'));continue;}
      try{await inspectManagedImage(image.reference,password);checks.push(check(`cloud-container-image:${image.name}`,true));}
      catch(error){checks.push(check(`cloud-container-image:${image.name}`,false,error instanceof Error?error.message:'managed-image-inspection-failed'));}
    }
  }
  checks.push(...await validatePreviewDomain(release));
  return checks;
}
function dryRun(root){const out=mkdtempSync(resolve(tmpdir(),'riffology-m3-staging-dry-run-'));try{return command(resolve(root,'node_modules/.bin/wrangler'),['deploy','--config',resolve(root,STAGING_CONFIG),'--dry-run','--containers-rollout=none','--outdir',out],120_000);}finally{rmSync(out,{recursive:true,force:true});}}

export async function runPreflight({root=resolve(fileURLToPath(new URL('../..',import.meta.url))),cloud=false,dryRunEnabled=false,release=false,secretFiles=[],opencodeAuthFile=null}={}){
  const config=json(resolve(root,STAGING_CONFIG));
  const migrationNames=(await import('node:fs')).readdirSync(resolve(root,'services/catalog/migrations')).filter(name=>name.endsWith('.sql'));
  const checks=validateStagingTopology(config,migrationNames,{release});
  checks.push(validateSecretSources(secretFiles.map(path=>resolve(root,path)),opencodeAuthFile?resolve(root,opencodeAuthFile):null));
  if(dryRunEnabled){const result=dryRun(root);checks.push(check('wrangler-dry-run',result.status===0,result.status===0?undefined:'wrangler-dry-run-failed'));}
  if(cloud)checks.push(...await cloudChecks(root,config,release));
  return {schemaVersion:1,observedAt:new Date().toISOString(),phase:release?'release':'foundation',status:checks.some(value=>value.status==='blocked')?'blocked':'passed',checks};
}

async function main(){
  const args=process.argv.slice(2),secretFiles=args.filter(arg=>arg.startsWith('--secrets-file=')).map(arg=>arg.slice('--secrets-file='.length)),opencodeAuthFile=args.find(arg=>arg.startsWith('--opencode-auth-file='))?.slice('--opencode-auth-file='.length)??null,output=args.find(arg=>arg.startsWith('--output='))?.slice('--output='.length)??null;
  if(args.some(arg=>!['--cloud','--dry-run','--release'].includes(arg)&&!arg.startsWith('--secrets-file=')&&!arg.startsWith('--opencode-auth-file=')&&!arg.startsWith('--output=')))throw Error('unsupported-argument');
  const result=await runPreflight({cloud:args.includes('--cloud'),dryRunEnabled:args.includes('--dry-run'),release:args.includes('--release'),secretFiles,opencodeAuthFile});const encoded=JSON.stringify(result,null,2)+'\n';if(output)writeFileSync(resolve(output),encoded,{mode:0o600});process.stdout.write(encoded);if(result.status!=='passed')process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'vertical-staging-preflight-failed'}\n`);process.exitCode=1;});
