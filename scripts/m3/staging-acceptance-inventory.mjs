import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {STAGING_CHECKPOINT_BUCKET,STAGING_CONFIG,STAGING_DATABASE} from './vertical-staging-preflight.mjs';

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const WORKER_SHA=/^[a-f0-9]{40}$/;
const SHA=/^[a-f0-9]{64}$/;
const VERSION=/^[a-f0-9-]{36}$/;
const MAX_MANIFEST_BYTES=64*1024;
const MAX_BLOB_BYTES=64*1024*1024;
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Error(code);};

function exact(value,keys,code){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail(code);}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function sameScope(a,b){return a?.tenantId===b?.tenantId&&a?.projectId===b?.projectId&&a?.workspaceId===b?.workspaceId&&a?.workspaceGeneration===b?.workspaceGeneration;}
function parse(result,code){if(result?.status!==0)fail(code);try{return JSON.parse(result.stdout);}catch{fail(code);}}
function runJson(runner,bin,args,code){return parse(runner(bin,args,{encoding:'utf8',timeout:120_000,maxBuffer:8*1024*1024}),code);}
function run(runner,bin,args,code){const result=runner(bin,args,{encoding:'utf8',timeout:120_000,maxBuffer:8*1024*1024});if(result?.status!==0)fail(code);return result;}
function scope(value,workspaceId){
  exact(value,['tenantId','projectId','workspaceId','workspaceGeneration'],'acceptance-inventory-workspace-scope-invalid');
  if(!ID.test(value.tenantId)||!ID.test(value.projectId)||value.workspaceId!==workspaceId||!ID.test(value.workspaceId)||!Number.isSafeInteger(value.workspaceGeneration)||value.workspaceGeneration<1)fail('acceptance-inventory-workspace-scope-invalid');
  return {...value};
}
function safeInstance(item){
  if(!item||typeof item!=='object'||!ID.test(item.name??'')||typeof item.id!=='string'||item.id.length===0||typeof item.state!=='string'||item.state.length===0)fail('acceptance-inventory-instance-invalid');
  return {id:item.id,name:item.name,state:item.state};
}
function rows(value){
  if(Array.isArray(value))return value.map(safeInstance);
  const next=value?.result_info?.next_page_token??value?.next_page_token??null;
  if(!value||!Array.isArray(value.instances)||next!==null)fail('acceptance-inventory-instance-page-incomplete');
  return value.instances.map(safeInstance);
}
function uniqueInstances(items){
  const names=new Set(),ids=new Set();for(const item of items){if(names.has(item.name)||ids.has(item.id))fail('acceptance-inventory-duplicate-instance');names.add(item.name);ids.add(item.id);}return items;
}
function deployment(value,release){const versions=value?.versions??[];if(versions.length!==1||versions[0]?.version_id!==release.workerVersionId||versions[0]?.percentage!==100)fail('acceptance-inventory-release-version-no-longer-active');}
function publicWorkspace(value,auth){
  if(!value||value.schemaVersion!==3||!value.sessions?.[auth.sessionId])fail('acceptance-inventory-workspace-snapshot-invalid');
  return {scope:scope(value.scope,auth.workspaceId),head:value.sessions[auth.sessionId]?.head??null,activeTurnId:value.activeTurnId??null,resourceWait:value.resourceWait??null,releaseHold:value.releaseHold??null,recoveryHold:value.recoveryHold??null};
}
async function requestWorkspace(auth){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
  try{const response=await fetch(`${auth.origin}/api/workspaces/${auth.workspaceId}`,{headers:{accept:'application/json','cache-control':'no-cache',cookie:auth.cookie,origin:auth.origin},redirect:'error',signal:controller.signal});if(!response.ok)fail(`acceptance-inventory-workspace-http-${response.status}`);return publicWorkspace(await response.json(),auth);}finally{clearTimeout(timer);}
}

export function selectAcceptanceApps(apps,configured){
  if(!Array.isArray(apps)||!Array.isArray(configured)||configured.length!==4)fail('acceptance-inventory-container-config-invalid');
  return configured.map(candidate=>{
    const matches=apps.filter(item=>item?.name===candidate.name&&item?.image===candidate.image&&typeof item?.id==='string');
    if(matches.length!==1)fail(`acceptance-inventory-container-app-mismatch:${candidate.class_name}`);
    return {className:candidate.class_name,id:matches[0].id,name:matches[0].name,image:matches[0].image};
  });
}

