import https from 'node:https';
import { readFileSync,writeFileSync } from 'node:fs';
const token=JSON.parse(readFileSync('.local/cloud-staging/boundary.secrets.json','utf8')).M0_PROBE_TOKEN;
const origin='https://riffology-m0-probe-staging.jihe-gao.workers.dev';
const outcomeSet=new Set(['invalid_body','reading','complete','deadline','read_error','size_limit','invalid_json']);
function safeMetrics(raw){
 if(typeof raw!=='string'||raw.length>2048)return null;
 try{const v=JSON.parse(raw);const out={};for(const k of ['version','authMs','readStartMs','firstReadMs','eofMs','timerMs','chunks','bytes']){if(!Number.isSafeInteger(v[k])||v[k]<-1)return null;out[k]=v[k];}if(!outcomeSet.has(v.outcome))return null;return {...out,outcome:v.outcome};}catch{return null;}
}
async function probe(slow){return new Promise(resolve=>{
 const started=Date.now(),row={mode:slow?'delayed':'complete',expectedStatus:slow?400:200};let finishUpload,done=false;
 const finish=()=>{if(done)return;done=true;clearTimeout(finishUpload);row.elapsedMs=Date.now()-started;resolve(row);};
 const req=https.request(origin+'/probes/capabilities',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','transfer-encoding':'chunked'},signal:AbortSignal.timeout(12000)},res=>{
 row.httpStatus=res.statusCode;row.bodyObservation=safeMetrics(res.headers['x-m0-body-read-observation']);let body='';
 res.on('data',chunk=>{body+=chunk;if(body.length>4096){row.error='response-limit';req.destroy();finish();}});
 res.on('error',()=>{row.error='response-transport';finish();});
 res.on('end',()=>{try{const parsed=JSON.parse(body);row.fixtureOnly=parsed.fixture_only===true;row.capabilityIssued=typeof parsed.capability==='string';row.invalidBody=parsed.error==='invalid_body';}catch{row.error='invalid-json';}row.expectedStatusMatched=row.httpStatus===row.expectedStatus;finish();});
 });req.on('error',()=>{row.error='request-transport';finish();});
 const body=JSON.stringify({run_id:'m0-body-observation-'+Date.now(),tenant:'alpha',kind:'file'});
 if(slow){const first=body.slice(0,-1);req.write(first,error=>{if(error){row.error='write-error';finish();return;}row.firstFlushMs=Date.now()-started;finishUpload=setTimeout(()=>{row.lastWriteMs=Date.now()-started;req.end('}');},2100);});}else req.end(body);
});}
const report={observedAt:new Date().toISOString(),vmRequests:0,modelRequests:0,cases:[]};for(const slow of [false,true])report.cases.push(await probe(slow));report.fullDeadlineGatePassed=false;writeFileSync('docs/evidence/runs/m0-boundary-internal-20260906/public-ingress-observations.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report,null,2));
