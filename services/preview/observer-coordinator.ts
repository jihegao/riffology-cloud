import {ObserverCallHost} from './observer-host.ts';
import {executeObserver,type ObserverExecutionServices} from './observer-execution.ts';
import type {SqlObserverCalls} from './observer-calls.ts';
import type {ObserverCommand} from './observer-protocol.ts';

/** The owning Workspace supplies its durable journal, real authorization and
 * executor transport. stop must durably fence late starts and prove resource
 * exit; aborting a Promise or an absent in-memory task is not that proof. */
export function observerCoordinator(calls:SqlObserverCalls,services:ObserverExecutionServices,stop:(command:ObserverCommand)=>Promise<boolean>,clock=Date.now):ObserverCallHost{
 return new ObserverCallHost(calls,{
  authorize:command=>services.authorize(command),
  execute:(command,context)=>executeObserver(command,{
   browser:services.browser,artifacts:services.artifacts,
   forward:(current,digest,request,signal)=>services.forward(current,digest,request,signal),
   authorize:async current=>{
    // Keep every executor authorization tied to this live durable host turn.
    // The second read supplies full target metadata, never a cached grant.
    const grant=await context.authorize(),target=await services.authorize(current);
    if(context.signal.aborted)throw Error('observer-cancelled');
    if(target.targetDigest!==grant.targetDigest)throw Error('observer-target-stale');
    return {...target,expiresAt:Math.min(grant.expiresAt,target.expiresAt)};
   },
  },context.signal,clock),
  stop,
 },clock);
}
