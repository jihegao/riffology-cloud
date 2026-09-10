import {leaseReference,type Acquisition,type Lease,type LeaseReference,type LeaseRequest,type StopConfirmation} from '../quota/core.ts';
import {turnId,positive} from '../turn/protocol.ts';
import {SqlServiceRunJournal,type ServiceRunRecord,type ServiceRunStorage} from './service.ts';
import {serviceRuntimeInput,serviceRuntimeObservation,type ServiceRuntimeInput,type ServiceRuntimePort,type ServiceRuntimeObservation,type ServiceStopReceipt} from './runtime-protocol.ts';
export interface ServiceQuotaPort{
 acquire(request:LeaseRequest):Promise<Acquisition>;
 lookup(operationId:string):Promise<Acquisition|null>;
 dispatch(reference:LeaseReference):Promise<{authorized:boolean;lease:Lease}>;
 markUnknown(reference:LeaseReference):Promise<unknown>;
 confirmStopped(reference:LeaseReference,proof:StopConfirmation):Promise<{released:boolean;lease:Lease}>;
}
type State={runId:string;request:LeaseRequest;runtimeId:string;lease:LeaseReference|null;acquiredAt:number|null;denied:boolean;startClaimed:boolean;stop:ServiceStopReceipt|null;released:boolean;failureReason:string|null;acquisitionClosed:boolean};
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const equal=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const terminal=(r:ServiceRunRecord)=>['cancelled','failed','stopped'].includes(r.status);
/** Private reconciliation core. The host schedules subsequent ticks and holds
 * timed-out RPCs; it must authenticate the run before invoking this object. */
