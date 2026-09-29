import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {unzipSync} from 'fflate';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {digest,modelVersion,simulationPlan} from '../../services/simulation/source.ts';
import {simulationToken} from '../../services/simulation/native.ts';
import {publishSimulationResult,type SimulationRecord} from '../../services/simulation/host.ts';
import {buildResearchExport,type ResearchSnapshot} from '../../services/research/export.ts';
import {EvidenceLedger} from '../../services/simulation/evidence.ts';

test('research export preserves the frozen compiler bundle and result identity',async()=>{
 const root=new URL('../fixtures/compiler-v01/model/',import.meta.url);
 const archive=initialWorkspaceArchive({
  'model/model-spec.json':readFileSync(new URL('model-spec.json',root)),
  'model/business-ir.json':readFileSync(new URL('business-ir.json',root)),
  'model/model.simpack':readFileSync(new URL('model.simpack',root)),
 });
 const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1};
 const source={kind:'saved-turn' as const,identity:{scope,sessionId:'session',turnId:'turn',dispatchId:'dispatch',generation:1},revision:{revisionId:'revision',objectKey:'object',filesSha256:await digest(archive),sessionSha256:'a'.repeat(64),committedAt:1}};
 const plan=await simulationPlan(source,archive),objects=new Map<string,Uint8Array>();
 const bucket={put:async(key:string,body:string)=>{objects.set(key,new TextEncoder().encode(body));},get:async(key:string)=>{const bytes=objects.get(key);return bytes?{size:bytes.length,text:async()=>new TextDecoder().decode(bytes)}:null;}} as unknown as R2Bucket;
 const run={scope,experimentId:'run-b1',runId:'run-b1',input:{runId:'run-b1',plan,parameters:{},seed:7,deadlineAt:Date.now()+60_000,runtimeImage:'compiler-local:0.1.0'},status:'completed',errorCode:null,createdAt:1,updatedAt:2,result:null} as SimulationRecord;
 const compiler={...plan.compiler!,resultSha256:'a'.repeat(64),stopReason:'duration'};
 const token=await simulationToken(run.input),nativeObservation={schemaVersion:1,runId:run.runId,token,filesSha256:modelVersion(plan).filesSha256,child:{pid:12,startTicks:40,uid:[10001,10001,10001,10001],gid:[10001,10001,10001,10001],noNewPrivileges:1,rlimitAS:[536870912,536870912],rlimitNPROC:[64,64],pidfd:'unobserved',network:{seccompMode:2,childSetupAcknowledged:true,specificFilterObserved:false,platformFallbackConfigured:false}},stop:{confirmationId:await digest('simulation-stop:'+token),observedAt:10,fenced:true},sealed:true,quiescent:true};
 run.result=await publishSimulationResult(bucket,run,{exitCode:0,pythonVersion:'3.14.2',nativeObservation,result:{schemaVersion:2,metrics:{completed_sorties:2,cancelled_sorties:0},compiler}});
 const snapshot:ResearchSnapshot={schemaVersion:1,exportId:'compiler-export',createdAt:1,scope,current:source,runs:[run],groups:[],claims:[],assessments:[]};
 const ports={source:async()=>archive,artifact:async(key:string)=>objects.get(key)??null,authorize:async()=>{}};
 const output=await buildResearchExport(snapshot,ports),entry=output.manifest.sources[0]!;
 assert.deepEqual(entry.compiler,plan.compiler);assert.equal('lockPath' in entry,false);
 const files=unzipSync(output.bytes);assert.deepEqual(files[entry.archivePath],archive);
 assert.deepEqual(JSON.parse(new TextDecoder().decode(files[entry.compilerPath!])),plan.compiler);
 assert.equal(JSON.parse(new TextDecoder().decode(files[entry.compilerRuntimePath!])).compiler.wheelSha256,'e7bcd9271dd42106b78e87176e3485b290536f5291c0440872b814fc549858f7');
 const persisted=JSON.parse(new TextDecoder().decode(files[output.manifest.runs[0]!.resultPath!]));
 assert.equal(persisted.compiler.planFingerprint,plan.compiler!.planFingerprint);
 assert.equal(persisted.compiler.bundleSha256,plan.compiler!.bundleSha256);
 assert.equal(persisted.compiler.resultSha256,compiler.resultSha256);
 assert.deepEqual(persisted.nativeObservation,nativeObservation);
 const rows=new Map<string,unknown>();const storage={get:async(key:string)=>rows.get(key),put:async(key:string,value:unknown)=>{rows.set(key,value);},list:async({prefix}:{prefix:string})=>new Map([...rows].filter(([key])=>key.startsWith(prefix))),transaction:async(fn:Function)=>fn(storage),sync:async()=>{}} as unknown as DurableObjectStorage;
 const ledger=new EvidenceLedger(storage,scope,{run:async()=>run,group:async()=>{throw Error('unused');},artifact:async(key:string)=>objects.get(key)??null,source:async()=>archive});
 const claim=await ledger.create({schemaVersion:1,kind:'run',runId:run.runId,metric:'completed_sorties'},{userId:'user',authVersion:1});
 assert.equal(claim.value,2);assert.equal((await ledger.get(claim.claimId,modelVersion(plan))).evidenceValidity,'verified');
 await assert.rejects(buildResearchExport({...snapshot,runs:[{...run,result:{...run.result!,compiler:{...compiler,planFingerprint:'0'.repeat(64)}}}]},ports),/export-source-mismatch/);
 const missingObservation={...persisted};delete missingObservation.nativeObservation;
 const missingBytes=new TextEncoder().encode(JSON.stringify(missingObservation)),missingHash=await digest(missingBytes);
 run.result.artifactSha256=missingHash;objects.set(`simulation-results-v1/${scope.tenantId}/${scope.projectId}/${scope.workspaceId}/${run.runId}/${missingHash}.json`,missingBytes);
 assert.equal((await ledger.get(claim.claimId,modelVersion(plan))).evidenceValidity,'unavailable');
 await assert.rejects(buildResearchExport(snapshot,ports),/export-source-mismatch/);
});

