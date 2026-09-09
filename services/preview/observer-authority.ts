import {actor,sameScope,turnDigest,type TurnActor,type TurnScope} from '../turn/protocol.ts';
import {turnRuntimeIdentity,type TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import {validateObserverCommand,type ObserverCommand} from './observer-protocol.ts';
import {previewRuntimeInput} from './runtime-input.ts';
import type {PreviewBinding} from './bindings.ts';
import type {ServiceRunRecord} from '../run/service.ts';

export interface ObserverAuthorityPorts{
 enabled():boolean;
 /** Synchronous current TurnJournal check; the model supplies no actor. */
 caller(command:ObserverCommand):{actor:TurnActor;identity:TurnRuntimeIdentity};
 membership(actor:TurnActor,scope:TurnScope):Promise<void>;
 /** Independently verifies the live execution and its actual lease deadline. */
 runtime(identity:TurnRuntimeIdentity):Promise<{expiresAt:number}>;
 target(previewId:string):Promise<{binding:PreviewBinding;run:ServiceRunRecord}>;
 /** Final synchronous check in the owning Workspace, after remote awaits. */
 current(binding:PreviewBinding):boolean;
}
/** Private authority composition, not a bearer token or HTTP endpoint. Both
 * admission and every subsequent request/result must run these checks. The
 * runtime port is mandatory; command expiry alone cannot substitute its lease. */
export async function authorizeObserver(raw:ObserverCommand,ports:ObserverAuthorityPorts,clock=Date.now){
 const command=validateObserverCommand(raw,clock());
 let deadline=command.deadlineAt,timer:ReturnType<typeof setTimeout>|undefined;
 let rejectExpired!:(error:Error)=>void;
 const expired=new Promise<never>((_,reject)=>{rejectExpired=reject;});
 const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>rejectExpired(Error('observer-authority-timeout')),Math.max(1,deadline-clock()));};
 const local=()=>{
  if(!ports.enabled()||deadline<=clock())throw Error('observer-authority-denied');
  const current=ports.caller(command),identity=turnRuntimeIdentity(current.identity),who=actor(current.actor);
  if(!sameScope(identity.scope,command.scope)||identity.sessionId!==command.sessionId||identity.turnId!==command.turnId||identity.dispatchId!==command.dispatchId)throw Error('observer-authority-denied');
  return {actor:who,identity};
 };
 const checkRuntime=async(identity:TurnRuntimeIdentity)=>{
  const lease=await Promise.race([ports.runtime(identity),expired]);
  if(!Number.isSafeInteger(lease?.expiresAt)||lease.expiresAt<=clock())throw Error('observer-authority-denied');
  deadline=Math.min(deadline,lease.expiresAt);schedule();
 };
 schedule();
 try{
  const caller=local();await Promise.race([ports.membership(caller.actor,command.scope),expired]);
  await checkRuntime(caller.identity);local();
  const target=await Promise.race([ports.target(command.previewId),expired]);
  const runtime=previewRuntimeInput(target,clock);
  if(target.binding.previewId!==command.previewId||!sameScope(target.binding.scope,command.scope)||!runtime.spec.plan.declaration.observation)throw Error('observer-authority-denied');
  deadline=Math.min(deadline,target.binding.expiresAt,runtime.reference.deadlineAt);schedule();
  const targetDigest=await Promise.race([turnDigest({binding:target.binding,plan:runtime.spec.plan}),expired]);
  // Remote reads may overlap revocation or replacement. Recheck the current
  // target, membership and runtime, and finish with a synchronous Turn check.
  const latest=await Promise.race([ports.target(command.previewId),expired]);
  const currentRuntime=previewRuntimeInput(latest,clock);
  if(await Promise.race([turnDigest({binding:latest.binding,plan:currentRuntime.spec.plan}),expired])!==targetDigest)throw Error('observer-target-stale');
  await Promise.race([ports.membership(caller.actor,command.scope),expired]);await checkRuntime(caller.identity);
  const final=local();if(JSON.stringify(final)!==JSON.stringify(caller))throw Error('observer-authority-denied');
  if(!ports.current(target.binding))throw Error('observer-target-stale');
  return structuredClone({command,actor:caller.actor,binding:target.binding,runtime,paths:runtime.spec.plan.declaration.observation,expiresAt:deadline,targetDigest});
 }catch(error){
  if(error instanceof Error&&['observer-authority-timeout','observer-target-stale'].includes(error.message))throw error;
  throw Error('observer-authority-denied');
 }finally{clearTimeout(timer);}
}
