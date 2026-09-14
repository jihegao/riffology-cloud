import { DurableObject } from 'cloudflare:workers';
import { PRODUCTION_MONEY_ACTOR, ProductionMoneyLedger, type MoneyPolicy, type MoneyRecord, type MoneyReference, type MoneyReservation, type NoDispatchProof } from './production-money.ts';
export interface ProductionMoneyEnv {
 PRODUCTION_MODEL_BUDGET:DurableObjectNamespace<ProductionModelBudget>;
 PRODUCTION_MODEL_ENABLED?:string;
 PRODUCTION_MONEY_POLICY_JSON?:string;
}
/** This namespace is private to Model Proxy. Never expose an arbitrary RPC
 * forwarding route in Gateway or supply this binding to Project Sandbox. */
export class ProductionModelBudget extends DurableObject<ProductionMoneyEnv>{
 #core(maintenance=false):ProductionMoneyLedger{
  if(!this.env.PRODUCTION_MODEL_BUDGET.idFromName(PRODUCTION_MONEY_ACTOR).equals(this.ctx.id))throw Error('production-money-actor-denied');
  const raw=JSON.parse(this.env.PRODUCTION_MONEY_POLICY_JSON??'null') as MoneyPolicy;
  if(!raw&&!maintenance)throw Error('production-money-unconfigured');
  return new ProductionMoneyLedger(this.ctx.storage,raw?{...raw,enabled:this.env.PRODUCTION_MODEL_ENABLED==='true'}:null);
 }
 async closeTurnAdmission(identity:unknown){return this.#core(true).closeTurnAdmission(identity);}
 async turnSettlement(identity:unknown){return this.#core(true).turnSettlement(identity);}
 async admit(value:MoneyReservation){return this.#core().admit(value);}
 async reserve(value:MoneyReservation){return this.#core().reserve(value);}
 async dispatch(reference:MoneyReference){return this.#core().dispatch(reference);}
 async markUnknown(reference:MoneyReference,category:string){return this.#core().markUnknown(reference,category);}
 async finish(reference:MoneyReference,terminal:NonNullable<MoneyRecord['terminal']>){return this.#core().finish(reference,terminal);}
 async releaseUndispatched(reference:MoneyReference,proof:NoDispatchProof){return this.#core().releaseUndispatched(reference,proof);}
 async lookup(reference:MoneyReference){return this.#core().lookup(reference);}
}
