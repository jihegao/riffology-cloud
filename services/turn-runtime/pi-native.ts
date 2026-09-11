import { actor as validateActor, message, positive, sha, turnBaseCheckpoints, turnDigest, turnId, type CheckpointReceipt, type TurnActor, type TurnBaseCheckpoints } from '../turn/protocol.ts';
import { sameTurnRuntimeIdentity, turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import type { TrustedPiHostEvent, TrustedPiHostObservation, TrustedPiHostPort } from './pi-execution.ts';

export const TRUSTED_PI_CONTROL_ROOT='/var/lib/riffology/turns';
export const TRUSTED_PI_HOST_PROGRAM='/opt/riffology/trusted-pi/trusted-pi-turn-host.mjs';
export const TRUSTED_PI_NODE='/usr/local/bin/node';
const MAX_RESULT_BYTES=2*1024*1024,MAX_SESSION_BYTES=8*1024*1024,ACTIVE=new Set(['starting','running']),EXITED=new Set(['completed','failed']),encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});

export interface TrustedPiProcessView{readonly id:string;readonly status:string;readonly exitCode?:number;getStatus():Promise<string>;kill(signal?:string):Promise<void>}
export interface TrustedPiSandboxProcessApi{
  writeFile(path:string,content:string,options?:{encoding?:'utf8'|'base64'}):Promise<{success:boolean;path:string;bytesWritten?:number}>;
  readFile(path:string,options?:{encoding?:'utf8'|'base64'}):Promise<{success:boolean;path:string;content:string}>;
  startProcess(command:string,options:{processId:string;autoCleanup:false;timeout:number;cwd:string;encoding:'utf8';env:Record<string,string>}):Promise<TrustedPiProcessView>;
  getProcess(id:string):Promise<TrustedPiProcessView|null>;
  destroyAndReleaseState():Promise<{running:boolean}>;
  /** Must bypass SDK session initialization and container auto-start. */
  queryObserverExecution?(identity:TurnRuntimeIdentity):Promise<{expiresAt:number}>;
}
export interface TrustedPiSessionSource{load(identity:TurnRuntimeIdentity,checkpoint:CheckpointReceipt|null):Promise<Uint8Array|null>}
export interface TrustedPiSessionFreezePort{frozenSession(identity:TurnRuntimeIdentity):Promise<Uint8Array>}

