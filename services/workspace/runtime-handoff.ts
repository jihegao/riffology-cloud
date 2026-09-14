import {workspaceBindingToken,turnDigest,type CheckpointReceipt,type TurnRecord,type TurnResourceDisposition,type TurnResourceLease} from '../turn/protocol.ts';
import type {TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import type {WorkspaceRuntimeBinding} from './runtime-leases.ts';
import {pairReference} from './runtime-leases.ts';
import type {PairLease,PairDomain,PairHandoffProofs,DomainReleaseProof} from '../capacity/paired.ts';
import type {WorkspacePairedCapacityPort} from '../capacity/paired-client.ts';
import type {NativeBindingProof,WorkspaceSandboxBinding} from '../sandbox/workspace-binding.ts';
export type RuntimeSettlementInput={identity:TurnRuntimeIdentity;outcome:'completed'|'failed'|'cancelled'|'interrupted';checkpoint:CheckpointReceipt|null;resourceLease:TurnResourceLease};
export type NativeHandoffRpc={destroyWorkspaceLease(lease:WorkspaceSandboxBinding['lease']):Promise<{running:boolean}>;sealWorkspaceBinding(context:WorkspaceSandboxBinding):Promise<NativeBindingProof>;pruneWorkspaceBinding(context:WorkspaceSandboxBinding,value:string):Promise<void>;destroyWorkspaceBinding(context:WorkspaceSandboxBinding):Promise<{running:boolean}>};
type Settlement={identity:TurnRuntimeIdentity;closed:boolean;pending:number;active:number;unknown:number};
type State={since:number;decision:'waiting'|'reuse'|'destroy';absence:Partial<Record<PairDomain,number>>;proofs:PairHandoffProofs|null;disposition:TurnResourceDisposition|null};
type Dependencies={storage:Pick<DurableObjectStorage,'kv'|'sync'>;pair:WorkspacePairedCapacityPort;binding(identity:TurnRuntimeIdentity):Promise<{current:WorkspaceRuntimeBinding;lease:PairLease}>;close(identity:TurnRuntimeIdentity):Promise<{settled:Settlement[]}>;journal(identity:TurnRuntimeIdentity):Promise<TurnRecord>;native(domain:PairDomain,context:WorkspaceSandboxBinding):Promise<NativeHandoffRpc>;clock?:()=>number};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Settlement owns its own durable retry state. Native quiescence is not
 * capacity release, and RevisionStore commit is not Workspace saved state. */
export class WorkspaceRuntimeHandoff{
 readonly deps:Dependencies;readonly clock:()=>number;#inFlight=new Map<string,Promise<TurnResourceDisposition>>();
 constructor(deps:Dependencies){this.deps=deps;this.clock=deps.clock??Date.now;}
 settle(input:RuntimeSettlementInput,forceDrain=false):Promise<TurnResourceDisposition>{const key=`${input.identity.turnId}:${forceDrain}`;let pending=this.#inFlight.get(key);if(!pending){pending=this.#settle(input,forceDrain).finally(()=>{if(this.#inFlight.get(key)===pending)this.#inFlight.delete(key);});this.#inFlight.set(key,pending);}return pending;}
 async #settle(input:RuntimeSettlementInput,forceDrain=false):Promise<TurnResourceDisposition>{
  const key=forceDrain?`workspace-runtime-drain:${input.resourceLease.leaseId}`:`workspace-runtime-handoff:${input.identity.turnId}`,now=this.clock(),common={...input.resourceLease,turnId:input.identity.turnId,dispatchId:input.identity.dispatchId,generation:input.identity.generation};
  let state=this.deps.storage.kv.get<State>(key)??{since:now,decision:forceDrain?'destroy':'waiting',absence:{},proofs:null,disposition:null};
  if(state.disposition&&(state.disposition.status==='handed-off'||state.disposition.status==='released'))return state.disposition;
  const save=async()=>{this.deps.storage.kv.put(key,state);await this.deps.storage.sync();};
  const pending=(reasonCode:string):TurnResourceDisposition=>({status:'release-pending',...common,reasonCode,since:state.since,nextAttemptAt:this.clock()+5000});
  await save();
  const {current,lease}=await this.deps.binding(input.identity);if(current.lease.leaseId!==input.resourceLease.leaseId||current.identity.dispatchId!==input.identity.dispatchId)throw Error('workspace-runtime-handoff-authority-denied');
  const turn=await this.deps.journal(input.identity);
  const filesSha256=turn.base?.workspace?.filesSha256??turn.base?.initial?.filesSha256??Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(10240))),n=>n.toString(16).padStart(2,'0')).join('');
  const context:WorkspaceSandboxBinding={lease:current.lease,identity:input.identity,bindingEpoch:current.binding.bindingEpoch,filesSha256};
  const token=await workspaceBindingToken(current.lease,current.binding);
  if(state.proofs&&lease.handoffProofs&&same(state.proofs,lease.handoffProofs)){
   state.disposition={status:'handed-off',...common,lease:current.lease,binding:current.binding,checkpoint:input.checkpoint!,proof:{project:state.proofs.project.status==='not-started'?{schemaVersion:1,bindingEpoch:token,status:'not-started',allocation:state.proofs.project.allocation}:{schemaVersion:1,bindingEpoch:token,status:'quiescent',remaining:0},trustedPi:{schemaVersion:1,bindingEpoch:token,status:'quiescent',remaining:0}},handedOffAt:Math.max(input.checkpoint!.committedAt,state.proofs.trustedPi.observedAt)};await save();return state.disposition;
  }
  if(lease.status==='releasing'&&!lease.handoffProofs&&state.decision!=='destroy'){state.decision='destroy';await save();}
  if(state.decision==='waiting'){
   const closure=await this.deps.close(input.identity);
   if(closure.settled.length!==3||closure.settled.some(s=>!same(s.identity,input.identity)||!s.closed))throw Error('workspace-runtime-settlement-denied');
   if(input.outcome!=='completed'||!input.checkpoint||turn.cancelRequestedAt!==null||closure.settled.some(s=>s.pending!==0||s.active!==0||s.unknown!==0))state.decision='destroy';
   else if(turn.persistenceOutcome!=='saved'||!same(turn.checkpoint,input.checkpoint)){if(this.clock()-state.since<600000)return pending('workspace-runtime-awaiting-workspace-checkpoint');state.decision='destroy';}
   else if(turn.executionOutcome!=='completed'||!lease.bindingClaims.trustedPi)state.decision='destroy';
   else state.decision='reuse';await save();
  }
  if(state.decision==='reuse'){
   try{
    if(!input.checkpoint||turn.persistenceOutcome!=='saved'||turn.executionOutcome!=='completed'||!same(turn.checkpoint,input.checkpoint))throw Error('workspace-runtime-checkpoint-unconfirmed');
    if(!state.proofs){
     const pi=await this.deps.native('trustedPi',context),piProof=await pi.sealWorkspaceBinding(context);this.#quiet(piProof,token);
     const observedAt=this.clock(),make=(domain:PairDomain)=>({schemaVersion:1 as const,domain,leaseId:lease.ref.leaseId,leaseEpoch:lease.ref.leaseEpoch,bindingEpoch:current.binding.bindingEpoch,status:'quiescent' as const,remaining:0 as const,proofId:`seal-${token}-${domain}`,observedAt});
     let project:PairHandoffProofs['project'];
     if(lease.bindingClaims.project){const projectRpc=await this.deps.native('project',context);this.#quiet(await projectRpc.sealWorkspaceBinding(context),token);project=make('project');}
     else project={schemaVersion:1,domain:'project',leaseId:lease.ref.leaseId,leaseEpoch:lease.ref.leaseEpoch,bindingEpoch:current.binding.bindingEpoch,status:'not-started',allocation:lease.startClaims.project===null?'never-started':'retained-sealed',retainedProofId:lease.startClaims.project===null?null:lease.projectSealProofId??null,proofId:`seal-${token}-project`,observedAt};
     const latest=await this.deps.journal(input.identity);if(latest.persistenceOutcome!=='saved'||!same(latest.checkpoint,input.checkpoint))throw Error('workspace-runtime-checkpoint-unconfirmed');
     if(lease.bindingClaims.project)await (await this.deps.native('project',context)).pruneWorkspaceBinding(context,input.checkpoint.filesSha256);
     const hostToken=(await turnDigest({schemaVersion:1,purpose:'trusted-pi-native',identity:input.identity})).slice(0,52);
     await pi.pruneWorkspaceBinding(context,hostToken);state.proofs={project,trustedPi:make('trustedPi')};await save();
    }
   }catch{state.decision='destroy';await save();}
   if(state.decision==='reuse'){
    // Fixed proof intent is durable before dispatch. An unknown response is
    // observed on retry, never replaced with another proof or binding epoch.
    const beforeDispatch=await this.deps.binding(input.identity);if(beforeDispatch.lease.status==='releasing'&&!beforeDispatch.lease.handoffProofs){state.decision='destroy';await save();return this.#settle(input);}
    await this.deps.pair.confirmHandoff(pairReference(current.lease),current.binding,state.proofs!);
    return this.#settle(input);
   }
  }
  let draining=lease.status==='releasing'?lease:await this.deps.pair.cancelPair(pairReference(current.lease));
  if(draining.status==='released'){state.disposition={status:'released',...common,proofId:`released-${token}`,releasedAt:draining.finishedAt!};await save();return state.disposition;}
  if(draining.status!=='releasing'||draining.drainAt===null)throw Error('workspace-runtime-drain-unconfirmed');
  const proofs:Partial<Record<PairDomain,DomainReleaseProof>>={};
  for(const domain of ['project','trustedPi'] as const){
   if(draining.releaseProofs[domain])continue;
   if(draining.startClaims[domain]===null){proofs[domain]={schemaVersion:1,domain,leaseId:lease.ref.leaseId,leaseEpoch:lease.ref.leaseEpoch,kind:'never-started',proofId:`released-${token}-${domain}`,observedAt:this.clock(),absentSince:null};continue;}
   try{const native=await this.deps.native(domain,context),observed=await native.destroyWorkspaceLease(current.lease);if(observed.running!==false){delete state.absence[domain];await save();continue;}state.absence[domain]??=this.clock();await save();const at=this.clock();if(at-draining.drainAt>=360000&&at-state.absence[domain]!>=30000)proofs[domain]={schemaVersion:1,domain,leaseId:lease.ref.leaseId,leaseEpoch:lease.ref.leaseEpoch,kind:'absent',proofId:`released-${token}-${domain}`,observedAt:at,absentSince:state.absence[domain]!};}catch{delete state.absence[domain];await save();}
  }
  if(Object.keys(proofs).length)draining=await this.deps.pair.confirmPairReleased(pairReference(current.lease),proofs);
  if(draining.status==='released'){state.disposition={status:'released',...common,proofId:`released-${token}`,releasedAt:draining.finishedAt!};await save();return state.disposition;}
  return pending('workspace-runtime-release-unconfirmed');
 }
 #quiet(proof:NativeBindingProof,token:string){if(!proof||Object.keys(proof).sort().join(',')!=='bindingEpoch,remaining,schemaVersion,status'||proof.schemaVersion!==1||proof.bindingEpoch!==token||proof.status!=='quiescent'||proof.remaining!==0)throw Error('workspace-runtime-native-proof-denied');}
}
