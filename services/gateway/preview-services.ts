import type {Database} from '../catalog/database.ts';
import type {Principal} from '../catalog/contracts.ts';
import {sameScope,scope as checkedScope,turnId,type TurnScope} from '../turn/protocol.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
import type {PreviewBrowserPrincipal} from '../preview/session.ts';
import {PreviewRoutes} from '../preview/routes.ts';
import {previewHostOrigin} from '../preview/origin.ts';
export {previewHostOrigin} from '../preview/origin.ts';
import {ProjectCatalog} from '../catalog/projects.ts';

export type PublicPreview={previewId:string;runId:string;bootstrapUrl:string;expiresAt:number};
export type CurrentPreview={previewId:string;runId:string;expiresAt:number;revokedAt:number|null};
export interface GatewayPreviews{
 current(scope:TurnScope,principal:Principal):Promise<{current:CurrentPreview|null;available:PublicPreview|null}>;
 open(scope:TurnScope,principal:Principal,key:string,body:{runId:string;expectedPreviewId:string|null}):Promise<{previewId:string;runId:string;bootstrapUrl:string;expiresAt:number}>;
 ticket(scope:TurnScope,principal:PreviewBrowserPrincipal,previewId:string,nonce:string):Promise<{ticket:string;expiresAt:number}>;
}
export interface PreviewWorkspace{
 currentPreview(input:{scope:TurnScope}):Promise<unknown>;
 bindPreview(input:{scope:TurnScope;actor:Principal;key:string;runId:string;expectedPreviewId:string|null}):Promise<unknown>;
 previewTarget(input:{scope:TurnScope;previewId:string}):Promise<unknown>;
 issuePreviewTicket(input:{scope:TurnScope;principal:PreviewBrowserPrincipal;previewId:string;nonce:string}):Promise<{ticket:string;expiresAt:number}>;
}
export type PreviewGatewayEnv={M3_PREVIEW_ENABLED?:unknown;M3_PREVIEW_ORIGIN?:string;APP_ORIGIN:string;WORKSPACE_AGENT:{getByName(name:string):PreviewWorkspace}};
/** The document CSP must remain valid for the lifetime of an open control page.
 * Execution gates can change while that page is open, so framing authority is
 * derived only from the validated, deployment-owned Preview origin. Preview
 * APIs and host routing still enforce M3_PREVIEW_ENABLED independently. */
export function previewFrameSource(env:Pick<PreviewGatewayEnv,'M3_PREVIEW_ENABLED'|'M3_PREVIEW_ORIGIN'|'APP_ORIGIN'>):string{
 if(!env.M3_PREVIEW_ORIGIN)return "'none'";
 previewHostOrigin(env.M3_PREVIEW_ORIGIN,'p-'+'0'.repeat(40),env.APP_ORIGIN);
 const url=new URL(env.M3_PREVIEW_ORIGIN);return `https://*.${url.host}`;
}
async function rpc<T>(promise:Promise<T>):Promise<T>{const result=await promise;try{return structuredClone(result);}finally{(result as {[Symbol.dispose]?:()=>void}|null)?.[Symbol.dispose]?.();}}
export function createGatewayPreviewServices(env:PreviewGatewayEnv,database:Database):GatewayPreviews{
 const routes=new PreviewRoutes(database);
 const stub=(scope:TurnScope)=>env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));
 const enabled=()=>{if(env.M3_PREVIEW_ENABLED!=='true'||!env.M3_PREVIEW_ORIGIN)throw Error('preview-disabled');previewHostOrigin(env.M3_PREVIEW_ORIGIN,'p-'+'0'.repeat(40),env.APP_ORIGIN);};
 return {
  async current(scope,principal){
   enabled();const worker=stub(scope);
   const authorized=async()=>{const actual=await new ProjectCatalog(database,new Set()).workspace(principal,scope.workspaceId);if(!sameScope(actual,scope))throw Error('preview-unavailable');};
   await authorized();
   const raw=await rpc(worker.currentPreview({scope})) as (CurrentPreview&{scope:TurnScope})|null;
   if(raw===null){await authorized();return {current:null,available:null};}
   if(!raw||!sameScope(checkedScope(raw.scope),scope)||!Number.isSafeInteger(raw.expiresAt)||raw.expiresAt<=0||!(raw.revokedAt===null||Number.isSafeInteger(raw.revokedAt)&&raw.revokedAt>0))throw Error('preview-unavailable');
   const current={previewId:turnId(raw.previewId),runId:turnId(raw.runId),expiresAt:raw.expiresAt,revokedAt:raw.revokedAt};
   let available:PublicPreview|null=null;
   if(current.revokedAt===null&&current.expiresAt>Date.now()){
    const route=await routes.get(current.previewId);
    if(route){
     if(!sameScope(route.scope,scope)||route.expiresAt!==current.expiresAt)throw Error('preview-unavailable');
     try{
      const target=await rpc(worker.previewTarget({scope,previewId:current.previewId})) as {binding:CurrentPreview&{scope:TurnScope}};
      const b=target?.binding;
      if(!b||!sameScope(checkedScope(b.scope),scope)||b.previewId!==current.previewId||b.runId!==current.runId||b.expiresAt!==current.expiresAt||b.revokedAt!==null)throw Error('preview-unavailable');
      if(b.expiresAt>Date.now())available={previewId:b.previewId,runId:b.runId,expiresAt:b.expiresAt,bootstrapUrl:previewHostOrigin(env.M3_PREVIEW_ORIGIN!,route.hostLabel,env.APP_ORIGIN)+'/__riff/bootstrap'};
     }catch(error){if(!(error instanceof Error)||!['preview-target-denied','preview-target-unavailable'].includes(error.message))throw error;}
    }
   }
   await authorized();return {current,available};
  },
  async open(scope,principal,key,body){
   enabled();const worker=stub(scope);
   const candidate=await rpc(worker.bindPreview({scope,actor:principal,key,...body})) as {previewId:string;runId:string;scope:TurnScope};
   if(!candidate||candidate.runId!==body.runId||!sameScope(checkedScope(candidate.scope),scope))throw Error('preview-unavailable');
   const id=turnId(candidate.previewId),target=await rpc(worker.previewTarget({scope,previewId:id})) as {binding:{previewId:string;runId:string;scope:TurnScope;expiresAt:number;revokedAt:number|null}};
   const binding=target?.binding;
   if(!binding||binding.previewId!==id||binding.runId!==body.runId||!sameScope(checkedScope(binding.scope),scope)||binding.revokedAt!==null||!Number.isSafeInteger(binding.expiresAt)||binding.expiresAt<=Date.now())throw Error('preview-unavailable');
   const route=await routes.register(principal,scope,id,binding.expiresAt);
   return {previewId:id,runId:body.runId,bootstrapUrl:previewHostOrigin(env.M3_PREVIEW_ORIGIN!,route.hostLabel,env.APP_ORIGIN)+'/__riff/bootstrap',expiresAt:route.expiresAt};
  },
  async ticket(scope,principal,previewId,nonce){
   enabled();const route=await routes.get(previewId);
   if(!route||!sameScope(route.scope,scope))throw Error('preview-unavailable');
   const result=await rpc(stub(scope).issuePreviewTicket({scope,principal,previewId,nonce}));
   if(!result||! /^[a-f0-9]{64}$/.test(result.ticket)||!Number.isSafeInteger(result.expiresAt)||result.expiresAt<=Date.now()||result.expiresAt>Math.min(Date.now()+30000,principal.expiresAt,route.expiresAt))throw Error('preview-unavailable');
   return {ticket:result.ticket,expiresAt:result.expiresAt};
  },
 };
}
