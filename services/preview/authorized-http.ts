import {validatedPreviewOrigin} from './browser.ts';
import {serviceHttpRequest,serviceHttpResponse} from './http.ts';
export interface AuthorizedPreviewHttpPorts{
 authorize():Promise<{expiresAt:number}>;
 forward(request:Request):Promise<Response>;
}
function release(response:Response|undefined){(response as (Response&{[Symbol.dispose]?:()=>void})|undefined)?.[Symbol.dispose]?.();}
function discard(response:Response){void response.body?.cancel().catch(()=>{});release(response);}
/** Finite HTTP only. Every newly forwarded chunk follows fresh authorization;
 * already delivered bytes cannot be recalled. No automatic request retries. */
export async function authorizedPreviewHttp(request:Request,controlOrigin:string,ports:AuthorizedPreviewHttpPorts,clock=Date.now):Promise<Response>{
 const url=new URL(request.url),origin=request.headers.get('origin'),fetchSite=request.headers.get('sec-fetch-site'),readOnly=['GET','HEAD'].includes(request.method);validatedPreviewOrigin(url.origin);validatedPreviewOrigin(controlOrigin);if(url.origin===controlOrigin)throw Error('preview-http-origin-denied');
 if(request.headers.has('upgrade')||!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(request.method))throw Error('preview-http-method-denied');
 // CSP sandbox gives project documents an opaque origin, so Safari sends
 // `Origin: null` for their same-site form submissions. Sec-Fetch-Site is a
 // browser-controlled signal; combine it with the already-validated private
 // host-only access cookie instead of granting opaque origins generally.
 const sandboxedSameOrigin=!readOnly&&origin==='null'&&fetchSite==='same-origin';
 if(fetchSite==='cross-site'||(origin!==null&&origin!==url.origin&&!sandboxedSameOrigin)||(!readOnly&&origin!==url.origin&&!sandboxedSameOrigin))throw Error('preview-http-origin-denied');
 const controller=new AbortController(),abort=()=>controller.abort();
 const aborted=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('preview-http-aborted')),{once:true}));
 let deadline=clock()+15000,timer=setTimeout(abort,15000);request.signal.addEventListener('abort',abort,{once:true});
 let upstream:Response|undefined,finished=false;
 const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);request.signal.removeEventListener('abort',abort);release(upstream);};
 const authorize=async()=>{
  if(controller.signal.aborted)throw Error('preview-http-aborted');
  const current=await Promise.race([ports.authorize(),aborted]);
  if(!Number.isSafeInteger(current.expiresAt)||current.expiresAt<=clock()||controller.signal.aborted)throw Error('preview-http-access-denied');
  deadline=Math.min(deadline,current.expiresAt);clearTimeout(timer);timer=setTimeout(abort,Math.max(1,deadline-clock()));
 };
 if(request.signal.aborted)abort();
 try{
  await authorize();const clean=await Promise.race([serviceHttpRequest(request,{authorize,signal:controller.signal}),aborted]);await authorize();
  const pending=ports.forward(clean).then(response=>{if(controller.signal.aborted){discard(response);throw Error('preview-http-aborted');}return response;});
  upstream=await Promise.race([pending,aborted]);await authorize();
  const safe=serviceHttpResponse(upstream,request.url,controlOrigin);
  if(!safe.body){finish();return safe;}
  const reader=safe.body.getReader();let bytes=0;
  const stream=new ReadableStream<Uint8Array>({async pull(out){try{
   await authorize();const item=await Promise.race([reader.read(),aborted]);await authorize();
   if(item.done){finish();out.close();return;}
   bytes+=item.value.byteLength;if(bytes>8388608)throw Error('preview-http-response-too-large');out.enqueue(item.value);
  }catch(error){abort();void reader.cancel().catch(()=>{});finish();out.error(error);}},cancel(){abort();finish();return reader.cancel();}},{highWaterMark:0});
  // Closing an idle response still releases its private RPC resources.
  controller.signal.addEventListener('abort',()=>{void reader.cancel().catch(()=>{});finish();},{once:true});
  return new Response(stream,{status:safe.status,statusText:safe.statusText,headers:safe.headers});
 }catch(error){abort();if(upstream)void upstream.body?.cancel().catch(()=>{});finish();throw error;}
}
