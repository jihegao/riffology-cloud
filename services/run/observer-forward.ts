import type {ObserverCancellationPort} from '../preview/observer-cancellation.ts';
import {observerHttpPolicy,observerHttpRequest,observerHttpResponse,type ObserverHttpPolicy} from '../preview/observer-http.ts';
import {OBSERVER_LIMITS} from '../preview/observer-protocol.ts';
import {SERVICE_HTTP_ORIGIN} from '../preview/http.ts';
import type {RunningServiceContainer} from './http-forward.ts';

/** Private Observer port only. This never invokes the Sandbox SDK or starts a
 * container. Authority is checked separately by the owning Workspace. */
export async function forwardRunningObserver(container:RunningServiceContainer|undefined,request:Request,rawPolicy:ObserverHttpPolicy,deadlineAt:number,cancellation?:ObserverCancellationPort):Promise<Response>{
 const policy=observerHttpPolicy(rawPolicy);
 const selected=[policy.pagePath,policy.statePath].find(path=>request.url===SERVICE_HTTP_ORIGIN+path);
 if(selected===undefined)throw Error('observer-http-denied');
 const clean=observerHttpRequest({url:policy.origin+selected,method:request.method,headers:request.headers,body:request.body},policy);
 const now=Date.now();
 if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=now||deadlineAt-now>OBSERVER_LIMITS.timeoutMs)throw Error('observer-forward-deadline-denied');
 if(!container?.running)throw Error('service-container-not-running');
 const controller=new AbortController();
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 let finished=false;let poll:ReturnType<typeof setTimeout>|undefined;
 const discard=(body:ReadableStream<Uint8Array>|null)=>{try{void body?.cancel().catch(()=>{});}catch{}};
 const cancelReader=()=>{try{void reader?.cancel().catch(()=>{});}catch{}};
 const aborted=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>{cleanup();cancelReader();reject(Error('observer-forward-expired'));},{once:true}));
 // Attach immediately: getTcpPort/fetch and metadata validation may throw before
 // the first race is created; their cleanup must not leave a rejected promise.
 void aborted.catch(()=>{});
 const abort=()=>controller.abort();
 const timer=setTimeout(abort,Math.max(1,deadlineAt-Date.now()));
 const stopped=setInterval(()=>{if(!container.running)abort();},50);
 request.signal.addEventListener('abort',abort,{once:true});
 const cleanup=()=>{if(finished)return;finished=true;clearTimeout(timer);clearInterval(stopped);clearTimeout(poll);request.signal.removeEventListener('abort',abort);};
 const check=()=>{if(request.signal.aborted||controller.signal.aborted||Date.now()>=deadlineAt||!container.running){abort();throw Error('observer-forward-expired');}};
 const checkCancellation=async()=>{if(cancellation&&await Promise.race([cancellation.cancelled(),aborted])!==false)abort();check();};
 const monitor=async()=>{try{await checkCancellation();if(!finished)poll=setTimeout(()=>{void monitor();},100);}catch{abort();}};
 try{
  await checkCancellation();if(cancellation)poll=setTimeout(()=>{void monitor();},100);
  check();
  // Keep the running check adjacent to the native port call, with no await.
  const pending=container.getTcpPort(8080).fetch(new Request(clean,{signal:controller.signal}));
  const guarded=Promise.resolve(pending).then(response=>{try{check();return response;}catch(error){discard(response.body);throw error;}});
  const response=await Promise.race([guarded,aborted]);
  let filtered:Response;
  try{check();filtered=observerHttpResponse(response,policy);}catch(error){discard(response.body);throw error;}
  if(!filtered.body){cleanup();return filtered;}
  if(request.method==='HEAD'){discard(filtered.body);cleanup();return new Response(null,{status:filtered.status,statusText:filtered.statusText,headers:filtered.headers});}
  reader=filtered.body.getReader();
  let bytes=0,chunks=0;
  const maxBytes=selected===policy.statePath?OBSERVER_LIMITS.stateBytes:OBSERVER_LIMITS.resourceResponseBytes;
  const body=new ReadableStream<Uint8Array>({async pull(out){try{
   check();const item=await Promise.race([reader!.read(),aborted]);check();
   if(item.done){cleanup();out.close();return;}
   bytes+=item.value.byteLength;chunks++;
   if(bytes>maxBytes||chunks>OBSERVER_LIMITS.resourceChunks)throw Error('observer-forward-budget-exceeded');
   out.enqueue(item.value);
  }catch(error){cleanup();abort();cancelReader();out.error(error);}},cancel(){cleanup();abort();cancelReader();}});
  return new Response(body,{status:filtered.status,statusText:filtered.statusText,headers:filtered.headers});
 }catch(error){cleanup();abort();cancelReader();throw error;}
}
