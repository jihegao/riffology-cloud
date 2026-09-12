#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {basename,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateAuthInput,validateFinalInventory,validateTenTurnEvidence} from './issues-acceptance.mjs';
import {collectStagingFinalInventory} from './staging-acceptance-inventory.mjs';

const SHA=/^[a-f0-9]{40}$/;
const VERSION=/^[a-f0-9-]{36}$/;
const RUN=/^issues-1-6-21-[A-Za-z0-9-]+$/;
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Error(code);};

async function json(path,code){let value;try{value=JSON.parse(await readFile(path,'utf8'));}catch{fail(code);}return value;}
async function privateJson(path,label){const target=resolve(path),info=await lstat(target).catch(()=>null);if(!info?.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0)fail(`${label}-must-be-private-regular-file`);return json(target,`${label}-invalid-json`);}
async function verifySourceRun(root,sourceRun){
  const base=resolve(root,'docs/evidence/runs'),path=resolve(sourceRun);if(!path.startsWith(`${base}${sep}`)||!RUN.test(basename(path)))fail('reconciliation-source-run-invalid');
  const sumBytes=await readFile(resolve(path,'SHA256SUMS')),lines=sumBytes.toString('utf8').trim().split('\n'),seen=new Set();
  if(lines.length<1)fail('reconciliation-source-checksums-invalid');
  for(const line of lines){const match=/^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line);if(!match||seen.has(match[2])||match[2]==='SHA256SUMS')fail('reconciliation-source-checksums-invalid');seen.add(match[2]);const bytes=await readFile(resolve(path,match[2])).catch(()=>null);if(bytes===null||digest(bytes)!==match[1])fail('reconciliation-source-checksum-mismatch');}
  for(const name of ['version-manifest.json','inventory-preflight.json','ten-turns.json','final-inventory.json','gate-close.json','acceptance-result.json'])if(!seen.has(name))fail('reconciliation-source-evidence-incomplete');
  const release=await json(resolve(path,'version-manifest.json'),'reconciliation-version-manifest-invalid'),readiness=await json(resolve(path,'inventory-preflight.json'),'reconciliation-readiness-invalid'),turns=validateTenTurnEvidence(await json(resolve(path,'ten-turns.json'),'reconciliation-ten-turns-invalid')),priorInventory=await json(resolve(path,'final-inventory.json'),'reconciliation-prior-inventory-invalid'),priorClose=await json(resolve(path,'gate-close.json'),'reconciliation-prior-close-invalid'),priorResult=await json(resolve(path,'acceptance-result.json'),'reconciliation-prior-result-invalid');
  if(release?.schemaVersion!==1||!SHA.test(release.workerSourceSha??'')||!VERSION.test(release.workerVersionId??'')||release.workerVersionTag!==`source-${release.workerSourceSha}`||readiness?.status!=='passed'||readiness.workerSourceSha!==release.workerSourceSha||readiness.workerVersionId!==release.workerVersionId||priorInventory?.status!=='blocked'||priorInventory.reasonCode!=='acceptance-inventory-r2-manifest-read-failed'||priorClose?.status!=='blocked'||priorResult?.status!=='blocked'||priorResult.phase!=='gate-close'||priorResult.priorResult?.phase!=='final-inventory'||priorResult.priorResult?.reasonCode!=='acceptance-inventory-r2-manifest-read-failed')fail('reconciliation-source-evidence-invalid');
  return {path,name:basename(path),checksumsSha256:digest(sumBytes),release,readiness,turns};
}
async function writeEvidence(path,name,value){await writeFile(resolve(path,name),`${JSON.stringify(value,null,2)}\n`,{encoding:'utf8',mode:0o600,flag:'wx'});}
async function writeChecksums(path){const names=(await readdir(path)).sort(),lines=[];for(const name of names)lines.push(`${digest(await readFile(resolve(path,name)))}  ${name}`);await writeFile(resolve(path,'SHA256SUMS'),`${lines.join('\n')}\n`,{encoding:'utf8',mode:0o600,flag:'wx'});}

