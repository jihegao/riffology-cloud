import {DurableObject} from 'cloudflare:workers';
import {ServiceRunHost,serviceRunTask,serviceRunActorName,type ServiceRunTask} from './host.ts';
import {tenantQuotaName,type TenantQuota} from '../quota/durable.ts';
import {serviceNativeToken} from './native.ts';
import {serviceRuntimeObservation,type ServiceRuntimeInput,type ServiceRuntimePort} from './runtime-protocol.ts';
import type {ServiceQuotaPort} from './coordinator.ts';
export interface ServiceRunEnv{
 SERVICE_RUN:DurableObjectNamespace<ServiceRun>;
 TENANT_QUOTA:DurableObjectNamespace<TenantQuota>;
 SERVICE_RUNTIME:{getByName(name:string):ServiceRuntimePort};
 M3_SERVICE_ENABLED?:string;
}
export async function serviceRuntimeActorName(input:ServiceRuntimeInput){return 'm3-runtime-'+await serviceNativeToken(input);}
/** Private DO entrypoint. Workspace/Gateway must authenticate before selecting
 * a Run. Runtime and Quota bindings must never be forwarded to project code. */
export class ServiceRun extends DurableObject<ServiceRunEnv>{
 #host:ServiceRunHost;
 constructor(ctx:DurableObjectState,env:ServiceRunEnv){
  super(ctx,env);
  const quota:ServiceQuotaPort={
   acquire:request=>env.TENANT_QUOTA.getByName(tenantQuotaName(request.tenantId)).acquire(request),
   dispatch:ref=>env.TENANT_QUOTA.getByName(tenantQuotaName(ref.tenantId)).dispatch(ref),
   markUnknown:ref=>env.TENANT_QUOTA.getByName(tenantQuotaName(ref.tenantId)).markUnknown(ref),
   confirmStopped:(ref,proof)=>env.TENANT_QUOTA.getByName(tenantQuotaName(ref.tenantId)).confirmStopped(ref,proof),
   lookup:async operationId=>{const task=serviceRunTask(await ctx.storage.get('m3:service-task'));return env.TENANT_QUOTA.getByName(tenantQuotaName(task.scope.tenantId)).lookup(task.scope.tenantId,operationId);},
  };
  const runtime=(method:keyof ServiceRuntimePort)=>async(input:ServiceRuntimeInput)=>{
   const result=await env.SERVICE_RUNTIME.getByName(await serviceRuntimeActorName(input))[method](input);
   // Workerd owns a disposable top-level RPC result. Strip only that known
   // transport member; retain all other descriptors for strict core validation.
   const descriptors=Object.getOwnPropertyDescriptors(result),dispose=Object.getOwnPropertyDescriptor(result,Symbol.dispose)?.value;
   try{if(Object.getPrototypeOf(result)!==Object.prototype)throw Error('invalid-service-rpc-result');const data={};for(const key of Reflect.ownKeys(descriptors))if(key!==Symbol.dispose)Object.defineProperty(data,key,descriptors[key as keyof typeof descriptors]!);return serviceRuntimeObservation(data,input,Date.now());}
   finally{if(typeof dispose==='function')dispose.call(result);}
  };
  this.#host=new ServiceRunHost(ctx.storage,{quota,runtime:{start:runtime('start'),observe:runtime('observe'),stop:runtime('stop')},hold:p=>ctx.waitUntil(p),owns:async task=>env.SERVICE_RUN.idFromName(await serviceRunActorName(task)).equals(ctx.id)});
 }
 accept(task:ServiceRunTask){if(this.env.M3_SERVICE_ENABLED!=='true')throw Error('service-run-disabled');return this.#host.accept(task);}
 acceptStopped(task:ServiceRunTask){return this.#host.acceptStopped(task);}
 archiveQuiescence(){return this.#host.archiveQuiescence();}
 snapshot(){return this.#host.snapshot();}
 stop(){return this.#host.stop();}
 async alarm(){await this.#host.alarm();}
}
