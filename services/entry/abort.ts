/** Incoming Workerd request signals are cleanup signals and may be ignored by
 * subrequests. Bridge into a standard controller; do not use hidden flags. */
export function requestAbortBridge(source:AbortSignal){
  const controller=new AbortController();
  const abort=()=>controller.abort();
  if(source.aborted)abort();else source.addEventListener('abort',abort,{once:true});
  return {signal:controller.signal,abort,dispose:()=>source.removeEventListener('abort',abort)};
}
type Bridge=ReturnType<typeof requestAbortBridge>;
/** Keep the bridge alive through the response stream, with no eager reads,
 * buffering or retry. Client disconnect cancels the upstream body as well. */
export function abortableResponse(response:Response,bridge:Bridge):Response{
  if(!response.body){bridge.dispose();return response;}
  const reader=response.body.getReader();let done=false;
  let output:ReadableStreamDefaultController<Uint8Array>;
  const finish=()=>{if(done)return;done=true;bridge.signal.removeEventListener('abort',onAbort);bridge.dispose();};
  const onAbort=()=>{if(done)return;finish();output.error(new DOMException('Request aborted','AbortError'));void reader.cancel().catch(()=>{});};
  const body=new ReadableStream<Uint8Array>({
    start(controller){output=controller;bridge.signal.addEventListener('abort',onAbort,{once:true});if(bridge.signal.aborted)onAbort();},
    async pull(controller){try{const value=await reader.read();if(done)return;if(value.done){finish();controller.close();}else controller.enqueue(value.value);}catch(error){if(!done){finish();controller.error(error);}}},
    async cancel(){if(done)return;finish();bridge.abort();await reader.cancel().catch(()=>{});}
  },{highWaterMark:0});
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}
