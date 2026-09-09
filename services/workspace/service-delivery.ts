import {serviceRunTask,type ServiceRunTask} from '../run/host.ts';
import {resolvedPreviewPlan,type ResolvedPreviewPlan} from '../preview/source.ts';
import {SqlServiceIntentJournal,type ServiceSourceCandidate} from './service-intents.ts';
export interface ServiceDeliveryPorts{
 resolve(source:ServiceSourceCandidate):Promise<ResolvedPreviewPlan>;
 accept(task:ServiceRunTask):Promise<unknown>;
 acceptStopped(task:ServiceRunTask):Promise<unknown>;
 stop(task:ServiceRunTask):Promise<unknown>;
 hold(promise:Promise<unknown>):void;
}
function disposeResult(raw:unknown){if(raw&&typeof raw==='object'){const dispose=Object.getOwnPropertyDescriptor(raw,Symbol.dispose)?.value;if(typeof dispose==='function')dispose.call(raw);}}
function planResult(raw:unknown){
 try{if(!raw||typeof raw!=='object'||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('invalid-service-plan-response');const clean={};for(const key of Reflect.ownKeys(raw))if(key!==Symbol.dispose)Object.defineProperty(clean,key,Object.getOwnPropertyDescriptor(raw,key)!);return resolvedPreviewPlan(clean);}
 finally{disposeResult(raw);}
}
const terminal=new Set(['cancelled','failed','stopped']);
const resolutionFailures=new Map([
 ['preview-declaration-missing','service-preview-declaration-missing'],
 ['preview-declaration-invalid','service-preview-declaration-invalid'],
 ['invalid-preview-declaration','service-preview-declaration-invalid'],
 ['preview-declaration-target-missing','service-preview-files-missing'],
 ['preview-declaration-target-invalid','service-preview-files-invalid'],
 ['invalid-preview-source','service-preview-source-invalid'],
 ['invalid-preview-revision','service-preview-source-invalid'],
 ['preview-revision-mismatch','service-preview-source-invalid'],
 ['invalid-workspace-file-archive','service-preview-source-invalid'],
] as const);
function resolutionFailure(error:unknown){
 const message=error instanceof Error?error.message:'';
 for(const [cause,code] of resolutionFailures)if(message===cause||message.endsWith(`: ${cause}`))return code;
 return null;
}
/** Validate a private Host acknowledgement before settling the outbox. The
 * disposable transport field is never persisted or treated as project data. */
function acknowledge(raw:unknown,task:ServiceRunTask,stopping:boolean){
 if(!raw||typeof raw!=='object')throw Error('invalid-service-delivery-ack');
 const value=raw as Record<string,unknown>,dispose=Object.getOwnPropertyDescriptor(raw,Symbol.dispose)?.value;
 try{
  const actual=serviceRunTask({runId:value.id,scope:value.scope,actor:value.actor,requestKey:task.requestKey,spec:value.spec});
  if(JSON.stringify(actual)!==JSON.stringify(serviceRunTask(task))||!['queued','starting','running','unknown','stopping','stopped','failed','cancelled'].includes(String(value.status)))throw Error('service-delivery-ack-conflict');
  if(stopping&&!terminal.has(String(value.status))&&!(Number.isSafeInteger(value.stopRequestedAt)&&(value.stopRequestedAt as number)>0))throw Error('service-delivery-stop-unconfirmed');
 }finally{if(typeof dispose==='function')dispose.call(raw);}
}
/** Delivers immutable Workspace intents to the existing ServiceRun Host.
 * The owning Workspace must arm its durable alarm before entering advance.
 * This engine never acquires leases or interprets application health. */
export class ServiceIntentDelivery{
 readonly #journal:SqlServiceIntentJournal;readonly #ports:ServiceDeliveryPorts;readonly #clock:()=>number;readonly #timeout:number;
 #active:Promise<number|null>|null=null;
 constructor(journal:SqlServiceIntentJournal,ports:ServiceDeliveryPorts,clock=Date.now,timeoutMs=5000){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('invalid-service-delivery-timeout');
  this.#journal=journal;this.#ports=ports;this.#clock=clock;this.#timeout=timeoutMs;
 }
 async #call<T>(work:()=>Promise<T>):Promise<T>{
  let abandoned=false;const pending=Promise.resolve().then(work);this.#ports.hold(pending.then(value=>{if(abandoned)disposeResult(value);},()=>{}));let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('service-delivery-timeout')),this.#timeout);})]);}
  catch(error){abandoned=true;throw error;}
  finally{if(timer!==undefined)clearTimeout(timer);}
 }
 advance(limit=8){if(!this.#active)this.#active=this.#advance(limit).finally(()=>{this.#active=null;});return this.#active;}
 async #advance(limit:number){
  for(const due of await this.#journal.listDue(this.#clock(),limit)){
   try{await this.#one(due.runId);}
   catch{await this.#journal.retry(due.runId,this.#clock()+5000,'service-delivery-unconfirmed');}
  }
  return this.#journal.nextWake();
 }
 async #one(id:string){
  let intent=await this.#journal.get(id);
  if(intent.status==='resolving'){
   if(this.#clock()>=intent.deliveryDeadlineAt){await this.#journal.fail(id,'service-delivery-deadline');return;}
   let plan:ResolvedPreviewPlan;
   try{plan=planResult(await this.#call(()=>this.#ports.resolve(structuredClone(intent.source))));}
   catch(error){const code=resolutionFailure(error);if(code){await this.#journal.fail(id,code);return;}throw error;}
   intent=await this.#journal.resolve(id,{runId:id,scope:intent.scope,actor:intent.actor,requestKey:intent.requestKey,spec:{plan,runtimeImage:intent.request.runtimeImage,maxDurationMs:intent.request.maxDurationMs}});
  }
  if(intent.status==='ready')intent=await this.#journal.claimDelivery(id);
  if(intent.status==='delivery-unknown'){
   // Re-read a stop that committed while claim durability was pending.
   intent=await this.#journal.get(id);const task=intent.task!;
   const stopping=intent.stopRequestedAt!==null;
   const response=await this.#call(()=>stopping?this.#ports.acceptStopped(structuredClone(task)):this.#ports.accept(structuredClone(task)));
   acknowledge(response,task,stopping);intent=await this.#journal.delivered(id);
   if(stopping&&intent.stopRequestedAt!==null){await this.#journal.stopForwarded(id);return;}
  }
  if(intent.status==='delivered'&&intent.stopRequestedAt!==null&&intent.stopForwardedAt===null){
   const response=await this.#call(()=>this.#ports.stop(structuredClone(intent.task!)));
   acknowledge(response,intent.task!,true);await this.#journal.stopForwarded(id);
  }
 }
}
