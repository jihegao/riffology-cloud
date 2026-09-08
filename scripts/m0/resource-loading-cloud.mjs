import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceSnapshot, hash, safePath } from './source-inventory.mjs';
import { readProbeSecret } from './storage-cloud.mjs';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
export const ORIGIN='https://riffology-m0-pi-host-staging.jihe-gao.workers.dev';
export const RUN='resource-loading-20260906';
export const IMAGE='docker.io/jihegao/riffology-m0-trusted-proxy@sha256:4be14ca3e2191e2a2941d4eb0ff7ac904c5a694b60ee839f75ac429eac7f3e67';
export const LIMITS=Object.freeze({requests:100,businessRequests:80,requestMs:15000,businessMs:240000,cleanupMs:90000,responseBytes:131072,totalBytes:8*1024*1024,readRetries:3,instances:1});
export function resourceSources() {
 const all=sourceSnapshot(root), names=new Set(['services/runtime/resource-loading-probe.mjs','services/runtime/controlled-pi.mjs',
 'spikes/m0-pi-host/index.ts','spikes/m0-pi-host/worker.ts','spikes/m0-pi-host/env.d.ts','spikes/m0-pi-host/modules.d.ts',
 'spikes/m0-recovery/bounded-effect.ts','spikes/m0-cloud/auth.ts','spikes/m0-model-proxy/policy.ts',
 'infra/wrangler.m0-pi-host.jsonc','infra/m0-trusted.Dockerfile','scripts/m0/resource-loading-cloud.mjs',
 'scripts/m0/source-inventory.mjs','scripts/m0/storage-cloud.mjs','tests/m0/pi-host.test.ts','tests/m0/resource-loading-cloud.test.mjs','tests/m0/pi/resource-loading-probe.test.mjs','package.json','package-lock.json','tsconfig.json','.dockerignore']);
 const files=all.files.filter(x=>names.has(x.path));assert.equal(files.length,names.size);
 return {files,sha256:hash(JSON.stringify(files))};
}
export function checkReport(value) {
 assert.equal(value.environment,'cloudflare-vm');assert.equal(value.realProviderCalls,0);
 assert.equal(value.sandboxId,`m0-ph-${RUN}-s`);
 const s=value.state;assert.equal(s.runId,RUN);assert.equal(s.phase,'completed');assert.equal(s.closed,true);assert.equal(s.operation,null);assert.equal(s.cleanup,'confirmed');assert.equal(s.error,null);
 const r=s.report;assert.equal(r.operation,'G0-T03-resource-loading');assert.equal(r.sdkVersion,'0.85.0');assert.equal(r.requests,2);assert.equal(r.realProviderCalls,0);assert.equal(r.transport,'injected-fixed-SSE');assert.equal(r.controlledReload,true);assert.equal(r.passed,true);
 assert.deepEqual(r.phases.map(x=>x.phase),['startup','restored']);
 for(const phase of r.phases)for(const key of ['completed','extensionMarkerAbsent','extensionsAbsent','unauthorizedToolsAbsent','onlyAllowedModel','fixedSkillPresent','poisonAbsent','restoredHistoryPresent','snapshotCredentialAbsent','correctModel','noTools','historyPresent','literalSkillCommand'])assert.equal(phase[key],true,key);
 for(const key of ['extensionMarkerExecuted','extensionDiscovered','maliciousToolRegistered','noExtensionLoadErrors','forgedSkillDiscovered','settingsDiscovered','projectSettingsDiscovered','agentDirectorySettingsDiscovered','projectModelDiscovered','agentDirectoryModelDiscovered'])assert.equal(r.positiveControls[key],true,key);
 const paths=r.fixtureFiles.map(x=>x.path);
 for(const path of ['.pi/extensions/poison.mjs','.pi/skills/m0-poison/SKILL.md','.pi/settings.json','.pi/models.json','.platform-pi/settings.json','.platform-pi/models.json'])assert.ok(paths.includes(path));
 for(const f of r.fixtureFiles){assert.match(f.sha256,/^[a-f0-9]{64}$/);assert.ok(f.bytes>0 && f.bytes<=8192);}
}
async function main(args) {
 if(args.length!==2||args[0]!=='--deployment')throw Error('deployment-file-required');
 const path=safePath(root,resolve(root,args[1]),'deployment'), sources=resourceSources();
 assert.ok(relative(root,path).startsWith('docs/evidence/runs/'));assert.ok(path.endsWith('/deployment-verified.json'));
 const deployment=JSON.parse(readFileSync(path,'utf8'));
 assert.equal(deployment.verified,true);assert.equal(deployment.origin,ORIGIN);assert.equal(deployment.runId,RUN);assert.equal(deployment.image,IMAGE);
 assert.equal(deployment.accountId,'8b0d70250211aa10d89e20605a1c7e5e');assert.equal(deployment.scriptName,'riffology-m0-pi-host-staging');
 assert.match(deployment.versionId,/^[a-f0-9-]{36}$/);assert.match(deployment.bundleSha256,/^[a-f0-9]{64}$/);
 assert.equal(deployment.sourceSha256,sources.sha256);assert.deepEqual(deployment.sourceFiles,sources.files);
 assert.ok(Date.now()>=deployment.verifiedAtMs && Date.now()-deployment.verifiedAtMs<900000);
 const token=readProbeSecret(root,'.local/cloud-staging/pi-host.secrets.json');
 const started=Date.now(),directory=resolve(root,'docs/evidence/runs',`m0-resource-cloud-${started}`);mkdirSync(directory,{mode:0o700});
 const journal=resolve(directory,'actions.ndjson');writeFileSync(journal,'',{flag:'wx',mode:0o600});
 const evidence={schemaVersion:1,runId:RUN,startedAt:new Date(started).toISOString(),deployment,sources,limits:LIMITS,requests:0,responseBytes:0,readRetries:0,actions:[],report:null,cleanupConfirmed:false,passed:false,realProviderCalls:0,cloudGatePassed:false,gate_decision:'needs-independent-review'};
 let accepted=false, cleanupDeadline=0;
 const safe=value=>{const s=JSON.stringify(value);if(s.includes(token))throw Error('secret-in-output');return s;};
 async function call(action,method='GET',auth=true) {
  if(!cleanupDeadline && evidence.requests>=LIMITS.businessRequests)throw Error('business-request-limit');
  if(++evidence.requests>LIMITS.requests||Date.now()>(cleanupDeadline||started+LIMITS.businessMs))throw Error('total-limit');
  const row={ordinal:evidence.requests,action,method,at:new Date().toISOString(),status:null,outcome:'unconfirmed'};
  let reader;const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),LIMITS.requestMs);
  try {
   const response=await fetch(`${ORIGIN}/probe/${RUN}/${action}`,{method,headers:auth?{authorization:`Bearer ${token}`}:{},redirect:'manual',signal:ctrl.signal});row.status=response.status;
   assert.equal(response.url,`${ORIGIN}/probe/${RUN}/${action}`);assert.equal(response.headers.get('x-riffology-m0-mode'),'resource-loading-fixture');
   reader=response.body.getReader();const chunks=[];let size=0;
   while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;evidence.responseBytes+=next.value.length;if(size>LIMITS.responseBytes||evidence.responseBytes>LIMITS.totalBytes)throw Error('response-limit');chunks.push(next.value);}
   const body=Buffer.concat(chunks).toString('utf8');safe(body);row.bodySha256=hash(body);row.bytes=size;row.outcome='response';return {status:response.status,body:JSON.parse(body)};
  }catch{row.error='request-or-response-failed';throw Error(row.error);}
  finally{clearTimeout(timer);if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}evidence.actions.push(row);appendFileSync(journal,safe(row)+'\n');}
 }
 async function report(){try{return await call('report');}catch(error){if(evidence.readRetries++>=LIMITS.readRetries)throw error;return call('report');}}
 try {
  assert.equal((await call('report','GET',false)).status,401);
  const before=await report();assert.equal(before.status,200);assert.equal(before.body.state,null,'fixed run already used; cannot restart');
  accepted=true;try{const result=await call('accept','POST');assert.equal(result.status,202);}catch{/* Never resend accept; read durable state. */}
  while(Date.now()<started+LIMITS.businessMs){const result=await report();assert.equal(result.status,200);evidence.report=result.body;
   if(result.body.state?.cleanup==='confirmed'){checkReport(result.body);evidence.cleanupConfirmed=true;evidence.passed=true;break;}
   if(result.body.state?.operation && result.body.state?.error==='interrupted-operation-needs-independent-reconciliation')throw Error('rpc-outcome-unknown');
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  assert.equal(evidence.passed,true,'probe-not-completed');
 }catch{evidence.failure='probe-or-transport-failed';}
 finally{
  if(accepted&&!evidence.cleanupConfirmed){cleanupDeadline=Date.now()+LIMITS.cleanupMs;try{await call('cleanup','POST');}catch{}
   while(Date.now()<cleanupDeadline){try{const r=await report();evidence.report=r.body;if(r.body.state?.cleanup==='confirmed'){evidence.cleanupConfirmed=true;break;}if(r.body.state?.operation && r.body.state?.error==='interrupted-operation-needs-independent-reconciliation')break;}catch{break;}await new Promise(resolve=>setTimeout(resolve,2000));}
  }
  evidence.sourceStable=resourceSources().sha256===sources.sha256;evidence.passed=evidence.passed&&evidence.sourceStable&&evidence.cleanupConfirmed;
  evidence.elapsedMs=Date.now()-started;evidence.finishedAt=new Date().toISOString();
  writeFileSync(resolve(directory,'summary.json'),safe(evidence)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({directory,passed:evidence.passed,cleanupConfirmed:evidence.cleanupConfirmed,requests:evidence.requests,sourceStable:evidence.sourceStable}));if(!evidence.passed)process.exitCode=1;
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{console.error('resource cloud setup rejected; no secret details');process.exitCode=1;});