function inventory(root,runner,release,expectedApps=null){
  const config=JSON.parse(readFileSync(resolve(root,STAGING_CONFIG),'utf8')),wrangler=resolve(root,'node_modules/.bin/wrangler'),cloud=['--config',resolve(root,STAGING_CONFIG)];
  deployment(runJson(runner,wrangler,['deployments','status','--json',...cloud],'acceptance-inventory-deployment-query-failed'),release);
  const apps=selectAcceptanceApps(runJson(runner,wrangler,['containers','list','--json',...cloud],'acceptance-inventory-container-list-failed'),config.containers??[]);
  if(expectedApps&&!same(apps,expectedApps))fail('acceptance-inventory-container-app-changed');
  return {apps,instances:Object.fromEntries(apps.map(app=>[app.className,uniqueInstances(rows(runJson(runner,wrangler,['containers','instances',app.id,'--json','--per-page','100',...cloud],`acceptance-inventory-instance-list-failed:${app.className}`)))]))};
}
function summary(snapshot,observedAt){
  const states=Object.values(snapshot.instances).flat().map(item=>item.state),count=value=>states.filter(state=>state===value).length;
  return {observedAt,active:count('active')+count('running')+count('starting')+count('scheduling'),live:count('live'),assigned:count('assigned'),failed:count('failed'),nonInactive:states.filter(state=>state!=='inactive').length,total:states.length};
}
function setEqual(a,b){return a.size===b.size&&[...a].every(value=>b.has(value));}
function newNames(snapshot,baseline,className){const prior=new Set(baseline[className]??[]);return new Set((snapshot.instances[className]??[]).map(item=>item.name).filter(name=>!prior.has(name)));}

export async function collectStagingInventoryPreflight({root,release,auth,probe,runner=spawnSync}={}){
  try{
    if(!release||!WORKER_SHA.test(release.workerSourceSha??'')||!VERSION.test(release.workerVersionId??'')||probe?.status!=='passed')fail('acceptance-inventory-preflight-input-invalid');
    const workspace=await requestWorkspace(auth),snapshot=inventory(root,runner,release),observedAt=Date.now(),application=summary(snapshot,observedAt);
    if(workspace.activeTurnId!==null||workspace.resourceWait!==null||workspace.releaseHold!==null||workspace.recoveryHold!==null)fail('acceptance-inventory-workspace-not-quiescent');
    if(application.nonInactive!==0)fail('acceptance-inventory-preflight-not-quiescent');
    return {schemaVersion:1,status:'passed',workerSourceSha:release.workerSourceSha,workerVersionId:release.workerVersionId,scope:workspace.scope,sessionId:auth.sessionId,baselineWorkspace:{head:workspace.head,activeTurnId:null,resourceWait:null,releaseHold:null,recoveryHold:null},apps:snapshot.apps,baselineInstances:Object.fromEntries(snapshot.apps.map(app=>[app.className,snapshot.instances[app.className].map(item=>item.name).sort()])),applicationObservation:application};
  }catch(error){return {schemaVersion:1,status:'blocked',reasonCode:error instanceof Error?error.message:'acceptance-inventory-preflight-failed'};}
}

