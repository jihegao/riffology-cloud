import {turnDigest} from '../turn/protocol.ts';
import {PreviewPlanResolver,previewSourceFilesSha256,type PreviewRevisionSource} from '../preview/source.ts';
import {serviceRuntimeInput,serviceRuntimeObservation,type ServiceRuntimeInput,type ServiceRuntimeObservation} from './runtime-protocol.ts';
import type {ServiceNativeBackend} from './runtime-supervisor.ts';
export interface ServiceSandboxApi{
 writeFile(path:string,content:string):Promise<unknown>;
 exec(command:string,options:{timeout:number;cwd:string;env:Record<string,string>}):Promise<{success:boolean;stdout:string;stderr?:string;exitCode:number}>;
}
const PROGRAM='/opt/riffology/service_process.py',UPLOAD='/opt/riffology/service_upload.py';
const ENV={LANG:'C.UTF-8',PATH:'/usr/local/bin:/usr/bin:/bin'};
// This command is intentionally self-contained so a new Runtime can recover a
// root-owned proof from a still-live Sandbox created by an older Worker build.
// It performs no process signal or filesystem write.
const STOP_PROOF=`import hashlib,json,os,stat,sys
p="/var/lib/riffology/services/stopped.json"
t=sys.argv[1]
r={"schemaVersion":1,"token":t,"status":"unknown","stop":None}
try:
 f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
except FileNotFoundError:
 print(json.dumps(r,separators=(",",":")));raise SystemExit(0)
try:
 i=os.fstat(f)
 if not stat.S_ISREG(i.st_mode) or i.st_uid!=0 or i.st_gid!=0 or stat.S_IMODE(i.st_mode)!=0o600 or i.st_nlink!=1 or i.st_size>16384: raise ValueError("invalid-service-stop-proof")
 b=os.read(f,16385)
finally:
 os.close(f)
if len(b)>16384: raise ValueError("invalid-service-stop-proof")
def u(pairs):
 d={}
 for k,v in pairs:
  if k in d: raise ValueError("invalid-service-stop-proof")
  d[k]=v
 return d
v=json.loads(b.decode("utf-8"),object_pairs_hook=u)
if type(v) is not dict or set(v)!={"confirmationId","observedAt","fenced"} or v["confirmationId"]!=hashlib.sha256(("service-stop:"+t).encode()).hexdigest() or type(v["observedAt"]) is not int or v["observedAt"]<1 or v["fenced"] is not True: raise ValueError("invalid-service-stop-proof")
r["status"]="stopped";r["stop"]=v
print(json.dumps(r,separators=(",",":")))`;
export async function serviceNativeToken(input:ServiceRuntimeInput){return (await turnDigest({schemaVersion:1,purpose:'service-runtime-native',input:serviceRuntimeInput(input)})).slice(0,52);}
function base64(bytes:Uint8Array){let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);}
/** One platform-selected Sandbox per service runtime. Project code never gets
 * this transport; native start is guarded by the root-owned lifetime fence. */
