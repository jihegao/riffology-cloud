import {DurableObject} from 'cloudflare:workers';
import {SqlServiceRuntimeSupervisor} from './runtime-supervisor.ts';
import {SandboxServiceNativeBackend,serviceNativeToken,type ServiceSandboxApi} from './native.ts';
import {serviceRuntimeInput,type ServiceRuntimeInput} from './runtime-protocol.ts';
import {serviceRuntimeActorName} from './durable.ts';
import {tenantQuotaName,type TenantQuota} from '../quota/durable.ts';
import {leaseReference} from '../quota/core.ts';
import {REVISION_STORE_ACTOR} from '../turn-runtime/revision-store-client.ts';
import type {RevisionStore} from '../turn-runtime/revision-store.ts';
export interface ServiceRuntimeEnv{
 SERVICE_RUNTIME:DurableObjectNamespace<ServiceRuntime>;
 SERVICE_SANDBOX:{getByName(name:string):ServiceSandboxApi};
 REVISION_STORE:DurableObjectNamespace<RevisionStore>;
 TENANT_QUOTA:DurableObjectNamespace<TenantQuota>;
 M3_SERVICE_ENABLED?:string;
 M3_SERVICE_IMAGE?:string;
}
export async function serviceSandboxActorName(input:ServiceRuntimeInput){return 'm3-s-'+await serviceNativeToken(input);}
function leaseMatches(input:ServiceRuntimeInput,raw:ReturnType<typeof leaseReference>){return Object.keys(input.lease).length===Object.keys(raw).length&&Object.entries(input.lease).every(([key,value])=>raw[key as keyof typeof raw]===value);}
/** Private platform actor; start requires a current dispatched tenant lease.
 * Closing the start gate does not prevent observation or irreversible stop. */
export class ServiceRuntime extends DurableObject<ServiceRuntimeEnv>{
 async #input(raw:ServiceRuntimeInput){const input=serviceRuntimeInput(raw);if(!this.env.SERVICE_RUNTIME.idFromName(await serviceRuntimeActorName(input)).equals(this.ctx.id))throw Error('service-runtime-actor-scope-denied');return input;}
 async #supervisor(input:ServiceRuntimeInput){
  const sandbox=this.env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(input));
  const source={files:async(identity:ServiceRuntimeInput['spec']['plan']['identity'],receipt:ServiceRuntimeInput['spec']['plan']['revision'])=>this.env.REVISION_STORE.getByName(REVISION_STORE_ACTOR).serviceFiles(identity,receipt)};
  return new SqlServiceRuntimeSupervisor(this.ctx.storage,input.scope,new SandboxServiceNativeBackend(sandbox,source,input.spec.runtimeImage));
 }
 async start(raw:ServiceRuntimeInput){
  const input=await this.#input(raw);
  if(this.env.M3_SERVICE_ENABLED!=='true'||input.spec.runtimeImage!==this.env.M3_SERVICE_IMAGE)throw Error('service-runtime-start-disabled');
  const result=await this.env.TENANT_QUOTA.getByName(tenantQuotaName(input.scope.tenantId)).lookup(input.scope.tenantId,input.lease.operationId),lease=result?.lease;
  if(!lease||!leaseMatches(input,leaseReference(lease))||lease.status!=='dispatched'||lease.expired||input.reference.deadlineAt<=Date.now())throw Error('service-runtime-lease-denied');
  return (await this.#supervisor(input)).start(input);
 }
 async observe(raw:ServiceRuntimeInput){const input=await this.#input(raw);return (await this.#supervisor(input)).observe(input);}
 async stop(raw:ServiceRuntimeInput){const input=await this.#input(raw);return (await this.#supervisor(input)).stop(input);}
}
