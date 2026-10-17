import {sameScope,type TurnScope,type TurnActor,turnId} from '../turn/protocol.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
import type {ProjectViewPackage} from '../project-views/package.ts';
import {projectViewAdmission,type ProjectViewPolicyEnv} from '../project-views/policy.ts';
import {PROJECT_VIEW_SESSION_MS,projectViewRuntimeCommand,runtimeObject,runtimeActorName,type ProjectViewRuntimeIdentity,type ProjectViewRuntimePort} from '../project-views/runtime-protocol.ts';

export interface GatewayProjectViewSessionEnv extends ProjectViewPolicyEnv{
 PROJECT_VIEW_RUNTIME?:{getByName(name:string):ProjectViewRuntimePort};
 WORKSPACE_AGENT:{getByName(name:string):{projectViews(input:{scope:TurnScope;actor:TurnActor}):Promise<ProjectViewPackage|null>;projectViewCurrent(input:{scope:TurnScope;actor:TurnActor;identity:string}):Promise<{current:boolean}>}};
}
type Authorize=(identity:ProjectViewRuntimeIdentity)=>Promise<void>;
async function detached<T>(raw:T):Promise<T>{try{return JSON.parse(JSON.stringify(raw)) as T;}finally{(raw as {[Symbol.dispose]?:()=>void}|null)?.[Symbol.dispose]?.();}}
export function createGatewayProjectViewSessionServices(env:GatewayProjectViewSessionEnv){
 const runtime=(id:string)=>{if(!env.PROJECT_VIEW_RUNTIME)throw Error('project-view-runtime-unavailable');return env.PROJECT_VIEW_RUNTIME.getByName(runtimeActorName(id));};
 const read=async(scope:TurnScope,actor:TurnActor)=>detached(await env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId)).projectViews({scope,actor}));
 const lookup=async(workspaceId:string,actor:TurnActor,id:string)=>{
  const stub=runtime(id),identity=await detached(await stub.lookup({sessionId:turnId(id),workspaceId,actor}));
  if(!identity||identity.sessionId!==id||identity.scope.workspaceId!==workspaceId||identity.actor.userId!==actor.userId)throw Error('project-view-session-denied');
  return {stub,identity};
 };
 const stop=async(stub:ProjectViewRuntimePort,identity:ProjectViewRuntimeIdentity,reason:string)=>detached(await stub.close({identity,reason}));
 async function current(identity:ProjectViewRuntimeIdentity,actor:TurnActor,authorize:Authorize){
  if(identity.actor.userId!==actor.userId||identity.actor.authVersion!==actor.authVersion)throw Error('project-view-session-denied');
  const admission=await projectViewAdmission(env,identity.scope,actor);
  if(admission.policyHash!==identity.policyHash)throw Error('project-view-session-policy-changed');
  await authorize(identity);
  const authority=await detached(await env.WORKSPACE_AGENT.getByName(workspaceAgentName(identity.scope.tenantId,identity.scope.workspaceId)).projectViewCurrent({scope:identity.scope,actor,identity:identity.packageIdentity}));
  if(!authority.current)throw Error('project-view-session-package-changed');
  // Catalog and admission may change while Workspace returns the package.
  await authorize(identity);await projectViewAdmission(env,identity.scope,actor);
 }
 return {
  async start(scope:TurnScope,actor:TurnActor,raw:unknown,authorize:Authorize){
   runtimeObject(raw,['requestId','packageIdentity','viewId']);
   const id=turnId(raw.requestId);
   if(typeof raw.packageIdentity!=='string'||! /^[a-f0-9]{64}$/.test(raw.packageIdentity)||typeof raw.viewId!=='string'||! /^[a-z][a-z0-9-]{0,47}$/.test(raw.viewId))throw Error('project-view-session-input-denied');
   const {policyHash,policy}=await projectViewAdmission(env,scope,actor);
   const identity:ProjectViewRuntimeIdentity={schema:'project.view-session/v1',sessionId:id,operationId:id,scope,actor,packageIdentity:raw.packageIdentity,viewId:raw.viewId,policyHash};
   const stub=runtime(id);
   try{
    await authorize(identity);const pkg=await read(scope,actor);
    const view=pkg?.manifest.views.find(view=>view.id===identity.viewId);
    if(!pkg||pkg.packageIdentity!==identity.packageIdentity||!sameScope(pkg.scope,scope)||!view)throw Error('project-view-session-package-changed');
    await current(identity,actor,authorize);
    const status=await detached(await stub.start({identity,pkg,view,expiresAt:Math.min(Date.now()+PROJECT_VIEW_SESSION_MS,policy.endsAt)}));
    await current(identity,actor,authorize);
    if(status.id!==id||status.status!=='running')throw Error('project-view-session-not-running');
    return {id};
   }catch(error){await stop(stub,identity,'start-failed').catch(()=>{});throw error;}
  },
  async command(workspaceId:string,actor:TurnActor,id:string,raw:unknown,authorize:Authorize){
   const command=projectViewRuntimeCommand(raw),{stub,identity}=await lookup(workspaceId,actor,id);
   try{
    await current(identity,actor,authorize);
    const result=await detached(await stub.command({identity,command}));
    await current(identity,actor,authorize);return result;
   }catch(error){await stop(stub,identity,'authorization-or-command-failed').catch(()=>{});throw error;}
  },
  async close(workspaceId:string,actor:TurnActor,id:string){
   const {stub,identity}=await lookup(workspaceId,actor,id);
   // Cleanup does not depend on current membership, generation, admission or policy.
   return stop(stub,identity,'client-closed');
  },
 };
}
