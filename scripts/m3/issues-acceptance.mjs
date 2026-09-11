#!/usr/bin/env node
import {createHash,randomBytes} from 'node:crypto';
import {lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CONTROL_ORIGIN} from './vertical-staging-preflight.mjs';
import {forwardCloseTurnGate,validatePausedContainerQuiet} from './vertical-staging-release.mjs';
import {validatePlatformProbe} from './trusted-pi-platform-probe.mjs';
export {validatePlatformProbe} from './trusted-pi-platform-probe.mjs';
import {collectStagingFinalInventory,collectStagingInventoryPreflight} from './staging-acceptance-inventory.mjs';

const ID=/^[A-Za-z0-9_-]{1,128}$/;
const TOOL_CALL_ID=/^[A-Za-z0-9_-]{1,128}(?:\|[A-Za-z0-9_-]{1,128})?$/;
const SHA=/^[a-f0-9]{40}$/;
const VERSION=/^[a-f0-9-]{36}$/;
const TERMINAL=new Set(['completed','failed','cancelled','interrupted']);
const ACCEPTANCE_READ_ONLY_TOOLS=new Set(['project_list','project_search','project_read_page']);
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonClone=value=>JSON.parse(JSON.stringify(value));
const fail=code=>{throw Error(code);};

async function privateJson(path,label){
  if(typeof path!=='string'||path.length===0)fail(`${label}-path-required`);const target=resolve(path),info=await lstat(target).catch(()=>null);
  if(!info?.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0)fail(`${label}-must-be-private-regular-file`);
  let value;try{value=JSON.parse(await readFile(target,'utf8'));}catch{fail(`${label}-invalid-json`);}return value;
}

export function validateReleaseResult(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||value.status!=='passed'||value.phase!=='postdeploy'||!VERSION.test(value.workerVersionId??'')||!VERSION.test(value.pausedCandidateVersionId??''))fail('acceptance-release-result-not-passed');
  const pre=value.predeploy?.releaseManifest,post=value.postdeploy?.releaseManifest;
  if(value.predeploy?.status!=='passed'||value.predeploy?.phase!=='release-predeploy'||value.postdeploy?.status!=='passed'||value.postdeploy?.phase!=='release-postdeploy'||value.postdeploy?.workerVersionId!==value.workerVersionId||!pre||!post||!SHA.test(pre.workerSourceSha??'')||JSON.stringify(pre)!==JSON.stringify(post)||pre.workerVersionTag!==`source-${pre.workerSourceSha}`)fail('acceptance-release-identity-mismatch');
  const checks=phase=>Array.isArray(phase?.checks)?phase.checks.map(item=>({name:String(item?.name??''),status:String(item?.status??'')})):[];
  if(!checks(value.predeploy).some(item=>item.name==='predeploy-turn-gate-closed'&&item.status==='passed')||!checks(value.postdeploy).some(item=>item.name==='deployed-worker-version'&&item.status==='passed'))fail('acceptance-release-checks-incomplete');
  const platformProbe=validatePlatformProbe(value.platformProbe);if(platformProbe.workerSourceSha!==pre.workerSourceSha||platformProbe.workerVersionId!==value.pausedCandidateVersionId)fail('acceptance-release-identity-mismatch');
  let quiet;try{quiet=validatePausedContainerQuiet(value.preOpenQuiet,pre.containerImages);}catch{fail('acceptance-release-quiet-proof-invalid');}
  const recheck=value.pausedCandidateRecheck,lastQuietAt=quiet.observations.at(-1).observedAt;
  if(!recheck||recheck.workerVersionId!==value.pausedCandidateVersionId||!Number.isSafeInteger(recheck.observedAt)||recheck.observedAt<lastQuietAt||recheck.check?.status!=='passed'||recheck.check?.name!=='deployed-worker-version')fail('acceptance-release-paused-recheck-invalid');
  return {schemaVersion:1,workerSourceSha:pre.workerSourceSha,workerVersionId:value.workerVersionId,pausedCandidateVersionId:value.pausedCandidateVersionId,pausedCandidateRecheck:jsonClone(recheck),workerVersionTag:pre.workerVersionTag,toolBridgeSha256:pre.toolBridgeSha256,toolProtocolVersion:pre.toolProtocolVersion,toolLedgerSchemaVersion:pre.toolLedgerSchemaVersion,toolLedgerSchemaSha256:pre.toolLedgerSchemaSha256,containerImages:jsonClone(pre.containerImages),platformProbe,preOpenQuiet:jsonClone(quiet),deploymentChecks:{predeploy:checks(value.predeploy),postdeploy:checks(value.postdeploy)}};
}

export function validateAuthInput(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||value.origin!==CONTROL_ORIGIN||!ID.test(value.workspaceId??'')||!ID.test(value.sessionId??'')||typeof value.cookie!=='string'||value.cookie.length<8||value.cookie.length>8192||/[\r\n]/.test(value.cookie))fail('acceptance-auth-input-invalid');
  return {origin:value.origin,workspaceId:value.workspaceId,sessionId:value.sessionId,cookie:value.cookie};
}

