import { assembleProductTurnRuntimeRelease, type ProductTurnRuntimeRelease } from './release.ts';
import type { ProductTurnRuntimeHostEnv } from './host.ts';
import type { TurnRuntimeIdentity } from './identity.ts';
import type { ProjectWorkspaceRpc } from './workspace.ts';
import type { TrustedPiSandboxProcessApi } from './pi-native.ts';
import { REVISION_STORE_ACTOR, type RevisionStoreNamespace } from './revision-store-client.ts';

export type { ProductTurnRuntimeRelease } from './release.ts';

export interface ProductTurnRuntimeReleaseEnv extends ProductTurnRuntimeHostEnv {
  M2_TURNS_ENABLED: unknown;
  REVISION_STORE: RevisionStoreNamespace;
  PROJECT_SANDBOX: {idFromName(name:string):unknown;getByName(name:string):unknown};
  TRUSTED_PI_SANDBOX: {idFromName(name:string):unknown;getByName(name:string):unknown};
}
export interface ProductTurnRuntimeSandboxResolver{
  project(env:ProductTurnRuntimeReleaseEnv,actorId:string):ProjectWorkspaceRpc;
  trustedPi(env:ProductTurnRuntimeReleaseEnv,actorId:string):TrustedPiSandboxProcessApi;
}

function configured(raw:ProductTurnRuntimeHostEnv):ProductTurnRuntimeReleaseEnv{
  const env=raw as ProductTurnRuntimeReleaseEnv;
  if(env.M2_TURNS_ENABLED!=='true')throw Error('product-turn-runtime-release-not-configured');
  if(!env.REVISION_STORE?.getByName
    ||!env.PROJECT_SANDBOX?.idFromName||!env.PROJECT_SANDBOX?.getByName
    ||!env.TRUSTED_PI_SANDBOX?.idFromName||!env.TRUSTED_PI_SANDBOX?.getByName)throw Error('product-turn-runtime-release-dependencies-required');
  return env;
}

/** Production release assembly is reachable only behind the exact Turn gate.
 * Sandbox actors are resolved lazily from the immutable Turn identity; merely
 * constructing the Durable Object cannot allocate a container or touch R2. */
export function productTurnRuntimeRelease(
  _ctx:DurableObjectState,
  rawEnv:ProductTurnRuntimeHostEnv,
  identity:TurnRuntimeIdentity,
  sandboxes:ProductTurnRuntimeSandboxResolver,
):ProductTurnRuntimeRelease{
  const env=configured(rawEnv);
  if(!sandboxes||typeof sandboxes.project!=='function'||typeof sandboxes.trustedPi!=='function')throw Error('product-turn-runtime-release-dependencies-required');
  return assembleProductTurnRuntimeRelease(identity,{
    revisions:env.REVISION_STORE.getByName(REVISION_STORE_ACTOR),
    resolveProjectSandbox(actorId){return sandboxes.project(env,actorId);},
    resolveTrustedPiSandbox(actorId){return sandboxes.trustedPi(env,actorId);},
  });
}
