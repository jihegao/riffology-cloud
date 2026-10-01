import {G4WindowGuard,readG4WindowSnapshot,g4WindowPolicy,type G4Task} from './g4-window.ts';
import { DurableObject } from 'cloudflare:workers';
import { SqlTenantModelBudget, modelBudgetTenantName, type ModelBudgetPolicy, type ModelCallReference } from './core.ts';
import {verifyExecutionIsolationAuthority} from './execution-isolation-capability.ts';

export interface TenantModelBudgetEnv{
  G4_CONTROLLED_WINDOW_JSON?:string;
  TENANT_MODEL_BUDGET:DurableObjectNamespace<TenantModelBudget>;
  MODEL_BUDGET_POLICY_VERSION:string;
  MODEL_BUDGET_MAX_RESERVATION_ATTEMPTS_PER_TURN:string;
  MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN:string;
  MODEL_BUDGET_MAX_INPUT_TOKENS_PER_CALL:string;
  MODEL_BUDGET_MAX_OUTPUT_TOKENS_PER_CALL:string;
  MODEL_BUDGET_MAX_RESERVED_TOKENS_PER_TURN:string;
  M2_MODEL_TURN_CAPABILITY_KEY:string;
}
function decimal(value:string):number{if(typeof value!=='string'||!/^[1-9][0-9]{0,8}$/.test(value))throw Error('invalid-model-budget-configuration');return Number(value);}

/** Private RPC authority. Public requests and project Sandboxes must never
 * receive this binding; the Model Proxy calls it after authenticating a
 * platform-issued invocation capability. */
export class TenantModelBudget extends DurableObject<TenantModelBudgetEnv>{
  #tenantId:string|null=null;#core:SqlTenantModelBudget|null=null;
  #forTenant(tenantId:string):SqlTenantModelBudget{
    const expected=this.env.TENANT_MODEL_BUDGET.idFromName(modelBudgetTenantName(tenantId));
    if(!expected.equals(this.ctx.id))throw Error('model-budget-actor-scope-denied');
    if(this.#tenantId!==null&&this.#tenantId!==tenantId)throw Error('model-budget-tenant-conflict');
    if(!this.#core){const policy:ModelBudgetPolicy={tenantId,version:this.env.MODEL_BUDGET_POLICY_VERSION,maxReservationAttemptsPerTurn:decimal(this.env.MODEL_BUDGET_MAX_RESERVATION_ATTEMPTS_PER_TURN),maxDispatchedCallsPerTurn:decimal(this.env.MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN),maxInputTokensPerCall:decimal(this.env.MODEL_BUDGET_MAX_INPUT_TOKENS_PER_CALL),maxOutputTokensPerCall:decimal(this.env.MODEL_BUDGET_MAX_OUTPUT_TOKENS_PER_CALL),maxReservedTokensPerTurn:decimal(this.env.MODEL_BUDGET_MAX_RESERVED_TOKENS_PER_TURN)};this.#core=new SqlTenantModelBudget(this.ctx.storage,policy,Date.now,()=>crypto.randomUUID(),g4WindowPolicy(this.env.G4_CONTROLLED_WINDOW_JSON===undefined?undefined:JSON.parse(this.env.G4_CONTROLLED_WINDOW_JSON)));this.#tenantId=tenantId;}
    return this.#core;
  }
  #g4(tenantId:string){
    if(!this.env.TENANT_MODEL_BUDGET.idFromName(modelBudgetTenantName(tenantId)).equals(this.ctx.id))throw Error('g4-window-actor-scope-denied');
    return new G4WindowGuard(this.ctx.storage,g4WindowPolicy(this.env.G4_CONTROLLED_WINDOW_JSON===undefined?undefined:JSON.parse(this.env.G4_CONTROLLED_WINDOW_JSON)));
  }
  async g4AdmitTask(tenantId:string,task:G4Task){if(task.tenantId!==tenantId)throw Error('g4-window-actor-scope-denied');const guard=this.#g4(tenantId);const result=this.ctx.storage.transactionSync(()=>guard.taskSync(task));await this.ctx.storage.sync();return result;}
  async g4WindowSnapshot(tenantId:string){if(!this.env.TENANT_MODEL_BUDGET.idFromName(modelBudgetTenantName(tenantId)).equals(this.ctx.id))throw Error('g4-window-actor-scope-denied');const configured=g4WindowPolicy(this.env.G4_CONTROLLED_WINDOW_JSON===undefined?undefined:JSON.parse(this.env.G4_CONTROLLED_WINDOW_JSON));return readG4WindowSnapshot(this.ctx.storage,configured?.tenantId===tenantId?configured:null);}
  async closeTurnAdmission(tenantId:string,identity:unknown){return this.#forTenant(tenantId).closeTurnAdmission(identity);}
  async turnSettlement(tenantId:string,identity:unknown){return this.#forTenant(tenantId).turnSettlement(identity);}
  async reserve(tenantId:string,request:unknown){return this.#forTenant(tenantId).reserve(request);}
  async lookup(tenantId:string,identity:unknown,callId:unknown){return this.#forTenant(tenantId).lookup(identity,callId);}
  async dispatch(tenantId:string,reference:unknown){return this.#forTenant(tenantId).dispatch(reference);}
  async markUnknown(tenantId:string,reference:unknown){return this.#forTenant(tenantId).markUnknown(reference);}
  async finish(tenantId:string,reference:ModelCallReference,terminal:unknown){return this.#forTenant(tenantId).finish(reference,terminal);}
  async releaseUndispatched(tenantId:string,reference:ModelCallReference,proof:unknown){return this.#forTenant(tenantId).releaseUndispatched(reference,proof);}
 async assertExecutionQuiet(tenantId:string){return this.#forTenant(tenantId).assertExecutionQuiet();}
  async executionIsolationCandidate(tenantId:string,callKey:unknown){return this.#forTenant(tenantId).executionIsolationCandidate(callKey);}
  async recordExecutionIsolation(tenantId:string,proof:unknown,authority:unknown){await verifyExecutionIsolationAuthority(this.env.M2_MODEL_TURN_CAPABILITY_KEY,'legacy',tenantId,proof,authority);return this.#forTenant(tenantId).recordExecutionIsolation(proof);}
  async assertExecutionIsolated(tenantId:string,manifest:unknown){return this.#forTenant(tenantId).assertExecutionIsolated(manifest);}
  async assertTurnExecutionIsolated(tenantId:string,identity:unknown){return this.#forTenant(tenantId).assertTurnExecutionIsolated(identity);}
  async executionBlockers(tenantId:string){return this.#forTenant(tenantId).executionBlockers();}
  async archiveQuiescence(tenantId:string,scope:import('../turn/protocol.ts').TurnScope){return this.#forTenant(tenantId).archiveQuiescence(scope);}
  async executionBlockerCorrelation(tenantId:string,callKey:unknown){return this.#forTenant(tenantId).executionBlockerCorrelation(callKey);}
  async snapshot(tenantId:string,identity:unknown){return this.#forTenant(tenantId).snapshot(identity);}
}
