import {serviceWebSocketRequest} from '../preview/websocket-protocol.ts';
import type {RunningServiceContainer} from './http-forward.ts';
/** Upgrade on an already running fixed port. No automatic process/container start. */
export async function forwardRunningWebSocket(container:RunningServiceContainer|undefined,request:Request,deadlineAt:number):Promise<Response>{
 const clean=serviceWebSocketRequest(request);
 if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=Date.now()||deadlineAt>Date.now()+900000)throw Error('service-ws-deadline-denied');
 if(!container?.running)throw Error('service-container-not-running');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('service-ws-timeout'));},Math.max(1,Math.min(10000,deadlineAt-Date.now())));});
 try{
  const pending=container.getTcpPort(8080).fetch(new Request(clean,{signal:controller.signal})).then(response=>{
   if(controller.signal.aborted){try{response.webSocket?.accept();response.webSocket?.close(1008,'preview closed');}catch{}void response.body?.cancel().catch(()=>{});throw Error('service-ws-timeout');}
   return response;
  });
  return await Promise.race([pending,timeout]);
 }finally{clearTimeout(timer);}
}
