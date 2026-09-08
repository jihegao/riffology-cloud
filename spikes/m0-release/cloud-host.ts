import { DurableObject } from 'cloudflare:workers';
import { Sandbox, getSandbox } from '@cloudflare/sandbox';
import runtimeSource from '../../services/runtime/release-probe.mjs';
import { hasProbeAuthorization } from '../m0-cloud/auth.ts';
import { R2Blobs, commitCheckpoint, currentCheckpoint } from '../m0-storage/adapters.ts';
import { restoreCheckpoint, saveCheckpoint, sha256 } from '../m0-storage/checkpoint.ts';
import { waitForEffect, EffectDeadlineError } from '../m0-recovery/bounded-effect.ts';
import { untilAbort } from '../m0-model-proxy/policy.ts';
import { admitCounter, PHASES, RELEASE_ORIGIN, RELEASE_RUN, requirePhaseRelease } from './cloud-policy.ts';
import type { CounterReport, ReleasePhase, WorkerRelease } from './cloud-policy.ts';

type VM='old'|'new'|'fault'|'rollback';
type Env={M0_PROBE_TOKEN:string;CHECKPOINTS:R2Bucket;ReleaseSandbox:DurableObjectNamespace<ReleaseSandbox>;HOST:DurableObjectNamespace<ReleaseCoordinator>};
type PhaseRecord={phase:ReleasePhase;release:WorkerRelease;startedAt:number;finishedAt:number|null;status:'running'|'completed'|'unknown';error:string|null};
type StartupFailureReceipt={failed:boolean;state:Awaited<ReturnType<Sandbox<Env>['getState']>>|null;businessDispatches:0;
 fault:'entrypoint-exit-42-before-readiness';expectedExitCode:42;observedExitCode:number|null;
 exitEvidence:'container-state'|'container-start-monitor'|null;outcome:'confirmed'|'unconfirmed'|'unexpected-readiness';
 startupIssued:boolean;readinessConfirmed:boolean;startedAt:number;finishedAt:number};