export function unavailableProviderFreeProbe(){return {schemaVersion:1,status:'blocked',reasonCode:'provider-free-exact-actor-probe-unavailable',conclusion:'No product-only operator path exposes exact TrustedPi actor lifecycle. Application-level container counts and a single stopped or inactive record are insufficient release proof.'};}

function turnSummary(snapshot,turnId,priorObservedAt=null){const turn=snapshot?.turns?.[turnId],wall=Date.now(),observedAt=Number.isSafeInteger(priorObservedAt)&&wall<=priorObservedAt?priorObservedAt+1:wall;return {observedAt,turnStatus:turn?.status??null,activeTurnId:snapshot?.activeTurnId??null,resourceWait:snapshot?.resourceWait??null,releaseHold:snapshot?.releaseHold??null,recoveryHold:snapshot?.recoveryHold??null};}
export async function requestJson(url,{cookie,method='GET',body=null,key=null,timeoutMs=20_000,attempts=3,retryDelayMs=1_000,shouldAbort=()=>false}={}){
  if(!Number.isSafeInteger(attempts)||attempts<1||attempts>5||!Number.isSafeInteger(retryDelayMs)||retryDelayMs<0||retryDelayMs>10_000)fail('acceptance-request-retry-invalid');
  const encodedBody=body===null?undefined:JSON.stringify(body),headers={'accept':'application/json','cache-control':'no-cache','cookie':cookie,'origin':new URL(url).origin};if(body!==null)headers['content-type']='application/json';if(key!==null)headers['idempotency-key']=key;
  const retrySafe=method==='GET'||key!==null;
  for(let attempt=1;attempt<=attempts;attempt++){
    if(shouldAbort())fail('acceptance-request-interrupted');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),abortPoll=setInterval(()=>{if(shouldAbort())controller.abort();},50);
    try{
      const response=await fetch(url,{method,headers,body:encodedBody,signal:controller.signal,redirect:'error'}),retryableStatus=response.status===408||response.status===425||response.status===429||response.status>=500;
      if(!response.ok){if(!retrySafe||!retryableStatus||attempt===attempts)fail(`acceptance-http-${response.status}`);}
      else{try{return await response.json();}catch{if(!retrySafe||attempt===attempts)fail('acceptance-response-invalid');}}
    }catch(error){
      const code=error instanceof Error?error.message:'';
      if(shouldAbort())fail('acceptance-request-interrupted');if(code.startsWith('acceptance-http-')||code==='acceptance-response-invalid'||!retrySafe)throw error;
      if(attempt===attempts)fail('acceptance-transport-unavailable');
    }finally{clearTimeout(timer);clearInterval(abortPoll);}
    await sleep(retryDelayMs*Math.min(2**(attempt-1),4));
  }
  fail('acceptance-transport-unavailable');
}
async function allEvents(auth){
  const events=[];let after=0;
  for(let page=0;page<32;page++){
    const value=await requestJson(`${auth.origin}/api/workspaces/${auth.workspaceId}/events?after_sequence=${after}&limit=200`,{cookie:auth.cookie}),keys=['events','nextSequence','hasMore','oldestSequence','snapshotRequired'];
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||!Array.isArray(value.events)||typeof value.hasMore!=='boolean'||typeof value.snapshotRequired!=='boolean'||!Number.isSafeInteger(value.nextSequence)||value.nextSequence<after||!Number.isSafeInteger(value.oldestSequence)||value.oldestSequence<1)fail('acceptance-event-page-invalid');
    let last=after;for(const event of value.events){const eventKeys=['sequence','eventId','workspaceId','turnId','runtimeGeneration','type','payload','at'];if(!event||typeof event!=='object'||Array.isArray(event)||Object.getPrototypeOf(event)!==Object.prototype||Object.keys(event).length!==eventKeys.length||eventKeys.some(key=>!Object.hasOwn(event,key))||!Number.isSafeInteger(event.sequence)||event.sequence!==last+1||!ID.test(event.eventId??'')||event.workspaceId!==auth.workspaceId||!ID.test(event.turnId??'')||!Number.isSafeInteger(event.runtimeGeneration)||event.runtimeGeneration<1||typeof event.type!=='string'||!event.payload||typeof event.payload!=='object'||Array.isArray(event.payload)||!Number.isSafeInteger(event.at)||event.at<1)fail('acceptance-event-page-invalid');last=event.sequence;}
    if(value.snapshotRequired)fail('acceptance-event-window-retired');
    if(after<value.oldestSequence-1||value.nextSequence!==last||(value.hasMore&&value.events.length===0))fail('acceptance-event-cursor-invalid');events.push(...value.events);
    if(!value.hasMore)return events;after=value.nextSequence;
  }fail('acceptance-event-pages-exceeded');
}
async function workspace(auth,options={}){return requestJson(`${auth.origin}/api/workspaces/${auth.workspaceId}`,{cookie:auth.cookie,...options});}
async function waitTerminal(auth,turnId,{pollMs=5_000,deadlineMs=15*60_000,initialSummary=null,onTransition=()=>{},shouldAbort=()=>false}={}){
  const end=Date.now()+deadlineMs,transitions=initialSummary===null?[]:[jsonClone(initialSummary)];let prior=initialSummary===null?'':JSON.stringify({...initialSummary,observedAt:0}),priorObservedAt=initialSummary?.observedAt??null;
  while(Date.now()<end){if(shouldAbort())fail('acceptance-turn-wait-interrupted');const snapshot=await workspace(auth,{shouldAbort}),summary=turnSummary(snapshot,turnId,priorObservedAt),encoded=JSON.stringify({...summary,observedAt:0});if(encoded!==prior){prior=encoded;priorObservedAt=summary.observedAt;transitions.push(summary);onTransition(summary);}const turn=snapshot?.turns?.[turnId];if(TERMINAL.has(turn?.status))return {turn,snapshot,transitions};await sleep(pollMs);}fail('acceptance-turn-deadline');
}

