// Offline experiment only. No production integration, image pull or cloud API.
import {spawnSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function containerArgs(image, name, program) {
 if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw Error('explicit-local-image-digest-required');
 if (!/^riffoid-view-[a-f0-9-]+$/.test(name)) throw Error('invalid-container-name');
 return ['--host','unix:///var/run/docker.sock','run','--pull=never','--name',name,
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

export async function runPrototype({image,output}) {
 const directory=resolve(output);await mkdir(directory,{recursive:true});
 const name='riffoid-view-'+randomUUID();
 const evidence={schema:'riffology.offline-view-prototype/v1',startedAt:new Date().toISOString(),productionEligible:false,status:'blocked',image:image??null,cloudCalls:0,scope:'Synthetic offline Docker experiment; no credentials, user projects, mounts or published ports',uncovered:['real project package/broker','session ownership and revocation','web image/input UI','latency and accessibility','cloud resource lifecycle','host/kernel compromise']};
 let created=false;
 const docker=(args,options={})=>spawnSync('docker',['--host','unix:///var/run/docker.sock',...args],{encoding:'utf8',timeout:15000,maxBuffer:1048576,...options});
 try{
  const args=containerArgs(image,name,'await ('+browserExperiment.toString()+')();');
  const inspected=docker(['image','inspect','--format','{{.Id}}',image]);
  if(inspected.error||inspected.status!==0||inspected.stdout.trim()!==image)throw Error('local-browser-image-unavailable');
  const fixture={schema:'offline-synthetic-view/v1',html:'<!doctype html><style>button{position:absolute;left:20px;top:20px;width:160px;height:80px}</style><button onclick="this.textContent=\'SYNTHETIC 1\'">SYNTHETIC 0</button>',clicks:[{x:70,y:55}]};
  evidence.fixtureSha256=createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
  created=true;
  const result=spawnSync('docker',args,{encoding:'utf8',input:JSON.stringify(fixture),timeout:45000,maxBuffer:8*1024*1024});
  evidence.processExit=result.status;
  if(result.error||result.status!==0)throw Error('container-or-browser-experiment-failed');
  const data=JSON.parse(result.stdout);
  if(data.schema!=='offline-synthetic-frames/v1'||data.chromiumSandbox!==true||data.nonLoopback?.length!==0||!['ENETUNREACH','EHOSTUNREACH'].includes(data.connectResult)||!Array.isArray(data.frames)||data.frames.length!==2)throw Error('invalid-experiment-evidence');
  const frameHashes=[];
  for(let i=0;i<data.frames.length;i++){
   const encoded=data.frames[i];if(typeof encoded!=='string'||encoded.length>3*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error('frame-limit');
   const bytes=Buffer.from(encoded,'base64');
   if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==800||bytes.readUInt32BE(20)!==600)throw Error('invalid-frame');
   await writeFile(resolve(directory,`frame-${i}.png`),bytes);
   frameHashes.push(createHash('sha256').update(bytes).digest('hex'));
  }
  if(frameHashes[0]===frameHashes[1])throw Error('interaction-not-observed');
  Object.assign(evidence,{status:'local-experiment-passed',browser:data.browser,chromiumSandbox:true,kernelConnectResult:data.connectResult,frameHashes});
 }catch(error){evidence.reason=error.message;}
 finally{
  if(created){
   const removal=docker(['rm','--force',name]);
   evidence.cleanupConfirmed=removal.status===0;
   if(!evidence.cleanupConfirmed){evidence.status='blocked';evidence.reason='container-cleanup-unconfirmed';}
  }else evidence.cleanupConfirmed=true;
  evidence.finishedAt=new Date().toISOString();await writeFile(resolve(directory,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
 }
 return evidence;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);let image,output='.local/offline-view-prototype';
 for(let i=0;i<args.length;i++){if(args[i]==='--image')image=args[++i];else if(args[i]==='--output')output=args[++i];else throw Error('unknown-argument');}
 const evidence=await runPrototype({image,output});console.log(JSON.stringify(evidence));if(evidence.status!=='local-experiment-passed')process.exitCode=1;
}
