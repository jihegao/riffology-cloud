import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePublication,publicationContent} from '../../services/publication/readiness.ts';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {digest,simulationPlan,modelVersion} from '../../services/simulation/source.ts';
import {publishSimulationResult,type SimulationRecord} from '../../services/simulation/host.ts';
import type {ResearchSnapshot} from '../../services/research/export.ts';
import {verifyModelContent} from '../../services/runtime/content.ts';
const enc=(s:string)=>new TextEncoder().encode(s);
async function fixture(){
 const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},actor={userId:'owner',authVersion:1};
 const spec={schemaVersion:1,researchQuestion:'Does capacity affect output?',scope:'Deterministic local test model',entities:['capacity'],mechanisms:['scale capacity'],assumptions:['linear scaling'],parameters:{capacity:{type:'integer',default:2}},metrics:{score:{unit:'points'}},limitations:['No real-world validation'],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
 const archive=initialWorkspaceArchive({'model/run.py':enc('print(1)\n'),'model/model-spec.json':enc(JSON.stringify(spec)),'app/requirements.lock':enc('{"schemaVersion":1,"packages":{}}')});
 const source={kind:'saved-turn' as const,identity:{scope,sessionId:'session',turnId:'turn',dispatchId:'dispatch',generation:1},revision:{revisionId:'revision',objectKey:'private-key',filesSha256:await digest(archive),sessionSha256:'a'.repeat(64),committedAt:1}},plan=await simulationPlan(source,archive),objects=new Map<string,Uint8Array>();
 const bucket={get:async(key:string)=>{const bytes=objects.get(key);return bytes?{size:bytes.length,text:async()=>new TextDecoder().decode(bytes)}:null;},put:async(key:string,bytes:Uint8Array|string)=>objects.set(key,typeof bytes==='string'?enc(bytes):bytes)} as unknown as R2Bucket;
 const runs:SimulationRecord[]=[];
 for(const [index,capacity]of [2,3].entries()){
  const runId='run-'+index,record={experimentId:'group',groupId:'group',runId,scope,actor,key:'private',requestJson:'private',input:{runId,plan,parameters:{capacity},seed:42,deadlineAt:100,runtimeImage:'local-test-only'},status:'completed',createdAt:1,updatedAt:2,cancelledAt:null,errorCode:null,attempt:0,quotaClaimed:false,releaseProof:null,lease:null,startClaimed:true,stop:null,result:null,releaseBegunAt:null,quietSince:null,released:true} as SimulationRecord;
  record.result=await publishSimulationResult(bucket,record,{exitCode:0,pythonVersion:'3.13.0',result:{schemaVersion:1,metrics:{score:capacity*2},outputs:[]}});runs.push(record);
 }
 const snapshot:ResearchSnapshot={schemaVersion:1,exportId:'export',createdAt:1,scope,current:source,runs,groups:[{schemaVersion:1,groupId:'group',scope,actor,key:'private',requestJson:'private',plan,runtimeImage:'local-test-only',hypothesis:'More capacity increases score',configurations:[{configurationId:'baseline',role:'baseline',label:'Baseline',parameters:{capacity:2}},{configurationId:'intervention-1',role:'intervention',label:'Intervention',parameters:{capacity:3}}],seeds:[42],children:[{runId:'run-0',configurationId:'baseline',seed:42,cancelled:false},{runId:'run-1',configurationId:'intervention-1',seed:42,cancelled:false}],status:'completed',createdAt:1,updatedAt:2,cancelledAt:null,errorCode:null}],claims:[],assessments:[]};
 const ports={source:async()=>archive,artifact:async(key:string)=>objects.get(key)??null,authorize:async()=>{}};return {snapshot,ports,archive,plan};
}
test('readiness freezes full verified research package and source into existing copy format',async()=>{
 const f=await fixture(),prepared=await preparePublication(f.snapshot,f.ports,false);assert.equal(prepared.readiness.ready,true);const frozen=prepared.frozen!;assert.deepEqual(frozen.readiness.exampleGroupIds,['group']);assert.deepEqual(frozen.readiness.baselineRunIds,['run-0']);assert.equal(frozen.exportSha256,await digest(frozen.exportBytes));
 const resolved=await verifyModelContent({modelVersionId:'official',modelId:'model',version:'1',contentRef:'content',contentSha256:frozen.contentSha256},{size:frozen.contentBytes.length,arrayBuffer:async()=>frozen.contentBytes.slice().buffer});assert.equal(new TextDecoder().decode(resolved.files['model/run.py']),'print(1)\n');assert.equal(resolved.files['README.md'],undefined);
 f.snapshot.groups[0]!.hypothesis='Changed';f.snapshot.runs[0]!.result!.metrics.score=999;assert.equal(frozen.manifest.runs.length,2);assert.equal(frozen.readiness.ready,true);
});
test('partial, cancelled, rejected, missing and mixed-version evidence cannot pass readiness',async()=>{
 for(const mutate of [(f:Awaited<ReturnType<typeof fixture>>)=>{f.snapshot.groups[0]!.status='partial';},(f:Awaited<ReturnType<typeof fixture>>)=>{f.snapshot.runs[1]!.status='cancelled';},(f:Awaited<ReturnType<typeof fixture>>)=>{f.snapshot.assessments=[{scope:'run',runId:'run-0',version:modelVersion(f.plan)}];},(f:Awaited<ReturnType<typeof fixture>>)=>{f.snapshot.assessments=[{scope:'model',version:modelVersion(f.plan)}];},(f:Awaited<ReturnType<typeof fixture>>)=>{f.snapshot.groups[0]!.plan={...f.plan,specSha256:'f'.repeat(64)};},(f:Awaited<ReturnType<typeof fixture>>)=>{f.ports.artifact=async()=>null;}]){
  const f=await fixture();mutate(f);const result=await preparePublication(f.snapshot,f.ports,false);assert.equal(result.readiness.ready,false);assert.equal(result.frozen,null);
 }
});
test('active unsaved state and unchanged intervention block; chat-only checkpoint identity does not stale same model evidence',async()=>{
 const f=await fixture();assert.equal((await preparePublication(f.snapshot,f.ports,true)).readiness.ready,false);
 if(f.snapshot.current.kind!=='saved-turn')throw Error('fixture');f.snapshot.current={...f.snapshot.current,revision:{...f.snapshot.current.revision,revisionId:'later-chat-save'}};assert.equal((await preparePublication(f.snapshot,f.ports,false)).readiness.ready,true);
 f.snapshot.groups[0]!.configurations[1]!.parameters={capacity:2};assert.equal((await preparePublication(f.snapshot,f.ports,false)).readiness.ready,false);
});
test('content adapter rejects unsupported roots and readiness fails on denied or missing immutable content',async()=>{
 const archive=initialWorkspaceArchive({'model/run.py':enc('print(1)'),'other/file':enc('x')});await assert.rejects(publicationContent(archive),/source-path-unsupported/);
 const f=await fixture();await assert.rejects(preparePublication(f.snapshot,{...f.ports,authorize:async()=>{throw Error('denied');}},false),/denied/);
});
test('public readiness never returns internal exception messages',async()=>{
 const f=await fixture(),secret='private/r2/token=SECRET';
 const source=await preparePublication(f.snapshot,{...f.ports,source:async()=>{throw Error(secret);}},false);assert.equal(JSON.stringify(source).includes(secret),false);assert.ok(source.readiness.checks.some(c=>c.code==='publication-source-unavailable'));
 const artifact=await preparePublication(f.snapshot,{...f.ports,artifact:async()=>{throw Error(secret);}},false);assert.equal(JSON.stringify(artifact).includes(secret),false);assert.ok(artifact.readiness.checks.some(c=>c.code==='publication-export-unavailable'));
});