export async function driveTenTurns(auth,{runToken=`r${randomBytes(8).toString('hex')}`,pollMs=5_000,deadlineMs=15*60_000,recordProgress=async()=>{},onOutstanding=async()=>{},shouldAbort=()=>false}={}){
  const turns=[];let previousTerminalSnapshot=null;
  for(let index=1;index<=10;index++){
    if(shouldAbort())fail('acceptance-turn-wait-interrupted');
    const suffix=String(index).padStart(2,'0'),nonce=randomBytes(16).toString('hex'),filePath=`acceptance-${runToken}-turn-${suffix}.txt`,key=`accept-${runToken}-${suffix}`;
    const message=`Acceptance contract: make exactly one successful project_write call to create ${filePath} with the exact content ${nonce}. After it succeeds, make exactly one successful project_read call for that same file and verify the exact content. Read-only inspection tools are allowed, but do not make any other mutation. Your final response must include ${nonce}. If any tool call fails, report the failure and stop without retrying.`;
    await onOutstanding({index,turnId:null,requestKey:key,message,submitStarted:false});
    if(shouldAbort()){await onOutstanding(null);fail('acceptance-turn-wait-interrupted');}
    await onOutstanding({index,turnId:null,requestKey:key,message,submitStarted:true});
    if(shouldAbort()){await onOutstanding(null);fail('acceptance-turn-wait-interrupted');}
    const submitted=await requestJson(`${auth.origin}/api/workspaces/${auth.workspaceId}/sessions/${auth.sessionId}/turns`,{cookie:auth.cookie,method:'POST',key,body:{message},shouldAbort}),turnId=submitted?.turn?.id;
    if(!ID.test(turnId??''))fail('acceptance-turn-submit-invalid');
    await onOutstanding({index,turnId,requestKey:key,message,submitStarted:true});
    await recordProgress(`turn-${suffix}-submitted.json`,{schemaVersion:1,index,turnId,filePath,nonce,messageSha256:digest(message),submittedStatus:submitted.turn.status});
    const initial=await workspace(auth,{shouldAbort}),initialSummary=turnSummary(initial,turnId),observedTransitions=[initialSummary];let terminal;
    try{terminal=await waitTerminal(auth,turnId,{pollMs,deadlineMs,initialSummary,onTransition:value=>observedTransitions.push(value),shouldAbort});}catch(error){let latest=null;if(!shouldAbort())try{latest=turnSummary(await workspace(auth),turnId,observedTransitions.at(-1)?.observedAt??initialSummary.observedAt);}catch{}await recordProgress(`turn-${suffix}-wait-error.json`,{schemaVersion:1,index,turnId,stage:'wait-terminal',reasonCode:error instanceof Error?error.message:'acceptance-turn-wait-failed',latest,transitions:observedTransitions});throw error;}const turn=terminal.turn;
    await onOutstanding(null);
    await recordProgress(`turn-${suffix}-terminal.json`,{schemaVersion:1,index,turnId,filePath,submittedStatus:submitted.turn.status,terminal:{status:turn?.status??null,executionOutcome:turn?.executionOutcome??null,persistenceOutcome:turn?.persistenceOutcome??null,errorCode:turn?.errorCode??null,checkpoint:turn?.checkpoint??null},transitions:terminal.transitions});
    let events;try{events=await allEvents(auth);}catch(error){await recordProgress(`turn-${suffix}-events-error.json`,{schemaVersion:1,index,turnId,stage:'events',reasonCode:error instanceof Error?error.message:'acceptance-events-failed'});throw error;}const toolEvents=events.filter(event=>event.turnId===turnId&&event.type==='tool.completed').map(event=>({sequence:event.sequence,eventId:event.eventId,toolCallId:event.payload?.toolCallId,name:event.payload?.name,isError:event.payload?.isError})),assistantNonceConfirmation=events.some(event=>event.turnId===turnId&&event.type==='assistant.message'&&JSON.stringify(event.payload).includes(nonce));
    await recordProgress(`turn-${suffix}-events.json`,{schemaVersion:1,index,turnId,assistantNonceConfirmation,toolEvents,events:events.filter(event=>event.turnId===turnId&&['assistant.message','tool.started','tool.completed','provider.status'].includes(event.type)).map(event=>({sequence:event.sequence,eventId:event.eventId,type:event.type,...(event.type.startsWith('tool.')?{name:event.payload?.name??null,isError:event.payload?.isError??null}:{}),...(event.type==='assistant.message'?{stopReason:event.payload?.stopReason??null,containsNonce:JSON.stringify(event.payload).includes(nonce)}:{}),...(event.type==='provider.status'?{state:event.payload?.state??null,status:event.payload?.status??null}:{})}))});
    if(turn.status!=='completed'||turn.executionOutcome!=='completed'||turn.persistenceOutcome!=='saved'||!turn.checkpoint?.revisionId)fail('acceptance-turn-not-saved-completed');
    const targetEvents=toolEvents.filter(event=>event.name==='project_write'||event.name==='project_read'),writes=targetEvents.filter(event=>event.name==='project_write'&&event.isError===false),reads=targetEvents.filter(event=>event.name==='project_read'&&event.isError===false);
    if(toolEvents.some(event=>!TOOL_CALL_ID.test(event.toolCallId??'')||event.isError!==false||event.name!=='project_write'&&event.name!=='project_read'&&!ACCEPTANCE_READ_ONLY_TOOLS.has(event.name))||targetEvents.length!==2||writes.length!==1||reads.length!==1||writes[0].sequence>=reads[0].sequence)fail('acceptance-required-tool-event-missing');
    if(!assistantNonceConfirmation)fail('acceptance-assistant-nonce-missing');
    const files=await requestJson(`${auth.origin}/api/workspaces/${auth.workspaceId}/files`,{cookie:auth.cookie});
    await recordProgress(`turn-${suffix}-files.json`,{schemaVersion:1,index,turnId,filesRevision:files?.revision??null,file:files?.files?.find(entry=>entry.path===filePath)??null});
    const diff=await requestJson(`${auth.origin}/api/workspaces/${auth.workspaceId}/diff`,{cookie:auth.cookie});
    await recordProgress(`turn-${suffix}-material.json`,{schemaVersion:1,index,turnId,filesRevision:files?.revision??null,file:files?.files?.find(entry=>entry.path===filePath)??null,diffRevision:diff?.revision??null,diffSummary:diff?.summary??null,diffChanges:diff?.changes??null});
    const expectedChange=diff?.changes?.[0];if(files?.revision?.revisionId!==turn.checkpoint.revisionId||!files.files?.some(entry=>entry.path===filePath&&entry.type==='file')||diff?.revision?.revisionId!==turn.checkpoint.revisionId||diff?.summary?.added!==1||diff.summary.modified!==0||diff.summary.deleted!==0||diff.changes.length!==1||expectedChange?.path!==filePath||expectedChange?.change!=='added'||expectedChange?.type!=='file'||expectedChange?.size!==Buffer.byteLength(nonce))fail('acceptance-files-diff-refresh-mismatch');
    const queuedBehindRelease=index===1?null:previousTerminalSnapshot?.releaseHold!==null&&submitted.turn.status==='queued'&&initial?.turns?.[turnId]?.status==='queued';
    turns.push({index,turnId,filePath,nonce,messageSha256:digest(message),assistantNonceConfirmation,revisionId:turn.checkpoint.revisionId,checkpoint:turn.checkpoint,toolEvents,submittedStatus:submitted.turn.status,queuedBehindRelease,transitions:terminal.transitions,filesRefresh:{revision:files.revision,file:{...files.files.find(entry=>entry.path===filePath)}},diffRefresh:{revision:diff.revision,summary:diff.summary,changes:diff.changes.map(value=>({...value}))}});
    previousTerminalSnapshot=terminal.snapshot;
  }
  const end=Date.now()+15*60_000;let finalSnapshot;
  do{if(shouldAbort())fail('acceptance-turn-wait-interrupted');finalSnapshot=await workspace(auth,{shouldAbort});if(finalSnapshot.activeTurnId===null&&finalSnapshot.resourceWait===null&&finalSnapshot.releaseHold===null&&finalSnapshot.recoveryHold===null)break;await sleep(pollMs);}while(Date.now()<end);
  return {schemaVersion:1,status:'passed',runToken,turns,finalSnapshot};
}

