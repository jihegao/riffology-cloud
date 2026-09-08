import { actor as validateActor, jsonPayload, positive, turnBaseCheckpoints, turnDigest, turnId, type TurnActor, type TurnBaseCheckpoints } from '../turn/protocol.ts';
import type { TurnRuntimeEvent, TurnStopReceipt } from '../turn/dispatcher.ts';
import type { TurnExecutionObservation, TurnExecutionPort } from './core.ts';
import { sameTurnRuntimeIdentity, turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import { toolArtifactReceipt, type ToolArtifactReceipt } from '../artifacts/protocol.ts';

export type TrustedPiHostEvent=
  | {sequence:number;at:number;kind:'assistant.delta';text:string}
  | {sequence:number;at:number;kind:'assistant.message';text:string;stopReason:string|null}
  | {sequence:number;at:number;kind:'tool.started';toolCallId:string;name:string}
  | {sequence:number;at:number;kind:'tool.updated';toolCallId:string;name:string;summary:string}
  | {sequence:number;at:number;kind:'tool.completed';toolCallId:string;name:string;isError:boolean;artifact:ToolArtifactReceipt|null}
  | {sequence:number;at:number;kind:'provider.status';state:'requesting'|'responding'|'error';status:number|null;requestId:string|null};
export type TrustedPiHostObservation={
  identity:TurnRuntimeIdentity;
  phase:'absent'|'unknown'|'starting'|'running'|'terminal';
  outcome:'completed'|'failed'|'cancelled'|'interrupted'|null;
  executionErrorCode:string|null;
  events:TrustedPiHostEvent[];
  stopped:TurnStopReceipt|null;
};
export interface TrustedPiHostPort{
  start(input:TurnRuntimeIdentity&{actor:TurnActor;message:string;base:TurnBaseCheckpoints}):Promise<TrustedPiHostObservation>;
  observe(identity:TurnRuntimeIdentity):Promise<TrustedPiHostObservation>;
  cancel(identity:TurnRuntimeIdentity):Promise<TrustedPiHostObservation>;
}

const MAX_EVENTS=2048,MAX_TEXT=15_000,TOOL=/^project_[a-z0-9_]{1,64}$/;
function reject(code:string):never{throw Error(code);}
function exact(value:unknown,keys:string[],code:string):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject(code);}
function text(value:unknown,allowEmpty=false):string{if(typeof value!=='string'||(!allowEmpty&&!value.length)||new TextEncoder().encode(value).byteLength>MAX_TEXT||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))reject('invalid-trusted-pi-host-event');return value;}
function tool(value:unknown):string{if(typeof value!=='string'||!TOOL.test(value))reject('invalid-trusted-pi-host-event');return value;}
function artifact(value:unknown):ToolArtifactReceipt{try{return toolArtifactReceipt(value);}catch{return reject('invalid-trusted-pi-host-event');}}
function requestId(value:unknown):string|null{if(value===null)return null;if(typeof value!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value))reject('invalid-trusted-pi-host-event');return value;}
function status(value:unknown):number|null{if(value===null)return null;if(!Number.isSafeInteger(value)||(value as number)<100||(value as number)>599)reject('invalid-trusted-pi-host-event');return value as number;}
function hostEvent(value:unknown):TrustedPiHostEvent{
  if(!value||typeof value!=='object'||Array.isArray(value))reject('invalid-trusted-pi-host-event');const raw=value as Record<string,unknown>,sequence=positive(raw.sequence),at=positive(raw.at),kind=raw.kind;
  if(kind==='assistant.delta'){exact(raw,['sequence','at','kind','text'],'invalid-trusted-pi-host-event');return {sequence,at,kind,text:text(raw.text)};}
  if(kind==='assistant.message'){exact(raw,['sequence','at','kind','text','stopReason'],'invalid-trusted-pi-host-event');return {sequence,at,kind,text:text(raw.text,true),stopReason:raw.stopReason===null?null:turnId(raw.stopReason)};}
  if(kind==='tool.started'){exact(raw,['sequence','at','kind','toolCallId','name'],'invalid-trusted-pi-host-event');return {sequence,at,kind,toolCallId:turnId(raw.toolCallId),name:tool(raw.name)};}
  if(kind==='tool.updated'){exact(raw,['sequence','at','kind','toolCallId','name','summary'],'invalid-trusted-pi-host-event');return {sequence,at,kind,toolCallId:turnId(raw.toolCallId),name:tool(raw.name),summary:text(raw.summary,true)};}
  if(kind==='tool.completed'){exact(raw,['sequence','at','kind','toolCallId','name','isError','artifact'],'invalid-trusted-pi-host-event');if(typeof raw.isError!=='boolean'||(raw.isError&&raw.artifact!==null))reject('invalid-trusted-pi-host-event');return {sequence,at,kind,toolCallId:turnId(raw.toolCallId),name:tool(raw.name),isError:raw.isError,artifact:raw.artifact===null?null:artifact(raw.artifact)};}
  if(kind==='provider.status'){exact(raw,['sequence','at','kind','state','status','requestId'],'invalid-trusted-pi-host-event');if(!['requesting','responding','error'].includes(raw.state as string))reject('invalid-trusted-pi-host-event');const state=raw.state as TrustedPiHostEvent&string;return {sequence,at,kind,state:state as 'requesting'|'responding'|'error',status:status(raw.status),requestId:requestId(raw.requestId)};}
  reject('invalid-trusted-pi-host-event');
}
function stopped(value:unknown):TurnStopReceipt|null{if(value===null)return null;exact(value,['confirmationId','observedAt','nativeRunning','fenced'],'invalid-trusted-pi-host-observation');if(value.nativeRunning!==false||value.fenced!==true)reject('invalid-trusted-pi-host-observation');return {confirmationId:turnId(value.confirmationId),observedAt:positive(value.observedAt),nativeRunning:false,fenced:true};}
function observation(value:unknown,expected:TurnRuntimeIdentity):TrustedPiHostObservation{
  exact(value,['identity','phase','outcome','executionErrorCode','events','stopped'],'invalid-trusted-pi-host-observation');const identity=turnRuntimeIdentity(value.identity);if(!sameTurnRuntimeIdentity(identity,expected))reject('trusted-pi-host-scope-denied');
  if(!['absent','unknown','starting','running','terminal'].includes(value.phase as string)||!Array.isArray(value.events)||value.events.length>MAX_EVENTS)reject('invalid-trusted-pi-host-observation');const phase=value.phase as TrustedPiHostObservation['phase'],outcome=value.outcome===null?null:['completed','failed','cancelled','interrupted'].includes(value.outcome as string)?value.outcome as TrustedPiHostObservation['outcome']:reject('invalid-trusted-pi-host-observation'),executionErrorCode=value.executionErrorCode===null?null:turnId(value.executionErrorCode),events=value.events.map(hostEvent),stop=stopped(value.stopped);
  let last=0;for(const item of events){if(item.sequence<=last)reject('invalid-trusted-pi-host-observation');last=item.sequence;}
  if(phase==='terminal'){if(!outcome||!stop||(outcome==='completed'&&executionErrorCode!==null))reject('invalid-trusted-pi-host-observation');}else if(outcome!==null||executionErrorCode!==null||stop!==null)reject('invalid-trusted-pi-host-observation');
  if((phase==='absent'||phase==='unknown')&&events.length)reject('invalid-trusted-pi-host-observation');return {identity,phase,outcome,executionErrorCode,events,stopped:stop};
}
async function runtimeEvent(identity:TurnRuntimeIdentity,event:TrustedPiHostEvent):Promise<TurnRuntimeEvent>{
  // Identity + host sequence is the immutable event identity. Payload is
  // deliberately excluded so a changed replay collides instead of appending.
  const eventId=`pi-${(await turnDigest({schemaVersion:1,identity,sequence:event.sequence})).slice(0,64)}`,common={eventId,at:event.at};
  if(event.kind==='assistant.delta')return {...common,type:'assistant.delta',payload:jsonPayload({text:event.text})};
  if(event.kind==='assistant.message')return {...common,type:'assistant.message',payload:jsonPayload({text:event.text,stopReason:event.stopReason})};
  if(event.kind==='tool.started')return {...common,type:'tool.started',payload:jsonPayload({toolCallId:event.toolCallId,name:event.name})};
  if(event.kind==='tool.updated')return {...common,type:'tool.updated',payload:jsonPayload({toolCallId:event.toolCallId,name:event.name,summary:event.summary})};
  if(event.kind==='tool.completed')return {...common,type:'tool.completed',payload:jsonPayload({toolCallId:event.toolCallId,name:event.name,isError:event.isError,artifact:event.artifact})};
  return {...common,type:'provider.status',payload:jsonPayload({state:event.state,status:event.status,requestId:event.requestId})};
}

