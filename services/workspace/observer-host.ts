import {SqlObserverCalls} from '../preview/observer-calls.ts';
import {ObserverCallHost} from '../preview/observer-host.ts';
import type {ObserverCommand} from '../preview/observer-protocol.ts';
import type {TurnScope} from '../turn/protocol.ts';
import {BROWSER_BUILD_WAKE_KEY,SIMULATION_WAKE_KEY,applyWorkspaceAlarm,OBSERVER_WAKE_KEY,SERVICE_WAKE_KEY,TURN_WAKE_KEY,WORKSPACE_STATE_KEY} from './shared-alarm.ts';
import type {WorkspaceState} from './coordinator.ts';
export interface ObserverMaintenancePorts{
 shouldStop(command:ObserverCommand):Promise<boolean>;
 stop(command:ObserverCommand):Promise<boolean>;
}
/** SQL state and its logical/physical wake projection commit atomically. This
 * prevents an idle cleanup from erasing a concurrent newly accepted call's wake.
 * Maintenance only stops observations; it never starts a browser or reads a
 * historical result on behalf of a user. */
export class WorkspaceObserverHost{
 readonly calls:SqlObserverCalls;
 readonly #storage:DurableObjectStorage;readonly #ports:ObserverMaintenancePorts;readonly #clock:()=>number;
 constructor(storage:DurableObjectStorage,scope:TurnScope,ports:ObserverMaintenancePorts,clock=Date.now){
  this.#storage=storage;this.#ports=ports;this.#clock=clock;
  this.calls=new SqlObserverCalls(storage,scope,clock,operation=>storage.transaction(async tx=>{const value=operation();await this.#project(tx);return value;}));
 }
 async #project(tx:DurableObjectTransaction){
  const call=this.calls.activeSync(),now=this.#clock();
  const wake=call?Math.min(call.command.deadlineAt>now?call.command.deadlineAt:now+5000,now+5000):null;
  if(wake===null)await tx.delete(OBSERVER_WAKE_KEY);else await tx.put(OBSERVER_WAKE_KEY,wake);
  const state=await tx.get<WorkspaceState>(WORKSPACE_STATE_KEY),turn=await tx.get<unknown>(TURN_WAKE_KEY),service=await tx.get<unknown>(SERVICE_WAKE_KEY);
  return applyWorkspaceAlarm(tx,state?.wakeAt,turn,service,wake,await tx.get(SIMULATION_WAKE_KEY),await tx.get(BROWSER_BUILD_WAKE_KEY));
 }
 async #shouldStop(command:ObserverCommand):Promise<boolean>{
  if(command.deadlineAt<=this.#clock())return true;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([this.#ports.shouldStop(command),new Promise<true>(resolve=>{timer=setTimeout(()=>resolve(true),Math.min(5000,command.deadlineAt-this.#clock()));})])!==false;}
  catch{return true;}finally{clearTimeout(timer);}
 }
 async alarm():Promise<void>{
  try{
   const active=await this.calls.active();if(!active)return;
   if(active.status==='unknown'||await this.#shouldStop(active.command)||active.command.deadlineAt<=this.#clock()){
    const host=new ObserverCallHost(this.calls,{
     authorize:async()=>{throw Error('observer-maintenance-only');},
     execute:async()=>{throw Error('observer-maintenance-only');},
     stop:command=>this.#ports.stop(command),
    },this.#clock);
    await host.reconcile(active.command);
   }
  }finally{await this.#storage.transaction(tx=>this.#project(tx));await this.#storage.sync();}
 }
}
