import { actor, message, turnBaseCheckpoints, type TurnResourceLease } from '../turn/protocol.ts';
import type { TurnRuntimePort } from '../turn/dispatcher.ts';
import { turnRuntimeActorName, turnRuntimeIdentity } from './identity.ts';

type ProductTurnRuntimeStub=Pick<TurnRuntimePort,'accept'|'observe'|'cancel'>;
export type ProductTurnRuntimeNamespace={getByName(name:string):ProductTurnRuntimeStub};

/** WorkspaceAgent-side adapter. Every RPC derives a fresh actor name from the
 * complete immutable identity; callers cannot supply a runtime actor ID. */
export class ProductTurnRuntimeClient implements TurnRuntimePort{
  readonly #namespace:ProductTurnRuntimeNamespace;
  constructor(namespace:ProductTurnRuntimeNamespace){if(!namespace?.getByName)throw Error('product-turn-runtime-namespace-required');this.#namespace=namespace;}
  async #stub(identity:ReturnType<typeof turnRuntimeIdentity>){return this.#namespace.getByName(await turnRuntimeActorName(identity));}
  async accept(raw:Omit<Parameters<TurnRuntimePort['accept']>[0],'capacityLease'>&{capacityLease?:TurnResourceLease}){
    const identity=turnRuntimeIdentity({scope:raw.scope,sessionId:raw.sessionId,turnId:raw.turnId,dispatchId:raw.dispatchId,generation:raw.generation}),input={...identity,actor:actor(raw.actor),message:message(raw.message),base:turnBaseCheckpoints(raw.base),...(raw.capacityLease===undefined?{}:{capacityLease:raw.capacityLease})},stub=await this.#stub(identity);return stub.accept(input as Parameters<TurnRuntimePort['accept']>[0]);
  }
  async observe(raw:Parameters<TurnRuntimePort['observe']>[0]){const identity=turnRuntimeIdentity({scope:raw.scope,sessionId:raw.sessionId,turnId:raw.turnId,dispatchId:raw.dispatchId,generation:raw.generation}),stub=await this.#stub(identity);return stub.observe({...identity,...(raw.capacityLease===undefined?{}:{capacityLease:raw.capacityLease})});}
  async cancel(raw:Parameters<TurnRuntimePort['cancel']>[0]){const identity=turnRuntimeIdentity({scope:raw.scope,sessionId:raw.sessionId,turnId:raw.turnId,dispatchId:raw.dispatchId,generation:raw.generation}),stub=await this.#stub(identity);return stub.cancel({...identity,...(raw.capacityLease===undefined?{}:{capacityLease:raw.capacityLease})});}
}
