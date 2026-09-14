import {assembleWarmRuntime,runtimeWorkspaceSelection} from './release-warm.ts';
import type {TurnRuntimeIdentity} from './identity.ts';
import { DurableObject } from 'cloudflare:workers';
import type { ProjectToolSandbox, TrustedPiSandbox } from '../sandbox/classes.ts';
import type { TurnRuntimePort } from '../turn/dispatcher.ts';
import { ProductTurnRuntimeHost, type ProductTurnRuntimeHostEnv } from './host.ts';
import { productTurnRuntimeRelease, type ProductTurnRuntimeReleaseEnv } from './release-gated.ts';
import type { ProjectWorkspaceRpc } from './workspace.ts';
import type { TrustedPiSandboxActorApi } from './pi-native.ts';
import type { RevisionStore } from './revision-store.ts';

export interface ProductTurnRuntimeEnv extends ProductTurnRuntimeReleaseEnv{
  PRODUCT_TURN_RUNTIME:DurableObjectNamespace<ProductTurnRuntime>;
  PROJECT_SANDBOX:DurableObjectNamespace<ProjectToolSandbox>;
  TRUSTED_PI_SANDBOX:DurableObjectNamespace<TrustedPiSandbox>;
  REVISION_STORE:DurableObjectNamespace<RevisionStore>;
}

const release=async(ctx:DurableObjectState,rawEnv:ProductTurnRuntimeHostEnv,identity:Parameters<typeof productTurnRuntimeRelease>[2])=>{const configured=rawEnv as ProductTurnRuntimeReleaseEnv,owner=await runtimeWorkspaceSelection(configured,identity);if(owner)return assembleWarmRuntime(ctx,configured,identity,owner);return productTurnRuntimeRelease(ctx,rawEnv,identity,{
  // Both Sandbox classes fix their own sleep policy. Direct named RPC keeps
  // this control-plane wrapper independent from SDK client enhancements.
  project(configured,actorId){return configured.PROJECT_SANDBOX.getByName(actorId) as ProjectWorkspaceRpc;},
  trustedPi(configured,actorId){return configured.TRUSTED_PI_SANDBOX.getByName(actorId) as unknown as TrustedPiSandboxActorApi;},
});};

/** Private RPC only. There is no fetch handler and no fallback to M1
 * ProjectRuntime. */
export class ProductTurnRuntime extends DurableObject<ProductTurnRuntimeEnv>{
  #host=new ProductTurnRuntimeHost(this.ctx,this.env,release);
  async accept(input:Parameters<TurnRuntimePort['accept']>[0]){return this.#host.accept(input);}
  async workspaceRuntimeState(identity:TurnRuntimeIdentity){return this.#host.workspaceRuntimeState(identity);}
  async projectPreparationRequired(identity:TurnRuntimeIdentity){return this.#host.projectPreparationRequired(identity);}
  async prepareProjectTool(input:Parameters<ProductTurnRuntimeHost['prepareProjectTool']>[0]){return this.#host.prepareProjectTool(input);}
  async currentObserverExecution(input:Parameters<ProductTurnRuntimeHost['currentObserverExecution']>[0]){return this.#host.currentObserverExecution(input);}
  async observe(input:Parameters<TurnRuntimePort['observe']>[0]){return this.#host.observe(input);}
  async cancel(input:Parameters<TurnRuntimePort['cancel']>[0]){return this.#host.cancel(input);}
  async alarm(){return this.#host.alarm();}
}
