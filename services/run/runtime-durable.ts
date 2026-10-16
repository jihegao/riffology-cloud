import {ObserverCancellation,type ObserverCancellationPort} from '../preview/observer-cancellation.ts';
import {createObserverFetchSession} from '../preview/observer-fetch.ts';
import {observerRuntimeRequest,observerRuntimePublicRequest,type ObserverRuntimeRequest} from '../preview/observer-runtime.ts';
import type {ObserverHttpPolicy} from '../preview/observer-http.ts';
import {serviceHttpRequest} from '../preview/http.ts';
import {privateWebSocketRequest,readPrivateWebSocketRequest} from '../preview/websocket-protocol.ts';
import {connectPreviewWebSocket,boundedWebSocketHandshake} from '../preview/websocket-connect.ts';
import {DurableObject} from 'cloudflare:workers';
import {SqlServiceRuntimeSupervisor} from './runtime-supervisor.ts';
import {SandboxServiceNativeBackend,serviceNativeToken,type ServiceSandboxApi} from './native.ts';
import {SqlServiceSandboxRelease,type ServiceSandboxReleasePort} from './sandbox-release.ts';
import {serviceRuntimeInput,type ServiceRuntimeInput} from './runtime-protocol.ts';
import {serviceRuntimeActorName} from './durable.ts';
import {tenantQuotaName,type TenantQuota} from '../quota/durable.ts';
import {leaseReference} from '../quota/core.ts';
import {turnDigest} from '../turn/protocol.ts';
import {revisionStoreActorName} from '../turn-runtime/revision-store-client.ts';
import type {RevisionStore} from '../turn-runtime/revision-store.ts';
export interface ServiceRuntimeEnv{
 SERVICE_RUNTIME:DurableObjectNamespace<ServiceRuntime>;
 SERVICE_SANDBOX:{getByName(name:string):ServiceSandboxApi&{destroy():Promise<void>;releaseState():Promise<{running:boolean}>;forwardHttp?(request:Request,deadlineAt:number):Promise<Response>;forwardObserverHttp?(request:Request,policy:ObserverHttpPolicy,deadlineAt:number,cancellation:ObserverCancellationPort):Promise<Response>;fetch?(request:Request):Promise<Response>}};
 REVISION_STORE:DurableObjectNamespace<RevisionStore>;
 TENANT_QUOTA:DurableObjectNamespace<TenantQuota>;
 M3_SERVICE_ENABLED?:string;
 M3_PREVIEW_ENABLED?:string;
 M3_PREVIEW_WS_ENABLED?:string;
 M3_OBSERVER_ENABLED?:string;
 M3_SERVICE_IMAGE?:string;
}
export async function serviceSandboxActorName(input:ServiceRuntimeInput){return 'm3-s-'+await serviceNativeToken(input);}
function leaseMatches(input:ServiceRuntimeInput,raw:ReturnType<typeof leaseReference>){return Object.keys(input.lease).length===Object.keys(raw).length&&Object.entries(input.lease).every(([key,value])=>raw[key as keyof typeof raw]===value);}
/** Private platform actor; start requires a current dispatched tenant lease.
 * Closing the start gate does not prevent observation or irreversible stop. */
