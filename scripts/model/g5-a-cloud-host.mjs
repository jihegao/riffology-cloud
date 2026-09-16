import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runG5ASerialHost} from './g5-a-live-driver.mjs';

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

/** Loads the only mutation authority. The manifest and referenced credentials/configs must be private files. */
export async function loadG5ACloudPrivateManifest(path){
 const manifestPath=resolve(path),raw=JSON.parse(await privateFile(manifestPath,'manifest')),base=dirname(manifestPath);
 if(raw?.schemaVersion!==1)fail('g5-cloud-manifest-schema-invalid');
 const manifest={schemaVersion:1,accountId:text(raw.accountId,'account'),workerName:text(raw.workerName,'worker'),gatewayId:text(raw.gatewayId,'gateway'),windowId:text(raw.windowId,'window'),profileSha256:sha(raw.profileSha256,'profile-sha256'),sourceSha256:sha(raw.sourceSha256,'source-sha256'),operatorUrl:new URL(text(raw.operatorUrl,'operator-url')).href,authorityUrl:new URL(text(raw.authorityUrl,'authority-url')).href,credentialsFile:absolute(base,raw.credentialsFile,'credentials'),closed:await validateCandidate(raw.closed,'closed',base),open:await validateCandidate(raw.open,'open',base),containerNames:Array.isArray(raw.containerNames)&&raw.containerNames.length>0?[...raw.containerNames]:fail('g5-cloud-container-names-invalid')};
 if(new Set(manifest.containerNames).size!==manifest.containerNames.length||manifest.containerNames.some(value=>typeof value!=='string'||value.length===0))fail('g5-cloud-container-names-invalid');
 const credentials=Object.fromEntries((await privateFile(manifest.credentialsFile,'credentials')).split(/\r?\n/).filter(Boolean).map(line=>{const at=line.indexOf('=');if(at<1)fail('g5-cloud-credentials-invalid');return [line.slice(0,at),line.slice(at+1)];}));
 for(const key of ['CLOUDFLARE_API_TOKEN','G5_OPERATOR_CAPABILITY'])if(typeof credentials[key]!=='string'||credentials[key].length<32)fail(`g5-cloud-${key.toLowerCase()}-missing`);
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

function commandCloud(manifest,{runner=(bin,args,options)=>spawnSync(bin,args,options),fetcher=fetch,root=resolve(fileURLToPath(new URL('../..',import.meta.url)))}={}){
 const credentials=manifest[CREDENTIALS],wrangler=resolve(root,'node_modules/.bin/wrangler'),env={...process.env,CLOUDFLARE_API_TOKEN:credentials.CLOUDFLARE_API_TOKEN},run=args=>runner(wrangler,args,{cwd:root,env,encoding:'utf8',timeout:300000,maxBuffer:8*1024*1024}),configArgs=path=>['--config',path,'--name',manifest.workerName];
 const api=async path=>{const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${manifest.accountId}${path}`,{headers:{authorization:`Bearer ${credentials.CLOUDFLARE_API_TOKEN}`}});if(!response.ok)fail(`g5-cloud-api-${response.status}`);const body=await response.json();if(body?.success!==true)fail('g5-cloud-api-failed');return body.result;};
 const deployments=()=>json(run(['deployments','status','--json',...configArgs(manifest.closed.configPath)]));
 const version=id=>json(run(['versions','view',id,'--json',...configArgs(manifest.closed.configPath)]));
 return {
  deployments,version,
  async sourceSha256(id){const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${manifest.accountId}/workers/scripts/${manifest.workerName}/versions/${id}/content`,{headers:{authorization:`Bearer ${credentials.CLOUDFLARE_API_TOKEN}`}});if(!response.ok)fail(`g5-cloud-source-${response.status}`);return hash(Buffer.from(await response.arrayBuffer()));},
  async gateway(){return api(`/ai-gateway/gateways/${encodeURIComponent(manifest.gatewayId)}`);},
  async containerApps(){return json(run(['containers','list','--json',...configArgs(manifest.closed.configPath)]));},
  async instancePages(appId){const first=json(run(['containers','instances',appId,'--json','--per-page','100',...configArgs(manifest.closed.configPath)]));return [first];},
  async upload(configPath,tag){const before=json(run(['versions','list','--json',...configArgs(configPath)])),prior=new Set((Array.isArray(before)?before:[]).map(row=>row?.id));const uploaded=run(['versions','upload','--tag',tag,...configArgs(configPath)]);if(uploaded?.status!==0)fail('g5-cloud-upload-failed');const after=json(run(['versions','list','--json',...configArgs(configPath)])),matches=(Array.isArray(after)?after:[]).filter(row=>!prior.has(row?.id)&&(row?.annotations?.['workers/tag']===tag||row?.tag===tag));if(matches.length!==1||!UUID.test(matches[0]?.id??''))fail('g5-cloud-upload-version-invalid');return {versionId:matches[0].id};},
  async deploy(versionId){const deployed=run(['versions','deploy',`${versionId}@100`,'--yes',...configArgs(manifest.closed.configPath)]);if(deployed?.status!==0)fail('g5-cloud-deploy-submit-failed');return {submitted:true};},
 };
}

