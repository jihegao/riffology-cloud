#!/usr/bin/env node
import {mkdtempSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  ACCOUNT_ID,
  WORKER_NAME,
  buildReleaseManifest,
  createStagingConfigOverlay,
  runPreflight,
  validateDeployedWorkerVersion,
  validateStagingTopology,
  validateWorkerVersionResources,
  validateWorkerSource,
  workerVersionTag,
} from './vertical-staging-preflight.mjs';
import {runTrustedPiPlatformProbe,validatePlatformProbe} from './trusted-pi-platform-probe.mjs';

const WORKER_SHA=/^[a-f0-9]{40}$/;
const WORKER_VERSION_ID=/^[a-f0-9-]{36}$/;
const run=(bin,args,timeout=180_000)=>spawnSync(bin,args,{encoding:'utf8',timeout,maxBuffer:4*1024*1024});

export function deploymentArgs(configPath,workerSha,{dryRun=false,outdir=null}={}){
  const args=['deploy','--config',configPath,...(dryRun?['--dry-run']:[]),'--containers-rollout=none','--tag',workerVersionTag(workerSha)];
  if(dryRun){if(typeof outdir!=='string'||outdir.length===0)throw Error('dry-run-outdir-required');args.push('--outdir',outdir);}
  return args;
}

export function activeWorkerVersionId(deployment){
  const versions=deployment?.versions??[];
  return versions.length===1&&versions[0]?.percentage===100&&WORKER_VERSION_ID.test(versions[0]?.version_id??'')?versions[0].version_id:null;
}

function parseJson(result){if(result.status!==0)throw Error('cloud-command-failed');return JSON.parse(result.stdout);}

function inspectDeployment(wrangler,configPath,manifest,turnsEnabled,runner){
  const deployment=parseJson(runner(wrangler,['deployments','status','--json','--config',configPath],60_000));
  const versionId=activeWorkerVersionId(deployment);
  if(versionId===null)return {versionId:null,check:{name:'deployed-worker-version',status:'blocked',detail:'deployment-must-have-one-version-at-100-percent'}};
  const version=parseJson(runner(wrangler,['versions','view',versionId,'--json','--config',configPath],60_000)),containerApps=parseJson(runner(wrangler,['containers','list','--json','--config',configPath],60_000));
  return {versionId,check:validateDeployedWorkerVersion(manifest,version,deployment,{turnsEnabled,containerApps})};
}

function inspectGateState(wrangler,configPath,manifest,runner){
  try{
    const deployment=parseJson(runner(wrangler,['deployments','status','--json','--config',configPath],60_000)),versionId=activeWorkerVersionId(deployment);
    if(versionId===null)return {classification:'conflict',versionId:null};
    const version=parseJson(runner(wrangler,['versions','view',versionId,'--json','--config',configPath],60_000)),containerApps=parseJson(runner(wrangler,['containers','list','--json','--config',configPath],60_000));
    if(validateDeployedWorkerVersion(manifest,version,deployment,{turnsEnabled:false,containerApps}).status==='passed')return {classification:'closed-same-sha',versionId};
    if(validateDeployedWorkerVersion(manifest,version,deployment,{turnsEnabled:true,containerApps}).status==='passed')return {classification:'open-same-sha',versionId};
    return {classification:'conflict',versionId};
  }catch{return {classification:'unavailable',versionId:null};}
}

async function inspectGateStateWithRetry(wrangler,configPath,manifest,runner,{attempts,retryDelayMs}){
  const observations=[];let observed={classification:'unavailable',versionId:null};
  for(let attempt=1;attempt<=attempts;attempt++){
    observed=inspectGateState(wrangler,configPath,manifest,runner);observations.push({attempt,...observed});
    if(observed.classification!=='unavailable')break;
    if(attempt<attempts)await new Promise(done=>setTimeout(done,retryDelayMs*Math.min(2**(attempt-1),4)));
  }
  return {...observed,observations};
}

