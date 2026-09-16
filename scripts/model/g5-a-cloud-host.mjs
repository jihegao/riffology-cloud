import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {G5ACdpDurableRunner,G5ASequentialLiveDriver,createG5ACdpTransport,g5ASerialSchedule,runG5ASerialHost} from './g5-a-live-driver.mjs';
import {createG5OperatorHttpAuthority} from './g5-a-operator-control.mjs';
import {G5B2ReadonlyProof} from './g5-b2-readonly-proof.mjs';
import {APP_ORIGIN,configSha256} from './g5-benchmark-live-runner.mjs';

const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PRIVATE=Symbol('g5-a-private-cloud-manifest');
const CREDENTIALS=Symbol('g5-a-private-cloud-credentials');
const GATES=['G5_ADMISSION_ENABLED','M2_TURNS_ENABLED','M2_MODEL_PROVIDER_ENABLED','PRODUCTION_MODEL_ENABLED','M4_SIMULATION_ENABLED'];
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const fail=code=>{throw Error(code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,name)=>{if(typeof value!=='string'||value.length===0||/[\r\n]/.test(value))fail(`g5-cloud-${name}-invalid`);return value;};
const sha=(value,name)=>{if(!SHA.test(value??''))fail(`g5-cloud-${name}-invalid`);return value;};
const absolute=(base,value,name)=>{text(value,name);const path=resolve(base,value);if(!path.startsWith(base+'/'))fail(`g5-cloud-${name}-outside-private-root`);return path;};
const clone=value=>structuredClone(value);
const json=result=>{if(result?.status!==0)fail('g5-cloud-command-failed');try{return JSON.parse(result.stdout);}catch{fail('g5-cloud-command-json-invalid');}};

async function privateFile(path,name){const info=await stat(path);if(!info.isFile()||(info.mode&0o077)!==0)fail(`g5-cloud-${name}-permissions-invalid`);return readFile(path,'utf8');}
async function validateCandidate(value,name,base){
 if(!object(value)||!object(value.normalized)||!object(value.normalized.vars))fail(`g5-cloud-${name}-candidate-invalid`);
 const configPath=absolute(base,value.configPath,`${name}-config`),normalized=clone(value.normalized),configSha256=hash(normalized);
 if(value.configSha256!==configSha256)fail(`g5-cloud-${name}-config-sha-conflict`);
 const artifactSha256=hash(await privateFile(configPath,`${name}-config`));if(value.artifactSha256!==artifactSha256)fail(`g5-cloud-${name}-artifact-sha-conflict`);
 return {configPath,normalized,configSha256,artifactSha256};
}
function admissionContract(raw,binding){
 const keys=['schemaVersion','windowId','normalTasks','maximumTasks','groupIntentTasks','groupIntentAdmission','receiptSha256'];
 if(!object(raw)||Object.keys(raw).sort().join()!==keys.sort().join()||raw.schemaVersion!==1||raw.windowId!==binding.windowId||raw.normalTasks!==63||raw.maximumTasks!==66||raw.groupIntentTasks!==3||raw.groupIntentAdmission!=='guard-task')fail('g5-cloud-admission-contract-invalid');
 const receiptSha256=hash({...raw,receiptSha256:undefined,...binding});if(raw.receiptSha256!==receiptSha256)fail('g5-cloud-admission-contract-sha-conflict');return Object.freeze(clone(raw));
}

/** Loads the only mutation authority. The manifest and referenced credentials/configs must be private files. */
export async function loadG5ACloudPrivateManifest(path){
 const manifestPath=resolve(path),raw=JSON.parse(await privateFile(manifestPath,'manifest')),base=dirname(manifestPath);
 if(raw?.schemaVersion!==1)fail('g5-cloud-manifest-schema-invalid');
 const closed=await validateCandidate(raw.closed,'closed',base),open=await validateCandidate(raw.open,'open',base),windowId=text(raw.windowId,'window'),profileSha256=sha(raw.profileSha256,'profile-sha256'),sourceSha256=sha(raw.sourceSha256,'source-sha256'),operatorOrigin=new URL(text(raw.operatorOrigin,'operator-origin')).origin;
 const binding={windowId,profileSha256,sourceSha256,closedConfigSha256:closed.configSha256,openConfigSha256:open.configSha256},manifest={schemaVersion:1,accountId:text(raw.accountId,'account'),workerName:text(raw.workerName,'worker'),gatewayId:text(raw.gatewayId,'gateway'),windowId,profileSha256,sourceSha256,operatorOrigin,credentialsFile:absolute(base,raw.credentialsFile,'credentials'),closed,open,admissionContract:admissionContract(raw.admissionContract,binding),containerNames:Array.isArray(raw.containerNames)&&raw.containerNames.length>0?[...raw.containerNames]:fail('g5-cloud-container-names-invalid')};
 if(new Set(manifest.containerNames).size!==manifest.containerNames.length||manifest.containerNames.some(value=>typeof value!=='string'||value.length===0))fail('g5-cloud-container-names-invalid');
 const credentials=Object.fromEntries((await privateFile(manifest.credentialsFile,'credentials')).split(/\r?\n/).filter(Boolean).map(line=>{const at=line.indexOf('=');if(at<1)fail('g5-cloud-credentials-invalid');return [line.slice(0,at),line.slice(at+1)];}));
 for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_AI_GATEWAY_READ_TOKEN','G5_OPERATOR_CAPABILITY'])if(typeof credentials[key]!=='string'||credentials[key].length<32)fail(`g5-cloud-${key.toLowerCase()}-missing`);
 if(credentials.CLOUDFLARE_AI_GATEWAY_READ_TOKEN===credentials.CLOUDFLARE_API_TOKEN)fail('g5-cloud-ai-gateway-read-token-not-distinct');
 Object.defineProperties(manifest,{[PRIVATE]:{value:true},[CREDENTIALS]:{value:Object.freeze(credentials)}});return Object.freeze(manifest);
}

function activeDeployment(value){
 const rows=Array.isArray(value)?value:Array.isArray(value?.deployments)?value.deployments:object(value)&&Array.isArray(value.versions)?[value]:[];
 if(rows.length<1)fail('g5-cloud-deployment-missing');const row=rows[0],versions=row?.versions??[];
 if(!UUID.test(row?.id??'')||versions.length!==1||versions[0]?.percentage!==100||!UUID.test(versions[0]?.version_id??''))fail('g5-cloud-deployment-not-exact');
 return {deploymentId:row.id,versionId:versions[0].version_id};
}
function versionVars(version){const rows=version?.resources?.bindings;if(!Array.isArray(rows))fail('g5-cloud-version-bindings-invalid');return Object.fromEntries(rows.filter(row=>row?.type==='plain_text'&&typeof row.name==='string'&&typeof row.text==='string').map(row=>[row.name,row.text]));}
function secretNames(version){return (version?.resources?.bindings??[]).filter(row=>row?.type==='secret_text').map(row=>row.name).sort();}
function candidateMatches(candidate,version){
 const vars=versionVars(version),expected=candidate.normalized.vars;
 if(Object.keys(expected).some(key=>vars[key]!==expected[key]))return false;
 const runtime=version?.resources?.script_runtime??{};
 if(candidate.normalized.compatibility_date&&runtime.compatibility_date!==candidate.normalized.compatibility_date)return false;
 if(candidate.normalized.compatibility_flags&&JSON.stringify([...(runtime.compatibility_flags??[])].sort())!==JSON.stringify([...candidate.normalized.compatibility_flags].sort()))return false;
 if(Array.isArray(candidate.normalized.requiredSecrets)&&JSON.stringify(secretNames(version))!==JSON.stringify([...candidate.normalized.requiredSecrets].sort()))return false;
 return true;
}

function workerMultipartParts(contentType,bytes){
 const body=Buffer.from(bytes),match=/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType??'');if(!match)fail('g5-cloud-source-content-type-invalid');
 const boundary=Buffer.from(`--${match[1]??match[2]}`),crlf=Buffer.from('\r\n'),headerEnd=Buffer.from('\r\n\r\n'),nextBoundary=Buffer.concat([crlf,boundary]),parts=new Map();let cursor=0,closed=false;
 while(cursor<body.length){if(!body.subarray(cursor,cursor+boundary.length).equals(boundary))fail('g5-cloud-source-multipart-invalid');cursor+=boundary.length;if(body.subarray(cursor,cursor+2).equals(Buffer.from('--'))){cursor+=2;if(cursor===body.length||cursor+2===body.length&&body.subarray(cursor).equals(crlf)){closed=true;break;}fail('g5-cloud-source-multipart-invalid');}if(!body.subarray(cursor,cursor+2).equals(crlf))fail('g5-cloud-source-multipart-invalid');cursor+=2;const split=body.indexOf(headerEnd,cursor);if(split<0)fail('g5-cloud-source-multipart-invalid');const headers=body.subarray(cursor,split).toString('utf8'),name=/content-disposition:[^\r\n]*\bname="([^"]+)"/i.exec(headers)?.[1],partContentType=/^content-type:\s*([^\r\n]+)/im.exec(headers)?.[1]?.trim().toLowerCase()??null,payloadStart=split+headerEnd.length,end=body.indexOf(nextBoundary,payloadStart);if(end<0||!name||parts.has(name))fail('g5-cloud-source-multipart-invalid');parts.set(name,{bytes:body.subarray(payloadStart,end),contentType:partContentType});cursor=end+crlf.length;}
 if(!closed||parts.size===0)fail('g5-cloud-source-multipart-invalid');return parts;
}
function metadataMainModuleSha256(parts){let metadata;try{metadata=JSON.parse(parts.get('metadata')?.bytes.toString('utf8')??'');}catch{fail('g5-cloud-source-metadata-invalid');}const main=metadata?.main_module??metadata?.body_part;if(typeof main!=='string'||!parts.has(main))fail('g5-cloud-source-main-module-missing');return hash(parts.get(main).bytes);}
export function workerMainModuleSha256(contentType,bytes){return metadataMainModuleSha256(workerMultipartParts(contentType,bytes));}
function workerContentV2MainModuleSha256(contentType,bytes){
 const parts=workerMultipartParts(contentType,bytes);if(parts.has('metadata'))return metadataMainModuleSha256(parts);
 const eligible=[...parts.values()].filter(part=>part.contentType?.split(';',1)[0].trim()==='application/javascript+module');if(eligible.length!==1)fail('g5-cloud-source-main-module-ambiguous');return hash(eligible[0].bytes);
}

