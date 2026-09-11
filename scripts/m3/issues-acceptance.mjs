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
const SHA=/^[a-f0-9]{40}$/;
const VERSION=/^[a-f0-9-]{36}$/;
const TERMINAL=new Set(['completed','failed','cancelled','interrupted']);
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

function turnSummary(snapshot,turnId){const turn=snapshot?.turns?.[turnId];return {observedAt:Date.now(),turnStatus:turn?.status??null,activeTurnId:snapshot?.activeTurnId??null,resourceWait:snapshot?.resourceWait??null,releaseHold:snapshot?.releaseHold??null,recoveryHold:snapshot?.recoveryHold??null};}
async function requestJson(url,{cookie,method='GET',body=null,key=null,timeoutMs=20_000}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const headers={'accept':'application/json','cache-control':'no-cache','cookie':cookie,'origin':new URL(url).origin};if(body!==null)headers['content-type']='application/json';if(key!==null)headers['idempotency-key']=key;
    const response=await fetch(url,{method,headers,body:body===null?undefined:JSON.stringify(body),signal:controller.signal,redirect:'error'});
    if(!response.ok)fail(`acceptance-http-${response.status}`);return await response.json();
  }finally{clearTimeout(timer);}
}
async function allEvents(auth){
  const events=[];let after=0;
  for(let page=0;page<32;page++){
    const value=await requestJson(`${auth.origin}/api/workspaces/${auth.workspaceId}/events?after_sequence=${after}&limit=200`,{cookie:auth.cookie});if(value.snapshotRequired)fail('acceptance-event-window-retired');events.push(...value.events);
    if(!value.hasMore)return events;if(!Number.isSafeInteger(value.nextSequence)||value.nextSequence<=after)fail('acceptance-event-cursor-invalid');after=value.nextSequence;
  }fail('acceptance-event-pages-exceeded');
}
async function workspace(auth){return requestJson(`${auth.origin}/api/workspaces/${auth.workspaceId}`,{cookie:auth.cookie});}
async function waitTerminal(auth,turnId,{pollMs=5_000,deadlineMs=15*60_000}={}){
  const end=Date.now()+deadlineMs,transitions=[];let prior='';
  while(Date.now()<end){const snapshot=await workspace(auth),summary=turnSummary(snapshot,turnId),encoded=JSON.stringify({...summary,observedAt:0});if(encoded!==prior){prior=encoded;transitions.push(summary);}const turn=snapshot?.turns?.[turnId];if(TERMINAL.has(turn?.status))return {turn,snapshot,transitions};await sleep(pollMs);}fail('acceptance-turn-deadline');
}

