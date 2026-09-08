import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {readProbeSecret} from '../../../../scripts/m0/storage-cloud.mjs';
const token=readProbeSecret(process.cwd(),'.local/cloud-staging/boundary.secrets.json');
const directory='docs/evidence/runs/m0-boundary-internal-20260906/';
const deployment=JSON.parse(readFileSync(directory+'deployment-verified.json'));
const began=Date.now();
const report={observedAt:new Date().toISOString(),deploymentVersion:deployment.version,requestCount:1,vmRequests:0,modelRequests:0,internalSuitePassed:false,publicIngressDeadline:'not_validated',gateDecision:'not_evaluated',ingressBodyCheckLimitMs:1000,internalSuiteLimitMs:2500,clientTotalLimitMs:12000};
try {
 const response=await fetch('https://riffology-m0-probe-staging.jihe-gao.workers.dev/probes/body-reader-diagnostics',{method:'POST',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000),redirect:'error'});
 report.httpStatus=response.status;report.cfRay=response.headers.get('cf-ray');
 const reader=response.body.getReader();let length=0;const chunks=[];
 try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;assert.ok(length<=8192);chunks.push(next.value);}}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
 const raw=Buffer.concat(chunks).toString('utf8');assert.ok(!raw.includes(token));report.responseBytes=length;report.body=JSON.parse(raw);assert.equal(response.status,200);
 const v=report.body;assert.equal(v.scope,'cloud-internal-handler');assert.equal(v.public_ingress_deadline,'not_validated');assert.equal(v.status,'expected_observations_collected');assert.equal(v.vmCalls+v.modelCalls+v.capabilitiesIssued,0);assert.equal(v.totalDeadlineFired,0);
 assert.equal(v.cases.length,3);
 const [complete,drip,stalled]=v.cases;assert.equal(complete.scenario,'complete');assert.equal(complete.parseResult,'accepted');assert.equal(complete.fixedValueMatched,1);
 for(const row of [drip,stalled]){assert.equal(row.parseResult,'rejected');assert.equal(row.observation.outcome,'deadline');assert.ok(row.observation.timerMs>=900&&row.observation.timerMs<2500);assert.equal(row.observation.eofMs,-1);}
 assert.equal(drip.scenario,'drip');assert.equal(drip.observation.chunks,4);assert.equal(stalled.scenario,'stalled');assert.equal(stalled.observation.chunks,1);
 for(const row of v.cases){assert.equal(row.cleanup.pendingSourceTimers,0);assert.equal(row.cleanup.streamLocked,0);}
 report.internalSuitePassed=true;
}catch{report.error='cloud-observation-or-verification-failed';}
report.elapsedMs=Date.now()-began;
writeFileSync(directory+'internal-observations.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));if(!report.internalSuitePassed)process.exitCode=1;