export function validateTenTurnEvidence(value){
  if(!value||value.schemaVersion!==1||value.status!=='passed'||!Array.isArray(value.turns)||value.turns.length!==10)fail('acceptance-ten-turn-evidence-invalid');
  const turnIds=new Set(),revisions=new Set(),objectKeys=new Set(),paths=new Set(),nonces=new Set();
  for(const [offset,turn] of value.turns.entries()){
    const checkpoint=turn.checkpoint,toolEvents=turn.toolEvents,targetEvents=toolEvents?.filter(event=>event.name==='project_write'||event.name==='project_read')??[],writes=targetEvents.filter(event=>event.name==='project_write'&&event.isError===false),reads=targetEvents.filter(event=>event.name==='project_read'&&event.isError===false);
    if(turn.index!==offset+1||!ID.test(turn.turnId??'')||turnIds.has(turn.turnId)||!/^[a-f0-9]{64}$/.test(turn.revisionId??'')||revisions.has(turn.revisionId)||checkpoint?.revisionId!==turn.revisionId||typeof checkpoint?.objectKey!=='string'||objectKeys.has(checkpoint.objectKey)||!/^[a-f0-9]{64}$/.test(checkpoint?.filesSha256??'')||!/^[a-f0-9]{64}$/.test(checkpoint?.sessionSha256??'')||!Number.isSafeInteger(checkpoint?.committedAt)||checkpoint.committedAt<1||typeof turn.filePath!=='string'||paths.has(turn.filePath)||!/^[a-f0-9]{32}$/.test(turn.nonce??'')||nonces.has(turn.nonce)||!/^[a-f0-9]{64}$/.test(turn.messageSha256??''))fail('acceptance-ten-turn-identity-invalid');
    const change=turn.diffRefresh?.changes?.[0];if(turn.assistantNonceConfirmation!==true||toolEvents?.some(event=>!TOOL_CALL_ID.test(event.toolCallId??'')||event.isError!==false||event.name!=='project_write'&&event.name!=='project_read'&&!ACCEPTANCE_READ_ONLY_TOOLS.has(event.name))||targetEvents.length!==2||writes.length!==1||reads.length!==1||!Number.isSafeInteger(writes[0].sequence)||!Number.isSafeInteger(reads[0].sequence)||writes[0].sequence>=reads[0].sequence||turn.filesRefresh?.revision?.revisionId!==turn.revisionId||turn.filesRefresh?.revision?.filesSha256!==checkpoint.filesSha256||turn.filesRefresh?.file?.path!==turn.filePath||turn.diffRefresh?.revision?.revisionId!==turn.revisionId||turn.diffRefresh?.revision?.filesSha256!==checkpoint.filesSha256||turn.diffRefresh?.summary?.added!==1||turn.diffRefresh.summary.modified!==0||turn.diffRefresh.summary.deleted!==0||turn.diffRefresh.changes.length!==1||change?.path!==turn.filePath||change?.change!=='added'||change?.type!=='file'||change?.size!==Buffer.byteLength(turn.nonce))fail('acceptance-ten-turn-material-invalid');
    const transitions=turn.transitions;if(!Array.isArray(transitions)||transitions.length<2||transitions.some((item,index)=>!Number.isSafeInteger(item?.observedAt)||item.observedAt<1||index>0&&item.observedAt<=transitions[index-1].observedAt)||transitions.slice(0,-1).some(item=>TERMINAL.has(item?.turnStatus))||transitions.at(-1)?.turnStatus!=='completed'||transitions.at(-1)?.activeTurnId!==null)fail('acceptance-turn-transition-invalid');
    if(offset>0){const queued=transitions.findIndex(item=>item?.turnStatus==='queued'&&item?.releaseHold!==null),running=transitions.findIndex(item=>item?.turnStatus==='running');if(turn.queuedBehindRelease!==true||queued<0||running<0||queued>=running)fail('acceptance-release-queue-transition-missing');}turnIds.add(turn.turnId);revisions.add(turn.revisionId);objectKeys.add(checkpoint.objectKey);paths.add(turn.filePath);nonces.add(turn.nonce);
  }
  const final=value.finalSnapshot;if(final?.activeTurnId!==null||final?.resourceWait!==null||final?.releaseHold!==null||final?.recoveryHold!==null||final?.sessions?.[value.sessionId]?.head?.revisionId!==value.turns[9].revisionId)fail('acceptance-final-workspace-not-quiescent');
  return jsonClone(value);
}

