import {observerRpcData,observerRpcPendingData} from './observer-rpc-data.ts';
import {DurableObject} from 'cloudflare:workers';
import {normalizeObserverCommand,validateObserverCommand,type ObserverCommand} from './observer-protocol.ts';
import {observerExecutorActorName,type ObserverExecutorCapabilityPort,type ObserverArtifactReadCapabilityPort,observerArtifactReadGrant} from './observer-executor-protocol.ts';
import {observerExecutionTarget} from './observer-execution.ts';
import {R2ObserverArtifacts,observerArtifactReceipt,type ObserverArtifactReceipt} from './observer-artifacts.ts';
import {SqlObserverExecutorSupervisor} from './observer-executor-supervisor.ts';
import {SqlObserverArtifactInventory} from './observer-artifact-inventory.ts';
import {executeObserverCapability} from '../observer-browser/executor.ts';
import {ObserverBrowserResources,type ObserverBrowserRuntimeNamespace} from '../observer-browser/runtime-rpc.ts';

export interface ObserverExecutorEnv{
 M3_OBSERVER_ENABLED?:unknown;
 OBSERVER_BROWSER_RUNTIME?:ObserverBrowserRuntimeNamespace;
 OBSERVER_ARTIFACTS?:R2Bucket;
}
/** Private durable execution supervisor. Deliberately has no public fetch API.
 * A native isolated browser runtime and artifact binding are separate deployment
 * prerequisites; neither an unconfigured runtime nor a missing task proves exit. */
