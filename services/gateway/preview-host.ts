import type {Database} from '../catalog/database.ts';
import {PreviewRoutes} from '../preview/routes.ts';
import {authorizedPreviewHttp} from '../preview/authorized-http.ts';
import {privateWebSocketRequest,publicWebSocketRequest} from '../preview/websocket-protocol.ts';
import {PREVIEW_ACCESS_COOKIE,previewCookie} from '../preview/browser.ts';
import {previewBrowser} from '../preview/browser.ts';
import {previewHostOrigin,type PreviewGatewayEnv} from './preview-services.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
import {sameScope,scope as checkedScope,type TurnScope} from '../turn/protocol.ts';
import {json} from './http.ts';
export type PreviewHostEnv=Omit<PreviewGatewayEnv,'WORKSPACE_AGENT'>&{M3_PREVIEW_WS_ENABLED?:unknown;M3_VERTICAL_PREVIEW_TELEMETRY?:unknown;WORKSPACE_AGENT:{getByName(name:string):{
 fetch?(request:Request):Promise<Response>;
 authorizePreviewAccess?(input:{scope:TurnScope;previewId:string;access:string}):Promise<{expiresAt:number}>;
 forwardPreviewHttp?(input:{scope:TurnScope;previewId:string;access:string},request:Request):Promise<Response>;
 previewTarget(input:{scope:TurnScope;previewId:string}):Promise<unknown>;
 exchangePreviewTicket(input:{scope:TurnScope;previewId:string;ticket:string;nonce:string}):Promise<{access:string;expiresAt:number}>;
}}};
function trace(env:PreviewHostEnv,event:string,fields:Record<string,unknown>={}){if(env.M3_VERTICAL_PREVIEW_TELEMETRY==='true')console.error('vertical-preview '+JSON.stringify({event,...fields}));}
function requestFacts(request:Request,url:URL){
 const origin=request.headers.get('origin'),cookie=request.headers.get('cookie')??'',accessCookies=cookie.split(';').map(value=>value.trim()).filter(value=>value.startsWith(PREVIEW_ACCESS_COOKIE+'=')).length;
 return {method:request.method,path:url.pathname==='/'?'root':'project-path',origin:origin===null?'missing':origin===url.origin?'same':origin==='null'?'opaque':'other',secFetchSite:request.headers.get('sec-fetch-site')??'missing',accessCookies};
}
/** Only authoritative registry entries reach reserved Preview routes.
 * Project HTTP additionally requires the private access session on every read. */
export async function previewHost(request:Request,env:PreviewHostEnv,database:Database):Promise<Response>{
 if(env.M3_PREVIEW_ENABLED!=='true'||!env.M3_PREVIEW_ORIGIN)return json({error:'origin_denied'},403);
 try{
  const url=new URL(request.url),hostLabel=url.hostname.split('.')[0]!;
  if(!/^p-[a-f0-9]{40}$/.test(hostLabel)||url.origin!==previewHostOrigin(env.M3_PREVIEW_ORIGIN,hostLabel,env.APP_ORIGIN))return json({error:'origin_denied'},403);
  const route=await new PreviewRoutes(database).lookup(hostLabel);if(!route)return json({error:'not_found'},404);
  const worker=env.WORKSPACE_AGENT.getByName(workspaceAgentName(route.scope.tenantId,route.scope.workspaceId));
  if(!url.pathname.startsWith('/__riff/')){
   const facts=requestFacts(request,url);trace(env,'request',facts);
   let access:string;try{access=previewCookie(request,PREVIEW_ACCESS_COOKIE);}catch{trace(env,'denied',{stage:'cookie',...facts});return json({error:'preview_access_denied'},403);}
   if(request.headers.has('upgrade')){
    if(env.M3_PREVIEW_WS_ENABLED!=='true'||!worker.fetch)return json({error:'preview_ws_unavailable'},503);
    const clean=publicWebSocketRequest(request,env.APP_ORIGIN);
    return worker.fetch(privateWebSocketRequest('workspace',{scope:route.scope,previewId:route.previewId,access},clean));
   }
   if(!worker.authorizePreviewAccess||!worker.forwardPreviewHttp)return json({error:'preview_proxy_unavailable'},503);
   const input={scope:route.scope,previewId:route.previewId,access};
   try{const response=await authorizedPreviewHttp(request,env.APP_ORIGIN,{
    authorize:async()=>{const result=await worker.authorizePreviewAccess!(input);try{return {expiresAt:Math.min(result.expiresAt,route.expiresAt)};}finally{(result as {[Symbol.dispose]?:()=>void})?.[Symbol.dispose]?.();}},
    forward:clean=>worker.forwardPreviewHttp!(input,clean),
   });trace(env,'forwarded',{status:response.status,...facts});return response;}catch(error){const code=error instanceof Error?error.message:'',known=['preview-session-denied','preview-access-denied','preview-http-access-denied','preview-http-origin-denied'].includes(code);trace(env,'denied',{stage:known?code:'unavailable',...facts});if(known)return json({error:'preview_access_denied'},403);return json({error:'preview_unavailable'},503);}
  }
  const target=await worker.previewTarget({scope:route.scope,previewId:route.previewId});
  try{
   const binding=(target as {binding?:{previewId:string;scope:TurnScope;expiresAt:number;revokedAt:number|null}})?.binding;
   if(!binding||binding.previewId!==route.previewId||!sameScope(checkedScope(binding.scope),route.scope)||binding.expiresAt!==route.expiresAt||binding.expiresAt<=Date.now()||binding.revokedAt!==null)throw Error('preview-unavailable');
  }finally{(target as {[Symbol.dispose]?:()=>void}|null)?.[Symbol.dispose]?.();}
  const response=await previewBrowser(request,{controlOrigin:env.APP_ORIGIN,previewOrigin:url.origin},{
   exchange:async(ticket,nonce)=>{
    const result=await worker.exchangePreviewTicket({scope:route.scope,previewId:route.previewId,ticket,nonce});
    try{return {access:result.access,expiresAt:result.expiresAt};}finally{(result as {[Symbol.dispose]?:()=>void})?.[Symbol.dispose]?.();}
   },
  });
  return response??json({error:'preview_proxy_unavailable'},503);
 }catch{return json({error:'preview_unavailable'},503);}
}