function bearer(manifest){return `Bearer ${manifest[CREDENTIALS].G5_OPERATOR_CAPABILITY}`;}
async function postJson(url,token,body,fetcher,extraHeaders={}){const response=await fetcher(url,{method:'POST',redirect:'error',headers:{authorization:token,'content-type':'application/json',accept:'application/json',...extraHeaders},body:JSON.stringify(body)});let value;try{value=await response.json();}catch{fail('g5-cloud-private-response-invalid');}if(!response.ok||value?.ok!==true)fail('g5-cloud-private-request-failed');return value;}

export function createG5OperatorHttpAdapter(manifest,{fetcher=fetch}={}){
 if(manifest?.[PRIVATE]!==true)fail('g5-cloud-private-manifest-required');
 let last=null;return {
  async snapshot(){last=await postJson(manifest.operatorUrl,bearer(manifest),{action:'snapshot',windowId:manifest.windowId},fetcher);return last;},
  async closeAdmission(){const before=last??await this.snapshot();const value=await postJson(manifest.operatorUrl,bearer(manifest),{action:'close',windowId:manifest.windowId,expectedSnapshotSha256:before.snapshotSha256,confirmation:'close-existing-window'},fetcher,{'x-g5-mutation':'close-admission'});last=null;return {closed:value.closed===true,windowId:value.windowId};},
 };
}

/** Adapter for a separately reviewed, capability-protected authority Worker. It never returns the capability. */
export function createG5AuthorityHttpAdapter(manifest,{fetcher=fetch}={}){
 if(manifest?.[PRIVATE]!==true)fail('g5-cloud-private-manifest-required');
 const invoke=async(action,payload={})=>{const value=await postJson(manifest.authorityUrl,bearer(manifest),{action,windowId:manifest.windowId,payload},fetcher);if(value.windowId!==manifest.windowId||!object(value.result))fail('g5-cloud-authority-binding-conflict');return value.result;};
 return {inspectState:()=>invoke('state'),inspectAdmissionContract:payload=>invoke('admission-contract',payload),inspectTask:payload=>invoke('task',payload),inspectRun:payload=>invoke('run',payload),inspectFinal:payload=>invoke('final',payload),prepareProbe:payload=>invoke('prepare-probe',payload),inspectProbe:payload=>invoke('probe',payload)};
}

function guardState(value){const s=value?.summary;if(value?.ok!==true||s?.authority!=='g5-window-guard-only'||s.completeLedgers!==false||!object(s.counts)||!object(s.money))fail('g5-cloud-guard-summary-invalid');return {windowId:s.windowId,startedAt:s.startedAt,closed:s.closed,tasks:s.counts.tasks,dispatches:s.counts.dispatches,simulationRuns:s.counts.simulationRuns,serviceRuns:s.counts.serviceRuns,guardUnknown:s.counts.guardUnknown,guardPending:s.counts.guardPending+s.counts.openTurns,totalNanodollars:s.money.guardAccountedNanodollars,maxTurnNanodollars:s.money.guardMaxTurnNanodollars};}
function completeState(guard,ledger){
 const names=['tokenUnknown','tokenPending','moneyUnknown','moneyPending','toolUnknown','toolPending'];
 if(ledger?.schemaVersion!==1||ledger.windowId!==guard.windowId||ledger.completeLedgers!==true||names.some(name=>!Number.isSafeInteger(ledger[name])||ledger[name]<0))fail('g5-cloud-ledger-state-incomplete');
 for(const key of ['tasks','dispatches','simulationRuns','serviceRuns','startedAt','closed'])if(JSON.stringify(ledger[key])!==JSON.stringify(guard[key]))fail(`g5-cloud-state-${key}-conflict`);
 return {...guard,...Object.fromEntries(names.map(name=>[name,ledger[name]]))};
}

