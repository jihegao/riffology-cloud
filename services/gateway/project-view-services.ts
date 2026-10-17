import {workspaceAgentName} from '../workspace/protocol.ts';
import type {TurnActor,TurnScope} from '../turn/protocol.ts';
import type {ProjectViewPackage} from '../project-views/package.ts';
import {projectViewAdmission,type ProjectViewPolicyEnv} from '../project-views/policy.ts';
import {projectViewBrowserAdmission,type ProjectViewBrowserPolicyEnv} from '../project-views/browser-policy.ts';
import {PROJECT_VIEW_FRAME_PATH,PROJECT_VIEW_FRAME_SHA256} from '../project-views/frame.mjs';
export function createGatewayProjectViewServices(env:ProjectViewPolicyEnv & ProjectViewBrowserPolicyEnv & {BROWSER_PREVIEW_EXECUTION_ORIGIN?:string;PROJECT_VIEW_RUNTIME?:unknown;WORKSPACE_AGENT:{getByName(name:string):{projectViews(input:{scope:TurnScope;actor:TurnActor}):Promise<ProjectViewPackage|null>;projectViewArtifacts?(input:{scope:TurnScope;actor:TurnActor;identity:string;cursor?:string|null;artifactId?:string;offset?:number}):Promise<unknown>}}}){
 const browserMode=env.PROJECT_VIEW_BROWSER_POLICY_JSON!==undefined;
 const gate=async(scope:TurnScope,actor:TurnActor)=>{
  if(browserMode){projectViewBrowserAdmission(env,scope,actor);return 'browser-local' as const;}
  if(env.PROJECT_VIEW_POLICY_JSON!==undefined){
   if(!env.PROJECT_VIEW_RUNTIME)throw Error('project-view-admission-closed');
   await projectViewAdmission(env,scope,actor);return 'authenticated' as const;
  }
  // The isolated browser host remains a local-only candidate. Preserve both
  // loopback gates before any Workspace read; production is never enabled here.
  const local=(value:string|undefined)=>{try{const u=new URL(value!);return ['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&['http:','https:'].includes(u.protocol)&&u.href===u.origin+'/';}catch{return false;}};
  if(!local(env.APP_ORIGIN)||!local(env.BROWSER_PREVIEW_EXECUTION_ORIGIN)||new URL(env.APP_ORIGIN!).origin===new URL(env.BROWSER_PREVIEW_EXECUTION_ORIGIN!).origin)throw Error('project-view-navigation-egress-unresolved');
  return 'local' as const;
 };
 return {...(browserMode?{browserLocal:true as const}:{}),async artifacts(scope:TurnScope,actor:TurnActor,query:{identity:string;cursor?:string|null;artifactId?:string;offset?:number}){
  await gate(scope,actor);const stub=env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));if(!stub.projectViewArtifacts)throw Error('project-artifact-unavailable');
  const raw=await stub.projectViewArtifacts({scope,actor,...query});try{await gate(scope,actor);return JSON.parse(JSON.stringify(raw));}finally{(raw as {[Symbol.dispose]?:()=>void}|null)?.[Symbol.dispose]?.();}
 },async read(scope:TurnScope,actor:TurnActor){
  const transport=await gate(scope,actor);
  const raw=await env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId)).projectViews({scope,actor});
  try{
   const pkg=raw===null?null:JSON.parse(JSON.stringify(raw)) as ProjectViewPackage;
   await gate(scope,actor);
   if(!pkg)return {package:null,delivery:null};
   if(transport==='browser-local'){const origin=new URL(env.APP_ORIGIN!).origin;return {package:pkg,delivery:{execution:'browser-local',transport:'native-dom/v1',executionOrigin:origin,frameUrl:origin+PROJECT_VIEW_FRAME_PATH,frameSha256:PROJECT_VIEW_FRAME_SHA256}};}
   if(transport==='authenticated')return {package:pkg,delivery:{executionOrigin:new URL(env.APP_ORIGIN!).origin,transport:'isolated-browser-authenticated/v1',sessionPath:'/api/workspaces/'+encodeURIComponent(scope.workspaceId)+'/project-view-sessions'}};
   if(!env.BROWSER_PREVIEW_EXECUTION_ORIGIN)throw Error('project-view-execution-unavailable');
   const origin=new URL(env.BROWSER_PREVIEW_EXECUTION_ORIGIN).origin;
   return {package:pkg,delivery:{executionOrigin:origin,transport:'isolated-browser/v1'}};
  }finally{(raw as {[Symbol.dispose]?:()=>void}|null)?.[Symbol.dispose]?.();}
 }};
}
