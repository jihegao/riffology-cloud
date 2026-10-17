// Offline experiment only. No production integration, image pull or cloud API.
import {spawn} from 'node:child_process';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const SOCKET='unix:///var/run/docker.sock',OPERATION=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,LABEL='io.riffoid.offline-view.operation';
export function containerArgs(image, name, program) {
 if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw Error('explicit-local-image-digest-required');
 if (typeof name!=='string'||!name.startsWith('riffoid-view-')||!OPERATION.test(name.slice(13))) throw Error('invalid-container-name');
 return ['--host',SOCKET,'run','--pull=never','--name',name,'--label',LABEL+'='+name.slice(13),
  '--network=none','--read-only','--user','10001:10001','--cap-drop=ALL',
  '--security-opt=no-new-privileges','--memory=768m','--cpus=1','--pids-limit=128',
  '--tmpfs','/tmp:rw,nosuid,nodev,size=268435456','--shm-size=128m',
  '--env','HOME=/tmp','--workdir','/opt/viewer','--entrypoint','node','-i',image,'--input-type=module','-e',program];
}

// Executed inside an explicitly prepared, disposable local image. Browser
// debugging stays on Playwright's pipe; no debug port or host mount is exposed.
async function browserExperiment() {
 const {networkInterfaces}=await import('node:os');
 const {readFile}=await import('node:fs/promises');
 const {createConnection}=await import('node:net');
 const {chromium}=await import('playwright');
 let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>65536)throw Error('input-limit');}
 const input=JSON.parse(text);
 if(input.schema!=='offline-synthetic-view/v1'||typeof input.html!=='string'||input.html.length>32768||!Array.isArray(input.clicks)||input.clicks.length>4)throw Error('input-invalid');
 const nonLoopback=Object.entries(networkInterfaces()).flatMap(([name,addresses])=>addresses.filter(a=>!a.internal).map(a=>({name,family:a.family})));
 if(nonLoopback.length)throw Error('network-interface-present');
 const route=await readFile('/proc/net/route','utf8');
 if(route.trim().split('\n').length!==1)throw Error('network-route-present');
 // RFC 2544 benchmark address; must fail at the kernel before any traffic can
 // leave this network namespace. A timeout is inconclusive, not a pass.
 const connectResult=await new Promise(resolve=>{
  const socket=createConnection({host:'198.18.0.1',port:9});
  socket.setTimeout(1500);socket.once('connect',()=>{socket.destroy();resolve('connected');});
  socket.once('error',e=>resolve(e.code));socket.once('timeout',()=>{socket.destroy();resolve('timeout');});
 });
 if(!['ENETUNREACH','EHOSTUNREACH'].includes(connectResult))throw Error('kernel-network-check-inconclusive');
 const browser=await chromium.launch({headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage({viewport:{width:800,height:600}});
  await page.setContent(input.html,{waitUntil:'load',timeout:5000});
  const frames=[(await page.screenshot({type:'png',timeout:5000})).toString('base64')];
  for(const point of input.clicks){
   if(!Number.isInteger(point.x)||!Number.isInteger(point.y)||point.x<0||point.x>=800||point.y<0||point.y>=600)throw Error('input-coordinate-invalid');
   await page.mouse.click(point.x,point.y);
   frames.push((await page.screenshot({type:'png',timeout:5000})).toString('base64'));
  }
  process.stdout.write(JSON.stringify({schema:'offline-synthetic-frames/v1',browser:browser.version(),chromiumSandbox:true,nonLoopback,connectResult,frames})+'\n');
 }finally{await browser.close();}
}

/** Async, bounded CLI transport. Killing this CLI is not container-stop proof;
 * the caller always performs the separate original-operation cleanup below. */
