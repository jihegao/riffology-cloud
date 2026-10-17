import {DurableObject} from 'cloudflare:workers';
import {ProjectViewRuntimeCore,type ProjectViewNativePort,type ProjectViewNativeSession,type ProjectViewNativeFence} from './runtime-core.ts';
import {createProjectViewRuntimePipe,PROJECT_VIEW_BROWSER_PROGRAM} from './runtime-pipe.mjs';
import {PROJECT_VIEW_CAPACITY_NAME,projectViewRuntimeIdentity,runtimeActorName,runtimeObject,type ProjectViewCapacityPort,type ProjectViewRuntimeCommand,type ProjectViewRuntimeIdentity,type ProjectViewRuntimeStart,type ProjectViewRuntimePort} from './runtime-protocol.ts';
import {actor,turnId,type TurnActor} from '../turn/protocol.ts';
import {startProjectViewExec} from './exec-deadline.ts';
import {PROJECT_VIEW_PREFLIGHT_PROGRAM,readProjectViewPreflight} from './runtime-preflight.mjs';

export interface ProjectViewRuntimeEnv{
 PROJECT_VIEW_RUNTIME:DurableObjectNamespace<ProjectViewRuntime>;
 PROJECT_VIEW_CAPACITY:{getByName(name:string):ProjectViewCapacityPort};
 PROJECT_VIEW_RUNTIME_POLICY_HASH?:string;
 PROJECT_VIEW_RUNTIME_IMAGE?:string;
 PROJECT_VIEW_RUNTIME_CONTEXT_RECEIPT_SHA256?:string;
}
function imageDigest(value:unknown){if(typeof value!=='string'||! /^(?:sha256:|[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:)[a-f0-9]{64}$/.test(value))throw Error('project-view-runtime-image-denied');return value.slice(-64);}

/** Dedicated session container. No public fetch handler, HTTP listener, ambient
 * credentials, SDK auto-start or reuse of the Pi/project-tool container. */
export class ProjectViewRuntime extends DurableObject<ProjectViewRuntimeEnv> implements ProjectViewRuntimePort{
 readonly #core:ProjectViewRuntimeCore;
 constructor(ctx:DurableObjectState,env:ProjectViewRuntimeEnv){
  super(ctx,env);
  const native:ProjectViewNativePort={
   start:(input,fence)=>this.#startNative(input,fence),
   running:async()=>{if(!ctx.container)throw Error('project-view-runtime-container-required');return ctx.container.running;},
   destroy:async()=>{if(!ctx.container)throw Error('project-view-runtime-container-required');await ctx.container.destroy();},
  };
  const capacity:ProjectViewCapacityPort={
   acquire:input=>{if(!env.PROJECT_VIEW_CAPACITY)throw Error('project-view-runtime-capacity-required');return env.PROJECT_VIEW_CAPACITY.getByName(PROJECT_VIEW_CAPACITY_NAME).acquire(input);},
   release:input=>{if(!env.PROJECT_VIEW_CAPACITY)throw Error('project-view-runtime-capacity-required');return env.PROJECT_VIEW_CAPACITY.getByName(PROJECT_VIEW_CAPACITY_NAME).release(input);},
  };
  this.#core=new ProjectViewRuntimeCore(ctx.storage,native,capacity,{waitUntil:work=>ctx.waitUntil(work)});
  ctx.waitUntil(this.#core.recover().catch(()=>{}));
 }
 #identity(raw:unknown){
  const identity=projectViewRuntimeIdentity(raw);
  if(!this.env.PROJECT_VIEW_RUNTIME.idFromName(runtimeActorName(identity.sessionId)).equals(this.ctx.id))throw Error('project-view-runtime-actor-denied');return identity;
 }
 #policy(identity:ProjectViewRuntimeIdentity){
  if(!this.env.PROJECT_VIEW_RUNTIME_POLICY_HASH||! /^[a-f0-9]{64}$/.test(this.env.PROJECT_VIEW_RUNTIME_POLICY_HASH)||identity.policyHash!==this.env.PROJECT_VIEW_RUNTIME_POLICY_HASH)throw Error('project-view-runtime-policy-denied');
  imageDigest(this.env.PROJECT_VIEW_RUNTIME_IMAGE);
  if(!this.env.PROJECT_VIEW_RUNTIME_CONTEXT_RECEIPT_SHA256||! /^[a-f0-9]{64}$/.test(this.env.PROJECT_VIEW_RUNTIME_CONTEXT_RECEIPT_SHA256))throw Error('project-view-runtime-context-receipt-denied');
 }
 async #startNative(input:ProjectViewRuntimeStart,fence:ProjectViewNativeFence):Promise<ProjectViewNativeSession>{
  this.#identity(input.identity);this.#policy(input.identity);
  fence.beforeWrite('init');
  const container=this.ctx.container;if(!container||container.running)throw Error('project-view-runtime-container-not-empty');
  // start() itself returns before assignment. Core persists and guards this
  // one start intent; exec never auto-starts a stopped container.
  container.start({entrypoint:['node','-e','process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)'],enableInternet:false,env:{}});
  this.ctx.waitUntil(container.monitor().then(()=>this.#core.close({identity:input.identity,reason:'container-exited'}),()=>this.#core.close({identity:input.identity,reason:'container-failed'})).catch(()=>{}));
  await container.setInactivityTimeout(10_000);
  fence.beforeWrite('init');
  // Default scheduling preserves the non-root capability boundary. inspect's
  // image is only a start reference and may be empty; the immutable app/version
  // image pin is checked by release control-plane readback, not attested here.
  // This fixed, credential-free program checks baked inputs before any project
  // bytes are sent to a browser process.
  const preflight=await startProjectViewExec(signal=>container.exec(['node','--input-type=module','-e',PROJECT_VIEW_PREFLIGHT_PROGRAM,this.env.PROJECT_VIEW_RUNTIME_CONTEXT_RECEIPT_SHA256!],{stdout:'pipe',stderr:'ignore',cwd:'/opt/viewer',user:'10001:10001',env:{},signal}),Math.min(input.expiresAt,Date.now()+15_000));
  try{
   const actual=await container.inspect();
   if(!actual||actual.image&&imageDigest(actual.image)!==imageDigest(this.env.PROJECT_VIEW_RUNTIME_IMAGE))throw Error('project-view-runtime-image-mismatch');
   await readProjectViewPreflight(preflight.process,this.env.PROJECT_VIEW_RUNTIME_CONTEXT_RECEIPT_SHA256!);
  }finally{preflight.dispose();}
  fence.beforeWrite('init');
  const timed=await startProjectViewExec(signal=>container.exec(['node','--input-type=module','-e',PROJECT_VIEW_BROWSER_PROGRAM],{stdin:'pipe',stdout:'pipe',stderr:'ignore',cwd:'/opt/viewer',user:'10001:10001',env:{},signal}),input.expiresAt);
  try{
   fence.beforeWrite('init');
   const pipe=createProjectViewRuntimePipe(timed.process,input,fence);await pipe.ready;
   let closed=false,capturing=false;
   const timer=setInterval(()=>{
    if(closed||capturing)return;capturing=true;
    const work=pipe.capture().catch(()=>this.#core.close({identity:input.identity,reason:'capture-failed'})).finally(()=>{capturing=false;});this.ctx.waitUntil(work);
   },500);
   const dispose=()=>{closed=true;clearInterval(timer);timed.dispose();};
   void pipe.finished.then(dispose,dispose);
   this.ctx.waitUntil(pipe.finished.catch(()=>{}));
   return {send:command=>pipe.send(command),poll:()=>pipe.poll(),finished:pipe.finished,async close(){dispose();await pipe.close();}};
  }catch(error){timed.dispose();throw error;}
 }
 async start(input:ProjectViewRuntimeStart){this.#policy(this.#identity(input.identity));return this.#core.start(input);}
 async command(input:{identity:ProjectViewRuntimeIdentity;command:ProjectViewRuntimeCommand}){
  const identity=this.#identity(input.identity);
  try{this.#policy(identity);}catch{return this.#core.close({identity,reason:'policy-stopped'});}
  return this.#core.command(input);
 }
 async close(input:{identity:ProjectViewRuntimeIdentity;reason:string}){this.#identity(input.identity);return this.#core.close(input);}
 async status(input:{identity:ProjectViewRuntimeIdentity}){this.#identity(input.identity);return this.#core.status(input);}
 async lookup(input:{sessionId:string;actor:TurnActor;workspaceId:string}){
  runtimeObject(input,['sessionId','actor','workspaceId']);const sessionId=turnId(input.sessionId);actor(input.actor);turnId(input.workspaceId);
  if(!this.env.PROJECT_VIEW_RUNTIME.idFromName(runtimeActorName(sessionId)).equals(this.ctx.id))throw Error('project-view-runtime-actor-denied');
  return this.#core.lookup(input);
 }
 async alarm(){await this.#core.alarm();}
}
