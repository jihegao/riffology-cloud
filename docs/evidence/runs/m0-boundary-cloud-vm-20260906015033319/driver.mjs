import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { sourceSnapshot } from '../../scripts/m0/source-inventory.mjs';
const origin='https://riffology-m0-probe-staging.jihe-gao.workers.dev';
const token=JSON.parse(readFileSync('.local/cloud-staging/boundary.secrets.json','utf8')).M0_PROBE_TOKEN;
const stamp=new Date().toISOString().replaceAll(/[^0-9]/g,'');
const dir=`docs/evidence/runs/m0-boundary-cloud-vm-${stamp}`;mkdirSync(dir,{recursive:false,mode:0o700});
const before=sourceSnapshot(process.cwd());
const report={startedAt:new Date().toISOString(),deployment:JSON.parse(readFileSync('.local/m0-boundary-dockerhub-deploy-20260906/deployment-verified.json','utf8')),sourceBefore:before,operations:[],cloudGatePassed:false,negativeBodyDeadlineGatePassed:false,realModelCalls:0};
console.log(JSON.stringify({dir}));
async function call(operation,runId,timeoutMs){
 const r=await fetch(origin+'/probes/'+operation,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({run_id:runId}),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
 const reader=r.body.getReader();const chunks=[];let size=0;
 try{while(true){const n=await reader.read();if(n.done)break;size+=n.value.length;if(size>131072){await reader.cancel();throw new Error('response-limit');}chunks.push(Buffer.from(n.value));}}finally{reader.releaseLock();}
 return {httpStatus:r.status,responseBytes:size,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))};
}
for(const operation of ['isolation','tenancy','egress']){
 const runId=`m0-vm-${operation}-${randomBytes(8).toString('hex')}`;
 const entry={operation,runId,startedAt:new Date().toISOString()};report.operations.push(entry);
 try{entry.result=await call(operation,runId,180000);}catch{entry.error='bounded-probe-or-transport-failure';}
 finally{try{entry.cleanup=await call('cleanup',runId,30000);}catch{entry.cleanupError='cleanup-not-confirmed';}}
 entry.finishedAt=new Date().toISOString();
 writeFileSync(dir+'/vm-observations.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({operation,httpStatus:entry.result?.httpStatus,status:entry.result?.body?.status,phase:entry.result?.body?.observations?.phase,cleanup:entry.cleanup?.body?.cleanup,error:entry.error}));
 if(entry.error||entry.cleanupError)break;
}
report.finishedAt=new Date().toISOString();report.sourceAfter=sourceSnapshot(process.cwd());report.sourceStable=before.sha256===report.sourceAfter.sha256;
writeFileSync(dir+'/vm-observations.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({dir,sourceStable:report.sourceStable,cloudGatePassed:false}));