export function dockerRunner(args,{input='',timeout=15000,maxBuffer=1048576,signal}={}) {
 return new Promise(resolveResult=>{
  if(signal?.aborted){resolveResult({status:null,error:Error('prototype-interrupted'),stdout:'',stderr:''});return;}
  const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']}),parts={stdout:[],stderr:[]},sizes={stdout:0,stderr:0};
  let settled=false,error,timer,killTimer,finishTimer;
  const finish=(status=null,exitSignal=null)=>{
   if(settled)return;settled=true;for(const value of [timer,killTimer,finishTimer])clearTimeout(value);signal?.removeEventListener('abort',abort);
   resolveResult({status,signal:exitSignal,error,stdout:Buffer.concat(parts.stdout).toString('utf8'),stderr:Buffer.concat(parts.stderr).toString('utf8')});
  };
  const stop=reason=>{
   if(error||settled)return;error=Error(reason);child.kill('SIGTERM');
   killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);finishTimer=setTimeout(()=>finish(),2000);
  };
  const abort=()=>stop('prototype-interrupted');signal?.addEventListener('abort',abort,{once:true});
  for(const stream of ['stdout','stderr'])child[stream].on('data',chunk=>{if(settled||error)return;sizes[stream]+=chunk.length;if(sizes[stream]>maxBuffer)stop('docker-output-limit');else parts[stream].push(chunk);});
  child.on('error',cause=>{error=cause;finish();});child.on('close',finish);child.stdin.on('error',()=>{});
  timer=setTimeout(()=>stop('docker-command-timeout'),timeout);child.stdin.end(input);
 });
}
const docker=(runner,args,options)=>runner(['--host',SOCKET,...args],{timeout:15000,maxBuffer:1048576,...options});
const successful=result=>!result.error&&result.status===0&&typeof result.stdout==='string';
async function saveEvidence(directory,evidence,first=false){
 const target=resolve(directory,'evidence.json'),text=JSON.stringify(evidence,null,2)+'\n';
 if(first){await writeFile(target,text,{flag:'wx',mode:0o600});return;}
 const temporary=resolve(directory,`evidence-${randomUUID()}.tmp`);
 try{await writeFile(temporary,text,{flag:'wx',mode:0o600});await rename(temporary,target);}finally{await rm(temporary,{force:true});}
}
function originalOperation(evidence,operationId){
 if(!OPERATION.test(operationId??'')||evidence?.schema!=='riffology.offline-view-prototype/v1'||evidence.operationId!==operationId||evidence.containerName!=='riffoid-view-'+operationId||!/^sha256:[a-f0-9]{64}$/.test(evidence.image??'')||typeof evidence.runAttempted!=='boolean'||evidence.containerId!==undefined&&!/^[a-f0-9]{64}$/.test(evidence.containerId))throw Error('invalid-original-operation');
}
async function cleanupOriginal(evidence,runner,persist){
 originalOperation(evidence,evidence.operationId);
 const list=async()=>{
  const result=await docker(runner,['container','ls','--all','--no-trunc','--filter','label='+LABEL+'='+evidence.operationId,'--format','{{.ID}}']);
  if(!successful(result))throw Error('container-list-unavailable');
  const ids=result.stdout.trim()?result.stdout.trim().split('\n'):[];
  if(ids.length>1||ids.some(id=>!/^[a-f0-9]{64}$/.test(id)))throw Error('container-operation-ambiguous');return ids;
 };
 try{
  const ids=await list();
  // An empty list cannot fence an unresolved create (e.g. a surviving Docker
  // CLI after supervisor SIGKILL). Keep the original pending operation open.
  if(!ids.length){if(!evidence.containerId)throw Error('original-create-unresolved');return {confirmed:true,proof:'verified-original-operation-absent'};}
  const id=ids[0],inspection=await docker(runner,['container','inspect','--format','{{json .}}',id]);
  if(!successful(inspection))throw Error('container-inspect-unavailable');
  const actual=JSON.parse(inspection.stdout);
  if(actual.Id!==id||actual.Name!=='/'+evidence.containerName||actual.Image!==evidence.image||actual.Config?.Labels?.[LABEL]!==evidence.operationId||evidence.containerId!==undefined&&evidence.containerId!==id)throw Error('container-cleanup-identity-mismatch');
  evidence.containerId=id;
  await persist();
  // Address the verified immutable ID, never a possibly replaced name. A lost
  // rm reply is resolved by an authoritative scoped listing, not a retry/start.
  await docker(runner,['container','rm','--force',id]);
  if((await list()).length)throw Error('container-remains');
  return {confirmed:true,proof:'verified-original-id-removed'};
 }catch(error){return {confirmed:false,reason:error.message};}
}
/** Explicit recovery after interruption; no prefix-wide or caller-name delete. */
export async function cleanupPrototype({output,operationId,runner=dockerRunner}){
 const directory=resolve(output),bytes=await readFile(resolve(directory,'evidence.json'));
 if(bytes.length>65536)throw Error('invalid-original-operation');
 const evidence=JSON.parse(bytes);originalOperation(evidence,operationId);
 const result=evidence.runAttempted?await cleanupOriginal(evidence,runner,()=>saveEvidence(directory,evidence)):{confirmed:true,proof:'never-attempted'};
 evidence.cleanupConfirmed=result.confirmed;evidence.cleanup=result;evidence.cleanupRecoveredAt=new Date().toISOString();
 evidence.status='blocked';evidence.reason=result.confirmed?'cleanup-only-no-experiment-validation':'container-cleanup-unconfirmed';
 await saveEvidence(directory,evidence);return evidence;
}
export async function runPrototype({image,output,runner=dockerRunner,signals=process}) {
 const directory=resolve(output);await mkdir(directory,{recursive:true});
 const operationId=randomUUID(),name='riffoid-view-'+operationId,controller=new AbortController();let interrupted;
 const evidence={schema:'riffology.offline-view-prototype/v1',operationId,containerName:name,startedAt:new Date().toISOString(),productionEligible:false,userUiEligible:false,frameValidation:'png-header-only',status:'pending',runAttempted:false,cleanupConfirmed:false,image:image??null,cloudCalls:0,scope:'Synthetic offline Docker experiment; no credentials, user projects, mounts or published ports',uncovered:['full PNG decode/chunk/CRC validation','real project package/broker','session ownership and revocation','web image/input UI','latency and accessibility','cloud resource lifecycle','host/kernel compromise']};
 // Reserve one output directory. Do not overwrite another operation's intent.
 await saveEvidence(directory,evidence,true);
 const handlers=['SIGINT','SIGTERM'].map(signal=>{const handler=()=>{interrupted??=signal;controller.abort();};signals.on(signal,handler);return [signal,handler];});
 try{
  const args=containerArgs(image,name,'await ('+browserExperiment.toString()+')();');
  const inspected=await docker(runner,['image','inspect','--format','{{.Id}}',image],{signal:controller.signal});
  if(!successful(inspected)||inspected.stdout.trim()!==image)throw Error('local-browser-image-unavailable');
  const fixture={schema:'offline-synthetic-view/v1',html:'<!doctype html><style>button{position:absolute;left:20px;top:20px;width:160px;height:80px}</style><button onclick="this.textContent=\'SYNTHETIC 1\'">SYNTHETIC 0</button>',clicks:[{x:70,y:55}]};
  evidence.fixtureSha256=createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
  controller.signal.throwIfAborted();evidence.runAttempted=true;await saveEvidence(directory,evidence);
  controller.signal.throwIfAborted();
  const result=await runner(args,{input:JSON.stringify(fixture),timeout:45000,maxBuffer:8*1024*1024,signal:controller.signal});
  evidence.processExit=result.status;
  if(!successful(result))throw Error('container-or-browser-experiment-failed');
  if(Buffer.byteLength(result.stdout)>8*1024*1024)throw Error('experiment-output-limit');
  const data=JSON.parse(result.stdout);
  if(data.schema!=='offline-synthetic-frames/v1'||typeof data.browser!=='string'||data.browser.length<1||data.browser.length>256||data.chromiumSandbox!==true||!Array.isArray(data.nonLoopback)||data.nonLoopback.length!==0||!['ENETUNREACH','EHOSTUNREACH'].includes(data.connectResult)||!Array.isArray(data.frames)||data.frames.length!==2)throw Error('invalid-experiment-evidence');
  const frames=data.frames.map(encoded=>{
   if(typeof encoded!=='string'||encoded.length>3*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error('frame-limit');
   const bytes=Buffer.from(encoded,'base64');
   // Header sanity only. No PNG chunk/CRC validation or pixel decoding: these
   // local experimental artifacts must never be installed in a user UI.
   if(bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==800||bytes.readUInt32BE(20)!==600)throw Error('invalid-frame-header');return bytes;
  });
  const frameHashes=frames.map(bytes=>createHash('sha256').update(bytes).digest('hex'));
  if(frameHashes[0]===frameHashes[1])throw Error('interaction-not-observed');
  for(let i=0;i<frames.length;i++)await writeFile(resolve(directory,`frame-${i}.png`),frames[i],{flag:'wx',mode:0o600});
  controller.signal.throwIfAborted();
  Object.assign(evidence,{status:'local-experiment-passed',browser:data.browser,chromiumSandboxRequested:true,kernelConnectResult:data.connectResult,frameHashes});
 }catch(error){evidence.status='blocked';evidence.reason=interrupted?'prototype-interrupted':error.message;}
 finally{
  try{
   const cleanup=evidence.runAttempted?await cleanupOriginal(evidence,runner,()=>saveEvidence(directory,evidence)):{confirmed:true,proof:'never-attempted'};
   evidence.cleanup=cleanup;evidence.cleanupConfirmed=cleanup.confirmed;
   if(!cleanup.confirmed){evidence.status='blocked';evidence.reason='container-cleanup-unconfirmed';}
   if(interrupted){evidence.status='blocked';evidence.reason=cleanup.confirmed?'prototype-interrupted':'container-cleanup-unconfirmed';evidence.interruptedBy=interrupted;}
   evidence.finishedAt=new Date().toISOString();await saveEvidence(directory,evidence);
  }finally{for(const [signal,handler]of handlers)signals.removeListener(signal,handler);}
 }
 return evidence;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);let image,output='.local/offline-view-prototype',cleanup=false,operationId;
 for(let i=0;i<args.length;i++){if(args[i]==='--image')image=args[++i];else if(args[i]==='--output')output=args[++i];else if(args[i]==='--cleanup')cleanup=true;else if(args[i]==='--operation')operationId=args[++i];else throw Error('unknown-argument');}
 const evidence=cleanup?await cleanupPrototype({output,operationId}):await runPrototype({image,output});console.log(JSON.stringify(evidence));if(cleanup?!evidence.cleanupConfirmed:evidence.status!=='local-experiment-passed')process.exitCode=evidence.interruptedBy==='SIGINT'?130:evidence.interruptedBy==='SIGTERM'?143:1;
}
