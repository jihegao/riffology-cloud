import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceSnapshot,hash,safePath} from './source-inventory.mjs';
import {readProbeSecret} from './storage-cloud.mjs';
import {readWithBudget} from './release-cloud.mjs';
export const ORIGIN='https://riffology-m0-release-completion-staging.jihe-gao.workers.dev',RUN='release-completion-20260906';
export const REVERTED_VERSION='e6a57b3f-a5fb-47e6-abbd-cedbc568c822',REVERTED_BUNDLE='63429cde0c4d71a23eb331cf6d16e21be9dd6b2486d51bb2a9dba752197ffd40';
const root=fileURLToPath(new URL('../..',import.meta.url));
export function checkCompletion(r,{expectedRuntimeSourceSha256='1d8e7c354198a11ecd0d8220216c13416756c40072de6ce631a712d2e2d52056'}={}){
 assert.equal(r.runId,RUN);assert.equal(r.environment,'cloudflare-vm');assert.equal(r.state.phase,'completed');assert.equal(r.state.cleanup,'confirmed');
 assert.equal(r.state.operation,null);assert.equal(r.state.closed,true);assert.equal(r.state.error,null);assert.equal(r.modelDispatches,0);
 assert.equal(r.fault.result.outcome,'confirmed');assert.equal(r.fault.result.reason,'exit-42');assert.equal(r.fault.result.exitCode,42);assert.equal(r.fault.result.monitor.outcome,'unexpected-exit');assert.equal(r.fault.result.monitor.exitCode,42);
 assert.equal(r.fault.result.nativeRunning,false);assert.equal(r.fault.result.readiness.status,'rejected');assert.equal(r.fault.intent.startReturned,true);assert.equal(r.fault.intent.monitorAttached,true);assert.equal(r.fault.businessDispatches,0);assert.equal(r.faultCleanup.cleanup,'confirmed');
 assert.deepEqual(r.faultCleanup.result,r.fault.result);assert.equal(r.restoreDestroyed,true);
 assert.equal(r.restored.prefix,'m0-release/release-g0-v3-20260906');assert.equal(r.restored.revision,'518090fb384338b9e63ddbdf091ea03f2ce2198d347b8e509c165947dc4753a7');
 assert.equal(r.restored.stateSha256,'fe44e2085de9f5c29980f1a6c8a84a8c340131a8fefc9135a265d2667bde7b5c');assert.equal(r.restored.counter,2);
 assert.deepEqual(r.commands.map(c=>c.command),['initialize','increment','read']);assert.deepEqual(r.commands.map(c=>c.counter),[2,3,3]);assert.ok(r.commands.every(c=>c.replayed===false));
 assert.equal(r.checkpoint.counter,3);assert.equal(r.checkpoint.prefix,`m0-release-completion/${RUN}`);assert.match(r.checkpoint.revision,/^[a-f0-9]{64}$/);
 assert.match(expectedRuntimeSourceSha256,/^[a-f0-9]{64}$/);assert.equal(r.sourceSha256,expectedRuntimeSourceSha256);
}
async function main(args){
 assert.equal(args.length,2);assert.equal(args[0],'--deployment');const path=safePath(root,resolve(root,args[1]),'deployment');assert.ok(relative(root,path).startsWith('docs/evidence/runs/'));
 const deployment=JSON.parse(readFileSync(path,'utf8')),sources=sourceSnapshot(root);
 assert.equal(deployment.verified,true);assert.equal(deployment.origin,ORIGIN);assert.equal(deployment.runId,RUN);assert.equal(deployment.sourceSha256,sources.sha256);
 assert.equal(deployment.accountId,'8b0d70250211aa10d89e20605a1c7e5e');assert.equal(deployment.reverted.versionId,REVERTED_VERSION);assert.equal(deployment.reverted.bundleSha256,REVERTED_BUNDLE);
 assert.match(deployment.versionId,/^[a-f0-9-]{36}$/);assert.match(deployment.bundleSha256,/^[a-f0-9]{64}$/);assert.ok(Date.now()>=deployment.verifiedAtMs&&Date.now()-deployment.verifiedAtMs<900000);
 const token=readProbeSecret(root,'.local/cloud-staging/release-completion.secrets.json'),started=Date.now(),dir=resolve(root,'docs/evidence/runs',`m0-release-completion-${started}`);mkdirSync(dir,{mode:0o700});
 const journal=resolve(dir,'actions.ndjson');writeFileSync(journal,'',{flag:'wx'});
 const summary={startedAt:new Date(started).toISOString(),deployment,sources,requests:0,responseBytes:0,report:null,passed:false,cleanupConfirmed:false,cloudGatePassed:false};
 const safe=v=>{const s=JSON.stringify(v);assert.ok(!s.includes(token));return s;};const budget={remaining:3};let accepted=false,cleanupDeadline=0;
 async function call(action,method='GET'){
  assert.ok(++summary.requests<=100);assert.ok(Date.now()<(cleanupDeadline||started+450000));
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000),row={action,method,at:new Date().toISOString(),outcome:'unknown'};let reader;
  try{const response=await fetch(`${ORIGIN}/probe/${RUN}/${action}`,{method,headers:{authorization:`Bearer ${token}`},redirect:'manual',signal:ctrl.signal});row.status=response.status;
   assert.equal(response.url,`${ORIGIN}/probe/${RUN}/${action}`);assert.equal(response.headers.get('x-riffology-m0-mode'),'release-completion');reader=response.body.getReader();let size=0;const parts=[];
   for(let i=0;i<8192;i++){const p=await reader.read();if(p.done){const body=Buffer.concat(parts).toString('utf8');safe(body);row.outcome='response';row.sha256=hash(body);return {status:response.status,body:JSON.parse(body)};}
    size+=p.value.length;summary.responseBytes+=p.value.length;assert.ok(size<=131072&&summary.responseBytes<=12*1024*1024);parts.push(p.value);}throw Error('chunk-limit');
  }finally{clearTimeout(timer);if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}appendFileSync(journal,safe(row)+'\n');}
 }
 const report=()=>readWithBudget(()=>call('report'),budget);
 try{const before=await report();summary.report=before.body;assert.equal(before.status,200);assert.equal(before.body.state,null,'fixed completion identity already used');
  accepted=true;try{assert.equal((await call('accept','POST')).status,202);}catch{/* Never repeat the mutation; observe persisted intent. */}
  while(Date.now()-started<420000){const r=await report();assert.equal(r.status,200);summary.report=r.body;
   if(r.body.state?.cleanup==='confirmed'){summary.cleanupConfirmed=true;checkCompletion(r.body);summary.passed=true;break;}
   if(r.body.state?.error==='interrupted-rpc-needs-independent-reconciliation')throw Error('owner-lost');await new Promise(resolve=>setTimeout(resolve,2000));
  }assert.equal(summary.passed,true);
 }catch{summary.failure='completion-or-transport-unconfirmed';}
 finally{if(accepted&&!summary.cleanupConfirmed){cleanupDeadline=Date.now()+60000;try{await call('cleanup','POST');}catch{}
   while(Date.now()<cleanupDeadline){try{const r=await report();summary.report=r.body;if(r.body.state?.cleanup==='confirmed'){summary.cleanupConfirmed=true;break;}if(r.body.state?.error==='interrupted-rpc-needs-independent-reconciliation')break;}catch{break;}await new Promise(resolve=>setTimeout(resolve,2000));}}
  summary.finishedAt=new Date().toISOString();summary.sourceStable=sourceSnapshot(root).sha256===sources.sha256;summary.passed=summary.passed&&summary.sourceStable&&summary.cleanupConfirmed;
  writeFileSync(resolve(dir,'summary.json'),safe(summary)+'\n',{flag:'wx'});console.log(JSON.stringify({directory:dir,passed:summary.passed,cleanupConfirmed:summary.cleanupConfirmed,requests:summary.requests,sourceStable:summary.sourceStable}));if(!summary.passed)process.exitCode=1;}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{console.error('completion setup rejected; secret details withheld');process.exitCode=1;});
