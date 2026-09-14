import {actor as checkedActor,positive,sameScope,scope as checkedScope,turnDigest,turnId,workspaceBindingLease,workspaceTurnBinding,type TurnActor,type TurnScope,type WorkspaceBindingLease,type WorkspaceTurnBinding} from '../turn/protocol.ts';
import {turnRuntimeIdentity,type TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
export type WarmOutboundRequest={scope:TurnScope;turnId:string;dispatchId:string;containerId:string;deadlineAt:number}&({purpose:'model';sessionId:string;actor:TurnActor}|{purpose:'research';sessionId:string;actor?:never}|{purpose:'tool';sessionId?:never;actor?:never});
export type WarmOutboundAuthority={actorId:string;identity:TurnRuntimeIdentity;actor:TurnActor;executionDeadlineAt:number;lease:WorkspaceBindingLease;binding:WorkspaceTurnBinding};
export type WarmAuthorityNamespace={getByName(name:string):{workspaceRuntimeAuthority?(input:WarmOutboundRequest):Promise<WarmOutboundAuthority>}};
export type WarmAuthorityEnv={WORKSPACE_AGENT?:WarmAuthorityNamespace;TRUSTED_PI_SANDBOX:{idFromName(name:string):{toString():string}}};
const deny=():never=>{throw Error('warm-outbound-authority-denied');};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export async function warmTrustedPiActorId(lease:WorkspaceBindingLease):Promise<string>{return `m2-wt-${(await turnDigest({schemaVersion:1,ref:workspaceBindingLease(lease),domain:'trustedPi'})).slice(0,55)}`;}
/** Lookup is read-only and authoritative. A physical container match alone is
 * insufficient: a warm actor has hosted earlier, now revoked Turn bindings. */
export async function authorizeWarmOutbound(env:WarmAuthorityEnv,raw:WarmOutboundRequest,clock:()=>number=Date.now):Promise<WarmOutboundAuthority>{
 const input={scope:checkedScope(raw.scope),turnId:turnId(raw.turnId),dispatchId:turnId(raw.dispatchId),containerId:raw.containerId,deadlineAt:positive(raw.deadlineAt),purpose:raw.purpose,...(raw.sessionId===undefined?{}:{sessionId:turnId(raw.sessionId)}),...(raw.actor===undefined?{}:{actor:checkedActor(raw.actor)})} as WarmOutboundRequest;
 if(!['model','tool','research'].includes(input.purpose)||!(/^[A-Za-z0-9-]{1,128}$/).test(input.containerId)||input.deadlineAt<=positive(clock())||input.purpose==='model'&&(!input.actor||!input.sessionId)||input.purpose==='research'&&!input.sessionId)deny();
 const target=env.WORKSPACE_AGENT?.getByName(workspaceAgentName(input.scope.tenantId,input.scope.workspaceId));if(!target?.workspaceRuntimeAuthority)deny();
 const result=await target!.workspaceRuntimeAuthority!(input);
 if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='actor,actorId,binding,executionDeadlineAt,identity,lease')deny();
 const value:WarmOutboundAuthority={actorId:turnId(result.actorId),identity:turnRuntimeIdentity(result.identity),actor:checkedActor(result.actor),executionDeadlineAt:positive(result.executionDeadlineAt),lease:workspaceBindingLease(result.lease),binding:workspaceTurnBinding(result.binding)};
 if(!sameScope(value.identity.scope,input.scope)||!sameScope(value.lease.scope,input.scope)||value.identity.turnId!==input.turnId||value.identity.dispatchId!==input.dispatchId||value.identity.generation!==input.scope.workspaceGeneration||value.binding.turnId!==input.turnId||value.binding.dispatchId!==input.dispatchId||value.binding.sessionId!==value.identity.sessionId||(input.sessionId!==undefined&&input.sessionId!==value.identity.sessionId)||(input.actor!==undefined&&!same(value.actor,input.actor))||input.deadlineAt>value.executionDeadlineAt)deny();
 if(value.actorId!==await warmTrustedPiActorId(value.lease)||env.TRUSTED_PI_SANDBOX.idFromName(value.actorId).toString()!==input.containerId||input.deadlineAt<=positive(clock()))deny();
 return value;
}