const ROOT='/workspace/m0-release', SOURCE='/workspace/release-probe.mjs',INPUT='/workspace/release-input.json',HOLD_INPUT='/workspace/release-hold-input.json';
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
export class ReleaseSandbox extends Sandbox<Env>{
 override enableInternet=false;override envVars={};override sleepAfter='180s';
 override async onStop(params?:Parameters<Sandbox<Env>['onStop']>[0]){
  // This is the callback observation time, not an invented platform signal or
  // process-exit timestamp. Persist only bounded fields before SDK cleanup.
  const observedAt=Date.now();
  const exitCode=Number.isSafeInteger(params?.exitCode)&&params!.exitCode>=0&&params!.exitCode<=255?params!.exitCode:null;
  const reason=params?.reason==='exit'||params?.reason==='runtime_signal'?params.reason:null;
  const safeParams=exitCode!==null&&reason!==null?{exitCode,reason}:undefined;
  try{this.ctx.storage.kv.put('m0:release:last-stop',{observedAt,exitCode,reason,paramsValid:safeParams!==undefined});await this.ctx.storage.sync();}
  finally{await super.onStop(safeParams);}
 }
 async releaseLifecycle(){
  // getState() reads Container DO state. No Sandbox client/RPC call here:
  // observing a stopped instance must not start its replacement.
  const state=await this.getState();
  const lastStop=this.ctx.storage.kv.get<{observedAt:number;exitCode:number|null;reason:'exit'|'runtime_signal'|null;paramsValid:boolean}>('m0:release:last-stop')??null;
  return {state,lastStop};
 }
 async fixedStartupFailure():Promise<StartupFailureReceipt>{
  // An unknown startup outcome is never retried, including after a DO restart.
  const key='m0:release:startup-failure',startedAt=Date.now();
  this.ctx.storage.transactionSync(()=>{if(this.ctx.storage.kv.get(key))throw Error('startup-never-replay');this.ctx.storage.kv.put(key,{startedAt,status:'attempted'});});
  await this.ctx.storage.sync();
  let state:StartupFailureReceipt['state']=null,observedExitCode:number|null=null;
  let startupIssued=false,readinessConfirmed=false,exitEvidence:StartupFailureReceipt['exitEvidence']=null;
  try{
   state=await this.getState();
   // Startup overrides are ignored on a running instance; only a fresh VM can
   // establish that this exact entrypoint, rather than an old service, ran.
   if(state.status!=='stopped'||this.ctx.container?.running)throw Error('startup-requires-fresh-instance');
   startupIssued=true;
   await this.startAndWaitForPorts({ports:[3000],startOptions:{entrypoint:['/bin/sh','-c','exit 42'],enableInternet:false,envVars:{}},cancellationOptions:{instanceGetTimeoutMS:15000,portReadyTimeoutMS:10000}});
   readinessConfirmed=true;
  }catch(error){
   // This exact error is emitted by the installed Containers start monitor
   // only after it has observed the process's numeric exit code. Do not treat
   // an arbitrary transport/readiness failure as the injected fault.
   const match=error instanceof Error?/^Container exited before we could determine the container health, exit code: (-?\d+)$/.exec(error.message):null;
   if(match){const code=Number(match[1]);if(Number.isSafeInteger(code)){observedExitCode=code;exitEvidence='container-start-monitor';}}
  }
  state=await this.getState().catch(()=>null);
  if(state?.status==='stopped_with_code'&&Number.isSafeInteger(state.exitCode)){
   if(observedExitCode===null||observedExitCode===state.exitCode){observedExitCode=state.exitCode!;exitEvidence='container-state';}
   else{observedExitCode=null;exitEvidence=null;}
  }
  const failed=startupIssued&&!readinessConfirmed&&observedExitCode===42;
  const receipt:StartupFailureReceipt={failed,state,businessDispatches:0,fault:'entrypoint-exit-42-before-readiness',expectedExitCode:42,
   observedExitCode,exitEvidence,outcome:readinessConfirmed?'unexpected-readiness':failed?'confirmed':'unconfirmed',startupIssued,readinessConfirmed,startedAt,finishedAt:Date.now()};
  this.ctx.storage.kv.put(key,receipt);await this.ctx.storage.sync();return receipt;
 }
}
/** A fixed diagnostic release sequence. Intent survives a Worker update; an
 * interrupted phase is never replayed, and deployment is performed externally. */