function cleanupWorkspaceSnapshot(value,sessionId){
  const object=input=>input&&typeof input==='object'&&!Array.isArray(input)&&Object.getPrototypeOf(input)===Object.prototype,required=['activeTurnId','resourceWait','releaseHold','recoveryHold','sessions','turns'];if(!object(value)||value.schemaVersion!==3||required.some(key=>!Object.hasOwn(value,key))||value.activeTurnId!==null&&!ID.test(value.activeTurnId??'')||!object(value.sessions)||!object(value.turns)||!Object.hasOwn(value.sessions,sessionId)||!object(value.sessions[sessionId])||['resourceWait','releaseHold','recoveryHold'].some(key=>value[key]!==null&&!object(value[key])))fail('acceptance-cleanup-workspace-snapshot-invalid');
  for(const [id,turn] of Object.entries(value.turns))if(!ID.test(id)||!object(turn)||turn.id!==id||!ID.test(turn.sessionId??'')||typeof turn.message!=='string'||!Object.hasOwn(turn,'startedAt')||!Object.hasOwn(turn,'runtimeGeneration')||!Object.hasOwn(turn,'checkpoint'))fail('acceptance-cleanup-workspace-snapshot-invalid');return value;
}

export async function cancelOutstandingTurn(auth,outstanding,{pollMs=5_000,deadlineMs=15*60_000,absenceQuietMs=30_000}={}){
  if(!Number.isSafeInteger(absenceQuietMs)||absenceQuietMs<0||absenceQuietMs>60_000)return {schemaVersion:1,status:'blocked',reasonCode:'acceptance-outstanding-turn-cleanup-policy-invalid'};
  let turnId=outstanding?.turnId,recoveredFromSnapshot=false,absenceSince=null,last=null;const end=Date.now()+deadlineMs,state=snapshot=>({activeTurnId:snapshot?.activeTurnId??null,resourceWait:snapshot?.resourceWait??null,releaseHold:snapshot?.releaseHold??null,recoveryHold:snapshot?.recoveryHold??null}),quiescent=value=>Object.values(value).every(item=>item===null);
  if(turnId===null){if(outstanding?.submitStarted!==true||typeof outstanding?.message!=='string'||outstanding.message.length===0)return {schemaVersion:1,status:'blocked',reasonCode:'acceptance-outstanding-turn-identity-invalid'};while(Date.now()<end){try{const snapshot=cleanupWorkspaceSnapshot(await workspace(auth),auth.sessionId),workspaceState=state(snapshot),matches=Object.values(snapshot.turns).filter(turn=>turn.sessionId===auth.sessionId&&turn.message===outstanding.message);last={workspace:workspaceState,matchingTurns:matches.length};if(matches.length>1)return {schemaVersion:1,status:'blocked',reasonCode:'acceptance-outstanding-turn-recovery-conflict',last};if(matches.length===1){turnId=matches[0].id;recoveredFromSnapshot=true;break;}if(quiescent(workspaceState)){absenceSince??=Date.now();if(Date.now()-absenceSince>=absenceQuietMs)return {schemaVersion:1,status:'passed',turnId:null,recoveredFromSnapshot:false,submissionAbsent:true,workspace:workspaceState};}else absenceSince=null;}catch{absenceSince=null;}await sleep(pollMs);}if(turnId===null)return {schemaVersion:1,status:'blocked',reasonCode:'acceptance-outstanding-turn-recovery-unconfirmed',last};}
  if(!ID.test(turnId??''))return {schemaVersion:1,status:'blocked',reasonCode:'acceptance-outstanding-turn-identity-invalid'};
  let response;try{response=await requestJson(`${auth.origin}/api/workspaces/${auth.workspaceId}/turns/${turnId}/cancel`,{cookie:auth.cookie,method:'POST',key:`acceptance-cleanup-${turnId}`,body:{}});}catch(error){return {schemaVersion:1,status:'blocked',turnId,recoveredFromSnapshot,reasonCode:error instanceof Error?error.message:'acceptance-outstanding-turn-cancel-failed'};}
  while(Date.now()<end){try{const snapshot=cleanupWorkspaceSnapshot(await workspace(auth),auth.sessionId),turn=snapshot.turns[turnId],workspaceState=state(snapshot),terminal=TERMINAL.has(turn?.status)?{status:turn.status,cancelDisposition:turn.cancelDisposition??null,startedAt:turn.startedAt??null,runtimeGeneration:turn.runtimeGeneration??null,checkpoint:turn.checkpoint??null,neverStarted:turn.startedAt===null&&turn.runtimeGeneration===null&&turn.checkpoint===null}:null;last={terminal,workspace:workspaceState};if(terminal!==null&&quiescent(workspaceState))return {schemaVersion:1,status:'passed',turnId,recoveredFromSnapshot,cancelResponse:{status:response?.status??null,cancelDisposition:response?.cancelDisposition??null},terminal,workspace:workspaceState};}catch{}await sleep(pollMs);}
  return {schemaVersion:1,status:'blocked',turnId,recoveredFromSnapshot,reasonCode:'acceptance-outstanding-turn-cleanup-unconfirmed',last};
}