test('real v0.1 result exports and replays with the fixed summary observation', {skip:!process.env.COMPILER_V01_PYTHON},async t=>{
 const python=process.env.COMPILER_V01_PYTHON!,dir=mkdtempSync(join(tmpdir(),'compiler-export-replay-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const root=new URL('../fixtures/compiler-v01/model/',import.meta.url),model=join(dir,'source','model');mkdirSync(model,{recursive:true});
 const spec=readFileSync(new URL('model-spec.json',root)),business=readFileSync(new URL('business-ir.json',root)),bundle=readFileSync(new URL('model.simpack',root));
 writeFileSync(join(model,'model-spec.json'),spec);writeFileSync(join(model,'business-ir.json'),business);writeFileSync(join(model,'model.simpack'),bundle);
 const archive=initialWorkspaceArchive({'model/model-spec.json':spec,'model/business-ir.json':business,'model/model.simpack':bundle});
 const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1};
 const source={kind:'saved-turn' as const,identity:{scope,sessionId:'session',turnId:'turn',dispatchId:'dispatch',generation:1},revision:{revisionId:'revision',objectKey:'object',filesSha256:await digest(archive),sessionSha256:'a'.repeat(64),committedAt:1}};
 const plan=await simulationPlan(source,archive),runId='run-b1',input=join(dir,'input.json'),output=join(dir,'result.json');
 writeFileSync(input,JSON.stringify({schemaVersion:2,runId,businessIr:'model/business-ir.json',businessSha256:plan.businessSha256,bundle:'model/model.simpack',bundleSha256:plan.bundleSha256,executionProfile:plan.executionProfile,parameters:{},seed:7}));
 execFileSync(python,[new URL('../../services/run/compiler_model_adapter.py',import.meta.url).pathname,'--input',input,'--output',output,'--workspace',join(dir,'source')]);
 const result=JSON.parse(readFileSync(output,'utf8')),objects=new Map<string,Uint8Array>();
 const bucket={put:async(key:string,body:string)=>{objects.set(key,new TextEncoder().encode(body));},get:async(key:string)=>{const bytes=objects.get(key);return bytes?{size:bytes.length,text:async()=>new TextDecoder().decode(bytes)}:null;}} as unknown as R2Bucket;
 const run={scope,experimentId:runId,runId,input:{runId,plan,parameters:{},seed:7,deadlineAt:Date.now()+60_000,runtimeImage:'compiler-local:0.1.0'},status:'completed',errorCode:null,createdAt:1,updatedAt:2,result:null} as SimulationRecord;
 const token=await simulationToken(run.input),nativeObservation={schemaVersion:1,runId,token,filesSha256:modelVersion(plan).filesSha256,child:{pid:12,startTicks:40,uid:[10001,10001,10001,10001],gid:[10001,10001,10001,10001],noNewPrivileges:1,rlimitAS:[536870912,536870912],rlimitNPROC:[64,64],pidfd:'unobserved',network:{seccompMode:2,childSetupAcknowledged:true,specificFilterObserved:false,platformFallbackConfigured:false}},stop:{confirmationId:await digest('simulation-stop:'+token),observedAt:10,fenced:true},sealed:true,quiescent:true};
 run.result=await publishSimulationResult(bucket,run,{exitCode:0,pythonVersion:'3.14.2',nativeObservation,result});
 const snapshot:ResearchSnapshot={schemaVersion:1,exportId:'compiler-real',createdAt:1,scope,current:source,runs:[run],groups:[],claims:[],assessments:[]};
 const packageBytes=(await buildResearchExport(snapshot,{source:async()=>archive,artifact:async(key:string)=>objects.get(key)??null,authorize:async()=>{}})).bytes;
 const unpacked=join(dir,'export');for(const [name,bytes] of Object.entries(unzipSync(packageBytes))){const target=join(unpacked,name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);}
 const report=JSON.parse(execFileSync(python,[join(unpacked,'replay.py'),'--run',runId],{encoding:'utf8'}));
 assert.equal(report.matches,true);assert.equal(report.metrics.completed_sorties.actual,2);assert.equal(report.metrics.cancelled_sorties.actual,0);
});
