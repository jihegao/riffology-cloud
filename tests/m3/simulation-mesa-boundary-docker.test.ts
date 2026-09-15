import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {digest,simulationPlan} from '../../services/simulation/source.ts';
import {MESA_SOURCE_PACKAGES} from '../../services/simulation/server-profile.ts';
import {dockerFenceOptions,DOCKER_FENCE_PROBE} from './simulation-docker-fence.ts';
const translated=process.env.G1_DOCKER_OUTER_NETWORK_FENCE==='1';
const enabled=process.env.M4_SIMULATION_DOCKER_TEST==='1',image=process.env.M4_SIMULATION_TEST_IMAGE||'riffology-g1-mesa:local';
const evidence=process.env.G1_SERVER_EVIDENCE_DIR||'.local/g1-server-docker',encode=(s:string)=>new TextEncoder().encode(s);
function docker(args:string[]){return execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
for(const scenario of ['isolation','cancel','deadline'] as const)test(`real Mesa interpreter retains ${scenario} boundary and cannot restart sealed execution`,{skip:!enabled,timeout:90000},async t=>{
 await mkdir(evidence,{recursive:true});const root=await mkdtemp(join(tmpdir(),'mesa-boundary-'));t.after(()=>rm(root,{recursive:true,force:true}));const token='c'.repeat(52);
 const resourceCheck=translated?"assert pathlib.Path('/sys/fs/cgroup/memory.max').read_text().strip()=='536870912'\n":"assert resource.getrlimit(resource.RLIMIT_AS)==(512*1024*1024,512*1024*1024),str(resource.getrlimit(resource.RLIMIT_AS))\n";
 const base="import argparse,json,os,pathlib,resource,socket,time\np=argparse.ArgumentParser();p.add_argument('--input');p.add_argument('--output');a=p.parse_args()\nassert os.geteuid()==10001\n"+resourceCheck+"import mesa,numpy\npathlib.Path('/run-output/child-started.txt').write_text('started')\n";
 const code=base+(scenario==='isolation'?"try:\n pathlib.Path('/workspace/model/run.py').write_text('tamper')\n raise RuntimeError('source writable')\nexcept PermissionError: pass\nfor family,kind in [(socket.AF_INET,socket.SOCK_STREAM),(socket.AF_INET,socket.SOCK_DGRAM),(socket.AF_INET6,socket.SOCK_STREAM),(socket.AF_UNIX,socket.SOCK_STREAM)]:\n try:\n  socket.socket(family,kind)\n  raise RuntimeError('network permitted')\n except PermissionError: pass\npathlib.Path(a.output).write_text(json.dumps({'schemaVersion':1,'metrics':{'value':4}}))\n":"time.sleep(120)\npathlib.Path(a.output).write_text(json.dumps({'schemaVersion':1,'metrics':{'value':1}}))\n");
 const spec={schemaVersion:1,researchQuestion:'Boundary?',scope:'finite',entities:[],mechanisms:[],assumptions:[],parameters:{},metrics:{value:{}},limitations:[],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
 const bytes=initialWorkspaceArchive({'model/run.py':encode(code),'model/model-spec.json':encode(JSON.stringify(spec)),'app/requirements.lock':encode(JSON.stringify({schemaVersion:1,packages:MESA_SOURCE_PACKAGES}))});const scope={tenantId:'t',projectId:'p',workspaceId:'w',workspaceGeneration:1};
 const source={kind:'saved-turn' as const,identity:{scope,sessionId:'s',turnId:'turn',dispatchId:'d',generation:1},revision:{revisionId:'r',objectKey:'opaque',filesSha256:await digest(bytes),sessionSha256:'a'.repeat(64),committedAt:1}},plan=await simulationPlan(source,bytes);
 const control={schemaVersion:1,token,runId:'boundary-'+scenario,filesSha256:await digest(bytes),specSha256:plan.specSha256,entrypoint:spec.execution.entrypoint,entrypointSha256:plan.entrypointSha256,dependencyLock:spec.execution.dependencyLock,dependencyLockSha256:plan.dependencyLockSha256,parameters:{},seed:0,deadlineAt:Date.now()+(scenario==='deadline'?20000:60000)};
 await writeFile(join(root,'source.tar'),bytes);await writeFile(join(root,'control.json'),JSON.stringify(control));const container=docker(['run','-d','--platform','linux/amd64','--network','none',...dockerFenceOptions(),...(translated?['--memory=512m','--memory-swap=512m']:[]),'--entrypoint','/bin/sh',image,'-c','sleep 90']);t.after(()=>{try{docker(['rm','-f',container]);}catch{}});
 if(process.env.G1_DOCKER_OUTER_NETWORK_FENCE==='1')assert.equal(JSON.parse(docker(['exec',container,'python3','-c',DOCKER_FENCE_PROBE])).noNewPrivileges,true);
 docker(['cp',join(root,'source.tar'),`${container}:/var/lib/riffology/archives/${token}.input.tar`]);docker(['cp',join(root,'control.json'),`${container}:/var/lib/riffology/services/${token}.input.json`]);docker(['exec',container,'python3','/opt/riffology/simulation_process.py','start',token]);
 let childStarted=false;for(let i=0;i<80;i++){const probe=spawnSync('docker',['exec',container,'test','-f','/run-output/child-started.txt']);if(probe.status===0){childStarted=true;break;}await new Promise(r=>setTimeout(r,100));}let stderr='';try{stderr=docker(['exec',container,'cat',`/var/lib/riffology/services/${token}.stderr.log`]);}catch{};assert.equal(childStarted,true,'must exercise a live child, not an ambiguous/preexec failure: '+stderr);
 if(scenario==='cancel')docker(['exec',container,'python3','/opt/riffology/simulation_process.py','stop',token]);let observed;for(let i=0;i<150;i++){observed=JSON.parse(docker(['exec',container,'python3','/opt/riffology/simulation_process.py','observe',token]));if(observed.status==='stopped')break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(observed.status,'stopped');assert.equal(observed.stop.fenced,true);if(scenario==='isolation'){assert.equal(observed.result.exitCode,0);assert.equal(observed.result.pythonVersion,'3.14.2');assert.equal(observed.result.result.metrics.value,4);}else assert.notEqual(observed.result?.exitCode,0);
 const live=JSON.parse(docker(['exec',container,'python3','-c',"import sys,json;sys.path.insert(0,'/opt/riffology');import process_quiescence as f;print(json.dumps(f.live_project_pids()))"]));assert.deepEqual(live,[]);
 let memoryProbe=null;if(translated&&scenario==='isolation'){
  const oom=spawnSync('docker',['exec',container,'/opt/riffology/python-mesa/bin/python3','-c','allocation=bytearray(768*1024*1024);print(len(allocation))'],{encoding:'utf8',timeout:20000});
  const memoryEvents=docker(['exec',container,'cat','/sys/fs/cgroup/memory.events']);
  assert.equal(oom.status,137,'bounded oversized child must be killed by host memory cap');assert.match(memoryEvents,/oom_kill [1-9][0-9]*/);
  const afterOom=JSON.parse(docker(['exec',container,'python3','/opt/riffology/simulation_process.py','observe',token]));assert.equal(afterOom.stop.confirmationId,observed.stop.confirmationId);
  memoryProbe={exitCode:oom.status,memoryEvents,rootReconciled:true};
 }
 const repeated=JSON.parse(docker(['exec',container,'python3','/opt/riffology/simulation_process.py','start',token]));assert.equal(repeated.status,'stopped');assert.equal(repeated.stop.confirmationId,observed.stop.confirmationId);
 await writeFile(join(evidence,`mesa-${scenario}-boundary.json`),JSON.stringify({image,scenario,translated,resourceScope:translated?'host-cgroup-resident-memory-cap-only':'child-inherited-RLIMIT_AS',childStarted,memoryProbe,filesSha256:control.filesSha256,deadlineAt:control.deadlineAt,observed,liveProjectPids:live},null,2));
});