export class SandboxServiceNativeBackend implements ServiceNativeBackend{
 readonly #sandbox:ServiceSandboxApi;readonly #source:PreviewRevisionSource;readonly #clock:()=>number;readonly #image:string;
 constructor(sandbox:ServiceSandboxApi,source:PreviewRevisionSource,runtimeImage:string,clock=Date.now){this.#sandbox=sandbox;this.#source=source;this.#image=runtimeImage;this.#clock=clock;}
 #input(raw:ServiceRuntimeInput){const input=serviceRuntimeInput(raw);if(input.spec.runtimeImage!==this.#image)throw Error('service-native-image-conflict');return input;}
 async #exec(command:string){const result=await this.#sandbox.exec(command,{timeout:15000,cwd:'/var/lib/riffology',env:ENV});if(!result.success||result.exitCode!==0||typeof result.stdout!=='string'||result.stdout.length>16384)throw Error('service-native-command-unconfirmed');try{return JSON.parse(result.stdout) as Record<string,unknown>;}catch{throw Error('invalid-service-native-result');}}
 #operationResult(input:ServiceRuntimeInput,token:string,raw:Record<string,unknown>){
  if(raw.schemaVersion!==1||raw.token!==token||Object.keys(raw).sort().join(',')!=='schemaVersion,status,stop,token')throw Error('invalid-service-native-result');
  let stop=null;if(raw.status==='stopped'){
   if(!raw.stop||typeof raw.stop!=='object'||Array.isArray(raw.stop)||Object.keys(raw.stop).sort().join(',')!=='confirmationId,fenced,observedAt')throw Error('invalid-service-native-stop');
   stop={...raw.stop,reference:input.reference,scope:input.scope};
  }else if(raw.stop!==null)throw Error('invalid-service-native-stop');
  return serviceRuntimeObservation({reference:input.reference,scope:input.scope,status:raw.status,stop},input,this.#clock());
 }
 async #operation(input:ServiceRuntimeInput,method:'start'|'observe'|'stop'){
  const token=await serviceNativeToken(input),raw=await this.#exec(`python3 ${PROGRAM} ${method} ${token}`);
  return this.#operationResult(input,token,raw);
 }
 async start(raw:ServiceRuntimeInput):Promise<ServiceRuntimeObservation>{
  const input=this.#input(raw),token=await serviceNativeToken(input);
  if(input.reference.deadlineAt<=this.#clock())return this.fenceAndStop(input);
  let stage="source";
  try{
  const archive=await this.#source.files(input.spec.plan.source);
  const actual=await new PreviewPlanResolver({async files(){return archive;}}).resolve(input.spec.plan.source);
  if(JSON.stringify(actual)!==JSON.stringify(input.spec.plan))throw Error('service-native-source-conflict');
  const d=input.spec.plan.declaration,control={schemaVersion:1,token,entrypoint:d.entrypoint,dependencyLock:d.dependencyLock,filesSha256:previewSourceFilesSha256(input.spec.plan.source),declarationSha256:input.spec.plan.declarationSha256,entrypointSha256:input.spec.plan.entrypointSha256,dependencyLockSha256:input.spec.plan.dependencyLockSha256,deadlineAt:input.reference.deadlineAt,healthPath:d.healthPath};
  for(let offset=0;offset<archive.length;offset+=256*1024){
   const chunk=archive.subarray(offset,Math.min(offset+256*1024,archive.length));
   // The pinned SDK 0.12.9 does not forward exec stdin. Transfer data via
   // writeFile into the root-only directory; only validated token/offset enter
   // the command. Distinct chunk paths also isolate delayed command reads.
   stage="archive-write";
   const path=`/var/lib/riffology/archives/${token}.${offset}.chunk.json`;
   await this.#sandbox.writeFile(path,JSON.stringify({offset,total:archive.length,sha256:control.filesSha256,data:base64(chunk)}));
   stage="archive-upload";
   const result=await this.#exec(`python3 ${UPLOAD} ${token} < ${path}`);
   if(result.schemaVersion!==1||result.token!==token||result.offset!==offset||result.bytes!==chunk.length||result.total!==archive.length||typeof result.complete!=='boolean'||(offset+chunk.length===archive.length&&!result.complete))throw Error('invalid-service-upload-receipt');
  }
  stage="control-write";
  await this.#sandbox.writeFile(`/var/lib/riffology/services/${token}.input.json`,JSON.stringify(control));
  stage="native-start";
  return await this.#operation(input,'start');
  }catch(error){const message=error instanceof Error?error.message:'';console.error('service-start-unconfirmed',{runId:input.reference.runId,stage,code:/^[a-z0-9-]{1,100}$/.test(message)?message:'transport-error'});throw error;}
 }
 observe(raw:ServiceRuntimeInput){return this.#operation(this.#input(raw),'observe');}
 fenceAndStop(raw:ServiceRuntimeInput){return this.#operation(this.#input(raw),'stop');}
 async recoverStop(raw:ServiceRuntimeInput){
  const input=this.#input(raw),token=await serviceNativeToken(input);
  return this.#operationResult(input,token,await this.#exec(`python3 -c '${STOP_PROOF}' ${token}`));
 }
}
