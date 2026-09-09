import {observerRpcData} from '../preview/observer-rpc-data.ts';
import {executeObserver,type ObserverBrowserPort,type ObserverExecutionServices} from '../preview/observer-execution.ts';
import type {ObserverExecutorCapabilityPort} from '../preview/observer-executor-protocol.ts';
import {validateObserverCommand,type ObserverCommand} from '../preview/observer-protocol.ts';

/** Browser-side RPC adapter. The owning executor must supply an isolated browser,
 * private artifact storage and durable stop fencing. This function alone cannot
 * prove process exit after restart and must not implement stop as true-on-missing. */
export async function executeObserverCapability(raw:ObserverCommand,capability:ObserverExecutorCapabilityPort,resources:{browser:ObserverBrowserPort;artifacts:ObserverExecutionServices['artifacts']},parent?:AbortSignal,clock=Date.now){
 const command=validateObserverCommand(raw,clock()),controller=new AbortController();
 const abort=()=>controller.abort();let poll:ReturnType<typeof setTimeout>|undefined;
 const deadline=setTimeout(abort,Math.max(1,command.deadlineAt-clock()));
 parent?.addEventListener('abort',abort,{once:true});if(parent?.aborted)abort();
 // One outstanding cancellation query at a time; a disconnected capability
 // cancels. A hung query is still bounded by the independent absolute deadline.
 const check=async()=>{
  try{if(await capability.cancelled()!==false)abort();}catch{abort();}
  finally{if(!controller.signal.aborted)poll=setTimeout(()=>{void check();},100);}
 };
 if(!controller.signal.aborted)void check();
 try{
  return await executeObserver(command,{
   authorize:async()=>observerRpcData(await capability.authorize()),browser:resources.browser,artifacts:resources.artifacts,
   forward:(_command,_digest,request,signal)=>{
    if(signal.aborted||controller.signal.aborted)throw Error('observer-cancelled');
    // Do not serialize AbortSignal across RPC. Cancellation travels through
    // the separate capability, while Workspace reauthorizes resource forwarding.
    return capability.forward(new Request(request.url,{method:request.method,headers:request.headers,redirect:'manual'}));
   },
  },controller.signal,clock);
 }finally{clearTimeout(deadline);clearTimeout(poll);controller.abort();parent?.removeEventListener('abort',abort);}
}
