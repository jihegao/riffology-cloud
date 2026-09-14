import {sameScope,scope as checkedScope,turnId,type TurnScope,type WorkspaceBindingLease,type WorkspaceTurnBinding} from '../turn/protocol.ts';
import {turnRuntimeIdentity,type TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import type {TurnCapacityPort,TurnCapacityReceipt} from '../turn/dispatcher.ts';
import type {WorkspacePairedCapacityPort} from '../capacity/paired-client.ts';
import type {PairLease,WorkspaceLeaseRef} from '../capacity/paired.ts';

type Store=Pick<DurableObjectStorage,'kv'|'transactionSync'|'sync'>;
type Acquire=Parameters<TurnCapacityPort['acquire']>[0];
type Selection={schemaVersion:1;scope:TurnScope;sessionId:string;turnId:string;operationId:string;mode:'cold'|'warm';requestId:string;runtimeVersion:string|null;cancelled:boolean;lease:WorkspaceBindingLease|null;binding:WorkspaceTurnBinding|null;closing:boolean;deadlineAt:number|null;requestReserved:boolean};
export type WorkspaceRuntimeBinding={lease:WorkspaceBindingLease;binding:WorkspaceTurnBinding;identity:TurnRuntimeIdentity;executionDeadlineAt:number;closing:boolean};
const key=(turn:string)=>`workspace-runtime-turn:${turnId(turn)}`;
const CURRENT='workspace-runtime-current';
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function pairReference(lease:WorkspaceBindingLease):WorkspaceLeaseRef{return {scope:lease.scope,leaseId:lease.leaseId,leaseEpoch:lease.leaseEpoch};}
/** Workspace owns the immutable release digest and per-Turn protocol choice.
 * No native operation runs under this coordinator, and readers never wait for
 * its admission queue: Sandbox callbacks can safely re-enter Workspace. */
export class WorkspaceRuntimeLeases implements TurnCapacityPort{
 readonly #storage:Store;readonly #pair:WorkspacePairedCapacityPort;readonly #cold:TurnCapacityPort;readonly #enabled:()=>boolean;readonly #version:()=>unknown;readonly #clock:()=>number;
 constructor(storage:Store,pair:WorkspacePairedCapacityPort,cold:TurnCapacityPort,enabled:()=>boolean,version:()=>unknown,clock=Date.now){this.#storage=storage;this.#pair=pair;this.#cold=cold;this.#enabled=enabled;this.#version=version;this.#clock=clock;}
 async #selection(input:Acquire):Promise<Selection>{
  const scope=checkedScope(input.scope),sessionId=turnId(input.sessionId),id=turnId(input.turnId),operationId=turnId(input.operationId);
  if(scope.workspaceGeneration!==input.generation)throw Error('workspace-runtime-generation-denied');
  const stored=this.#storage.kv.get<Selection>(key(id));
  if(stored){if(!sameScope(stored.scope,scope)||stored.sessionId!==sessionId||stored.operationId!==operationId)throw Error('workspace-runtime-selection-conflict');return stored;}
  // Existing dispatcher tickets are always cold. A gate never reinterprets an
  // accepted legacy execution or an unresolved admission response.
  const version=this.#version(),warm=this.#enabled()&&input.ticketId===null&&typeof version==='string'&&/^[a-f0-9]{64}$/.test(version);
  const value:Selection={schemaVersion:1,scope,sessionId,turnId:id,operationId,mode:warm?'warm':'cold',requestId:operationId,runtimeVersion:warm?version as string:null,cancelled:false,lease:null,binding:null,closing:false,deadlineAt:null,requestReserved:false};
  // get/put are local actor storage, without an external call between them.
  this.#storage.kv.put(key(id),value);await this.#storage.sync();return value;
 }
 async #write(value:Selection){this.#storage.transactionSync(()=>{const prior=this.#storage.kv.get<Selection>(key(value.turnId));if(prior?.cancelled&&!value.cancelled||prior?.closing&&!value.closing)throw Error('workspace-runtime-admission-closed');if(prior?.binding&&value.binding&&!equal(prior.binding,value.binding))throw Error('workspace-runtime-binding-conflict');this.#storage.kv.put(key(value.turnId),value);});await this.#storage.sync();}
 async #fresh(value:Selection){const latest=this.#storage.kv.get<Selection>(key(value.turnId));if(!latest||latest.cancelled||latest.closing)throw Error('workspace-runtime-admission-closed');return latest;}
 async acquire(input:Acquire):Promise<TurnCapacityReceipt>{
  let value=await this.#selection(input);if(value.mode==='cold')return this.#cold.acquire(input);if(value.cancelled)throw Error('workspace-runtime-admission-closed');
  let saved=value.lease,lease:PairLease|null=null;
  if(saved){lease=await this.#pair.lookupPair(saved.scope,value.requestId);if(!lease||!equal(lease.ref,pairReference(saved)))throw Error('workspace-runtime-lease-conflict');}
  else{
   const current=this.#storage.kv.get<{lease:WorkspaceBindingLease;requestId:string}>(CURRENT);
   if(current){const prior=await this.#pair.lookupPair(current.lease.scope,current.requestId);
    if(prior&&['held','bound','idle','releasing','queued'].includes(prior.status)){
     if(!sameScope(current.lease.scope,value.scope))throw Error('workspace-runtime-scope-held');
     if(current.lease.runtimeVersion!==value.runtimeVersion||!this.#enabled()){
      await this.#pair.retirePair(prior.ref,current.lease.runtimeVersion!==value.runtimeVersion?'runtime-changed':'gate-disabled');
      return this.#waiting(value,prior);
     }
     if(prior.status==='idle'&&prior.retireReason===null&&prior.binding&&prior.binding.bindingEpoch<16){lease=prior;saved=current.lease;value={...await this.#fresh(value),requestId:current.requestId,lease:saved};await this.#write(value);}
     else if(prior.status==='idle'&&prior.binding&&prior.binding.bindingEpoch>=16){await this.#pair.retirePair(prior.ref,'runtime-changed');return this.#waiting(value,prior);}
     else return this.#waiting(value,prior);
    }
   }
   if(!saved){value={...await this.#fresh(value),requestReserved:true};await this.#write(value);lease=await this.#pair.requestPair(value.scope,value.requestId);value=await this.#fresh(value);saved={...lease.ref,runtimeVersion:value.runtimeVersion!};value={...value,lease:saved};await this.#write(value);this.#storage.kv.put(CURRENT,{lease:saved,requestId:value.requestId});await this.#storage.sync();}
  }
  if(!lease)throw Error('workspace-runtime-lease-unavailable');await this.#fresh(value);
  if(lease.status!=='bound'&&(!this.#enabled()||this.#version()!==value.lease!.runtimeVersion)){await this.#pair.retirePair(lease.ref,this.#version()!==value.lease!.runtimeVersion?'runtime-changed':'gate-disabled');throw Error('workspace-runtime-binding-retired');}
  if(['held','idle'].includes(lease.status))return {status:'acquired',turnId:value.turnId,generation:value.scope.workspaceGeneration,ticketId:value.operationId,operationId:value.operationId,leaseId:lease.ref.leaseId};
  if(lease.status==='bound'&&lease.binding?.turnId===value.turnId)return {status:'acquired',turnId:value.turnId,generation:value.scope.workspaceGeneration,ticketId:value.operationId,operationId:value.operationId,leaseId:lease.ref.leaseId};
  if(lease.status==='queued'||lease.status==='releasing')return this.#waiting(value,lease);
  throw Error('workspace-runtime-lease-terminal');
 }
 #waiting(value:Selection,lease:PairLease):TurnCapacityReceipt{return {status:'waiting',turnId:value.turnId,generation:value.scope.workspaceGeneration,ticketId:value.operationId,operationId:value.operationId,reasonCode:'workspace-runtime-capacity-exhausted',since:lease.requestedAt,nextAttemptAt:this.#clock()+5000};}
 async releaseNeverStarted(input:Parameters<TurnCapacityPort['releaseNeverStarted']>[0]){
  let value=await this.#selection(input);if(value.mode==='cold')return this.#cold.releaseNeverStarted(input);
  value={...value,cancelled:true,closing:true};await this.#write(value);
  if(!value.requestReserved&&!value.lease)return {proofId:`workspace-never-started-${value.operationId}`,releasedAt:this.#clock()};
  if(value.requestReserved&&!value.binding){const cancelled=await this.#pair.cancelPairRequest(value.scope,value.requestId);if(cancelled.lease&&cancelled.lease.status!=='cancelled'&&cancelled.lease.status!=='released')throw Error('workspace-runtime-release-pending');return {proofId:`workspace-never-started-${value.operationId}`,releasedAt:cancelled.cancelledAt};}
  let lease=await this.#pair.lookupPair(value.scope,value.requestId);
  // Exact request closes an acceptance-before-cancellation RPC window. If the
  // gate prevents this reconciliation, keep the caller's hold unresolved.
  if(!lease)lease=await this.#pair.requestPair(value.scope,value.requestId);
  if(value.binding||lease.binding?.turnId===value.turnId)throw Error('workspace-runtime-already-bound');
  if(lease.status!=='idle'){
   const result=await this.#pair.cancelPair(lease.ref);if(result.status!=='cancelled'&&result.status!=='released')throw Error('workspace-runtime-release-pending');
  }
  return {proofId:`workspace-never-started-${value.operationId}`,releasedAt:this.#clock()};
 }
 async bind(raw:TurnRuntimeIdentity,deadlineAt:number):Promise<WorkspaceRuntimeBinding|null>{
  const identity=turnRuntimeIdentity(raw);let value=this.#storage.kv.get<Selection>(key(identity.turnId));if(!value||value.mode==='cold')return null;
  if(!sameScope(value.scope,identity.scope)||value.sessionId!==identity.sessionId||!value.lease||value.cancelled||value.closing)throw Error('workspace-runtime-binding-denied');
  if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=this.#clock())throw Error('workspace-runtime-deadline-denied');
  if(value.deadlineAt!==null&&value.deadlineAt!==deadlineAt)throw Error('workspace-runtime-deadline-conflict');
  const prior=await this.#pair.lookupPair(value.scope,value.requestId);if(!prior||!equal(prior.ref,pairReference(value.lease)))throw Error('workspace-runtime-lease-conflict');
  const alreadyBound=prior.status==='bound'&&prior.binding?.sessionId===identity.sessionId&&prior.binding.turnId===identity.turnId&&prior.binding.dispatchId===identity.dispatchId&&(!value.binding||equal(prior.binding,value.binding));
  if(!alreadyBound&&(!this.#enabled()||this.#version()!==value.lease.runtimeVersion)){await this.#pair.retirePair(prior.ref,this.#version()!==value.lease.runtimeVersion?'runtime-changed':'gate-disabled');throw Error('workspace-runtime-binding-retired');}
  const binding=value.binding??(alreadyBound?prior.binding!:{sessionId:identity.sessionId,turnId:identity.turnId,dispatchId:identity.dispatchId,bindingEpoch:(prior.binding?.bindingEpoch??0)+1});
  if(binding.dispatchId!==identity.dispatchId||binding.sessionId!==identity.sessionId)throw Error('workspace-runtime-binding-conflict');
  value={...await this.#fresh(value),binding,deadlineAt};await this.#write(value);
  const result=await this.#pair.bind(pairReference(value.lease!),binding);if(result.status!=='bound'||!equal(result.binding,binding))throw Error('workspace-runtime-binding-unavailable');
  await this.#fresh(value);return this.current(identity);
 }
 selection(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw),value=this.#storage.kv.get<Selection>(key(identity.turnId));if(!value)return null;if(!sameScope(value.scope,identity.scope)||value.sessionId!==identity.sessionId)throw Error('workspace-runtime-selection-conflict');return {mode:value.mode,closing:value.closing||value.cancelled,bound:value.binding!==null};}
 async current(raw:TurnRuntimeIdentity):Promise<WorkspaceRuntimeBinding|null>{
  const identity=turnRuntimeIdentity(raw),value=this.#storage.kv.get<Selection>(key(identity.turnId));if(!value||value.mode==='cold')return null;
  if(!sameScope(value.scope,identity.scope)||value.sessionId!==identity.sessionId||!value.lease||!value.binding||value.binding.dispatchId!==identity.dispatchId||value.deadlineAt===null)throw Error('workspace-runtime-binding-denied');
  return {lease:value.lease,binding:value.binding,identity,executionDeadlineAt:value.deadlineAt,closing:value.closing||value.cancelled};
 }
 async leaseForDrain(lease:WorkspaceBindingLease){const saved=this.#storage.kv.get<{lease:WorkspaceBindingLease;requestId:string}>(CURRENT);if(!saved||!equal(saved.lease,lease))throw Error('workspace-runtime-lease-denied');const result=await this.#pair.lookupPair(lease.scope,saved.requestId);if(!result||!equal(result.ref,pairReference(lease))||!['releasing','released'].includes(result.status))throw Error('workspace-runtime-drain-denied');return result;}
 currentLease(){return this.#storage.kv.get<{lease:WorkspaceBindingLease;requestId:string}>(CURRENT)??null;}
 async pairState(raw:TurnRuntimeIdentity){const current=await this.current(raw);if(!current)throw Error('workspace-runtime-binding-denied');const value=this.#storage.kv.get<Selection>(key(current.identity.turnId));const lease=await this.#pair.lookupPair(current.lease.scope,value!.requestId);if(!lease||!equal(lease.ref,pairReference(current.lease))||!equal(lease.binding,current.binding))throw Error('workspace-runtime-binding-denied');return {current,lease};}
 async authoritative(raw:TurnRuntimeIdentity):Promise<WorkspaceRuntimeBinding>{
  const current=await this.current(raw);if(!current)throw Error('workspace-runtime-binding-denied');
  const value=this.#storage.kv.get<Selection>(key(current.identity.turnId));const lease=await this.#pair.lookupPair(current.lease.scope,value!.requestId);
  if(!lease||lease.status!=='bound'||!equal(lease.ref,pairReference(current.lease))||!equal(lease.binding,current.binding))throw Error('workspace-runtime-binding-denied');
  const latest=await this.current(raw);if(!latest||!equal(latest.lease,current.lease)||!equal(latest.binding,current.binding))throw Error('workspace-runtime-binding-denied');return latest;
 }
 async close(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw),current=await this.current(identity);if(!current)throw Error('workspace-runtime-binding-denied');const value=this.#storage.kv.get<Selection>(key(identity.turnId));await this.#write({...value!,closing:true});return this.current(identity);}
}
