import {bridgePreviewSockets} from './websocket-bridge.ts';
import {selectedWebSocketProtocol} from './websocket-protocol.ts';
export interface PreviewWebSocketPorts {
 authorize():Promise<{expiresAt:number}>;
 connect(request:Request):Promise<Response>;
 signal?:AbortSignal;
 finish():void;
}
/** Includes authority and routing reads before the downstream upgrade starts. */
export async function boundedWebSocketHandshake(controller:AbortController,operation:()=>Promise<Response>):Promise<Response>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('preview-ws-handshake-timeout'));},10000);})]);}
 catch(error){controller.abort();throw error;}finally{clearTimeout(timer);}
}
/** A private fetch handshake followed by a locally owned, revocable bridge.
 * Never retries a connection or passes through project response headers. */
export async function connectPreviewWebSocket(request:Request,ports:PreviewWebSocketPorts):Promise<Response>{
 const controller=new AbortController(),abort=()=>controller.abort();ports.signal?.addEventListener('abort',abort,{once:true});
 let finished=false,timer:ReturnType<typeof setTimeout>|undefined,upstream:WebSocket|undefined;
 const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);ports.signal?.removeEventListener('abort',abort);ports.finish();};
 const aborted=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('preview-ws-aborted')),{once:true}));
 timer=setTimeout(abort,10000);if(ports.signal?.aborted)abort();
 function dispose(response:Response){if(response.webSocket){try{response.webSocket.accept();response.webSocket.close(1008,'preview closed');}catch{}}else void response.body?.cancel().catch(()=>{});}
 try{
  const grant=await Promise.race([ports.authorize(),aborted]);
  if(!Number.isSafeInteger(grant?.expiresAt)||grant.expiresAt<=Date.now()||controller.signal.aborted)throw Error('preview-ws-denied');
  const pending=ports.connect(request).then(response=>{if(controller.signal.aborted){dispose(response);throw Error('preview-ws-aborted');}return response;});
  const response=await Promise.race([pending,aborted]);
  if(response.status!==101||!response.webSocket){dispose(response);throw Error('preview-ws-upstream-denied');}
  upstream=response.webSocket;
  const protocol=selectedWebSocketProtocol(request,response),pair=new WebSocketPair();
  await bridgePreviewSockets(pair[1],upstream,{authorize:ports.authorize,deadlineAt:grant.expiresAt,signal:controller.signal,onClose:finish});
  if(controller.signal.aborted)throw Error('preview-ws-aborted');
  clearTimeout(timer);
  const headers=new Headers();if(protocol)headers.set('sec-websocket-protocol',protocol);
  return new Response(null,{status:101,webSocket:pair[0],headers});
 }catch(error){controller.abort();if(upstream)try{upstream.accept();upstream.close(1008,'preview closed');}catch{try{upstream.close(1008,'preview closed');}catch{}}finish();throw error;}
}