export async function workerScriptContentV2Sha256({accountId,workerName,apiToken,fetcher=fetch}){
 const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/content/v2`,{headers:{authorization:`Bearer ${apiToken}`}});
 if(!response.ok)fail(`g5-cloud-source-${response.status}`);
 return workerContentV2MainModuleSha256(response.headers.get('content-type'),Buffer.from(await response.arrayBuffer()));
}

export async function collectContainerInstancePages(fetchPage,{maxPages=64}={}){
 const pages=[],seen=new Set();let token=null;
 for(let index=0;index<maxPages;index++){const page=await fetchPage(token),info=page?.result_info;if(!object(info)||info.page_token!==token)fail('g5-cloud-instance-page-token-invalid');pages.push(page);const next=info.next_page_token??null;if(next===null)return pages;if(typeof next!=='string'||next.length===0||seen.has(next))fail('g5-cloud-instance-page-token-repeated');seen.add(next);token=next;}
 fail('g5-cloud-instance-pagination-limit');
}

function commandCloud(manifest,{runner=(bin,args,options)=>spawnSync(bin,args,options),fetcher=fetch,root=resolve(fileURLToPath(new URL('../..',import.meta.url)))}={}){
 const credentials=manifest[CREDENTIALS],wrangler=resolve(root,'node_modules/.bin/wrangler'),env={...process.env,CLOUDFLARE_API_TOKEN:credentials.CLOUDFLARE_API_TOKEN},run=args=>runner(wrangler,args,{cwd:root,env,encoding:'utf8',timeout:300000,maxBuffer:8*1024*1024}),workerConfigArgs=path=>['--config',path,'--name',manifest.workerName],containerConfigArgs=path=>['--config',path];
 const gatewayApi=async path=>{const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${manifest.accountId}${path}`,{headers:{authorization:`Bearer ${credentials.CLOUDFLARE_AI_GATEWAY_READ_TOKEN}`}});if(!response.ok)fail(`g5-cloud-api-${response.status}`);const body=await response.json();if(body?.success!==true)fail('g5-cloud-api-failed');return body.result;};
 const deployments=()=>json(run(['deployments','status','--json',...workerConfigArgs(manifest.closed.configPath)]));
 const version=id=>json(run(['versions','view',id,'--json',...workerConfigArgs(manifest.closed.configPath)]));
 return {
  deployments,version,
  async sourceSha256(id){if(!UUID.test(id??''))fail('g5-cloud-source-version-invalid');return workerScriptContentV2Sha256({accountId:manifest.accountId,workerName:manifest.workerName,apiToken:credentials.CLOUDFLARE_API_TOKEN,fetcher});},
  async gateway(){return gatewayApi(`/ai-gateway/gateways/${encodeURIComponent(manifest.gatewayId)}`);},
  async containerApps(){return json(run(['containers','list','--json',...containerConfigArgs(manifest.closed.configPath)]));},
  async instancePages(appId){return collectContainerInstancePages(token=>json(run(['containers','instances',appId,'--json','--per-page','100',...(token===null?[]:['--page-token',token]),...containerConfigArgs(manifest.closed.configPath)])));},
  async upload(configPath,tag){const before=json(run(['versions','list','--json',...workerConfigArgs(configPath)])),prior=new Set((Array.isArray(before)?before:[]).map(row=>row?.id));const uploaded=run(['versions','upload','--tag',tag,...workerConfigArgs(configPath)]);if(uploaded?.status!==0)fail('g5-cloud-upload-failed');const after=json(run(['versions','list','--json',...workerConfigArgs(configPath)])),matches=(Array.isArray(after)?after:[]).filter(row=>!prior.has(row?.id)&&(row?.annotations?.['workers/tag']===tag||row?.tag===tag));if(matches.length!==1||!UUID.test(matches[0]?.id??''))fail('g5-cloud-upload-version-invalid');return {versionId:matches[0].id};},
  async deploy(versionId){const deployed=run(['versions','deploy',`${versionId}@100`,'--yes',...workerConfigArgs(manifest.closed.configPath)]);if(deployed?.status!==0)fail('g5-cloud-deploy-submit-failed');return {submitted:true};},
 };
}

