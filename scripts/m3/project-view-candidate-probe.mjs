// Explicit local derived-image experiment. No pull/build, cloud or user identity.
import {spawn} from 'node:child_process';
import {Readable,Writable} from 'node:stream';
import {MessageChannel} from 'node:worker_threads';
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {containerArgs,dockerRunner} from './project-view-offline-prototype.mjs';
import {createProjectViewRuntimePipe,PROJECT_VIEW_BROWSER_PROGRAM} from '../../services/project-views/runtime-pipe.mjs';
import {PROJECT_VIEW_PREFLIGHT_PROGRAM,readProjectViewPreflight} from '../../services/project-views/runtime-preflight.mjs';
import {createProjectViewBroker,verifyProjectViewPackage} from '../../services/web/project-views.js';

const SOCKET='unix:///var/run/docker.sock',LABEL='io.riffoid.candidate-view.operation',LEGACY_LABEL='io.riffoid.offline-view.operation';
const PROFILE=fileURLToPath(new URL('./offline-view/chromium-userns-seccomp.json',import.meta.url));
const PROFILE_SHA='4cdcdc07d9676737fa78222a8fffeda5cd0ebd2b209c82fafd2077d051d30ae2';
const KEEPALIVE='process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,IMAGE=/^sha256:[a-f0-9]{64}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const bounded=async(work,ms,code)=>{let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),ms);})]);}finally{clearTimeout(timer);}};
const sleep=ms=>new Promise(resolveDelay=>setTimeout(resolveDelay,ms));
const fail=code=>{throw Error('candidate-probe-'+code);};
const okay=result=>!result.error&&result.status===0&&typeof result.stdout==='string';
const cli=(runner,args,options={})=>runner(['--host',SOCKET,...args],{timeout:15000,maxBuffer:1024*1024,...options});
function executablePath(value){if(typeof value!=='string'||value.length>1024||!value.length||value.split(':').some(part=>! /^\/[A-Za-z0-9_+./-]+$/.test(part)||part.slice(1).split('/').some(segment=>!segment||segment==='.'||segment==='..')))fail('image-path');return value;}

