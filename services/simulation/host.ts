import {GROUP_RESERVATION,GROUP_WAKE_KEY} from './group-state.ts';
import {publishOutputs,type SimulationOutput} from './outputs.ts';
import {actor as checkedActor,scope as checkedScope,turnId,type TurnActor,type TurnScope} from '../turn/protocol.ts';
import {leaseReference,type LeaseReference,type LeaseRequest,type Acquisition,type StopConfirmation} from '../quota/core.ts';
import {modelVersion,digest,type SimulationPlan} from './source.ts';
import {resolveParameters,validateMetrics,type ParameterValues} from './model-spec.ts';
import type {SimulationInput,NativeObservation} from './native.ts';
import {applyWorkspaceAlarm,SIMULATION_WAKE_KEY,WORKSPACE_STATE_KEY,TURN_WAKE_KEY,SERVICE_WAKE_KEY,OBSERVER_WAKE_KEY} from '../workspace/shared-alarm.ts';
export type ExperimentRequest={revisionId:string|null;filesSha256:string;specSha256:string;parameters:ParameterValues;seed:number};
type Status='queued'|'waiting_for_capacity'|'preparing'|'running'|'finalizing'|'stopping'|'unknown'|'completed'|'failed'|'cancelled';
export type SimulationRecord={experimentId:string;groupId?:string;runId:string;scope:TurnScope;actor:TurnActor;key:string;requestJson:string;input:SimulationInput;status:Status;createdAt:number;updatedAt:number;cancelledAt:number|null;errorCode:string|null;attempt:number;quotaClaimed:boolean;releaseProof:StopConfirmation|null;lease:LeaseReference|null;dispatchClaimed?:boolean;startClaimed:boolean;stop:NativeObservation['stop'];result:null|{metrics:Record<string,number>;artifactSha256:string;outputs?:SimulationOutput[]};releaseBegunAt:number|null;quietSince:number|null;released:boolean};
export interface SimulationPorts{
 quota:{acquire(request:LeaseRequest):Promise<Acquisition>;lookup(tenantId:string,operationId:string):Promise<Acquisition|null>;dispatch(lease:LeaseReference):Promise<{authorized:boolean;lease:unknown}>;confirmStopped(lease:LeaseReference,proof:StopConfirmation):Promise<unknown>};
 start(input:SimulationInput):Promise<NativeObservation>;
 observe(input:SimulationInput):Promise<NativeObservation>;
 stop(input:SimulationInput):Promise<NativeObservation>;
 destroy(input:SimulationInput):Promise<void>;
 running(input:SimulationInput):Promise<boolean>;
 publish(record:SimulationRecord,result:unknown):Promise<{metrics:Record<string,number>;artifactSha256:string;outputs?:SimulationOutput[]}>;
 authorize(actor:TurnActor):Promise<boolean>;
 hold(promise:Promise<unknown>):void;
}
const PREFIX='simulation:run:',INTENT='simulation:intent:';
const TERMINAL=new Set<Status>(['completed','failed','cancelled']);
export function experimentRequest(raw:unknown):ExperimentRequest{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='filesSha256,parameters,revisionId,seed,specSha256')throw Error('simulation-input-invalid');
 const r=raw as ExperimentRequest;
 if(r.revisionId!==null&&(typeof r.revisionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(r.revisionId))||! /^[a-f0-9]{64}$/.test(r.filesSha256)||! /^[a-f0-9]{64}$/.test(r.specSha256)||!Number.isSafeInteger(r.seed)||r.seed<0||r.seed>4294967295||!r.parameters||typeof r.parameters!=='object'||Array.isArray(r.parameters)||Object.keys(r.parameters).length>64||JSON.stringify(r).length>8192)throw Error('simulation-input-invalid');
 return structuredClone(r);
}
export function publicExperiment(r:SimulationRecord,currentFilesSha:string|null){return {experimentId:r.experimentId,runId:r.runId,version:modelVersion(r.input.plan),parameters:r.input.parameters,seed:r.input.seed,status:r.status,createdAt:r.createdAt,updatedAt:r.updatedAt,errorCode:r.errorCode,result:r.result,stale:currentFilesSha!==null&&currentFilesSha!==modelVersion(r.input.plan).filesSha256};}
/** Runs and group admission share one logical simulation wake. */
export async function projectSimulationWake(tx:DurableObjectTransaction,now:number){
 const active=[...(await tx.list<SimulationRecord>({prefix:PREFIX})).values()].some(r=>!r.released);
 const groupWake=await tx.get<number>(GROUP_WAKE_KEY);
 const wake=active?Math.min(now+2000,groupWake??Infinity):groupWake??null;
 if(wake===null)await tx.delete(SIMULATION_WAKE_KEY);else await tx.put(SIMULATION_WAKE_KEY,wake);
 const state=await tx.get<{wakeAt:number|null}>(WORKSPACE_STATE_KEY);
 await applyWorkspaceAlarm(tx,state?.wakeAt,await tx.get(TURN_WAKE_KEY),await tx.get(SERVICE_WAKE_KEY),await tx.get(OBSERVER_WAKE_KEY),wake);
}
export type GroupChildAdmission={runId:string;groupId:string;permit(tx:DurableObjectTransaction):Promise<boolean>};
/** Workspace-owned intents, state and wake commit together. External effects
 * are fenced in durable state before dispatch. Unknown requests only observe. */
