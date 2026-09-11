import { actor, message, turnBaseCheckpoints, type TurnResourceLease } from '../turn/protocol.ts';
import type { TurnRuntimePort } from '../turn/dispatcher.ts';
import { ProductTurnRuntimeCore, storedProductTurnRuntimeIdentity, type ProductTurnRuntimeStorage } from './core.ts';
import { sameTurnRuntimeIdentity, turnRuntimeActorName, turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import type { ProductTurnRuntimeRelease } from './release.ts';

type RuntimeObjectId={equals(other:unknown):boolean};
type RuntimeNamespace={idFromName(name:string):RuntimeObjectId};
export type ProductTurnRuntimeHostEnv={PRODUCT_TURN_RUNTIME:RuntimeNamespace;M2_TURNS_ENABLED?:unknown};
export type ProductTurnRuntimeReleaseFactory=(ctx:DurableObjectState,env:ProductTurnRuntimeHostEnv,identity:TurnRuntimeIdentity)=>ProductTurnRuntimeRelease;

/** Identity-bound host separated from the Cloudflare wrapper so actor and
 * pre-mutation release gates can be verified independently. */
export class ProductTurnRuntimeHost implements TurnRuntimePort{
  readonly #ctx:DurableObjectState;readonly #env:ProductTurnRuntimeHostEnv;readonly #release:ProductTurnRuntimeReleaseFactory;
  #core:{identity:TurnRuntimeIdentity;value:ProductTurnRuntimeCore}|null=null;
  constructor(ctx:DurableObjectState,env:ProductTurnRuntimeHostEnv,release:ProductTurnRuntimeReleaseFactory){
    if(!ctx?.storage||!env?.PRODUCT_TURN_RUNTIME?.idFromName||typeof release!=='function')throw Error('product-turn-runtime-host-required');
    this.#ctx=ctx;this.#env=env;this.#release=release;
  }
  async #assertActor(identity:TurnRuntimeIdentity){const expected=this.#env.PRODUCT_TURN_RUNTIME.idFromName(await turnRuntimeActorName(identity));if(!expected.equals(this.#ctx.id))throw Error('product-turn-runtime-actor-scope-denied');}
  async #for(raw:TurnRuntimeIdentity,existingOnly=false):Promise<ProductTurnRuntimeCore>{
    const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);
    if(this.#core){if(!sameTurnRuntimeIdentity(this.#core.identity,identity))throw Error('product-turn-runtime-scope-denied');return this.#core.value;}
    // The release factory must succeed before ProductTurnRuntimeCore creates
    // its SQLite table or reserves an external execution.
    if(existingOnly&&!this.#ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='product_turn_runtime'").toArray().length)throw Error('product-turn-observer-denied');
    const ports=this.#release(this.#ctx,this.#env,identity);
    if(!ports?.execution||!ports.checkpoints)throw Error('product-turn-runtime-release-not-configured');
    const value=new ProductTurnRuntimeCore(this.#ctx.storage as ProductTurnRuntimeStorage,ports.execution,ports.checkpoints,Date.now,existingOnly,{retryMs:5000,assignmentGuardMs:360000,quietMs:30000,deadlineMs:600000,holdRetryMs:60000},ports.capacity??null,ports.trace);
    this.#core={identity,value};return value;
  }
  async accept(raw:Omit<Parameters<TurnRuntimePort['accept']>[0],'capacityLease'>&{capacityLease?:TurnResourceLease}){
    const identity=turnRuntimeIdentity({scope:raw.scope,sessionId:raw.sessionId,turnId:raw.turnId,dispatchId:raw.dispatchId,generation:raw.generation});
    await this.#assertActor(identity);
    if(this.#env.M2_TURNS_ENABLED!=='true'){
      if(!this.#ctx.storage.sql?.exec)throw Error('product-turn-runtime-release-not-configured');
      const table=this.#ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='product_turn_runtime'").toArray().length;
      const exists=table&&this.#ctx.storage.sql.exec('SELECT singleton FROM product_turn_runtime WHERE singleton=1').toArray().length;
      if(!exists)throw Error('product-turn-runtime-release-not-configured');
    }
    const input={...identity,actor:actor(raw.actor),message:message(raw.message),base:turnBaseCheckpoints(raw.base),...(raw.capacityLease===undefined?{}:{capacityLease:raw.capacityLease})};
    return (await this.#for(identity)).accept(input);
  }
  async currentObserverExecution(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw);return (await this.#for(identity,true)).currentObserverExecution(identity);}
  async observe(raw:Parameters<TurnRuntimePort['observe']>[0]){const identity=turnRuntimeIdentity({scope:raw.scope,sessionId:raw.sessionId,turnId:raw.turnId,dispatchId:raw.dispatchId,generation:raw.generation});return (await this.#for(identity)).observe({...identity,...(raw.capacityLease===undefined?{}:{capacityLease:raw.capacityLease})});}
  async cancel(raw:Parameters<TurnRuntimePort['cancel']>[0]){const identity=turnRuntimeIdentity({scope:raw.scope,sessionId:raw.sessionId,turnId:raw.turnId,dispatchId:raw.dispatchId,generation:raw.generation});return (await this.#for(identity)).cancel({...identity,...(raw.capacityLease===undefined?{}:{capacityLease:raw.capacityLease})});}
  async alarm(){
    if(!this.#ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='product_turn_runtime'").toArray().length)return;
    const row=this.#ctx.storage.sql.exec<{value:string}>('SELECT value FROM product_turn_runtime WHERE singleton=1').toArray()[0];if(!row)return;
    const identity=storedProductTurnRuntimeIdentity(JSON.parse(row.value));try{await (await this.#for(identity)).maintenance(identity);}catch(error){if(error instanceof Error&&['product-turn-release-pending','product-turn-release-unconfirmed'].includes(error.message))return;throw error;}
  }
}