export class ServiceRuntime extends DurableObject<ServiceRuntimeEnv>{
 readonly #requests=new Set<AbortController>();
 readonly #webSockets=new Set<AbortController>();
 #releaseTail:Promise<unknown>=Promise.resolve();
 async fetch(request:Request):Promise<Response>{
  let controller:AbortController|undefined;
  try{
   if(this.env.M3_PREVIEW_ENABLED!=='true'||this.env.M3_PREVIEW_WS_ENABLED!=='true')throw Error('service-ws-disabled');
   const incoming=readPrivateWebSocketRequest(request,'runtime'),input=await this.#input(incoming.input as ServiceRuntimeInput);
   if(this.#webSockets.size>=8)throw Error('service-ws-capacity');
   controller=new AbortController();this.#webSockets.add(controller);this.#requests.add(controller);
   const held=controller;
   return await boundedWebSocketHandshake(held,async()=>{
   const supervisor=await this.#supervisor(input),sandbox=this.env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(input));
   if(!sandbox.fetch)throw Error('service-ws-not-configured');
   const authorize=async()=>{
    if(this.env.M3_PREVIEW_ENABLED!=='true'||this.env.M3_PREVIEW_WS_ENABLED!=='true')throw Error('service-ws-disabled');
    const result=await this.env.TENANT_QUOTA.getByName(tenantQuotaName(input.scope.tenantId)).lookup(input.scope.tenantId,input.lease.operationId),lease=result?.lease;
    if(!lease||!leaseMatches(input,leaseReference(lease))||lease.status!=='dispatched'||lease.expired)throw Error('service-runtime-lease-denied');
    await supervisor.requireForward(input);return {expiresAt:input.reference.deadlineAt};
   };
   return await connectPreviewWebSocket(incoming.request,{authorize,signal:held.signal,finish:()=>{this.#requests.delete(held);this.#webSockets.delete(held);},connect:clean=>supervisor.forward(input,()=>sandbox.fetch!(privateWebSocketRequest('sandbox',{deadlineAt:input.reference.deadlineAt},clean)))});
   });
  }catch{if(controller){controller.abort();this.#requests.delete(controller);this.#webSockets.delete(controller);}return new Response('preview unavailable',{status:403});}
 }
 async #input(raw:ServiceRuntimeInput){const input=serviceRuntimeInput(raw);if(!this.env.SERVICE_RUNTIME.idFromName(await serviceRuntimeActorName(input)).equals(this.ctx.id))throw Error('service-runtime-actor-scope-denied');return input;}
 async #supervisor(input:ServiceRuntimeInput){
  const sandbox=this.env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(input));
  const source={files:async(source:ServiceRuntimeInput['spec']['plan']['source'])=>{const scope=source.kind==='saved-turn'?source.identity.scope:source.reference.scope;return this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).serviceFiles(source);}};
  return new SqlServiceRuntimeSupervisor(this.ctx.storage,input.scope,new SandboxServiceNativeBackend(sandbox,source,input.spec.runtimeImage),Date.now,async(_,context)=>this.#release(input,context));
 }
 async #release(input?:ServiceRuntimeInput,context?:{kind:'native-stop'|'platform-destroy';fencedAt:number;authorizedAt:number|null}){
  const resolver=async(current:ServiceRuntimeInput):Promise<ServiceSandboxReleasePort>=>{
   const sandbox=this.env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(current));
   return {destroy:()=>sandbox.destroy(),running:async()=>{const state=await sandbox.releaseState();if(!state||typeof state!=='object'||Object.keys(state).join(',')!=='running'||typeof state.running!=='boolean')throw Error('invalid-service-sandbox-release-state');return state.running;}};
  };
  const work=this.#releaseTail.catch(()=>{}).then(async()=>{
   const release=new SqlServiceSandboxRelease(this.ctx.storage,resolver),complete=input?await release.begin(input):await release.reconcile();
   if(!complete||!input||context?.kind!=='platform-destroy'||context.authorizedAt===null)return null;
   const row=await release.snapshot(),confirmedAbsentAt=row?.completed_at;
   if(confirmedAbsentAt===null||confirmedAbsentAt===undefined||confirmedAbsentAt<context.authorizedAt)throw Error('invalid-service-platform-release-proof');
   const confirmationId='platform-'+(await turnDigest({schemaVersion:1,purpose:'service-platform-destroy',input,fencedAt:context.fencedAt,authorizedAt:context.authorizedAt,confirmedAbsentAt})).slice(0,52);
   return {reference:structuredClone(input.reference),scope:structuredClone(input.scope),status:'stopped' as const,stop:{reference:structuredClone(input.reference),scope:structuredClone(input.scope),confirmationId,observedAt:confirmedAbsentAt,fenced:true as const}};
  });this.#releaseTail=work;return work;
 }
 async alarm(){await this.#release();}
 async start(raw:ServiceRuntimeInput){
  const input=await this.#input(raw);
  if(this.env.M3_SERVICE_ENABLED!=='true'||input.spec.runtimeImage!==this.env.M3_SERVICE_IMAGE)throw Error('service-runtime-start-disabled');
  const result=await this.env.TENANT_QUOTA.getByName(tenantQuotaName(input.scope.tenantId)).lookup(input.scope.tenantId,input.lease.operationId),lease=result?.lease;
  if(!lease||!leaseMatches(input,leaseReference(lease))||lease.status!=='dispatched'||lease.expired||input.reference.deadlineAt<=Date.now())throw Error('service-runtime-lease-denied');
  return (await this.#supervisor(input)).start(input);
 }
 /** Dedicated private Observer path; only Workspace may supply this descriptor.
  * Its scoped target checks do not replace this runtime's lease/stop checks. */
 async forwardObserverHttp(raw:ObserverRuntimeRequest,request:Request,cancellation:ObserverCancellationPort):Promise<Response>{
  if(!cancellation||typeof cancellation.cancelled!=='function')throw Error('observer-cancellation-required');
  const descriptor=observerRuntimeRequest(raw),input=await this.#input(descriptor.runtime);
  if(this.env.M3_PREVIEW_ENABLED!=='true'||this.env.M3_OBSERVER_ENABLED!=='true')throw Error('observer-runtime-disabled');
  const publicRequest=observerRuntimePublicRequest(request,descriptor.policy),supervisor=await this.#supervisor(input);
  const sandbox=this.env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(input));
  if(!sandbox.forwardObserverHttp)throw Error('observer-runtime-not-configured');
  const controller=new AbortController();this.#requests.add(controller);
  const abort=()=>controller.abort();request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
  const authorize=async()=>{
    if(this.env.M3_PREVIEW_ENABLED!=='true'||this.env.M3_OBSERVER_ENABLED!=='true')throw Error('observer-runtime-disabled');
    const found=await this.env.TENANT_QUOTA.getByName(tenantQuotaName(input.scope.tenantId)).lookup(input.scope.tenantId,input.lease.operationId),lease=found?.lease;
    if(!lease||!leaseMatches(input,leaseReference(lease))||lease.status!=='dispatched'||lease.expired)throw Error('observer-runtime-lease-denied');
    await supervisor.requireForward(input);return {expiresAt:Math.min(descriptor.deadlineAt,input.reference.deadlineAt)};
  };
  let session:ReturnType<typeof createObserverFetchSession>|undefined;
  try{session=createObserverFetchSession(descriptor.policy,{
   authorize,
   forward:(clean,signal)=>supervisor.forward(input,()=>{
    if(signal.aborted)throw Error('observer-cancelled');
    return sandbox.forwardObserverHttp!(clean,descriptor.policy,descriptor.deadlineAt,new ObserverCancellation(async()=>{if(signal.aborted||await cancellation.cancelled())return true;await authorize();return signal.aborted;}));
   }),
  },{deadlineAt:descriptor.deadlineAt,signal:controller.signal});
  return await session.fetch(publicRequest);}
  finally{session?.close();controller.abort();request.signal.removeEventListener('abort',abort);this.#requests.delete(controller);}
 }
 async forwardHttp(raw:ServiceRuntimeInput,request:Request):Promise<Response>{
  const input=await this.#input(raw);
  if(this.env.M3_PREVIEW_ENABLED!=='true')throw Error('service-forward-disabled');
  const clean=await serviceHttpRequest(request),supervisor=await this.#supervisor(input);
  const sandbox=this.env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(input));
  if(!sandbox.forwardHttp)throw Error('service-forward-not-configured');
  const result=await this.env.TENANT_QUOTA.getByName(tenantQuotaName(input.scope.tenantId)).lookup(input.scope.tenantId,input.lease.operationId),lease=result?.lease;
  if(!lease||!leaseMatches(input,leaseReference(lease))||lease.status!=='dispatched'||lease.expired||input.reference.deadlineAt<=Date.now())throw Error('service-runtime-lease-denied');
  const controller=new AbortController(),abort=()=>controller.abort();this.#requests.add(controller);
  const aborted=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('service-forward-aborted')),{once:true}));
  const timer=setTimeout(abort,Math.max(1,Math.min(15000,input.reference.deadlineAt-Date.now())));
  request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
  const finish=()=>{clearTimeout(timer);request.signal.removeEventListener('abort',abort);this.#requests.delete(controller);};
  controller.signal.addEventListener('abort',finish,{once:true});if(controller.signal.aborted)finish();
  let received:Response|undefined;
  try{
   const pending=supervisor.forward(input,()=>{if(controller.signal.aborted)throw Error('service-forward-aborted');return sandbox.forwardHttp!(clean,Math.min(Date.now()+15000,input.reference.deadlineAt));}).then(response=>{if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw Error('service-forward-aborted');}return response;});
   const response=await Promise.race([pending,aborted]);received=response;
   await supervisor.requireForward(input);
   if(controller.signal.aborted)throw Error('service-forward-aborted');
   if(!response.body){finish();return response;}
   const reader=response.body.getReader();let bytes=0;
   const stream=new ReadableStream<Uint8Array>({
    async pull(out){try{
     await supervisor.requireForward(input);
     if(controller.signal.aborted)throw Error('service-forward-aborted');
     const item=await Promise.race([reader.read(),aborted]);
     await supervisor.requireForward(input);
     if(controller.signal.aborted)throw Error('service-forward-aborted');
     if(item.done){finish();out.close();return;}
     bytes+=item.value.byteLength;if(bytes>8388608)throw Error('service-forward-response-too-large');out.enqueue(item.value);
    }catch(error){controller.abort();finish();void reader.cancel().catch(()=>{});out.error(error);}},
    cancel(){controller.abort();finish();return reader.cancel();},
   });
   return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(error){controller.abort();finish();void received?.body?.cancel().catch(()=>{});throw error;}
 }
 async observe(raw:ServiceRuntimeInput){const input=await this.#input(raw);return (await this.#supervisor(input)).observe(input);}
 async stop(raw:ServiceRuntimeInput){const input=await this.#input(raw);for(const request of this.#requests)request.abort();return (await this.#supervisor(input)).stop(input);}
}
