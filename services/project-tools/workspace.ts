import { sandboxActorIds } from '../sandbox/policy.ts';
import { sameScope, sha, turnBaseCheckpoints, turnDigest, type TurnBaseCheckpoints } from '../turn/protocol.ts';
import { turnRuntimeIdentity, type TurnRuntimeIdentity } from '../turn-runtime/identity.ts';
import type { WorkspaceFilesFreezePort } from '../turn-runtime/snapshot.ts';

export const PROJECT_WORKSPACE_ARCHIVE_ROOT='/var/lib/riffology/archives';
export const PROJECT_WORKSPACE_ARCHIVE_PROGRAM='/opt/riffology/platform_workspace_archive.py';
const MAX_ARCHIVE_BYTES=56*1024*1024,MAX_REPORT_BYTES=2048,EMPTY_TAR_BYTES=10*1024,encoder=new TextEncoder();

type ProcessResult={exitCode:number};
export interface WorkspaceArchiveProcess{
  readonly id:string;
  waitForExit(timeout?:number):Promise<ProcessResult>;
  getLogs():Promise<{stdout:string;stderr:string}>;
}
export interface ProjectWorkspaceSandboxApi{
  writeFile(path:string,content:string,options?:{encoding?:'utf8'|'base64'}):Promise<{success:boolean;path:string;bytesWritten?:number}>;
  readFile(path:string,options?:{encoding?:'utf8'|'base64'}):Promise<{success:boolean;path:string;content:string}>;
  startProcess(command:string,options:{processId:string;autoCleanup:false;timeout:number;cwd:string;encoding:'utf8';env:Record<string,string>}):Promise<WorkspaceArchiveProcess>;
}
export interface WorkspaceFilesRestorePort{
  restoreFiles(identity:TurnRuntimeIdentity,base:TurnBaseCheckpoints,archive:Uint8Array|null):Promise<{sha256:string;bytes:number}>;
}
type Report={ok:true;operation:'freeze'|'restore';bytes:number;sha256:string};
function reject(code:string):never{throw Error(code);}
function exact(value:unknown,keys:string[],code:string):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject(code);}
async function digest(bytes:Uint8Array):Promise<string>{const value=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));return [...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function base64(bytes:Uint8Array):string{let value='';for(let offset=0;offset<bytes.byteLength;offset+=32768)value+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(value);}
function unbase64(value:string):Uint8Array{let decoded:string;try{decoded=atob(value);}catch{reject('invalid-project-workspace-archive');}const bytes=new Uint8Array(decoded.length);for(let index=0;index<decoded.length;index++)bytes[index]=decoded.charCodeAt(index);return bytes;}
function report(stdout:string,operation:Report['operation']):Report{
  if(typeof stdout!=='string'||encoder.encode(stdout).byteLength>MAX_REPORT_BYTES)reject('invalid-project-workspace-archive-report');
  let value:unknown;try{value=JSON.parse(stdout);}catch{reject('invalid-project-workspace-archive-report');}exact(value,['bytes','ok','operation','sha256'],'invalid-project-workspace-archive-report');
  if(value.ok!==true||value.operation!==operation||!Number.isSafeInteger(value.bytes)||(value.bytes as number)<1||(value.bytes as number)>MAX_ARCHIVE_BYTES)reject('invalid-project-workspace-archive-report');
  return {ok:true,operation,bytes:value.bytes as number,sha256:sha(value.sha256)};
}
async function archiveToken(identity:TurnRuntimeIdentity):Promise<string>{return (await turnDigest({schemaVersion:1,purpose:'project-workspace-archive',identity})).slice(0,52);}

/** Project Sandbox archive adapter. The actor name is derived again for every
 * call; neither Pi nor an RPC caller can redirect restore/freeze to another VM.
 * Commands, paths, process ids and environment are fixed platform values. */
export class SandboxProjectWorkspacePort implements WorkspaceFilesFreezePort,WorkspaceFilesRestorePort{
  readonly #sandbox:ProjectWorkspaceSandboxApi;readonly #actorId:string;
  constructor(sandbox:ProjectWorkspaceSandboxApi,actorId:string){if(!sandbox?.writeFile||!sandbox.readFile||!sandbox.startProcess)reject('project-workspace-sandbox-required');this.#sandbox=sandbox;this.#actorId=actorId;}
  async #target(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw),actorId=(await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project;if(actorId!==this.#actorId)reject('project-workspace-actor-scope-denied');return {identity,token:await archiveToken(identity)};}
  async #run(operation:Report['operation'],token:string,deadlineAt?:number):Promise<Report>{
    const remaining=()=>{const timeout=deadlineAt===undefined?120_000:Math.min(120_000,deadlineAt-Date.now());if(!Number.isSafeInteger(timeout)||timeout<=0)reject('project-workspace-deadline-exceeded');return timeout;};
    const attempt=crypto.randomUUID().replaceAll('-','').slice(0,8),processId=`ws-${operation[0]}-${token.slice(0,40)}-${attempt}`,process=await this.#sandbox.startProcess(`/usr/bin/python3 ${PROJECT_WORKSPACE_ARCHIVE_PROGRAM} ${operation} ${token}`,{processId,autoCleanup:false,timeout:remaining(),cwd:'/',encoding:'utf8',env:{LANG:'C.UTF-8',PATH:'/usr/bin:/bin',RIFFOLOGY_WORKSPACE_ROOT:'/workspace',RIFFOLOGY_ARCHIVE_ROOT:PROJECT_WORKSPACE_ARCHIVE_ROOT}});
    if(process.id!==processId)reject('project-workspace-process-mismatch');const result=await process.waitForExit(remaining()),logs=await process.getLogs();
    if(!Number.isSafeInteger(result.exitCode)||result.exitCode!==0||typeof logs.stdout!=='string'||typeof logs.stderr!=='string'||logs.stderr.length)reject('project-workspace-archive-process-failed');return report(logs.stdout,operation);
  }
  async restoreFiles(raw:TurnRuntimeIdentity,rawBase:TurnBaseCheckpoints,rawArchive:Uint8Array|null,deadlineAt?:number){
    const {identity,token}=await this.#target(raw),base=turnBaseCheckpoints(rawBase);if(base.initial&&!sameScope(base.initial.reference.scope,identity.scope))reject('project-workspace-base-mismatch');let archive:Uint8Array;
    if(base.workspace===null&&!base.initial){if(rawArchive!==null)reject('project-workspace-base-mismatch');archive=new Uint8Array(EMPTY_TAR_BYTES);}
    else{if(!(rawArchive instanceof Uint8Array)||rawArchive.byteLength<1||rawArchive.byteLength>MAX_ARCHIVE_BYTES)reject('invalid-project-workspace-archive');archive=Uint8Array.from(rawArchive);if(await digest(archive)!==(base.workspace?.filesSha256??base.initial!.filesSha256))reject('project-workspace-base-mismatch');}
    if(deadlineAt!==undefined&&(!Number.isSafeInteger(deadlineAt)||deadlineAt<=Date.now()))reject('project-workspace-deadline-exceeded');
    const path=`${PROJECT_WORKSPACE_ARCHIVE_ROOT}/${token}.input.tar`,encoded=base64(archive),written=await this.#sandbox.writeFile(path,encoded,{encoding:'base64'});if(written.success!==true||written.path!==path||(written.bytesWritten!==undefined&&written.bytesWritten!==archive.byteLength))reject('project-workspace-archive-write-mismatch');
    const saved=await this.#sandbox.readFile(path,{encoding:'base64'});if(saved.success!==true||saved.path!==path||!saved.content||await digest(unbase64(saved.content))!==await digest(archive))reject('project-workspace-archive-write-mismatch');
    const completed=await this.#run('restore',token,deadlineAt);if(completed.bytes!==archive.byteLength||completed.sha256!==await digest(archive))reject('project-workspace-archive-result-mismatch');return {sha256:completed.sha256,bytes:completed.bytes};
  }
  async frozenFiles(raw:TurnRuntimeIdentity,rawBase:TurnBaseCheckpoints):Promise<Uint8Array>{
    const {identity,token}=await this.#target(raw),base=turnBaseCheckpoints(rawBase);if(base.initial&&!sameScope(base.initial.reference.scope,identity.scope))reject('project-workspace-base-mismatch');const completed=await this.#run('freeze',token),path=`${PROJECT_WORKSPACE_ARCHIVE_ROOT}/${token}.output.tar`,saved=await this.#sandbox.readFile(path,{encoding:'base64'});
    if(saved.success!==true||saved.path!==path||!saved.content)reject('project-workspace-archive-read-mismatch');const archive=unbase64(saved.content);if(archive.byteLength!==completed.bytes||archive.byteLength<1||archive.byteLength>MAX_ARCHIVE_BYTES||await digest(archive)!==completed.sha256)reject('project-workspace-archive-result-mismatch');return Uint8Array.from(archive);
  }
}

export const projectWorkspaceArchiveLimits={maxArchiveBytes:MAX_ARCHIVE_BYTES,emptyArchiveBytes:EMPTY_TAR_BYTES};