export function createG5CloudOperatorAuthority(manifest,{fetcher=fetch}={}){if(manifest?.[PRIVATE]!==true)fail('g5-cloud-private-manifest-required');const remote=createG5OperatorHttpAuthority({operatorOrigin:manifest.operatorOrigin,capability:manifest[CREDENTIALS].G5_OPERATOR_CAPABILITY,windowId:manifest.windowId,fetcher});return {...remote,inspectAdmissionContract:async input=>{if(input?.windowId!==manifest.windowId)fail('g5-cloud-admission-window-conflict');const actual=await remote.inspectAdmissionContract(),expected=manifest.admissionContract;if(!object(actual)||Object.keys(actual).sort().join()!==Object.keys(expected).sort().join()||Object.keys(expected).some(key=>JSON.stringify(actual[key])!==JSON.stringify(expected[key])))fail('g5-cloud-admission-authority-conflict');return clone(actual);}};}

async function inspectCloud(manifest,cloud){const deployment=activeDeployment(await cloud.deployments()),version=await cloud.version(deployment.versionId),sourceSha256=await cloud.sourceSha256(deployment.versionId),confirmed=activeDeployment(await cloud.deployments());if(confirmed.deploymentId!==deployment.deploymentId||confirmed.versionId!==deployment.versionId)fail('g5-cloud-deployment-changed-during-source-read');return {...deployment,version,sourceSha256};}
function selectConfig(manifest,version){const candidates=[manifest.closed,manifest.open].filter(candidate=>candidateMatches(candidate,version));if(candidates.length!==1)fail('g5-cloud-active-config-ambiguous');return candidates[0];}