function base32(bytes){const alphabet='abcdefghijklmnopqrstuvwxyz234567';let bits=0,value=0,result='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){result+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)result+=alphabet[(value<<(5-bits))&31];return result;}
export function acceptanceActorIds(rawScope,turnId,dispatchId){
  const encoded=base32(createHash('sha256').update(JSON.stringify({schemaVersion:1,scope:rawScope,turnId,dispatchId})).digest());return {trustedPi:`m2-t-${encoded}`,project:`m2-p-${encoded}`};
}
function objectKey(scopeValue,identity){return `turns/${scopeValue.tenantId}/${scopeValue.projectId}/${scopeValue.workspaceId}/${identity.generation}/${identity.sessionId}/${identity.turnId}/${identity.dispatchId}.json`;}
function blobKey(scopeValue,kind,sha){return `turn-blobs-v3/${scopeValue.tenantId}/${scopeValue.projectId}/${scopeValue.workspaceId}/${kind}/${sha}`;}
function manifestPart(value,scopeValue,kind){exact(value,['objectKey','sha256','size'],'acceptance-inventory-manifest-invalid');if(!SHA.test(value.sha256)||!Number.isSafeInteger(value.size)||value.size<1||value.size>MAX_BLOB_BYTES||value.objectKey!==blobKey(scopeValue,kind,value.sha256))fail('acceptance-inventory-manifest-invalid');return {...value};}
function manifest(bytes,turn,expectedScope,sessionId){
  if(bytes.byteLength<1||bytes.byteLength>MAX_MANIFEST_BYTES||hash(bytes)!==turn.checkpoint.revisionId)fail('acceptance-inventory-manifest-receipt-mismatch');
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail('acceptance-inventory-manifest-invalid');}
  exact(value,['schemaVersion','identity','base','outcome','executionErrorCode','files','piSession','committedAt'],'acceptance-inventory-manifest-invalid');
  const identity=value.identity;exact(identity,['scope','sessionId','turnId','dispatchId','generation'],'acceptance-inventory-manifest-invalid');
  const manifestScope=scope(identity.scope,expectedScope.workspaceId);
  if(value.schemaVersion!==3||!sameScope(manifestScope,expectedScope)||identity.sessionId!==sessionId||identity.turnId!==turn.turnId||!ID.test(identity.dispatchId??'')||identity.generation!==expectedScope.workspaceGeneration||value.outcome!=='completed'||value.executionErrorCode!==null||!Number.isSafeInteger(value.committedAt)||value.committedAt!==turn.checkpoint.committedAt||turn.checkpoint.objectKey!==objectKey(expectedScope,identity))fail('acceptance-inventory-manifest-identity-mismatch');
  const files=manifestPart(value.files,expectedScope,'files'),piSession=manifestPart(value.piSession,expectedScope,'sessions');
  if(files.sha256!==turn.checkpoint.filesSha256||piSession.sha256!==turn.checkpoint.sessionSha256)fail('acceptance-inventory-manifest-receipt-mismatch');
  return {identity,files,piSession,committedAt:value.committedAt};
}
function readR2(root,runner,wrangler,key,path,max,code){run(runner,wrangler,['r2','object','get',`${STAGING_CHECKPOINT_BUCKET}/${key}`,'--file',path,'--remote','--config',resolve(root,STAGING_CONFIG)],code);const size=statSync(path).size;if(size<1||size>max)fail(code);return readFileSync(path);}
function verifyBlob(root,runner,wrangler,item,path){const bytes=readR2(root,runner,wrangler,item.objectKey,path,item.size,'acceptance-inventory-r2-blob-read-failed');if(bytes.byteLength!==item.size||hash(bytes)!==item.sha256)fail('acceptance-inventory-r2-blob-mismatch');return {objectKey:item.objectKey,sha256:item.sha256,size:item.size};}
function d1(root,runner,wrangler,expectedScope){
  const s=expectedScope,query=`SELECT (SELECT count(*) FROM catalog_workspaces WHERE id='${s.workspaceId}' AND project_id='${s.projectId}' AND tenant_id='${s.tenantId}' AND generation=${s.workspaceGeneration} AND status='ready') AS workspace_rows,(SELECT count(*) FROM catalog_outbox WHERE workspace_id='${s.workspaceId}' AND project_id='${s.projectId}' AND tenant_id='${s.tenantId}' AND generation=${s.workspaceGeneration} AND kind='workspace.provision' AND state='completed') AS provision_rows,(SELECT count(*) FROM catalog_provisioning_receipts r JOIN catalog_outbox o ON o.id=r.outbox_id WHERE o.workspace_id='${s.workspaceId}' AND o.project_id='${s.projectId}' AND o.tenant_id='${s.tenantId}' AND o.generation=${s.workspaceGeneration} AND o.kind='workspace.provision') AS receipt_rows,(SELECT count(*) FROM (SELECT r.outbox_id,r.sequence,count(*) AS copies FROM catalog_provisioning_receipts r JOIN catalog_outbox o ON o.id=r.outbox_id WHERE o.workspace_id='${s.workspaceId}' AND o.project_id='${s.projectId}' AND o.tenant_id='${s.tenantId}' AND o.generation=${s.workspaceGeneration} AND o.kind='workspace.provision' GROUP BY r.outbox_id,r.sequence HAVING count(*)>1)) AS duplicate_provision_keys`;
  const value=runJson(runner,wrangler,['d1','execute',STAGING_DATABASE.name,'--remote','--json','--command',query,'--config',resolve(root,STAGING_CONFIG)],'acceptance-inventory-d1-query-failed'),result=value?.[0];
  if(!Array.isArray(value)||value.length!==1||result?.success!==true||!Array.isArray(result.results)||result.results.length!==1)fail('acceptance-inventory-d1-result-invalid');const row=result.results[0];
  for(const key of ['workspace_rows','provision_rows','receipt_rows','duplicate_provision_keys'])if(!Number.isSafeInteger(row?.[key])||row[key]<0)fail('acceptance-inventory-d1-result-invalid');
  if(row.workspace_rows!==1||row.provision_rows!==1||row.receipt_rows<1||row.duplicate_provision_keys!==0)fail('acceptance-inventory-d1-provision-mismatch');return {workspaceRows:row.workspace_rows,provisionRows:row.provision_rows,receiptRows:row.receipt_rows,duplicateProvisionKeys:row.duplicate_provision_keys};
}

