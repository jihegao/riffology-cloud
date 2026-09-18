// Re-evaluate preserved synthetic evidence. No provider requests or model execution.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validateResultEnvelope,verifyDefaultChange} from '../../services/simulation/result-oracle.ts';
import {verifyCommandEvidence} from '../../services/simulation/command-evidence.ts';
import {workspaceArchiveReader} from '../../services/turn-runtime/workspace-file-index.ts';
const ROOT='docs/evidence/issue-77';
const hash=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>JSON.stringify(a,Object.keys(a??{}).sort())===JSON.stringify(b,Object.keys(b??{}).sort());
const check=(ok,category,reason)=>{if(!ok)throw Error(`${category}:${reason}`);};
const parsed=bytes=>{try{return JSON.parse(Buffer.from(bytes).toString());}catch{throw Error('contract:invalid-json');}};
function traceRow(trace,config){
 const snapshots=trace?.snapshots;
 check(Array.isArray(snapshots)&&snapshots.length>0&&snapshots.length<=10001,'contract','snapshot-coverage');
 check(snapshots.every((s,i)=>s.frame===i),'model','actual-update-count');
 return {seed:config.seed,parameters:config.parameters,steps:snapshots.length-1,before:snapshots[0].metrics,after:snapshots.at(-1).metrics};
}
function expectedRow(seed,service_time){return {seed,parameters:{customers:5,service_time},steps:5,before:{completed:0,mean_wait:0},after:{completed:5,mean_wait:(service_time-2)*2}};}
const expectedRows=[1,2,3].flatMap(seed=>[2,3].map(t=>expectedRow(seed,t)));
function checkTrace(trace,row){
 check(trace.snapshots.length===6,'model','actual-update-count');
 for(let i=0;i<=5;i++){
  const snap=trace.snapshots[i],time=i===0?0:row.seed%3+row.parameters.service_time*i;
  check(snap.time===time&&same(snap.metrics,{completed:i,mean_wait:i===0?0:(row.parameters.service_time-2)*(i-1)/2}),'model','numeric-oracle-mismatch');
 }
}
export function verifyRecordedAcceptance(report,readArtifact){
 const result={schemaVersion:1,kind:'recorded-internal-component-revalidation',networkUsed:false,codeExecuted:false,productionE2E:false,formalEvidencePublished:false,status:'failed',inputs:[],defaultChange:null,history:null,versions:[],commands:null,usage:null,billing:{status:'unsettled'},resources:null};
 try{
  check(Array.isArray(report.evidenceFiles),'harness','missing-evidence-inventory');
  const inventory=new Map();
  for(const item of report.evidenceFiles){
   check(typeof item.path==='string'&&item.path.startsWith(ROOT+'/live-artifacts/')&&!item.path.includes('..')&&!inventory.has(item.path),'harness','invalid-evidence-path');
   const bytes=readArtifact(item.path);check(hash(bytes)===item.sha256,'harness','artifact-hash-mismatch');inventory.set(item.path,bytes);result.inputs.push({path:item.path,sha256:item.sha256});
  }
  const bytes=name=>{const value=inventory.get(ROOT+'/live-artifacts/'+name);check(value!==undefined,'harness','artifact-missing');return value;};
  const candidates=[2,3].map(n=>parsed(bytes(`turn-${n}-candidate.json`)));
  verifyDefaultChange(candidates[0].spec,candidates[1].spec,'service_time',2);
  result.defaultChange={status:'verified',parameter:'service_time',before:3,after:2,scope:'parsed-model-spec-only'};
  check(candidates[0].spec.parameters.service_time.default===3,'contract','unexpected-original-default');
  const histories=candidates.map(c=>hash(c.files['model/results.json']));
  check(histories[0]===histories[1],'contract','history-not-preserved');result.history={status:'verified',path:'model/results.json',sha256:histories[0]};
  check(report.localComponents?.nativeRuns?.length===12&&report.localComponents?.revisions?.length===2,'harness','native-run-coverage');
  for(const [index,ordinal] of [2,3].entries()){
   const candidate=candidates[index],revision=report.localComponents.revisions.find(r=>r.ordinal===ordinal);
   check(revision,'save','revision-missing');
   const archive=bytes(`turn-${ordinal}-converted-workspace.tar`);check(hash(archive)===revision.filesSha256,'save','revision-files-hash-mismatch');
   const reader=workspaceArchiveReader(new Uint8Array(archive));
   for(const [path,content] of Object.entries(candidate.files)){
    const restored=reader.read([{path,maxBytes:1024*1024}]).get(path);check(restored&&hash(restored)===hash(content),'save','candidate-revision-bytes-mismatch');
   }
   const lockHash=hash(candidate.files['app/requirements.lock']);
   const runs=report.localComponents.nativeRuns.filter(r=>r.revisionId===revision.revisionId);
   check(runs.length===6,'harness','native-run-coverage');
   const candidateResults=parsed(candidate.files['model/results.json']);check(Array.isArray(candidateResults),'contract','result-rows-schema');
   const candidateRows=candidateResults.map(item=>{check(item?.config&&Number.isSafeInteger(item.config.steps),'contract','result-config');const row=traceRow(item.output,item.config);check(row.steps===item.config.steps,'model','actual-update-count');return row;});
   // Bind each row to its own actual native receipt; never invent an aggregate
   // Experiment identifier, and never treat this local replay as formal Evidence.
   const nativeRows=[],seen=new Set();
   for(const run of runs){
    check(run.filesSha256===revision.filesSha256&&run.dependencyLockSha256===lockHash,'save','execution-version-mismatch');
    const receipt=parsed(bytes(run.runId+'.json'));check(hash(JSON.stringify(receipt))===run.receiptSha256,'harness','receipt-hash-mismatch');
    check(receipt.token===hash(`${run.filesSha256}:${run.seed}:${run.parameters.service_time}`).slice(0,52),'save','native-control-binding-mismatch');
    check(receipt.status==='stopped'&&receipt.stop?.fenced===true,'resource','native-stop-unconfirmed');check(receipt.result?.exitCode===0,'model','native-execution-failed');
    const outputs=receipt.result.result.outputs;check(Array.isArray(outputs),'contract','native-outputs');
    for(const out of outputs)check(hash(Buffer.from(out.data,'base64'))===out.sha256,'harness','output-hash-mismatch');
    const traces=outputs.filter(o=>o.path==='trace.json');check(traces.length===1,'contract','trace-missing-or-duplicate');
    const trace=parsed(Buffer.from(traces[0].data,'base64')),row=traceRow(trace,run);checkTrace(trace,row);
    const key=JSON.stringify([row.seed,row.parameters.customers,row.parameters.service_time]);check(!seen.has(key),'contract','row-coverage');seen.add(key);
    const matching=candidateRows.filter(r=>r.seed===row.seed&&same(r.parameters,row.parameters));check(matching.length===1,'contract','row-coverage');
    const provenance={schemaVersion:1,authority:'platform-experiment',revisionId:revision.revisionId,filesSha256:run.filesSha256,dependencyLockSha256:run.dependencyLockSha256,executionReceiptId:run.runId};
    const oracle=expectedRows.find(r=>r.seed===row.seed&&same(r.parameters,row.parameters));check(oracle,'contract','row-coverage');
    const history={'prior-results':histories[index]},previous=index?{'prior-results':histories[0]}:{};
    validateResultEnvelope(candidate.spec,provenance,[oracle],{schemaVersion:1,provenance,rows:[row],history},previous);
    validateResultEnvelope(candidate.spec,provenance,[oracle],{schemaVersion:1,provenance,rows:matching,history},previous);
    check(same(receipt.result.result.metrics,row.after)&&same(run.metrics,row.after),'model','numeric-oracle-mismatch');nativeRows.push(row);
   }
   check(candidateRows.length===expectedRows.length&&nativeRows.length===expectedRows.length,'contract','row-coverage');
   for(const item of candidateResults)checkTrace(item.output,traceRow(item.output,item.config));
   result.versions.push({ordinal,revisionId:revision.revisionId,filesSha256:revision.filesSha256,rows:candidateRows.length,nativeReceipts:runs.length,status:'validated-candidate'});
  }
  const observations=report.commandObservations;
  result.commands=!Array.isArray(observations)||observations.length===0?{status:'unknown',category:'harness',reason:'command-trace-unavailable',providerCommandExecutionProven:false}: {status:'evaluated',providerCommandExecutionProven:false,observations:observations.map(item=>verifyCommandEvidence(item.proof,item.expected))};
  result.usage={status:report.turns?.every(t=>{const u=t.usage;return u&&['input_tokens','output_tokens','total_tokens'].every(k=>Number.isSafeInteger(u[k])&&u[k]>=0)&&u.input_tokens+u.output_tokens===u.total_tokens;})&&report.turns.length>0?'observed':'unknown',settlement:'pending'};
  result.resources=report.cleanup?.eachReadback404===true&&report.cleanup.sessionsCreated===report.cleanup.sessionsDeleted?{status:'recorded-deleted',liveReadbackPerformed:false}:{status:'unknown',liveReadbackPerformed:false};
  result.status='validated-candidate';
 }catch(error){const text=String(error?.message??''),match=/^(contract|model|harness|provider|save|billing|resource):([a-z0-9-]+)$/.exec(text);result.failure={category:match?.[1]??'harness',reason:match?.[2]??'unclassified-verification-error'};}
 return result;
}
export function readRecordedAcceptance(){
 const path=ROOT+'/live-acceptance.json',source=readFileSync(path);
 const sourcePaths=['scripts/issue77/verify-recorded-acceptance.mjs','scripts/issue77/verify-recorded-acceptance.test.mjs','services/simulation/result-oracle.ts','services/simulation/command-evidence.ts'];
 return {...verifyRecordedAcceptance(parsed(source),path=>readFileSync(path)),sourceManifest:{path,sha256:hash(source)},verificationCommand:'node scripts/issue77/verify-recorded-acceptance.mjs',testCommand:'node --test scripts/issue77/verify-recorded-acceptance.test.mjs',sourceFiles:sourcePaths.map(path=>({path,sha256:hash(readFileSync(path))})),sourceBinding:'content hashes; not a claim these additions existed in the production Worker source'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);if(args.some(a=>!a.startsWith('--output='))||args.length>1)throw Error('usage: node scripts/issue77/verify-recorded-acceptance.mjs [--output=path]');
 const result=readRecordedAcceptance();if(args[0])writeFileSync(resolve(args[0].slice(9)),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(result.status==='failed')process.exitCode=1;
}
