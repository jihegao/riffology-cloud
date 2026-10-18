import {DurableObject} from 'cloudflare:workers';
import {SqlTrustedPiCapacity,readTrustedPiArchiveQuiescence,readTrustedPiQuiescence,type TrustedPiCapacityDispatchReference,type TrustedPiCapacityIdentity,type TrustedPiCapacityLeaseReference,type TrustedPiCapacityStopProof,type TrustedPiCapacityTicketReference} from './core.ts';
import {trustedPiCapacityActorName} from './client.ts';
import {SqlWorkspacePairedCapacity,readWorkspacePairArchiveResources,readWorkspacePairQuiescence,type WorkspaceLeaseRef,type TurnBinding,type PairDomain,type QuiescenceProof,type PairHandoffProofs,type DomainReleaseProof} from './paired.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
import type {TurnScope} from '../turn/protocol.ts';
export interface TrustedPiCapacityEnv{
 TRUSTED_PI_CAPACITY:DurableObjectNamespace<TrustedPiCapacity>;
 TRUSTED_PI_CAPACITY_POLICY_VERSION:string;TRUSTED_PI_CAPACITY_LIMIT:string;
 M2_WORKSPACE_RUNTIME_REUSE_ENABLED?:unknown;
 WORKSPACE_AGENT?:{getByName(name:string):{drainRuntimeLease(input:{ref:WorkspaceLeaseRef}):Promise<unknown>}};
}
/** One actor owns cold and retained reservations. Existing pairs keep the
 * shared admission hook and drain alarm even after a feature-gate rollback. */