export class ObserverExecutor extends DurableObject<ObserverExecutorEnv>{
 async #runtime(raw:ObserverCommand){
  const command=normalizeObserverCommand(raw),name=await observerExecutorActorName(command);
  if(this.ctx.id.name!==name)throw Error('observer-executor-identity-denied');
  if(!this.env.OBSERVER_BROWSER_RUNTIME?.getByName)throw Error('observer-browser-not-configured');
  return {command,runtime:this.env.OBSERVER_BROWSER_RUNTIME.getByName(name)};
 }
 async execute(raw:ObserverCommand,capability:ObserverExecutorCapabilityPort){
  const command=validateObserverCommand(raw);
  if(this.env.M3_OBSERVER_ENABLED!=='true')throw Error('observer-disabled');
  if(!this.env.OBSERVER_ARTIFACTS)throw Error('observer-artifacts-not-configured');
  const controller=new AbortController(),abort=()=>controller.abort();let deadlineAt=command.deadlineAt;
  let timer=setTimeout(abort,Math.max(1,deadlineAt-Date.now()));
  const expired=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('observer-timeout')),{once:true}));void expired.catch(()=>{});
  const wait=async<T,>(pending:Promise<T>):Promise<T>=>{const value=await Promise.race([pending,expired]);if(controller.signal.aborted||Date.now()>=deadlineAt)throw Error('observer-timeout');return value;};
  try{
  const {runtime}=await wait(this.#runtime(command));
  // Replayed stored content still requires current authority. The supervisor
  // itself only enforces durable identity, dispatch and stop semantics.
  const target=await wait(observerExecutionTarget(await wait(observerRpcPendingData(capability.authorize())),command,Date.now()));
  deadlineAt=Math.min(deadlineAt,target.expiresAt);clearTimeout(timer);timer=setTimeout(abort,Math.max(1,deadlineAt-Date.now()));
  if(await wait(capability.cancelled())!==false)throw Error('observer-cancelled');
  const targetIdentity=JSON.stringify({targetDigest:target.targetDigest,policy:target.policy});
  this.ctx.storage.transactionSync(()=>{
   this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS observer_executor_target(singleton INTEGER PRIMARY KEY CHECK(singleton=1),identity_json TEXT NOT NULL)');
   const rows=this.ctx.storage.sql.exec<{identity_json:string}>('SELECT identity_json FROM observer_executor_target').toArray();
   if(rows.length>1||(rows[0]&&rows[0].identity_json!==targetIdentity))throw Error('observer-target-stale');
   if(!rows.length)this.ctx.storage.sql.exec('INSERT INTO observer_executor_target VALUES(1,?)',targetIdentity);
  });
  await wait(this.ctx.storage.sync());
  const boundCapability:ObserverExecutorCapabilityPort={
   authorize:async()=>{
    const grant=await wait(observerExecutionTarget(await wait(observerRpcPendingData(capability.authorize())),command,Date.now()));
    if(grant.targetDigest!==target.targetDigest||JSON.stringify(grant.policy)!==JSON.stringify(target.policy))throw Error('observer-target-stale');
    return {...grant,expiresAt:Math.min(deadlineAt,grant.expiresAt)};
   },
   forward:request=>capability.forward(request),
   cancelled:()=>capability.cancelled(),
  };
  const artifacts=new R2ObserverArtifacts(this.env.OBSERVER_ARTIFACTS,new SqlObserverArtifactInventory(this.ctx.storage,command,()=>SqlObserverExecutorSupervisor.requireWritable(this.ctx.storage,command)));
  const supervisor=new SqlObserverExecutorSupervisor(this.ctx.storage,command,{
   execute:current=>executeObserverCapability(current,boundCapability,{artifacts,browser:{run:async input=>{
    let settled=false;
    const resources=new ObserverBrowserResources({
     fetch:request=>{if(settled||input.signal.aborted)throw Error('observer-cancelled');return input.fetchResource(request);},
     cancelled:async()=>settled||input.signal.aborted,
    });
    try{return observerRpcData(await runtime.run(current,{pageUrl:input.pageUrl,timeoutMs:input.timeoutMs},resources));}
    finally{settled=true;}
   }}},controller.signal),
   fenceAndStop:current=>runtime.fenceAndStop(current),
  });
  const result=await wait(supervisor.execute());
  const latest=await wait(observerExecutionTarget(await wait(observerRpcPendingData(capability.authorize())),command,Date.now()));
  if(latest.targetDigest!==target.targetDigest||JSON.stringify(latest.policy)!==JSON.stringify(target.policy)||await wait(capability.cancelled())!==false)throw Error('observer-target-stale');
  return result;
  }finally{clearTimeout(timer);controller.abort();}
 }
 async readArtifact(raw:ObserverCommand,rawReceipt:ObserverArtifactReceipt,capability:ObserverArtifactReadCapabilityPort):Promise<{receipt:ObserverArtifactReceipt;content:Uint8Array}>{
  const command=normalizeObserverCommand(raw),receipt=observerArtifactReceipt(rawReceipt);
  // No execution feature gate, runtime lookup or supervisor construction here.
  const controller=new AbortController();let deadlineAt=Date.now()+5000;
  const abort=()=>controller.abort();let timer=setTimeout(abort,5000);
  const expired=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('observer-artifact-read-timeout')),{once:true}));void expired.catch(()=>{});
  const wait=async<T,>(pending:Promise<T>):Promise<T>=>{const value=await Promise.race([pending,expired]);if(controller.signal.aborted||Date.now()>=deadlineAt)throw Error('observer-artifact-read-timeout');return value;};
  const authorize=async()=>{
   const grant=observerArtifactReadGrant(await wait(observerRpcPendingData(capability.authorize())),command,receipt,Date.now());
   deadlineAt=Math.min(deadlineAt,grant.expiresAt);clearTimeout(timer);timer=setTimeout(abort,Math.max(1,deadlineAt-Date.now()));
   if(Date.now()>=deadlineAt)throw Error('observer-artifact-read-timeout');
  };
  try{
   if(this.ctx.id.name!==await wait(observerExecutorActorName(command)))throw Error('observer-executor-identity-denied');
   await authorize();
   SqlObserverExecutorSupervisor.requireArtifact(this.ctx.storage,command,receipt);
   if(!this.env.OBSERVER_ARTIFACTS)throw Error('observer-artifacts-not-configured');
   const content=await wait(new R2ObserverArtifacts(this.env.OBSERVER_ARTIFACTS).read(command,receipt,controller.signal));
   await authorize();
   SqlObserverExecutorSupervisor.requireArtifact(this.ctx.storage,command,receipt);
   return {receipt,content};
  }finally{clearTimeout(timer);controller.abort();}
 }
 async stop(raw:ObserverCommand):Promise<boolean>{
  // Stop remains available with the feature disabled and after command expiry.
  const {command,runtime}=await this.#runtime(raw);
  return new SqlObserverExecutorSupervisor(this.ctx.storage,command,{
   execute:async()=>{throw Error('observer-disabled');},
   fenceAndStop:current=>runtime.fenceAndStop(current),
  }).stop();
 }
}
