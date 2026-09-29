import type {ServiceSandboxApi} from '../run/native.ts';
import {simulationPlan,digest,type SimulationPlan} from './source.ts';
import {previewSourceFilesSha256} from '../preview/source.ts';
import type {ParameterValues} from './model-spec.ts';
export type SimulationInput={runId:string;plan:SimulationPlan;parameters:ParameterValues;seed:number;deadlineAt:number;runtimeImage:string};
export type NativeObservation={status:'absent'|'running'|'stopped';result:unknown|null;stop:{confirmationId:string;observedAt:number;fenced:true}|null};
export interface SimulationSandboxApi extends ServiceSandboxApi{destroy():Promise<void>;releaseState():Promise<{running:boolean}>}
export async function simulationToken(input:SimulationInput){return (await digest(JSON.stringify(input))).slice(0,52);}
export class SimulationNative{
 readonly sandbox:SimulationSandboxApi;readonly input:SimulationInput;
 constructor(sandbox:SimulationSandboxApi,input:SimulationInput){this.sandbox=sandbox;this.input=input;}
 async operation(action:'start'|'observe'|'stop'):Promise<NativeObservation>{
  const token=await simulationToken(this.input),result=await this.sandbox.exec(`python3 /opt/riffology/simulation_process.py ${action} ${token}`,{timeout:15000,cwd:'/var/lib/riffology',env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8'}});
  if(!result.success||result.exitCode!==0||typeof result.stdout!=='string'||result.stdout.length>131072)throw Error('simulation-native-unconfirmed');
  const raw=JSON.parse(result.stdout);
  if(!raw||raw.token!==token||raw.schemaVersion!==1||Object.keys(raw).sort().join(',')!=='result,schemaVersion,status,stop,token'||!['absent','running','stopped'].includes(raw.status))throw Error('simulation-native-invalid');
  if(raw.result!==null){
   const {nativeObservation,...legacy}=raw.result;
   if(new TextEncoder().encode(JSON.stringify(legacy)).byteLength>66560||nativeObservation!==undefined&&new TextEncoder().encode(JSON.stringify(nativeObservation)).byteLength>4096)throw Error('simulation-native-invalid');
  }
  if(raw.status==='stopped'){
   const s=raw.stop;if(!s||Object.keys(s).sort().join(',')!=='confirmationId,fenced,observedAt'||s.fenced!==true||typeof s.confirmationId!=='string'||s.confirmationId!==await digest('simulation-stop:'+token)||!Number.isSafeInteger(s.observedAt)||s.observedAt<1||s.observedAt>Date.now())throw Error('simulation-stop-invalid');
  }else if(raw.stop!==null||raw.result!==null)throw Error('simulation-native-invalid');
  return {status:raw.status,result:raw.result,stop:raw.stop};
 }
 async start(bytes:Uint8Array){
  const input=this.input;let stage="source";
  try{
  const token=await simulationToken(input),actual=await simulationPlan(input.plan.source,bytes);
  if(JSON.stringify(actual)!==JSON.stringify(input.plan))throw Error('simulation-source-mismatch');
  for(let offset=0;offset<bytes.length;offset+=262144){
   const chunk=bytes.subarray(offset,offset+262144);let binary='';for(let i=0;i<chunk.length;i+=8192)binary+=String.fromCharCode(...chunk.subarray(i,i+8192));
   stage="archive-write";
   const path=`/var/lib/riffology/archives/${token}.${offset}.chunk.json`;
   await this.sandbox.writeFile(path,JSON.stringify({offset,total:bytes.length,sha256:previewSourceFilesSha256(input.plan.source),data:btoa(binary)}));
   stage="archive-upload";
   const result=await this.sandbox.exec(`python3 /opt/riffology/service_upload.py ${token} < ${path}`,{timeout:15000,cwd:'/var/lib/riffology',env:{PATH:'/usr/local/bin:/usr/bin:/bin'}});
   if(!result.success||result.exitCode!==0)throw Error('simulation-upload-unconfirmed');
   const receipt=JSON.parse(result.stdout);if(receipt.token!==token||receipt.offset!==offset||receipt.bytes!==chunk.length||receipt.total!==bytes.length||offset+chunk.length===bytes.length&&receipt.complete!==true)throw Error('simulation-upload-invalid');
  }
  stage="control-write";
  const execution=input.plan.spec.execution;
  let control:Record<string,unknown>;
  if('kind' in execution){
    if(!input.plan.compiler||input.plan.executionProfile!=='sim-engine-compiler-0.1.0/v1')throw Error('simulation-source-mismatch');
    control={schemaVersion:2,token,runId:input.runId,filesSha256:previewSourceFilesSha256(input.plan.source),specSha256:input.plan.specSha256,businessIr:execution.businessIr,businessSha256:input.plan.businessSha256,bundle:execution.bundle,bundleSha256:input.plan.bundleSha256,executionProfile:input.plan.executionProfile,parameters:input.parameters,seed:input.seed,deadlineAt:input.deadlineAt};
  }else{
    if(input.plan.compiler)throw Error('simulation-source-mismatch');
    control={schemaVersion:1,token,runId:input.runId,filesSha256:previewSourceFilesSha256(input.plan.source),specSha256:input.plan.specSha256,entrypoint:execution.entrypoint,entrypointSha256:input.plan.entrypointSha256,dependencyLock:execution.dependencyLock,dependencyLockSha256:input.plan.dependencyLockSha256,parameters:input.parameters,seed:input.seed,deadlineAt:input.deadlineAt};
  }
  await this.sandbox.writeFile(`/var/lib/riffology/services/${token}.input.json`,JSON.stringify(control));
  stage="native-start";
  return await this.operation('start');
  }catch(error){const message=error instanceof Error?error.message:'';console.error('simulation-start-unconfirmed',{runId:input.runId,stage,code:/^[a-z0-9-]{1,100}$/.test(message)?message:'transport-error'});throw error;}
 }
}