export async function verifyPausedContainerQuiet({root,config,runner=run,quietMs=30_000,pollMs=5_000,deadlineMs=5*60_000,sleepFn=ms=>new Promise(resolve=>setTimeout(resolve,ms)),nowFn=Date.now}={}){
  const wrangler=resolve(root,'node_modules/.bin/wrangler'),cloud=['--config',resolve(root,'infra/wrangler.m3-vertical-staging.jsonc')],end=nowFn()+deadlineMs;
  let listed=null;
  while(nowFn()<end&&listed===null){try{listed=parseJson(runner(wrangler,['containers','list','--json',...cloud],60_000));}catch{await sleepFn(pollMs);}}
  if(listed===null)throw Error('paused-container-list-unavailable');
  const apps=(config?.containers??[]).map(expected=>{const matches=listed.filter(item=>item?.name===expected.name&&item?.image===expected.image&&typeof item?.id==='string');if(matches.length!==1)throw Error('paused-container-app-mismatch');return {className:expected.class_name,id:matches[0].id,name:matches[0].name,image:matches[0].image};});
  if(apps.length!==4)throw Error('paused-container-app-mismatch');
  const observations=[];let quietSince=null;
  while(nowFn()<end){
    const observedAt=nowFn(),instances=[];let unavailable=false;
    try{for(const app of apps){const value=parseJson(runner(wrangler,['containers','instances',app.id,'--json','--per-page','100',...cloud],60_000)),next=value?.result_info?.next_page_token??value?.next_page_token??null,rows=Array.isArray(value)?value:value?.instances;if(!Array.isArray(rows)||next!==null)throw Error('paused-container-instance-page-incomplete');for(const row of rows){if(typeof row?.id!=='string'||typeof row?.name!=='string'||typeof row?.state!=='string')throw Error('paused-container-instance-invalid');instances.push({className:app.className,id:row.id,name:row.name,state:row.state});}}}catch{unavailable=true;}
    if(unavailable){observations.push({observedAt,nonInactive:null,total:null,instances:[],reason:'instance-query-unavailable'});quietSince=null;await sleepFn(pollMs);continue;}
    instances.sort((a,b)=>a.className.localeCompare(b.className)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));const nonInactive=instances.filter(item=>item.state!=='inactive').length;observations.push({observedAt,nonInactive,total:instances.length,instances});if(nonInactive===0){quietSince??=observedAt;if(observedAt-quietSince>=quietMs)return {schemaVersion:1,status:'passed',quietMs,apps,observations};}else quietSince=null;await sleepFn(pollMs);
  }
  return {schemaVersion:1,status:'blocked',reasonCode:'paused-container-quiet-deadline',quietMs,apps,observations};
}

export function validatePausedContainerQuiet(value,containerImages){
  const observations=value?.observations;
  if(value?.schemaVersion!==1||value.status!=='passed'||!Number.isSafeInteger(value.quietMs)||value.quietMs<30_000||!Array.isArray(value.apps)||value.apps.length!==4||!Array.isArray(observations)||!Array.isArray(containerImages)||containerImages.length!==4)throw Error('paused-container-quiet-proof-invalid');
  const appKeys=new Set(),classNames=new Set(),ids=new Set(),names=new Set();
  for(const app of value.apps){
    if(typeof app?.className!=='string'||app.className.length===0||typeof app?.id!=='string'||app.id.length===0||typeof app?.name!=='string'||app.name.length===0||typeof app?.image!=='string'||app.image.length===0)throw Error('paused-container-quiet-proof-invalid');
    appKeys.add(`${app.className}\0${app.id}\0${app.name}\0${app.image}`);
    classNames.add(app.className);ids.add(app.id);names.add(app.name);
  }
  const actual=value.apps.map(app=>`${app.className}\0${app.image}`).sort(),expected=containerImages.map(image=>`${image?.name??''}\0${image?.reference??''}`).sort();
  if(appKeys.size!==4||classNames.size!==4||ids.size!==4||names.size!==4||JSON.stringify(actual)!==JSON.stringify(expected))throw Error('paused-container-quiet-proof-invalid');
  let start=observations.length-1;
  while(start>=0&&observations[start]?.nonInactive===0&&Number.isSafeInteger(observations[start]?.observedAt)&&Array.isArray(observations[start]?.instances)&&observations[start].instances.every(item=>item?.state==='inactive'&&typeof item?.id==='string'&&item.id.length>0&&typeof item?.name==='string'&&item.name.length>0&&typeof item?.className==='string'&&item.className.length>0))start--;
  const suffix=observations.slice(start+1);
  if(suffix.length<2||suffix.some((row,index)=>row.total!==row.instances.length||index>0&&row.observedAt<=suffix[index-1].observedAt)||suffix.at(-1).observedAt-suffix[0].observedAt<value.quietMs)throw Error('paused-container-quiet-proof-invalid');
  return structuredClone(value);
}

