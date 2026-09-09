import {serviceHttpRequest} from '../preview/http.ts';
export type RunningServiceContainer={readonly running:boolean;getTcpPort(port:number):{fetch(request:Request):Promise<Response>}};
/** The platform port fetch does not call Sandbox start/containerFetch. No await
 * is allowed between the running check and sending to the fixed TCP port. */
export async function forwardRunningService(container:RunningServiceContainer|undefined,request:Request,deadlineAt=Date.now()+15000):Promise<Response>{
 const clean=await serviceHttpRequest(request);
 if(!container?.running)throw Error('service-container-not-running');
 if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=Date.now()||deadlineAt>Date.now()+15000)throw Error('service-forward-deadline-denied');
 const controller=new AbortController();
 const aborted=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('service-forward-expired')),{once:true}));
 const timer=setTimeout(()=>controller.abort(),Math.max(1,deadlineAt-Date.now()));
 try{
  const pending=container.getTcpPort(8080).fetch(new Request(clean,{signal:controller.signal})).then(response=>{
   if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw Error('service-forward-expired');}return response;
  });
  const response=await Promise.race([pending,aborted]);
  if(!response.body){clearTimeout(timer);return response;}
  const reader=response.body.getReader();
  return new Response(new ReadableStream({async pull(out){try{
   if(controller.signal.aborted)throw Error('service-forward-expired');
   const item=await Promise.race([reader.read(),aborted]);
   if(controller.signal.aborted)throw Error('service-forward-expired');
   if(item.done){clearTimeout(timer);out.close();}else out.enqueue(item.value);
  }catch(error){clearTimeout(timer);controller.abort();void reader.cancel().catch(()=>{});out.error(error);}},cancel(){clearTimeout(timer);controller.abort();return reader.cancel();}}),{status:response.status,statusText:response.statusText,headers:response.headers});
 }catch(error){clearTimeout(timer);controller.abort();throw error;}
}