async function inspectCloud(manifest,cloud){const deployment=activeDeployment(await cloud.deployments()),version=await cloud.version(deployment.versionId),sourceSha256=await cloud.sourceSha256(deployment.versionId);return {...deployment,version,sourceSha256};}
function selectConfig(manifest,version){const candidates=[manifest.closed,manifest.open].filter(candidate=>candidateMatches(candidate,version));if(candidates.length!==1)fail('g5-cloud-active-config-ambiguous');return candidates[0];}

/** Cloudflare control ports for runG5ASerialHost. The default mode is observational. */
export function createG5ACloudControlPorts(manifest,{execute=false,cloud,operator,authority,runner,fetcher,root}={}){
 if(manifest?.[PRIVATE]!==true)fail('g5-cloud-private-manifest-required');cloud??=commandCloud(manifest,{runner,fetcher,root});operator??=createG5OperatorHttpAdapter(manifest,{fetcher});authority??=createG5AuthorityHttpAdapter(manifest,{fetcher});
 const readConfig=async()=>{const observed=await inspectCloud(manifest,cloud);if(observed.sourceSha256!==manifest.sourceSha256)fail('g5-cloud-source-conflict');return clone(selectConfig(manifest,observed.version).normalized);};
 return {
  readConfig,
  async deployExact(config){if(execute!==true)fail('g5-cloud-execute-required');const expected=hash(config),candidate=[manifest.closed,manifest.open].find(value=>value.configSha256===expected&&JSON.stringify(value.normalized)===JSON.stringify(config));if(!candidate)fail('g5-cloud-unapproved-config');if(hash(await privateFile(candidate.configPath,'deploy-config'))!==candidate.artifactSha256)fail('g5-cloud-deploy-artifact-drift');const tag=`g5-${expected.slice(0,24)}`,uploaded=await cloud.upload(candidate.configPath,tag);await cloud.deploy(uploaded.versionId);const observed=await inspectCloud(manifest,cloud),active=selectConfig(manifest,observed.version);if(observed.versionId!==uploaded.versionId||active.configSha256!==expected||observed.sourceSha256!==manifest.sourceSha256)fail('g5-cloud-deploy-readback-conflict');return {status:'confirmed',sha256:expected,versionId:observed.versionId,deploymentId:observed.deploymentId,evidenceSha256:hash({expected,artifactSha256:candidate.artifactSha256,tag,versionId:observed.versionId,deploymentId:observed.deploymentId,sourceSha256:observed.sourceSha256})};},
  async readState(){return completeState(guardState(await operator.snapshot()),await authority.inspectState());},
  closeAdmission:async windowId=>{if(execute!==true)fail('g5-cloud-execute-required');if(windowId!==manifest.windowId)fail('g5-cloud-close-window-conflict');return operator.closeAdmission();},
 };
}

async function pagesComplete(cloud,apps){let nonInactive=0,total=0;for(const app of apps){const pages=await cloud.instancePages(app.id);if(!Array.isArray(pages)||pages.length===0)fail('g5-cloud-instance-pages-missing');let next=null;for(const page of pages){const rows=Array.isArray(page)?page:page?.instances,info=Array.isArray(page)?{page_token:null,next_page_token:null}:page?.result_info;if(!Array.isArray(rows)||!object(info)||info.page_token!==next)fail('g5-cloud-instance-page-invalid');total+=rows.length;nonInactive+=rows.filter(row=>row?.state!=='inactive').length;next=info.next_page_token??null;}if(next!==null)fail('g5-cloud-instance-pagination-incomplete');}return {total,nonInactive};}

