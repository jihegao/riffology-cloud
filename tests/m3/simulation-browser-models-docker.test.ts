import type {ParameterValues} from '../../services/simulation/model-spec.ts';
import {dockerFenceOptions,DOCKER_FENCE_PROBE} from './simulation-docker-fence.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {simulationPlan,digest} from '../../services/simulation/source.ts';
import {publishSimulationResult,type SimulationRecord} from '../../services/simulation/host.ts';
import {buildResearchExport} from '../../services/research/export.ts';
import {productionPreviewRegistry} from '../../services/browser-preview/production-registry.ts';
import {validateSavedPreview} from '../../services/browser-preview/validator.ts';
import {packageCompatiblePreview,unpackPreviewPackage} from '../../services/browser-preview/packager.ts';
const enabled=process.env.M4_SIMULATION_DOCKER_TEST==='1',image=process.env.M4_SIMULATION_TEST_IMAGE||'riffology-g1-mesa:local';
const evidence=process.env.G1_SERVER_EVIDENCE_DIR||'.local/g1-server-docker';
const encode=(s:string)=>new TextEncoder().encode(s);
function docker(args:string[]){return execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1};
for(const name of ['mesa','queue'] as const)test(`real frozen ${name} shared source runs with fenced server profile and independently replays`,{skip:!enabled,timeout:120000},async t=>{
 const imageIdentity=JSON.parse(docker(['image','inspect',image]))[0].Id;
 const {mkdir}=await import('node:fs/promises');await mkdir(evidence,{recursive:true});const root=await mkdtemp(join(tmpdir(),'g1-shared-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const fixturePath='../../services/browser-preview/runtime/fixtures.mjs';
 const {makeFixture}:{makeFixture:(profile:import('../../services/browser-preview/profiles.ts').TrustedPreviewProfile,name:string)=>Promise<{files:{path:string;base64:string}[]}>}=await import(fixturePath);
 const registry=await productionPreviewRegistry(),profileId=name==='mesa'?'mesa-3.5.1/v1':'python-stdlib/v1';
 const profile=registry.resolve(profileId);assert.ok(profile);
 const fixture=await makeFixture(profile,name);
 const frozenFiles=Object.fromEntries(fixture.files.map((file:{path:string;base64:string})=>[file.path,Buffer.from(file.base64,'base64')]));
 const archive=initialWorkspaceArchive(frozenFiles);
 const compatibility=await validateSavedPreview({projectId:scope.projectId,revisionId:'frozen-revision',filesSha256:await digest(archive)},archive,profileId,registry);
 assert.equal(compatibility.status,'compatible');if(compatibility.status!=='compatible')throw Error('fixture-incompatible');
 const packaged=await packageCompatiblePreview(compatibility.value),unpacked=await unpackPreviewPackage(packaged.bytes);
 assert.equal(unpacked.files.size,5);assert.deepEqual(unpacked.files.get('model/model.py'),new Uint8Array(frozenFiles['model/model.py']));
 const model=frozenFiles['model/model.py'],wrapper=frozenFiles['model/run.py'];
 assert.equal(await digest(wrapper),await digest(await readFile('services/run/model_run_adapter.py')));
 const parameters:ParameterValues=name==='mesa'?{steps:12,width:20,height:14,density:0.82,minority_fraction:0.35,homophily:0.5}:{servers:2,customers:30,arrival_rate:0.8,service_rate:1};
 const spec=JSON.parse(Buffer.from(frozenFiles['model/model-spec.json']).toString()),metrics=spec.metrics;
 const source={kind:'saved-turn' as const,identity:{scope,sessionId:'session',turnId:'turn',dispatchId:'dispatch',generation:1},revision:{revisionId:'frozen-revision',objectKey:'opaque',filesSha256:await digest(archive),sessionSha256:'a'.repeat(64),committedAt:1}};
 const plan=await simulationPlan(source,archive),token='b'.repeat(52),runId=`server-${name}`;
 await writeFile(join(root,'source.tar'),archive);
 const control={schemaVersion:1,token,runId,filesSha256:await digest(archive),specSha256:plan.specSha256,entrypoint:spec.execution.entrypoint,entrypointSha256:plan.entrypointSha256,dependencyLock:spec.execution.dependencyLock,dependencyLockSha256:plan.dependencyLockSha256,parameters,seed:7,deadlineAt:Date.now()+90000};
 await writeFile(join(root,'control.json'),JSON.stringify(control));const container=docker(['run','-d','--platform','linux/amd64','--network','none',...dockerFenceOptions(),'--entrypoint','/bin/sh',image,'-c','sleep 120']);t.after(()=>{try{docker(['rm','-f',container]);}catch{}});
 if(process.env.G1_DOCKER_OUTER_NETWORK_FENCE==='1'){const probe=JSON.parse(docker(['exec',container,'python3','-c',DOCKER_FENCE_PROBE]));await writeFile(join(evidence,`${name}-kernel-network-fence.json`),JSON.stringify(probe,null,2));}
 docker(['cp',join(root,'source.tar'),`${container}:/var/lib/riffology/archives/${token}.input.tar`]);docker(['cp',join(root,'control.json'),`${container}:/var/lib/riffology/services/${token}.input.json`]);
 const start=JSON.parse(docker(['exec',container,'python3','/opt/riffology/simulation_process.py','start',token]));let observed=start;
 for(let i=0;i<150&&observed.status!=='stopped';i++){await new Promise(r=>setTimeout(r,200));observed=JSON.parse(docker(['exec',container,'python3','/opt/riffology/simulation_process.py','observe',token]));}
 let stderr='';try{stderr=docker(['exec',container,'cat',`/var/lib/riffology/services/${token}.stderr.log`]);}catch{}
 await writeFile(join(evidence,`${name}-native.json`),JSON.stringify({image,imageIdentity,sourceSha256:await digest(model),wrapperSha256:await digest(wrapper),archiveSha256:await digest(archive),specSha256:plan.specSha256,seed:control.seed,parameters,observed,stderr},null,2));
 assert.equal(observed.status,'stopped');assert.equal(observed.stop.fenced,true);assert.equal(observed.result?.exitCode,0,JSON.stringify(observed)+'\n'+stderr);assert.equal(observed.result.pythonVersion,name==='mesa'?'3.14.2':'3.11.14');
 const result=observed.result.result;assert.deepEqual(Object.keys(result.metrics).sort(),Object.keys(metrics).sort());
 for(const output of result.outputs){assert.equal(await digest(Buffer.from(output.data,'base64')),output.sha256);assert.ok(output.size<=16384);}
 assert.ok(result.outputs.some((output:{path:string})=>output.path==='summary.json'));
 // Replay the same frozen model directly under both installed interpreters;
 // server receipt remains authoritative, direct traces are comparison evidence.
 const evaluate="import sys,json,importlib.util;spec=importlib.util.spec_from_file_location('shared','/workspace/model/model.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);print(json.dumps(m.run(json.loads(sys.argv[1])),sort_keys=True,separators=(',',':'),allow_nan=False))";
 const config=JSON.stringify({parameters,seed:control.seed});const interpreter=name==='mesa'?'/opt/riffology/python-mesa/bin/python3':'python3';
 const trace=JSON.parse(docker(['exec','-e','OPENBLAS_NUM_THREADS=1',container,interpreter,'-c',evaluate,config]));assert.deepEqual(trace.snapshots.at(-1).metrics,result.metrics);
 const repeat=JSON.parse(docker(['exec',container,interpreter,'-c',evaluate,config]));assert.deepEqual(trace,repeat);
 if(name==='queue'){const newer=JSON.parse(docker(['exec',container,'/opt/riffology/python-mesa/bin/python3','-c',evaluate,config]));assert.deepEqual(newer,trace);}
 await writeFile(join(evidence,`${name}-recomputed-trace.json`),JSON.stringify(trace,null,2));
 if(process.env.G1_BROWSER_TRACE_DIR){const browser=JSON.parse(await readFile(join(process.env.G1_BROWSER_TRACE_DIR,`${name}.json`),'utf8'));assert.deepEqual(trace,browser,'exact same-source same-input real Browser/native trace parity');}
 await writeFile(join(evidence,`${name}-package.json`),JSON.stringify({manifest:packaged.manifest,packageSha256:packaged.sha256,browserTraceCompared:Boolean(process.env.G1_BROWSER_TRACE_DIR)},null,2));
 const again=JSON.parse(docker(['exec',container,'python3','/opt/riffology/simulation_process.py','start',token]));assert.deepEqual(again.result,observed.result);
 const objects=new Map<string,Uint8Array>();const bucket={put:async(key:string,value:string|Uint8Array)=>{objects.set(key,typeof value==='string'?encode(value):Uint8Array.from(value));},get:async(key:string)=>{const bytes=objects.get(key);return bytes?{size:bytes.byteLength,text:async()=>new TextDecoder().decode(bytes),arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}} as unknown as R2Bucket;
 const record={runId,experimentId:runId,scope,actor:{userId:'user',authVersion:1},key:'intent',requestJson:'{}',input:{runId,plan,parameters,seed:control.seed,deadlineAt:control.deadlineAt,runtimeImage:image},status:'completed',createdAt:1,updatedAt:2,cancelledAt:null,errorCode:null,attempt:0,quotaClaimed:false,releaseProof:null,lease:null,startClaimed:true,stop:null,result:null,releaseBegunAt:null,quietSince:null,released:true} as SimulationRecord;
 record.result=await publishSimulationResult(bucket,record,observed.result);
 const exported=await buildResearchExport({schemaVersion:1,exportId:'docker-export',createdAt:1,scope,current:source,runs:[record],groups:[],claims:[],assessments:[]},{source:async()=>archive,artifact:async key=>objects.get(key)??null,authorize:async()=>{}});
 await writeFile(join(root,'research.zip'),exported.bytes);docker(['cp',join(root,'research.zip'),`${container}:/tmp/research.zip`]);docker(['exec',container,'python3','-c',"import zipfile;zipfile.ZipFile('/tmp/research.zip').extractall('/tmp/replay')"]);
 const replay=JSON.parse(docker(['exec','-e','OPENBLAS_NUM_THREADS=1',container,interpreter,'/tmp/replay/replay.py','--run',runId]));assert.equal(replay.matches,true);assert.equal(replay.pythonVersion,observed.result.pythonVersion);
 await writeFile(join(evidence,`${name}-replay.json`),JSON.stringify({manifest:exported.manifest,report:replay},null,2));

});