/** Reuse the reviewed flags without inheriting its experimental HOME override. */
export function candidateContainerArgs(image,operationId,profile=PROFILE){
 if(!IMAGE.test(image)||!UUID.test(operationId))fail('identity');
 const args=containerArgs(image,'riffoid-view-'+operationId,KEEPALIVE),index=args.indexOf('--env');
 if(index<0||args[index+1]!=='HOME=/tmp'||args.filter(value=>value==='--env').length!==1)fail('launcher-environment-drift');
 args.splice(index,2);
 args.splice(args.indexOf('--network=none'),0,'--label',LABEL+'='+operationId,'--cpuset-cpus=0,1','--security-opt','seccomp='+profile);
 if(args.some(value=>value==='--env'||value.startsWith('--env=')||value.startsWith('HOME=')))fail('environment-override');
 return args;
}
export function candidateExecArgs(containerId,program,path,argument){
 if(!/^[a-f0-9]{64}$/.test(containerId)||![PROJECT_VIEW_BROWSER_PROGRAM,PROJECT_VIEW_PREFLIGHT_PROGRAM].includes(program))fail('exec-identity');
 if(program===PROJECT_VIEW_PREFLIGHT_PROGRAM?!/^[a-f0-9]{64}$/.test(argument??''):argument!==undefined)fail('exec-argument');
 return ['--host',SOCKET,'exec',...(program===PROJECT_VIEW_BROWSER_PROGRAM?['--interactive']:[]),'--user','10001:10001','--workdir','/opt/viewer',containerId,'/usr/bin/env','-i','PATH='+executablePath(path),'node','--input-type=module','-e',program,...(argument===undefined?[]:[argument])];
}
export function validateCandidateImage(actual,image){
 if(actual?.Id!==image||actual.Architecture!=='amd64'||actual.Os!=='linux'||actual.Config?.User!=='10001:10001'||actual.Config?.WorkingDir!=='/opt/viewer'||!Array.isArray(actual.Config.Env)||actual.Config.Env.some(value=>typeof value!=='string'||value.startsWith('HOME=')))fail('image-config');
 const paths=actual.Config.Env.filter(value=>value.startsWith('PATH='));if(paths.length!==1)fail('image-path');
 return {id:actual.Id,architecture:actual.Architecture,os:actual.Os,user:actual.Config.User,cwd:actual.Config.WorkingDir,path:executablePath(paths[0].slice(5)),homeEnvironmentPresent:false};
}
function original(record){
 if(record?.schema!=='riffology.candidate-view-probe/v1'||!UUID.test(record.operationId??'')||record.containerName!=='riffoid-view-'+record.operationId||!IMAGE.test(record.image??'')||typeof record.runAttempted!=='boolean'||record.containerId!==undefined&&!/^[a-f0-9]{64}$/.test(record.containerId))fail('original-identity');
}
function containerIdentity(actual,record){
 original(record);
 if(!/^[a-f0-9]{64}$/.test(actual?.Id??'')||actual.Name!=='/'+record.containerName||actual.Image!==record.image||actual.Config?.Labels?.[LABEL]!==record.operationId||actual.Config?.Labels?.[LEGACY_LABEL]!==record.operationId||record.containerId!==undefined&&actual.Id!==record.containerId)fail('container-identity');
}
export function validateCandidateContainer(actual,record,profileBytes){
 containerIdentity(actual,record);const hc=actual.HostConfig;
 if(actual.Config.User!=='10001:10001'||actual.Config.WorkingDir!=='/opt/viewer'||!Array.isArray(actual.Config.Env)||actual.Config.Env.some(value=>typeof value!=='string')||hc?.NetworkMode!=='none'||hc.ReadonlyRootfs!==true||hc.Privileged!==false||(hc.CapAdd?.length??0)!==0||!hc.CapDrop?.includes('ALL')||hc.Memory!==805306368||hc.NanoCpus!==1000000000||hc.CpusetCpus!=='0,1'||hc.PidsLimit!==128||hc.ShmSize!==134217728||hc.IpcMode==='host'||hc.PidMode==='host'||Object.keys(hc.PortBindings??{}).length||(hc.Binds?.length??0)||(actual.Mounts?.length??-1)!==0||!Array.isArray(hc.SecurityOpt)||hc.SecurityOpt.length!==2||!hc.SecurityOpt.some(value=>value==='no-new-privileges'||value==='no-new-privileges=true')||!hc.SecurityOpt.some(value=>value.startsWith('seccomp=')&&JSON.stringify(JSON.parse(value.slice(8)))===JSON.stringify(JSON.parse(profileBytes))))fail('container-policy');
 const tmp=hc.Tmpfs?.['/tmp'];if(Object.keys(hc.Tmpfs??{}).join(',')!=='/tmp'||typeof tmp!=='string'||!['rw','nosuid','nodev','size=268435456'].every(value=>tmp.split(',').includes(value)))fail('tmpfs-policy');
 return {id:actual.Id,image:actual.Image,user:actual.Config.User,cwd:actual.Config.WorkingDir,execEnvironmentKeys:['PATH'],containerHomeEnvironmentPresent:actual.Config.Env.some(value=>value.startsWith('HOME=')),network:'none',readonlyRootfs:true,capDropAll:true,noNewPrivileges:true,memoryBytes:hc.Memory,nanoCpus:hc.NanoCpus,cpuSet:hc.CpusetCpus,pids:hc.PidsLimit,shmBytes:hc.ShmSize,tmpfs:tmp,profileSha256:hash(profileBytes)};
}
async function persist(directory,record,first=false){
 const target=resolve(directory,'candidate-evidence.json'),text=JSON.stringify(record,null,2)+'\n';
 if(first){await writeFile(target,text,{flag:'wx',mode:0o600});return;}
 const temporary=resolve(directory,'candidate-evidence-'+randomUUID()+'.tmp');
 try{await writeFile(temporary,text,{flag:'wx',mode:0o600});await rename(temporary,target);}finally{await rm(temporary,{force:true});}
}
async function listed(runner,record){
 const result=await cli(runner,['container','ls','--all','--no-trunc','--filter','label='+LABEL+'='+record.operationId,'--format','{{.ID}}']);
 if(!okay(result))fail('list-unavailable');
 const ids=result.stdout.trim()?result.stdout.trim().split('\n'):[];
 if(ids.length>1||ids.some(id=>!/^[a-f0-9]{64}$/.test(id)))fail('ambiguous-container');return ids;
}
async function originalAbsent(runner,record){
 const result=await cli(runner,['container','inspect','--format','{{json .}}',record.containerId]);
 // An unavailable daemon, a truncated response, or an empty successful list
 // is not proof. Docker's explicit not-found result must name this exact ID.
 const escaped=record.containerId;
 if(result.error||result.status!==1||result.stdout!==''||typeof result.stderr!=='string'||!new RegExp('^(?:Error:|Error response from daemon:) No such container: '+escaped+'\\n?$').test(result.stderr))fail('original-absence-unconfirmed');
 return true;
}
async function cleanupOriginal(directory,record,runner){
 original(record);
 if(!record.runAttempted)return {confirmed:true,proof:'never-attempted'};
 try{
  const ids=await listed(runner,record);
  if(!ids.length){if(!record.containerId)fail('create-unresolved');await originalAbsent(runner,record);return {confirmed:true,proof:'original-id-already-absent',originalIdNotFound:true,scopedListEmpty:true};}
  const inspected=await cli(runner,['container','inspect','--format','{{json .}}',ids[0]]);
  if(!okay(inspected))fail('inspect-unavailable');
  const actual=JSON.parse(inspected.stdout);containerIdentity(actual,record);record.containerId=actual.Id;await persist(directory,record);
  const removed=await cli(runner,['container','rm','--force',actual.Id]);
  record.removeObservation={exitCode:removed.status,error:removed.error?'docker-control-error':null};await persist(directory,record);
  if((await listed(runner,record)).length)fail('container-remains');
  await originalAbsent(runner,record);
  return {confirmed:true,proof:'verified-original-id-removed',originalIdNotFound:true,scopedListEmpty:true};
 }catch(error){return {confirmed:false,reason:error.message};}
}
/** Cleanup-only re-observation never creates a container or upgrades a probe. */
export async function cleanupCandidateProbe({output,operationId,runner=dockerRunner}){
 const directory=resolve(output),raw=await readFile(resolve(directory,'candidate-evidence.json'));
 if(raw.length>65536)fail('evidence-limit');
 const record=JSON.parse(raw);original(record);if(record.operationId!==operationId)fail('original-identity');
 const priorHash=hash(raw),cleanup=await cleanupOriginal(directory,record,runner);
 Object.assign(record,{status:'blocked',cleanup,cleanupConfirmed:cleanup.confirmed,cleanupRecoveredAt:new Date().toISOString(),priorEvidenceSha256:priorHash});await persist(directory,record);return record;
}