type Control={schemaVersion:1|2;identity:TurnRuntimeIdentity;actor:TurnActor;message:string;inputSessionSha256:string|null;executionDeadlineAt?:number};
type Result={schemaVersion:1;identity:TurnRuntimeIdentity;phase:'running'|'terminal';outcome:'completed'|'failed'|'cancelled'|'interrupted'|null;executionErrorCode:string|null;events:TrustedPiHostEvent[];outputSessionSha256:string|null};
function reject(code:string):never{throw Error(code);}
function exact(value:unknown,keys:string[],code:string):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject(code);}
async function digest(bytes:Uint8Array):Promise<string>{const value=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));return [...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function base64(bytes:Uint8Array):string{let binary='';for(let offset=0;offset<bytes.byteLength;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(binary);}
function unbase64(value:string):Uint8Array{let binary:string;try{binary=atob(value);}catch{reject('invalid-trusted-pi-session-file');}const bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);return bytes;}
function sessionSnapshot(bytes:Uint8Array,identity:TurnRuntimeIdentity):Uint8Array{let parsed:unknown;try{parsed=JSON.parse(decoder.decode(bytes));}catch{reject('invalid-trusted-pi-session-file');}exact(parsed,['format','scope','createdAt','entries','leafId'],'invalid-trusted-pi-session-file');if(parsed.format!=='riffology-pi-session-v1'||!Array.isArray(parsed.entries)||typeof parsed.createdAt!=='string'||(parsed.leafId!==null&&typeof parsed.leafId!=='string'))reject('invalid-trusted-pi-session-file');exact(parsed.scope,['tenantId','projectId','sessionId'],'invalid-trusted-pi-session-file');if(parsed.scope.tenantId!==identity.scope.tenantId||parsed.scope.projectId!==identity.scope.projectId||parsed.scope.sessionId!==identity.sessionId)reject('trusted-pi-native-scope-denied');return bytes;}
async function token(identity:TurnRuntimeIdentity):Promise<string>{return (await turnDigest({schemaVersion:1,purpose:'trusted-pi-native',identity:turnRuntimeIdentity(identity)})).slice(0,52);}
async function paths(identity:TurnRuntimeIdentity){const id=await token(identity),root=`${TRUSTED_PI_CONTROL_ROOT}/${id}`;return {id,control:`${root}.control.json`,inputSession:`${root}.input-session.json`,result:`${root}.result.json`,outputSession:`${root}.output-session.json`,processId:`pi-${id}`};}
function missing(error:unknown):boolean{return error instanceof Error&&/(not found|missing|enoent|404)/i.test(error.message);}
async function readText(sandbox:Pick<TrustedPiSandboxProcessApi,'readFile'>,path:string,max:number):Promise<string|null>{let value;try{value=await sandbox.readFile(path,{encoding:'utf8'});}catch(error){if(missing(error))return null;throw error;}if(value.success!==true||value.path!==path||typeof value.content!=='string'||encoder.encode(value.content).byteLength>max)reject('invalid-trusted-pi-native-file');return value.content;}
async function writeVerified(sandbox:TrustedPiSandboxProcessApi,path:string,content:string,encoding:'utf8'|'base64'){const saved=await sandbox.writeFile(path,content,{encoding});if(saved.success!==true||saved.path!==path)reject('trusted-pi-native-write-mismatch');const read=await sandbox.readFile(path,{encoding});if(read.success!==true||read.path!==path||read.content!==content)reject('trusted-pi-native-write-mismatch');}
function control(value:unknown,expected:TurnRuntimeIdentity):Control{const version=(value as Control)?.schemaVersion;exact(value,['schemaVersion','identity','actor','message','inputSessionSha256',...(version===2?['executionDeadlineAt']:[])],'invalid-trusted-pi-control');if(version!==1&&version!==2)reject('invalid-trusted-pi-control');const identity=turnRuntimeIdentity(value.identity);if(!sameTurnRuntimeIdentity(identity,expected))reject('trusted-pi-native-scope-denied');return {schemaVersion:version,identity,actor:validateActor(value.actor),message:message(value.message),inputSessionSha256:value.inputSessionSha256===null?null:sha(value.inputSessionSha256),...(version===2?{executionDeadlineAt:positive(value.executionDeadlineAt)}:{})};}
function result(value:unknown,expected:TurnRuntimeIdentity):Result{exact(value,['schemaVersion','identity','phase','outcome','executionErrorCode','events','outputSessionSha256'],'invalid-trusted-pi-result');if(value.schemaVersion!==1||!['running','terminal'].includes(value.phase as string)||!Array.isArray(value.events))reject('invalid-trusted-pi-result');const identity=turnRuntimeIdentity(value.identity);if(!sameTurnRuntimeIdentity(identity,expected))reject('trusted-pi-native-scope-denied');const phase=value.phase as Result['phase'],outcome=value.outcome===null?null:['completed','failed','cancelled','interrupted'].includes(value.outcome as string)?value.outcome as Result['outcome']:reject('invalid-trusted-pi-result'),executionErrorCode=value.executionErrorCode===null?null:turnId(value.executionErrorCode),outputSessionSha256=value.outputSessionSha256===null?null:sha(value.outputSessionSha256);if(phase==='terminal'){if(!outcome||!outputSessionSha256||(outcome==='completed'&&executionErrorCode!==null))reject('invalid-trusted-pi-result');}else if(outcome!==null||executionErrorCode!==null||outputSessionSha256!==null)reject('invalid-trusted-pi-result');return {schemaVersion:1,identity,phase,outcome,executionErrorCode,events:value.events as TrustedPiHostEvent[],outputSessionSha256};}
function empty(identity:TurnRuntimeIdentity,phase:'absent'|'unknown'|'starting'):TrustedPiHostObservation{return {identity,phase,outcome:null,executionErrorCode:null,events:[],stopped:null};}

/** Runs only against a dedicated non-starting reader; never pass the ordinary SDK. */
export async function readCurrentObserverExecution(reader:Pick<TrustedPiSandboxProcessApi,'readFile'|'getProcess'>,raw:TurnRuntimeIdentity,clock:()=>number=Date.now):Promise<{expiresAt:number}>{
    const identity=turnRuntimeIdentity(raw),location=await paths(identity);
    const first=await readText(reader,location.control,64*1024);if(!first)reject('trusted-pi-observer-denied');
    const saved=control(JSON.parse(first),identity),expiresAt=saved.executionDeadlineAt;
    if(saved.schemaVersion!==2||expiresAt===undefined||expiresAt<=clock())reject('trusted-pi-observer-denied');
    const process=await reader.getProcess(location.processId);
    if(!process||process.id!==location.processId||await process.getStatus()!=='running')reject('trusted-pi-observer-denied');
    const stateText=await readText(reader,location.result,MAX_RESULT_BYTES);
    if(!stateText||result(JSON.parse(stateText),identity).phase!=='running')reject('trusted-pi-observer-denied');
    const latest=await readText(reader,location.control,64*1024);
    if(latest!==first||await process.getStatus()!=='running'||expiresAt<=clock())reject('trusted-pi-observer-denied');
    return {expiresAt};
}

/** Native Sandbox process adapter. ProductTurnRuntime owns the once-only
 * Pi execution fence. Ordinary recovery reads still use the SDK lifecycle;
 * only the dedicated Observer reader avoids container auto-start. Repeated
 * start with an existing control file does not dispatch another Pi process. */
export class SandboxTrustedPiHostPort implements TrustedPiHostPort,TrustedPiSessionFreezePort{
  readonly #sandbox:TrustedPiSandboxProcessApi;readonly #sessions:TrustedPiSessionSource;readonly #clock:()=>number;
  constructor(sandbox:TrustedPiSandboxProcessApi,sessions:TrustedPiSessionSource,clock:()=>number=Date.now){if(!sandbox?.writeFile||!sandbox.readFile||!sandbox.startProcess||!sandbox.getProcess||!sandbox.destroyAndReleaseState||!sessions?.load)reject('trusted-pi-native-required');this.#sandbox=sandbox;this.#sessions=sessions;this.#clock=clock;}
  async start(raw:TurnRuntimeIdentity&{actor:TurnActor;message:string;base:TurnBaseCheckpoints;executionDeadlineAt?:number}):Promise<TrustedPiHostObservation>{
    const executionDeadlineAt=raw.executionDeadlineAt===undefined?undefined:positive(raw.executionDeadlineAt);
    if(executionDeadlineAt!==undefined&&(executionDeadlineAt<=this.#clock()||executionDeadlineAt>this.#clock()+600000))reject('trusted-pi-execution-expired');
    const identity=turnRuntimeIdentity({scope:raw.scope,sessionId:raw.sessionId,turnId:raw.turnId,dispatchId:raw.dispatchId,generation:raw.generation}),actor=validateActor(raw.actor),base=turnBaseCheckpoints(raw.base),text=message(raw.message),location=await paths(identity),prior=await readText(this.#sandbox,location.control,64*1024),snapshot=await this.#sessions.load(identity,base.session);
    if((base.session===null)!==(snapshot===null))reject('trusted-pi-session-base-mismatch');
    if(snapshot!==null&&(snapshot.byteLength<1||snapshot.byteLength>MAX_SESSION_BYTES))reject('invalid-trusted-pi-session-file');if(snapshot!==null)sessionSnapshot(snapshot,identity);const inputSessionSha256=snapshot===null?null:await digest(snapshot);if(base.session&&inputSessionSha256!==base.session.sessionSha256)reject('trusted-pi-session-base-mismatch');const expected:Control={schemaVersion:executionDeadlineAt===undefined?1:2,identity,actor,message:text,inputSessionSha256,...(executionDeadlineAt===undefined?{}:{executionDeadlineAt})};
    if(prior!==null){if(JSON.stringify(control(JSON.parse(prior),identity))!==JSON.stringify(expected))reject('trusted-pi-native-control-conflict');return this.observe(identity);}
    if(snapshot!==null)await writeVerified(this.#sandbox,location.inputSession,base64(snapshot),'base64');
    await writeVerified(this.#sandbox,location.control,JSON.stringify(expected),'utf8');
    const remaining=executionDeadlineAt===undefined?600000:executionDeadlineAt-this.#clock();if(remaining<=0)reject('trusted-pi-execution-expired');
    const process=await this.#sandbox.startProcess(`${TRUSTED_PI_NODE} ${TRUSTED_PI_HOST_PROGRAM} ${location.id}`,{processId:location.processId,autoCleanup:false,timeout:remaining,cwd:'/var/lib/riffology',encoding:'utf8',env:{LANG:'C.UTF-8',PATH:'/usr/local/bin:/usr/bin:/bin'}});if(process.id!==location.processId)reject('trusted-pi-native-process-mismatch');return this.#observe(identity,process,location);
  }
  async currentObserverExecution(raw:TurnRuntimeIdentity):Promise<{expiresAt:number}>{
    const identity=turnRuntimeIdentity(raw);
    if(!this.#sandbox.queryObserverExecution)reject('trusted-pi-observer-reader-required');
    const value=await this.#sandbox.queryObserverExecution(identity);
    exact(value,['expiresAt'],'trusted-pi-observer-denied');
    const expiresAt=positive(value.expiresAt);if(expiresAt<=this.#clock())reject('trusted-pi-observer-denied');
    return {expiresAt};
  }
  async observe(raw:TurnRuntimeIdentity):Promise<TrustedPiHostObservation>{const identity=turnRuntimeIdentity(raw),location=await paths(identity),process=await this.#sandbox.getProcess(location.processId);return this.#observe(identity,process,location);}
  async cancel(raw:TurnRuntimeIdentity):Promise<TrustedPiHostObservation>{
    const identity=turnRuntimeIdentity(raw),location=await paths(identity),process=await this.#sandbox.getProcess(location.processId);
    if(process){const state=await process.getStatus();if(ACTIVE.has(state))await process.kill('SIGTERM');}
    const observed=await this.#observe(identity,process,location);
    // ProductTurnRuntime supplies the durable cancellation fence. When the
    // fenced native process and all of its control files are absent, there is
    // no execution left to signal or checkpoint. Record an interruption with
    // explicit stopped proof so a lost container cannot hold the Workspace
    // lock forever. Ordinary observe remains fail closed.
    if(observed.phase==='absent')return {identity,phase:'terminal',outcome:'interrupted',executionErrorCode:'turn-native-execution-absent',events:[],stopped:{confirmationId:`stop-${location.id}`,observedAt:positive(this.#clock()),nativeRunning:false,fenced:true}};
    return observed;
  }
  async release(raw:TurnRuntimeIdentity):Promise<{running:boolean}>{
    turnRuntimeIdentity(raw);const state=await this.#sandbox.destroyAndReleaseState();
    exact(state,['running'],'invalid-trusted-pi-release-state');if(typeof state.running!=='boolean')reject('invalid-trusted-pi-release-state');return {running:state.running};
  }
  async frozenSession(raw:TurnRuntimeIdentity):Promise<Uint8Array>{const identity=turnRuntimeIdentity(raw),location=await paths(identity),observation=await this.observe(identity);if(observation.phase!=='terminal')reject('trusted-pi-session-not-frozen');const resultText=await readText(this.#sandbox,location.result,MAX_RESULT_BYTES);if(!resultText)reject('trusted-pi-session-not-frozen');const saved=result(JSON.parse(resultText),identity),encoded=await readText(this.#sandbox,location.outputSession,Math.ceil(MAX_SESSION_BYTES*4/3)+4);if(!encoded)reject('trusted-pi-session-not-frozen');const bytes=unbase64(encoded);if(bytes.byteLength<1||bytes.byteLength>MAX_SESSION_BYTES||await digest(bytes)!==saved.outputSessionSha256)reject('invalid-trusted-pi-session-file');return Uint8Array.from(sessionSnapshot(bytes,identity));}
  async #observe(identity:TurnRuntimeIdentity,initial:TrustedPiProcessView|null,location:Awaited<ReturnType<typeof paths>>):Promise<TrustedPiHostObservation>{
    const controlText=await readText(this.#sandbox,location.control,64*1024);if(controlText!==null)control(JSON.parse(controlText),identity);const resultText=await readText(this.#sandbox,location.result,MAX_RESULT_BYTES),saved=resultText===null?null:result(JSON.parse(resultText),identity);
    // A terminal file proves only that the child wrote a result and a frozen
    // session. When the process registry is unavailable it does not prove that
    // the same native process has stopped, so fail closed until a supervisor
    // supplies an explicit exit observation.
    if(!initial){if(!controlText&&!saved)return empty(identity,'absent');return empty(identity,'unknown');}
    if(initial.id!==location.processId)reject('trusted-pi-native-process-mismatch');const state=await initial.getStatus();if(ACTIVE.has(state)){if(saved?.phase==='terminal')reject('trusted-pi-native-terminal-process-running');return saved?{identity,phase:'running',outcome:null,executionErrorCode:null,events:saved.events,stopped:null}:empty(identity,'starting');}
    if(!EXITED.has(state)||!Number.isSafeInteger(initial.exitCode))return empty(identity,'unknown');
    if(initial.exitCode!==0||saved?.phase!=='terminal'){
      const reason=initial.exitCode!==0?'turn-native-exit-failed':'turn-native-result-missing',observedAt=positive(this.#clock());
      return {identity,phase:'terminal',outcome:'failed',executionErrorCode:reason,events:[],stopped:{confirmationId:`stop-${location.id}`,observedAt,nativeRunning:false,fenced:true}};
    }
    return this.#terminal(identity,saved,location);
  }
  async #terminal(identity:TurnRuntimeIdentity,saved:Result,location:Awaited<ReturnType<typeof paths>>):Promise<TrustedPiHostObservation>{const encoded=await readText(this.#sandbox,location.outputSession,Math.ceil(MAX_SESSION_BYTES*4/3)+4);if(!encoded)reject('trusted-pi-session-not-frozen');const bytes=unbase64(encoded);if(bytes.byteLength<1||bytes.byteLength>MAX_SESSION_BYTES||await digest(bytes)!==saved.outputSessionSha256)reject('invalid-trusted-pi-session-file');sessionSnapshot(bytes,identity);const observedAt=positive(this.#clock());return {identity,phase:'terminal',outcome:saved.outcome,executionErrorCode:saved.executionErrorCode,events:saved.events,stopped:{confirmationId:`stop-${location.id}`,observedAt,nativeRunning:false,fenced:true}};}
}

export const trustedPiNativeLimits={maxResultBytes:MAX_RESULT_BYTES,maxSessionBytes:MAX_SESSION_BYTES};
