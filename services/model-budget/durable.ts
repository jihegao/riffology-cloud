import { DurableObject } from 'cloudflare:workers';
import { SqlTenantModelBudget, modelBudgetTenantName, type ModelBudgetPolicy, type ModelCallReference } from './core.ts';

export interface TenantModelBudgetEnv{
  TENANT_MODEL_BUDGET:DurableObjectNamespace<TenantModelBudget>;
  MODEL_BUDGET_POLICY_VERSION:string;
  MODEL_BUDGET_MAX_RESERVATION_ATTEMPTS_PER_TURN:string;
  MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN:string;
  MODEL_BUDGET_MAX_INPUT_TOKENS_PER_CALL:string;
  MODEL_BUDGET_MAX_OUTPUT_TOKENS_PER_CALL:string;
  MODEL_BUDGET_MAX_RESERVED_TOKENS_PER_TURN:string;
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
    if(!this.#core){const policy:ModelBudgetPolicy={tenantId,version:this.env.MODEL_BUDGET_POLICY_VERSION,maxReservationAttemptsPerTurn:decimal(this.env.MODEL_BUDGET_MAX_RESERVATION_ATTEMPTS_PER_TURN),maxDispatchedCallsPerTurn:decimal(this.env.MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN),maxInputTokensPerCall:decimal(this.env.MODEL_BUDGET_MAX_INPUT_TOKENS_PER_CALL),maxOutputTokensPerCall:decimal(this.env.MODEL_BUDGET_MAX_OUTPUT_TOKENS_PER_CALL),maxReservedTokensPerTurn:decimal(this.env.MODEL_BUDGET_MAX_RESERVED_TOKENS_PER_TURN)};this.#core=new SqlTenantModelBudget(this.ctx.storage,policy);this.#tenantId=tenantId;}
    return this.#core;
  }
  async reserve(tenantId:string,request:unknown){return this.#forTenant(tenantId).reserve(request);}
  async lookup(tenantId:string,identity:unknown,callId:unknown){return this.#forTenant(tenantId).lookup(identity,callId);}
  async dispatch(tenantId:string,reference:unknown){return this.#forTenant(tenantId).dispatch(reference);}
  async markUnknown(tenantId:string,reference:unknown){return this.#forTenant(tenantId).markUnknown(reference);}
  async finish(tenantId:string,reference:ModelCallReference,terminal:unknown){return this.#forTenant(tenantId).finish(reference,terminal);}
  async releaseUndispatched(tenantId:string,reference:ModelCallReference,proof:unknown){return this.#forTenant(tenantId).releaseUndispatched(reference,proof);}
  async snapshot(tenantId:string,identity:unknown){return this.#forTenant(tenantId).snapshot(identity);}
}
