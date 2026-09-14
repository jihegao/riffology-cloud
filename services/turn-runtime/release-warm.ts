import {assembleProductTurnRuntimeRelease,type ProductTurnRuntimeRelease} from './release.ts';
import type {ProductTurnRuntimeReleaseEnv} from './release-gated.ts';
import type {TurnRuntimeIdentity} from './identity.ts';
import type {WorkspaceAgent} from '../workspace/durable.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
import {workspaceSandboxActor,type WorkspaceSandboxBinding} from '../sandbox/workspace-binding.ts';
import {revisionStoreActorName} from './revision-store-client.ts';
import {turnOperationTracer} from '../turn/operation-telemetry.ts';
import type {WorkspaceRuntimeBinding} from '../workspace/runtime-leases.ts';
import type {ProjectWorkspaceRpc} from './workspace.ts';
import type {TrustedPiSandboxActorApi} from './pi-native.ts';
import type {TurnRuntimeRetentionPort} from './core.ts';
const KEY='workspace-runtime-native-context';
type Bound={context:WorkspaceSandboxBinding;deadlineAt:number};
type Native={configureWorkspaceBinding(input:Bound):Promise<void>;[method:string]:unknown};
/** The cold assembly is reused behind identity-bound RPC adapters. Only its
 * native destinations and explicit resource disposition protocol differ. */
export function assembleWarmRuntime(ctx:DurableObjectState,env:ProductTurnRuntimeReleaseEnv,identity:TurnRuntimeIdentity,owner:WorkspaceAgent):ProductTurnRuntimeRelease{
 let bound=ctx.storage.kv.get<Bound>(KEY)??null;
 const requireBound=async()=>{if(bound)return bound;const current=await owner.workspaceRuntimeBinding({identity});if(!current)throw Error('workspace-runtime-binding-unavailable');throw Error('workspace-runtime-binding-input-unconfirmed');};
 const targets=new Map<string,Promise<Native>>();
 const target=async(domain:'project'|'trustedPi')=>{const current=await requireBound(),actorId=await workspaceSandboxActor(current.context.lease,domain);let result=targets.get(actorId);if(!result){result=(async()=>{const namespace=domain==='project'?env.PROJECT_SANDBOX:env.TRUSTED_PI_SANDBOX;const native=namespace.getByName(actorId) as Native;await native.configureWorkspaceBinding(current);return native;})();targets.set(actorId,result);}return result;};
 const proxy=(domain:'project'|'trustedPi')=>new Proxy({}, {get(_obj,key){if(key==='then')return undefined;return async(...args:unknown[])=>{const native=await target(domain),method=native[key as string];if(typeof method!=='function')throw Error('workspace-native-method-unavailable');return method.apply(native,args);};}});
 const release=assembleProductTurnRuntimeRelease(identity,{projectPreparation:{storage:ctx.storage,enabled:true},revisions:env.REVISION_STORE.getByName(revisionStoreActorName(identity.scope)),resolveProjectSandbox:()=>proxy('project') as ProjectWorkspaceRpc,resolveTrustedPiSandbox:()=>proxy('trustedPi') as TrustedPiSandboxActorApi,capacity:null,trace:turnOperationTracer(env.M2_TURN_OPERATION_TELEMETRY)});
 const original=release.execution;
 release.execution={...original,async fenceUnresolvedStart(_identity,outcome){return {identity,phase:'terminal',outcome,executionErrorCode:'turn-native-start-unresolved',events:[],stopped:null};},async start(input){
   const current=await owner.bindWorkspaceRuntime({identity,executionDeadlineAt:input.executionDeadlineAt!});if(!current)throw Error('workspace-runtime-binding-unavailable');
   const filesSha256=input.base.workspace?.filesSha256??input.base.initial?.filesSha256??Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(10240))),n=>n.toString(16).padStart(2,'0')).join('');
   const next:Bound={context:{lease:current.lease,identity,bindingEpoch:current.binding.bindingEpoch,filesSha256},deadlineAt:current.executionDeadlineAt};
   const saved=ctx.storage.kv.get<Bound>(KEY);if(saved&&JSON.stringify(saved)!==JSON.stringify(next))throw Error('workspace-runtime-binding-input-conflict');ctx.storage.kv.put(KEY,next);await ctx.storage.sync();bound=next;
   return original.start(input);
 }};
 release.retention={async settle(input){return owner.settleWorkspaceRuntime(input);}} as TurnRuntimeRetentionPort;
 return release;
}
export async function runtimeWorkspaceSelection(env:ProductTurnRuntimeReleaseEnv,identity:TurnRuntimeIdentity){
 const owner=env.WORKSPACE_AGENT?.getByName(workspaceAgentName(identity.scope.tenantId,identity.scope.workspaceId)) as WorkspaceAgent|undefined;
 if(!owner||typeof owner.workspaceRuntimeSelection!=='function')return null;
 const selection=await owner.workspaceRuntimeSelection({identity});return selection?.mode==='warm'?owner:null;
}