export class ReleaseCoordinator extends DurableObject<Env>{
 readonly workerRelease:WorkerRelease='w1';
 actual:Promise<unknown>|null=null;working=false;
 get<T>(key:string){return this.ctx.storage.kv.get<T>(key);}
 put(key:string,value:unknown){this.ctx.storage.kv.put(key,value);}
 vm(role:VM){return getSandbox<ReleaseSandbox>(this.env.ReleaseSandbox,`m0-${RELEASE_RUN}-${role}`,{normalizeId:true,enableDefaultSession:false,keepAlive:false,sleepAfter:'180s'});}
 report(){return {runId:RELEASE_RUN,environment:'cloudflare-vm',workerRelease:this.workerRelease,
  phases:this.get<PhaseRecord[]>('phases')??[],operation:this.get('operation')??null,closed:this.get('closed')===true,
  receipts:this.get('receipts')??{},checkpoint:currentCheckpoint(this.ctx.storage),
  allocated:this.get('allocated')??[],destroyed:this.get('destroyed')??[],cleanup:this.get('cleanup')??'pending',modelDispatches:0};}
 receipt(key:string,value:unknown){this.put('receipts',{...this.get<Record<string,unknown>>('receipts'),[key]:value});}
 async accept(phase:ReleasePhase){
  requirePhaseRelease(phase,this.workerRelease);
  const phases=this.get<PhaseRecord[]>('phases')??[];
  if(this.working||this.get('closed')||this.get('operation')||phases.some(p=>p.status!=='completed')||PHASES[phases.length]!==phase)throw Error('phase-denied-never-replay');
  this.working=true;
  this.put('phases',[...phases,{phase,release:this.workerRelease,startedAt:Date.now(),finishedAt:null,status:'running',error:null}]);
  await this.ctx.storage.sync();
  // Rollout control-plane convergence and independent deployment checks occur
  // between phases. This idle cleanup window is separate from the 45s RPC cap.
  await this.ctx.storage.setAlarm(Date.now()+600000);
  this.ctx.waitUntil(this.run(phase));return this.report();
 }
 async effect<T>(name:string,call:()=>Promise<T>,clean=false):Promise<T>{
  if(this.actual||this.get('operation')||!clean&&this.get('closed'))throw Error('effect-denied');
  this.put('operation',name);await this.ctx.storage.sync();
  if(!clean&&this.get('closed')){this.put('operation',null);throw Error('closed');}
  let pending:Promise<T>;try{pending=Promise.resolve(call());}catch(e){pending=Promise.reject(e);}
  let timedOut=false;
  const actual=pending.finally(async()=>{this.put('operation',null);await this.ctx.storage.sync();if(this.actual===actual)this.actual=null;
   if(timedOut||this.get('closed'))await this.ctx.storage.setAlarm(Date.now()+100);});
  this.actual=actual;this.ctx.waitUntil(actual.catch(()=>{}));
  try{return await waitForEffect(actual,clean?20000:45000);}catch(e){if(e instanceof EffectDeadlineError){timedOut=true;this.put('closed',true);this.put('cleanup','unconfirmed');await this.ctx.storage.sync();}throw e;}
 }
 async allocated(role:VM){const all=this.get<VM[]>('allocated')??[];if(!all.includes(role)){this.put('allocated',[...all,role]);await this.ctx.storage.sync();}}
 async prepare(role:VM){await this.allocated(role);const r=await this.effect(`${role}/source`,()=>this.vm(role).writeFile(SOURCE,runtimeSource));if(!r.success)throw Error('source-write');
  this.receipt(`${role}/source`,{sha256:await sha256(enc.encode(runtimeSource)),bytes:enc.encode(runtimeSource).length});}
 async input(role:VM,command:string,requestId:string,restore?:unknown,fault?:'protocol'|'format'){const value={directory:ROOT,command,requestId,...restore?{restore}:{},...fault?{fault}:{},...command==='hold'?{holdMs:120000}:{}};
  const r=await this.effect(`${role}/input`,()=>this.vm(role).writeFile(command==='hold'?HOLD_INPUT:INPUT,JSON.stringify(value)));if(!r.success)throw Error('input-write');}
 async command(role:VM,command:'initialize'|'increment'|'read',requestId:string,restore?:unknown){
  await this.input(role,command,requestId,restore);
  const r=await this.effect(`${role}/${command}`,()=>this.vm(role).exec(`node ${SOURCE} < ${INPUT}`,{timeout:10000}));
  if(!r.success||r.exitCode!==0||r.stdout.length>16384)throw Error('child-failed');
  const value:unknown=JSON.parse(r.stdout);admitCounter(value);
  if(value.command!==command||value.requestId!==requestId||!['completed','observed'].includes(value.status))throw Error('child-correlation');
  this.receipt(requestId,value);await this.ctx.storage.sync();return value;
 }
 async checkpoint(counter:number){const parent=currentCheckpoint(this.ctx.storage);const bytes=enc.encode(JSON.stringify({schema:1,counter}));
  const receipt=await this.effect('checkpoint',()=>saveCheckpoint({entries:[],session:bytes,generation:1,parent:parent?.revision??null,blobs:this.blobs(),authority:{current:async()=>currentCheckpoint(this.ctx.storage),commit:input=>commitCheckpoint(this.ctx.storage,input)}}));
  this.receipt(`checkpoint/${receipt.sequence}`,{...receipt,sessionSha256:await sha256(bytes),counter,prefix:`m0-release/${RELEASE_RUN}`});await this.ctx.storage.sync();}
 blobs(){return new R2Blobs(this.env.CHECKPOINTS,`m0-release/${RELEASE_RUN}`);}
 async restore(role:VM){const receipt=currentCheckpoint(this.ctx.storage);if(!receipt)throw Error('no-checkpoint');
  const r=await this.effect('restore',()=>restoreCheckpoint(this.blobs(),receipt.revision));const value=JSON.parse(dec.decode(r.session));
  if(value.schema!==1||!Number.isSafeInteger(value.counter)||value.counter<0)throw Error('checkpoint-format');
  this.receipt(`${role}/restored`,{...receipt,sessionSha256:await sha256(r.session),counter:value.counter});
  await this.prepare(role);const initialized=await this.command(role,'initialize',`${role}-initialize`,value);
  if(initialized.counter!==value.counter)throw Error('restore-state');
  const changed=await this.command(role,'increment',`${role}-increment`);if(changed.counter!==value.counter+1)throw Error('increment-state');
  const read=await this.command(role,'read',`${role}-read-state`);if(read.counter!==changed.counter)throw Error('read-state');await this.checkpoint(read.counter);
 }
 async destroy(role:VM){if((this.get<VM[]>('destroyed')??[]).includes(role))return;
  await this.effect(`${role}/destroy`,()=>this.vm(role).destroy(),true);
  this.put('destroyed',[...this.get<VM[]>('destroyed')??[],role]);await this.ctx.storage.sync();}
 async run(phase:ReleasePhase){try{
  if(this.get('closed'))throw Error('closed');
  if(phase==='baseline'){await this.prepare('old');await this.command('old','initialize','baseline-initialize');const r=await this.command('old','increment','baseline-increment');if(r.counter!==1)throw Error('baseline-counter');await this.checkpoint(r.counter);}
  if(phase==='compatibility'){
   const r=await this.command('old','read','compatibility-before');
   const rejected=[];for(const fault of ['protocol','format'] as const){
    await this.input('old','read',`rejection-${fault}`,undefined,fault);
    const wire=await this.effect(`old/rejection-${fault}`,()=>this.vm('old').exec(`node ${SOURCE} < ${INPUT}`,{timeout:10000}));
    if(!wire.success||wire.exitCode!==0||wire.stdout.length>16384)throw Error('fault-child-failed');
    const value=JSON.parse(wire.stdout) as CounterReport;
    if(value.counter!==r.counter||value.command!=='read'||value.requestId!==`rejection-${fault}`||value.protocol!==(fault==='protocol'?'m0-unknown':'m0-v1')||value.format!==(fault==='format'?999:1))throw Error('fault-wire-mismatch');
    try{admitCounter(value);}catch{rejected.push({fault,wire:value});}
   }
   if(rejected.length!==2)throw Error('rejection-policy');
   const after=await this.command('old','read','compatibility-after');if(after.counter!==r.counter)throw Error('rejection-effect');
   this.receipt('incompatible-events',{rejected,businessDispatches:0,counterBefore:r.counter,counterAfter:after.counter,scope:'controller rejects fixed incompatible events returned by real read-only children'});
  }
  if(phase==='hold'){
   await this.input('old','hold','rollout-hold-task');
   const p=await this.effect('old/hold-start',()=>this.vm('old').startProcess(`node ${SOURCE} < ${HOLD_INPUT}`,{timeout:125000,autoCleanup:false}));
   this.put('hold-process',p.id);await this.ctx.storage.sync();
   let r:CounterReport|null=null;
   for(let i=0;i<10;i++){r=await this.command('old','read',`hold-before-rollout-${i}`);if(r.active)break;await new Promise(resolve=>setTimeout(resolve,100));}
   const active=r?.active as {requestId?:string;pid?:number}|undefined;
   if(active?.requestId!=='rollout-hold-task'||!Number.isSafeInteger(active.pid))throw Error('hold-not-active');this.receipt('hold-process',{id:p.id,status:p.status,active,at:Date.now()});
  }
  if(phase==='upgrade'){
   const id=this.get<string>('hold-process');if(!id)throw Error('no-held-process');
   this.receipt('old/lifecycle-after-rollout',await this.effect('old/lifecycle',()=>this.vm('old').releaseLifecycle()));
   // The SDK lookup may reconnect a replaced instance. Independent API image
   // and instance records must establish whether the old VM was replaced.
   const p=await this.effect('old/hold-observe',()=>this.vm('old').getProcess(id));
   this.receipt('hold-after-rollout',p?{id:p.id,status:p.status,exitCode:p.exitCode??null}:{id,missing:true,outcome:'requires-instance-replacement-evidence'});
   if(p&&['running','starting'].includes(p.status))throw Error('old-task-still-active');
   await this.destroy('old');await this.restore('new');await this.destroy('new');
  }
  if(phase==='startup-failure'){await this.allocated('fault');const r=await this.effect('fault/start',()=>this.vm('fault').fixedStartupFailure());this.receipt('startup-failure',r);if(!r.failed)throw Error('fault-did-not-fail');await this.destroy('fault');}
  if(phase==='rollback'){await this.restore('rollback');await this.destroy('rollback');}
  if(this.get('closed'))throw Error('closed-before-confirmation');
  this.put('phases',this.get<PhaseRecord[]>('phases')!.map(p=>p.phase===phase?{...p,status:'completed',finishedAt:Date.now()}:p));await this.ctx.storage.sync();
 }catch{this.put('closed',true);this.put('phases',this.get<PhaseRecord[]>('phases')!.map(p=>p.phase===phase?{...p,status:'unknown',error:'phase-unconfirmed-never-replay',finishedAt:Date.now()}:p));await this.ctx.storage.sync();
  if(!this.actual)await this.ctx.storage.setAlarm(Date.now()+100);
 }finally{this.working=false;}}
 async cleanup(){this.put('closed',true);await this.ctx.storage.sync();if(!this.actual)await this.ctx.storage.setAlarm(Date.now()+100);return this.report();}
 async alarm(){this.put('closed',true);await this.ctx.storage.sync();
  if(this.actual){this.put('cleanup','unconfirmed');return;}
  // Losing the owner of an RPC is not proof that it stopped. A destroy racing
  // an old delayed start could leave an unowned VM; require independent
  // reconciliation instead of clearing the persisted dispatch fence.
  if(this.get('operation')){this.put('cleanup','unconfirmed');this.receipt('reconciliation-required',{operation:this.get('operation'),reason:'interrupted-rpc-owner-lost'});await this.ctx.storage.sync();return;}
  let confirmed=true;for(const role of this.get<VM[]>('allocated')??[]){try{await this.destroy(role);}catch{confirmed=false;if(this.actual)break;}}
  this.put('cleanup',confirmed?'confirmed':'unconfirmed');await this.ctx.storage.sync();}
}
export async function fetchRelease(request:Request,env:Env){
 const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store','x-riffology-m0-mode':'release-only'}});
 if(!await hasProbeAuthorization(request,env.M0_PROBE_TOKEN))return json({error:'operator-required'},401);
 const url=new URL(request.url),action=url.pathname.split('/').at(-1)!;
 if(url.origin!==RELEASE_ORIGIN||url.search||url.hash||url.pathname!==`/probe/${RELEASE_RUN}/${action}`||!['report','cleanup',...PHASES].includes(action))return json({error:'route-denied'},404);
 if(request.method!==(action==='report'?'GET':'POST'))return json({error:'method-denied'},405);
 if(request.body){const reader=request.body.getReader(),ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),1000);
  try{let ended=false;for(let i=0;i<16;i++){const part=await untilAbort(reader.read(),ctrl.signal);if(part.done){ended=true;break;}if(part.value.byteLength)return json({error:'empty-body-required'},400);}if(!ended)return json({error:'empty-body-required'},400);}
  catch{return json({error:'empty-body-required'},400);}finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}}
 const host=env.HOST.getByName(RELEASE_RUN);
 try{return json(action==='report'?await host.report():action==='cleanup'?await host.cleanup():await host.accept(action as ReleasePhase),action==='report'?200:202);}
 catch{return json({error:'phase-unconfirmed',next:'read report; do not replay'},409);}
}