/** Cloudflare control ports for runG5ASerialHost. The default mode is observational. */
export function createG5ACloudControlPorts(manifest,{execute=false,cloud,authority,runner,fetcher,root}={}){
 if(manifest?.[PRIVATE]!==true)fail('g5-cloud-private-manifest-required');cloud??=commandCloud(manifest,{runner,fetcher,root});authority??=createG5CloudOperatorAuthority(manifest,{fetcher});
 const readConfig=async()=>{const observed=await inspectCloud(manifest,cloud);if(observed.sourceSha256!==manifest.sourceSha256)fail('g5-cloud-source-conflict');return clone(selectConfig(manifest,observed.version).normalized);};
 return {
  readConfig,
  async deployExact(config){if(execute!==true)fail('g5-cloud-execute-required');const expected=hash(config),candidate=[manifest.closed,manifest.open].find(value=>value.configSha256===expected&&JSON.stringify(value.normalized)===JSON.stringify(config));if(!candidate)fail('g5-cloud-unapproved-config');if(hash(await privateFile(candidate.configPath,'deploy-config'))!==candidate.artifactSha256)fail('g5-cloud-deploy-artifact-drift');const tag=`g5-${expected.slice(0,24)}`,uploaded=await cloud.upload(candidate.configPath,tag);await cloud.deploy(uploaded.versionId);const observed=await inspectCloud(manifest,cloud),active=selectConfig(manifest,observed.version);if(observed.versionId!==uploaded.versionId||active.configSha256!==expected||observed.sourceSha256!==manifest.sourceSha256)fail('g5-cloud-deploy-readback-conflict');return {status:'confirmed',sha256:expected,versionId:observed.versionId,deploymentId:observed.deploymentId,evidenceSha256:hash({expected,artifactSha256:candidate.artifactSha256,tag,versionId:observed.versionId,deploymentId:observed.deploymentId,sourceSha256:observed.sourceSha256})};},
  async readState(){return authority.readState();},
  closeAdmission:async windowId=>{if(execute!==true)fail('g5-cloud-execute-required');if(windowId!==manifest.windowId)fail('g5-cloud-close-window-conflict');const value=await authority.closeAdmission({windowId,reason:'g5-a-host-stop'});return {closed:value.closed===true,windowId:value.windowId};},
 };
}