export function pausedCandidateDeploymentArgs(versionId,configPath){
  if(!WORKER_VERSION_ID.test(versionId??'')||typeof configPath!=='string'||configPath.length===0)throw Error('paused-candidate-deploy-input-invalid');
  return ['versions','deploy',`${versionId}@100`,'--yes','--config',configPath];
}

function createControlConfig(){
  const directory=mkdtempSync(resolve(tmpdir(),'riffology-m3-gate-control-')),path=resolve(directory,'wrangler.json');
  writeFileSync(path,`${JSON.stringify({name:WORKER_NAME,account_id:ACCOUNT_ID,compatibility_date:'2026-09-09'},null,2)}\n`,{encoding:'utf8',mode:0o600,flag:'wx'});
  return {path,remove(){rmSync(directory,{recursive:true,force:true});}};
}

async function closeWithPausedCandidate({wrangler,workerSha,pausedCandidateVersionId,pausedCandidateManifest,runner,checks=[]}){
  const control=createControlConfig();
  try{
    if(!WORKER_VERSION_ID.test(pausedCandidateVersionId??'')||pausedCandidateManifest?.workerSourceSha!==workerSha||pausedCandidateManifest?.workerVersionTag!==workerVersionTag(workerSha))return {schemaVersion:1,status:'blocked',phase:'gate-close-fallback',gateClosed:false,gateCloseConfirmed:false,forwardConformant:false,reasonCode:'paused-candidate-proof-missing',checks};
    let candidate,containerApps;
    try{candidate=parseJson(runner(wrangler,['versions','view',pausedCandidateVersionId,'--json','--config',control.path],60_000));containerApps=parseJson(runner(wrangler,['containers','list','--json','--config',control.path],60_000));}
    catch{return {schemaVersion:1,status:'blocked',phase:'gate-close-fallback',gateClosed:false,gateCloseConfirmed:false,forwardConformant:false,reasonCode:'paused-candidate-query-unavailable',checks};}
    const candidateCheck=validateWorkerVersionResources(pausedCandidateManifest,candidate,{turnsEnabled:false,containerApps});
    if(candidateCheck.status!=='passed')return {schemaVersion:1,status:'blocked',phase:'gate-close-fallback',gateClosed:false,gateCloseConfirmed:false,forwardConformant:false,reasonCode:'paused-candidate-resource-mismatch',checks:[...checks,candidateCheck]};
    const before=inspectGateState(wrangler,control.path,pausedCandidateManifest,runner);
    if(before.classification==='closed-same-sha')return {schemaVersion:1,status:'passed',phase:'gate-close-fallback',gateClosed:true,gateCloseConfirmed:true,forwardConformant:false,fallbackDeploymentAttempted:false,workerVersionId:before.versionId,checks:[...checks,candidateCheck,{name:'paused-candidate-gate-close',status:'passed'}]};
    if(before.classification!=='open-same-sha')return {schemaVersion:1,status:'blocked',phase:'gate-close-fallback',gateClosed:false,gateCloseConfirmed:false,forwardConformant:false,reasonCode:`paused-candidate-current-${before.classification}`,checks:[...checks,candidateCheck]};
    const deployed=runner(wrangler,pausedCandidateDeploymentArgs(pausedCandidateVersionId,control.path),180_000),after=inspectGateState(wrangler,control.path,pausedCandidateManifest,runner),confirmed=after.classification==='closed-same-sha'&&after.versionId===pausedCandidateVersionId;
    return {schemaVersion:1,status:confirmed?'passed':'blocked',phase:'gate-close-fallback',gateClosed:confirmed,gateCloseConfirmed:confirmed,forwardConformant:false,fallbackDeploymentAttempted:true,deployExitConfirmed:deployed?.status===0,workerVersionId:after.versionId,reasonCode:confirmed?null:`paused-candidate-close-${after.classification}`,checks:[...checks,candidateCheck,{name:'paused-candidate-gate-close',status:confirmed?'passed':'blocked'}]};
  }finally{control.remove();}
}

