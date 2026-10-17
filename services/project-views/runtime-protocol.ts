import {actor,scope,turnId,type TurnActor,type TurnScope} from '../turn/protocol.ts';
import {parseProjectViews,type ProjectView,type ProjectViewPackage} from './package.ts';

export const PROJECT_VIEW_SESSION_MS=300_000;
export const PROJECT_VIEW_IDLE_MS=10_000;
export const PROJECT_VIEW_CAPACITY_NAME='project-view-capacity-v1';
export type ProjectViewRuntimeIdentity={schema:'project.view-session/v1';sessionId:string;operationId:string;scope:TurnScope;actor:TurnActor;packageIdentity:string;viewId:string;policyHash:string};
export type ProjectViewRuntimeStart={identity:ProjectViewRuntimeIdentity;pkg:ProjectViewPackage;view:ProjectView;expiresAt:number};
export type ProjectViewInput={kind:'click';x:number;y:number}|{kind:'key';key:string}|{kind:'text';text:string}|{kind:'wheel';deltaY:number};
export type ProjectViewRuntimeCommand={type:'poll'}|{type:'input';event:ProjectViewInput}|{type:'broker';message:unknown};
export type ProjectViewFrame={base64:string;width:800;height:600};
export type ProjectViewRuntimeStatus={id:string;status:'starting'|'running'|'stopping'|'closed'|'unknown';cleanupConfirmed:boolean;cleanupProofId:string|null};
export type ProjectViewRuntimeClosed={closed:true;cleanupConfirmed:boolean};
export type ProjectViewRuntimeReply=ProjectViewRuntimeClosed|{messages:unknown[];frame?:ProjectViewFrame};
export interface ProjectViewRuntimePort{
 start(input:ProjectViewRuntimeStart):Promise<ProjectViewRuntimeStatus>;
 command(input:{identity:ProjectViewRuntimeIdentity;command:ProjectViewRuntimeCommand}):Promise<ProjectViewRuntimeReply>;
 close(input:{identity:ProjectViewRuntimeIdentity;reason:string}):Promise<ProjectViewRuntimeClosed>;
 status(input:{identity:ProjectViewRuntimeIdentity}):Promise<ProjectViewRuntimeStatus>;
 lookup(input:{sessionId:string;actor:TurnActor;workspaceId:string}):Promise<ProjectViewRuntimeIdentity|null>;
}
export interface ProjectViewCapacityPort{
 acquire(input:{identity:ProjectViewRuntimeIdentity;expiresAt:number}):Promise<void>;
 release(input:{identity:ProjectViewRuntimeIdentity;proof:{cleanupConfirmed:true;proofId:string}}):Promise<void>;
}
const encoder=new TextEncoder();
function fail():never{throw Error('project-view-runtime-input-denied');}
export function runtimeObject(value:unknown,keys:string[]):asserts value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)fail();
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(keys.some(key=>!descriptors[key]?.enumerable||!Object.hasOwn(descriptors[key]!,'value')))fail();
}
export function projectViewRuntimeIdentity(value:unknown):ProjectViewRuntimeIdentity{
 runtimeObject(value,['schema','sessionId','operationId','scope','actor','packageIdentity','viewId','policyHash']);
 if(value.schema!=='project.view-session/v1'||typeof value.packageIdentity!=='string'||!/^[a-f0-9]{64}$/.test(value.packageIdentity)||typeof value.policyHash!=='string'||!/^[a-f0-9]{64}$/.test(value.policyHash)||typeof value.viewId!=='string'||!/^[a-z][a-z0-9-]{0,47}$/.test(value.viewId))fail();
 return {schema:'project.view-session/v1',sessionId:turnId(value.sessionId),operationId:turnId(value.operationId),scope:scope(value.scope),actor:actor(value.actor),packageIdentity:value.packageIdentity,viewId:value.viewId,policyHash:value.policyHash};
}
export const projectViewSessionIdentity=projectViewRuntimeIdentity;
export function sameProjectViewRuntimeIdentity(a:ProjectViewRuntimeIdentity,b:ProjectViewRuntimeIdentity){return JSON.stringify(projectViewRuntimeIdentity(a))===JSON.stringify(projectViewRuntimeIdentity(b));}
export function runtimeActorName(sessionId:string){return 'project-view-'+turnId(sessionId);}
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export async function projectViewRuntimeDigest(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function projectViewRuntimeStart(value:unknown):Promise<ProjectViewRuntimeStart>{
 runtimeObject(value,['identity','pkg','view','expiresAt']);
 const identity=projectViewRuntimeIdentity(value.identity),pkg=value.pkg;
 runtimeObject(pkg,['schema','scope','revisionId','filesSha256','manifest','assets','packageIdentity']);
 if(pkg.schema!=='project.view-package/v1'||JSON.stringify(scope(pkg.scope))!==JSON.stringify(identity.scope)||pkg.packageIdentity!==identity.packageIdentity||!digest(pkg.filesSha256)||!(pkg.revisionId===null||typeof pkg.revisionId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(pkg.revisionId)))fail();
 const manifest=parseProjectViews(pkg.manifest);
 if(!Array.isArray(pkg.assets)||pkg.assets.length!==manifest.files.length)fail();
 const {packageIdentity,...body}=pkg;
 if(encoder.encode(JSON.stringify(body)).byteLength>3*1024*1024||await projectViewRuntimeDigest(body)!==packageIdentity)fail();
 const paths=new Set<string>();let size=0;
 for(const asset of pkg.assets){
  runtimeObject(asset,['path','mediaType','base64','sourceSha256','sha256']);
  if(typeof asset.path!=='string'||paths.has(asset.path)||!manifest.files.includes(asset.path)||typeof asset.mediaType!=='string'||asset.mediaType.length>80||typeof asset.base64!=='string'||asset.base64.length>349528||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.base64)||!digest(asset.sha256)||!digest(asset.sourceSha256))fail();
  paths.add(asset.path);const bytes=Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0));size+=bytes.byteLength;
  if(bytes.byteLength>256*1024||size>2*1024*1024||[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')!==asset.sha256)fail();
 }
 const view=value.view;runtimeObject(view,['id','title','entrypoint']);
 if(view.id!==identity.viewId||!manifest.views.some(candidate=>JSON.stringify(candidate)===JSON.stringify(view))||!pkg.assets.some(asset=>asset.path===view.entrypoint&&asset.mediaType==='text/html')||!Number.isSafeInteger(value.expiresAt)||Number(value.expiresAt)<1)fail();
 return {identity,pkg:structuredClone(pkg) as ProjectViewPackage,view:structuredClone(view) as ProjectView,expiresAt:Number(value.expiresAt)};
}
export function projectViewRuntimeCommand(value:unknown):ProjectViewRuntimeCommand{
 if(!value||typeof value!=='object')fail();
 const v=value as Record<string,unknown>;
 if(v.type==='poll'){runtimeObject(v,['type']);return {type:'poll'};}
 if(v.type==='broker'){
  runtimeObject(v,['type','message']);
  if(!v.message||typeof v.message!=='object'||Array.isArray(v.message)||encoder.encode(JSON.stringify(v.message)).byteLength>65536)fail();
  return {type:'broker',message:structuredClone(v.message)};
 }
 runtimeObject(v,['type','event']);if(v.type!=='input'||!v.event||typeof v.event!=='object')fail();
 const event=v.event as Record<string,unknown>;
 if(event.kind==='click'){runtimeObject(event,['kind','x','y']);if(!Number.isInteger(event.x)||!Number.isInteger(event.y)||Number(event.x)<0||Number(event.x)>=800||Number(event.y)<0||Number(event.y)>=600)fail();}
 else if(event.kind==='key'){runtimeObject(event,['kind','key']);if(typeof event.key!=='string'||!['Enter','Escape','Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Backspace','Delete','Home','End','PageUp','PageDown'].includes(event.key))fail();}
 else if(event.kind==='text'){runtimeObject(event,['kind','text']);if(typeof event.text!=='string'||!event.text||encoder.encode(event.text).byteLength>4096||event.text.includes('\0'))fail();}
 else if(event.kind==='wheel'){runtimeObject(event,['kind','deltaY']);if(typeof event.deltaY!=='number'||!Number.isFinite(event.deltaY)||Math.abs(event.deltaY)>10000)fail();}
 else fail();
 return {type:'input',event:structuredClone(event) as ProjectViewInput};
}