export class TrustedPiCapacity extends DurableObject<TrustedPiCapacityEnv>{
 #queue:Promise<void>=Promise.resolve();
 #core:SqlTrustedPiCapacity|null=null;#pair:SqlWorkspacePairedCapacity|null=null;
 /** Pure original-ledger proof: do not initialize the allocator or use its
  * mutating snapshot wrapper. This does not inspect Cloudflare instances. */
 maintenanceQuiescence(){
  if(!this.env.TRUSTED_PI_CAPACITY.idFromName(trustedPiCapacityActorName()).equals(this.ctx.id))throw Error('trusted-pi-capacity-actor-scope-denied');
  const cold=readTrustedPiQuiescence(this.ctx.storage),pair=readWorkspacePairQuiescence(this.ctx.storage);
  if(cold.policyVersion!==this.env.TRUSTED_PI_CAPACITY_POLICY_VERSION)throw Error('trusted-pi-capacity-policy-conflict');
  return {actor:trustedPiCapacityActorName(),policyVersion:cold.policyVersion,quiescent:cold.quiescent&&pair.quiescent,coldUnresolved:cold.unresolved,pairUnresolved:pair.unresolved,actualContainerReleaseVerified:false as const};
 }
 archiveResources(scope:TurnScope,requestId?:string){
  if(!this.env.TRUSTED_PI_CAPACITY.idFromName(trustedPiCapacityActorName()).equals(this.ctx.id))throw Error('trusted-pi-capacity-actor-scope-denied');
  const cold=readTrustedPiArchiveQuiescence(this.ctx.storage,scope),paired=readWorkspacePairArchiveResources(this.ctx.storage,scope,requestId);
  return {scope:cold.scope,quiescent:cold.quiescent&&paired.quiescent,coldUnresolved:cold.unresolved,pairUnresolved:paired.unresolved,pair:paired.pair};
 }
 #ledger(forcePair=false){if(forcePair&&!this.#pair)this.#core=null;const expected=this.env.TRUSTED_PI_CAPACITY.idFromName(trustedPiCapacityActorName());if(!expected.equals(this.ctx.id))throw Error('trusted-pi-capacity-actor-scope-denied');if(this.env.TRUSTED_PI_CAPACITY_LIMIT!=='1')throw Error('invalid-trusted-pi-capacity-limit');
  if(!this.#core){const paired=forcePair||this.env.M2_WORKSPACE_RUNTIME_REUSE_ENABLED==='true'||this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='paired_capacity_meta'").toArray().length>0;
   this.#core=new SqlTrustedPiCapacity(this.ctx.storage,this.env.TRUSTED_PI_CAPACITY_POLICY_VERSION,Date.now,()=>crypto.randomUUID(),paired?{enqueued:(id,at)=>this.#pair!.admissionHook().enqueued(id,at),beforePromote:()=>this.#pair!.admissionHook().beforePromote(),canPromote:id=>this.#pair!.admissionHook().canPromote(id)}:undefined);
   if(paired)this.#pair=new SqlWorkspacePairedCapacity(this.ctx.storage,{policyVersion:'workspace-pair-v1',assignmentGuardMs:360000,quietMs:30000,idleMs:60000,maxLeaseMs:1800000},()=>this.#core!.promoteWithinTransaction());
  }return this.#core;
 }
 #pairs(){this.#ledger();if(!this.#pair)throw Error('workspace-runtime-reuse-disabled');return this.#pair;}
 async #schedule(){if(!this.#pair)return;let snapshot=this.#pair.view();if(this.env.M2_WORKSPACE_RUNTIME_REUSE_ENABLED!=='true'&&snapshot.active&&!['releasing','released','cancelled'].includes(snapshot.active.status)){await this.#pair.retirePair(snapshot.active.ref,'gate-disabled');snapshot=this.#pair.view();}if(snapshot.nextDue===null)await this.ctx.storage.deleteAlarm();else await this.ctx.storage.setAlarm(Math.max(Date.now()+5000,snapshot.nextDue));}
 #changing<T>(work:()=>Promise<T>,forcePair=false):Promise<T>{const result=this.#queue.then(async()=>{this.#ledger(forcePair);if(this.#pair)await this.ctx.storage.setAlarm(Date.now()+5000);try{return await work();}finally{await this.#schedule();}});this.#queue=result.then(()=>undefined,()=>undefined);return result;}
 async request(identity:TrustedPiCapacityIdentity){return this.#changing(()=>this.#ledger().request(identity));}
 async lookup(identity:TrustedPiCapacityIdentity){return this.#changing(()=>this.#ledger().lookup(identity));}
 async dispatch(ref:TrustedPiCapacityDispatchReference){return this.#changing(()=>this.#ledger().dispatch(ref));}
 async cancelNeverStarted(ref:TrustedPiCapacityTicketReference|TrustedPiCapacityLeaseReference,proof:TrustedPiCapacityStopProof){return this.#changing(()=>this.#ledger().cancelNeverStarted(ref,proof));}
 async confirmReleased(ref:TrustedPiCapacityDispatchReference,proof:TrustedPiCapacityStopProof){return this.#changing(()=>this.#ledger().confirmReleased(ref,proof));}
 async snapshot(){return this.#changing(()=>this.#ledger().snapshot());}
 async requestPair(scope:TurnScope,requestId:string){if(this.env.M2_WORKSPACE_RUNTIME_REUSE_ENABLED!=='true')throw Error('workspace-runtime-reuse-disabled');return this.#changing(()=>this.#pairs().requestPair(scope,requestId));}
 async cancelPairRequest(scope:TurnScope,requestId:string){return this.#changing(()=>this.#pairs().cancelPairRequest(scope,requestId),true);}
 async lookupPair(scope:TurnScope,requestId:string){return this.#changing(()=>this.#pairs().lookupPair(scope,requestId));}
 async bind(ref:WorkspaceLeaseRef,binding:TurnBinding){return this.#changing(async()=>{const pair=this.#pairs();if(this.env.M2_WORKSPACE_RUNTIME_REUSE_ENABLED!=='true'){const current=(await pair.snapshot()).active;if(!current||current.status!=='bound'||JSON.stringify(current.ref)!==JSON.stringify(ref)||JSON.stringify(current.binding)!==JSON.stringify(binding))throw Error('workspace-runtime-reuse-disabled');await pair.retirePair(ref,'gate-disabled');}return pair.bind(ref,binding);});}
 async claimNativeStart(ref:WorkspaceLeaseRef,binding:TurnBinding,domain:PairDomain){return this.#changing(()=>this.#pairs().claimNativeStart(ref,binding,domain));}
 async confirmHandoff(ref:WorkspaceLeaseRef,binding:TurnBinding,proofs:PairHandoffProofs){return this.#changing(async()=>{const pair=this.#pairs();if(this.env.M2_WORKSPACE_RUNTIME_REUSE_ENABLED!=='true')await pair.retirePair(ref,'gate-disabled');return pair.confirmHandoff(ref,binding,proofs);});}
 async retirePair(ref:WorkspaceLeaseRef,reason:'gate-disabled'|'runtime-changed'){return this.#changing(()=>this.#pairs().retirePair(ref,reason));}
 async cancelPair(ref:WorkspaceLeaseRef){return this.#changing(()=>this.#pairs().cancelPair(ref));}
 async confirmPairReleased(ref:WorkspaceLeaseRef,proofs:Partial<Record<PairDomain,DomainReleaseProof>>){return this.#changing(()=>this.#pairs().confirmPairReleased(ref,proofs));}
 async maintainPairs(){return this.#changing(()=>this.#pairs().maintain());}
 async pairedSnapshot(){return this.#changing(()=>this.#pairs().snapshot());}
 async alarm(){this.#ledger();if(!this.#pair)return;try{const snapshot=await this.#changing(()=>this.#pair!.maintain());if(snapshot.active?.status==='releasing'){const {ref}=snapshot.active;if(!this.env.WORKSPACE_AGENT)throw Error('workspace-lease-drain-owner-required');await this.env.WORKSPACE_AGENT.getByName(workspaceAgentName(ref.scope.tenantId,ref.scope.workspaceId)).drainRuntimeLease({ref});}}finally{await this.#changing(async()=>undefined);}}
}
