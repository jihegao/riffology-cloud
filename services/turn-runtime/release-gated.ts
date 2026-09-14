import { assembleProductTurnRuntimeRelease, type ProductTurnRuntimeRelease } from './release.ts';
import type { ProductTurnRuntimeHostEnv } from './host.ts';
import type { TurnRuntimeIdentity } from './identity.ts';
import type { ProjectWorkspaceRpc } from './workspace.ts';
import type { TrustedPiSandboxActorApi } from './pi-native.ts';
import { revisionStoreActorName, type RevisionStoreNamespace } from './revision-store-client.ts';
import { trustedPiCapacityClient, type TrustedPiCapacityNamespace } from '../capacity/client.ts';
import { turnOperationTracer } from '../turn/operation-telemetry.ts';

export type { ProductTurnRuntimeRelease } from './release.ts';

export interface ProductTurnRuntimeReleaseEnv extends ProductTurnRuntimeHostEnv {
  M2_TURNS_ENABLED: unknown;
  M2_LAZY_PROJECT_ENABLED?:unknown;
  WORKSPACE_AGENT?:{getByName(name:string):unknown};
  REVISION_STORE: RevisionStoreNamespace;
  PROJECT_SANDBOX: {idFromName(name:string):unknown;getByName(name:string):unknown};
  TRUSTED_PI_SANDBOX: {idFromName(name:string):unknown;getByName(name:string):unknown};
  TRUSTED_PI_CAPACITY: TrustedPiCapacityNamespace;
  M2_TURN_OPERATION_TELEMETRY?:unknown;
}
export interface ProductTurnRuntimeSandboxResolver{
  project(env:ProductTurnRuntimeReleaseEnv,actorId:string):ProjectWorkspaceRpc;
  trustedPi(env:ProductTurnRuntimeReleaseEnv,actorId:string):TrustedPiSandboxActorApi;
}

function configured(raw:ProductTurnRuntimeHostEnv):ProductTurnRuntimeReleaseEnv{
  const env=raw as ProductTurnRuntimeReleaseEnv;
  if(!env.REVISION_STORE?.getByName
    ||!env.PROJECT_SANDBOX?.idFromName||!env.PROJECT_SANDBOX?.getByName
    ||!env.TRUSTED_PI_SANDBOX?.idFromName||!env.TRUSTED_PI_SANDBOX?.getByName
    ||!env.TRUSTED_PI_CAPACITY?.getByName||env.M2_LAZY_PROJECT_ENABLED==='true'&&!env.WORKSPACE_AGENT?.getByName)throw Error('product-turn-runtime-release-dependencies-required');
  return env;
}

/** Production ports require every authority binding, while the admission gate
 * remains in ProductTurnRuntimeHost. Existing identity-bound actors must keep
 * checkpoint and Sandbox-release maintenance during a gate-off rollback. */
export function productTurnRuntimeRelease(
  _ctx:DurableObjectState,
  rawEnv:ProductTurnRuntimeHostEnv,
  identity:TurnRuntimeIdentity,
  sandboxes:ProductTurnRuntimeSandboxResolver,
):ProductTurnRuntimeRelease{
  const env=configured(rawEnv);
  if(!sandboxes||typeof sandboxes.project!=='function'||typeof sandboxes.trustedPi!=='function')throw Error('product-turn-runtime-release-dependencies-required');
  return assembleProductTurnRuntimeRelease(identity,{
    projectPreparation:{storage:_ctx.storage,enabled:env.M2_LAZY_PROJECT_ENABLED==='true'},
    revisions:env.REVISION_STORE.getByName(revisionStoreActorName(identity.scope)),
    resolveProjectSandbox(actorId){return sandboxes.project(env,actorId);},
    resolveTrustedPiSandbox(actorId){return sandboxes.trustedPi(env,actorId);},
    capacity:trustedPiCapacityClient(env.TRUSTED_PI_CAPACITY),
    trace:turnOperationTracer(env.M2_TURN_OPERATION_TELEMETRY),
  });
}