export async function runPostCloseReconciliation({root=resolve(fileURLToPath(new URL('../..',import.meta.url))),workerSha,sourceRun,authInputPath,auditWorkerVersionId,execute=false,inventoryRunner=collectStagingFinalInventory,now=new Date()}={}){
  if(!execute)fail('reconciliation-requires-explicit-execute');if(!SHA.test(workerSha??'')||!VERSION.test(auditWorkerVersionId??''))fail('reconciliation-identity-invalid');
  const source=await verifySourceRun(root,sourceRun);if(source.release.workerSourceSha!==workerSha)fail('reconciliation-worker-sha-mismatch');const auth=validateAuthInput(await privateJson(authInputPath,'reconciliation-auth-input'));if(auth.sessionId!==source.readiness.sessionId)fail('reconciliation-auth-scope-mismatch');
  const stamp=now.toISOString().replace(/[-:.]/g,''),name=`issues-1-6-21-reconcile-${stamp}-${workerSha.slice(0,8)}`,path=resolve(root,'docs/evidence/runs',name);await mkdir(path,{mode:0o700});
  let inventory,result;
  try{
    inventory=await inventoryRunner({root,release:source.release,auth,turns:source.turns,readiness:source.readiness,auditRelease:{workerSourceSha:workerSha,workerVersionId:auditWorkerVersionId,turnsEnabled:false}});
    if(inventory?.status!=='passed')fail(inventory?.reasonCode??'reconciliation-final-inventory-blocked');validateFinalInventory(inventory,source.turns.turns[9].revisionId,source.release);
    if(inventory.auditWorkerVersionId!==auditWorkerVersionId||inventory.auditTurnsEnabled!==false)fail('reconciliation-gate-proof-invalid');
    result={schemaVersion:1,status:'passed',phase:'post-close-reconciled',workerSourceSha:workerSha,acceptanceWorkerVersionId:source.release.workerVersionId,auditWorkerVersionId,turnCount:10,sourceRun:source.name,sourceChecksumsSha256:source.checksumsSha256};
  }catch(error){result={schemaVersion:1,status:'blocked',phase:'post-close-reconciliation',reasonCode:error instanceof Error?error.message:'reconciliation-failed',workerSourceSha:workerSha,acceptanceWorkerVersionId:source.release.workerVersionId,auditWorkerVersionId,sourceRun:source.name,sourceChecksumsSha256:source.checksumsSha256};inventory??={schemaVersion:1,status:'blocked',reasonCode:result.reasonCode};}
  await writeEvidence(path,'source-run.json',{schemaVersion:1,sourceRun:source.name,sourceChecksumsSha256:source.checksumsSha256,workerSourceSha:workerSha,acceptanceWorkerVersionId:source.release.workerVersionId,auditWorkerVersionId});await writeEvidence(path,'final-inventory.json',inventory);await writeEvidence(path,'acceptance-result.json',result);await writeChecksums(path);
  return {...result,evidenceDirectory:path};
}

async function main(){const args=process.argv.slice(2),workerSha=args.find(value=>value.startsWith('--worker-sha='))?.slice(13),sourceRun=args.find(value=>value.startsWith('--source-run='))?.slice(13),authInputPath=args.find(value=>value.startsWith('--auth-input='))?.slice(13),auditWorkerVersionId=args.find(value=>value.startsWith('--audit-worker-version='))?.slice(23);if(args.some(value=>value!=='--execute'&&!value.startsWith('--worker-sha=')&&!value.startsWith('--source-run=')&&!value.startsWith('--auth-input=')&&!value.startsWith('--audit-worker-version=')))fail('unsupported-argument');const result=await runPostCloseReconciliation({workerSha,sourceRun,authInputPath,auditWorkerVersionId,execute:args.includes('--execute')});process.stdout.write(`${JSON.stringify(result,null,2)}\n`);if(result.status!=='passed')process.exitCode=2;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'reconciliation-failed'}\n`);process.exitCode=1;});
