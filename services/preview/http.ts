/** Fixed internal HTTP transport. This module grants no access and starts no
 * processes; callers must validate the live session, binding, and lease. */
import {validatedPreviewOrigin} from './browser.ts';
export const SERVICE_HTTP_ORIGIN='http://localhost:8080';
const requestHeaders=['accept','accept-language','content-type','if-match','if-none-match','if-modified-since','if-unmodified-since','range','if-range','last-event-id'];
const responseHeaders=['content-type','content-language','content-disposition','etag','last-modified','accept-ranges','content-range'];
export function previewPath(url:URL):string{
 let path=url.pathname;
 for(let i=0;i<3;i++){
  if(path.includes('\\')||/[\u0000-\u001f\u007f]/.test(path)||path.split('/').some(s=>s==='.'||s==='..')||path==='/__riff'||path.startsWith('/__riff/'))throw Error('preview-path-denied');
  const decoded=decodeURIComponent(path);if(decoded===path)return url.pathname+url.search;path=decoded;
 }
 throw Error('preview-path-denied');
}
export interface ServiceHttpReadGuard {authorize?:()=>Promise<void>;signal?:AbortSignal}
async function body(request:Request,guard:ServiceHttpReadGuard):Promise<Uint8Array<ArrayBuffer>|undefined>{
 if(!request.body)return undefined;
 if(Number(request.headers.get('content-length'))>1048576)throw Error('preview-body-too-large');
 const reader=request.body.getReader(),parts:Uint8Array[]=[];let bytes=0,timer:ReturnType<typeof setTimeout>|undefined;
 let onAbort=()=>{};
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('preview-body-timeout')),5000);onAbort=()=>reject(Error('preview-http-aborted'));guard.signal?.addEventListener('abort',onAbort,{once:true});if(guard.signal?.aborted)onAbort();});
 try{for(let chunks=0;chunks<4096;chunks++){
  await Promise.race([guard.authorize?.(),deadline]);
  const item=await Promise.race([reader.read(),deadline]);
  await Promise.race([guard.authorize?.(),deadline]);
  if(item.done){const value=new Uint8Array(bytes);let offset=0;for(const part of parts){value.set(part,offset);offset+=part.length;}return value;}
  bytes+=item.value.byteLength;if(bytes>1048576)throw Error('preview-body-too-large');parts.push(item.value);
 }throw Error('preview-body-too-large');}finally{clearTimeout(timer);guard.signal?.removeEventListener('abort',onAbort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function serviceHttpRequest(request:Request,guard:ServiceHttpReadGuard={}):Promise<Request>{
 if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(request.method)||request.headers.has('upgrade'))throw Error('preview-http-method-denied');
 const path=previewPath(new URL(request.url)),headers=new Headers();
 for(const key of requestHeaders){const value=request.headers.get(key);if(value!==null)headers.set(key,value);}
 const value=await body(request,guard);
 return new Request(SERVICE_HTTP_ORIGIN+path,{method:request.method,headers,body:value?.buffer,redirect:'manual'});
}
/** A response policy for sandboxed project HTML and subresources, not redirects
 * to arbitrary domains. Cookies, CORS and platform policy headers are replaced. */
export function serviceHttpResponse(response:Response,publicRequestUrl:string,controlOrigin:string):Response{
 const publicUrl=new URL(publicRequestUrl),publicOrigin=validatedPreviewOrigin(publicUrl.origin);validatedPreviewOrigin(controlOrigin);
 if(publicOrigin===controlOrigin)throw Error('preview-origin-denied');
 const headers=new Headers();for(const key of responseHeaders){const value=response.headers.get(key);if(value!==null)headers.set(key,value);}
 const location=response.headers.get('location');
 if(location){const url=new URL(location,new URL(publicUrl.pathname+publicUrl.search,SERVICE_HTTP_ORIGIN));if(![SERVICE_HTTP_ORIGIN,publicOrigin].includes(url.origin)||url.username||url.password)throw Error('preview-redirect-denied');headers.set('location',publicOrigin+previewPath(url)+url.hash);}
 headers.set('cache-control','no-store');headers.set('referrer-policy','no-referrer');headers.set('x-content-type-options','nosniff');headers.set('origin-agent-cluster','?1');
 headers.set('content-security-policy',`default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors ${controlOrigin}; base-uri 'none'; form-action 'self'; sandbox allow-scripts allow-same-origin allow-forms`);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
