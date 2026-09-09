import {SqlObserverCalls,type ObserverCallRecord} from './observer-calls.ts';
import {normalizeObserverCommand,validateObserverCommand,type ObserverCommand,type ObserverJson} from './observer-protocol.ts';

export type ObserverExecutionGrant={targetDigest:string;expiresAt:number};
export interface ObserverExecutionPorts{
 /** The real authority composition must bind this command to the current target. */
 authorize(command:ObserverCommand):Promise<ObserverExecutionGrant>;
 /** Resolves only after its browser context and owned resources have closed. */
 execute(command:ObserverCommand,context:{signal:AbortSignal;authorize():Promise<ObserverExecutionGrant>}):Promise<{stopped:true;result:{[key:string]:ObserverJson}}>;
 /** True means the executor has fenced the call and confirmed resource exit. */
 stop(command:ObserverCommand):Promise<boolean>;
}
/** Durable orchestration independent of a browser implementation. Unknown
 * execution stays reserved until explicit stop reconciliation; never retries
 * execute based on a timeout, missing reply, or reconstructed host. */
export class ObserverCallHost{
 readonly #calls:SqlObserverCalls;readonly #ports:ObserverExecutionPorts;readonly #clock:()=>number;
 constructor(calls:SqlObserverCalls,ports:ObserverExecutionPorts,clock=Date.now){this.#calls=calls;this.#ports=ports;this.#clock=clock;}
 async #stop(command:ObserverCommand){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([this.#ports.stop(command),new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),2000);})])===true;}
  catch{return false;}finally{clearTimeout(timer);}
 }
 async run(raw:ObserverCommand):Promise<ObserverCallRecord>{
  const command=validateObserverCommand(raw,this.#clock()),controller=new AbortController();
  let deadline=command.deadlineAt,timer:ReturnType<typeof setTimeout>|undefined,expired=false,started=false,executionSettled=false,targetDigest:string|undefined;
  let rejectExpired!:(error:Error)=>void;
  const timeout=new Promise<never>((_,reject)=>{rejectExpired=reject;});void timeout.catch(()=>{});
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>{expired=true;controller.abort();rejectExpired(Error('observer-timeout'));},Math.max(1,deadline-this.#clock()));};
  const authorize=async()=>{
   if(controller.signal.aborted)throw Error(expired?'observer-timeout':'observer-cancelled');
   if(expired||deadline<=this.#clock())throw Error('observer-timeout');
   const grant=await Promise.race([this.#ports.authorize(command),timeout]);
   if(controller.signal.aborted)throw Error(expired?'observer-timeout':'observer-cancelled');
   if(expired||!Number.isSafeInteger(grant?.expiresAt)||grant.expiresAt<=this.#clock())throw Error('observer-access-denied');
   if(targetDigest!==undefined&&grant.targetDigest!==targetDigest)throw Error('observer-target-stale');
   deadline=Math.min(deadline,grant.expiresAt);schedule();return grant;
  };
  schedule();
  try{
   const grant=await authorize();targetDigest=grant.targetDigest;
   await Promise.race([this.#calls.accept(command,targetDigest),timeout]);
   const claim=await Promise.race([this.#calls.start(command),timeout]);
   if(!claim.shouldExecute){await authorize();return claim.record;}
   started=true;
   try{
    await authorize();
    // The executor gets a fresh authorization function for every request,
    // not a cached success or browser cookie.
    const result=await Promise.race([this.#ports.execute(command,{signal:controller.signal,authorize}),timeout]);
    if(result?.stopped!==true)throw Error('observer-exit-unconfirmed');
    executionSettled=true;await authorize();
    const record=await Promise.race([this.#calls.finish(command,{status:'completed',result:result.result,errorCode:null}),timeout]);
    await authorize();return record;
   }catch(error){
    controller.abort();
    const stopped=executionSettled||await this.#stop(command);
    // A lost completion acknowledgement may already have persisted success.
    // Do not overwrite it or disclose it without a fresh successful check.
    const existing=await this.#calls.snapshot(command);
    if(existing&&['completed','failed','cancelled'].includes(existing.status))throw Error('observer-result-unavailable');
    const code=error instanceof Error&&/^observer-[a-z-]+$/.test(error.message)?error.message:'observer-execution-failed';
    return await this.#calls.finish(command,{status:stopped?'failed':'unknown',result:null,errorCode:code});
   }
  }finally{clearTimeout(timer);if(started)controller.abort();}
 }
 /** A maintenance action, not permission to read historical result contents.
  * The owner must separately authorize maintenance scope before invoking it. */
 async reconcile(raw:ObserverCommand):Promise<ObserverCallRecord|null>{
  const command=normalizeObserverCommand(raw),record=await this.#calls.snapshot(command);
  if(!record||['completed','failed','cancelled'].includes(record.status))return record;
  if(!await this.#stop(command))return record;
  return this.#calls.finish(command,{status:'failed',result:null,errorCode:'observer-execution-reconciled'});
 }
}