async function pagesComplete(cloud,apps){let nonInactive=0,total=0;const matched=[];for(const app of apps){if(typeof app?.id!=='string'||app.id.length===0||typeof app?.name!=='string'||app.name.length===0)fail('g5-cloud-container-app-invalid');const pages=await cloud.instancePages(app.id);if(!Array.isArray(pages)||pages.length===0)fail('g5-cloud-instance-pages-missing');let next=null,instances=0;for(const page of pages){const rows=Array.isArray(page)?page:page?.instances,info=Array.isArray(page)?{page_token:null,next_page_token:null}:page?.result_info;if(!Array.isArray(rows)||!object(info)||info.page_token!==next)fail('g5-cloud-instance-page-invalid');instances+=rows.length;total+=rows.length;nonInactive+=rows.filter(row=>row?.state!=='inactive').length;next=info.next_page_token??null;}if(next!==null)fail('g5-cloud-instance-pagination-incomplete');matched.push({name:app.name,id:app.id,instances});}return {apps:matched,total,nonInactive};}

export function createG5AReleasePreflight(manifest,{cloud,controlPorts,runner,fetcher,root}={}){
 if(manifest?.[PRIVATE]!==true)fail('g5-cloud-private-manifest-required');cloud??=commandCloud(manifest,{runner,fetcher,root});
 return async()=>{const observed=await inspectCloud(manifest,cloud),candidate=selectConfig(manifest,observed.version),vars=versionVars(observed.version);if(observed.sourceSha256!==manifest.sourceSha256||candidate.configSha256!==manifest.closed.configSha256&&candidate.configSha256!==manifest.open.configSha256)fail('g5-cloud-release-source-config-conflict');if(vars.G5_WINDOW_ID!==undefined&&vars.G5_WINDOW_ID!==manifest.windowId)fail('g5-cloud-release-window-conflict');if(vars.PRODUCTION_MODEL_PROFILE_SHA256!==undefined&&vars.PRODUCTION_MODEL_PROFILE_SHA256!==manifest.profileSha256)fail('g5-cloud-release-profile-conflict');if(GATES.some(name=>!['true','false'].includes(vars[name])))fail('g5-cloud-release-gates-invalid');const gateway=await cloud.gateway();if(gateway?.id!==manifest.gatewayId||gateway?.authentication!==true||gateway?.collect_logs!==false||gateway?.cache_invalidate_on_update!==false&&gateway?.cache_ttl!==0)fail('g5-cloud-gateway-policy-conflict');const accountApps=await cloud.containerApps();if(!Array.isArray(accountApps))fail('g5-cloud-container-app-conflict');const apps=manifest.containerNames.map(name=>{const matches=accountApps.filter(app=>app?.name===name);if(matches.length!==1)fail('g5-cloud-container-app-conflict');return matches[0];});if(new Set(apps.map(app=>app?.id)).size!==apps.length)fail('g5-cloud-container-app-conflict');const inventory=await pagesComplete(cloud,apps);if(inventory.nonInactive!==0)fail('g5-cloud-container-not-quiescent');const state=controlPorts?await controlPorts.readState():null;if(state&&(state.windowId!==manifest.windowId||state.closed||state.startedAt!==null||state.tasks!==0||state.dispatches!==0||Object.entries(state).some(([key,value])=>/(Unknown|Pending)$/.test(key)&&value!==0)))fail('g5-cloud-window-not-pristine');return {schemaVersion:1,windowId:manifest.windowId,profileSha256:manifest.profileSha256,sourceSha256:manifest.sourceSha256,versionId:observed.versionId,deploymentId:observed.deploymentId,configSha256:candidate.configSha256,gatewayId:manifest.gatewayId,containerApps:clone(inventory.apps),containerInstances:inventory.total,evidenceSha256:hash({versionId:observed.versionId,deploymentId:observed.deploymentId,configSha256:candidate.configSha256,sourceSha256:observed.sourceSha256,gatewayId:manifest.gatewayId,inventory})};};
}