export async function forwardCloseTurnGate({
  root=resolve(fileURLToPath(new URL('../..',import.meta.url))),workerSha,execute=false,runner=run,attempts=3,retryDelayMs=1_000,pausedCandidateVersionId=null,pausedCandidateManifest=null,
}={}){
  if(!execute)throw Error('gate-close-requires-explicit-execute');
  if(!WORKER_SHA.test(workerSha??''))throw Error('gate-close-requires-worker-sha');
  if(!Number.isSafeInteger(attempts)||attempts<1||attempts>5||!Number.isSafeInteger(retryDelayMs)||retryDelayMs<0||retryDelayMs>10_000)throw Error('gate-close-retry-policy-invalid');
  let paused=null;const outdir=mkdtempSync(resolve(tmpdir(),'riffology-m3-gate-close-dry-run-'));
  const wrangler=resolve(root,'node_modules/.bin/wrangler');
  try{
    try{paused=createStagingConfigOverlay(root,{turnsEnabled:false,workerSha});}
    catch(error){return closeWithPausedCandidate({wrangler,workerSha,pausedCandidateVersionId,pausedCandidateManifest,runner,checks:[{name:'gate-close-local-overlay',status:'blocked',detail:error instanceof Error?error.message:'gate-close-local-overlay-failed'}]});}
    const migrations=readdirSync(resolve(root,'services/catalog/migrations')).filter(name=>name.endsWith('.sql'));
    const topology=validateStagingTopology(paused.config,migrations),source=validateWorkerSource(root,workerSha,{release:true});
    if(topology.some(value=>value.status!=='passed')||source?.status!=='passed')return closeWithPausedCandidate({wrangler,workerSha,pausedCandidateVersionId,pausedCandidateManifest,runner,checks:[...topology,source]});
    const dry=runner(wrangler,deploymentArgs(paused.path,workerSha,{dryRun:true,outdir}),180_000),dryCheck={name:'gate-close-dry-run',status:dry.status===0?'passed':'blocked'};
    if(dry.status!==0)return closeWithPausedCandidate({wrangler,workerSha,pausedCandidateVersionId,pausedCandidateManifest,runner,checks:[dryCheck]});
    const manifest=buildReleaseManifest(paused.config,workerSha),deploymentAttempts=[];let observed={classification:'unavailable',versionId:null};
    for(let attempt=1;attempt<=attempts;attempt++){
      const deployed=runner(wrangler,deploymentArgs(paused.path,workerSha),300_000);
      observed=await inspectGateStateWithRetry(wrangler,paused.path,manifest,runner,{attempts,retryDelayMs});deploymentAttempts.push({attempt,deployExitConfirmed:deployed?.status===0,observed:observed.classification,workerVersionId:observed.versionId,reconciliationAttempts:observed.observations});
      if(observed.classification==='closed-same-sha'||observed.classification==='conflict'||observed.classification==='unavailable')break;
      if(attempt<attempts)await new Promise(done=>setTimeout(done,retryDelayMs*Math.min(2**(attempt-1),4)));
    }
    const confirmed=observed.classification==='closed-same-sha',attemptCount=deploymentAttempts.length,deployExitConfirmed=deploymentAttempts.some(item=>item.deployExitConfirmed),closeCheck=confirmed?{name:'deployed-worker-version',status:'passed'}:{name:'gate-close-forward-deploy',status:'blocked',detail:`gate-close-${observed.classification}`};
    if(!confirmed&&observed.classification==='open-same-sha')return closeWithPausedCandidate({wrangler,workerSha,pausedCandidateVersionId,pausedCandidateManifest,runner,checks:[dryCheck,closeCheck]});
    return {schemaVersion:1,status:confirmed?'passed':'blocked',phase:'gate-close-postdeploy',attemptCount,deploymentAttempts,deployExitConfirmed,gateClosed:confirmed,gateCloseConfirmed:confirmed,forwardConformant:confirmed,workerVersionId:observed.versionId,checks:[dryCheck,closeCheck]};
  }finally{paused?.remove();rmSync(outdir,{recursive:true,force:true});}
}

