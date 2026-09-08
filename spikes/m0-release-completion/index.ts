import { DurableObject } from 'cloudflare:workers';
import { getSandbox } from '@cloudflare/sandbox';
import type { ReleaseSandbox } from '../m0-release/cloud-host.ts';
import { NativeFault } from './native-fault.ts';
import runtimeSource from '../../services/runtime/release-probe.mjs';
import { FixedPipeline } from '../m0-pi-live/pipeline.ts';
import { R2Blobs, commitCheckpoint, currentCheckpoint } from '../m0-storage/adapters.ts';
import { restoreCheckpoint, saveCheckpoint, sha256 } from '../m0-storage/checkpoint.ts';
import { admitCounter } from '../m0-release/cloud-policy.ts';
import { hasProbeAuthorization } from '../m0-cloud/auth.ts';
import { untilAbort } from '../m0-model-proxy/policy.ts';
export { NativeFault };
export const RUN='release-completion-20260906';
export const ORIGIN='https://riffology-m0-release-completion-staging.jihe-gao.workers.dev';
export const SOURCE_PREFIX='m0-release/release-g0-v3-20260906';
export const SOURCE_REVISION='518090fb384338b9e63ddbdf091ea03f2ce2198d347b8e509c165947dc4753a7';
export const SOURCE_STATE_SHA='fe44e2085de9f5c29980f1a6c8a84a8c340131a8fefc9135a265d2667bde7b5c';
const SOURCE='/workspace/release-probe.mjs',INPUT='/workspace/release-input.json',ROOT='/workspace/m0-release';
type Env={M0_PROBE_TOKEN:string;CHECKPOINTS:R2Bucket;RevertedSandbox:DurableObjectNamespace<ReleaseSandbox>;FAULT:DurableObjectNamespace<NativeFault>;HOST:DurableObjectNamespace<CompletionHost>};
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
export class CompletionHost extends DurableObject<Env>{
 pipeline:FixedPipeline;
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);this.pipeline=new FixedPipeline(ctx,[()=>this.fault(),()=>this.restore(),()=>this.increment(),()=>this.save()],[()=>this.cleanFault(),()=>this.destroy()]);}
 get<T>(k:string){return this.ctx.storage.kv.get<T>(k);}
 put(k:string,v:unknown){this.ctx.storage.kv.put(k,v);}
 sandbox(){return getSandbox<ReleaseSandbox>(this.env.RevertedSandbox,`m0-${RUN}-restore`,{normalizeId:true,enableDefaultSession:false,keepAlive:false,sleepAfter:'60s'});}
 faultStub(){return this.env.FAULT.getByName(`m0-${RUN}-fault`);}
 async accept(){await this.pipeline.accept();return this.report();}
 async cleanup(){await this.pipeline.close();return this.report();}
 alarm(){return this.pipeline.alarm();}
 report(){return {runId:RUN,environment:'cloudflare-vm',state:this.pipeline.state(),fault:this.get('fault')??null,restored:this.get('restored')??null,
  commands:this.get('commands')??[],checkpoint:this.get('checkpoint')??null,sourceSha256:this.get('runtime-source')??null,
  faultCleanup:this.get('fault-cleanup')??null,restoreDestroyed:this.get('restore-destroyed')===true,modelDispatches:0};}
 async fault(){this.put('fault-allocated',true);await this.ctx.storage.sync();
  const r=await this.pipeline.effect('native-fault',()=>this.faultStub().run());this.put('fault',r);await this.ctx.storage.sync();
  if(!await this.cleanFault())throw Error('fault-cleanup-unconfirmed');
  // NativeFault owns and fixes its observation before cleanup; no controller
  // supplied signal/error or SDK cached state can satisfy this acceptance.
  const result=r.result;
  if(result?.outcome!=='confirmed'||result.reason!=='exit-42'||result.exitCode!==42||result.monitor?.outcome!=='unexpected-exit'||result.monitor.exitCode!==42
   ||result.nativeRunning!==false||result.readiness.status!=='rejected'||!r.intent?.startReturned||!r.intent.monitorAttached||r.businessDispatches!==0)throw Error('startup-exit-unconfirmed');
 }
 async cleanFault(){if(!this.get('fault-allocated'))return true;if(this.get('fault-cleaned'))return true;
  const r=await this.pipeline.effect('native-fault-cleanup',()=>this.faultStub().cleanup(),true);this.put('fault-cleanup',r);await this.ctx.storage.sync();
  if((r as unknown as {cleanup:string}).cleanup!=='confirmed')return false;this.put('fault-cleaned',true);await this.ctx.storage.sync();return true;
 }
 async write(path:string,text:string){this.put('restore-allocated',true);await this.ctx.storage.sync();
  const r=await this.pipeline.effect('restore/write',()=>this.sandbox().writeFile(path,text));if(!r.success)throw Error('write-failed');}
 async command(command:'initialize'|'increment'|'read',requestId:string,restore?:unknown){
  await this.write(INPUT,JSON.stringify({directory:ROOT,command,requestId,...restore?{restore}:{}}));
  const r=await this.pipeline.effect(`restore/${command}`,()=>this.sandbox().exec(`node ${SOURCE} < ${INPUT}`,{timeout:10000}));
  if(!r.success||r.exitCode!==0||r.stdout.length>16384)throw Error('child-failed');const result=JSON.parse(r.stdout);admitCounter(result);
  if(result.command!==command||result.requestId!==requestId||!['completed','observed'].includes(result.status))throw Error('child-correlation');
  this.put('commands',[...this.get<unknown[]>('commands')??[],result]);await this.ctx.storage.sync();return result;
 }
 async restore(){
  const saved=await this.pipeline.effect('source/restore',()=>restoreCheckpoint(new R2Blobs(this.env.CHECKPOINTS,SOURCE_PREFIX),SOURCE_REVISION));
  const hash=await sha256(saved.session),state=JSON.parse(dec.decode(saved.session));
  if(hash!==SOURCE_STATE_SHA||saved.entries.length!==0||saved.manifest.generation!==1||state.schema!==1||state.counter!==2||Object.keys(state).length!==2)throw Error('source-checkpoint');
  this.put('restored',{prefix:SOURCE_PREFIX,revision:SOURCE_REVISION,stateSha256:hash,counter:state.counter});await this.ctx.storage.sync();
  await this.write(SOURCE,runtimeSource);this.put('runtime-source',await sha256(enc.encode(runtimeSource)));
  const initialized=await this.command('initialize','completion-initialize',state);if(initialized.counter!==2)throw Error('restore-counter');
 }
 async increment(){const changed=await this.command('increment','completion-increment');if(changed.counter!==3||changed.replayed!==false)throw Error('increment-counter');
  const read=await this.command('read','completion-read-state');if(read.counter!==3)throw Error('read-counter');}
 async save(){const bytes=enc.encode(JSON.stringify({schema:1,counter:3})),prefix=`m0-release-completion/${RUN}`;
  const receipt=await this.pipeline.effect('new/checkpoint',()=>saveCheckpoint({entries:[],session:bytes,generation:1,parent:null,blobs:new R2Blobs(this.env.CHECKPOINTS,prefix),authority:{
   current:async()=>currentCheckpoint(this.ctx.storage),commit:input=>commitCheckpoint(this.ctx.storage,input)}}));
  this.put('checkpoint',{...receipt,prefix,stateSha256:await sha256(bytes),counter:3,sourceRevision:SOURCE_REVISION});await this.ctx.storage.sync();
 }
 async destroy(){if(!this.get('restore-allocated')||this.get('restore-destroyed'))return true;
  await this.pipeline.effect('restore/destroy',()=>this.sandbox().destroy(),true);this.put('restore-destroyed',true);await this.ctx.storage.sync();return true;}
}
export default {async fetch(request:Request,env:Env){
 const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store','x-riffology-m0-mode':'release-completion'}});
 if(!await hasProbeAuthorization(request,env.M0_PROBE_TOKEN))return json({error:'operator-required'},401);
 const url=new URL(request.url),action=url.pathname.split('/').at(-1)!;
 if(url.origin!==ORIGIN||url.search||url.hash||!['accept','report','cleanup'].includes(action)||url.pathname!==`/probe/${RUN}/${action}`)return json({error:'route-denied'},404);
 if(request.method!==(action==='report'?'GET':'POST'))return json({error:'method-denied'},405);
 if(request.body){const reader=request.body.getReader(),ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),1000);
  try{let ended=false;for(let i=0;i<16;i++){const p=await untilAbort(reader.read(),ctrl.signal);if(p.done){ended=true;break;}if(p.value.length)return json({error:'empty-body-required'},400);}if(!ended)return json({error:'empty-body-required'},400);}
  catch{return json({error:'empty-body-required'},400);}finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}}
  try{const host=env.HOST.getByName(RUN);return json(action==='report'?await host.report():action==='accept'?await host.accept():await host.cleanup(),action==='accept'?202:200);}
  catch{return json({error:'operation-unconfirmed',next:'read report; never replay accept'},409);}
}} satisfies ExportedHandler<Env>;
