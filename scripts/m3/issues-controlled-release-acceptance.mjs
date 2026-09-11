#!/usr/bin/env node
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runIssuesAcceptance} from './issues-acceptance.mjs';
import {forwardCloseTurnGate,runControlledRelease} from './vertical-staging-release.mjs';

const SHA=/^[a-f0-9]{40}$/;
const fail=code=>{throw Error(code);};

export async function runControlledReleaseAcceptance({
  root=resolve(fileURLToPath(new URL('../..',import.meta.url))),workerSha,authInputPath,secretFiles=[],opencodeAuthFile=null,execute=false,releaseRunner=runControlledRelease,acceptanceRunner=runIssuesAcceptance,closeRunner=forwardCloseTurnGate,signalSource=null,signalExit=null,now=new Date(),
}={}){
  if(!execute)fail('controlled-release-acceptance-requires-explicit-execute');
  if(!SHA.test(workerSha??''))fail('controlled-release-acceptance-requires-worker-sha');
  const handoffDirectory=mkdtempSync(resolve(tmpdir(),'riffology-m3-release-acceptance-')),releaseResultPath=resolve(handoffDirectory,'release-result.json');
  let interruptedSignal=null,closePromise=null,release=null,acceptance=null,result={schemaVersion:1,status:'blocked',phase:'initializing',reasonCode:'controlled-release-acceptance-not-started'};
  const closeGate=()=>{
    if(closePromise===null){
      try{closePromise=Promise.resolve(closeRunner({root,workerSha,execute:true})).then(value=>value?.status==='passed'&&value?.gateCloseConfirmed===true?value:{...value,status:'blocked',gateCloseConfirmed:false,reasonCode:value?.reasonCode??'turn-gate-close-unconfirmed'}).catch(error=>({schemaVersion:1,status:'blocked',gateCloseConfirmed:false,reasonCode:error instanceof Error?error.message:'turn-gate-close-failed'}));}
      catch(error){closePromise=Promise.resolve({schemaVersion:1,status:'blocked',gateCloseConfirmed:false,reasonCode:error instanceof Error?error.message:'turn-gate-close-failed'});}
    }
    return closePromise;
  };
  const shouldAbort=()=>interruptedSignal!==null;
  const ensureNotInterrupted=()=>{if(shouldAbort())fail('controlled-release-acceptance-interrupted');};
  const exitCodes={SIGINT:130,SIGTERM:143,SIGHUP:129},handlers=new Map(Object.entries(exitCodes).map(([name,code])=>[name,()=>{if(interruptedSignal!==null)return;interruptedSignal=name;void closeGate().then(value=>signalExit?.(value.status==='passed'?code:1));}]));
  for(const [name,handler] of handlers)signalSource?.once(name,handler);
  try{
    release=await releaseRunner({root,workerSha,secretFiles,opencodeAuthFile,execute:true,gateCloseRunner:()=>closeGate(),shouldAbort,signalSource:null,signalExit:null});
    ensureNotInterrupted();
    if(release?.status!=='passed')result={schemaVersion:1,status:'blocked',phase:'release',reasonCode:release?.reason??release?.reasonCode??'controlled-release-blocked',release};
    else{
      await new Promise(done=>setImmediate(done));ensureNotInterrupted();
      writeFileSync(releaseResultPath,`${JSON.stringify(release,null,2)}\n`,{encoding:'utf8',mode:0o600,flag:'wx'});
      acceptance=await acceptanceRunner({root,workerSha,releaseResultPath,authInputPath,execute:true,closeRunner:()=>closeGate(),shouldAbort,now,signalSource:null,signalExit:null});
      ensureNotInterrupted();
      result={schemaVersion:1,status:acceptance?.status==='passed'?'passed':'blocked',phase:acceptance?.status==='passed'?'accepted':'acceptance',reasonCode:acceptance?.status==='passed'?null:acceptance?.reasonCode??'issues-acceptance-blocked',workerVersionId:release.workerVersionId??null,evidenceDirectory:acceptance?.evidenceDirectory??null,release,acceptance};
    }
  }catch(error){result={schemaVersion:1,status:'blocked',phase:interruptedSignal===null?'orchestration':'interrupted',reasonCode:error instanceof Error?error.message:'controlled-release-acceptance-failed',release,acceptance};}
  finally{
    const close=await closeGate();
    for(const [name,handler] of handlers)signalSource?.removeListener(name,handler);
    if(close.status!=='passed')result={schemaVersion:1,status:'blocked',phase:'gate-close',reasonCode:'turn-gate-close-unconfirmed',priorResult:result,release,acceptance};
    result={...result,gateClose:close};
    rmSync(handoffDirectory,{recursive:true,force:true});
  }
  return result;
}

async function main(){
  const args=process.argv.slice(2),workerSha=args.find(value=>value.startsWith('--worker-sha='))?.slice('--worker-sha='.length),authInputPath=args.find(value=>value.startsWith('--auth-input='))?.slice('--auth-input='.length),secretFiles=args.filter(value=>value.startsWith('--secrets-file=')).map(value=>value.slice('--secrets-file='.length)),opencodeAuthFile=args.find(value=>value.startsWith('--opencode-auth-file='))?.slice('--opencode-auth-file='.length)??null,output=args.find(value=>value.startsWith('--output='))?.slice('--output='.length)??null;
  if(args.some(value=>value!=='--execute'&&!value.startsWith('--worker-sha=')&&!value.startsWith('--auth-input=')&&!value.startsWith('--secrets-file=')&&!value.startsWith('--opencode-auth-file=')&&!value.startsWith('--output=')))fail('unsupported-argument');
  const result=await runControlledReleaseAcceptance({workerSha,authInputPath,secretFiles,opencodeAuthFile,execute:args.includes('--execute'),signalSource:process,signalExit:code=>{process.exitCode=code;}}),encoded=`${JSON.stringify(result,null,2)}\n`;
  if(output)writeFileSync(resolve(output),encoded,{encoding:'utf8',mode:0o600,flag:'wx'});process.stdout.write(encoded);if(result.status!=='passed'&&process.exitCode===undefined)process.exitCode=2;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'controlled-release-acceptance-failed'}\n`);process.exitCode=1;});
