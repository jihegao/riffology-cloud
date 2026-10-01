import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {digest,simulationPlan} from '../../services/simulation/source.ts';
import {SimulationNative,simulationToken,type SimulationInput,type SimulationSandboxApi} from '../../services/simulation/native.ts';

test('native dispatch binds the exact frozen compiler files and fixed interpreter profile',async()=>{
 const root=new URL('../fixtures/compiler-v01/model/',import.meta.url);
 const archive=initialWorkspaceArchive({'model/model-spec.json':readFileSync(new URL('model-spec.json',root)),'model/business-ir.json':readFileSync(new URL('business-ir.json',root)),'model/model.simpack':readFileSync(new URL('model.simpack',root))});
 const scope={tenantId:'t',projectId:'p',workspaceId:'w',workspaceGeneration:1};
 const source={kind:'saved-turn' as const,identity:{scope,sessionId:'s',turnId:'t',dispatchId:'d',generation:1},revision:{revisionId:'r',objectKey:'opaque',filesSha256:await digest(archive),sessionSha256:'a'.repeat(64),committedAt:1}};
 const plan=await simulationPlan(source,archive);
 const input:SimulationInput={runId:'compiler-b1',plan,parameters:{},seed:7,deadlineAt:Date.now()+60000,runtimeImage:'image'};
 const token=await simulationToken(input),writes=new Map<string,string>();
 const sandbox={writeFile:async(path:string,content:string)=>{writes.set(path,content);},exec:async(command:string)=>{
  if(command.includes('service_upload.py'))return {success:true,exitCode:0,stdout:JSON.stringify({token,offset:0,bytes:archive.length,total:archive.length,complete:true})};
  return {success:true,exitCode:0,stdout:JSON.stringify({schemaVersion:1,token,status:'running',result:null,stop:null})};
 }} as unknown as SimulationSandboxApi;
 const observation=await new SimulationNative(sandbox,input).start(archive);
 assert.equal(observation.status,'running');
 const control=JSON.parse(writes.get(`/var/lib/riffology/services/${token}.input.json`) ?? 'null');
 assert.deepEqual(Object.keys(control).sort(),['schemaVersion','token','runId','filesSha256','specSha256','businessIr','businessSha256','bundle','bundleSha256','executionProfile','parameters','seed','deadlineAt'].sort());
 assert.equal(control.schemaVersion,2);assert.equal(control.bundleSha256,plan.compiler?.bundleSha256);assert.equal(control.businessSha256,plan.businessSha256);
 assert.equal(control.executionProfile,'sim-engine-compiler-0.1.0/v1');
});
