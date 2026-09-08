import type { ProcessStatus } from '@cloudflare/sandbox';
import { turnId } from '../turn/protocol.ts';
import {
  PROJECT_EFFECT_MAX_STDERR_BYTES,
  PROJECT_EFFECT_MAX_STDOUT_BYTES,
  PROJECT_FILE_PROGRAM,
  PROJECT_WORKSPACE_ROOT,
  type ProjectEffectProcessObservation,
  type ProjectEffectStart,
} from './effect.ts';
import type { NativeProjectEffectPort, ProjectQuiescenceProof } from './supervisor.ts';

export const PROJECT_EFFECT_CONTROL_ROOT='/var/lib/riffology/effects';
export const PROJECT_EFFECT_WRAPPER='/opt/riffology/effect_wrapper.py';
const encoder=new TextEncoder();
const ACTIVE=new Set<ProcessStatus>(['starting','running']);
const EXITED=new Set<ProcessStatus>(['completed','failed']);

export interface SandboxProcessView{
  readonly id:string;
  readonly status:ProcessStatus;
  readonly exitCode?:number;
  getStatus():Promise<ProcessStatus>;
}
export interface ProjectSandboxProcessApi{
  writeFile(path:string,content:string,options?:{encoding?:'utf-8'|'utf8'|'base64';sessionId?:string}):Promise<{success:boolean;path:string;bytesWritten?:number;timestamp?:string}>;
  readFile(path:string,options?:{encoding?:'utf-8'|'utf8'|'base64';sessionId?:string}):Promise<{success:boolean;path:string;content:string;timestamp?:string}>;
  startProcess(command:string,options?:{
    timeout?:number;env?:Record<string,string|undefined>;cwd?:string;encoding?:string;
    processId?:string;autoCleanup?:boolean;
  }):Promise<SandboxProcessView>;
  getProcess(id:string,sessionId?:string):Promise<SandboxProcessView|null>;
  getProcessLogs(id:string,sessionId?:string):Promise<{stdout:string;stderr:string;processId:string}>;
}

function reject(code:string):never{throw Error(code);}
function byteLength(value:string):number{return encoder.encode(value).byteLength;}
function startRequest(value:ProjectEffectStart):ProjectEffectStart{
  if(!value||typeof value!=='object'||Array.isArray(value))reject('invalid-native-project-effect-start');
  const keys=['effectId','program','argv','cwd','env','stdin','timeoutMs'];
  if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject('invalid-native-project-effect-start');
  const effectId=turnId(value.effectId);
  if(value.program!==PROJECT_FILE_PROGRAM||value.cwd!==PROJECT_WORKSPACE_ROOT||!Array.isArray(value.argv)||value.argv.length!==0)reject('invalid-native-project-effect-start');
  const env=value.env;
  if(!env||typeof env!=='object'||Array.isArray(env)||Object.keys(env).length!==3||env.LANG!=='C.UTF-8'||env.PATH!=='/usr/bin:/bin'||env.RIFFOLOGY_WORKSPACE_ROOT!==PROJECT_WORKSPACE_ROOT)reject('invalid-native-project-effect-start');
  if(typeof value.stdin!=='string'||byteLength(value.stdin)>1_100_000||!Number.isSafeInteger(value.timeoutMs)||value.timeoutMs<1||value.timeoutMs>120_000)reject('invalid-native-project-effect-start');
  try{JSON.parse(value.stdin);}catch{reject('invalid-native-project-effect-start');}
  return {effectId,program:PROJECT_FILE_PROGRAM,argv:[],cwd:PROJECT_WORKSPACE_ROOT,env:{LANG:'C.UTF-8',PATH:'/usr/bin:/bin',RIFFOLOGY_WORKSPACE_ROOT:PROJECT_WORKSPACE_ROOT},stdin:value.stdin,timeoutMs:value.timeoutMs};
}
function active(effectId:string):ProjectEffectProcessObservation{return {schemaVersion:1,effectId,phase:'running',exitCode:null,stdout:null,stderr:null};}
function unknown(effectId:string):ProjectEffectProcessObservation{return {schemaVersion:1,effectId,phase:'unknown',exitCode:null,stdout:null,stderr:null};}
function absent(effectId:string):ProjectEffectProcessObservation{return {schemaVersion:1,effectId,phase:'absent',exitCode:null,stdout:null,stderr:null};}

/** Thin adapter over one Project Sandbox. Durable once-only fencing remains in
 * SqlProjectEffectSupervisor; this adapter never retries writeFile or startProcess. */
