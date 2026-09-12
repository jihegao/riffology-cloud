import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {STAGING_CHECKPOINT_BUCKET,STAGING_CONFIG,STAGING_DATABASE,WORKER_VERSION_METADATA_BINDING} from './vertical-staging-preflight.mjs';
import {workspaceArchiveContents} from '../../services/turn-runtime/workspace-file-index.ts';

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const TOOL_CALL_ID=/^[A-Za-z0-9_-]{1,128}(?:\|[A-Za-z0-9_-]{1,128})?$/;
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
function checkpoint(value,code='acceptance-inventory-workspace-checkpoint-invalid'){
  if(value===null)return null;exact(value,['revisionId','objectKey','filesSha256','sessionSha256','committedAt'],code);
  if(!SHA.test(value.revisionId)||typeof value.objectKey!=='string'||value.objectKey.length<1||!SHA.test(value.filesSha256)||!SHA.test(value.sessionSha256)||!Number.isSafeInteger(value.committedAt)||value.committedAt<1)fail(code);return {...value};
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
function deployedVersion(value,release){const bindings=value?.resources?.bindings??[],gate=release.turnsEnabled?'true':'false';if(value?.id!==release.workerVersionId||value?.annotations?.['workers/tag']!==`source-${release.workerSourceSha}`||!bindings.some(item=>item?.type==='version_metadata'&&item?.name===WORKER_VERSION_METADATA_BINDING)||!bindings.some(item=>item?.type==='plain_text'&&item?.name==='M2_TURNS_ENABLED'&&item?.text===gate))fail('acceptance-inventory-active-worker-invalid');}
function publicWorkspace(value,auth){
  const required=['schemaVersion','scope','activeTurnId','resourceWait','releaseHold','recoveryHold','sessions','turns'];
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==3||required.some(key=>!Object.hasOwn(value,key))||!value.sessions||typeof value.sessions!=='object'||Array.isArray(value.sessions)||!Object.hasOwn(value.sessions,auth.sessionId)||!value.turns||typeof value.turns!=='object'||Array.isArray(value.turns))fail('acceptance-inventory-workspace-snapshot-invalid');
  const session=value.sessions[auth.sessionId];if(!session||typeof session!=='object'||Array.isArray(session)||!Object.hasOwn(session,'head'))fail('acceptance-inventory-workspace-snapshot-invalid');
  return {scope:scope(value.scope,auth.workspaceId),sessionHead:checkpoint(session.head),turns:value.turns,activeTurnId:value.activeTurnId,resourceWait:value.resourceWait,releaseHold:value.releaseHold,recoveryHold:value.recoveryHold};
}
function publicFiles(value,workspace){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||!Object.hasOwn(value,'revision')||!Array.isArray(value.files))fail('acceptance-inventory-files-snapshot-invalid');
  if(value.revision===null)return null;exact(value.revision,['revisionId','filesSha256','committedAt'],'acceptance-inventory-files-snapshot-invalid');
  if(!SHA.test(value.revision.revisionId)||!SHA.test(value.revision.filesSha256)||!Number.isSafeInteger(value.revision.committedAt)||value.revision.committedAt<1)fail('acceptance-inventory-files-snapshot-invalid');
  const matches=Object.values(workspace.turns).filter(turn=>turn&&typeof turn==='object'&&Object.hasOwn(turn,'checkpoint')&&turn.checkpoint?.revisionId===value.revision.revisionId).map(turn=>checkpoint(turn.checkpoint));
  if(matches.length!==1||matches[0].filesSha256!==value.revision.filesSha256||matches[0].committedAt!==value.revision.committedAt)fail('acceptance-inventory-files-head-unresolved');return matches[0];
}
async function requestWorkspace(auth){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
  try{const response=await fetch(`${auth.origin}/api/workspaces/${auth.workspaceId}`,{headers:{accept:'application/json','cache-control':'no-cache',cookie:auth.cookie,origin:auth.origin},redirect:'error',signal:controller.signal});if(!response.ok)fail(`acceptance-inventory-workspace-http-${response.status}`);return publicWorkspace(await response.json(),auth);}finally{clearTimeout(timer);}
}
async function requestFiles(auth){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
  try{const response=await fetch(`${auth.origin}/api/workspaces/${auth.workspaceId}/files`,{headers:{accept:'application/json','cache-control':'no-cache',cookie:auth.cookie,origin:auth.origin},redirect:'error',signal:controller.signal});if(!response.ok)fail(`acceptance-inventory-files-http-${response.status}`);return response.json();}finally{clearTimeout(timer);}
}
async function requestHeads(auth){const workspace=await requestWorkspace(auth),files=await requestFiles(auth);return {workspace,workspaceHead:publicFiles(files,workspace),sessionHead:workspace.sessionHead};}

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
  deployedVersion(runJson(runner,wrangler,['versions','view',release.workerVersionId,'--json',...cloud],'acceptance-inventory-version-query-failed'),release);
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
    const activeRelease={workerSourceSha:release.workerSourceSha,workerVersionId:release.workerVersionId,turnsEnabled:true},{workspace,workspaceHead,sessionHead}=await requestHeads(auth),snapshot=inventory(root,runner,activeRelease),observedAt=Date.now(),application=summary(snapshot,observedAt);
    if(workspace.activeTurnId!==null||workspace.resourceWait!==null||workspace.releaseHold!==null||workspace.recoveryHold!==null)fail('acceptance-inventory-workspace-not-quiescent');
    if(application.nonInactive!==0)fail('acceptance-inventory-preflight-not-quiescent');
    return {schemaVersion:1,status:'passed',workerSourceSha:release.workerSourceSha,workerVersionId:release.workerVersionId,scope:workspace.scope,sessionId:auth.sessionId,baselineWorkspace:{workspaceHead,sessionHead,activeTurnId:null,resourceWait:null,releaseHold:null,recoveryHold:null},apps:snapshot.apps,baselineInstances:Object.fromEntries(snapshot.apps.map(app=>[app.className,snapshot.instances[app.className].map(item=>item.name).sort()])),applicationObservation:application};
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
  if(!value.base||typeof value.base!=='object'||Array.isArray(value.base)||!Object.hasOwn(value.base,'workspace')||!Object.hasOwn(value.base,'session'))fail('acceptance-inventory-manifest-invalid');
  return {identity,base:{workspace:checkpoint(value.base.workspace,'acceptance-inventory-manifest-invalid'),session:checkpoint(value.base.session,'acceptance-inventory-manifest-invalid')},files,piSession,committedAt:value.committedAt};
}
async function readR2(root,runner,wrangler,key,path,max,code,{attempts=3,retryDelayMs=250}={}){
  if(!Number.isSafeInteger(attempts)||attempts<1||attempts>5||!Number.isSafeInteger(retryDelayMs)||retryDelayMs<0||retryDelayMs>5_000)fail('acceptance-inventory-r2-retry-policy-invalid');
  let result=null,downloadPath=null;
  for(let attempt=1;attempt<=attempts;attempt++){
    const candidate=`${path}.attempt-${attempt}`;
    result=runner(wrangler,['r2','object','get',`${STAGING_CHECKPOINT_BUCKET}/${key}`,'--file',candidate,'--remote','--config',resolve(root,STAGING_CONFIG)],{encoding:'utf8',timeout:120_000,maxBuffer:8*1024*1024});
    if(result?.status===0){downloadPath=candidate;break;}
    rmSync(candidate,{force:true});
    if(attempt<attempts)await sleep(retryDelayMs*Math.min(2**(attempt-1),4));
  }
  if(result?.status!==0||downloadPath===null)fail(code);const size=statSync(downloadPath).size;if(size<1||size>max)fail(code);return readFileSync(downloadPath);
}
async function verifyBlob(root,runner,wrangler,item,path,options){const bytes=await readR2(root,runner,wrangler,item.objectKey,path,item.size,'acceptance-inventory-r2-blob-read-failed',options);if(bytes.byteLength!==item.size||hash(bytes)!==item.sha256)fail('acceptance-inventory-r2-blob-mismatch');return {receipt:{objectKey:item.objectKey,sha256:item.sha256,size:item.size},bytes};}
function userText(message){if(message?.role!=='user')return null;if(typeof message.content==='string')return message.content;if(Array.isArray(message.content)&&message.content.every(item=>item?.type==='text'&&typeof item.text==='string'))return message.content.map(item=>item.text).join('');return null;}
export function verifyAcceptancePiSession(bytes,turn,expectedScope,sessionId,toolEvents){let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('acceptance-inventory-pi-session-invalid');}if(!value||value.format!=='riffology-pi-session-v1'||value.scope?.tenantId!==expectedScope.tenantId||value.scope?.projectId!==expectedScope.projectId||value.scope?.sessionId!==sessionId||!Array.isArray(value.entries)||value.entries.length>100000||typeof value.leafId!=='string')fail('acceptance-inventory-pi-session-invalid');const entries=new Map();for(const entry of value.entries){if(!entry||typeof entry!=='object'||!ID.test(entry.id??'')||(entry.parentId!==null&&!ID.test(entry.parentId??''))||entries.has(entry.id))fail('acceptance-inventory-pi-session-invalid');entries.set(entry.id,entry);}const chain=[],seen=new Set();for(let id=value.leafId;id!==null;){if(seen.has(id))fail('acceptance-inventory-pi-session-invalid');seen.add(id);const entry=entries.get(id);if(!entry)fail('acceptance-inventory-pi-session-invalid');chain.push(entry);id=entry.parentId;}chain.reverse();const starts=chain.map((entry,index)=>entry.type==='message'&&hash(userText(entry.message)??'')===turn.messageSha256?index:-1).filter(index=>index>=0);if(starts.length!==1)fail('acceptance-inventory-pi-session-turn-missing');const messages=chain.slice(starts[0]+1).filter(entry=>entry.type==='message').map(entry=>entry.message),calls=[],results=[];for(const [position,message] of messages.entries()){if(message?.role==='assistant'){if(!Array.isArray(message.content))fail('acceptance-inventory-pi-session-invalid');for(const item of message.content)if(item?.type==='toolCall')calls.push({id:item.id,name:item.name,args:item.arguments,position});}else if(message?.role==='toolResult')results.push({id:message.toolCallId,name:message.toolName,isError:message.isError,position});}const allowed=new Set(['project_write','project_read','project_list','project_search','project_read_page']);if(calls.some(call=>!TOOL_CALL_ID.test(call.id??'')||!allowed.has(call.name))||results.some(result=>!TOOL_CALL_ID.test(result.id??'')||!allowed.has(result.name)||typeof result.isError!=='boolean')||new Set(calls.map(call=>call.id)).size!==calls.length||new Set(results.map(result=>result.id)).size!==results.length)fail('acceptance-inventory-pi-session-tool-invalid');const writes=calls.filter(call=>call.name==='project_write'),reads=calls.filter(call=>call.name==='project_read'),writeArgs=writes[0]?.args,readArgs=reads[0]?.args;if(writes.length!==1||reads.length!==1||!writeArgs||typeof writeArgs!=='object'||Array.isArray(writeArgs)||Object.keys(writeArgs).length!==2||writeArgs.path!==turn.filePath||writeArgs.content!==turn.nonce||!readArgs||typeof readArgs!=='object'||Array.isArray(readArgs)||Object.keys(readArgs).length!==1||readArgs.path!==turn.filePath||writes[0].position>=reads[0].position)fail('acceptance-inventory-pi-session-tool-binding-mismatch');if(results.length!==calls.length)fail('acceptance-inventory-pi-session-event-mismatch');for(const call of calls){const matches=results.filter(result=>result.id===call.id&&result.name===call.name&&result.position>call.position);if(matches.length!==1)fail('acceptance-inventory-pi-session-event-mismatch');}const writeResult=results.find(result=>result.id===writes[0].id&&result.name===writes[0].name);if(!writeResult||writeResult.position>=reads[0].position)fail('acceptance-inventory-pi-session-tool-binding-mismatch');const publicResults=results.map(({id,name,isError})=>({id,name,isError})),expected=toolEvents.map(event=>({id:event.toolCallId,name:event.name,isError:event.isError}));if(expected.some(event=>!TOOL_CALL_ID.test(event.id??''))||JSON.stringify(publicResults)!==JSON.stringify(expected)||results.some(result=>result.isError))fail('acceptance-inventory-pi-session-event-mismatch');return {messageSha256:turn.messageSha256,write:{toolCallId:writes[0].id,argumentsSha256:hash(JSON.stringify(writes[0].args))},read:{toolCallId:reads[0].id,argumentsSha256:hash(JSON.stringify(reads[0].args))},completedTools:results.length};}
function d1(root,runner,wrangler,expectedScope){
  const s=expectedScope,query=`SELECT (SELECT count(*) FROM catalog_workspaces WHERE id='${s.workspaceId}' AND project_id='${s.projectId}' AND tenant_id='${s.tenantId}' AND generation=${s.workspaceGeneration} AND status='ready') AS workspace_rows,(SELECT count(*) FROM catalog_outbox WHERE workspace_id='${s.workspaceId}' AND project_id='${s.projectId}' AND tenant_id='${s.tenantId}' AND generation=${s.workspaceGeneration} AND kind='workspace.provision' AND state='completed') AS provision_rows,(SELECT count(*) FROM catalog_provisioning_receipts r JOIN catalog_outbox o ON o.id=r.outbox_id WHERE o.workspace_id='${s.workspaceId}' AND o.project_id='${s.projectId}' AND o.tenant_id='${s.tenantId}' AND o.generation=${s.workspaceGeneration} AND o.kind='workspace.provision') AS receipt_rows,(SELECT count(*) FROM (SELECT r.outbox_id,r.sequence,count(*) AS copies FROM catalog_provisioning_receipts r JOIN catalog_outbox o ON o.id=r.outbox_id WHERE o.workspace_id='${s.workspaceId}' AND o.project_id='${s.projectId}' AND o.tenant_id='${s.tenantId}' AND o.generation=${s.workspaceGeneration} AND o.kind='workspace.provision' GROUP BY r.outbox_id,r.sequence HAVING count(*)>1)) AS duplicate_provision_keys`;
  const value=runJson(runner,wrangler,['d1','execute',STAGING_DATABASE.name,'--remote','--json','--command',query,'--config',resolve(root,STAGING_CONFIG)],'acceptance-inventory-d1-query-failed'),result=value?.[0];
  if(!Array.isArray(value)||value.length!==1||result?.success!==true||!Array.isArray(result.results)||result.results.length!==1)fail('acceptance-inventory-d1-result-invalid');const row=result.results[0];
  for(const key of ['workspace_rows','provision_rows','receipt_rows','duplicate_provision_keys'])if(!Number.isSafeInteger(row?.[key])||row[key]<0)fail('acceptance-inventory-d1-result-invalid');
  if(row.workspace_rows!==1||row.provision_rows!==1||row.receipt_rows<1||row.duplicate_provision_keys!==0)fail('acceptance-inventory-d1-provision-mismatch');return {workspaceRows:row.workspace_rows,provisionRows:row.provision_rows,receiptRows:row.receipt_rows,duplicateProvisionKeys:row.duplicate_provision_keys};
}