export class SimulationHost{
 #advancing=false;
 readonly storage:DurableObjectStorage;readonly scope:TurnScope;readonly ports:SimulationPorts;readonly clock:()=>number;readonly policy:{durationMs:number;releaseGuardMs:number;quietMs:number};
 constructor(storage:DurableObjectStorage,scope:TurnScope,ports:SimulationPorts,clock=Date.now,policy={durationMs:600000,releaseGuardMs:360000,quietMs:30000}){this.storage=storage;this.scope=checkedScope(scope);this.ports=ports;this.clock=clock;this.policy=policy;}
 async #project(tx:DurableObjectTransaction){await projectSimulationWake(tx,this.clock());}
 async #change(id:string,fn:(record:SimulationRecord)=>void){
  const result=await this.storage.transaction(async tx=>{const r=await tx.get<SimulationRecord>(PREFIX+id);if(!r)throw Error('simulation-not-found');fn(r);r.updatedAt=this.clock();await tx.put(PREFIX+id,r);await this.#project(tx);return r;});await this.storage.sync();return result;
 }
 async get(id:string){turnId(id);const row=await this.storage.get<SimulationRecord>(PREFIX+id);if(!row)throw Error('simulation-not-found');return row;}
 async list(before?:string){if(before!==undefined)turnId(before);const records=[...(await this.storage.list<SimulationRecord>({prefix:PREFIX})).values()].sort((a,b)=>b.createdAt-a.createdAt||b.runId.localeCompare(a.runId));const offset=before===undefined?0:records.findIndex(r=>r.runId===before)+1;if(before!==undefined&&offset===0)throw Error('simulation-input-invalid');const items=records.slice(offset,offset+20);return {items,nextCursor:offset+20<records.length?items.at(-1)!.runId:null};}
 async replay(actor:TurnActor,key:string,request:ExperimentRequest){
  checkedActor(actor);turnId(key);const intent=INTENT+await digest(JSON.stringify([actor.userId,key]));const id=await this.storage.get<string>(intent);if(!id)return null;
  const prior=await this.get(id);if(prior.requestJson!==JSON.stringify(request)||prior.actor.authVersion!==actor.authVersion)throw Error('simulation-idempotency-conflict');return prior;
 }
 async submit(actor:TurnActor,key:string,raw:unknown,plan:SimulationPlan,image:string,stillCurrent:()=>boolean,child?:GroupChildAdmission){
  const request=experimentRequest(raw);checkedActor(actor);turnId(key);
  const intent=child?`simulation:child-intent:${turnId(child.groupId)}:${turnId(child.runId)}`:INTENT+await digest(JSON.stringify([actor.userId,key]));
  const priorId=await this.storage.get<string>(intent);
  if(priorId){const prior=await this.get(priorId);if(prior.requestJson!==JSON.stringify(request)||prior.actor.userId!==actor.userId||prior.actor.authVersion!==actor.authVersion||(child&&(prior.runId!==child.runId||prior.groupId!==child.groupId||prior.experimentId!==child.groupId)))throw Error('simulation-idempotency-conflict');return prior;}
  if(!image||image.length>512)throw Error('simulation-unavailable');
  const version=modelVersion(plan);if(JSON.stringify(version)!==JSON.stringify({revisionId:request.revisionId,filesSha256:request.filesSha256,specSha256:request.specSha256}))throw Error('simulation-model-stale');
  const parameters=resolveParameters(plan.spec,request.parameters),now=this.clock(),runId=child?turnId(child.runId):crypto.randomUUID();
  const record:SimulationRecord={experimentId:child?.groupId??runId,...(child?{groupId:child.groupId}:{}),runId,scope:this.scope,actor:checkedActor(actor),key,requestJson:JSON.stringify(request),input:{runId,plan,parameters,seed:request.seed,deadlineAt:now+this.policy.durationMs,runtimeImage:image},status:'queued',createdAt:now,updatedAt:now,cancelledAt:null,errorCode:null,attempt:0,quotaClaimed:false,releaseProof:null,lease:null,dispatchClaimed:false,startClaimed:false,stop:null,result:null,releaseBegunAt:null,quietSince:null,released:false};
  const result=await this.storage.transaction(async tx=>{
   const existing=await tx.get<string>(intent);if(existing){const r=(await tx.get<SimulationRecord>(PREFIX+existing))!;if(r.requestJson!==record.requestJson||r.actor.authVersion!==actor.authVersion||(child&&(r.runId!==child.runId||r.groupId!==child.groupId||r.experimentId!==child.groupId)))throw Error('simulation-idempotency-conflict');return r;}
   if(!stillCurrent())throw Error('simulation-model-stale');
   const reservations=await tx.list<string[]>({prefix:GROUP_RESERVATION});
   const reserved=[...reservations.values()].reduce((n,ids)=>n+ids.length,0);
   if(child&&(!(reservations.get(GROUP_RESERVATION+child.groupId)??[]).includes(runId)||!await child.permit(tx)))throw Error('simulation-group-admission-closed');
   const rows=[...(await tx.list<SimulationRecord>({prefix:PREFIX})).values()];
   if(rows.length+reserved+(child?0:1)>1000||rows.filter(r=>!r.released).length>=8)throw Error('simulation-capacity');
   if(child)await tx.put(GROUP_RESERVATION+child.groupId,reservations.get(GROUP_RESERVATION+child.groupId)!.filter(id=>id!==runId));
   await tx.put(PREFIX+runId,record);await tx.put(intent,runId);await this.#project(tx);return record;
  });await this.storage.sync();return result;
 }
 async cancel(id:string){return this.#change(id,r=>{if(!TERMINAL.has(r.status)){r.cancelledAt??=this.clock();r.status='stopping';}});}
 async #bounded<T>(operation:()=>Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;const pending=Promise.resolve().then(operation);this.ports.hold(pending.catch(()=>{}));try{return await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('simulation-operation-unconfirmed')),15000);})]);}finally{clearTimeout(timer);}}
 async authorizeActor(actor:TurnActor){return this.#bounded(()=>this.ports.authorize(checkedActor(actor)));}
 async alarm(){
  if(this.#advancing)return;this.#advancing=true;
  try{const records=[...(await this.storage.list<SimulationRecord>({prefix:PREFIX})).values()].filter(r=>!r.released);for(const r of records){try{await this.#advance(r.runId);}catch{await this.#change(r.runId,current=>{if(!TERMINAL.has(current.status)){current.status='unknown';current.errorCode=current.dispatchClaimed&&!current.startClaimed?'simulation-dispatch-unconfirmed':'simulation-operation-unconfirmed';}});}}}
  finally{this.#advancing=false;await this.storage.transaction(tx=>this.#project(tx));await this.storage.sync();}
 }
 async #advance(id:string){
  let r=await this.get(id);
  if(r.released)return;
  if(r.stop){await this.#release(r);return;}
  // A durable dispatch attempt without a native-start intent can never be
  // replayed as authorization. Even observe/stop may wake a Sandbox, so this
  // recovery path must settle the lease without touching native resources.
  if(r.dispatchClaimed&&!r.startClaimed){await this.#releaseNeverStarted(r);return;}
  const allowed=await this.#bounded(()=>this.ports.authorize(r.actor));
  if(!allowed&&!r.cancelledAt)r=await this.#change(id,v=>{v.cancelledAt=this.clock();v.errorCode='simulation-access-revoked';});
  const expired=this.clock()>=r.input.deadlineAt;
  // Lookup the original operation even on cancellation: an acquire ack may
  // have been lost. Never label a possible held lease as never acquired.
  if(!r.lease){
   const operationId=`sim-${r.runId}-${r.attempt}`;
   let acquisition=await this.#bounded(()=>this.ports.quota.lookup(r.scope.tenantId,operationId));
   if(!acquisition&&(r.quotaClaimed||!r.cancelledAt&&!expired)){
    if(!r.quotaClaimed)r=await this.#change(id,v=>{v.quotaClaimed=true;});
    const request:LeaseRequest={tenantId:r.scope.tenantId,projectId:r.scope.projectId,workspaceId:r.scope.workspaceId,generation:r.scope.workspaceGeneration,operation:'simulation-run',operationId,runId:r.runId,deadlineAt:r.input.deadlineAt};
    acquisition=await this.#bounded(()=>this.ports.quota.acquire(request));
   }
   if(acquisition?.lease){const lease=leaseReference(acquisition.lease);r=await this.#change(id,v=>{v.lease=lease;});}
   else if(r.cancelledAt||expired){await this.#change(id,v=>{v.status=v.cancelledAt?'cancelled':'failed';v.errorCode??=expired?'simulation-deadline':null;v.released=true;});return;}
   else{await this.#change(id,v=>{v.attempt++;v.quotaClaimed=false;v.status='waiting_for_capacity';});return;}
  }
  r=await this.get(id);
  if((r.cancelledAt||this.clock()>=r.input.deadlineAt)&&!r.startClaimed){
   await this.#releaseNeverStarted(r);return;
  }
  let observation:NativeObservation;
  if(!r.startClaimed){
   r=await this.#change(id,v=>{if(!v.cancelledAt){v.dispatchClaimed=true;v.status='preparing';}});
   if(!r.dispatchClaimed)return;
   const dispatched=await this.#bounded(()=>this.ports.quota.dispatch(r.lease!));
   if(dispatched?.authorized!==true){
    // No native start has been attempted. Keep the acquired lease visible
    // until the root's no-start proof has been acknowledged by quota.
    await this.#change(id,v=>{v.errorCode='simulation-quota-denied';v.status='stopping';});return;
   }
   if(JSON.stringify(leaseReference(dispatched.lease as Parameters<typeof leaseReference>[0]))!==JSON.stringify(r.lease))throw Error('simulation-quota-unconfirmed');
   // Only a confirmed, matching one-shot grant may create the native intent.
   // Legacy records lacking dispatchClaimed keep their conservative old
   // startClaimed interpretation; they cannot prove native was never called.
   r=await this.#change(id,v=>{if(!v.cancelledAt&&this.clock()<v.input.deadlineAt)v.startClaimed=true;});
   if(!r.startClaimed)return;
   observation=await this.#bounded(()=>this.ports.start(r.input));
  }else if(r.cancelledAt||this.clock()>=r.input.deadlineAt){observation=await this.#bounded(()=>this.ports.stop(r.input));}
  else observation=await this.#bounded(()=>this.ports.observe(r.input));
  r=await this.get(id);
  if(observation.status!=='stopped'){await this.#change(id,v=>{v.status=v.cancelledAt?'stopping':observation.status==='running'?'running':'unknown';});return;}
  if(!observation.stop||observation.stop.observedAt<r.createdAt)throw Error('simulation-stop-invalid');
  let result:SimulationRecord['result']=null,errorCode:string|null=null;
  if(!r.cancelledAt&&observation.result!==null){
   await this.#change(id,v=>{if(!v.cancelledAt)v.status='finalizing';});
   try{result=await this.#bounded(()=>this.ports.publish(r,observation.result));}catch(error){if(error instanceof Error&&error.message==='simulation-result-invalid')errorCode='simulation-result-invalid';else throw error;}
  }else errorCode=r.cancelledAt?null:'simulation-execution-failed';
  await this.#change(id,v=>{v.stop=observation.stop;v.result=v.cancelledAt?null:result;v.status=v.cancelledAt?'cancelled':result?'completed':'failed';v.errorCode=errorCode;v.releaseBegunAt=this.clock();});
 }
 async #releaseNeverStarted(r:SimulationRecord){
  r=await this.#change(r.runId,v=>{
   v.errorCode??=v.cancelledAt?null:this.clock()>=v.input.deadlineAt?'simulation-deadline':'simulation-dispatch-unconfirmed';
   // This root proves no native intent exists. runtime-stopped is required
   // even if quota consumed dispatch before losing its response; quota's
   // never-started proof type only accepts an untouched held lease.
   v.releaseProof??={kind:'runtime-stopped',confirmationId:`never-${v.runId}`,observedAt:this.clock()};
  });
  await this.#bounded(()=>this.ports.quota.confirmStopped(r.lease!,r.releaseProof!));
  await this.#change(r.runId,v=>{v.status=v.cancelledAt?'cancelled':'failed';v.released=true;});
 }
 async #release(r:SimulationRecord){
  // Same bounded assignment guard as existing ServiceSandbox release. A single
  // running=false probe is not external capacity-release evidence.
  let observed=false;try{await this.#bounded(()=>this.ports.destroy(r.input));observed=!(await this.#bounded(()=>this.ports.running(r.input)));}catch{}
  r=await this.#change(r.runId,v=>{v.quietSince=observed?(v.quietSince??this.clock()):null;});
  if(r.quietSince===null||this.clock()-r.quietSince<this.policy.quietMs||this.clock()-(r.releaseBegunAt??this.clock())<this.policy.releaseGuardMs)return;
  r=await this.#change(r.runId,v=>{v.releaseProof??={kind:'runtime-stopped',confirmationId:v.stop!.confirmationId,observedAt:this.clock()};});
  await this.#bounded(()=>this.ports.quota.confirmStopped(r.lease!,r.releaseProof!));
  await this.#change(r.runId,v=>{v.released=true;});
 }
}
/** Only the platform publishes the immutable result envelope, after native
 * exit and process-domain stop proof. Project success strings are ignored. */
export async function publishSimulationResult(bucket:R2Bucket,record:SimulationRecord,raw:unknown){
 const value=raw as {exitCode?:unknown;result?:unknown;pythonVersion?:unknown};
 if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='exitCode,pythonVersion,result'||value.exitCode!==0||typeof value.pythonVersion!=='string'||!/^3\.[0-9]+\.[0-9]+$/.test(value.pythonVersion))throw Error('simulation-result-invalid');
 const result=value.result as {schemaVersion?:unknown;metrics?:unknown;outputs?:unknown};
 if(!result||typeof result!=='object'||!['metrics,schemaVersion','metrics,outputs,schemaVersion'].includes(Object.keys(result).sort().join(','))||result.schemaVersion!==1)throw Error('simulation-result-invalid');
 let metrics:Record<string,number>;try{metrics=validateMetrics(record.input.plan.spec,result.metrics);}catch{throw Error('simulation-result-invalid');}
 const prefix=`simulation-results-v1/${record.scope.tenantId}/${record.scope.projectId}/${record.scope.workspaceId}/${record.runId}`;
 const outputs=await publishOutputs(bucket,prefix,result.outputs);
 const envelope={...(outputs.length?{outputs}:{}),schemaVersion:1,runId:record.runId,experimentId:record.experimentId,version:modelVersion(record.input.plan),parameters:record.input.parameters,seed:record.input.seed,runtimeImage:record.input.runtimeImage,pythonVersion:value.pythonVersion,metrics};
 const content=JSON.stringify(envelope),artifactSha256=await digest(content),key=`simulation-results-v1/${record.scope.tenantId}/${record.scope.projectId}/${record.scope.workspaceId}/${record.runId}/${artifactSha256}.json`;
 await bucket.put(key,content,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
 const stored=await bucket.get(key);if(!stored||stored.size>65536||await digest(await stored.text())!==artifactSha256)throw Error('simulation-result-unconfirmed');
 return {metrics,artifactSha256,...(outputs.length?{outputs}:{})};
}
