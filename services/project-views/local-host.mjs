/** Local-only isolated browser supervisor. No cloud bindings or provider clients. */
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {containerArgs,dockerRunner} from '../../scripts/m3/project-view-offline-prototype.mjs';
import {PROJECT_VIEW_FRAME_HTML} from './frame.mjs';
import {isolatedBrowserMain} from './isolated-browser.mjs';
const socket=['--host','unix:///var/run/docker.sock'];
const label='io.riffoid.offline-view.operation';
const hash=value=>createHash('sha256').update(value).digest('hex');
const policyHash='4cdcdc07d9676737fa78222a8fffeda5cd0ebd2b209c82fafd2077d051d30ae2';
export function localOrigins(app,execution){
 const parse=value=>{const u=new URL(value);if(!['http:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.href!==u.origin+'/'||u.username||u.password)throw Error('loopback-origin-required');return u;};
 const a=parse(app),e=parse(execution);if(a.origin===e.origin)throw Error('distinct-loopback-origins-required');return {app:a,execution:e};
}
export function checkPackage(pkg,view){
 if(!pkg||pkg.schema!=='project.view-package/v1'||!pkg.scope||!Array.isArray(pkg.assets)||pkg.assets.length<1||pkg.assets.length>64||pkg.manifest?.schema!=='project.views/v1'||!Array.isArray(pkg.manifest.views)||pkg.manifest.views.length>16)throw Error('package-invalid');
 const {packageIdentity,...body}=pkg;if(hash(JSON.stringify(body))!==packageIdentity)throw Error('package-digest');
 const seen=new Set();let bytes=0;
 for(const a of pkg.assets){if(typeof a.path!=='string'||seen.has(a.path)||typeof a.base64!=='string'||!a.base64.match(/^[A-Za-z0-9+/]*={0,2}$/))throw Error('asset-invalid');seen.add(a.path);const b=Buffer.from(a.base64,'base64');bytes+=b.length;if(b.length>262144||bytes>2097152||hash(b)!==a.sha256)throw Error('asset-digest');}
 if(!Array.isArray(pkg.manifest.files)||pkg.manifest.files.length!==seen.size||pkg.manifest.files.some(p=>!seen.has(p))||!pkg.manifest.views.some(v=>v.id===view?.id&&v.entrypoint===view.entrypoint&&seen.has(v.entrypoint)))throw Error('package-view-invalid');
 return pkg;
}
async function body(req,max){let size=0,parts=[];for await(const b of req){size+=b.length;if(size>max)throw Error('request-limit');parts.push(b);}return JSON.parse(Buffer.concat(parts).toString());}
const command=async args=>{const r=await dockerRunner([...socket,...args],{timeout:15000,maxBuffer:1048576});if(r.status!==0||r.error)throw Error('docker-command-failed');return r.stdout.trim();};
/** Reconcile only the original immutable identity; never starts or replays work. */
export async function reconcileLocalContainer(s,image,invoke,persist){
 const list=()=>invoke(['container','ls','--all','--no-trunc','--filter','label='+label+'='+s.id,'--format','{{.ID}}']);
 const ids=(await list()).split('\n').filter(Boolean);
 if(!ids.length){if(!s.containerId)throw Error('original-create-unresolved');return 'original-id-absent';}
 if(ids.length!==1||!/^[a-f0-9]{64}$/.test(ids[0]))throw Error('original-container-ambiguous');
 const raw=JSON.parse(await invoke(['container','inspect','--format','{{json .}}',ids[0]]));
 if(raw.Id!==ids[0]||raw.Name!=='/'+s.name||raw.Image!==image||raw.Config.Labels?.[label]!==s.id||s.containerId&&raw.Id!==s.containerId)throw Error('cleanup-identity-mismatch');
 s.containerId=raw.Id;s.evidence.containerId=raw.Id;await persist(s);
 await invoke(['container','rm','--force',raw.Id]);
 if(await list())throw Error('cleanup-unconfirmed');return 'original-id-removed';
}
export async function createLocalViewHost({appOrigin,executionOrigin,image,policy=resolve('scripts/m3/offline-view/chromium-userns-seccomp.json'),evidenceRoot=resolve('.local/isolated-view-host')}){
 const origins=localOrigins(appOrigin,executionOrigin);
 if(!/^sha256:[a-f0-9]{64}$/.test(image??''))throw Error('local-image-id-required');
 const policyBytes=await readFile(policy);
 if(hash(policyBytes)!==policyHash)throw Error('unreviewed-policy');
 if(await command(['image','inspect','--format','{{.Id}}',image])!==image)throw Error('image-mismatch');
 await mkdir(evidenceRoot,{recursive:true});
 for(const entry of await readdir(evidenceRoot,{withFileTypes:true})){if(!entry.isDirectory())continue;const old=JSON.parse(await readFile(resolve(evidenceRoot,entry.name,'state.json'),'utf8'));if(!old.cleanupConfirmed)throw Error('original-session-recovery-required:'+entry.name);}
 if(await command(['container','ls','--all','--filter','label='+label,'--format','{{.ID}}']))throw Error('original-container-recovery-required');
 const sessions=new Map();let capacity=null,stopping=false;
 async function persist(s){const p=resolve(s.directory,'state.json'),tmp=p+'.tmp';await writeFile(tmp,JSON.stringify(s.evidence,null,2)+'\n',{mode:0o600});await rename(tmp,p);}
 async function close(s,reason='closed'){
  if(s.closing)return s.closing;
  s.closed=true;clearTimeout(s.expiry);clearInterval(s.captureTimer);clearInterval(s.idleTimer);
  s.closing=(async()=>{
   s.evidence.reason=reason;s.evidence.status='stopping';try{await persist(s);}catch{s.evidence.storageError=true;}
   try{
    s.evidence.cleanupProof=await reconcileLocalContainer(s,image,command,persist);
    s.evidence.cleanupConfirmed=true;s.evidence.status='closed';
   }catch(error){s.evidence.status='quarantined';s.evidence.cleanupError=error.message;}
   s.child?.kill('SIGTERM');s.messages=[];s.frame=null;s.evidence.endedAt=new Date().toISOString();try{await persist(s);if(s.evidence.cleanupConfirmed&&capacity===s)capacity=null;}catch{s.evidence.status='quarantined';s.evidence.storageError=true;}
   if(s.evidence.cleanupConfirmed)setTimeout(()=>sessions.delete(s.id),30000).unref();else s.closing=null;
  })();return s.closing;
 }
 async function start(pkg,view){
  if(capacity||stopping)throw Error('capacity-unavailable');checkPackage(pkg,view);
  const id=randomUUID(),s={id,name:'riffoid-view-'+id,token:randomBytes(32).toString('hex'),directory:resolve(evidenceRoot,id),messages:[],frame:null,closed:false,bytes:0,events:0,window:Date.now(),evidence:{schema:'riffology.local-browser-session/v1',id,image,policyHash,packageIdentity:pkg.packageIdentity,scope:pkg.scope,viewId:view.id,startedAt:new Date().toISOString(),status:'pending',runAttempted:false,cleanupConfirmed:false,productionEligible:false}};
  s.evidence.tokenHash=hash(s.token);capacity=s;sessions.set(id,s);
  try{
   await mkdir(s.directory);await persist(s);
   const args=containerArgs(image,s.name,'await ('+isolatedBrowserMain.toString()+')();');args[2]='create';args.splice(args.indexOf('--network=none'),0,'--cpuset-cpus=0,1','--security-opt','seccomp='+policy);
   s.evidence.runAttempted=true;await persist(s);
   const r=await dockerRunner(args,{timeout:15000});if(r.status!==0||r.error||!/^[a-f0-9]{64}$/.test(r.stdout.trim()))throw Error('container-create-unconfirmed');
   s.containerId=r.stdout.trim();s.evidence.containerId=s.containerId;await persist(s);
   const actual=JSON.parse(await command(['container','inspect','--format','{{json .}}',s.containerId]));
   const hc=actual.HostConfig;
   const policyValue=JSON.parse(policyBytes);
   const secure=hc.SecurityOpt?.some(v=>v.startsWith('seccomp=')&&JSON.stringify(JSON.parse(v.slice(8)))===JSON.stringify(policyValue));
   if(actual.Name!=='/'+s.name||actual.Image!==image||actual.Config.User!=='10001:10001'||actual.HostConfig.NetworkMode!=='none'||!actual.HostConfig.ReadonlyRootfs||actual.HostConfig.Privileged||actual.Mounts.length||!secure||!hc.SecurityOpt?.some(v=>v.startsWith('no-new-privileges'))||!hc.CapDrop?.includes('ALL')||hc.CapAdd?.length||hc.CpusetCpus!=='0,1'||hc.NanoCpus!==1000000000||hc.Memory!==805306368||hc.PidsLimit!==128||hc.IpcMode==='host'||hc.PidMode==='host'||Object.keys(hc.PortBindings??{}).length)throw Error('container-policy-mismatch');
   s.child=spawn('docker',[...socket,'start','--attach','--interactive',s.containerId],{stdio:['pipe','pipe','pipe']});
   let buffer=Buffer.alloc(0),stderrBytes=0;
   s.child.stdout.on('data',chunk=>{
    if(s.closed)return;buffer=Buffer.concat([buffer,chunk]);if(buffer.length>3*1024*1024){void close(s,'output-limit');return;}
    let newline;while((newline=buffer.indexOf(10))>=0){const line=buffer.subarray(0,newline);buffer=buffer.subarray(newline+1);try{
     if(Date.now()-s.window>1000){s.window=Date.now();s.events=0;s.bytes=0;}s.events++;s.bytes+=line.length;
     if(s.events>64||s.bytes>8*1024*1024)throw Error('output-rate');const m=JSON.parse(line);
     if(m.type==='broker'&&JSON.stringify(m.message).length<=65536&&s.messages.length<32)s.messages.push(m.message);
     else if(m.type==='frame'&&m.width===800&&m.height===600&&typeof m.base64==='string'&&m.base64.length<2800000){s.capturePending=false;s.frame={base64:m.base64,width:800,height:600};}
     else if(m.type==='network'&&['requestfailed','websocket-error'].includes(m.event)&&typeof m.error==='string'&&(m.error==='request-failed'||/^net::ERR_[A-Z0-9_]{1,80}$/.test(m.error))){s.evidence.networkFailures??=[];if(s.evidence.networkFailures.length<64)s.evidence.networkFailures.push({event:m.event,error:m.error});}
     else if(m.type==='error')throw Error('browser-error');else throw Error('output-invalid');
    }catch{void close(s,'invalid-browser-output');}}
   });
   s.child.stderr.on('data',b=>{stderrBytes+=b.length;if(stderrBytes>65536)void close(s,'stderr-limit');});
   s.child.on('error',()=>void close(s,'transport-error'));s.child.on('exit',()=>{if(!s.closed)void close(s,'browser-exited');});
   s.child.stdin.on('error',()=>void close(s,'input-error'));
   s.send=m=>{if(s.closed||!s.child.stdin.writable||s.child.stdin.writableLength>4*1024*1024)throw Error('browser-closed');s.child.stdin.write(JSON.stringify(m)+'\n');};
   s.send({type:'init',package:pkg,view,frameHtml:PROJECT_VIEW_FRAME_HTML});
   s.lastPoll=Date.now();s.idleTimer=setInterval(()=>{if(Date.now()-s.lastPoll>10000)void close(s,'client-disconnected');},1000);s.idleTimer.unref();
   s.evidence.status='running';await persist(s);
   s.expiry=setTimeout(()=>void close(s,'session-expired'),300000);s.expiry.unref();
   s.captureTimer=setInterval(()=>{try{if(!s.capturePending){s.capturePending=true;s.send({type:'capture'});}}catch{void close(s,'capture-failed');}},500);s.captureTimer.unref();
   return s;
  }catch(error){if(!s.evidence.runAttempted){s.closed=true;s.evidence.cleanupConfirmed=true;s.evidence.status='never-started';try{await persist(s);}catch{}if(capacity===s)capacity=null;sessions.delete(id);}else await close(s,error.message);throw error;}
 }
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  try{
   if(stopping||req.headers.host!==origins.execution.host||req.headers.origin!==origins.app.origin||req.headers.cookie)throw Error('origin-denied');
   res.setHeader('Access-Control-Allow-Origin',origins.app.origin);res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
   if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
   if(req.method!=='POST'||req.headers['content-type']!=='application/json')throw Error('request-denied');
   const url=new URL(req.url,origins.execution);if(url.search||url.hash)throw Error('request-denied');
   if(url.pathname==='/project-views/v1/sessions'){
    if(req.headers.authorization)throw Error('request-denied');const data=await body(req,3*1024*1024);const s=await start(data.package,data.view);reply(201,{id:s.id,token:s.token});return;
   }
   const id=/^\/project-views\/v1\/sessions\/([a-f0-9-]{36})$/.exec(url.pathname)?.[1],s=sessions.get(id);
   const token=String(req.headers.authorization??'').replace(/^Bearer /,'');
   if(!s&&id){try{const old=JSON.parse(await readFile(resolve(evidenceRoot,id,'state.json'),'utf8'));if(old.cleanupConfirmed&&old.tokenHash&&timingSafeEqual(Buffer.from(hash(token)),Buffer.from(old.tokenHash))){reply(200,{closed:true,cleanupConfirmed:true});return;}}catch{}throw Error('session-denied');}
   if(!s||token.length!==s.token.length||!timingSafeEqual(Buffer.from(token),Buffer.from(s.token)))throw Error('session-denied');
   const data=await body(req,70*1024);
   if(data.type==='close'){await close(s);reply(200,{closed:true,cleanupConfirmed:s.evidence.cleanupConfirmed});return;}
   if(s.closed){reply(200,{closed:true,cleanupConfirmed:s.evidence.cleanupConfirmed});return;}
   if(data.type==='poll'){s.lastPoll=Date.now();const frame=s.frame;s.frame=null;reply(200,{messages:s.messages.splice(0),...(frame?{frame}:{})});return;}
   if(data.type==='broker'){if(Buffer.byteLength(JSON.stringify(data.message))>65536)throw Error('broker-limit');s.send({type:'broker',message:data.message});reply(200,{accepted:true});return;}
   if(data.type==='input'){s.send({type:'input',event:data.event});reply(200,{accepted:true});return;}
   throw Error('command-denied');
  }catch(error){reply(400,{error:error.message});}
 });
 server.requestTimeout=10000;server.headersTimeout=5000;
 return {server,sessions,async listen(){await new Promise((yes,no)=>{server.once('error',no);server.listen(Number(origins.execution.port),origins.execution.hostname==='[::1]'?'::1':'127.0.0.1',yes);});},async close(){stopping=true;await Promise.all([...sessions.values()].map(s=>close(s,'host-stopped')));await new Promise(r=>server.close(r));},get quarantined(){return capacity?.evidence.status==='quarantined';}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [appOrigin,executionOrigin,image]=process.argv.slice(2);const host=await createLocalViewHost({appOrigin,executionOrigin,image});await host.listen();console.log(JSON.stringify({localHost:executionOrigin,appOrigin,productionEligible:false}));
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>void host.close().then(()=>{process.exitCode=host.quarantined?1:0;}));
}