export async function driveTenTurns(auth,{runToken=`r${randomBytes(8).toString('hex')}`,pollMs=5_000,deadlineMs=15*60_000}={}){
  const turns=[];let previousTerminalSnapshot=null;
  for(let index=1;index<=10;index++){
    const suffix=String(index).padStart(2,'0'),nonce=randomBytes(16).toString('hex'),filePath=`docs/acceptance/${runToken}-turn-${suffix}.txt`,key=`accept-${runToken}-${suffix}`;
    const message=`Use project_write to create ${filePath} with the exact content ${nonce}. Then use project_read to read that same file and verify the content. Do not modify any other file.`;
    const submitted=await requestJson(`${auth.origin}/api/workspaces/${auth.workspaceId}/sessions/${auth.sessionId}/turns`,{cookie:auth.cookie,method:'POST',key,body:{message}}),turnId=submitted?.turn?.id;
    if(!ID.test(turnId??''))fail('acceptance-turn-submit-invalid');
    const initial=await workspace(auth),terminal=await waitTerminal(auth,turnId,{pollMs,deadlineMs}),turn=terminal.turn;
    if(turn.status!=='completed'||turn.executionOutcome!=='completed'||turn.persistenceOutcome!=='saved'||!turn.checkpoint?.revisionId)fail('acceptance-turn-not-saved-completed');
    const events=await allEvents(auth),toolEvents=events.filter(event=>event.turnId===turnId&&event.type==='tool.completed').map(event=>({sequence:event.sequence,eventId:event.eventId,name:event.payload?.name,isError:event.payload?.isError})),assistantNonceConfirmation=events.some(event=>event.turnId===turnId&&event.type==='assistant.message'&&JSON.stringify(event.payload).includes(nonce));
    if(!toolEvents.some(event=>event.name==='project_write'&&event.isError===false)||!toolEvents.some(event=>event.name==='project_read'&&event.isError===false))fail('acceptance-required-tool-event-missing');
    const files=await requestJson(`${auth.origin}/api/workspaces/${auth.workspaceId}/files`,{cookie:auth.cookie}),diff=await requestJson(`${auth.origin}/api/workspaces/${auth.workspaceId}/diff`,{cookie:auth.cookie});
    if(files?.revision?.revisionId!==turn.checkpoint.revisionId||!files.files?.some(entry=>entry.path===filePath&&entry.type==='file')||diff?.revision?.revisionId!==turn.checkpoint.revisionId)fail('acceptance-files-diff-refresh-mismatch');
    const queuedBehindRelease=index===1?null:previousTerminalSnapshot?.releaseHold!==null&&submitted.turn.status==='queued'&&initial?.turns?.[turnId]?.status==='queued';
    turns.push({index,turnId,filePath,nonce,assistantNonceConfirmation,revisionId:turn.checkpoint.revisionId,checkpoint:turn.checkpoint,toolEvents,submittedStatus:submitted.turn.status,queuedBehindRelease,transitions:[turnSummary(initial,turnId),...terminal.transitions],filesRefresh:{revision:files.revision,file:{...files.files.find(entry=>entry.path===filePath)}},diffRefresh:{revision:diff.revision,summary:diff.summary,changeCount:Array.isArray(diff.changes)?diff.changes.length:null}});
    previousTerminalSnapshot=terminal.snapshot;
  }
  const end=Date.now()+15*60_000;let finalSnapshot;
  do{finalSnapshot=await workspace(auth);if(finalSnapshot.activeTurnId===null&&finalSnapshot.resourceWait===null&&finalSnapshot.releaseHold===null&&finalSnapshot.recoveryHold===null)break;await sleep(pollMs);}while(Date.now()<end);
  return {schemaVersion:1,status:'passed',runToken,turns,finalSnapshot};
}

