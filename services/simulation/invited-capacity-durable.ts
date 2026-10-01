import {DurableObject} from 'cloudflare:workers';
import type {TurnActor,TurnScope} from '../turn/protocol.ts';
import {PRIVATE_BETA_CAPACITY_ACTOR} from '../model-budget/private-beta-policy.ts';
import type {LeaseRequest,LeaseReference,StopConfirmation} from '../quota/core.ts';
import {SqlInvitedRunCapacity} from './invited-capacity.ts';
import {invitedRunsPolicy,INVITED_RUN_CAPACITY_ACTOR} from './invited-policy.ts';
interface Env{
 INVITED_RUNS_POLICY_JSON?:string;
 INVITED_RUN_CAPACITY:DurableObjectNamespace<InvitedRunCapacity>;
 PRIVATE_BETA_CAPACITY?:{getByName(name:string):{authorizeRunAdmission(scope:TurnScope,actor:TurnActor):Promise<unknown>}};
}
/** The public Gateway never exposes these supervisor RPCs directly. */
export class InvitedRunCapacity extends DurableObject<Env>{
 #ledger:SqlInvitedRunCapacity|null=null;
 #core(){
  if(!this.env.INVITED_RUN_CAPACITY.idFromName(INVITED_RUN_CAPACITY_ACTOR).equals(this.ctx.id))throw Error('invited-runs-actor-denied');
  const policy=invitedRunsPolicy(this.env.INVITED_RUNS_POLICY_JSON);if(!policy)throw Error('invited-runs-unconfigured');
  return this.#ledger??=new SqlInvitedRunCapacity(this.ctx.storage,policy);
 }
 async #authorize(request:LeaseRequest,actor:TurnActor){
  const beta=this.env.PRIVATE_BETA_CAPACITY?.getByName(PRIVATE_BETA_CAPACITY_ACTOR);if(!beta?.authorizeRunAdmission)throw Error('invited-runs-policy-migration-required');
  await beta.authorizeRunAdmission({tenantId:request.tenantId,projectId:request.projectId,workspaceId:request.workspaceId,workspaceGeneration:request.generation},actor);
 }
 async acquire(request:LeaseRequest,actor:TurnActor){const core=this.#core();await this.#authorize(request,actor);const result=await core.acquire(request,actor);if(result.lease?.status!=='stopped')await this.ctx.storage.setAlarm(request.deadlineAt+invitedRunsPolicy(this.env.INVITED_RUNS_POLICY_JSON)!.releaseGuardMs);return result;}
 async dispatch(reference:LeaseReference){const core=this.#core();await this.#authorize(reference,await core.owner(reference));return core.dispatch(reference);}
 lookup(tenantId:string,operationId:string){return this.#core().lookup(tenantId,operationId);}
 markUnknown(reference:LeaseReference){return this.#core().markUnknown(reference);}
 confirmStopped(reference:LeaseReference,proof:StopConfirmation){return this.#core().confirmStopped(reference,proof);}
 snapshot(){return this.#core().snapshot();}
 resume(){return this.#core().resume();}
 async alarm(){await this.#core().snapshot();}
}
