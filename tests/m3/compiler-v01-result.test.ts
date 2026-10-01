import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {digest,modelVersion,simulationPlan} from '../../services/simulation/source.ts';
import {simulationToken} from '../../services/simulation/native.ts';
import {publicExperiment,publishSimulationResult,type SimulationRecord} from '../../services/simulation/host.ts';

async function record():Promise<SimulationRecord>{
 const root=new URL('../fixtures/compiler-v01/model/',import.meta.url);
 const archive=initialWorkspaceArchive({'model/model-spec.json':readFileSync(new URL('model-spec.json',root)),'model/business-ir.json':readFileSync(new URL('business-ir.json',root)),'model/model.simpack':readFileSync(new URL('model.simpack',root))});
 const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1};
 const source={kind:'saved-turn' as const,identity:{scope,sessionId:'s',turnId:'t',dispatchId:'d',generation:1},revision:{revisionId:'revision',objectKey:'opaque',filesSha256:await digest(archive),sessionSha256:'a'.repeat(64),committedAt:1}};
 const plan=await simulationPlan(source,archive);
 return {scope,runId:'run-b1',experimentId:'run-b1',input:{runId:'run-b1',plan,parameters:{},seed:7,deadlineAt:Date.now()+60000,runtimeImage:'image'},status:'completed',createdAt:1,updatedAt:2,result:null} as SimulationRecord;
}
async function observation(r:SimulationRecord){
 const token=await simulationToken(r.input);
 return {schemaVersion:1,runId:r.runId,token,filesSha256:modelVersion(r.input.plan).filesSha256,child:{pid:12,startTicks:40,uid:[10001,10001,10001,10001],gid:[10001,10001,10001,10001],noNewPrivileges:1,rlimitAS:[536870912,536870912],rlimitNPROC:[64,64],pidfd:'unobserved',network:{seccompMode:2,childSetupAcknowledged:true,specificFilterObserved:false,platformFallbackConfigured:false}},stop:{confirmationId:await digest('simulation-stop:'+token),observedAt:10,fenced:true},sealed:true,quiescent:true};
}

test('compiler result keeps validated bundle/Plan identity in the durable result envelope',async()=>{
 const r=await record(),compiler={...r.input.plan.compiler!,resultSha256:'a'.repeat(64),stopReason:'duration'};
 let stored='',writes=0;
 const bucket={put:async(_key:string,body:string)=>{stored=body;writes++;},get:async()=>({size:stored.length,text:async()=>stored})} as unknown as R2Bucket;
 const raw={exitCode:0,pythonVersion:'3.14.2',nativeObservation:await observation(r),result:{schemaVersion:2,metrics:{completed_sorties:2,cancelled_sorties:0},compiler}};
 const published=await publishSimulationResult(bucket,r,raw);
 assert.equal(writes,1);assert.deepEqual(published.compiler,compiler);
 const envelope=JSON.parse(stored);assert.equal(envelope.schemaVersion,2);assert.equal(envelope.compiler.bundleId,compiler.bundleId);assert.equal(envelope.compiler.planFingerprint,compiler.planFingerprint);
 assert.equal(publicExperiment({...r,result:published},null).result?.compiler?.bundleSha256,compiler.bundleSha256);
 for(const invalid of [
  {exitCode:raw.exitCode,pythonVersion:raw.pythonVersion,result:raw.result},
  {...raw,pythonVersion:'3.11.14'},
  {...raw,result:{...raw.result,compiler:{...compiler,bundleId:'0'.repeat(64)}}},
  {...raw,result:{...raw.result,metrics:{...raw.result.metrics,stop_reason:'duration'}}},
 ])await assert.rejects(publishSimulationResult(bucket,r,invalid),/simulation-(environment-mismatch|result-invalid)/);
 assert.equal(writes,1);
});

test('real compiler adapter result crosses host publication with the frozen identity',{skip:!process.env.COMPILER_V01_NATIVE_RESULT},async()=>{
 const r=await record();
 const result=JSON.parse(readFileSync(process.env.COMPILER_V01_NATIVE_RESULT!,'utf8'));
 let stored='';
 const bucket={put:async(_key:string,body:string)=>{stored=body;},get:async()=>({size:stored.length,text:async()=>stored})} as unknown as R2Bucket;
 const published=await publishSimulationResult(bucket,r,{exitCode:0,pythonVersion:'3.14.2',nativeObservation:await observation(r),result});
 assert.deepEqual(published.metrics,{cancelled_sorties:0,completed_sorties:2});
 assert.deepEqual(published.compiler,result.compiler);
 const envelope=JSON.parse(stored);
 assert.equal(envelope.compiler.businessFingerprint,r.input.plan.compiler?.businessFingerprint);
 assert.equal(envelope.compiler.planFingerprint,r.input.plan.compiler?.planFingerprint);
 assert.equal(envelope.compiler.stopReason,'duration');
});