export function validateTenTurnEvidence(value){
  if(!value||value.schemaVersion!==1||value.status!=='passed'||!Array.isArray(value.turns)||value.turns.length!==10)fail('acceptance-ten-turn-evidence-invalid');
  const turnIds=new Set(),revisions=new Set(),objectKeys=new Set(),paths=new Set(),nonces=new Set();
  for(const [offset,turn] of value.turns.entries()){
    const checkpoint=turn.checkpoint;
    if(turn.index!==offset+1||!ID.test(turn.turnId??'')||turnIds.has(turn.turnId)||!/^[a-f0-9]{64}$/.test(turn.revisionId??'')||revisions.has(turn.revisionId)||checkpoint?.revisionId!==turn.revisionId||typeof checkpoint?.objectKey!=='string'||objectKeys.has(checkpoint.objectKey)||!/^[a-f0-9]{64}$/.test(checkpoint?.filesSha256??'')||!/^[a-f0-9]{64}$/.test(checkpoint?.sessionSha256??'')||!Number.isSafeInteger(checkpoint?.committedAt)||checkpoint.committedAt<1||typeof turn.filePath!=='string'||paths.has(turn.filePath)||!/^[a-f0-9]{32}$/.test(turn.nonce??'')||nonces.has(turn.nonce))fail('acceptance-ten-turn-identity-invalid');
    if(turn.assistantNonceConfirmation!==true||!turn.toolEvents?.some(event=>event.name==='project_write'&&event.isError===false)||!turn.toolEvents?.some(event=>event.name==='project_read'&&event.isError===false)||turn.filesRefresh?.revision?.revisionId!==turn.revisionId||turn.filesRefresh?.revision?.filesSha256!==checkpoint.filesSha256||turn.filesRefresh?.file?.path!==turn.filePath||turn.diffRefresh?.revision?.revisionId!==turn.revisionId||turn.diffRefresh?.revision?.filesSha256!==checkpoint.filesSha256)fail('acceptance-ten-turn-material-invalid');
    if(offset>0&&(turn.queuedBehindRelease!==true||!turn.transitions?.some(item=>item?.turnStatus==='queued'&&item?.releaseHold!==null)))fail('acceptance-release-queue-transition-missing');turnIds.add(turn.turnId);revisions.add(turn.revisionId);objectKeys.add(checkpoint.objectKey);paths.add(turn.filePath);nonces.add(turn.nonce);
  }
  const final=value.finalSnapshot;if(final?.activeTurnId!==null||final?.resourceWait!==null||final?.releaseHold!==null||final?.recoveryHold!==null||final?.sessions?.[value.sessionId]?.head?.revisionId!==value.turns[9].revisionId)fail('acceptance-final-workspace-not-quiescent');
  return jsonClone(value);
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
  root=resolve(fileURLToPath(new URL('../..',import.meta.url))),workerSha,releaseResultPath,authInputPath,execute=false,turnRunner=driveTenTurns,inventoryPreflight=collectStagingInventoryPreflight,inventoryRunner=collectStagingFinalInventory,closeRunner=forwardCloseTurnGate,shouldAbort=()=>false,now=new Date(),signalSource=null,signalExit=null,
}={}){
  if(!execute)fail('issues-acceptance-requires-explicit-execute');
  if(!SHA.test(workerSha??''))fail('issues-acceptance-requires-worker-sha');
  let release=null,auth,directory=null,result={schemaVersion:1,status:'blocked',phase:'initializing',reasonCode:'acceptance-not-started'},close,closePromise=null,signalClosing=false;
  const closeGate=()=>{if(closePromise===null){try{closePromise=Promise.resolve(closeRunner({root,workerSha,execute:true})).catch(error=>({schemaVersion:1,status:'blocked',reasonCode:error instanceof Error?error.message:'gate-close-failed'}));}catch(error){closePromise=Promise.resolve({schemaVersion:1,status:'blocked',reasonCode:error instanceof Error?error.message:'gate-close-failed'});}}return closePromise;};
  const ensureNotInterrupted=()=>{if(signalClosing||shouldAbort())fail('issues-acceptance-interrupted');};
  const exitCodes={SIGINT:130,SIGTERM:143,SIGHUP:129},handlers=new Map(Object.entries(exitCodes).map(([name,code])=>[name,()=>{if(signalClosing)return;signalClosing=true;void closeGate().then(value=>signalExit?.(value?.status==='passed'?code:1));}]));
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
        ensureNotInterrupted();const turns=await turnRunner(auth,{runToken:directory.name.replaceAll('-','').slice(-32)});ensureNotInterrupted();turns.sessionId=auth.sessionId;validateTenTurnEvidence(turns);await evidence(directory.path,'ten-turns.json',turns);ensureNotInterrupted();
        const inventory=await inventoryRunner({root,release,auth,probe:checkedProbe,turns,readiness});ensureNotInterrupted();await evidence(directory.path,'final-inventory.json',inventory);ensureNotInterrupted();
        if(inventory.status!=='passed')result={schemaVersion:1,status:'blocked',phase:'final-inventory',reasonCode:inventory.reasonCode??'final-inventory-blocked'};
        else{validateFinalInventory(inventory,turns.turns[9].revisionId,release);result={schemaVersion:1,status:'passed',phase:'accepted',workerVersionId:release.workerVersionId,turnCount:10};}
      }
    }
  }catch(error){result={schemaVersion:1,status:'blocked',phase:'acceptance',reasonCode:error instanceof Error?error.message:'acceptance-failed'};}
  finally{
    close=await closeGate();
    for(const [name,handler] of handlers)signalSource?.removeListener(name,handler);
    if(close?.status!=='passed')result={schemaVersion:1,status:'blocked',phase:'gate-close',reasonCode:'turn-gate-close-unconfirmed',priorResult:result};
    if(directory){await evidence(directory.path,'gate-close.json',close);await evidence(directory.path,'acceptance-result.json',result);await checksums(directory.path);}
  }
  return {...result,evidenceDirectory:directory?.path??null,gateClose:close};
}

async function main(){
  const args=process.argv.slice(2),workerSha=args.find(value=>value.startsWith('--worker-sha='))?.slice('--worker-sha='.length),releaseResultPath=args.find(value=>value.startsWith('--release-result='))?.slice('--release-result='.length),authInputPath=args.find(value=>value.startsWith('--auth-input='))?.slice('--auth-input='.length);
  if(args.some(value=>value!=='--execute'&&!value.startsWith('--worker-sha=')&&!value.startsWith('--release-result=')&&!value.startsWith('--auth-input=')))fail('unsupported-argument');
  const result=await runIssuesAcceptance({workerSha,releaseResultPath,authInputPath,execute:args.includes('--execute'),signalSource:process,signalExit:code=>process.exit(code)});process.stdout.write(`${JSON.stringify(result,null,2)}\n`);if(result.status!=='passed')process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'issues-acceptance-failed'}\n`);process.exitCode=1;});
