import {actor,scope,sameScope,type TurnActor,type TurnScope} from '../turn/protocol.ts';
import {runtimeObject} from './runtime-protocol.ts';

/** Separate from paid remote-browser admission; an absent grant stays closed. */
export type ProjectViewBrowserPolicy={schema:'project-view-browser-policy/v1';enabled:boolean;startsAt:number;endsAt:number;dataEgress:'accepted';grants:Array<{scope:TurnScope;actor:TurnActor}>};
export interface ProjectViewBrowserPolicyEnv{APP_ORIGIN?:string;PROJECT_VIEW_BROWSER_POLICY_JSON?:string;}
export function parseProjectViewBrowserPolicy(raw:unknown):ProjectViewBrowserPolicy|null{
 try{
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>16384)return null;
  const value:unknown=JSON.parse(raw);runtimeObject(value,['schema','enabled','startsAt','endsAt','dataEgress','grants']);
  if(value.schema!=='project-view-browser-policy/v1'||typeof value.enabled!=='boolean'||!Number.isSafeInteger(value.startsAt)||!Number.isSafeInteger(value.endsAt)||Number(value.startsAt)<=0||Number(value.endsAt)<=Number(value.startsAt)||Number(value.endsAt)-Number(value.startsAt)>86400000||value.dataEgress!=='accepted'||!Array.isArray(value.grants)||value.grants.length<1||value.grants.length>16)return null;
  const grants=value.grants.map(grant=>{runtimeObject(grant,['scope','actor']);return {scope:scope(grant.scope),actor:actor(grant.actor)};});
  if(new Set(grants.map(grant=>JSON.stringify(grant))).size!==grants.length)return null;
  return {schema:'project-view-browser-policy/v1',enabled:value.enabled,startsAt:Number(value.startsAt),endsAt:Number(value.endsAt),dataEgress:'accepted',grants};
 }catch{return null;}
}
export function projectViewBrowserWindow(env:ProjectViewBrowserPolicyEnv,now=Date.now()){
 const policy=parseProjectViewBrowserPolicy(env.PROJECT_VIEW_BROWSER_POLICY_JSON);
 let app:URL;try{app=new URL(env.APP_ORIGIN!);}catch{throw Error('project-view-browser-admission-closed');}
 const loopback=['localhost','127.0.0.1','[::1]'].includes(app.hostname);
 if(!policy?.enabled||!Number.isSafeInteger(now)||now<policy.startsAt||now>=policy.endsAt||app.href!==app.origin+'/'||app.username||app.password||!(app.protocol==='https:'||loopback&&app.protocol==='http:'))throw Error('project-view-browser-admission-closed');
 return {policy,appOrigin:app.origin};
}
export function projectViewBrowserAdmission(env:ProjectViewBrowserPolicyEnv,wanted:TurnScope,owner:TurnActor,now=Date.now()){
 const result=projectViewBrowserWindow(env,now);
 if(!result.policy.grants.some(grant=>sameScope(grant.scope,wanted)&&grant.actor.userId===owner.userId&&grant.actor.authVersion===owner.authVersion))throw Error('project-view-browser-admission-closed');
 return result;
}