export async function collectStagingFinalInventory({root,release,auth,turns,readiness,runner=spawnSync,quietMs=30_000,pollMs=5_000,deadlineMs=15*60_000}={}){
  const directory=mkdtempSync(resolve(tmpdir(),'riffology-acceptance-inventory-'));
  try{
    if(readiness?.status!=='passed'||readiness.workerSourceSha!==release?.workerSourceSha||readiness.workerVersionId!==release?.workerVersionId||readiness.sessionId!==auth?.sessionId||(turns?.finalSnapshot?.scope&&!sameScope(readiness.scope,turns.finalSnapshot.scope))||!Array.isArray(turns?.turns)||turns.turns.length!==10)fail('acceptance-inventory-final-input-invalid');
    const wrangler=resolve(root,'node_modules/.bin/wrangler'),manifests=[],actors=[],verified=new Map();
    for(const turn of turns.turns){
      const bytes=readR2(root,runner,wrangler,turn.checkpoint.objectKey,resolve(directory,`manifest-${turn.index}.json`),MAX_MANIFEST_BYTES,'acceptance-inventory-r2-manifest-read-failed'),saved=manifest(bytes,turn,readiness.scope,auth.sessionId),ids=acceptanceActorIds(readiness.scope,turn.turnId,saved.identity.dispatchId);
      const parts=[];for(const [offset,item] of [saved.files,saved.piSession].entries()){if(!verified.has(item.objectKey))verified.set(item.objectKey,verifyBlob(root,runner,wrangler,item,resolve(directory,`blob-${turn.index}-${offset}`)));parts.push(verified.get(item.objectKey));}
      manifests.push({turnId:turn.turnId,revisionId:turn.revisionId,objectKey:turn.checkpoint.objectKey,identity:saved.identity,files:parts[0],piSession:parts[1]});actors.push({turnId:turn.turnId,className:'TrustedPiSandbox',actor:ids.trustedPi},{turnId:turn.turnId,className:'ProjectToolSandbox',actor:ids.project});
    }
    if(new Set(actors.map(item=>item.actor)).size!==20)fail('acceptance-inventory-actor-identity-collision');
    const expected={TrustedPiSandbox:new Set(actors.filter(item=>item.className==='TrustedPiSandbox').map(item=>item.actor)),ProjectToolSandbox:new Set(actors.filter(item=>item.className==='ProjectToolSandbox').map(item=>item.actor)),ProjectRuntime:new Set(),ServiceSandbox:new Set()},observations=[];let quietSince=null,last=null;
    const end=Date.now()+deadlineMs;
    while(Date.now()<end){
      const snapshot=inventory(root,runner,release,readiness.apps),observedAt=Date.now(),row=summary(snapshot,observedAt);observations.push(row);last=snapshot;
      const exact=Object.keys(expected).every(className=>setEqual(newNames(snapshot,readiness.baselineInstances,className),expected[className]));
      if(exact&&row.nonInactive===0){quietSince??=observedAt;if(observedAt-quietSince>=quietMs)break;}else quietSince=null;
      await sleep(pollMs);
    }
    if(!last||quietSince===null||Date.now()-quietSince<quietMs)fail('acceptance-inventory-quiet-deadline');
    for(const className of Object.keys(expected))if(!setEqual(newNames(last,readiness.baselineInstances,className),expected[className]))fail(`acceptance-inventory-new-actor-set-mismatch:${className}`);
    const exactActors=actors.map(actor=>{const item=(last.instances[actor.className]??[]).find(row=>row.name===actor.actor);if(!item||item.state!=='inactive')fail('acceptance-inventory-exact-actor-not-absent');return {...actor,instanceId:item.id,state:'absent',platformState:item.state};});
    const database=d1(root,runner,wrangler,readiness.scope),workspace=await requestWorkspace(auth),head=workspace.head?.revisionId;
    if(head!==turns.turns[9].revisionId||workspace.activeTurnId!==null||workspace.resourceWait!==null||workspace.releaseHold!==null||workspace.recoveryHold!==null||!sameScope(workspace.scope,readiness.scope))fail('acceptance-inventory-final-workspace-mismatch');
    return {schemaVersion:1,status:'passed',workerSourceSha:release.workerSourceSha,workerVersionId:release.workerVersionId,workspaceHeadRevisionId:head,scope:readiness.scope,d1:database,duplicateProvisionCount:database.duplicateProvisionKeys,r2ReceiptMismatchCount:0,r2Objects:[...verified.values()],manifests,exactActors,applicationObservations:observations,finalApplications:last.apps,finalInstances:last.instances};
  }catch(error){return {schemaVersion:1,status:'blocked',reasonCode:error instanceof Error?error.message:'acceptance-inventory-final-failed'};}
  finally{rmSync(directory,{recursive:true,force:true});}
}
