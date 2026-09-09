import { actor, message, turnBaseCheckpoints } from '../turn/protocol.ts';
import type { TurnRuntimePort } from '../turn/dispatcher.ts';
import { ProductTurnRuntimeCore, type ProductTurnRuntimeStorage } from './core.ts';
import { sameTurnRuntimeIdentity, turnRuntimeActorName, turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import type { ProductTurnRuntimeRelease } from './release.ts';

type RuntimeObjectId={equals(other:unknown):boolean};
type RuntimeNamespace={idFromName(name:string):RuntimeObjectId};
export type ProductTurnRuntimeHostEnv={PRODUCT_TURN_RUNTIME:RuntimeNamespace};
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
  async #for(raw:TurnRuntimeIdentity,existingOnly=false):Promise<ProductTurnRuntimeCore>{
    const identity=turnRuntimeIdentity(raw),expected=this.#env.PRODUCT_TURN_RUNTIME.idFromName(await turnRuntimeActorName(identity));
    if(!expected.equals(this.#ctx.id))throw Error('product-turn-runtime-actor-scope-denied');
    if(this.#core){if(!sameTurnRuntimeIdentity(this.#core.identity,identity))throw Error('product-turn-runtime-scope-denied');return this.#core.value;}
    // The release factory must succeed before ProductTurnRuntimeCore creates
    // its SQLite table or reserves an external execution.
    if(existingOnly&&!this.#ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='product_turn_runtime'").toArray().length)throw Error('product-turn-observer-denied');
    const ports=this.#release(this.#ctx,this.#env,identity);
    if(!ports?.execution||!ports.checkpoints)throw Error('product-turn-runtime-release-not-configured');
    const value=new ProductTurnRuntimeCore(this.#ctx.storage as ProductTurnRuntimeStorage,ports.execution,ports.checkpoints,Date.now,existingOnly);
    this.#core={identity,value};return value;
  }
  async accept(raw:Parameters<TurnRuntimePort['accept']>[0]){
    const identity=turnRuntimeIdentity({scope:raw.scope,sessionId:raw.sessionId,turnId:raw.turnId,dispatchId:raw.dispatchId,generation:raw.generation});
    const input={...identity,actor:actor(raw.actor),message:message(raw.message),base:turnBaseCheckpoints(raw.base)};
    return (await this.#for(identity)).accept(input);
  }
  async currentObserverExecution(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw);return (await this.#for(identity,true)).currentObserverExecution(identity);}
  async observe(raw:Parameters<TurnRuntimePort['observe']>[0]){const identity=turnRuntimeIdentity(raw);return (await this.#for(identity)).observe(identity);}
  async cancel(raw:Parameters<TurnRuntimePort['cancel']>[0]){const identity=turnRuntimeIdentity(raw);return (await this.#for(identity)).cancel(identity);}
}
