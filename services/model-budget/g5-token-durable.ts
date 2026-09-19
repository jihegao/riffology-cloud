import {DurableObject} from 'cloudflare:workers';
import {SqlTenantModelBudget,modelBudgetTenantName,type ModelBudgetPolicy,type ModelCallReference} from './core.ts';
import type {TenantModelBudgetEnv} from './durable.ts';
export interface G5TokenEnv {G5_TOKEN_BUDGET:DurableObjectNamespace<G5TenantModelBudget>;G5_TOKEN_BUDGET_POLICY_JSON?:string}
const decimal=(v:string)=>{if(typeof v!=='string'||!/^[1-9][0-9]{0,8}$/.test(v))throw Error('invalid-model-budget-configuration');return Number(v);};
/** Additive export/namespace. Keeps old G4 actors, configuration and state intact.
 * This private token ledger alone cannot authorize provider/network execution. */
export class G5TenantModelBudget extends DurableObject<G5TokenEnv>{
 #tenant:string|null=null;#core:SqlTenantModelBudget|null=null;
 #forTenant(tenantId:string){if(!this.env.G5_TOKEN_BUDGET.idFromName(modelBudgetTenantName(tenantId)).equals(this.ctx.id))throw Error('g5-token-actor-scope-denied');if(this.#tenant!==null&&this.#tenant!==tenantId)throw Error('g5-token-tenant-conflict');if(!this.#core){const raw=JSON.parse(this.env.G5_TOKEN_BUDGET_POLICY_JSON??'null');if(!raw||Object.keys(raw).sort().join(',')!=='maxDispatchedCallsPerTurn,maxInputTokensPerCall,maxOutputTokensPerCall,maxReservationAttemptsPerTurn,maxReservedTokensPerTurn,version'||raw.version!=='g5-openai-luna-20260916-v1'||raw.maxReservationAttemptsPerTurn!==8||raw.maxDispatchedCallsPerTurn!==8||raw.maxInputTokensPerCall!==262144||raw.maxOutputTokensPerCall!==4096||raw.maxReservedTokensPerTurn!==2129920)throw Error('g5-token-policy-invalid');const policy:ModelBudgetPolicy={tenantId,...raw};this.#core=new SqlTenantModelBudget(this.ctx.storage,policy,Date.now,()=>crypto.randomUUID(),null);this.#tenant=tenantId;}return this.#core;}
 async reserve(tenantId:string,request:unknown){return this.#forTenant(tenantId).reserve(request);}
 async lookup(tenantId:string,identity:unknown,callId:unknown){return this.#forTenant(tenantId).lookup(identity,callId);}
 async dispatch(tenantId:string,reference:unknown){return this.#forTenant(tenantId).dispatch(reference);}
 async markUnknown(tenantId:string,reference:unknown){return this.#forTenant(tenantId).markUnknown(reference);}
 async finish(tenantId:string,reference:ModelCallReference,terminal:unknown){return this.#forTenant(tenantId).finish(reference,terminal);}
 async releaseUndispatched(tenantId:string,reference:ModelCallReference,proof:unknown){return this.#forTenant(tenantId).releaseUndispatched(reference,proof);}
 async assertExecutionQuiet(tenantId:string){return this.#forTenant(tenantId).assertExecutionQuiet();}
 async executionBlockers(tenantId:string){return this.#forTenant(tenantId).executionBlockers();}
 async snapshot(tenantId:string,identity:unknown){return this.#forTenant(tenantId).snapshot(identity);}
 async closeTurnAdmission(tenantId:string,identity:unknown){return this.#forTenant(tenantId).closeTurnAdmission(identity);}
 async turnSettlement(tenantId:string,identity:unknown){return this.#forTenant(tenantId).turnSettlement(identity);}
}