/** Docker CLI lifetime is distinct from the original container lifetime. */
export function launchCandidateProcess(args,{spawnProcess=spawn}={}){
 const child=spawnProcess('docker',args,{stdio:['pipe','pipe','pipe']}),stderr=Buffer.alloc(1024*1024),stdout=Buffer.alloc(8*1024*1024);let stderrBytes=0,stdoutBytes=0,discardedStdoutBytes=0,discardedStderrBytes=0,exitStatus=null,exitSignal=null;
 const exitCode=new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>{exitStatus=code;exitSignal=signal;yes(code);});});void exitCode.catch(()=>{});
 child.stdin.on('error',()=>{});
 child.stderr.on('data',chunk=>{const keep=Math.min(chunk.length,stderr.length-stderrBytes);if(keep>0){chunk.copy(stderr,stderrBytes,0,keep);stderrBytes+=keep;}discardedStderrBytes+=chunk.length-keep;if(keep!==chunk.length)child.kill('SIGTERM');});
 const observed=new Readable({read(){}});
 child.stdout.on('data',chunk=>{
  const keep=Math.min(chunk.length,stdout.length-stdoutBytes);if(keep>0){chunk.copy(stdout,stdoutBytes,0,keep);stdoutBytes+=keep;}discardedStdoutBytes+=chunk.length-keep;if(keep!==chunk.length)child.kill('SIGTERM');
  if(!observed.destroyed&&!observed.push(chunk))child.stdout.pause();
 });
 observed._read=()=>child.stdout.resume();child.stdout.once('end',()=>observed.push(null));child.stdout.once('error',error=>observed.destroy(error));
 return {stdin:Writable.toWeb(child.stdin),stdout:Readable.toWeb(observed),exitCode,kill:signal=>child.kill(signal),
  logs:()=>({stdout:stdout.subarray(0,stdoutBytes),stderr:stderr.subarray(0,stderrBytes),discardedStdoutBytes,discardedStderrBytes,exitStatus,exitSignal})};
}
export function candidateProbeFixture(){
 const texts={
  'app/home.html':'<!doctype html><meta charset="utf-8"><style>button,input,output{position:absolute;left:20px;width:320px;height:60px}button{top:20px}input{top:120px}output{top:220px}</style><button id="counter">SYNTHETIC original</button><input id="text"><output id="initial"></output><script>void riffoid.readFile("docs/initial.json").then(async f=>{document.querySelector("#initial").textContent=JSON.parse(f.text).label;await riffoid.readFile("docs/rendered-initial.json")});document.querySelector("#counter").onclick=()=>{void riffoid.readFile("docs/click.json").then(async f=>{document.querySelector("#counter").textContent=JSON.parse(f.text).label;await riffoid.readFile("docs/rendered-click.json")})};document.querySelector("#text").oninput=event=>{const value=event.target.value;void riffoid.readFile("docs/text.json").then(async f=>{document.querySelector("#initial").textContent=JSON.parse(f.text).label+value;await riffoid.readFile("docs/rendered-text.json")})};document.querySelector("#text").onkeydown=event=>{if(event.key==="Enter")void riffoid.readFile("docs/key.json")};</script>',
  'docs/initial.json':'{"label":"SYNTHETIC broker rendered"}', 'docs/click.json':'{"label":"SYNTHETIC clicked"}', 'docs/text.json':'{"label":"SYNTHETIC text "}',
  'docs/rendered-initial.json':'{"stage":"initial"}', 'docs/rendered-click.json':'{"stage":"click"}', 'docs/rendered-text.json':'{"stage":"text"}', 'docs/key.json':'{"stage":"key"}',
 };
 const view={id:'home',title:'Synthetic candidate probe',entrypoint:'app/home.html'},scope={tenantId:'synthetic-probe',projectId:'synthetic-probe',workspaceId:'synthetic-probe',workspaceGeneration:1};
 const assets=Object.entries(texts).map(([path,text])=>({path,mediaType:path.endsWith('.html')?'text/html':'application/json',base64:Buffer.from(text).toString('base64'),sourceSha256:hash(text),sha256:hash(text)}));
 const body={schema:'project.view-package/v1',scope,revisionId:null,filesSha256:hash(JSON.stringify(texts)),manifest:{schema:'project.views/v1',files:Object.keys(texts),views:[view]},assets};
 return {pkg:{...body,packageIdentity:hash(JSON.stringify(body))},view};
}
export async function runCandidateProbe({image,contextReceiptSha256,output,runner=dockerRunner,launch=launchCandidateProcess,signals=process,timeoutMs=60000,pollMs=100}){
 if(!IMAGE.test(image)||! /^[a-f0-9]{64}$/.test(contextReceiptSha256??'')||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000||!Number.isInteger(pollMs)||pollMs<1||pollMs>1000)fail('input');
 const profileBytes=await readFile(PROFILE);if(hash(profileBytes)!==PROFILE_SHA)fail('seccomp-drift');
 const directory=resolve(output);await mkdir(directory,{recursive:false});
 const operationId=randomUUID(),record={schema:'riffology.candidate-view-probe/v1',operationId,containerName:'riffoid-view-'+operationId,image,contextReceiptSha256,startedAt:new Date().toISOString(),status:'pending',runAttempted:false,cleanupConfirmed:false,productionEligible:false,authenticatedAcceptance:false,cloudCalls:0,programSha256:hash(PROJECT_VIEW_BROWSER_PROGRAM),preflightProgramSha256:hash(PROJECT_VIEW_PREFLIGHT_PROGRAM),profileSha256:PROFILE_SHA,execEnvironment:{method:'/usr/bin/env -i',keys:['PATH'],home:false},resourceScope:'Docker fixture 0.75 GiB / 1 vCPU is not equivalent to the pending Cloudflare basic target 1 GiB / 0.25 vCPU',uncovered:['Cloudflare target container execution and resource release','real authenticated identities and canonical Revision persistence','nine-egress collector controls and browser inner sandbox diagnostics','new binary media and full PNG pixel/chunk/CRC validation','derived-image build/supply-chain provenance requires separate frozen build evidence']};
 await persist(directory,record,true);let native,pipe,broker,channel,current=true,pipeError,interrupted,installed=false,frames=0,lastFrame,observationDeadline;
 const processes=[];
 const reads={},tasks=new Set(),handlers=['SIGINT','SIGTERM'].map(signal=>{const handler=()=>{interrupted??=signal;};signals.on(signal,handler);return [signal,handler];});
 const drain=async()=>{if(interrupted)fail('interrupted');if(pipeError)throw pipeError;const value=pipe.poll();for(const message of value.messages)channel.port2.postMessage(message);if(value.frame){frames++;lastFrame=value.frame;}};
 const remaining=()=>Math.max(1,observationDeadline-Date.now());
 const send=command=>bounded(pipe.send(command),remaining(),'candidate-probe-input-timeout');
 const until=async(condition)=>{while(Date.now()<observationDeadline){await drain();if(condition())return;await bounded(pipe.capture(),remaining(),'candidate-probe-capture-timeout');await sleep(pollMs);}fail('observation-timeout');};
 try{
  const inspected=await cli(runner,['image','inspect','--format','{{json .}}',image]);if(!okay(inspected))fail('image-unavailable');record.imageConfig=validateCandidateImage(JSON.parse(inspected.stdout),image);await persist(directory,record);
  const input=candidateProbeFixture();await verifyProjectViewPackage(input.pkg,input.pkg.scope);record.fixturePackageIdentity=input.pkg.packageIdentity;
  if(interrupted)fail('interrupted');
  const args=candidateContainerArgs(image,operationId);record.argvSha256=hash(JSON.stringify(args));record.runAttempted=true;await persist(directory,record);
  if(interrupted){record.runAttempted=false;fail('interrupted');}
  processes.push(['container',launch(args)]);
  const end=Date.now()+15000;let actual;
  while(Date.now()<end){if(interrupted)fail('interrupted');const ids=await listed(runner,record);if(ids.length){const result=await cli(runner,['container','inspect','--format','{{json .}}',ids[0]]);if(!okay(result))fail('inspect-unavailable');actual=JSON.parse(result.stdout);containerIdentity(actual,record);record.containerId=actual.Id;await persist(directory,record);break;}await sleep(50);}
  if(!actual)fail('create-unresolved');record.containerConfig=validateCandidateContainer(actual,record,profileBytes);await persist(directory,record);
  observationDeadline=Date.now()+timeoutMs;
  if(interrupted)fail('interrupted');
  const preflight=launch(candidateExecArgs(record.containerId,PROJECT_VIEW_PREFLIGHT_PROGRAM,record.imageConfig.path,contextReceiptSha256));processes.push(['preflight',preflight]);
  record.preflight=await bounded(readProjectViewPreflight(preflight,contextReceiptSha256),Math.min(10000,remaining()),'candidate-probe-preflight-timeout');await persist(directory,record);
  if(interrupted)fail('interrupted');
  native=launch(candidateExecArgs(record.containerId,PROJECT_VIEW_BROWSER_PROGRAM,record.imageConfig.path));processes.push(['browser',native]);
  if(interrupted)fail('interrupted');
  pipe=createProjectViewRuntimePipe(native,input);void pipe.finished.catch(error=>{pipeError=error;});channel=new MessageChannel();
  broker=createProjectViewBroker({port:channel.port1,pkg:input.pkg,isCurrent:()=>current,authorize:async()=>{if(!current)fail('retired');},readAsset:async asset=>{reads[asset.path]=(reads[asset.path]??0)+1;return Buffer.from(asset.base64,'base64');},onState:state=>{if(state==='ready')installed=true;else if(state==='failed')pipeError=Error('candidate-probe-page-failed');}});
  channel.port2.onmessage=event=>{const task=pipe.send({type:'broker',message:event.data});tasks.add(task);void task.catch(error=>{pipeError=error;}).finally(()=>tasks.delete(task));};channel.port2.start();await bounded(pipe.ready,5000,'candidate-probe-init-timeout');
  await until(()=>installed&&reads['docs/rendered-initial.json']&&frames>=1);await bounded(pipe.capture(),remaining(),'candidate-probe-capture-timeout');const beforeFrames=frames;await until(()=>frames>beforeFrames);const before=lastFrame;
  await send({type:'input',event:{kind:'click',x:70,y:50}});await until(()=>reads['docs/rendered-click.json']);
  await send({type:'input',event:{kind:'click',x:70,y:150}});await send({type:'input',event:{kind:'text',text:'SYNTHETIC runtime input 42'}});await until(()=>reads['docs/rendered-text.json']);
  await send({type:'input',event:{kind:'key',key:'Enter'}});await until(()=>reads['docs/key.json']);await send({type:'input',event:{kind:'wheel',deltaY:.5}});
  const afterFrames=frames;await bounded(pipe.capture(),remaining(),'candidate-probe-capture-timeout');await until(()=>frames>afterFrames);const after=lastFrame;
  record.frames=[];for(const [index,frame]of [before,after].entries()){const bytes=Buffer.from(frame.base64,'base64');await writeFile(resolve(directory,'frame-'+index+'.png'),bytes,{flag:'wx',mode:0o600});record.frames.push({path:'frame-'+index+'.png',bytes:bytes.length,sha256:hash(bytes),width:frame.width,height:frame.height});}
  if(record.frames[0].sha256===record.frames[1].sha256)fail('unchanged-raster');
  Object.assign(record,{status:'local-candidate-probe-passed',brokerReads:reads,input:{click:true,text:true,key:true,fractionalWheelSent:true,commands:5},frameObservation:'bounded PNG header plus changed raster bytes; not independent pixel decoding'});
 }catch(error){record.status='blocked';record.reason=interrupted?'candidate-probe-interrupted':error.message;}
 finally{
  current=false;broker?.close();channel?.port2.close();
  if(pipe)try{await bounded(pipe.close(),5000,'candidate-probe-close-timeout');}catch{record.pipeCloseUnconfirmed=true;}
  record.cleanup=await cleanupOriginal(directory,record,runner);record.cleanupConfirmed=record.cleanup.confirmed;
  if(!record.cleanupConfirmed){record.status='blocked';record.reason='candidate-probe-cleanup-unconfirmed';}
  record.cli={};
  for(const [stage,process]of processes){try{await bounded(process.exitCode,5000,'candidate-probe-cli-exit-timeout');}catch{process.kill('SIGTERM');try{await bounded(process.exitCode,1000,'candidate-probe-cli-stop-timeout');}catch{process.kill('SIGKILL');}}
   const logs=process.logs();await writeFile(resolve(directory,stage+'-stdout.raw'),logs.stdout,{flag:'wx',mode:0o600});await writeFile(resolve(directory,stage+'-stderr.raw'),logs.stderr,{flag:'wx',mode:0o600});record.cli[stage]={exitCode:logs.exitStatus,signal:logs.exitSignal,stdoutBytes:logs.stdout.length,stdoutSha256:hash(logs.stdout),stderrBytes:logs.stderr.length,stderrSha256:hash(logs.stderr),discardedStdoutBytes:logs.discardedStdoutBytes,discardedStderrBytes:logs.discardedStderrBytes};
   if(logs.discardedStdoutBytes||logs.discardedStderrBytes){record.status='blocked';record.reason='candidate-probe-log-limit';}
  }
  if(interrupted){record.status='blocked';record.reason='candidate-probe-interrupted';record.interruptedBy=interrupted;}
  record.finishedAt=new Date().toISOString();await persist(directory,record);for(const [signal,handler]of handlers)signals.removeListener(signal,handler);
 }
 return record;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);let result;
 if(args.length===4&&args[0]==='--cleanup')result=await cleanupCandidateProbe({output:args[1],operationId:args[2]==='--operation'?args[3]:''});
 else if(args.length===3)result=await runCandidateProbe({image:args[0],contextReceiptSha256:args[1],output:args[2]});
 else fail('usage-node-project-view-candidate-probe-image-context-sha256-new-output-or-cleanup-output-operation-id');
 console.log(JSON.stringify({status:result.status,operationId:result.operationId,cleanupConfirmed:result.cleanupConfirmed,reason:result.reason??null}));if(result.status!=='local-candidate-probe-passed')process.exitCode=1;
}