export function unavailableInventory(){return {schemaVersion:1,status:'blocked',reasonCode:'exact-actor-and-storage-inventory-unavailable',conclusion:'Public Workspace APIs and application-level container counts cannot prove exact actor absence, R2 receipt equality, or D1 provisioning uniqueness.'};}
export function validateFinalInventory(value,lastRevisionId,release=null){
  const actors=value?.exactActors,manifests=value?.manifests,objects=value?.r2Objects,database=value?.d1;
  if(!value||value.schemaVersion!==1||value.status!=='passed'||value.workspaceHeadRevisionId!==lastRevisionId||value.duplicateProvisionCount!==0||value.r2ReceiptMismatchCount!==0||!Array.isArray(actors)||actors.length!==20||new Set(actors.map(actor=>actor?.actor)).size!==20||actors.filter(actor=>actor?.className==='TrustedPiSandbox').length!==10||actors.filter(actor=>actor?.className==='ProjectToolSandbox').length!==10||!Array.isArray(manifests)||manifests.length!==10||new Set(manifests.map(item=>item?.revisionId)).size!==10||!Array.isArray(objects)||objects.length<2||database?.workspaceRows!==1||database?.provisionRows!==1||!Number.isSafeInteger(database?.receiptRows)||database.receiptRows<1||database?.duplicateProvisionKeys!==0||!Array.isArray(value.applicationObservations)||(release&&(value.workerSourceSha!==release.workerSourceSha||value.workerVersionId!==release.workerVersionId)))fail('acceptance-final-inventory-invalid');
  const ordered=value.applicationObservations;if(ordered.some((row,index)=>!Number.isSafeInteger(row?.observedAt)||(index>0&&row.observedAt<=ordered[index-1].observedAt)))fail('acceptance-final-inventory-invalid');
  const isQuiet=row=>row.active===0&&row.live===0&&row.assigned===0&&row.failed===0&&row.nonInactive===0;let start=ordered.length-1;while(start>=0&&isQuiet(ordered[start]))start--;start++;const quiet=ordered.slice(start);
  if(quiet.length<2||quiet.at(-1).observedAt-quiet[0].observedAt<30_000||actors.some(actor=>actor?.state!=='absent'||actor?.platformState!=='inactive'))fail('acceptance-final-inventory-not-quiet');return jsonClone(value);
}

