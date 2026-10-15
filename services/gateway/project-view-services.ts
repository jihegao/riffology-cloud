import {workspaceAgentName} from '../workspace/protocol.ts';
import type {TurnActor,TurnScope} from '../turn/protocol.ts';
import type {ProjectViewPackage} from '../project-views/package.ts';
export function createGatewayProjectViewServices(env:{APP_ORIGIN?:string;BROWSER_PREVIEW_EXECUTION_ORIGIN?:string;WORKSPACE_AGENT:{getByName(name:string):{projectViews(input:{scope:TurnScope;actor:TurnActor}):Promise<ProjectViewPackage|null>;projectViewArtifacts?(input:{scope:TurnScope;actor:TurnActor;identity:string;cursor?:string|null;artifactId?:string;offset?:number}):Promise<unknown>}}}){
 const gate=()=>{
  // The isolated browser host remains a local-only candidate. Preserve both
  // loopback gates before any Workspace read; production is never enabled here.
  const local=(value:string|undefined)=>{try{const u=new URL(value!);return ['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&['http:','https:'].includes(u.protocol)&&u.href===u.origin+'/';}catch{return false;}};
  if(!local(env.APP_ORIGIN)||!local(env.BROWSER_PREVIEW_EXECUTION_ORIGIN)||new URL(env.APP_ORIGIN!).origin===new URL(env.BROWSER_PREVIEW_EXECUTION_ORIGIN!).origin)throw Error('project-view-navigation-egress-unresolved');
 };
 return {async artifacts(scope:TurnScope,actor:TurnActor,query:{identity:string;cursor?:string|null;artifactId?:string;offset?:number}){
  gate();const stub=env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));if(!stub.projectViewArtifacts)throw Error('project-artifact-unavailable');
  const raw=await stub.projectViewArtifacts({scope,actor,...query});try{return JSON.parse(JSON.stringify(raw));}finally{(raw as {[Symbol.dispose]?:()=>void}|null)?.[Symbol.dispose]?.();}
 },async read(scope:TurnScope,actor:TurnActor){
  gate();
  const raw=await env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId)).projectViews({scope,actor});
  try{
   const pkg=raw===null?null:JSON.parse(JSON.stringify(raw)) as ProjectViewPackage;
   if(!pkg)return {package:null,delivery:null};
   if(!env.BROWSER_PREVIEW_EXECUTION_ORIGIN)throw Error('project-view-execution-unavailable');
   const origin=new URL(env.BROWSER_PREVIEW_EXECUTION_ORIGIN).origin;
   return {package:pkg,delivery:{executionOrigin:origin,transport:'isolated-browser/v1'}};
  }finally{(raw as {[Symbol.dispose]?:()=>void}|null)?.[Symbol.dispose]?.();}
 }};
}
