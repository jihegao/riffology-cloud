import { positive, sameScope, scope as validateScope, turnId, type TurnScope } from '../turn/protocol.ts';
import { normalizeToolCommand, toolCommandDigest, type ToolCommand } from '../tools/protocol.ts';
import type { ToolCommandReference, ToolEffectReceipt } from '../tools/ledger.ts';
import type { ToolEffectPort } from '../tools/dispatcher.ts';

type ProjectOperation='read'|'read_page'|'write'|'edit'|'list'|'search'|'bash';
type ProcessPhase='absent'|'unknown'|'running'|'exited';
export type ProjectEffectProcessObservation={
  schemaVersion:1;effectId:string;phase:ProcessPhase;exitCode:number|null;stdout:string|null;stderr:string|null;
};
export type ProjectEffectStart={
  effectId:string;program:string;argv:string[];cwd:string;env:Record<string,string>;stdin:string;timeoutMs:number;
};
export interface ProjectEffectSupervisorPort{
  /** Starts at most one process for effectId and durably retains its observation.
   * A transport error after this call begins must never be interpreted as absent. */
  start(input:ProjectEffectStart):Promise<ProjectEffectProcessObservation>;
  observe(effectId:string):Promise<ProjectEffectProcessObservation>;
}

const PROJECT_OPERATIONS=new Set<ProjectOperation>(['read','read_page','write','edit','list','search','bash']);
const READ_ONLY=new Set<ProjectOperation>(['read','read_page','list','search']);
const PHASES=new Set<ProcessPhase>(['absent','unknown','running','exited']);
export const PROJECT_EFFECT_MAX_STDOUT_BYTES=1_100_000;
export const PROJECT_EFFECT_MAX_STDERR_BYTES=16_384;
export const PROJECT_FILE_PROGRAM='/opt/riffology/file_service.py';
export const PROJECT_WORKSPACE_ROOT='/workspace';
const encoder=new TextEncoder();

function reject(code:string):never{throw Error(code);}
function exact(value:unknown,keys:string[],code:string):asserts value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject(code);
}
function boundedString(value:unknown,max:number,code:string):string{
  if(typeof value!=='string'||encoder.encode(value).byteLength>max)reject(code);return value;
}
function identity(value:{scope:TurnScope;turnId:string;dispatchId:string;commandId:string;effectId:string}){
  return {scope:validateScope(value.scope),turnId:turnId(value.turnId),dispatchId:turnId(value.dispatchId),commandId:turnId(value.commandId),effectId:turnId(value.effectId)};
}
export function validateProjectEffectProcessObservation(value:unknown,expectedEffectId:string):ProjectEffectProcessObservation{
  exact(value,['schemaVersion','effectId','phase','exitCode','stdout','stderr'],'invalid-project-effect-observation');
  if(value.schemaVersion!==1||typeof value.phase!=='string'||!PHASES.has(value.phase as ProcessPhase)||turnId(value.effectId)!==expectedEffectId)reject('invalid-project-effect-observation');
  const phase=value.phase as ProcessPhase;
  if(phase!=='exited'){
    if(value.exitCode!==null||value.stdout!==null||value.stderr!==null)reject('invalid-project-effect-observation');
    return {schemaVersion:1,effectId:expectedEffectId,phase,exitCode:null,stdout:null,stderr:null};
  }
  if(!Number.isSafeInteger(value.exitCode)||(value.exitCode as number)<0||(value.exitCode as number)>255)reject('invalid-project-effect-observation');
  return {schemaVersion:1,effectId:expectedEffectId,phase,exitCode:value.exitCode as number,stdout:boundedString(value.stdout,PROJECT_EFFECT_MAX_STDOUT_BYTES,'project-effect-output-too-large'),stderr:boundedString(value.stderr,PROJECT_EFFECT_MAX_STDERR_BYTES,'project-effect-output-too-large')};
}
function plainJson(value:string):Record<string,unknown>|null{
  try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&Object.getPrototypeOf(parsed)===Object.prototype?parsed:null;}catch{return null;}
}
function effectResult(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)reject('project-tool-invalid-output');
  let text:string;try{text=JSON.stringify(value);}catch{reject('project-tool-invalid-output');}
  if(encoder.encode(text).byteLength>1_060_000||text.includes('"__proto__"'))reject('project-tool-result-too-large');return JSON.parse(text);
}
function terminal(base:ReturnType<typeof identity>,observedAt:number,outcome:'completed'|'failed',errorCode:string|null,result:Record<string,unknown>):ToolEffectReceipt{
  return {schemaVersion:1,...base,phase:'terminal',outcome,errorCode,result,observedAt};
}
function nonterminal(base:ReturnType<typeof identity>,observedAt:number,phase:'absent'|'unknown'|'running'):ToolEffectReceipt{
  return {schemaVersion:1,...base,phase,outcome:null,errorCode:null,result:null,observedAt};
}
function safeError(value:unknown):string|null{
  try{return turnId(value);}catch{return null;}
}
function decodeExited(base:ReturnType<typeof identity>,operation:ProjectOperation,value:ProjectEffectProcessObservation,observedAt:number):ToolEffectReceipt{
  const body=plainJson(value.stdout!);
  if(value.exitCode===4){
    if(body&&Object.keys(body).length===3&&body.ok===false&&body.unknown===true&&safeError(body.error))return nonterminal(base,observedAt,'unknown');
    return nonterminal(base,observedAt,'unknown');
  }
  if(value.exitCode===2){
    if(body&&Object.keys(body).length===2&&body.ok===false){const code=safeError(body.error);if(code){if(operation==='bash'&&(code==='project-tool-bash-timeout'||code==='project-tool-result-too-large'))return nonterminal(base,observedAt,'unknown');return terminal(base,observedAt,'failed',code,{});}}
    return READ_ONLY.has(operation)?terminal(base,observedAt,'failed','project-tool-invalid-output',{}):nonterminal(base,observedAt,'unknown');
  }
  if(value.exitCode!==0)return READ_ONLY.has(operation)?terminal(base,observedAt,'failed','project-tool-process-failed',{}):nonterminal(base,observedAt,'unknown');
  if(!body||Object.keys(body).length!==2||body.ok!==true)return READ_ONLY.has(operation)?terminal(base,observedAt,'failed','project-tool-invalid-output',{}):nonterminal(base,observedAt,'unknown');
  try{return terminal(base,observedAt,'completed',null,effectResult(body.result));}
  catch{return READ_ONLY.has(operation)?terminal(base,observedAt,'failed','project-tool-result-too-large',{}):nonterminal(base,observedAt,'unknown');}
}

