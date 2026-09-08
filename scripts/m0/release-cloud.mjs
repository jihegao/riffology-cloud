import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync,appendFileSync } from 'node:fs';
import { resolve,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceSnapshot,hash,safePath } from './source-inventory.mjs';
import { readProbeSecret } from './storage-cloud.mjs';
export const ORIGIN='https://riffology-m0-release-staging.jihe-gao.workers.dev',RUN='release-g0-v3-20260906';
const phases=['baseline','compatibility','hold','upgrade','startup-failure','rollback'];
const root=fileURLToPath(new URL('../..',import.meta.url));
export async function readWithBudget(read,budget){
 for(;;){try{return await read();}catch(error){if(budget.remaining<=0)throw error;budget.remaining--;}}
}
export function checkPhase(report,phase){
 assert.equal(report.runId,RUN);assert.equal(report.environment,'cloudflare-vm');assert.equal(report.modelDispatches,0);
 assert.equal(report.operation,null);assert.equal(report.closed,false);
 assert.equal(report.phases.length,phases.indexOf(phase)+1);
 assert.deepEqual(report.phases.map(x=>x.phase),phases.slice(0,report.phases.length));
 assert.ok(report.phases.every(x=>x.status==='completed'&&x.error===null&&x.finishedAt>=x.startedAt));
 assert.equal(report.workerRelease,['baseline','rollback'].includes(phase)?'w1':'w2');
 const r=report.receipts;
 if(phase==='baseline'){assert.equal(r['baseline-increment'].counter,1);assert.equal(report.checkpoint.sequence,1);}
 if(phase==='compatibility'){assert.equal(r['incompatible-events'].rejected.length,2);assert.equal(r['incompatible-events'].businessDispatches,0);assert.equal(r['compatibility-before'].counter,r['compatibility-after'].counter);}
 if(phase==='hold'){assert.equal(r['hold-process'].active.requestId,'rollout-hold-task');assert.ok(r['hold-process'].active.pid>0);}
 if(phase==='upgrade'){assert.equal(r['new-read-state'].counter,2);assert.equal(r['new/restored'].revision,r['checkpoint/1'].revision);assert.ok(report.destroyed.includes('old')&&report.destroyed.includes('new'));}
 if(phase==='startup-failure'){const f=r['startup-failure'];assert.equal(f.failed,true);assert.equal(f.businessDispatches,0);assert.equal(f.startupIssued,true);assert.equal(f.observedExitCode,42);assert.equal(f.outcome,'confirmed');assert.ok(report.destroyed.includes('fault'));}
 if(phase==='rollback'){assert.equal(r['rollback-read-state'].counter,3);assert.equal(r['rollback/restored'].revision,r['checkpoint/2'].revision);assert.ok(report.destroyed.includes('rollback'));}
}
async function main(args){
 assert.equal(args.length,4);assert.equal(args[0],'--action');assert.equal(args[2],'--deployment');
 const phase=args[1];assert.ok([...phases,'cleanup'].includes(phase));
 const path=safePath(root,resolve(root,args[3]),'deployment');assert.ok(relative(root,path).startsWith('docs/evidence/runs/'));
 const deployment=JSON.parse(readFileSync(path,'utf8')),sources=sourceSnapshot(root);
 assert.equal(deployment.verified,true);assert.equal(deployment.origin,ORIGIN);assert.equal(deployment.sourceSha256,sources.sha256);
 assert.equal(deployment.accountId,'8b0d70250211aa10d89e20605a1c7e5e');assert.equal(deployment.script,'riffology-m0-release-staging');
 assert.match(deployment.versionId,/^[a-f0-9-]{36}$/);assert.match(deployment.bundleSha256,/^[a-f0-9]{64}$/);
 assert.match(deployment.applicationId,/^[a-f0-9-]{36}$/);assert.match(deployment.image,/^docker\.io\/jihegao\/riffology-m0-(?:trusted-proxy|project)@sha256:[a-f0-9]{64}$/);
 assert.equal(deployment.runId,RUN);assert.ok(Date.now()-deployment.verifiedAtMs<900000&&Date.now()>=deployment.verifiedAtMs);
 const token=readProbeSecret(root,'.local/cloud-staging/release.secrets.json'),started=Date.now();
 const dir=resolve(root,'docs/evidence/runs',`m0-release-${phase}-${started}`);mkdirSync(dir,{mode:0o700});
 const journal=resolve(dir,'actions.ndjson');writeFileSync(journal,'',{flag:'wx'});
 const summary={phase,startedAt:new Date(started).toISOString(),deployment,sources,requests:0,responseBytes:0,report:null,passed:false,cleanupConfirmed:false,cloudGatePassed:false};
 const safe=value=>{const text=JSON.stringify(value);assert.ok(!text.includes(token));return text;};
 let cleanup=false,dispatched=false;const readBudget={remaining:3};
 async function call(action,method='GET'){
  assert.ok(++summary.requests<=70);assert.ok(Date.now()-started<=240000);
  const row={action,method,at:new Date().toISOString(),outcome:'unknown'},controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);let reader;
  try{const response=await fetch(`${ORIGIN}/probe/${RUN}/${action}`,{method,headers:{authorization:`Bearer ${token}`},redirect:'manual',signal:controller.signal});row.status=response.status;
   assert.equal(response.headers.get('x-riffology-m0-mode'),'release-only');assert.equal(response.url,`${ORIGIN}/probe/${RUN}/${action}`);
   reader=response.body.getReader();const chunks=[];let bytes=0;
   for(let i=0;i<8192;i++){const p=await reader.read();if(p.done){const text=Buffer.concat(chunks).toString('utf8');safe(text);row.outcome='response';row.sha256=hash(text);return {status:response.status,body:JSON.parse(text)};}
    bytes+=p.value.length;summary.responseBytes+=p.value.length;assert.ok(bytes<=131072&&summary.responseBytes<=8*1024*1024);chunks.push(p.value);}throw Error('chunks');
  }finally{clearTimeout(timer);if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}appendFileSync(journal,safe(row)+'\n');}
 }
 async function report(){return readWithBudget(()=>call('report'),readBudget);}
 try{
  const before=await report();summary.report=before.body;assert.equal(before.status,200);
  if(phase!=='cleanup'){assert.equal(before.body.phases.length,phases.indexOf(phase));assert.equal(before.body.closed,false);assert.equal(before.body.operation,null);}
  dispatched=true;try{assert.equal((await call(phase,'POST')).status,202);}catch{/* Read persisted intent; never repeat this POST. */}
  while(Date.now()-started<170000){const r=await report();assert.equal(r.status,200);summary.report=r.body;
   if(phase==='cleanup'&&r.body.cleanup==='confirmed'){summary.passed=true;summary.cleanupConfirmed=true;break;}
   if(phase!=='cleanup'&&r.body.phases.at(-1)?.phase===phase&&r.body.phases.at(-1)?.status==='completed'){checkPhase(r.body,phase);summary.passed=true;break;}
   if(phase!=='cleanup'&&(r.body.closed||r.body.phases.some(p=>p.status==='unknown')))throw Error('phase-unconfirmed');
   if(phase==='cleanup'&&r.body.receipts?.['reconciliation-required'])throw Error('cleanup-needs-independent-reconciliation');
   await new Promise(resolve=>setTimeout(resolve,2000));
  }assert.equal(summary.passed,true);
 }catch{summary.failure='phase-or-transport-unconfirmed';
  if(dispatched&&phase!=='cleanup'){cleanup=true;try{await call('cleanup','POST');}catch{}
   for(let i=0;i<15&&Date.now()-started<220000;i++){try{const r=await report();summary.report=r.body;if(r.body.cleanup==='confirmed'){summary.cleanupConfirmed=true;break;}if(r.body.operation)break;}catch{break;}await new Promise(resolve=>setTimeout(resolve,2000));}}
 }finally{summary.finishedAt=new Date().toISOString();summary.cleanupRequested=cleanup;summary.sourceStable=sourceSnapshot(root).sha256===sources.sha256;
  summary.passed=summary.passed&&summary.sourceStable;writeFileSync(resolve(dir,'summary.json'),safe(summary)+'\n',{flag:'wx'});
  console.log(JSON.stringify({directory:dir,phase,passed:summary.passed,cleanupConfirmed:summary.cleanupConfirmed,requests:summary.requests}));if(!summary.passed)process.exitCode=1;}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{console.error('release driver setup rejected; secret details withheld');process.exitCode=1;});