export async function runControlledRelease({
  root=resolve(fileURLToPath(new URL('../..',import.meta.url))),workerSha,secretFiles=[],opencodeAuthFile=null,execute=false,runner=run,preflightRunner=runPreflight,probeRunner=runTrustedPiPlatformProbe,quietRunner=verifyPausedContainerQuiet,gateCloseRunner=null,shouldAbort=()=>false,signalSource=null,signalExit=null,
}={}){
  if(!execute)throw Error('controlled-release-requires-explicit-execute');
  if(!WORKER_SHA.test(workerSha??''))throw Error('controlled-release-requires-worker-sha');
  const enabled=createStagingConfigOverlay(root,{turnsEnabled:true,workerSha}),paused=createStagingConfigOverlay(root,{turnsEnabled:false,workerSha});
  const wrangler=resolve(root,'node_modules/.bin/wrangler'),pausedDryRun=mkdtempSync(resolve(tmpdir(),'riffology-m3-paused-forward-dry-run-'));
  let openAttempted=false,closePromise=null,signalClosing=false,interruptedSignal=null,cleaned=false,releaseContext={};
  const cleanup=()=>{if(cleaned)return;cleaned=true;enabled.remove();paused.remove();rmSync(pausedDryRun,{recursive:true,force:true});};
  const performClose=async()=>{
    if(gateCloseRunner!==null){
      const value=await gateCloseRunner({root,workerSha,execute:true,pausedCandidateVersionId:releaseContext.pausedCandidateVersionId??null,pausedCandidateManifest:releaseContext.predeploy?.releaseManifest??null}),confirmed=value?.gateCloseConfirmed===true;
      return {status:value?.status==='passed'&&confirmed?'passed':'blocked',gateClosed:confirmed,gateCloseConfirmed:confirmed,forwardConformant:value?.forwardConformant===true,closedVersionId:value?.closedVersionId??value?.workerVersionId??null,checks:Array.isArray(value?.checks)?value.checks:[]};
    }
    const closed=runner(wrangler,deploymentArgs(paused.path,workerSha),300_000);
    let closeCheck={name:'gate-close-forward-deploy',status:'blocked',detail:'gate-close-forward-deploy-failed-or-unconfirmed'},closedVersionId=null;
    if(closed.status===0){
      try{const inspected=inspectDeployment(wrangler,paused.path,buildReleaseManifest(paused.config,workerSha),false,runner);closedVersionId=inspected.versionId;closeCheck={...inspected.check,name:'gate-close-forward-deploy'};}catch{}
    }
    return {status:closeCheck.status==='passed'?'passed':'blocked',gateClosed:closeCheck.status==='passed',gateCloseConfirmed:closeCheck.status==='passed',forwardConformant:closeCheck.status==='passed',closedVersionId,checks:[closeCheck]};
  };
  const closeGate=()=>closePromise??=performClose().catch(error=>({status:'blocked',gateCloseConfirmed:false,closedVersionId:null,checks:[{name:'gate-close-forward-deploy',status:'blocked',detail:error instanceof Error?error.message:'gate-close-forward-deploy-failed'}]}));
  const ensureNotInterrupted=()=>{if(signalClosing||shouldAbort())throw Object.assign(Error('controlled-release-interrupted'),{signal:interruptedSignal});};
  const exitCodes={SIGINT:130,SIGTERM:143,SIGHUP:129},handlers=new Map(Object.entries(exitCodes).map(([name,code])=>[name,()=>{if(signalClosing)return;signalClosing=true;interruptedSignal=name;void closeGate().then(value=>{cleanup();signalExit?.(value.status==='passed'?code:1);});}]));
  for(const [name,handler] of handlers)signalSource?.once(name,handler);
  try{
    const predeploy=await preflightRunner({root,cloud:true,dryRunEnabled:true,releasePhase:'predeploy',workerSha,secretFiles,opencodeAuthFile,stagingConfigPath:enabled.path});
    ensureNotInterrupted();
    if(predeploy.status!=='passed')return {schemaVersion:1,status:'blocked',phase:'predeploy',predeploy};
    const pausedDry=runner(wrangler,deploymentArgs(paused.path,workerSha,{dryRun:true,outdir:pausedDryRun}),180_000);
    if(pausedDry.status!==0)return {schemaVersion:1,status:'blocked',phase:'predeploy',predeploy,checks:[{name:'paused-forward-dry-run',status:'blocked',detail:'gate-close-forward-deploy-must-compile-before-opening'}]};

    const pausedDeploy=runner(wrangler,deploymentArgs(paused.path,workerSha),300_000);if(pausedDeploy.status!==0)throw Error('paused-candidate-deploy-failed-or-unconfirmed');
    const pausedActive=inspectDeployment(wrangler,paused.path,predeploy.releaseManifest,false,runner);if(pausedActive.check.status!=='passed')throw Error('paused-candidate-deployment-unconfirmed');
    releaseContext={predeploy,pausedCandidateVersionId:pausedActive.versionId};
    const platformProbeResult=await probeRunner({root,release:{workerSourceSha:workerSha,workerVersionId:pausedActive.versionId}});
    if(platformProbeResult?.status!=='passed')return {schemaVersion:1,status:'blocked',phase:'platform-probe',reasonCode:platformProbeResult?.reasonCode??'paused-candidate-platform-probe-blocked',pausedCandidateVersionId:pausedActive.versionId,predeploy,platformProbe:platformProbeResult};
    const platformProbe=validatePlatformProbe(platformProbeResult);
    releaseContext={...releaseContext,platformProbe};
    ensureNotInterrupted();
    if(platformProbe.workerSourceSha!==workerSha||platformProbe.workerVersionId!==pausedActive.versionId)throw Error('paused-candidate-platform-probe-mismatch');
    const preOpenQuiet=validatePausedContainerQuiet(await quietRunner({root,config:paused.config,runner}),predeploy.releaseManifest.containerImages);
    releaseContext={...releaseContext,preOpenQuiet};
    ensureNotInterrupted();
    const rechecked=inspectDeployment(wrangler,paused.path,predeploy.releaseManifest,false,runner),pausedCandidateRecheck={observedAt:Date.now(),workerVersionId:rechecked.versionId,check:rechecked.check};
    releaseContext={...releaseContext,pausedCandidateRecheck};
    if(rechecked.versionId!==pausedActive.versionId||rechecked.check.status!=='passed'||pausedCandidateRecheck.observedAt<preOpenQuiet.observations.at(-1).observedAt)throw Error('paused-candidate-post-quiet-recheck-failed');
    await new Promise(resolve=>setImmediate(resolve));
    ensureNotInterrupted();

    openAttempted=true;
    const deployed=runner(wrangler,deploymentArgs(enabled.path,workerSha),300_000);
    if(deployed.status!==0)throw Error('turn-gate-open-deploy-failed-or-unconfirmed');
    const active=inspectDeployment(wrangler,enabled.path,predeploy.releaseManifest,true,runner);
    if(active.check.status!=='passed')throw Error('turn-gate-open-deployment-unconfirmed');
    releaseContext={...releaseContext,workerVersionId:active.versionId};
    const postdeploy=await preflightRunner({root,cloud:true,releasePhase:'postdeploy',workerSha,workerVersionId:active.versionId,secretFiles,opencodeAuthFile,stagingConfigPath:enabled.path});
    ensureNotInterrupted();
    if(postdeploy.status!=='passed')throw Object.assign(Error('turn-gate-open-postdeploy-check-failed'),{postdeploy});
    return {schemaVersion:1,status:'passed',phase:'postdeploy',workerVersionId:active.versionId,pausedCandidateVersionId:pausedActive.versionId,pausedCandidateRecheck,platformProbe,preOpenQuiet,predeploy,postdeploy};
  }catch(error){
    if(!openAttempted&&!signalClosing&&!shouldAbort())throw error;
    const closed=await closeGate();
    return {schemaVersion:1,status:'blocked',phase:openAttempted?'postdeploy':'interrupted',reason:error instanceof Error?error.message:'controlled-release-failed',...releaseContext,gateCloseConfirmed:closed.gateCloseConfirmed,closedVersionId:closed.closedVersionId,checks:closed.checks,...((error&&typeof error==='object'&&'postdeploy'in error)?{postdeploy:error.postdeploy}:{})};
  }finally{
    for(const [name,handler] of handlers)signalSource?.removeListener(name,handler);
    cleanup();
  }
}