export function createG5AReleasePreflight(manifest,{cloud,controlPorts,runner,fetcher,root}={}){
 if(manifest?.[PRIVATE]!==true)fail('g5-cloud-private-manifest-required');cloud??=commandCloud(manifest,{runner,fetcher,root});
 return async()=>{const observed=await inspectCloud(manifest,cloud),candidate=selectConfig(manifest,observed.version),vars=versionVars(observed.version);if(observed.sourceSha256!==manifest.sourceSha256||candidate.configSha256!==manifest.closed.configSha256&&candidate.configSha256!==manifest.open.configSha256)fail('g5-cloud-release-source-config-conflict');if(vars.G5_WINDOW_ID!==undefined&&vars.G5_WINDOW_ID!==manifest.windowId)fail('g5-cloud-release-window-conflict');if(vars.PRODUCTION_MODEL_PROFILE_SHA256!==undefined&&vars.PRODUCTION_MODEL_PROFILE_SHA256!==manifest.profileSha256)fail('g5-cloud-release-profile-conflict');if(GATES.some(name=>!['true','false'].includes(vars[name])))fail('g5-cloud-release-gates-invalid');const gateway=await cloud.gateway();if(gateway?.id!==manifest.gatewayId||gateway?.authentication!==true||gateway?.collect_logs!==false||gateway?.cache_invalidate_on_update!==false&&gateway?.cache_ttl!==0)fail('g5-cloud-gateway-policy-conflict');const apps=await cloud.containerApps();if(!Array.isArray(apps)||apps.length!==manifest.containerNames.length||manifest.containerNames.some(name=>apps.filter(app=>app?.name===name).length!==1))fail('g5-cloud-container-app-conflict');const inventory=await pagesComplete(cloud,apps);if(inventory.nonInactive!==0)fail('g5-cloud-container-not-quiescent');const state=controlPorts?await controlPorts.readState():null;if(state&&(state.windowId!==manifest.windowId||state.closed||state.startedAt!==null||state.tasks!==0||state.dispatches!==0||Object.entries(state).some(([key,value])=>/(Unknown|Pending)$/.test(key)&&value!==0)))fail('g5-cloud-window-not-pristine');return {schemaVersion:1,windowId:manifest.windowId,profileSha256:manifest.profileSha256,sourceSha256:manifest.sourceSha256,versionId:observed.versionId,deploymentId:observed.deploymentId,configSha256:candidate.configSha256,gatewayId:manifest.gatewayId,containerInstances:inventory.total,evidenceSha256:hash({versionId:observed.versionId,deploymentId:observed.deploymentId,configSha256:candidate.configSha256,sourceSha256:observed.sourceSha256,gatewayId:manifest.gatewayId,inventory})};};
}

export async function assembleG5ACloudAdapters({manifestPath,execute=false,cloud,operator,authority,runner,fetcher,root}={}){
 const manifest=await loadG5ACloudPrivateManifest(manifestPath),authorityAdapter=authority??createG5AuthorityHttpAdapter(manifest,{fetcher}),operatorAdapter=operator??createG5OperatorHttpAdapter(manifest,{fetcher}),controlPorts=createG5ACloudControlPorts(manifest,{execute,cloud,operator:operatorAdapter,authority:authorityAdapter,runner,fetcher,root}),releasePreflight=createG5AReleasePreflight(manifest,{cloud,controlPorts,runner,fetcher,root});
 return Object.freeze({manifest,authority:authorityAdapter,operator:operatorAdapter,controlPorts,releasePreflight});
}

/** Final assembly seam: the CDP identity receipt is consumed without exposing its browser cookies. */
export async function runG5ACloudSerialHost({plan,driver,cdp,manifestPath,adapters=null,execute=false,runProbes=false,cloud,operator,authority,runner,fetcher,root,...hostOptions}={}){
 if(execute!==true)return runG5ASerialHost({plan,driver,execute:false,identityPreflight:cdp?.identityProof});
 const wired=adapters??await assembleG5ACloudAdapters({manifestPath,execute:true,cloud,operator,authority,runner,fetcher,root});
 if(driver?.authority!==wired.authority||driver?.runner?.cdp!==cdp)fail('g5-cloud-driver-adapter-conflict');driver.runner.releasePreflight=wired.releasePreflight;
 if(!driver.schedule)await driver.init();return runG5ASerialHost({plan,driver,controlPorts:wired.controlPorts,identityPreflight:cdp.identityProof,execute:true,runProbes,...hostOptions});
}
