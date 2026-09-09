/** Non-hibernating bridge: a lost host loses its connections. No connection
 * resumes with cached permission. Already delivered frames cannot be recalled. */
export interface PreviewSocket extends EventTarget {
 binaryType:string;readonly readyState:number;
 accept():void;send(data:string|ArrayBuffer):void;close(code?:number,reason?:string):void;
}
export interface PreviewSocketGuard {
 authorize():Promise<{expiresAt:number}>;
 deadlineAt:number;
 signal?:AbortSignal;
 onClose?():void;
}
export async function bridgePreviewSockets(left:PreviewSocket,right:PreviewSocket,guard:PreviewSocketGuard,clock=Date.now){
 let deadline=guard.deadlineAt,done=false,queuedBytes=0,totalBytes=0,pumping=false;
 const queue:{target:PreviewSocket;data:string|ArrayBuffer;bytes:number}[]=[];
 let poll:ReturnType<typeof setTimeout>|undefined,expiry:ReturnType<typeof setTimeout>|undefined;
 let resolveClosed!:()=>void;const closed=new Promise<void>(resolve=>{resolveClosed=resolve;});
 const listeners:{socket:PreviewSocket;type:string;listener:EventListener}[]=[];
 const abort=()=>close(1008);
 function close(code=1000){if(done)return;done=true;clearTimeout(poll);clearTimeout(expiry);guard.signal?.removeEventListener('abort',abort);queue.length=0;queuedBytes=0;
  for(const {socket,type,listener} of listeners)socket.removeEventListener(type,listener);
  for(const socket of [left,right])try{socket.close(code,'preview closed');}catch{}
  try{guard.onClose?.();}finally{resolveClosed();}
 }
 async function authorize(){
  if(done||guard.signal?.aborted||!Number.isSafeInteger(deadline)||deadline<=clock())throw Error('preview-ws-denied');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const grant=await Promise.race([guard.authorize(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('preview-ws-auth-timeout')),1000);})]);
   if(done||guard.signal?.aborted||!Number.isSafeInteger(grant?.expiresAt)||grant.expiresAt<=clock()||deadline<=clock())throw Error('preview-ws-denied');
   deadline=Math.min(deadline,grant.expiresAt);clearTimeout(expiry);expiry=setTimeout(()=>close(1008),Math.max(1,deadline-clock()));
  }finally{clearTimeout(timer);}
 }
 async function pump(){if(pumping||done)return;pumping=true;try{
  while(queue.length&&!done){const item=queue.shift()!;queuedBytes-=item.bytes;await authorize();if(done||item.target.readyState!==1)throw Error('preview-ws-closed');item.target.send(item.data);}
 }catch{close(1008);}finally{pumping=false;}}
 function message(target:PreviewSocket,event:Event){if(done)return;const data=(event as MessageEvent).data;
  if(typeof data!=='string'&&!(data instanceof ArrayBuffer)){close(1003);return;}
  const bytes=typeof data==='string'?new TextEncoder().encode(data).byteLength:data.byteLength;
  if(bytes>65536){close(1009);return;}
  totalBytes+=bytes;if(queue.length>=32||queuedBytes+bytes>1048576||totalBytes>16777216){close(1013);return;}
  queue.push({target,data:typeof data==='string'?data:data.slice(0),bytes});queuedBytes+=bytes;void pump();
 }
 function listen(socket:PreviewSocket,type:string,listener:EventListener){listeners.push({socket,type,listener});socket.addEventListener(type,listener);}
 async function check(){try{await authorize();if(!done)poll=setTimeout(()=>{void check();},1000);}catch{close(1008);}}
 guard.signal?.addEventListener('abort',abort,{once:true});
 try{
  await authorize();
  listen(left,'message',event=>message(right,event));listen(right,'message',event=>message(left,event));
  for(const socket of [left,right]){listen(socket,'close',()=>close());listen(socket,'error',()=>close(1011));socket.binaryType='arraybuffer';socket.accept();}
  poll=setTimeout(()=>{void check();},1000);
  if(guard.signal?.aborted)throw Error('preview-ws-denied');
  return {close,closed};
 }catch(error){close(1008);throw error;}
}
