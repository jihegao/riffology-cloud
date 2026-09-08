import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceSnapshot,hash,safePath} from './source-inventory.mjs';
import {readProbeSecret} from './storage-cloud.mjs';
export const ORIGIN='https://riffology-m0-pi-live-staging.jihe-gao.workers.dev';
export const RUN='go-live-g0-20260906';
export const HOST_ATTEMPT='go-live-egress-v2-20260906';
export const LIMITS=Object.freeze({requests:140,businessRequests:115,requestMs:15000,businessMs:450000,cleanupMs:90000,responseBytes:262144,totalBytes:24*1024*1024,readRetries:3,maxConcurrentVMs:1,maxVMLifecycles:3,maxModelDispatches:2});
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
export function liveSources(){return sourceSnapshot(root);}
export function checkLiveReport(value){
 assert.equal(value.environment,'cloudflare-vm');assert.equal(value.runId,RUN);assert.equal(value.hostAttempt,HOST_ATTEMPT);
 const s=value.state;assert.equal(s.phase,'completed');assert.equal(s.cleanup,'confirmed');assert.equal(s.closed,true);assert.equal(s.operation,null);assert.equal(s.error,null);
 for(const role of ['project','trusted']){assert.equal(value.reports[role].passed,true);assert.equal(value.reports[role].evidenceMode,'cloud-network');}
 for(const [i,phase] of ['initial','restored'].entries()){
  const r=value.reports[phase],p=i===0?value.proxyFirst:value.proxySecond,c=p.ledger.calls[`call-${i+1}`];
  assert.equal(r.passed,true);assert.equal(r.evidenceMode,'go-live-proxy');assert.equal(r.phase,phase);assert.equal(r.sdkVersion,'0.85.0');
  assert.equal(r.proxyModelTransportAttempts,1);assert.equal(r.modelTransportAttempts,1);assert.equal(r.globalFetchCalls,0);
  assert.equal(r.wireHistoryMatches,true);assert.equal(r.restoredHistoryMatches,true);assert.equal(r.duplicatePromptRejected,true);
  assert.equal(c.state,'terminal');assert.equal(c.facts.outcome,i===0?'completed':'cancelled');assert.equal(p.activeRequests,0);
  assert.equal(p.upstreamDispatchIntents,i+1);assert.equal(c.dispatchOrdinal,i+1);
  const wire=r.requests.find(x=>x.path==='/v1/chat/completions');assert.equal(wire.bodySha256,c.payloadHash);assert.equal(wire.platformRequestId,c.platformRequestId);
  assert.ok(c.facts.upstreamResponseId);assert.ok(r.responseIds.includes(c.facts.upstreamResponseId));
  assert.ok(r.events.some(x=>x.deltaType==='text_delta'));assert.equal(r.billingAmount,null);
 }
 assert.equal(value.reports.restored.cancelledWhileActive,true);assert.equal(value.reports.restored.cancellation.remote,'acknowledged');
 assert.equal(value.reports.restored.inputSnapshotSha256,value.checkpoint.sessionSha256);assert.equal(value.restoredDigest,value.checkpoint.sessionSha256);
 assert.match(value.checkpoint.revision,/^[a-f0-9]{64}$/);assert.equal(value.checkpoint.generation,1);
 assert.deepEqual(value.destroyed,{g1:true,g2:true,project:true});
 assert.equal(value.proxyFinal.revoked,true);assert.equal(value.proxyFinal.activeRequests,0);assert.equal(value.proxyFinal.upstreamDispatchIntents,2);
 const held=value.proxyFinal.rawTokenValueReservedMicrousd;
 assert.ok(Number.isSafeInteger(held)&&held>=0&&held<=923424);assert.equal(held,value.proxyFinal.ledger.heldMicrousd);
 assert.equal(value.proxyFinal.ledger.dispatchCount,2);
 for(const [i,prior] of [value.proxyFirst,value.proxySecond].entries()){
  const id=`call-${i+1}`,c=value.proxyFinal.ledger.calls[id],before=prior.ledger.calls[id];
  assert.equal(c.state,'terminal');assert.equal(c.facts.outcome,i===0?'completed':'cancelled');
  assert.equal(c.platformRequestId,before.platformRequestId);assert.equal(c.payloadHash,before.payloadHash);
 }
 assert.equal(value.proxyFinal.cashCharge,null);assert.equal(value.proxyFinal.absoluteCashCapProven,false);
}
async function main(args){
 if(args.length!==2||args[0]!=='--deployment')throw Error('deployment-file-required');
 const path=safePath(root,resolve(root,args[1]),'deployment');assert.ok(relative(root,path).startsWith('docs/evidence/runs/'));assert.ok(path.endsWith('/deployment-verified.json'));
 const deployment=JSON.parse(readFileSync(path,'utf8')),sources=liveSources();
 assert.equal(deployment.verified,true);assert.equal(deployment.origin,ORIGIN);assert.equal(deployment.runId,RUN);assert.equal(deployment.hostAttempt,HOST_ATTEMPT);
 assert.equal(deployment.accountId,'8b0d70250211aa10d89e20605a1c7e5e');assert.equal(deployment.sourceSha256,sources.sha256);
 assert.deepEqual(deployment.sourceFiles,sources.files);assert.ok(Date.now()>=deployment.verifiedAtMs&&Date.now()-deployment.verifiedAtMs<900000);
 for(const key of ['host','proxy']){assert.match(deployment[key].versionId,/^[a-f0-9-]{36}$/);assert.match(deployment[key].bundleSha256,/^[a-f0-9]{64}$/);}
 const token=readProbeSecret(root,'.local/cloud-staging/pi-live.secrets.json');
 const started=Date.now(),directory=resolve(root,'docs/evidence/runs',`m0-pi-live-cloud-${started}`);mkdirSync(directory,{mode:0o700});
 const journal=resolve(directory,'actions.ndjson');writeFileSync(journal,'',{flag:'wx',mode:0o600});
 const evidence={schemaVersion:1,runId:RUN,startedAt:new Date(started).toISOString(),deployment,sources,limits:LIMITS,requests:0,responseBytes:0,readRetries:0,actions:[],report:null,cleanupConfirmed:false,passed:false,realProviderCalls:null,cashCharge:null,cloudGatePassed:false,gate_decision:'needs-independent-review'};
 const safe=value=>{const text=JSON.stringify(value);if(text.includes(token)||/m0p\.[A-Za-z0-9_-]+\.[a-f0-9]{64}/.test(text))throw Error('secret-in-output');return text;};
 let accepted=false,cleanupDeadline=0;
 async function call(action,method='GET',auth=true){
  if(!cleanupDeadline&&evidence.requests>=LIMITS.businessRequests)throw Error('business-limit');
  if(++evidence.requests>LIMITS.requests||Date.now()>(cleanupDeadline||started+LIMITS.businessMs))throw Error('total-limit');
  const row={ordinal:evidence.requests,action,method,at:new Date().toISOString(),status:null,outcome:'unconfirmed'};
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),LIMITS.requestMs);let reader;
  try{const response=await fetch(`${ORIGIN}/probe/${RUN}/${action}`,{method,headers:auth?{authorization:`Bearer ${token}`}:{},redirect:'manual',signal:ctrl.signal});row.status=response.status;
   assert.equal(response.url,`${ORIGIN}/probe/${RUN}/${action}`);assert.equal(response.headers.get('x-riffology-m0-mode'),'go-live-supervisor');
   reader=response.body.getReader();const chunks=[];let size=0;
   for(let i=0;i<65536;i++){const part=await reader.read();if(part.done){const text=Buffer.concat(chunks).toString('utf8');safe(text);row.bodySha256=hash(text);row.bytes=size;row.outcome='response';return {status:response.status,body:JSON.parse(text)};}
    size+=part.value.length;evidence.responseBytes+=part.value.length;if(size>LIMITS.responseBytes||evidence.responseBytes>LIMITS.totalBytes)throw Error('response-limit');chunks.push(part.value);}
   throw Error('chunk-limit');
  }catch{row.error='request-or-response-failed';throw Error(row.error);}
  finally{clearTimeout(timer);if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}evidence.actions.push(row);appendFileSync(journal,safe(row)+'\n');}
 }
 async function report(){try{return await call('report');}catch(error){if(evidence.readRetries++>=LIMITS.readRetries)throw error;return call('report');}}
 try{
  assert.equal((await call('report','GET',false)).status,401);
  const before=await report();assert.equal(before.status,200);assert.equal(before.body.state,null,'fixed run already used');
  accepted=true;try{assert.equal((await call('accept','POST')).status,202);}catch{/* Observe, never replay this mutation. */}
  while(Date.now()<started+LIMITS.businessMs){const r=await report();assert.equal(r.status,200);evidence.report=r.body;
   if(r.body.state?.cleanup==='confirmed'){evidence.cleanupConfirmed=true;checkLiveReport(r.body);evidence.passed=true;break;}
   if(r.body.state?.error==='interrupted-rpc-needs-independent-reconciliation')throw Error('rpc-unknown');
   await new Promise(resolve=>setTimeout(resolve,4000));
  }assert.equal(evidence.passed,true,'probe-not-completed');
 }catch{evidence.failure='probe-or-transport-failed';}
 finally{
  if(accepted&&!evidence.cleanupConfirmed){cleanupDeadline=Date.now()+LIMITS.cleanupMs;try{await call('cleanup','POST');}catch{}
   while(Date.now()<cleanupDeadline){try{const r=await report();evidence.report=r.body;if(r.body.state?.cleanup==='confirmed'){evidence.cleanupConfirmed=true;break;}if(r.body.state?.error==='interrupted-rpc-needs-independent-reconciliation')break;}catch{break;}await new Promise(resolve=>setTimeout(resolve,4000));}}
  evidence.sourceStable=liveSources().sha256===sources.sha256;evidence.passed=evidence.passed&&evidence.sourceStable&&evidence.cleanupConfirmed;evidence.elapsedMs=Date.now()-started;evidence.finishedAt=new Date().toISOString();
  writeFileSync(resolve(directory,'summary.json'),safe(evidence)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({directory,passed:evidence.passed,cleanupConfirmed:evidence.cleanupConfirmed,requests:evidence.requests,sourceStable:evidence.sourceStable}));if(!evidence.passed)process.exitCode=1;
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{console.error('pi live setup rejected; no secret details');process.exitCode=1;});
