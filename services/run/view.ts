import {serviceRunTask,type ServiceRunTask} from './host.ts';
import {serviceRuntimeReference,type ServiceRunRecord} from './service.ts';
import {positive,turnId} from '../turn/protocol.ts';

/** Reading a remote actor is bounded; a late reply cannot update the view. */
export async function readServiceRun(task:ServiceRunTask,read:()=>Promise<unknown>,hold:(promise:Promise<unknown>)=>void,timeoutMs=5000){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('invalid-service-view-timeout');
 let abandoned=false,timer:ReturnType<typeof setTimeout>|undefined;
 const pending=Promise.resolve().then(read);
 hold(pending.then(raw=>{
  if(abandoned&&raw&&typeof raw==='object'){
   const dispose=Object.getOwnPropertyDescriptor(raw,Symbol.dispose)?.value;if(typeof dispose==='function')dispose.call(raw);
  }
 },()=>{}));
 try{
  const raw=await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('service-view-unavailable')),timeoutMs);})]);
  return matchedServiceRun(raw,task);
 }catch{abandoned=true;throw Error('service-view-unavailable');}
 finally{if(timer!==undefined)clearTimeout(timer);}
}

/** A read acknowledgement cannot substitute another Run or frozen input. */
export function matchedServiceRun(raw:unknown,task:ServiceRunTask):ServiceRunRecord|null{
 if(raw===null)return null;
 const dispose=raw&&typeof raw==='object'?Object.getOwnPropertyDescriptor(raw,Symbol.dispose)?.value:undefined;
 try{
  if(!raw||typeof raw!=='object'||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('service-view-conflict');
  const keys=['id','kind','scope','actor','spec','status','createdAt','updatedAt','startedAt','stopRequestedAt','runtime','errorCode'];
  const descriptors=Object.getOwnPropertyDescriptors(raw);
  if(Reflect.ownKeys(descriptors).some(key=>key!==Symbol.dispose&&!keys.includes(String(key)))||keys.some(key=>!descriptors[key]?.enumerable||!Object.hasOwn(descriptors[key]!,'value')))throw Error('service-view-conflict');
  const r=raw as ServiceRunRecord;
  const actual=serviceRunTask({runId:r.id,scope:r.scope,actor:r.actor,requestKey:task.requestKey,spec:r.spec});
  if(JSON.stringify(actual)!==JSON.stringify(serviceRunTask(task))||r.kind!=='service'||!['queued','starting','running','unknown','stopping','stopped','failed','cancelled'].includes(r.status))throw Error('service-view-conflict');
  const nullableTime=(v:number|null)=>v===null?null:positive(v);
  const runtime=r.runtime===null?null:serviceRuntimeReference(r.runtime);
  if(runtime&&runtime.runId!==task.runId)throw Error('service-view-conflict');
  const createdAt=positive(r.createdAt),updatedAt=positive(r.updatedAt),startedAt=nullableTime(r.startedAt),stopRequestedAt=nullableTime(r.stopRequestedAt);
  if(updatedAt<createdAt||[startedAt,stopRequestedAt].some(at=>at!==null&&(at<createdAt||at>updatedAt))||
   (startedAt!==null&&stopRequestedAt!==null&&stopRequestedAt<startedAt)||
   ((runtime===null)!==(startedAt===null))||
   (runtime!==null&&(runtime.deadlineAt<=startedAt!||runtime.deadlineAt-startedAt!>task.spec.maxDurationMs))||
   (['starting','running','unknown','stopping','stopped'].includes(r.status)&&runtime===null)||
   (['queued','cancelled'].includes(r.status)&&runtime!==null)||
   (['queued','starting','running'].includes(r.status)&&stopRequestedAt!==null)||
   (['stopping','cancelled'].includes(r.status)&&stopRequestedAt===null))throw Error('service-view-conflict');
  return {id:actual.runId,kind:'service',scope:actual.scope,actor:actual.actor,spec:actual.spec,status:r.status,
   createdAt,updatedAt,startedAt,stopRequestedAt,runtime,errorCode:r.errorCode===null?null:turnId(r.errorCode)};
 }finally{if(typeof dispose==='function')dispose.call(raw);}
}
