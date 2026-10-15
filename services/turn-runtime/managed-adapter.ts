import {managedCandidateSnapshot} from './candidate-artifact.ts';
import {managedProjectResources,managedResourceContext} from './managed-resources.ts';
import type {ProjectResources} from '../project-resources/text.mjs';
import { sameScope, turnDigest, turnId, jsonPayload, positive, actor as validateActor, message as validateMessage, turnBaseCheckpoints, type TurnActor, type TurnBaseCheckpoints } from '../turn/protocol.ts';
import type { TurnRuntimeEvent } from '../turn/dispatcher.ts';
import { sameTurnRuntimeIdentity, turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import { usageObservation, type ExecutionBindingStore, type ExecutionBinding, type UsageObservation } from './backend-contract.ts';

/** Normalized provider boundary. The SDK transport proves original-input
 * correlation; listing the newest Turn is never lookupOriginal. */
export interface ManagedTransport {
 create(input:ManagedInput):Promise<ManagedReceipt>;
 continue(input:ManagedInput,sessionId:string):Promise<ManagedReceipt>;
 lookupOriginal(binding:ExecutionBinding):Promise<ManagedReceipt|null>;
 retrieve(binding:ExecutionBinding):Promise<ManagedReceipt>;
 cancel(binding:ExecutionBinding):Promise<void>;
 deleteSession(binding:ExecutionBinding):Promise<{sessionId:string;deleted:boolean;observedAt:number}>;
 download(binding:ExecutionBinding,artifactId:string):Promise<Uint8Array>;
}
export type ManagedInput={identity:TurnRuntimeIdentity;actor:TurnActor;message:string;base:TurnBaseCheckpoints;projectResources?:ProjectResources;projectResourceText?:string};
export function managedInput(raw:ManagedInput):ManagedInput{
 const identity=turnRuntimeIdentity(raw.identity),actor=validateActor(raw.actor),message=validateMessage(raw.message),base=turnBaseCheckpoints(raw.base);
 const projectResources=raw.projectResources===undefined?undefined:managedProjectResources(raw.projectResources,identity.scope,base);
 // This private value is authored at the platform entrypoint, then frozen in
 // the digest. Recovery retains its original bytes across formatter releases.
 if(raw.projectResourceText!==undefined&&(!projectResources||typeof raw.projectResourceText!=='string'||new TextEncoder().encode(raw.projectResourceText).byteLength>68*1024))throw Error('managed-resource-text-invalid');
 const projectResourceText=projectResources?(raw.projectResourceText??managedResourceContext(projectResources,message)):undefined;
 return {identity,actor,message,base,...(projectResources?{projectResources,projectResourceText}:{})};
}
export type ManagedReceipt={schemaVersion:1;identity:TurnRuntimeIdentity;sessionId:string;turnId:string;phase:'running'|'completed'|'failed'|'cancelled';observedAt:number;usage:unknown;events:ManagedEvent[]};
export type ManagedEvent={id:string;type:string;at:number;payload:Record<string,unknown>};
export type ManagedObservation={schemaVersion:1;identity:TurnRuntimeIdentity;backend:'managed-agents';execution:'unknown'|'running'|'completed'|'failed'|'cancelled';usage:UsageObservation;events:TurnRuntimeEvent[];nativeFence:null;acceptance:'pending';checkpoint:'pending';resources:'unknown'};
const EVENT_MAP:Record<string,TurnRuntimeEvent['type']>={
 'agent.session.turn.output_text.delta':'assistant.delta',
 'agent.session.turn.output_text.done':'assistant.message',
};
/** Unscoped backend selection remains Pi-only. Managed product routing requires
 * the separate immutable project policy and remote-terminal receipt contract. */
export function selectProductBackend(value:unknown='pi'):'pi'{if(value!=='pi')throw Error('managed-product-route-disabled');return 'pi';}
export class ManagedExecutionAdapter {
 readonly store:ExecutionBindingStore;readonly transport:ManagedTransport;readonly clock:()=>number;
 constructor(input:{store:ExecutionBindingStore;transport:ManagedTransport;clock?:()=>number}){
  this.store=input.store;this.transport=input.transport;this.clock=input.clock??Date.now;
 }
 private unknown(identity:TurnRuntimeIdentity):ManagedObservation{return {schemaVersion:1,identity,backend:'managed-agents',execution:'unknown',usage:{status:'unknown',reason:'missing'},events:[],nativeFence:null,acceptance:'pending',checkpoint:'pending',resources:'unknown'};}
 private async binding(identity:TurnRuntimeIdentity){const saved=await this.store.read(turnRuntimeIdentity(identity));if(!saved||saved.backend!=='managed-agents')throw Error('managed-binding-missing');return saved;}
 private async observation(raw:ManagedReceipt,binding:ExecutionBinding):Promise<ManagedObservation>{
  if(!raw||raw.schemaVersion!==1||!sameTurnRuntimeIdentity(turnRuntimeIdentity(raw.identity),binding.identity)||!['running','completed','failed','cancelled'].includes(raw.phase))throw Error('managed-receipt-scope-denied');
  positive(raw.observedAt);if(raw.observedAt<binding.reservedAt||raw.observedAt>this.clock())throw Error('managed-receipt-time');
  const sessionId=turnId(raw.sessionId),remoteTurnId=turnId(raw.turnId);
  if(binding.remoteSessionId!==null&&binding.remoteSessionId!==sessionId||binding.remoteTurnId!==null&&binding.remoteTurnId!==remoteTurnId)throw Error('managed-receipt-scope-denied');
  if(!Array.isArray(raw.events)||raw.events.length>256)throw Error('managed-event-limit');
  const events:TurnRuntimeEvent[]=[];
  for(const item of raw.events){
   const at=positive(item.at);if(at<binding.reservedAt||at>raw.observedAt)throw Error('managed-event-time');turnId(item.id);
   // Unknown tool/Skill events remain an observation with unknown visibility;
   // no inferred tool completion, filesystem side effect, or Skill activation.
   const mapped=EVENT_MAP[item.type];
   const text=mapped==='assistant.delta'?item.payload.delta:item.payload.text;
   if(mapped&&typeof text!=='string')throw Error('managed-event-schema-invalid');
   const payload=mapped?jsonPayload({text}):{providerEventType:String(item.type).slice(0,128),visibility:'unknown'};
   events.push({eventId:await turnDigest({identity:binding.identity,providerEventId:item.id}),type:mapped??'provider.status',at,payload});
  }
  await this.store.attach(binding.identity,{sessionId,turnId:remoteTurnId});
  return {...this.unknown(binding.identity),execution:raw.phase,usage:usageObservation(raw.usage),events};
 }
 async accept(input:ManagedInput,previous?:ExecutionBinding):Promise<ManagedObservation>{
  input=managedInput(input);const identity=input.identity,inputSha256=await turnDigest(input);
  if(previous&&(!sameScope(previous.identity.scope,identity.scope)||previous.identity.sessionId!==identity.sessionId||previous.identity.generation!==identity.generation||previous.backend!=='managed-agents'||!previous.remoteSessionId||!previous.remoteTurnId))throw Error('managed-continuation-scope-denied');
  const reserved=await this.store.reserve({schemaVersion:1,identity,backend:'managed-agents',inputSha256,reservedAt:positive(this.clock()),remoteSessionId:previous?.remoteSessionId??null,remoteTurnId:null});
  if(!reserved.created)return this.observe(identity);
  if(previous){
   const prior=await this.binding(previous.identity);
   if(prior.remoteSessionId!==previous.remoteSessionId||prior.remoteTurnId!==previous.remoteTurnId)throw Error('managed-continuation-scope-denied');
   const terminal=await this.transport.retrieve(prior);
   const inspected=await this.observation(terminal,prior);
   if(inspected.execution==='running'||inspected.execution==='unknown')throw Error('managed-continuation-not-terminal');
  }
  // The durable reservation precedes the only input-bearing side effect.
  // A lost acknowledgement is observed under the original identity only.
  let receipt:ManagedReceipt;
  try{receipt=previous?await this.transport.continue(input,previous.remoteSessionId!):await this.transport.create(input);}catch{return this.unknown(identity);}
  return this.observation(receipt,reserved.binding);
 }
 async observe(identity:TurnRuntimeIdentity):Promise<ManagedObservation>{
  const binding=await this.binding(identity);
  let receipt:ManagedReceipt|null;
  try{receipt=binding.remoteTurnId?await this.transport.retrieve(binding):await this.transport.lookupOriginal(binding);}catch{return this.unknown(binding.identity);}
  return receipt?this.observation(receipt,binding):this.unknown(binding.identity);
 }
 async cancel(identity:TurnRuntimeIdentity):Promise<ManagedObservation>{
  const binding=await this.binding(identity);
  if(!binding.remoteTurnId)return this.observe(identity);
  // Cancellation delivery is not terminal proof. Read the original Turn even
  // after response loss; a raced natural completion remains completed.
  try{await this.transport.cancel(binding);}catch{/* observation decides */}
  return this.observe(identity);
 }
 async deleteSession(identity:TurnRuntimeIdentity){
  const binding=await this.binding(identity);if(!binding.remoteSessionId)return {status:'pending' as const,nativeFence:null};
  try{const receipt=await this.transport.deleteSession(binding);if(receipt.sessionId!==binding.remoteSessionId||receipt.deleted!==true||!Number.isSafeInteger(receipt.observedAt)||receipt.observedAt<binding.reservedAt||receipt.observedAt>this.clock())return {status:'pending' as const,nativeFence:null};return {status:'remote-deleted' as const,nativeFence:null,observedAt:receipt.observedAt};}catch{return {status:'pending' as const,nativeFence:null};}
 }
 async candidateSnapshot(identity:TurnRuntimeIdentity,artifactId:string,manifest:unknown){const binding=await this.binding(identity);return managedCandidateSnapshot(binding,manifest,await this.download(identity,artifactId));}
 async download(identity:TurnRuntimeIdentity,artifactId:string){const binding=await this.binding(identity);if(!binding.remoteTurnId)throw Error('managed-artifact-reference-unknown');return this.transport.download(binding,turnId(artifactId));}
}
/** Compatibility entrypoint for the frozen Phase 3 fixture suite. */
export class OfflineManagedAdapter extends ManagedExecutionAdapter {
 constructor(input:{mode:'offline';store:ExecutionBindingStore;transport:ManagedTransport;clock?:()=>number}){
  if(input.mode!=='offline')throw Error('managed-product-route-disabled');super(input);
 }
}