/** Platform-side adapter for one identity-bound Trusted Pi host. The host owns
 * Pi SDK lifecycle and native stop evidence; this class only validates and
 * translates its durable observations into ProductTurnRuntime receipts. */
export class TrustedPiExecutionAdapter implements TurnExecutionPort{
  readonly #host:TrustedPiHostPort;
  constructor(host:TrustedPiHostPort){if(!host?.start||!host.observe||!host.cancel)reject('trusted-pi-host-required');this.#host=host;}
  async #map(raw:unknown,identity:TurnRuntimeIdentity):Promise<TurnExecutionObservation>{const value=observation(raw,identity),events=await Promise.all(value.events.map(item=>runtimeEvent(identity,item)));return {identity,phase:value.phase==='starting'?'running':value.phase,outcome:value.outcome,executionErrorCode:value.executionErrorCode,events,stopped:value.stopped};}
  async start(input:TurnRuntimeIdentity&{actor:TurnActor;message:string;base:TurnBaseCheckpoints}){const identity=turnRuntimeIdentity({scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation}),actor=validateActor(input.actor),base=turnBaseCheckpoints(input.base);return this.#map(await this.#host.start({...identity,actor,message:input.message,base}),identity);}
  async observe(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw);return this.#map(await this.#host.observe(identity),identity);}
  async cancel(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw);return this.#map(await this.#host.cancel(identity),identity);}
}

export const trustedPiExecutionLimits={maxEvents:MAX_EVENTS,maxTextBytes:MAX_TEXT};