export async function assembleG5ACloudAdapters({manifestPath,execute=false,cloud,authority,runner,fetcher,root}={}){
 const manifest=await loadG5ACloudPrivateManifest(manifestPath),authorityAdapter=authority??createG5CloudOperatorAuthority(manifest,{fetcher}),controlPorts=createG5ACloudControlPorts(manifest,{execute,cloud,authority:authorityAdapter,runner,fetcher,root}),releasePreflight=createG5AReleasePreflight(manifest,{cloud,controlPorts,runner,fetcher,root});
 return Object.freeze({manifest,authority:authorityAdapter,controlPorts,releasePreflight});
}

function requireB2Assembly(manifest,plan,config,approvedSha256,directory){
 const handoff=plan?.driverHandoff;
 if(!object(plan)||!object(handoff)||!object(config)||typeof directory!=='string'||directory.length===0)fail('g5-cloud-b2-input-invalid');
 if(config.authorization?.scope!=='g5-a-b2-controlled'||config.authorization.syntheticOnly!==true)fail('g5-cloud-b2-scope-required');
 if(approvedSha256!==configSha256(config))fail('g5-cloud-b2-approved-config-conflict');
 if(plan.windowId!==manifest.windowId||plan.sourceSha256!==manifest.sourceSha256||plan.profileSha256!==manifest.profileSha256||plan.openSha256!==manifest.open.configSha256||plan.closedSha256!==manifest.closed.configSha256)fail('g5-cloud-b2-plan-manifest-conflict');
 if(config.windowId!==manifest.windowId||config.sourceSha256!==manifest.sourceSha256||config.origin!==APP_ORIGIN||config.tenantId!==handoff.allowedTenantId||handoff.windowId!==manifest.windowId||handoff.profileSha256!==manifest.profileSha256||handoff.sourceSha256!==manifest.sourceSha256||handoff.openConfigSha256!==manifest.open.configSha256||handoff.ordinaryOrigin!==APP_ORIGIN)fail('g5-cloud-b2-config-binding-conflict');
 return handoff;
}

