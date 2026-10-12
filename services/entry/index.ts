import {HttpError,json,requireOrigin} from '../gateway/http.ts';
import {publicHttpsOrigin,requireRequestHost} from '../gateway/origins.ts';
import {g5ReadHeaders} from '../gateway/transport-headers.ts';
import {signEntry,signedRequestCapacity,pathQuery,type SigningEnv} from './signature.ts';
import {requestAbortBridge,abortableResponse} from './abort.ts';

export interface EntryEnv extends SigningEnv {APP_ORIGIN:string;APP_TRANSPORT_ORIGIN:string;TWO_ACCOUNT_AUTH_MODE?:string;}
type Send=(request:Request)=>Promise<Response>;
const requestHeaders=['accept','accept-language','content-type','cookie','origin','referer','sec-fetch-site','sec-fetch-mode','sec-fetch-dest','idempotency-key','last-event-id','range','if-none-match','if-modified-since','user-agent',...g5ReadHeaders];
function checkedLocation(location:string,request:Request,canonical:string):void {
  if(/[\\\u0000-\u0020\u007f]/u.test(location)||/^\/\//.test(location)||/%(?:00|0a|0d|5c)/i.test(location))throw Error('unsafe-upstream-location');
  if(!location.startsWith('/')&&!location.startsWith('https://'))throw Error('unsafe-upstream-location');
  const target=new URL(location,canonical);
  if(target.username||target.password)throw Error('unsafe-upstream-location');
  if(target.origin===canonical)return;
  // Only an actual sign-in response may point at Google's fixed authorization
  // endpoint, with the already configured canonical callback. Never follow it.
  if(new URL(request.url).pathname==='/api/auth/sign-in/social'&&request.method==='POST'&&
    target.origin==='https://accounts.google.com'&&target.pathname==='/o/oauth2/v2/auth'&&
    target.searchParams.getAll('redirect_uri').length===1&&target.searchParams.get('redirect_uri')===canonical+'/api/auth/callback/google')return;
  throw Error('unsafe-upstream-location');
}
export function entryResponse(response:Response,request:Request,canonical:string):Response {
  if(response.status===101)throw Error('upstream-upgrade-denied');
  const headers=new Headers(response.headers);
  for(const cookie of response.headers.getSetCookie()){
    if(/;\s*domain\s*=/i.test(cookie)||!/^__Secure-riffology\.[A-Za-z0-9_-]+=/.test(cookie)||
      !/;\s*Secure(?:;|$)/i.test(cookie)||!/;\s*HttpOnly(?:;|$)/i.test(cookie)||
      !/;\s*SameSite=Lax(?:;|$)/i.test(cookie)||!/;\s*Path=\/(?:;|$)/i.test(cookie))throw Error('unsafe-upstream-cookie');
  }
  const location=headers.get('location');if(location!==null)checkedLocation(location,request,canonical);
  headers.delete('access-control-allow-origin');headers.delete('access-control-allow-credentials');
  headers.set('cache-control',headers.get('content-type')?.startsWith('text/event-stream')?'no-store, no-transform':'no-store');
  // The same stream carries cancellation; no reads, buffering, retry or waitUntil.
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
/** Public transport is not an identity credential. Backend authorization stays
 * mandatory even when a caller accesses the transport hostname directly. */
export async function entry(request:Request,env:EntryEnv,send:Send=fetch):Promise<Response> {
  let releaseCapacity=()=>{};
  let bridge:ReturnType<typeof requestAbortBridge>|undefined;
  try{
    const canonical=publicHttpsOrigin(env.APP_ORIGIN),transport=publicHttpsOrigin(env.APP_TRANSPORT_ORIGIN);
    if(canonical.origin===transport.origin)throw Error('entry-loop');
    requireRequestHost(request);
    const url=new URL(request.url);
    if(url.origin!==canonical.origin)throw new HttpError('origin_denied',403);
    if(request.headers.has('upgrade'))throw new HttpError('upgrade_denied',403);
    if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(request.method))throw new HttpError('method_not_allowed',405);
    if(!['GET','HEAD'].includes(request.method))requireOrigin(request,canonical.origin);
    const mode=env.TWO_ACCOUNT_AUTH_MODE??'disabled';
    if(mode==='disabled')return json({error:'two_account_auth_disabled'},503);
    if(mode!=='signed-entry-v1'&&mode!=='shared-limited')return json({error:'entry_signing_not_configured'},503);
    if(mode==='signed-entry-v1'){
      bridge=requestAbortBridge(request.signal);
      request=new Request(request,{signal:bridge.signal});
    }
    // Preserve the platform's original serialized path/query, including a bare
    // trailing "?" that URL.search omits. Concatenation cannot change the host.
    const target=transport.origin+pathQuery(request);
    const headers=new Headers();
    for(const name of requestHeaders){const value=request.headers.get(name);if(value!==null)headers.set(name,value);}
    headers.set('cache-control','no-store');
    const init:RequestInit&{duplex:'half'}={method:request.method,headers,redirect:'manual',cache:'no-store',signal:request.signal,duplex:'half'};
    // Signing reads the ORIGINAL request body once. The target placeholder has
    // no body, preventing tee/clone buffering. Unsigned mode is a legacy fixture
    // mode, remains prohibited for deployment, and retains the prior stream.
    if(mode==='shared-limited'&&!['GET','HEAD'].includes(request.method))init.body=request.body;
    let upstream=new Request(target,init);
    if(mode==='signed-entry-v1'){releaseCapacity=signedRequestCapacity(request);upstream=await signEntry(upstream,request,canonical.origin,env);}
    const response=await send(upstream);
    try{const result=entryResponse(response,request,canonical.origin);if(!bridge)return result;const streaming=abortableResponse(result,bridge);bridge=undefined;return streaming;}catch{
      if(response.body)void response.body.cancel().catch(()=>{});
      return json({error:'upstream_response_denied'},502);
    }
  }catch(error){
    if(error instanceof HttpError)return json({error:error.message},error.status);
    return json({error:'entry_unavailable'},502);
  }finally{releaseCapacity();bridge?.dispose();}
}
export default {fetch(request:Request,env:EntryEnv){return entry(request,env);}} satisfies ExportedHandler<EntryEnv>;
