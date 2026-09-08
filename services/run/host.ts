import {scope,actor,turnId,turnDigest,sameScope,type TurnScope,type TurnActor} from '../turn/protocol.ts';
import {serviceRunSpec,SqlServiceRunJournal,type ServiceRunSpec,type ServiceRunRecord} from './service.ts';
import {ServiceRunCoordinator,type ServiceQuotaPort} from './coordinator.ts';
import type {ServiceRuntimePort} from './runtime-protocol.ts';
export type ServiceRunTask={runId:string;scope:TurnScope;actor:TurnActor;requestKey:string;spec:ServiceRunSpec};
export function serviceRunTask(raw:unknown):ServiceRunTask{
 if(!raw||typeof raw!=='object'||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('invalid-service-run-task');const d=Object.getOwnPropertyDescriptors(raw),keys=['runId','scope','actor','requestKey','spec'];
 if(Reflect.ownKeys(d).length!==keys.length||keys.some(key=>!Object.hasOwn(d,key)||!Object.hasOwn(d[key]!,'value')||!d[key]!.enumerable))throw Error('invalid-service-run-task');
 const v=raw as Record<string,unknown>,task={runId:turnId(v.runId),scope:scope(v.scope),actor:actor(v.actor),requestKey:turnId(v.requestKey),spec:serviceRunSpec(v.spec)};if(!sameScope(task.scope,task.spec.plan.identity.scope))throw Error('service-run-task-scope-denied');return task;
}
export async function serviceRunActorName(raw:Pick<ServiceRunTask,'scope'|'runId'>){return 'm3-run-'+(await turnDigest({scope:scope(raw.scope),runId:turnId(raw.runId)})).slice(0,52);}
const TASK='m3:service-task';
const TERMINAL=new Set(['failed','stopped','cancelled']);
export type ServiceRunHostPorts={quota:ServiceQuotaPort;runtime:ServiceRuntimePort;hold(p:Promise<unknown>):void;owns(task:ServiceRunTask):Promise<boolean>};
/** One Run per private actor. Persist task and initial wakeup atomically before
 * returning acceptance, so even a crash before journal creation is recoverable. */
export class ServiceRunHost{
 readonly #storage:DurableObjectStorage;readonly #ports:ServiceRunHostPorts;readonly #clock:()=>number;
 #active:Promise<ServiceRunRecord|null>|null=null;
 constructor(storage:DurableObjectStorage,ports:ServiceRunHostPorts,clock=Date.now){this.#storage=storage;this.#ports=ports;this.#clock=clock;}
 async #task(){const raw=await this.#storage.get<unknown>(TASK);if(raw===undefined)return null;const task=serviceRunTask(raw);if(!await this.#ports.owns(task))throw Error('service-run-actor-scope-denied');return task;}
 #journal(task:ServiceRunTask){return new SqlServiceRunJournal(this.#storage,task.scope,this.#clock,()=>task.runId);}
 #coordinator(journal:SqlServiceRunJournal){return new ServiceRunCoordinator(this.#storage,journal,this.#ports.quota,this.#ports.runtime,p=>this.#ports.hold(p),this.#clock);}
 async #arm(at:number){await this.#storage.transaction(async tx=>{const current=await tx.getAlarm();await tx.setAlarm(current!==null&&current>this.#clock()?Math.min(current,at):at);});await this.#storage.sync();}
 async accept(raw:ServiceRunTask){
  const task=serviceRunTask(raw);if(!await this.#ports.owns(task))throw Error('service-run-actor-scope-denied');
  await this.#storage.transaction(async tx=>{const prior=await tx.get<unknown>(TASK);if(prior!==undefined&&JSON.stringify(serviceRunTask(prior))!==JSON.stringify(task))throw Error('service-run-task-conflict');await tx.put(TASK,task);await tx.setAlarm(this.#clock()+1);});await this.#storage.sync();
  return this.#journal(task).create(task.actor,task.requestKey,task.spec);
 }
 async snapshot(){const task=await this.#task();if(!task)return null;return this.#journal(task).create(task.actor,task.requestKey,task.spec);}
 async stop(){const task=await this.#task();if(!task)throw Error('service-run-not-found');await this.#arm(this.#clock()+1);const journal=this.#journal(task);await journal.create(task.actor,task.requestKey,task.spec);return journal.requestStop(task.runId);}
 alarm(){if(!this.#active)this.#active=this.#advance().finally(()=>{this.#active=null;});return this.#active;}
 async #advance():Promise<ServiceRunRecord|null>{
  // Re-arm before any runtime effect. Unknown work retains both quota and a
  // durable cleanup wakeup; a closed browser never owns this loop.
  await this.#arm(this.#clock()+5000);
  const task=await this.#task();if(!task){await this.#storage.deleteAlarm();return null;}
  const journal=this.#journal(task);await journal.create(task.actor,task.requestKey,task.spec);const coordinator=this.#coordinator(journal),record=await coordinator.reconcile(task.runId),state=await coordinator.state(task.runId);
  const settled=TERMINAL.has(record.status)&&(!state||state.denied||state.released||state.acquisitionClosed);
  if(settled){await this.#storage.deleteAlarm();await this.#storage.sync();return record;}
  const now=this.#clock(),interval=record.status==='running'?10000:5000,deadline=record.runtime?.deadlineAt??state?.request.deadlineAt;
  await this.#arm(deadline&&deadline>now?Math.min(now+interval,deadline):now+interval);return record;
 }
}