export class SandboxNativeProjectEffectPort implements NativeProjectEffectPort{
  #sandbox:ProjectSandboxProcessApi;
  constructor(sandbox:ProjectSandboxProcessApi){this.#sandbox=sandbox;}
  async sealAndDrain():Promise<ProjectQuiescenceProof>{
    const processId=`project-seal-${crypto.randomUUID()}`;
    const process=await this.#sandbox.startProcess('python3 /opt/riffology/process_quiescence.py seal',{
      processId,autoCleanup:false,timeout:15_000,cwd:'/',encoding:'utf8',env:{LANG:'C.UTF-8',PATH:'/usr/bin:/bin'},
    });
    if(process.id!==processId)reject('project-quiescence-process-mismatch');
    const deadline=Date.now()+20_000;
    while(ACTIVE.has(await process.getStatus())){
      if(Date.now()>=deadline)reject('project-quiescence-timeout');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const terminal=await this.#sandbox.getProcess(processId);
    if(!terminal||terminal.id!==processId||await terminal.getStatus()!=='completed'||terminal.exitCode!==0)reject('project-quiescence-unconfirmed');
    const logs=await this.#sandbox.getProcessLogs(processId);
    if(logs.processId!==processId||typeof logs.stdout!=='string'||byteLength(logs.stdout)>256||logs.stderr!=='')reject('invalid-project-quiescence-proof');
    let proof:ProjectQuiescenceProof;try{proof=JSON.parse(logs.stdout);}catch{reject('invalid-project-quiescence-proof');}
    if(!proof||Object.keys(proof).sort().join(',')!=='projectUid,quiescent,schemaVersion,sealed'||proof.schemaVersion!==1||proof.sealed!==true||proof.quiescent!==true||proof.projectUid!==10001)reject('invalid-project-quiescence-proof');
    return proof;
  }
  async start(raw:ProjectEffectStart):Promise<ProjectEffectProcessObservation>{
    const input=startRequest(raw),controlPath=`${PROJECT_EFFECT_CONTROL_ROOT}/${input.effectId}.json`;
    const control=JSON.stringify({schemaVersion:1,effectId:input.effectId,request:input.stdin});
    const written=await this.#sandbox.writeFile(controlPath,control,{encoding:'utf8'});
    if(written.success!==true||written.path!==controlPath||(written.bytesWritten!==undefined&&written.bytesWritten!==byteLength(control)))reject('native-project-effect-control-write-mismatch');
    const verified=await this.#sandbox.readFile(controlPath,{encoding:'utf8'});
    if(verified.success!==true||verified.path!==controlPath||verified.content!==control)reject('native-project-effect-control-readback-mismatch');
    const process=await this.#sandbox.startProcess(`python3 ${PROJECT_EFFECT_WRAPPER} ${input.effectId}`,{
      processId:input.effectId,autoCleanup:false,timeout:input.timeoutMs,cwd:PROJECT_WORKSPACE_ROOT,encoding:'utf8',env:input.env,
    });
    if(process.id!==input.effectId)reject('native-project-effect-identity-mismatch');
    return this.#observeProcess(input.effectId,process);
  }
  async observe(rawEffectId:string):Promise<ProjectEffectProcessObservation>{
    const effectId=turnId(rawEffectId),process=await this.#sandbox.getProcess(effectId);
    if(!process)return absent(effectId);
    if(process.id!==effectId)reject('native-project-effect-identity-mismatch');
    return this.#observeProcess(effectId,process);
  }
  async #observeProcess(effectId:string,initial:SandboxProcessView):Promise<ProjectEffectProcessObservation>{
    const status=await initial.getStatus();
    if(ACTIVE.has(status))return active(effectId);
    if(!EXITED.has(status))return unknown(effectId);
    const refreshed=await this.#sandbox.getProcess(effectId);
    if(!refreshed||refreshed.id!==effectId)return unknown(effectId);
    const exitCode=refreshed.exitCode;
    if(!Number.isSafeInteger(exitCode)||exitCode!<0||exitCode!>255)return unknown(effectId);
    const logs=await this.#sandbox.getProcessLogs(effectId);
    if(logs.processId!==effectId||typeof logs.stdout!=='string'||typeof logs.stderr!=='string')reject('invalid-native-project-effect-logs');
    if(byteLength(logs.stdout)>PROJECT_EFFECT_MAX_STDOUT_BYTES||byteLength(logs.stderr)>PROJECT_EFFECT_MAX_STDERR_BYTES)reject('native-project-effect-logs-too-large');
    return {schemaVersion:1,effectId,phase:'exited',exitCode:exitCode!,stdout:logs.stdout,stderr:logs.stderr};
  }
}
