import {actor,scope,sameScope,type TurnActor,type TurnScope} from '../turn/protocol.ts';
import {runtimeObject} from './runtime-protocol.ts';

/** Explicit, bounded first-release grants. Pi/Runs admission is not browser admission. */
export type ProjectViewPolicy={schema:'project-view-policy/v1';enabled:boolean;startsAt:number;endsAt:number;image:string;contextReceiptSha256:string;grants:Array<{scope:TurnScope;actor:TurnActor}>};
export interface ProjectViewPolicyEnv{APP_ORIGIN?:string;PROJECT_VIEW_POLICY_JSON?:string;PROJECT_VIEW_RUNTIME_POLICY_HASH?:string;PROJECT_VIEW_RUNTIME_IMAGE?:string;PROJECT_VIEW_RUNTIME_CONTEXT_RECEIPT_SHA256?:string;}
export function parseProjectViewPolicy(raw:unknown):ProjectViewPolicy|null{
 try{
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>16384)return null;
  const value:unknown=JSON.parse(raw);runtimeObject(value,['schema','enabled','startsAt','endsAt','image','contextReceiptSha256','grants']);
  if(value.schema!=='project-view-policy/v1'||typeof value.enabled!=='boolean'||!Number.isSafeInteger(value.startsAt)||!Number.isSafeInteger(value.endsAt)||Number(value.startsAt)<=0||Number(value.endsAt)<=Number(value.startsAt)||Number(value.endsAt)-Number(value.startsAt)>86400000||typeof value.image!=='string'||! /^(?:[a-z0-9][a-z0-9./:_-]{0,220}@)?sha256:[a-f0-9]{64}$/.test(value.image)||typeof value.contextReceiptSha256!=='string'||! /^[a-f0-9]{64}$/.test(value.contextReceiptSha256)||!Array.isArray(value.grants)||value.grants.length<1||value.grants.length>16)return null;
  const grants=value.grants.map(grant=>{runtimeObject(grant,['scope','actor']);return {scope:scope(grant.scope),actor:actor(grant.actor)};});
  if(new Set(grants.map(grant=>JSON.stringify(grant))).size!==grants.length)return null;
  return {schema:'project-view-policy/v1',enabled:value.enabled,startsAt:Number(value.startsAt),endsAt:Number(value.endsAt),image:value.image,contextReceiptSha256:value.contextReceiptSha256,grants};
 }catch{return null;}
}
export async function projectViewPolicyHash(raw:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function projectViewAdmission(env:ProjectViewPolicyEnv,wanted:TurnScope,owner:TurnActor,now=Date.now()){
 const policy=parseProjectViewPolicy(env.PROJECT_VIEW_POLICY_JSON);
 let app:URL;try{app=new URL(env.APP_ORIGIN!);}catch{throw Error('project-view-admission-closed');}
 if(!policy?.enabled||!Number.isSafeInteger(now)||now<policy.startsAt||now>=policy.endsAt||app.protocol!=='https:'||app.href!==app.origin+'/'||app.username||app.password||env.PROJECT_VIEW_RUNTIME_IMAGE!==policy.image||env.PROJECT_VIEW_RUNTIME_CONTEXT_RECEIPT_SHA256!==policy.contextReceiptSha256||!policy.grants.some(grant=>sameScope(grant.scope,wanted)&&grant.actor.userId===owner.userId&&grant.actor.authVersion===owner.authVersion))throw Error('project-view-admission-closed');
 const policyHash=await projectViewPolicyHash(env.PROJECT_VIEW_POLICY_JSON!);
 if(env.PROJECT_VIEW_RUNTIME_POLICY_HASH!==policyHash)throw Error('project-view-admission-closed');
 return {policy,policyHash,appOrigin:app.origin};
}