/** Converts a platform-owned command into a fixed, no-shell file helper call.
 * The helper receives no tenant, Turn, dispatch, command or effect identity and
 * cannot author the receipt envelope. */
export class ProjectFileEffectPort implements ToolEffectPort{
  #supervisor:ProjectEffectSupervisorPort;#clock:()=>number;
  constructor(supervisor:ProjectEffectSupervisorPort,clock:()=>number=Date.now){this.#supervisor=supervisor;this.#clock=clock;}
  async execute(input:{command:ToolCommand;effectId:string}):Promise<ToolEffectReceipt>{
    const command=normalizeToolCommand(input.command),effectId=turnId(input.effectId),base=identity({...command,effectId}),now=positive(this.#clock());
    if(!PROJECT_OPERATIONS.has(command.operation as ProjectOperation))return terminal(base,now,'failed','project-tool-operation-unsupported',{});
    if(command.deadlineAt<=now)return terminal(base,now,'failed','tool-deadline-expired',{});
    const remaining=command.deadlineAt-now;if(remaining>120_000)reject('invalid-tool-deadline');
    const request=JSON.stringify({deadlineAt:command.deadlineAt,operation:command.operation,arguments:command.arguments});
    const raw=await this.#supervisor.start({effectId,program:PROJECT_FILE_PROGRAM,argv:[],cwd:PROJECT_WORKSPACE_ROOT,env:{LANG:'C.UTF-8',PATH:'/usr/bin:/bin',RIFFOLOGY_WORKSPACE_ROOT:PROJECT_WORKSPACE_ROOT},stdin:request,timeoutMs:remaining});
    return this.#receipt(base,command.operation as ProjectOperation,raw,false);
  }
  async observe(input:{reference:ToolCommandReference;command:ToolCommand}):Promise<ToolEffectReceipt>{
    const command=normalizeToolCommand(input.command),base=identity(input.reference);
    if(command.turnId!==base.turnId||command.dispatchId!==base.dispatchId||command.commandId!==base.commandId||!sameScope(command.scope,base.scope)||await toolCommandDigest(command)!==input.reference.digest)reject('project-effect-command-mismatch');
    if(!PROJECT_OPERATIONS.has(command.operation as ProjectOperation))return terminal(base,positive(this.#clock()),'failed','project-tool-operation-unsupported',{});
    const raw=await this.#supervisor.observe(base.effectId);
    return this.#receipt(base,command.operation as ProjectOperation,raw,true);
  }
  #receipt(base:ReturnType<typeof identity>,operation:ProjectOperation|null,raw:unknown,observing:boolean):ToolEffectReceipt{
    const now=positive(this.#clock()),found=validateProjectEffectProcessObservation(raw,base.effectId);
    if(found.phase==='running')return nonterminal(base,now,'running');
    if(found.phase==='unknown')return nonterminal(base,now,'unknown');
    if(found.phase==='absent')return nonterminal(base,now,observing?'absent':'unknown');
    return decodeExited(base,operation!,found,now);
  }
}
