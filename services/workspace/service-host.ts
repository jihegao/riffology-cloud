import type {TurnActor,TurnScope} from '../turn/protocol.ts';
import {SqlServiceIntentJournal,type ServiceIntentRequest,type ServiceSourceCandidate} from './service-intents.ts';
import {ServiceIntentDelivery,type ServiceDeliveryPorts} from './service-delivery.ts';
import {applyWorkspaceAlarm,OBSERVER_WAKE_KEY,SERVICE_WAKE_KEY,TURN_WAKE_KEY,WORKSPACE_STATE_KEY} from './shared-alarm.ts';
import type {WorkspaceState} from './coordinator.ts';

/** Workspace-local SQL outbox and its wake projection commit together. No
 * remote RPC runs inside these transactions. */
export class WorkspaceServiceHost{
 readonly #storage:DurableObjectStorage;
 readonly #journal:SqlServiceIntentJournal;
 readonly #delivery:ServiceIntentDelivery;
 constructor(storage:DurableObjectStorage,scope:TurnScope,ports:ServiceDeliveryPorts){
  this.#storage=storage;
  this.#journal=new SqlServiceIntentJournal(storage,scope,Date.now,()=>crypto.randomUUID(),operation=>storage.transaction(async tx=>{
   const result=operation();await this.#project(tx);return result;
  }));
  this.#delivery=new ServiceIntentDelivery(this.#journal,ports);
 }
 async #project(tx:DurableObjectTransaction){
  const wake=this.#journal.nextWakeSync();
  if(wake===null)await tx.delete(SERVICE_WAKE_KEY);else await tx.put(SERVICE_WAKE_KEY,wake);
  const state=await tx.get<WorkspaceState>(WORKSPACE_STATE_KEY),turn=await tx.get<unknown>(TURN_WAKE_KEY),observer=await tx.get<unknown>(OBSERVER_WAKE_KEY);
  return applyWorkspaceAlarm(tx,state?.wakeAt,turn,wake,observer);
 }
 submit(actor:TurnActor,key:string,request:ServiceIntentRequest,freeze:()=>ServiceSourceCandidate){return this.#journal.create(actor,key,request,freeze);}
 submitFromPolicy(actor:TurnActor,key:string,body:{maxDurationMs:number},image:string,freeze:()=>ServiceSourceCandidate){return this.#journal.createFromPolicy(actor,key,body,image,freeze);}
 list(options:{before?:{createdAt:number;runId:string};limit?:number}={}){return this.#journal.list(options);}
 stop(runId:string){return this.#journal.requestStop(runId);}
 snapshot(runId:string){return this.#journal.get(runId);}
 async alarm(){
  try{await this.#delivery.advance();}
  finally{await this.#storage.transaction(tx=>this.#project(tx));await this.#storage.sync();}
 }
}
