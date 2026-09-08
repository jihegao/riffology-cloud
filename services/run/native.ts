import {turnDigest} from '../turn/protocol.ts';
import {PreviewPlanResolver,type PreviewRevisionSource} from '../preview/source.ts';
import {serviceRuntimeInput,serviceRuntimeObservation,type ServiceRuntimeInput,type ServiceRuntimeObservation} from './runtime-protocol.ts';
import type {ServiceNativeBackend} from './runtime-supervisor.ts';
export interface ServiceSandboxApi{
 writeFile(path:string,content:string):Promise<unknown>;
 exec(command:string,options:{timeout:number;cwd:string;env:Record<string,string>}):Promise<{success:boolean;stdout:string;stderr?:string;exitCode:number}>;
}
const PROGRAM='/opt/riffology/service_process.py',UPLOAD='/opt/riffology/service_upload.py';
const ENV={LANG:'C.UTF-8',PATH:'/usr/local/bin:/usr/bin:/bin'};
export async function serviceNativeToken(input:ServiceRuntimeInput){return (await turnDigest({schemaVersion:1,purpose:'service-runtime-native',input:serviceRuntimeInput(input)})).slice(0,52);}
function base64(bytes:Uint8Array){let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);}
/** One platform-selected Sandbox per service runtime. Project code never gets
 * this transport; native start is guarded by the root-owned lifetime fence. */
export class SandboxServiceNativeBackend implements ServiceNativeBackend{
 readonly #sandbox:ServiceSandboxApi;readonly #source:PreviewRevisionSource;readonly #clock:()=>number;readonly #image:string;
 constructor(sandbox:ServiceSandboxApi,source:PreviewRevisionSource,runtimeImage:string,clock=Date.now){this.#sandbox=sandbox;this.#source=source;this.#image=runtimeImage;this.#clock=clock;}
 #input(raw:ServiceRuntimeInput){const input=serviceRuntimeInput(raw);if(input.spec.runtimeImage!==this.#image)throw Error('service-native-image-conflict');return input;}
 async #exec(command:string){const result=await this.#sandbox.exec(command,{timeout:15000,cwd:'/var/lib/riffology',env:ENV});if(!result.success||result.exitCode!==0||typeof result.stdout!=='string'||result.stdout.length>16384)throw Error('service-native-command-unconfirmed');try{return JSON.parse(result.stdout) as Record<string,unknown>;}catch{throw Error('invalid-service-native-result');}}
 async #operation(input:ServiceRuntimeInput,method:'start'|'observe'|'stop'){
  const token=await serviceNativeToken(input),raw=await this.#exec(`python3 ${PROGRAM} ${method} ${token}`);
  if(raw.schemaVersion!==1||raw.token!==token||Object.keys(raw).sort().join(',')!=='schemaVersion,status,stop,token')throw Error('invalid-service-native-result');
  let stop=null;if(raw.status==='stopped'){
   if(!raw.stop||typeof raw.stop!=='object'||Array.isArray(raw.stop)||Object.keys(raw.stop).sort().join(',')!=='confirmationId,fenced,observedAt')throw Error('invalid-service-native-stop');
   stop={...raw.stop,reference:input.reference,scope:input.scope};
  }else if(raw.stop!==null)throw Error('invalid-service-native-stop');
  return serviceRuntimeObservation({reference:input.reference,scope:input.scope,status:raw.status,stop},input,this.#clock());
 }
 async start(raw:ServiceRuntimeInput):Promise<ServiceRuntimeObservation>{
  const input=this.#input(raw),token=await serviceNativeToken(input);
  if(input.reference.deadlineAt<=this.#clock())return this.fenceAndStop(input);
  const archive=await this.#source.files(input.spec.plan.identity,input.spec.plan.revision);
  const actual=await new PreviewPlanResolver({async files(){return archive;}}).resolve(input.spec.plan.identity,input.spec.plan.revision);
  if(JSON.stringify(actual)!==JSON.stringify(input.spec.plan))throw Error('service-native-source-conflict');
  const d=input.spec.plan.declaration,control={schemaVersion:1,token,entrypoint:d.entrypoint,dependencyLock:d.dependencyLock,filesSha256:input.spec.plan.revision.filesSha256,declarationSha256:input.spec.plan.declarationSha256,entrypointSha256:input.spec.plan.entrypointSha256,dependencyLockSha256:input.spec.plan.dependencyLockSha256,deadlineAt:input.reference.deadlineAt,healthPath:d.healthPath};
  for(let offset=0;offset<archive.length;offset+=256*1024){
   const chunk=archive.subarray(offset,Math.min(offset+256*1024,archive.length));
   // The pinned SDK 0.12.9 does not forward exec stdin. Transfer data via
   // writeFile into the root-only directory; only validated token/offset enter
   // the command. Distinct chunk paths also isolate delayed command reads.
   const path=`/var/lib/riffology/archives/${token}.${offset}.chunk.json`;
   await this.#sandbox.writeFile(path,JSON.stringify({offset,total:archive.length,sha256:control.filesSha256,data:base64(chunk)}));
   const result=await this.#exec(`python3 ${UPLOAD} ${token} < ${path}`);
   if(result.schemaVersion!==1||result.token!==token||result.offset!==offset||result.bytes!==chunk.length||result.total!==archive.length||typeof result.complete!=='boolean'||(offset+chunk.length===archive.length&&!result.complete))throw Error('invalid-service-upload-receipt');
  }
  await this.#sandbox.writeFile(`/var/lib/riffology/services/${token}.input.json`,JSON.stringify(control));
  return this.#operation(input,'start');
 }
 observe(raw:ServiceRuntimeInput){return this.#operation(this.#input(raw),'observe');}
 fenceAndStop(raw:ServiceRuntimeInput){return this.#operation(this.#input(raw),'stop');}
}