async function main(){
  const args=process.argv.slice(2),workerSha=args.find(value=>value.startsWith('--worker-sha='))?.slice('--worker-sha='.length)??null,secretFiles=args.filter(value=>value.startsWith('--secrets-file=')).map(value=>value.slice('--secrets-file='.length)),opencodeAuthFile=args.find(value=>value.startsWith('--opencode-auth-file='))?.slice('--opencode-auth-file='.length)??null,output=args.find(value=>value.startsWith('--output='))?.slice('--output='.length)??null;
  if(args.some(value=>value!=='--execute'&&!value.startsWith('--worker-sha=')&&!value.startsWith('--secrets-file=')&&!value.startsWith('--opencode-auth-file=')&&!value.startsWith('--output=')))throw Error('unsupported-argument');
  const result=await runControlledRelease({workerSha,secretFiles,opencodeAuthFile,execute:args.includes('--execute'),signalSource:process,signalExit:code=>process.exit(code)});
  const encoded=`${JSON.stringify(result,null,2)}\n`;if(output)writeFileSync(resolve(output),encoded,{encoding:'utf8',mode:0o600,flag:'wx'});process.stdout.write(encoded);if(result.status!=='passed')process.exitCode=2;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'controlled-release-failed'}\n`);process.exitCode=1;});