export class ServiceRunCoordinator{
 readonly #storage:ServiceRunStorage;readonly #journal:SqlServiceRunJournal;readonly #quota:ServiceQuotaPort;readonly #runtime:ServiceRuntimePort;readonly #clock:()=>number;readonly #hold:(promise:Promise<unknown>)=>void;readonly #rpcMs:number;readonly #ready:Promise<void>;
 constructor(storage:ServiceRunStorage,journal:SqlServiceRunJournal,quota:ServiceQuotaPort,runtime:ServiceRuntimePort,hold:(promise:Promise<unknown>)=>void,clock=Date.now,rpcMs=5000){
  this.#storage=storage;this.#journal=journal;this.#quota=quota;this.#runtime=runtime;this.#hold=hold;this.#clock=clock;this.#rpcMs=positive(rpcMs);if(rpcMs>30000)throw Error('invalid-service-rpc-timeout');
  storage.transactionSync(()=>storage.sql.exec('CREATE TABLE IF NOT EXISTS service_coordination(run_id TEXT PRIMARY KEY,state_json TEXT NOT NULL)'));this.#ready=storage.sync();
 }
 #load(id:string):State|null{const row=this.#storage.sql.exec<{state_json:string}>('SELECT state_json FROM service_coordination WHERE run_id=?',id).toArray()[0];return row?JSON.parse(row.state_json):null;}
 async #update<T>(id:string,fn:(state:State|null)=>{state:State;value:T}){await this.#ready;const value=this.#storage.transactionSync(()=>{const result=fn(this.#load(id));this.#storage.sql.exec('INSERT INTO service_coordination VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET state_json=excluded.state_json',id,JSON.stringify(result.state));return result.value;});await this.#storage.sync();return structuredClone(value);}
 async #call<T>(operation:()=>Promise<T>):Promise<{value:T}|null>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const pending=Promise.resolve().then(operation).then(value=>({value}),()=>null);this.#hold(pending);
  try{return await Promise.race([pending,new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),this.#rpcMs);})]);}finally{if(timer!==undefined)clearTimeout(timer);}
 }
 async state(id:string){turnId(id);await this.#ready;return this.#load(id);}
 #input(run:ServiceRunRecord,state:State):ServiceRuntimeInput{
  if(!state.lease)throw Error('service-coordinator-lease-required');
  return serviceRuntimeInput({reference:{runId:run.id,runtimeId:state.runtimeId,dispatchId:state.request.operationId,leaseId:state.lease.leaseId,generation:1,deadlineAt:state.request.deadlineAt},scope:run.scope,spec:run.spec,lease:state.lease});
 }
 #lease(request:LeaseRequest,lease:Lease){const ref=leaseReference(lease),{leaseId:_,...body}=ref;if(!equal(body,request))throw Error('service-coordinator-lease-scope-denied');return ref;}
 async #observe(input:ServiceRuntimeInput,method:'start'|'observe'|'stop'):Promise<ServiceRuntimeObservation|null>{
  const response=await this.#call(()=>this.#runtime[method](structuredClone(input)));if(!response)return null;
  try{return serviceRuntimeObservation(response.value,input,this.#clock());}catch{return null;}
 }
 async #finish(run:ServiceRunRecord,state:State,input:ServiceRuntimeInput,proof:ServiceStopReceipt){
  if(state.acquiredAt===null||proof.observedAt<Math.max(run.startedAt??run.createdAt,state.acquiredAt))return run;
  state=await this.#update(run.id,current=>{if(!current)throw Error('service-coordinator-missing');if(current.stop&&!equal(current.stop,proof))throw Error('service-coordinator-stop-conflict');current.stop=proof;return {state:current,value:current};});
  if(run.runtime&&!terminal(run))run=await this.#journal.confirmStopped(input.reference,{confirmationId:proof.confirmationId,observedAt:proof.observedAt,outcome:state.failureReason!==null||run.stopRequestedAt===null?'failed':'stopped',errorCode:state.failureReason??(run.stopRequestedAt!==null?null:'service-exited')});
  if(!state.released){
   const result=await this.#call(()=>this.#quota.confirmStopped(structuredClone(input.lease),{kind:'runtime-stopped',confirmationId:proof.confirmationId,observedAt:proof.observedAt}));
   if(result){const ref=this.#lease(state.request,result.value.lease),confirmation=result.value.lease.confirmation;
    if(equal(ref,input.lease)&&result.value.lease.status==='stopped'&&confirmation?.confirmationId===proof.confirmationId&&confirmation.observedAt===proof.observedAt&&confirmation.kind==='runtime-stopped')await this.#update(run.id,current=>{if(!current)throw Error('service-coordinator-missing');current.released=true;return {state:current,value:null};});
   }
  }return this.#journal.get(run.id);
 }
 async requestStop(id:string){await this.#journal.requestStop(id);return this.reconcile(id);}
 async reconcile(id:string):Promise<ServiceRunRecord>{
  turnId(id);await this.#ready;let run=await this.#journal.get(id),state=this.#load(id);
  if(!state&&terminal(run))return run;
  if(!state)state=await this.#update(id,current=>{const next=current??{runId:id,request:{tenantId:run.scope.tenantId,projectId:run.scope.projectId,workspaceId:run.scope.workspaceId,generation:1,operation:'service-run' as const,operationId:crypto.randomUUID(),deadlineAt:positive(this.#clock())+run.spec.maxDurationMs,runId:id},runtimeId:crypto.randomUUID(),lease:null,acquiredAt:null,denied:false,startClaimed:false,stop:null,released:false,failureReason:null,acquisitionClosed:false};return {state:next,value:next};});
  if(state.denied){if(!terminal(run))return this.#journal.failQueued(id,'quota-exhausted');return run;}
  if(!state.lease){
   const known=await this.#call(()=>this.#quota.lookup(state!.request.operationId));if(!known)return run;
   if(known.value===null&&state.request.deadlineAt<=this.#clock()){await this.#update(id,current=>{if(!current)throw Error('service-coordinator-missing');current.acquisitionClosed=true;return {state:current,value:null};});return terminal(run)?run:this.#journal.failQueued(id,'service-deadline');}
   const result=known.value===null?await this.#call(()=>this.#quota.acquire(structuredClone(state!.request))):{value:known.value};if(!result)return run;
   const acquisition=result.value;
   if(acquisition.lease===null){if(!['quota-exhausted','run-held','workspace-held'].includes(String(acquisition.denial)))throw Error('invalid-service-acquisition');state=await this.#update(id,current=>{if(!current)throw Error('service-coordinator-missing');current.denied=true;return {state:current,value:current};});return terminal(run)?run:this.#journal.failQueued(id,'quota-exhausted');}
   const ref=this.#lease(state.request,acquisition.lease),acquiredAt=positive(acquisition.lease.acquiredAt);if(acquiredAt>this.#clock()||acquiredAt>state.request.deadlineAt)throw Error('invalid-service-acquisition-time');
   state=await this.#update(id,current=>{if(!current)throw Error('service-coordinator-missing');if(current.lease&&!equal(current.lease,ref))throw Error('service-coordinator-lease-conflict');current.lease=ref;current.acquiredAt=acquiredAt;return {state:current,value:current};});
  }
  const input=this.#input(run,state);run=await this.#journal.get(id);
  if(state.stop){
   // A repeated authenticated Stop is also a teardown reconciliation signal.
   // Runtime replays its durable receipt and release hook without repeating the
   // native stop; this coordinator retains the already validated stop proof.
   const observation=await this.#observe(input,'stop');
   return this.#finish(run,state,input,observation?.stop??state.stop);
  }
  if(terminal(run)||run.stopRequestedAt!==null||input.reference.deadlineAt<=this.#clock()){
   if(!terminal(run)&&run.stopRequestedAt===null){state=await this.#update(id,current=>{if(!current)throw Error('service-coordinator-missing');current.failureReason='service-deadline';return {state:current,value:current};});run=await this.#journal.requestStop(id);}
   const observation=await this.#observe(input,'stop');if(observation?.stop)return this.#finish(run,state,input,observation.stop);
   await this.#call(()=>this.#quota.markUnknown(structuredClone(input.lease)));if(run.runtime)await this.#journal.unknown(input.reference);return this.#journal.get(id);
  }
  if(run.runtime===null){
   let begin;try{begin=await this.#journal.begin(input.reference);}catch{return this.#journal.get(id);}
   run=begin.record;
   if(begin.dispatch){
    const dispatch=await this.#call(()=>this.#quota.dispatch(structuredClone(input.lease)));
    if(dispatch&&dispatch.value.authorized&&equal(this.#lease(state.request,dispatch.value.lease),input.lease)&&dispatch.value.lease.status==='dispatched'&&!dispatch.value.lease.expired){
     const claim=await this.#update(id,current=>{if(!current)throw Error('service-coordinator-missing');const granted=!current.startClaimed;current.startClaimed=true;return {state:current,value:granted};});
     if(claim){const current=await this.#journal.get(id);if(current.stopRequestedAt===null&&!terminal(current)&&input.reference.deadlineAt>this.#clock()){
      const observation=await this.#observe(input,'start');if(observation?.stop)return this.#finish(current,state,input,observation.stop);
      if(observation?.status==='healthy'){try{return await this.#journal.healthy(input.reference);}catch{return this.#journal.get(id);}}
     }}
    }
   }
  }
  const observation=await this.#observe(input,'observe');if(observation?.stop)return this.#finish(await this.#journal.get(id),state,input,observation.stop);
  if(observation?.status==='healthy'){try{return await this.#journal.healthy(input.reference);}catch{return this.#journal.get(id);}}
  if(observation?.status==='starting')return this.#journal.get(id);
  await this.#journal.unknown(input.reference);return this.#journal.get(id);
 }
}
