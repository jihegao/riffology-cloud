#!/usr/bin/env node
import {lstatSync,mkdtempSync,readFileSync,readdirSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {unstable_startWorker} from 'wrangler';
import {googleOAuthEgress} from './google-oauth-egress.mjs';
import {resolve} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

export const PRODUCT_CONFIG='infra/wrangler.m2-product-local.jsonc';
export const LOCAL_GENERATED_SECRETS=Object.freeze([
  'M2_MODEL_PROXY_REQUEST_KEY','M2_TOOL_BRIDGE_REQUEST_KEY','M2_MODEL_TURN_CAPABILITY_KEY',
  'M2_PROJECT_EFFECT_CAPABILITY_KEY',
]);
export const AUTH_SOURCE_SECRETS=Object.freeze(['BETTER_AUTH_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET']);
export const EXTERNAL_SECRETS=Object.freeze([...AUTH_SOURCE_SECRETS,'M2_OPENCODE_GO_API_KEY']);
export const REQUIRED_SECRETS=Object.freeze([...LOCAL_GENERATED_SECRETS,...EXTERNAL_SECRETS]);
export const LOCAL_OAUTH_EGRESS_SECRET='M1_GOOGLE_OAUTH_EGRESS_CAPABILITY';
const FILE_SOURCE_SECRETS=Object.freeze([...LOCAL_GENERATED_SECRETS,...AUTH_SOURCE_SECRETS]);
export const CONTAINER_CLASSES=Object.freeze(['ProjectRuntime','ProjectToolSandbox','TrustedPiSandbox','ServiceSandbox']);
export const SANDBOX_CONTAINER_CLASSES=Object.freeze(['ProjectToolSandbox','TrustedPiSandbox','ServiceSandbox']);
export const RUNTIME_KEYS=Object.freeze([
  'APP_ORIGIN','M3_PREVIEW_ORIGIN','CONTAINER_IMAGES','M3_SERVICE_IMAGE',
  'HTTPS_CERT_PATH','HTTPS_KEY_PATH','M2_TURNS_ENABLED','M2_MODEL_PROVIDER_ENABLED',
  'M3_SERVICE_ENABLED','M3_PREVIEW_ENABLED','M3_PREVIEW_WS_ENABLED','M3_OBSERVER_ENABLED',
]);
const REQUIRED_BINDINGS=Object.freeze([
  'PROJECT_RUNTIME','PROJECT_SANDBOX','PRODUCT_TURN_RUNTIME','REVISION_STORE','SERVICE_RUN','SERVICE_RUNTIME',
  'SERVICE_SANDBOX','TENANT_MODEL_BUDGET','TENANT_QUOTA','TOOL_ARTIFACT_STORE',
  'TOOL_BRIDGE_AGENT','TRUSTED_PI_SANDBOX','WORKSPACE_AGENT',
]);
const REQUIRED_EXPORTS=Object.freeze([
  'ProjectRuntime','ProjectToolSandbox','ProductTurnRuntime','RevisionStore','ServiceRun','ServiceRuntime',
  'ServiceSandbox','TenantModelBudget','TenantQuota','ToolArtifactStore','ToolBridgeAgent',
  'TrustedPiSandbox','WorkspaceAgent',
]);
const DIGEST=/^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/;
const IMAGE_DIGEST=/^sha256:[a-f0-9]{64}$/;
const DOCKER_REFERENCE=/^docker\.io\/[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]{1,128}$/;
const LOOPBACK_DOCKER_REFERENCE=/^127\.0\.0\.1:([1-9][0-9]{0,4})\/[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]{1,128}$/;
export const REGISTERED_OAUTH_ORIGINS=Object.freeze(['http://127.0.0.1:8795','https://m1.riff-demo.gaojihe.cn','https://app.local.riffology.gaojihe.cn:8797']);
const LOCAL_CATALOG_PERSISTENCE='.local/m3-vertical-runtime';
const LOCAL_MODEL_BUDGET_DIRECTORY='v3/do/riffology-m2-product-local-TenantModelBudget';
const BASE_MODEL_BUDGET=Object.freeze({policy_version:'m2-token-v1',max_reservation_attempts_per_turn:4,max_dispatched_calls_per_turn:2,max_input_tokens_per_call:262144,max_output_tokens_per_call:4096,max_reserved_tokens_per_turn:532480});
const PREVIOUS_VERTICAL_MODEL_BUDGET=Object.freeze({...BASE_MODEL_BUDGET,policy_version:'m2-token-vertical-v1',max_reservation_attempts_per_turn:6,max_dispatched_calls_per_turn:6});
const VERTICAL_MODEL_BUDGET=Object.freeze({...BASE_MODEL_BUDGET,policy_version:'m2-token-vertical-v2',max_reservation_attempts_per_turn:8,max_dispatched_calls_per_turn:8});
const BOOTSTRAP_OPERATOR_ACTION='set-RIFFOLOGY_INITIAL_OPERATOR_TOKEN-then-run:node scripts/m1/bootstrap-operator.mjs invite --email <authorized-email> --database riffology-catalog-local --config infra/wrangler.m2-product-local.jsonc --local --persist-to .local/m3-vertical-runtime';

const check=(name,passed,detail)=>({name,status:passed?'passed':'failed',...(passed||!detail?{}:{detail})});
const sorted=value=>[...value].sort();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const immutableImageReference=image=>`${image.reference.replace(/:[^/:]+$/,'')}@${image.digest}`;
export function isAllowedDockerReference(reference){
  if(DOCKER_REFERENCE.test(reference))return true;
  const match=LOOPBACK_DOCKER_REFERENCE.exec(reference);return match!==null&&Number(match[1])<=65535;
}
const isLoopbackDockerReference=reference=>LOOPBACK_DOCKER_REFERENCE.test(reference);
const hasImmutableRepoDigest=(image,expected)=>{const reference=immutableImageReference(expected),aliases=[reference,reference.replace(/^docker\.io\/library\//,'')];return image.RepoDigests?.some(value=>aliases.includes(value))===true;};
function privateFile(path){
  const stat=lstatSync(path);
  return stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0;
}
function jsonFile(path){return JSON.parse(readFileSync(path,'utf8'));}

export function validateProductTopology(config,migrations){
  const bindings=(config.durable_objects?.bindings??[]).map(value=>value.name);
  const exports=Object.keys(config.exports??{}).filter(name=>config.exports[name]?.type==='durable-object');
  const service=config.containers?.find(value=>value.class_name==='ServiceSandbox');
  return [
    check('product-config',config.name==='riffology-m2-product-local'),
    check('execution-defaults-closed',['M2_TURNS_ENABLED','M2_MODEL_PROVIDER_ENABLED','M3_SERVICE_ENABLED','M3_PREVIEW_ENABLED','M3_PREVIEW_WS_ENABLED','M3_OBSERVER_ENABLED'].every(name=>config.vars?.[name]==='false')),
    check('vertical-bindings',REQUIRED_BINDINGS.every(name=>bindings.includes(name))),
    check('vertical-exports',REQUIRED_EXPORTS.every(name=>exports.includes(name))),
    check('service-container',service?.image==='../services/run/Dockerfile.service'&&service?.image_build_context==='..'&&service?.max_instances===1),
    check('preview-route-migration',migrations.includes('0008_preview_routes.sql')),
  ];
}

function loadSecretSources(paths,opencodePath){
  if(!paths.length)return {check:{name:'runtime-secrets',status:'blocked',detail:'use-repeatable---secrets-file-for-existing-auth-and-local-internal-secrets'},values:null};
  try{
    const values={};
    for(const path of paths){
      if(!privateFile(path))return {check:check('runtime-secrets',false,'every-secret-source-must-be-regular-0600'),values:null};
      const source=jsonFile(path);if(!source||typeof source!=='object'||Array.isArray(source))return {check:check('runtime-secrets',false,'secret-source-must-be-a-json-object'),values:null};
      const unknown=Object.keys(source).filter(name=>!FILE_SOURCE_SECRETS.includes(name));if(unknown.length)return {check:check('runtime-secrets',false,`unknown-secret-keys:${unknown.join(',')}`),values:null};
      const duplicate=Object.keys(source).filter(name=>Object.hasOwn(values,name));if(duplicate.length)return {check:check('runtime-secrets',false,`duplicate-secret-keys:${duplicate.join(',')}`),values:null};
      Object.assign(values,source);
    }
    const missingLocal=LOCAL_GENERATED_SECRETS.filter(name=>!Object.hasOwn(values,name));if(missingLocal.length)return {check:check('runtime-secrets',false,`missing-local-secrets:${missingLocal.join(',')}`),values:null};
    const invalid=Object.keys(values).filter(name=>typeof values[name]!=='string'||/[\r\n\0]/.test(values[name])||values[name].length<(name.includes('KEY')||name==='BETTER_AUTH_SECRET'?32:16));
    if(invalid.length)return {check:check('runtime-secrets',false,`invalid-secret-values:${invalid.join(',')}`),values:null};
    const missingAuth=AUTH_SOURCE_SECRETS.filter(name=>!Object.hasOwn(values,name));if(missingAuth.length)return {check:{name:'runtime-secrets',status:'blocked',detail:`missing-existing-auth-secrets:${missingAuth.join(',')}`},values:null};
    if(!opencodePath)return {check:{name:'runtime-secrets',status:'blocked',detail:'use---opencode-auth-file-to-reference-the-existing-provider-credential'},values:null};
    if(!privateFile(opencodePath))return {check:check('runtime-secrets',false,'opencode-auth-file-must-be-regular-0600'),values:null};
    const auth=jsonFile(opencodePath),provider=auth?.['opencode-go'];
    if(!provider||typeof provider!=='object'||Array.isArray(provider)||typeof provider.type!=='string'||typeof provider.key!=='string'||provider.key.length<16||/[\r\n\0]/.test(provider.key))return {check:{name:'runtime-secrets',status:'blocked',detail:'opencode-go-credential-unavailable'},values:null};
    values.M2_OPENCODE_GO_API_KEY=provider.key;return {check:check('runtime-secrets',true),values};
  }catch{return {check:{name:'runtime-secrets',status:'blocked',detail:'secret-source-unreadable'},values:null};}
}
export function validateSecretSources(paths,opencodePath){return loadSecretSources(paths,opencodePath).check;}

export function validateRuntimeFile(path){
  if(!path)return {check:{name:'runtime-profile',status:'blocked',detail:'use --runtime-file=<json>'},value:null};
  try{
    const value=jsonFile(path),keys=Object.keys(value).sort();
    if(!same(keys,sorted(RUNTIME_KEYS)))return {check:check('runtime-profile',false,`required-keys:${RUNTIME_KEYS.join(',')}`),value:null};
    const app=new URL(value.APP_ORIGIN),preview=new URL(value.M3_PREVIEW_ORIGIN),sample=`p-${'0'.repeat(40)}.${preview.hostname}`;
    const gates=['M2_TURNS_ENABLED','M2_MODEL_PROVIDER_ENABLED','M3_SERVICE_ENABLED','M3_PREVIEW_ENABLED','M3_PREVIEW_WS_ENABLED'].every(name=>value[name]==='true')&&value.M3_OBSERVER_ENABLED==='false';
    const origins=app.protocol==='https:'&&preview.protocol==='https:'&&app.origin===value.APP_ORIGIN&&preview.origin===value.M3_PREVIEW_ORIGIN&&app.port===preview.port&&app.hostname!==preview.hostname&&!app.hostname.endsWith('.'+preview.hostname)&&sample.length<=253;
    const paths=typeof value.HTTPS_CERT_PATH==='string'&&value.HTTPS_CERT_PATH.length>0&&typeof value.HTTPS_KEY_PATH==='string'&&value.HTTPS_KEY_PATH.length>0;
    const containerKeys=value.CONTAINER_IMAGES&&typeof value.CONTAINER_IMAGES==='object'&&!Array.isArray(value.CONTAINER_IMAGES)?Object.keys(value.CONTAINER_IMAGES).sort():[];
    const images=same(containerKeys,sorted(CONTAINER_CLASSES))&&CONTAINER_CLASSES.every(name=>{
      const item=value.CONTAINER_IMAGES[name];
      return item&&typeof item==='object'&&!Array.isArray(item)&&same(Object.keys(item).sort(),['digest','reference'])&&isAllowedDockerReference(item.reference)&&IMAGE_DIGEST.test(item.digest);
    });
    const serviceImage=typeof value.M3_SERVICE_IMAGE==='string'&&DIGEST.test(value.M3_SERVICE_IMAGE)&&images&&value.M3_SERVICE_IMAGE.endsWith('@'+value.CONTAINER_IMAGES.ServiceSandbox.digest);
    if(!gates)return {check:check('runtime-profile',false,'enable-m2-and-m3-gates;keep-M3_OBSERVER_ENABLED=false'),value:null};
    if(!origins)return {check:check('runtime-profile',false,'APP_ORIGIN-and-M3_PREVIEW_ORIGIN-must-be-distinct-HTTPS-origins-on-the-same-port'),value:null};
    if(!paths)return {check:check('runtime-profile',false,'HTTPS_CERT_PATH-and-HTTPS_KEY_PATH-required'),value:null};
    if(!images)return {check:check('runtime-profile',false,'CONTAINER_IMAGES-must-name-every-runtime-container-with-a-fully-qualified-docker.io-or-127.0.0.1-reference-and-sha256-digest'),value:null};
    if(!serviceImage)return {check:check('runtime-profile',false,'M3_SERVICE_IMAGE-must-use-the-ServiceSandbox-image-digest'),value:null};
    return {check:check('runtime-profile',true),value};
  }catch{return {check:{name:'runtime-profile',status:'blocked',detail:'runtime-file-unreadable'},value:null};}
}
function validateOAuthRedirect(runtime){
  if(!runtime)return {name:'oauth-redirect',status:'blocked',detail:'runtime-profile-unavailable'};
  if(REGISTERED_OAUTH_ORIGINS.includes(runtime.APP_ORIGIN))return check('oauth-redirect',true);
  return {name:'oauth-redirect',status:'blocked',detail:`register-google-callback:${runtime.APP_ORIGIN}/api/auth/callback/google`};
}

function command(command,args,timeout=30000){return spawnSync(command,args,{encoding:'utf8',timeout,maxBuffer:1024*1024});}
export function validateTls(root,runtime){
  if(!runtime)return [{name:'tls-certificate',status:'blocked',detail:'runtime-profile-unavailable'},{name:'tls-private-key',status:'blocked',detail:'runtime-profile-unavailable'},{name:'tls-key-match',status:'blocked',detail:'runtime-profile-unavailable'},{name:'tls-trust',status:'blocked',detail:'runtime-profile-unavailable'}];
  const cert=resolve(root,runtime.HTTPS_CERT_PATH),key=resolve(root,runtime.HTTPS_KEY_PATH),hosts=[new URL(runtime.APP_ORIGIN).hostname,`p-${'0'.repeat(40)}.${new URL(runtime.M3_PREVIEW_ORIGIN).hostname}`];
  let certOk=false,keyOk=false,keyMatch=false,trustOk=false;
  try{certOk=lstatSync(cert).isFile()&&command('openssl',['x509','-in',cert,'-noout','-checkend','3600']).status===0&&hosts.every(host=>command('openssl',['x509','-in',cert,'-noout','-checkhost',host]).status===0);if(certOk)trustOk=hosts.every(host=>(process.platform==='darwin'?command('security',['verify-cert','-c',cert,'-p','ssl','-s',host]):command('openssl',['verify','-verify_hostname',host,cert])).status===0);}catch{}
  try{
    keyOk=privateFile(key)&&command('openssl',['pkey','-in',key,'-noout','-check']).status===0;
    if(keyOk){const certPublic=command('openssl',['x509','-in',cert,'-pubkey','-noout']),keyPublic=command('openssl',['pkey','-in',key,'-pubout']);keyMatch=certPublic.status===0&&keyPublic.status===0&&certPublic.stdout.trim()===keyPublic.stdout.trim();}
  }catch{}
  return [check('tls-certificate',certOk,'certificate-must-be-current-and-cover-control-and-preview-hosts'),check('tls-private-key',keyOk,'private-key-must-be-regular-0600'),check('tls-key-match',keyMatch,'certificate-and-private-key-must-match'),check('tls-trust',trustOk,'certificate-must-be-trusted-for-both-browser-origins')];
}
export function areLoopbackAddresses(addresses){return Array.isArray(addresses)&&addresses.length>0&&addresses.every(({address})=>typeof address==='string'&&(/^127\./.test(address)||address==='::1'||/^::ffff:127\./i.test(address)));}
function validateLocalDns(runtime){
  if(!runtime)return {name:'local-dns',status:'blocked',detail:'runtime-profile-unavailable'};
  const probeLabel=`p-${crypto.randomUUID().replaceAll('-','').padEnd(40,'0')}`,hosts=[new URL(runtime.APP_ORIGIN).hostname,`${probeLabel}.${new URL(runtime.M3_PREVIEW_ORIGIN).hostname}`];
  for(const host of hosts){const result=command(process.execPath,['-e',"require('node:dns').lookup(process.argv[1],{all:true,verbatim:true},(error,addresses)=>{if(error)process.exit(2);process.stdout.write(JSON.stringify(addresses))})",host]);if(result.status!==0)return check('local-dns',false,`host-not-resolved:${host}`);try{if(!areLoopbackAddresses(JSON.parse(result.stdout)))return check('local-dns',false,`host-has-non-loopback-address:${host}`);}catch{return check('local-dns',false,`host-resolution-invalid:${host}`);}}
  return check('local-dns',true);
}
export function catalogAdmissionFromWrangler(result){
  if(result?.status!==0)return {name:'catalog-admission',status:'blocked',detail:'apply-local-catalog-migrations-before-preflight'};
  try{
    const parsed=JSON.parse(result.stdout),rows=parsed.flatMap(item=>item?.success===true&&Array.isArray(item.results)?item.results:[]);
    if(rows.some(row=>Number(row?.ready)===1))return check('catalog-admission',true);
  }catch{}
  return {name:'catalog-admission',status:'blocked',detail:BOOTSTRAP_OPERATOR_ACTION};
}
function validateLocalCatalogAdmission(root){
  const now=Date.now(),sql=`SELECT CASE WHEN EXISTS (SELECT 1 FROM catalog_platform_roles r JOIN catalog_users u ON u.id=r.user_id WHERE r.role='operator' AND r.status='active' AND u.status='active') OR EXISTS (SELECT 1 FROM catalog_invitations i LEFT JOIN catalog_platform_roles r ON r.user_id=i.issued_by AND r.role='operator' LEFT JOIN catalog_users u ON u.id=r.user_id WHERE i.state='pending' AND i.expires_at>${now} AND (i.purpose='initial_operator' OR (r.status='active' AND u.status='active'))) THEN 1 ELSE 0 END AS ready`;
  const binary=resolve(root,'node_modules/.bin/wrangler'),result=command(binary,['d1','execute','riffology-catalog-local','--local','--config',resolve(root,PRODUCT_CONFIG),'--persist-to',resolve(root,LOCAL_CATALOG_PERSISTENCE),'--command',sql,'--json','-y'],30000);
  return catalogAdmissionFromWrangler(result);
}
const modelBudgetMatches=(row,expected)=>Object.entries(expected).every(([key,value])=>row?.[key]===value);
export function verticalModelBudgetState(row){
  if(!row||Number(row.active_calls)!==0)return {ok:false,detail:'vertical-model-budget-has-active-or-invalid-state'};
  if(modelBudgetMatches(row,VERTICAL_MODEL_BUDGET))return {ok:true,migration:false};
  if(modelBudgetMatches(row,BASE_MODEL_BUDGET)||modelBudgetMatches(row,PREVIOUS_VERTICAL_MODEL_BUDGET))return {ok:true,migration:true};
  return {ok:false,detail:'vertical-model-budget-policy-drift'};
}
function modelBudgetFiles(root){
  const directory=resolve(root,LOCAL_CATALOG_PERSISTENCE,LOCAL_MODEL_BUDGET_DIRECTORY);
  try{return readdirSync(directory).filter(name=>name.endsWith('.sqlite')&&name!=='metadata.sqlite').map(name=>resolve(directory,name));}catch{return [];}
}
function readModelBudgetState(path){
  const query="SELECT policy_version,max_reservation_attempts_per_turn,max_dispatched_calls_per_turn,max_input_tokens_per_call,max_output_tokens_per_call,max_reserved_tokens_per_turn,(SELECT count(*) FROM model_calls WHERE status IN ('reserved','dispatched')) AS active_calls FROM model_budget_meta WHERE singleton=1";
  const result=command('sqlite3',['-json',path,query]);if(result.status!==0)return null;
  try{const rows=JSON.parse(result.stdout);return rows.length===1?rows[0]:null;}catch{return null;}
}
function validateVerticalModelBudget(root){
  for(const path of modelBudgetFiles(root)){const state=verticalModelBudgetState(readModelBudgetState(path));if(!state.ok)return {name:'vertical-model-budget',status:'blocked',detail:state.detail};}
  return check('vertical-model-budget',true);
}
function migrateVerticalModelBudget(root){
  for(const path of modelBudgetFiles(root)){
    const current=readModelBudgetState(path),before=verticalModelBudgetState(current);if(!before.ok)throw Error(before.detail);
    if(before.migration){
      const e=modelBudgetMatches(current,PREVIOUS_VERTICAL_MODEL_BUDGET)?PREVIOUS_VERTICAL_MODEL_BUDGET:BASE_MODEL_BUDGET,t=VERTICAL_MODEL_BUDGET;
      const sql=`BEGIN IMMEDIATE; UPDATE model_budget_meta SET policy_version='${t.policy_version}',max_reservation_attempts_per_turn=${t.max_reservation_attempts_per_turn},max_dispatched_calls_per_turn=${t.max_dispatched_calls_per_turn} WHERE singleton=1 AND policy_version='${e.policy_version}' AND max_reservation_attempts_per_turn=${e.max_reservation_attempts_per_turn} AND max_dispatched_calls_per_turn=${e.max_dispatched_calls_per_turn} AND max_input_tokens_per_call=${e.max_input_tokens_per_call} AND max_output_tokens_per_call=${e.max_output_tokens_per_call} AND max_reserved_tokens_per_turn=${e.max_reserved_tokens_per_turn} AND NOT EXISTS (SELECT 1 FROM model_calls WHERE status IN ('reserved','dispatched')); SELECT changes() AS changed; COMMIT;`;
      const changed=command('sqlite3',['-json',path,sql]);if(changed.status!==0)throw Error('vertical-model-budget-migration-failed');
    }
    const after=readModelBudgetState(path);if(!after||!modelBudgetMatches(after,VERTICAL_MODEL_BUDGET)||Number(after.active_calls)!==0)throw Error('vertical-model-budget-migration-unconfirmed');
  }
}
export function validateDockerImages(runtime){
  if(!runtime)return CONTAINER_CLASSES.map(name=>({name:`container-image:${name}`,status:'blocked',detail:'runtime-profile-unavailable'}));
  const checks=[];
  for(const name of CONTAINER_CLASSES){
    const expected=runtime.CONTAINER_IMAGES[name],result=command('docker',['image','inspect',expected.reference,'--format','{{json .}}'],60000);
    if(result.status!==0){checks.push({name:`container-image:${name}`,status:'blocked',detail:'docker-image-not-available'});continue;}
    try{
      const image=JSON.parse(result.stdout),localRegistryResolvable=!isLoopbackDockerReference(expected.reference)||command('docker',['manifest','inspect','--insecure',immutableImageReference(expected)],30000).status===0;
      const verticalMarker=name!=='ServiceSandbox'||image.Config?.Env?.includes('RIFFOLOGY_SERVICE_PLATFORM_EGRESS_FENCE=workerd-deny-all-v1')===true;
      checks.push(check(`container-image:${name}`,image.Id===expected.digest&&image.Os==='linux'&&image.Architecture==='amd64'&&hasImmutableRepoDigest(image,expected)&&localRegistryResolvable&&verticalMarker,'image-digest-platform-immutable-reference-loopback-registry-or-required-vertical-marker-mismatch'));
    }
    catch{checks.push(check(`container-image:${name}`,false,'docker-image-inspection-invalid'));}
  }
  const trusted=runtime.CONTAINER_IMAGES.TrustedPiSandbox,result=command('docker',['run','--rm','--platform','linux/amd64','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--entrypoint','node',trusted.reference,'--input-type=module','-e',"const m=await import('/opt/riffology/trusted-pi/trusted-pi-release.mjs');const identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1},actor={userId:'user-a',authVersion:1};const o=await m.resolveOptions({identity,actor,executionDeadlineAt:Date.now()+60000});if(o.selectedModel?.provider!=='riffology-product'||typeof o.providerFetch!=='function'||typeof o.resolveCredential!=='function'||!o.bridge)process.exit(2)"],60000);
  checks.push(check('trusted-pi-release',result.status===0,'active-release-module-must-resolve-the-product-policy-with-network-disabled'));
  const project=runtime.CONTAINER_IMAGES.ProjectToolSandbox,probe=command('docker',['run','--rm','--platform','linux/amd64','--network','none','--read-only','--cap-drop','ALL','--cap-add','SETUID','--cap-add','SETGID','--entrypoint','python3',immutableImageReference(project),'-B','-c',String.raw`import os,socket,sys
sys.path.insert(0,'/opt/riffology')
import effect_wrapper as effect
if os.environ.get(effect.PLATFORM_EGRESS_ENV)!=effect.PLATFORM_EGRESS_MARKER: raise SystemExit(2)
effect.drop_to_project()
if os.getuid()!=10001 or os.getgid()!=10001: raise SystemExit(3)
socket.setdefaulttimeout(.25)
try: socket.getaddrinfo('accounts.google.com',443); raise SystemExit(4)
except socket.gaierror: pass
for host,port in [('142.250.1.1',443),('169.254.169.254',80),('192.168.5.2',80),('127.0.0.1',8797)]:
 s=socket.socket();s.settimeout(.25)
 try:
  if s.connect_ex((host,port))==0: raise SystemExit(5)
 finally: s.close()
print('project-tool-boundary-ok')`],60000);
  checks.push(check('project-tool-boundary',probe.status===0&&probe.stdout.trim()==='project-tool-boundary-ok','locked-project-tool-image-must-drop-to-uid-10001-and-deny-dns-public-google-host-gateway-metadata-and-loopback-egress'));
  const service=runtime.CONTAINER_IMAGES.ServiceSandbox,serviceProbe=command('docker',['run','--rm','--platform','linux/amd64','--network','none','--read-only','--cap-drop','ALL','--cap-add','SETUID','--cap-add','SETGID','--security-opt','no-new-privileges','--entrypoint','python3',immutableImageReference(service),'-B','-c',String.raw`import os,socket,sys
sys.path.insert(0,'/opt/riffology')
import service_process as service
if os.environ.get(service.PLATFORM_EGRESS_ENV)!=service.PLATFORM_EGRESS_MARKER: raise SystemExit(2)
service.no_new_privileges()
service.install_child_network_fence()
os.setgroups([]);os.setgid(10001);os.setuid(10001)
if os.getuid()!=10001 or os.getgid()!=10001: raise SystemExit(3)
socket.setdefaulttimeout(.25)
try: socket.getaddrinfo('accounts.google.com',443); raise SystemExit(4)
except socket.gaierror: pass
for host,port in [('142.250.1.1',443),('169.254.169.254',80),('192.168.5.2',80),('127.0.0.1',8797)]:
 s=socket.socket();s.settimeout(.25)
 try:
  if s.connect_ex((host,port))==0: raise SystemExit(5)
 finally: s.close()
print('service-boundary-ok')`],60000);
  checks.push(check('service-boundary',serviceProbe.status===0&&serviceProbe.stdout.trim()==='service-boundary-ok','locked-service-image-must-require-no-new-privileges-drop-to-uid-10001-and-deny-dns-public-google-host-gateway-metadata-and-loopback-egress'));
  return checks;
}
export function dockerCapacityFromInfo(info,runtime,hostArch=process.arch){
  if(!runtime||!info||typeof info!=='object')return {name:'docker-capacity',status:'blocked',detail:'docker-info-unavailable'};
  const normalizeArch=value=>({x64:'amd64',x86_64:'amd64',arm64:'arm64',aarch64:'arm64'}[String(value)]??String(value));
  const memory=Number(info.MemTotal),engineArch=normalizeArch(info.Architecture??''),imageArches=CONTAINER_CLASSES.map(name=>normalizeArch(runtime.CONTAINER_IMAGES?.[name]?.architecture??'amd64'));
  if(!Number.isSafeInteger(memory)||memory<=0||!engineArch)return check('docker-capacity',false,'docker-info-invalid');
  const crossArchitecture=imageArches.some(architecture=>architecture!==engineArch)||(normalizeArch(hostArch)==='arm64'&&imageArches.some(architecture=>architecture==='amd64'));
  // Docker reports guest-usable memory, which is lower than the configured VM
  // size. A configured 4 GiB Colima guest is observed at roughly 3.8 GiB.
  const targetGiB=crossArchitecture?4:2,minimumObserved=(targetGiB-.25)*1024**3;
  return memory>=minimumObserved?check('docker-capacity',true):{name:'docker-capacity',status:'blocked',detail:`docker-vm-memory-insufficient:${crossArchitecture?'cross-architecture-amd64-containers':'native-containers'}-require-at-least-${targetGiB}GiB;colima-stop-then-colima-start---memory-${targetGiB}`};
}
function validateDockerCapacity(runtime){
  const result=command('docker',['info','--format','{{json .}}'],30000);
  if(result.status!==0)return {name:'docker-capacity',status:'blocked',detail:'docker-info-unavailable'};
  try{return dockerCapacityFromInfo(JSON.parse(result.stdout),runtime);}catch{return {name:'docker-capacity',status:'blocked',detail:'docker-info-invalid'};}
}

const inputPath=(root,path)=>path?.startsWith('~/')?resolve(homedir(),path.slice(2)):resolve(root,path);
export function runVerticalPreflight({root=resolve(fileURLToPath(new URL('../..',import.meta.url))),secretsFiles=[],opencodeAuthFile=null,runtimeFile=null,system=true}={}){
  const config=jsonFile(resolve(root,PRODUCT_CONFIG));
  const migrations=readdirSync(resolve(root,'services/catalog/migrations')).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort();
  const runtimeResult=validateRuntimeFile(runtimeFile?resolve(root,runtimeFile):null);
  const secretPaths=secretsFiles.map(path=>inputPath(root,path)),opencodePath=opencodeAuthFile?inputPath(root,opencodeAuthFile):null;
  const checks=[...validateProductTopology(config,migrations),validateSecretSources(secretPaths,opencodePath),runtimeResult.check,validateOAuthRedirect(runtimeResult.value)];
  if(system)checks.push(validateLocalCatalogAdmission(root),validateVerticalModelBudget(root),validateLocalDns(runtimeResult.value),...validateTls(root,runtimeResult.value),validateDockerCapacity(runtimeResult.value),...validateDockerImages(runtimeResult.value));
  const status=checks.some(value=>value.status==='failed')?'failed':checks.some(value=>value.status==='blocked')?'blocked':'passed';
  return {schemaVersion:1,observedAt:new Date().toISOString(),status,checks};
}

export function buildLaunchConfig(config,runtime,lockedImageDirectory){
  if(!lockedImageDirectory)throw Error('locked-image-directory-required');
  const generated=structuredClone(config);
  generated.secrets={...generated.secrets,required:[...(generated.secrets?.required??[]),LOCAL_OAUTH_EGRESS_SECRET]};
  generated.vars={...generated.vars,...Object.fromEntries(RUNTIME_KEYS.filter(name=>!['CONTAINER_IMAGES','HTTPS_CERT_PATH','HTTPS_KEY_PATH'].includes(name)).map(name=>[name,runtime[name]])),M2_MODEL_BUDGET_POLICY_VERSION:VERTICAL_MODEL_BUDGET.policy_version,MODEL_BUDGET_POLICY_VERSION:VERTICAL_MODEL_BUDGET.policy_version,MODEL_BUDGET_MAX_RESERVATION_ATTEMPTS_PER_TURN:String(VERTICAL_MODEL_BUDGET.max_reservation_attempts_per_turn),MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN:String(VERTICAL_MODEL_BUDGET.max_dispatched_calls_per_turn),M3_VERTICAL_MODEL_TELEMETRY:'true',M3_VERTICAL_PREVIEW_TELEMETRY:'true'};
  for(const container of generated.containers){
    const image=runtime.CONTAINER_IMAGES[container.class_name];if(!image)throw Error(`container-image-not-configured:${container.class_name}`);
    const dockerfile=resolve(lockedImageDirectory,`${container.class_name}.Dockerfile`);
    const immutableReference=immutableImageReference(image);
    const pools=SANDBOX_CONTAINER_CLASSES.includes(container.class_name)?'ENV PYTHON_POOL_MIN_SIZE=0 JAVASCRIPT_POOL_MIN_SIZE=0 TYPESCRIPT_POOL_MIN_SIZE=0\n':'';
    writeFileSync(dockerfile,`FROM ${immutableReference}\n${pools}`,{flag:'wx',mode:0o600});
    container.image=dockerfile;container.image_build_context=lockedImageDirectory;
  }
  return generated;
}

async function launch(root,secretsFiles,opencodeAuthFile,runtimeFile){
  const current=runVerticalPreflight({root,secretsFiles,opencodeAuthFile,runtimeFile});if(current.status!=='passed')throw Error('runtime-input-changed-after-preflight');
  migrateVerticalModelBudget(root);
  const loaded=loadSecretSources(secretsFiles.map(path=>inputPath(root,path)),inputPath(root,opencodeAuthFile));if(!loaded.values)throw Error('runtime-secrets-unavailable');
  const secrets=loaded.values,runtime=jsonFile(resolve(root,runtimeFile));
  const persistence=resolve(root,LOCAL_CATALOG_PERSISTENCE);
  const nonce=crypto.randomUUID(),configPath=resolve(root,'infra',`.vertical-runtime-${process.pid}-${nonce}.jsonc`),secretDirectory=mkdtempSync(resolve(tmpdir(),'riffology-vertical-secrets-')),lockedImageDirectory=mkdtempSync(resolve(tmpdir(),'riffology-vertical-images-')),envPath=resolve(secretDirectory,'.env');
  const config=buildLaunchConfig(jsonFile(resolve(root,PRODUCT_CONFIG)),runtime,lockedImageDirectory);
  writeFileSync(configPath,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
  const oauthEgress=googleOAuthEgress({googleClientId:secrets.GOOGLE_CLIENT_ID,googleClientSecret:secrets.GOOGLE_CLIENT_SECRET,redirectUri:`${runtime.APP_ORIGIN}/api/auth/callback/google`,telemetry:event=>process.stdout.write(`oauth-egress ${JSON.stringify(event)}\n`)});
  writeFileSync(envPath,[...REQUIRED_SECRETS.map(name=>`${name}=${JSON.stringify(secrets[name])}`),`${LOCAL_OAUTH_EGRESS_SECRET}=${JSON.stringify(oauthEgress.capability)}`].join('\n')+'\n',{flag:'wx',mode:0o600});
  const origin=new URL(runtime.APP_ORIGIN);let worker;
  try{
    worker=await unstable_startWorker({config:configPath,envFiles:[envPath],dev:{server:{hostname:'127.0.0.1',port:Number(origin.port||443),secure:true,httpsCertPath:resolve(root,runtime.HTTPS_CERT_PATH),httpsKeyPath:resolve(root,runtime.HTTPS_KEY_PATH)},persist:persistence,watch:false,inspector:false,logLevel:'error',enableContainers:true,dockerPath:'docker',containerBuildId:crypto.randomUUID().slice(0,8),outboundService:oauthEgress.outboundService}});
    await worker.ready;process.stdout.write(`vertical runtime ready: ${runtime.APP_ORIGIN}\n`);
    await new Promise(done=>{process.once('SIGINT',done);process.once('SIGTERM',done);});return 0;
  }finally{if(worker)await worker.dispose();try{unlinkSync(configPath);}catch{}rmSync(secretDirectory,{recursive:true,force:true});rmSync(lockedImageDirectory,{recursive:true,force:true});}
}

async function main(){
  const args=process.argv.slice(2),secretsFiles=args.filter(value=>value.startsWith('--secrets-file=')).map(value=>value.slice(15)),opencodeArgs=args.filter(value=>value.startsWith('--opencode-auth-file=')),opencodeAuthFile=opencodeArgs[0]?.slice(21)??null,runtimeFile=args.find(value=>value.startsWith('--runtime-file='))?.slice(15)??null;
  if(opencodeArgs.length>1||args.some(value=>value!=='--launch'&&!value.startsWith('--secrets-file=')&&!value.startsWith('--opencode-auth-file=')&&!value.startsWith('--runtime-file=')))throw Error('unsupported-argument');
  if(args.includes('--launch')){const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),migration=spawnSync('npx',['wrangler','d1','migrations','apply','riffology-catalog-local','--local','--config',resolve(root,PRODUCT_CONFIG),'--persist-to',resolve(root,LOCAL_CATALOG_PERSISTENCE)],{cwd:root,env:process.env,encoding:'utf8',input:'y\n',timeout:120000,maxBuffer:4*1024*1024});if(migration.status!==0)throw Error('local-catalog-migrations-failed');}
  const result=runVerticalPreflight({secretsFiles,opencodeAuthFile,runtimeFile});process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.status!=='passed')process.exitCode=2;
  else if(args.includes('--launch'))process.exitCode=await launch(resolve(fileURLToPath(new URL('../..',import.meta.url))),secretsFiles,opencodeAuthFile,runtimeFile);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(`vertical runtime preflight: ${error instanceof Error?error.message:'failed'}`);process.exitCode=1;});