export async function collectStagingFinalInventory({root,release,auth,turns,readiness,runner=spawnSync,quietMs=30_000,pollMs=5_000,deadlineMs=15*60_000,r2Attempts=3,r2RetryDelayMs=250,auditRelease=null}={}){
  const directory=mkdtempSync(resolve(tmpdir(),'riffology-acceptance-inventory-'));
  try{
    if(readiness?.status!=='passed'||readiness.workerSourceSha!==release?.workerSourceSha||readiness.workerVersionId!==release?.workerVersionId||readiness.sessionId!==auth?.sessionId||!readiness.baselineWorkspace||readiness.baselineWorkspace.activeTurnId!==null||readiness.baselineWorkspace.resourceWait!==null||readiness.baselineWorkspace.releaseHold!==null||readiness.baselineWorkspace.recoveryHold!==null||(turns?.finalSnapshot?.scope&&!sameScope(readiness.scope,turns.finalSnapshot.scope))||!Array.isArray(turns?.turns)||turns.turns.length!==10)fail('acceptance-inventory-final-input-invalid');
    const audit=auditRelease??{workerSourceSha:release.workerSourceSha,workerVersionId:release.workerVersionId,turnsEnabled:true};
    if(!audit||audit.workerSourceSha!==release.workerSourceSha||!WORKER_SHA.test(audit.workerSourceSha??'')||!VERSION.test(audit.workerVersionId??'')||typeof audit.turnsEnabled!=='boolean')fail('acceptance-inventory-audit-release-invalid');
    const wrangler=resolve(root,'node_modules/.bin/wrangler'),manifests=[],actors=[],verified=new Map();
    for(const [offset,turn] of turns.turns.entries()){
      const bytes=await readR2(root,runner,wrangler,turn.checkpoint.objectKey,resolve(directory,`manifest-${turn.index}.json`),MAX_MANIFEST_BYTES,'acceptance-inventory-r2-manifest-read-failed',{attempts:r2Attempts,retryDelayMs:r2RetryDelayMs}),saved=manifest(bytes,turn,readiness.scope,auth.sessionId),ids=acceptanceActorIds(readiness.scope,turn.turnId,saved.identity.dispatchId);
      const expectedWorkspace=offset===0?checkpoint(readiness.baselineWorkspace.workspaceHead):checkpoint(turns.turns[offset-1].checkpoint),expectedSession=offset===0?checkpoint(readiness.baselineWorkspace.sessionHead):checkpoint(turns.turns[offset-1].checkpoint);if(!same(saved.base.workspace,expectedWorkspace)||!same(saved.base.session,expectedSession))fail('acceptance-inventory-manifest-lineage-mismatch');
      const parts=[];for(const [offset,item] of [saved.files,saved.piSession].entries()){if(!verified.has(item.objectKey))verified.set(item.objectKey,await verifyBlob(root,runner,wrangler,item,resolve(directory,`blob-${turn.index}-${offset}`),{attempts:r2Attempts,retryDelayMs:r2RetryDelayMs}));parts.push(verified.get(item.objectKey));}const content=workspaceArchiveContents(parts[0].bytes,[{path:turn.filePath,maxBytes:64}]).get(turn.filePath);if(!content||!Buffer.from(content).equals(Buffer.from(turn.nonce)))fail('acceptance-inventory-file-content-mismatch');const toolBinding=verifyAcceptancePiSession(parts[1].bytes,turn,readiness.scope,auth.sessionId,turn.toolEvents);
      manifests.push({turnId:turn.turnId,revisionId:turn.revisionId,objectKey:turn.checkpoint.objectKey,identity:saved.identity,base:saved.base,files:parts[0].receipt,piSession:parts[1].receipt,targetFile:{path:turn.filePath,size:content.byteLength,sha256:hash(content)},toolBinding});actors.push({turnId:turn.turnId,className:'TrustedPiSandbox',actor:ids.trustedPi},{turnId:turn.turnId,className:'ProjectToolSandbox',actor:ids.project});
    }
    if(new Set(actors.map(item=>item.actor)).size!==20)fail('acceptance-inventory-actor-identity-collision');
    const expected={TrustedPiSandbox:new Set(actors.filter(item=>item.className==='TrustedPiSandbox').map(item=>item.actor)),ProjectToolSandbox:new Set(actors.filter(item=>item.className==='ProjectToolSandbox').map(item=>item.actor)),ProjectRuntime:new Set(),ServiceSandbox:new Set()},observations=[];let quietSince=null,last=null;
    const end=Date.now()+deadlineMs;
    while(Date.now()<end){
      const snapshot=inventory(root,runner,audit,readiness.apps),observedAt=Date.now(),row=summary(snapshot,observedAt);observations.push(row);last=snapshot;
      const exact=Object.keys(expected).every(className=>setEqual(newNames(snapshot,readiness.baselineInstances,className),expected[className]));
      if(exact&&row.nonInactive===0){quietSince??=observedAt;if(observedAt-quietSince>=quietMs)break;}else quietSince=null;
      await sleep(pollMs);
    }
    if(!last||quietSince===null||Date.now()-quietSince<quietMs)fail('acceptance-inventory-quiet-deadline');
    for(const className of Object.keys(expected))if(!setEqual(newNames(last,readiness.baselineInstances,className),expected[className]))fail(`acceptance-inventory-new-actor-set-mismatch:${className}`);
    const exactActors=actors.map(actor=>{const item=(last.instances[actor.className]??[]).find(row=>row.name===actor.actor);if(!item||item.state!=='inactive')fail('acceptance-inventory-exact-actor-not-absent');return {...actor,instanceId:item.id,state:'absent',platformState:item.state};});
    const database=d1(root,runner,wrangler,readiness.scope),{workspace,workspaceHead,sessionHead}=await requestHeads(auth),head=workspaceHead?.revisionId;
    if(head!==turns.turns[9].revisionId||sessionHead?.revisionId!==turns.turns[9].revisionId||workspace.activeTurnId!==null||workspace.resourceWait!==null||workspace.releaseHold!==null||workspace.recoveryHold!==null||!sameScope(workspace.scope,readiness.scope))fail('acceptance-inventory-final-workspace-mismatch');
    return {schemaVersion:1,status:'passed',workerSourceSha:release.workerSourceSha,workerVersionId:release.workerVersionId,auditWorkerVersionId:audit.workerVersionId,auditTurnsEnabled:audit.turnsEnabled,workspaceHeadRevisionId:head,scope:readiness.scope,d1:database,duplicateProvisionCount:database.duplicateProvisionKeys,r2ReceiptMismatchCount:0,r2Objects:[...verified.values()].map(value=>value.receipt),manifests,exactActors,applicationObservations:observations,finalApplications:last.apps,finalInstances:last.instances};
  }catch(error){return {schemaVersion:1,status:'blocked',reasonCode:error instanceof Error?error.message:'acceptance-inventory-final-failed'};}
  finally{rmSync(directory,{recursive:true,force:true});}
}
