import {observerHttpPolicy,observerHttpRequest,observerHttpResponse,type ObserverHttpPolicy} from './observer-http.ts';
import {OBSERVER_LIMITS} from './observer-protocol.ts';

export interface ObserverFetchPorts{
 /** Must revalidate the current command, plugin, Workspace and Preview target. */
 authorize():Promise<{expiresAt:number}>;
 /** A private Observer transport, not ordinary browser HTTP forwarding. */
 forward(request:Request,signal:AbortSignal):Promise<Response>;
}
function dispose(response:Response){
 void response.body?.cancel().catch(()=>{});
 (response as Response&{[Symbol.dispose]?:()=>void})[Symbol.dispose]?.();
}
/** One observation's network budget. No credentials are minted here. The
 * owner must close this session after producing a receipt, including on error.
 * Returned bytes are bounded and authorized; they remain untrusted app data. */
export function createObserverFetchSession(rawPolicy:ObserverHttpPolicy,ports:ObserverFetchPorts,options:{deadlineAt:number;signal?:AbortSignal},clock=Date.now){
 const policy=observerHttpPolicy(rawPolicy),now=clock();
 if(!Number.isSafeInteger(options.deadlineAt)||options.deadlineAt<=now||options.deadlineAt>now+OBSERVER_LIMITS.timeoutMs)throw Error('observer-deadline-denied');
 const controller=new AbortController();let deadline=options.deadlineAt,requests=0,bytes=0,chunks=0,reason='observer-cancelled';
 let rejectClosed!:(error:Error)=>void;
 const closed=new Promise<never>((_,reject)=>{rejectClosed=reject;});void closed.catch(()=>{});
 const parentAbort=()=>close();
 let timer:ReturnType<typeof setTimeout>|undefined;
 function close(code='observer-cancelled'){
  if(controller.signal.aborted)return;reason=code;controller.abort();clearTimeout(timer);options.signal?.removeEventListener('abort',parentAbort);rejectClosed(Error(reason));
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(()=>close('observer-timeout'),Math.max(1,deadline-clock()));}
 function live(){if(controller.signal.aborted)throw Error(reason);if(deadline<=clock()){close('observer-timeout');throw Error(reason);}}
 async function authorize(){
  live();const grant=await Promise.race([ports.authorize(),closed]);live();
  if(!Number.isSafeInteger(grant?.expiresAt)||grant.expiresAt<=clock())throw Error('observer-access-denied');
  deadline=Math.min(deadline,grant.expiresAt);schedule();
 }
 schedule();options.signal?.addEventListener('abort',parentAbort,{once:true});if(options.signal?.aborted)close();
 return Object.freeze({close,async fetch(request:Pick<Request,'url'|'method'|'headers'|'body'>):Promise<Response>{
  let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   live();const clean=observerHttpRequest(request,policy);
   if(++requests>OBSERVER_LIMITS.resourceRequests)throw Error('observer-resource-limit');
   await authorize();
   const pending=ports.forward(clean,controller.signal).then(value=>{if(controller.signal.aborted){dispose(value);throw Error(reason);}return value;});
   response=await Promise.race([pending,closed]);await authorize();
   const safe=observerHttpResponse(response,policy),parts:Uint8Array[]=[];let size=0;
   const resourceLimit=new URL(clean.url).pathname===policy.statePath?OBSERVER_LIMITS.stateBytes:OBSERVER_LIMITS.resourceResponseBytes;
   if(safe.body){
    reader=safe.body.getReader();
    for(;;){
     await authorize();const part=await Promise.race([reader.read(),closed]);await authorize();
     if(part.done)break;
     bytes+=part.value.byteLength;chunks++;if(bytes>OBSERVER_LIMITS.resourceResponseBytes||size+part.value.byteLength>resourceLimit||chunks>OBSERVER_LIMITS.resourceChunks)throw Error('observer-resource-limit');
     parts.push(part.value.slice());size+=part.value.byteLength;
    }
   }
   await authorize();const body=new Uint8Array(size);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.byteLength;}
   return new Response(safe.body?body:null,{status:safe.status,statusText:safe.statusText,headers:safe.headers});
  }catch(error){
   const code=error instanceof Error&&/^observer-[a-z-]+$/.test(error.message)?error.message:'observer-http-failed';close(code);throw Error(reason);
  }finally{
   if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}
   if(response)dispose(response);
  }
 }});
}
