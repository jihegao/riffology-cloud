import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {digest,simulationPlan} from '../../services/simulation/source.ts';
import {MESA_SERVER_PROFILE,MESA_SOURCE_PACKAGES} from '../../services/simulation/server-profile.ts';
const encode=(s:string)=>new TextEncoder().encode(s);
const scope={tenantId:'t',projectId:'p',workspaceId:'w',workspaceGeneration:1};
const spec={schemaVersion:1,researchQuestion:'Shared model?',scope:'finite',entities:[],mechanisms:[],assumptions:[],parameters:{steps:{type:'integer',default:2}},metrics:{count:{}},limitations:[],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
async function plan(packages:Record<string,string>){const bytes=initialWorkspaceArchive({'model/run.py':encode('print("fixture")\n'),'model/model-spec.json':encode(JSON.stringify(spec)),'app/requirements.lock':encode(JSON.stringify({schemaVersion:1,packages}))});return simulationPlan({kind:'saved-turn',identity:{scope,sessionId:'s',turnId:'turn',dispatchId:'d',generation:1},revision:{revisionId:'r',objectKey:'opaque',filesSha256:await digest(bytes),sessionSha256:'a'.repeat(64),committedAt:1}},bytes);}
test('native environment, source profile and hash requirements use one exact frozen dependency closure',async()=>{
 const json=JSON.parse(await readFile('services/run/mesa-cpython-profile.json','utf8'));assert.deepEqual(json,MESA_SERVER_PROFILE);
 assert.equal(MESA_SERVER_PROFILE.dependencies.length,8);assert.equal(Object.keys(MESA_SOURCE_PACKAGES).length,6);
 assert.equal(await readFile('services/run/mesa-cpython-requirements.txt','utf8'),MESA_SERVER_PROFILE.dependencies.map(p=>`${p.name}==${p.version} --hash=sha256:${p.sha256}`).join('\n')+'\n');
 assert.equal(MESA_SERVER_PROFILE.pythonVersion,'3.14.2');
});
test('exact Mesa source lock selects isolated 3.14 environment without changing historical empty and SimPy plans',async()=>{
 assert.deepEqual((await plan({...MESA_SOURCE_PACKAGES})).executionProfile,MESA_SERVER_PROFILE);
 assert.equal(Object.hasOwn(await plan({}),'executionProfile'),false);assert.equal(Object.hasOwn(await plan({simpy:'4.1.1'}),'executionProfile'),false);
 for(const packages of ([{mesa:'3.5.1'},{...MESA_SOURCE_PACKAGES,numpy:'2.4.5'},{...MESA_SOURCE_PACKAGES,extra:'1'}] as Record<string,string>[]))await assert.rejects(plan(packages),/model-dependencies-unsupported/);
});

test('publication rejects mismatched native Python before storing a Mesa result',async()=>{
 const {publishSimulationResult}=await import('../../services/simulation/host.ts');
 const p=await plan({...MESA_SOURCE_PACKAGES});let writes=0,body='';const bucket={put:async(_key:string,value:string)=>{writes++;body=value;},get:async()=>({size:body.length,text:async()=>body})} as unknown as R2Bucket;
 const record={runId:'run',experimentId:'run',scope,input:{plan:p,parameters:{steps:2},seed:7,runtimeImage:'image@sha256:fixed'}} as unknown as import('../../services/simulation/host.ts').SimulationRecord;
 await assert.rejects(publishSimulationResult(bucket,record,{exitCode:0,pythonVersion:'3.11.14',result:{schemaVersion:1,metrics:{count:2}}}),/simulation-environment-mismatch/);assert.equal(writes,0);
 await publishSimulationResult(bucket,record,{exitCode:0,pythonVersion:'3.14.2',result:{schemaVersion:1,metrics:{count:2}}});assert.equal(writes,1);
});
