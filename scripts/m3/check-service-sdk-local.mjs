import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {sourceSnapshot} from '../m0/source-inventory.mjs';

// A local-only private RPC harness. It exports the production actors, including
// the real pinned Sandbox SDK; only initial project content is a fixture.
const root=process.cwd(),runId='m3-service-sdk-'+new Date().toISOString().replace(/[^0-9]/g,'');
const directory=resolve('docs/evidence/runs',runId),stateDirectory=resolve('.local',runId);
const socketPath='unix:///Users/gaojihe/.colima/riffology-m0/docker.sock';
const proxyImage='cloudflare/proxy-everything@sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8';
const sourceBefore=sourceSnapshot(root),image='riffology-m3-service-sdk:'+runId;
const dockerEnv={...process.env,DOCKER_HOST:socketPath,DOCKER_CONFIG:resolve('.local/docker-empty')};
function docker(...args){return execFileSync('/opt/homebrew/bin/docker',args,{cwd:root,env:dockerEnv,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024}).trim();}
function python(id,source){return docker('exec',id,'python3','-c',source);}
async function bounded(promise,ms=90000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('service-sdk-validation-timeout')),ms);})]);}finally{clearTimeout(timer);}}
const program=`import os,json,subprocess,sys,errno,urllib.request,urllib.error
from pathlib import Path
from http.server import BaseHTTPRequestHandler,HTTPServer
p=Path('/run-output/start-count');p.write_text(str(int(p.read_text())+1) if p.exists() else '1')
subprocess.Popen([sys.executable,'-c','import time,signal;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(300)'],start_new_session=True)
try:
 Path('/workspace/app/new.py').write_text('bad');readonly=False
except PermissionError: readonly=True
try:
 Path('/var/lib/riffology/services/identity.json').read_text();protected=False
except PermissionError: protected=True
# The SDK daemon runs as root. Reproduce the real root-execution endpoint
# from the untrusted project UID, for IPv4 and IPv6 loopback. A 200 response,
# even with an unexpected body, must fail acceptance.
controlAttempts=[]
for host in ['127.0.0.1','[::1]']:
 try:
  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
  req=urllib.request.Request('http://'+host+':3000/api/execute',data=json.dumps(dict(command='id -u',timeoutMs=2000)).encode(),headers={'Content-Type':'application/json'},method='POST')
  with opener.open(req,timeout=3) as response:
   controlAttempts.append(dict(host=host,blocked=False,status=response.status))
 except urllib.error.HTTPError as error:
  controlAttempts.append(dict(host=host,blocked=False,status=error.code))
 except (urllib.error.URLError,PermissionError,ConnectionError,OSError) as error:
  # Record the actual failure for review. A denied connect is expected after
  # the native no-network policy; absence of an IPv6 listener alone is weaker.
  cause=error.reason if isinstance(error,urllib.error.URLError) else error
  denied=getattr(cause,'errno',None) in (errno.EPERM,errno.EACCES)
  controlAttempts.append(dict(host=host,blocked=denied,error=type(error).__name__,reason=str(error)))
controlApiBlocked=all(item['blocked'] for item in controlAttempts)
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  data=json.dumps(dict(uid=os.getuid(),readonly=readonly,protected=protected,starts=int(p.read_text()),controlApiBlocked=controlApiBlocked,controlAttempts=controlAttempts)).encode();self.send_response(200);self.end_headers();self.wfile.write(data)
 def log_message(self,*args):pass
HTTPServer(('0.0.0.0',8080),Handler).serve_forever()
`;
mkdirSync(directory,{recursive:false,mode:0o700});mkdirSync(stateDirectory,{recursive:false,mode:0o700});
const beforeContainers=new Set(docker('ps','-aq').split('\n').filter(Boolean));
const result={schemaVersion:1,runId,status:'running',scope:'local Workerd + ServiceRuntime + TenantQuota + RevisionStore/R2 + real Sandbox SDK and Docker; no Gateway, cloud or model',modelCalls:0,cloudGatePassed:false,sourceBefore,cleanup:[],externalWorkerFetches:0};
let mf,failure,imageId;
function newContainers(){return docker('ps','-aq').split('\n').filter(id=>id&&!beforeContainers.has(id)).map(id=>{const f=JSON.parse(docker('inspect',id))[0];return {id,image:f.Config.Image,imageId:f.Image};});}
try{
 const buildLog=docker('build','--platform','linux/amd64','--progress','plain','-f','services/run/Dockerfile.service','-t',image,'.');
 writeFileSync(resolve(directory,'build.log'),buildLog+'\n',{flag:'wx'});
 const inspected=JSON.parse(docker('image','inspect',image))[0];imageId=inspected.Id;
 assert.equal(inspected.Os+'/'+inspected.Architecture,'linux/amd64');result.image={tag:image,id:imageId};
 assert.equal(docker('image','inspect',proxyImage,'--format','{{.Id}}'),proxyImage.split('@')[1]);
 const runtimeImage='local/riffology-service@'+imageId;
 const entry=`
 import {ServiceRuntime} from './services/run/runtime-durable.ts';
 import {serviceRuntimeActorName} from './services/run/durable.ts';
 import {leaseReference} from './services/quota/core.ts';
 import {initialWorkspaceArchive} from './services/turn-runtime/initial-workspace-archive.ts';
 export {ServiceRuntime};
 export {ContainerProxy} from '@cloudflare/containers';
 export {ServiceSandbox} from './services/run/service-sandbox.ts';
 export {TenantQuota} from './services/quota/durable.ts';
 export {RevisionStore} from './services/turn-runtime/revision-store.ts';
 export default {async fetch(req,env){
  if(req.method!=='POST')return new Response(null,{status:404});
  try{
   const b=await req.json();let value;
   if(b.method==='seed'){
    const identity=b.identity,encode=s=>new TextEncoder().encode(s),filesArchive=initialWorkspaceArchive({
     'app/preview.json':encode(JSON.stringify({schemaVersion:1,runtime:'python',entrypoint:'app/main.py',dependencyLock:'app/requirements.lock',port:8080,healthPath:'/healthz'})),
     'app/main.py':encode(${JSON.stringify(program)}),
     'app/requirements.lock':encode(JSON.stringify({schemaVersion:1,packages:{simpy:'4.1.1'}})),
     'docs/transport-padding.txt':new Uint8Array(700000).fill(65)});
    const store=env.REVISION_STORE.getByName('workspace-revisions-v1');
    const receipt=await store.commit({identity,outcome:'completed',executionErrorCode:null,base:{workspace:null,session:null},snapshot:{identity,filesArchive,piSession:encode('private-session-not-project-content')}});
    value=await store.previewPlan({kind:'saved-turn',identity,revision:receipt});
   }else if(b.method==='acquire'){
    const r=await env.TENANT_QUOTA.getByName('tenant-quota:'+b.request.tenantId).acquire(b.request);
    if(!r.lease)throw Error('fixture-acquire-denied');value=leaseReference(r.lease);
   }else if(b.method==='dispatch')value=await env.TENANT_QUOTA.getByName('tenant-quota:'+b.lease.tenantId).dispatch(b.lease);
   else if(['start','observe','stop'].includes(b.method))value=await env.SERVICE_RUNTIME.getByName(await serviceRuntimeActorName(b.input))[b.method](b.input);
   else return new Response(null,{status:404});
   return Response.json({ok:true,value});
  }catch(e){return Response.json({ok:false,error:e.message});}
 }};`;
 const bundle=await build({stdin:{contents:entry,resolveDir:root,sourcefile:'service-sdk-validation.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const worker=runId,binding=exportName=>({type:'durable-object',worker,exportName}),text=value=>({type:'text',value});
 mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:stateDirectory,telemetry:{enabled:false},logRequests:false,
  containerEngine:{localDocker:{socketPath,containerEgressInterceptorImage:proxyImage}},workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{
   M3_SERVICE_ENABLED:text('true'),M3_SERVICE_IMAGE:text(runtimeImage),TENANT_QUOTA_CAPACITY:text('1'),TENANT_QUOTA_POLICY_VERSION:text('test-v1'),
   SERVICE_RUNTIME:binding('ServiceRuntime'),SERVICE_SANDBOX:binding('ServiceSandbox'),TENANT_QUOTA:binding('TenantQuota'),REVISION_STORE:binding('RevisionStore'),WORKSPACE_CHECKPOINTS:{type:'r2',name:runId}
  },exports:{ServiceRuntime:{type:'durable-object',storage:'sqlite'},ServiceSandbox:{type:'durable-object',storage:'sqlite',container:{imageName:image}},TenantQuota:{type:'durable-object',storage:'sqlite'},RevisionStore:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{result.externalWorkerFetches++;return new Response('outbound-disabled',{status:403});}}}}]});
 await bounded(mf.ready);
 const call=async(method,body={})=>{const r=await bounded(mf.dispatchFetch('http://service-sdk.test/',{method:'POST',body:JSON.stringify({method,...body})}));assert.equal(r.status,200);const parsed=await r.json();if(!parsed.ok)throw Error(parsed.error);return parsed.value;};
 const scope={tenantId:'tenant-sdk',projectId:'project-sdk',workspaceId:'workspace-sdk',workspaceGeneration:1};
 const identity={scope,sessionId:'session-sdk',turnId:'turn-sdk',dispatchId:'turn-dispatch-sdk',generation:1};
 const plan=await call('seed',{identity}),deadlineAt=Date.now()+300000;
 const request={tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,operation:'service-run',operationId:'dispatch-sdk',runId:'run-sdk',deadlineAt};
 const lease=await call('acquire',{request}),input={scope,spec:{plan,runtimeImage,maxDurationMs:300000},lease,reference:{runId:request.runId,runtimeId:'runtime-sdk',dispatchId:request.operationId,leaseId:lease.leaseId,generation:1,deadlineAt}};
 await assert.rejects(call('start',{input}),/lease-denied/);
 assert.equal(newContainers().filter(f=>f.imageId===imageId).length,0);
 await call('dispatch',{lease});let observation=await call('start',{input});
 for(let n=0;n<30&&observation.status!=='healthy';n++){await new Promise(r=>setTimeout(r,250));observation=await call('observe',{input});}
 assert.equal(observation.status,'healthy');
 const containers=newContainers().filter(f=>f.image===image);assert.equal(containers.length,1);const id=containers[0].id;
 const http=JSON.parse(python(id,"import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/').read().decode())"));
 assert.equal(http.uid,10001);assert.equal(http.readonly,true);assert.equal(http.protected,true);assert.equal(http.starts,1);assert.equal(http.controlApiBlocked,true,'project-reached-root-SDK-execute-endpoint');assert.deepEqual(http.controlAttempts.map(item=>item.host),['127.0.0.1','[::1]']);assert.ok(http.controlAttempts.every(item=>item.blocked));result.http=http;
 const transport=JSON.parse(python(id,"import json;from pathlib import Path;root=Path('/var/lib/riffology/archives');print(json.dumps(dict(chunks=len(list(root.glob('*.chunk.json'))),archiveBytes=next(root.glob('*.input.tar')).stat().st_size)))"));
 assert.ok(transport.chunks>=3);assert.ok(transport.archiveBytes>700000);result.transport=transport;
 assert.equal((await call('start',{input})).status,'healthy');
 assert.equal(python(id,"from pathlib import Path;print(Path('/run-output/start-count').read_text())"),'1');
 const processes=()=>JSON.parse(python(id,"import sys,json;sys.path.insert(0,'/opt/riffology');import process_quiescence as q;print(json.dumps(q.live_project_pids()))"));
 result.processesBeforeStop=processes().length;assert.ok(result.processesBeforeStop>=2);
 const stopped=await call('stop',{input});assert.equal(stopped.status,'stopped');assert.equal(stopped.stop.fenced,true);assert.deepEqual(processes(),[]);
 assert.deepEqual(await call('start',{input}),stopped);assert.deepEqual(await call('observe',{input}),stopped);assert.deepEqual(await call('stop',{input}),stopped);
 assert.equal(python(id,"from pathlib import Path;print(Path('/run-output/start-count').read_text())"),'1');
 assert.deepEqual(processes(),[]);result.stop={fenced:true,descendantsRemaining:0,lateStartRejected:true,replayed:true};
 assert.equal(result.externalWorkerFetches,0);result.status='passed';
}catch(error){failure=error;result.status='failed';result.error=String(error?.stack??error).slice(0,6000);
 // Capture the actual kernel failure and project process count. This diagnostic
 // is confined to this run's container and cannot turn a failed chain into pass.
 try{result.failureContainers=newContainers().filter(f=>f.image===image).map(f=>({...f,diagnostic:JSON.parse(python(f.id,"import subprocess,json,sys;sys.path.insert(0,'/opt/riffology');import process_quiescence as q;r=subprocess.run(['python3','-c',\"import sys;sys.path.insert(0,'/opt/riffology');import project_network_fence as f;f.install();print('fence-loaded')\"],capture_output=True,text=True);print(json.dumps(dict(projectPids=q.live_project_pids(),fenceExitCode=r.returncode,fenceStdout=r.stdout[-2000:],fenceStderr=r.stderr[-2000:])))"))}));}catch(diagnosticError){result.diagnosticError=String(diagnosticError.message);}
}
finally{
 if(mf)try{await bounded(mf.dispose(),60000);}catch(error){failure??=error;result.status='failed';result.disposeError=String(error.message);}
 try{for(const f of newContainers()){
  // Only images used by this invocation, and only containers absent at baseline.
  if(f.image!==image&&f.image!==proxyImage)continue;
  try{docker('rm','-f',f.id);result.cleanup.push({...f,removed:true});}catch(error){failure??=error;result.status='failed';result.cleanup.push({...f,removed:false});}
 }}catch(error){failure??=error;result.status='failed';result.cleanupError=String(error.message);}
 result.sourceAfter=sourceSnapshot(root);result.sourceStable=result.sourceBefore.sha256===result.sourceAfter.sha256;
 if(!result.sourceStable){failure??=Error('source-changed-during-check');result.status='failed';}
 writeFileSync(resolve(directory,'service-sdk.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({runId,status:result.status,error:result.error,sourceStable:result.sourceStable,cleanup:result.cleanup}));
}
if(failure)process.exitCode=1;