async function evidenceDirectory(root,sha,now){
  const stamp=now.toISOString().replace(/[-:.]/g,''),name=`issues-1-6-21-${stamp}-${sha.slice(0,8)}`,path=resolve(root,'docs/evidence/runs',name);await mkdir(path,{mode:0o700});return {name,path};
}
async function evidence(path,name,value){if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))fail('acceptance-evidence-name-invalid');await writeFile(resolve(path,name),`${JSON.stringify(value,null,2)}\n`,{encoding:'utf8',mode:0o600,flag:'wx'});}
async function checksums(path){const names=(await readdir(path)).filter(name=>name!=='SHA256SUMS').sort(),lines=[];for(const name of names)lines.push(`${digest(await readFile(resolve(path,name)))}  ${name}`);await writeFile(resolve(path,'SHA256SUMS'),`${lines.join('\n')}\n`,{encoding:'utf8',mode:0o600,flag:'wx'});}

export async function runIssuesAcceptance({
  root=resolve(fileURLToPath(new URL('../..',import.meta.url))),workerSha,releaseResultPath,authInputPath,execute=false,turnRunner=driveTenTurns,inventoryPreflight=collectStagingInventoryPreflight,inventoryRunner=collectStagingFinalInventory,closeRunner=forwardCloseTurnGate,cancelRunner=cancelOutstandingTurn,shouldAbort=()=>false,now=new Date(),signalSource=null,signalExit=null,
}={}){
  if(!execute)fail('issues-acceptance-requires-explicit-execute');
  if(!SHA.test(workerSha??''))fail('issues-acceptance-requires-worker-sha');
  let release=null,auth,directory=null,result={schemaVersion:1,status:'blocked',phase:'initializing',reasonCode:'acceptance-not-started'},close,cleanup=null,outstanding=null,closePromise=null,signalClosing=false,signalCode=null;
  const closeGate=()=>{if(closePromise===null){try{closePromise=Promise.resolve(closeRunner({root,workerSha,execute:true})).catch(error=>({schemaVersion:1,status:'blocked',reasonCode:error instanceof Error?error.message:'gate-close-failed'}));}catch(error){closePromise=Promise.resolve({schemaVersion:1,status:'blocked',reasonCode:error instanceof Error?error.message:'gate-close-failed'});}}return closePromise;};
  const ensureNotInterrupted=()=>{if(signalClosing||shouldAbort())fail('issues-acceptance-interrupted');};
  const exitCodes={SIGINT:130,SIGTERM:143,SIGHUP:129},handlers=new Map(Object.entries(exitCodes).map(([name,code])=>[name,()=>{if(signalClosing)return;signalClosing=true;signalCode=code;void closeGate();}]));
  for(const [name,handler] of handlers)signalSource?.once(name,handler);
  try{
    ensureNotInterrupted();
    release=validateReleaseResult(await privateJson(releaseResultPath,'release-result'));ensureNotInterrupted();if(release.workerSourceSha!==workerSha)fail('acceptance-release-worker-sha-mismatch');
    directory=await evidenceDirectory(root,release.workerSourceSha,now);ensureNotInterrupted();await evidence(directory.path,'version-manifest.json',release);ensureNotInterrupted();auth=validateAuthInput(await privateJson(authInputPath,'auth-input'));ensureNotInterrupted();await evidence(directory.path,'input-summary.json',{schemaVersion:1,origin:auth.origin,workspaceId:auth.workspaceId,sessionId:auth.sessionId,cookiePresent:true});ensureNotInterrupted();
    const probe=release.platformProbe;await evidence(directory.path,'platform-probe.json',probe);ensureNotInterrupted();
    if(probe.status!=='passed'){result={schemaVersion:1,status:'blocked',phase:'platform-probe',reasonCode:probe.reasonCode??'platform-probe-blocked'};}
    else{
      const checkedProbe=validatePlatformProbe(probe);if(checkedProbe.workerSourceSha!==release.workerSourceSha||checkedProbe.workerVersionId!==release.pausedCandidateVersionId)fail('acceptance-platform-probe-release-mismatch');
      const readiness=await inventoryPreflight({root,release,auth,probe:checkedProbe});ensureNotInterrupted();await evidence(directory.path,'inventory-preflight.json',readiness);ensureNotInterrupted();
      if(readiness.status!=='passed')result={schemaVersion:1,status:'blocked',phase:'inventory-preflight',reasonCode:readiness.reasonCode??'inventory-preflight-blocked'};
      else{
        ensureNotInterrupted();const turns=await turnRunner(auth,{runToken:directory.name.replaceAll('-','').slice(-32),recordProgress:(name,value)=>evidence(directory.path,name,value),onOutstanding:value=>{outstanding=value;},shouldAbort:()=>signalClosing||shouldAbort()});ensureNotInterrupted();turns.sessionId=auth.sessionId;validateTenTurnEvidence(turns);await evidence(directory.path,'ten-turns.json',turns);ensureNotInterrupted();
        const inventory=await inventoryRunner({root,release,auth,probe:checkedProbe,turns,readiness});ensureNotInterrupted();await evidence(directory.path,'final-inventory.json',inventory);ensureNotInterrupted();
        if(inventory.status!=='passed')result={schemaVersion:1,status:'blocked',phase:'final-inventory',reasonCode:inventory.reasonCode??'final-inventory-blocked'};
        else{validateFinalInventory(inventory,turns.turns[9].revisionId,release);result={schemaVersion:1,status:'passed',phase:'accepted',workerVersionId:release.workerVersionId,turnCount:10};}
      }
    }
  }catch(error){result={schemaVersion:1,status:'blocked',phase:'acceptance',reasonCode:error instanceof Error?error.message:'acceptance-failed'};}
  finally{
    close=await closeGate();
    for(const [name,handler] of handlers)signalSource?.removeListener(name,handler);
    if(outstanding!==null&&auth){cleanup=await cancelRunner(auth,outstanding);if(directory)await evidence(directory.path,'outstanding-turn-cleanup.json',cleanup);if(cleanup?.status!=='passed')result={schemaVersion:1,status:'blocked',phase:'outstanding-turn-cleanup',reasonCode:'outstanding-turn-cleanup-unconfirmed',priorResult:result};}
    if(close?.status!=='passed')result={schemaVersion:1,status:'blocked',phase:'gate-close',reasonCode:'turn-gate-close-unconfirmed',priorResult:result};
    if(directory){await evidence(directory.path,'gate-close.json',close);await evidence(directory.path,'acceptance-result.json',result);await checksums(directory.path);}
    if(signalCode!==null)signalExit?.(close?.status==='passed'&&(cleanup===null||cleanup?.status==='passed')?signalCode:1);
  }
  return {...result,evidenceDirectory:directory?.path??null,gateClose:close,outstandingTurnCleanup:cleanup};
}

async function main(){
  const args=process.argv.slice(2),workerSha=args.find(value=>value.startsWith('--worker-sha='))?.slice('--worker-sha='.length),releaseResultPath=args.find(value=>value.startsWith('--release-result='))?.slice('--release-result='.length),authInputPath=args.find(value=>value.startsWith('--auth-input='))?.slice('--auth-input='.length);
  if(args.some(value=>value!=='--execute'&&!value.startsWith('--worker-sha=')&&!value.startsWith('--release-result=')&&!value.startsWith('--auth-input=')))fail('unsupported-argument');
  const result=await runIssuesAcceptance({workerSha,releaseResultPath,authInputPath,execute:args.includes('--execute'),signalSource:process,signalExit:code=>process.exit(code)});process.stdout.write(`${JSON.stringify(result,null,2)}\n`);if(result.status!=='passed')process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'issues-acceptance-failed'}\n`);process.exitCode=1;});
