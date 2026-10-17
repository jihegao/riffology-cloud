import {DurableObject} from 'cloudflare:workers';
import {SqlProjectViewCapacity} from './capacity.ts';
import {PROJECT_VIEW_CAPACITY_NAME,projectViewSessionIdentity,runtimeActorName,runtimeObject,type ProjectViewRuntimeIdentity,type ProjectViewRuntimePort} from './runtime-protocol.ts';

interface Env{
 PROJECT_VIEW_CAPACITY:DurableObjectNamespace<ProjectViewCapacity>;
 PROJECT_VIEW_RUNTIME:{getByName(name:string):Pick<ProjectViewRuntimePort,'status'>};
 PROJECT_VIEW_RUNTIME_POLICY_HASH?:string;
}
async function runtimeStatus(work:Promise<Awaited<ReturnType<ProjectViewRuntimePort['status']>>>){
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  return await Promise.race([work.then(raw=>{
   try{return {id:raw.id,status:raw.status,cleanupConfirmed:raw.cleanupConfirmed,cleanupProofId:raw.cleanupProofId};}
   finally{(raw as {[Symbol.dispose]?:()=>void}|null)?.[Symbol.dispose]?.();}
  }),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('project-view-capacity-authority-timeout')),4000);})]);
 }finally{if(timer!==undefined)clearTimeout(timer);}
}

/** Private RPC capability. No public fetch route and no automatic release alarm.
 * The original runtime supplies independently persisted terminal cleanup proof. */
export class ProjectViewCapacity extends DurableObject<Env>{
 #core:SqlProjectViewCapacity;
 constructor(ctx:DurableObjectState,env:Env){
  super(ctx,env);
  this.#core=new SqlProjectViewCapacity(ctx.storage,{status:identity=>runtimeStatus(this.env.PROJECT_VIEW_RUNTIME.getByName(runtimeActorName(identity.sessionId)).status({identity}))});
 }
 #singleton(){if(!this.env.PROJECT_VIEW_CAPACITY.idFromName(PROJECT_VIEW_CAPACITY_NAME).equals(this.ctx.id))throw Error('project-view-capacity-actor-denied');}
 async acquire(input:{identity:ProjectViewRuntimeIdentity;expiresAt:number}){
  this.#singleton();
  runtimeObject(input,['identity','expiresAt']);const identity=projectViewSessionIdentity(input.identity);
  const pin=this.env.PROJECT_VIEW_RUNTIME_POLICY_HASH;
  if(typeof pin!=='string'||!/^[a-f0-9]{64}$/.test(pin)||identity.policyHash!==pin)throw Error('project-view-capacity-policy-denied');
  await this.#core.acquire({identity,expiresAt:input.expiresAt});
 }
 async release(input:{identity:ProjectViewRuntimeIdentity;proof:{cleanupConfirmed:true;proofId:string}}){this.#singleton();await this.#core.release(input);}
}