/** Production B2 assembly. One manifest creates the authority, controls, preflight, CDP transport, proof and driver. */
export async function assembleG5ACloudB2Host({plan,manifestPath,config,approvedSha256,directory,cdpUrl,connect,clock=Date.now,wait,projectPoll,cloud,runner,fetcher,root}={}){
 const manifest=await loadG5ACloudPrivateManifest(manifestPath),handoff=requireB2Assembly(manifest,plan,config,approvedSha256,directory);
 const authority=createG5CloudOperatorAuthority(manifest,{fetcher}),controlPorts=createG5ACloudControlPorts(manifest,{execute:true,cloud,authority,runner,fetcher,root}),releasePreflight=createG5AReleasePreflight(manifest,{cloud,controlPorts,runner,fetcher,root});
 const cdp=await createG5ACdpTransport({cdpUrl,expectedUserId:handoff.allowedUserId,allowedTenantId:handoff.allowedTenantId,deniedUserId:handoff.deniedUserId,deniedTenantId:handoff.deniedTenantId,windowId:manifest.windowId,openConfigSha256:manifest.open.configSha256,origin:handoff.ordinaryOrigin,connect,clock});
 try{
  const durableRunner=new G5ACdpDurableRunner({directory,config,approvedSha256,cdp,releasePreflight,operatorHandoff:handoff,clock}),b2Readonly=new G5B2ReadonlyProof({reader:cdp.readonlyReader,authority}),driver=new G5ASequentialLiveDriver({runner:durableRunner,authority,b2Readonly,clock,...(wait?{wait}:{}),...(projectPoll?{projectPoll}:{})});
  if(driver.authority!==authority||driver.b2Readonly.authority!==authority||driver.b2Readonly.reader!==cdp.readonlyReader||driver.runner.cdp!==cdp||driver.runner.releasePreflight!==releasePreflight)fail('g5-cloud-b2-wiring-conflict');
  return Object.freeze({manifest,authority,controlPorts,releasePreflight,cdp,b2Readonly,runner:durableRunner,driver});
 }catch(error){await cdp.close();throw error;}
}

/** Final production entrypoint. Execute mode refuses caller-supplied driver, CDP, authority or adapters. */
export async function runG5ACloudSerialHost(options={}){
 const {plan,manifestPath,config,approvedSha256,directory,cdpUrl,connect,execute=false,runProbes=false,cloud,runner,fetcher,root,clock,wait,projectPoll,...hostOptions}=options;
 if(execute!==true)return {status:'planned-not-executed',schedule:await g5ASerialSchedule()};
 if(['driver','cdp','authority','adapters','b2Readonly','controlPorts','releasePreflight','identityPreflight'].some(key=>Object.hasOwn(options,key)))fail('g5-cloud-b2-injection-denied');
 const wired=await assembleG5ACloudB2Host({plan,manifestPath,config,approvedSha256,directory,cdpUrl,connect,clock,wait,projectPoll,cloud,runner,fetcher,root});
 try{await wired.driver.init();return await runG5ASerialHost({plan,driver:wired.driver,controlPorts:wired.controlPorts,identityPreflight:wired.cdp.identityProof,execute:true,runProbes,...hostOptions});}
 finally{await wired.cdp.close();}
}
