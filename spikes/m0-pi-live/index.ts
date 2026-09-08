import { DurableObject } from 'cloudflare:workers';
import { ContainerProxy, Sandbox, getSandbox } from '@cloudflare/sandbox';
import goSource from '../../services/runtime/go-pi-probe.mjs';
import egressSource from '../../services/runtime/egress-probe.mjs';
import { FixedPipeline } from './pipeline.ts';
import { handleLiveRequest, LIVE_RUN, HOST_ATTEMPT } from './worker.ts';
import { MODEL_PROXY_ORIGIN, TRUSTED_ALLOWED_HOSTS, PROJECT_ALLOWED_HOSTS, trustedOutbound, projectOutbound } from './egress.ts';
import { MODULE_DIR, INPUT, OUTPUT, ENTRY, childSource, EGRESS_OUTPUT, egressEntry } from './child.ts';
import { R2Blobs, commitCheckpoint, currentCheckpoint } from '../m0-storage/adapters.ts';
import { saveCheckpoint, restoreCheckpoint, sha256 } from '../m0-storage/checkpoint.ts';
import { untilAbort } from '../m0-model-proxy/policy.ts';
import type { RunLedger } from '../m0-model-proxy/authority.ts';
export { ContainerProxy };
type Env = { M0_PROBE_TOKEN:string; M0_MODEL_PROXY_OPERATOR_TOKEN:string; MODEL_PROXY:Fetcher; CHECKPOINTS:R2Bucket;
 TrustedPiSandbox:DurableObjectNamespace<TrustedPiSandbox>; ProjectSandbox:DurableObjectNamespace<ProjectSandbox>; HOST:DurableObjectNamespace<M0PiLive> };
export class TrustedPiSandbox extends Sandbox<Env> {
 override enableInternet=false; override interceptHttps=true; override allowedHosts=[...TRUSTED_ALLOWED_HOSTS];
 override envVars={}; override sleepAfter='60s';
}
export class ProjectSandbox extends Sandbox<Env> {
 override enableInternet=false; override interceptHttps=true; override allowedHosts=[...PROJECT_ALLOWED_HOSTS];
 override envVars={}; override sleepAfter='60s';
}
TrustedPiSandbox.outbound=(request,env)=>trustedOutbound(request,r=>(env as unknown as Env).MODEL_PROXY.fetch(r));
ProjectSandbox.outbound=request=>projectOutbound(request,r=>fetch(r));
type VM='project'|'g1'|'g2';
type Init={runId:string;mode:string;expiresAtMs:number;capabilities:{callId:string;token:string}[]};
type Status={initialized:boolean;mode:string;revoked:boolean;activeRequests:number;ledger:RunLedger|null;upstreamDispatchIntents:number};
type ChildReport={passed:boolean;evidenceMode:string;phase:string;snapshot:unknown;inputSnapshotSha256:string|null;
 requests:{path:string;platformRequestId:string|null;bodySha256:string}[];responseIds:string[];[key:string]:unknown};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export class M0PiLive extends DurableObject<Env> {
 pipeline:FixedPipeline;
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);
  this.pipeline=new FixedPipeline(ctx,[
   ()=>this.network('project'),()=>this.destroy('project'),()=>this.network('g1'),
   ()=>this.prepare('g1'),()=>this.initializeProxy(),()=>this.input('g1'),()=>this.execute('g1'),
   ()=>this.terminal(1),()=>this.checkpoint(),()=>this.destroy('g1'),
   ()=>this.prepare('g2'),()=>this.input('g2'),()=>this.execute('g2'),()=>this.terminal(2),
  ],[()=>this.revoke(),...(['g1','g2','project'] as VM[]).map(vm=>async()=>{await this.destroy(vm,true);return true;})]);
 }
 sandbox(vm:VM){const options={normalizeId:true,enableDefaultSession:false,keepAlive:false,sleepAfter:'60s'};
  return vm==='project'?getSandbox<ProjectSandbox>(this.env.ProjectSandbox,`m0-pl-${HOST_ATTEMPT}-p`,options)
   :getSandbox<TrustedPiSandbox>(this.env.TrustedPiSandbox,`m0-pl-${HOST_ATTEMPT}-${vm}`,options);}
 put(key:string,value:unknown){this.ctx.storage.kv.put(key,value);}
 get<T>(key:string){return this.ctx.storage.kv.get<T>(key);}
 async accept(){await this.pipeline.accept();return this.report();}
 async cleanup(){await this.pipeline.close();return this.report();}
 report(){return {environment:'cloudflare-vm',runId:LIVE_RUN,hostAttempt:HOST_ATTEMPT,state:this.pipeline.state(),
  reports:{project:this.get('report/network/project')??null,trusted:this.get('report/network/g1')??null,
   initial:this.get('report/g1')??null,restored:this.get('report/g2')??null},
  proxyBefore:this.get('proxy-before')??null,proxyFirst:this.get('proxy-1')??null,proxySecond:this.get('proxy-2')??null,
  proxyFinal:this.get('proxy-final')??null,checkpoint:this.get('checkpoint')??null,restoredDigest:this.get('restored-digest')??null,
  destroyed:{g1:this.get('destroyed/g1')===true,g2:this.get('destroyed/g2')===true,project:this.get('destroyed/project')===true},
  realProviderCalls:null,cashCharge:null,scopeLimit:'Fixed M0 diagnostic; production project/turn integration remains pending.'};}
 alarm(){return this.pipeline.alarm();}
 async vmEffect<T>(vm:VM,name:string,call:()=>Promise<T>){this.put(`allocated/${vm}`,true);await this.ctx.storage.sync();return this.pipeline.effect(`${vm}/${name}`,call);}
 async write(vm:VM,path:string,text:string){const r=await this.vmEffect(vm,'write',()=>this.sandbox(vm).writeFile(path,text));if(!r.success)throw Error('write-failed');}
 async read(vm:VM,path:string){const r=await this.vmEffect(vm,'read',()=>this.sandbox(vm).readFile(path,{encoding:'utf-8'}));
  if(!r.success||typeof r.content!=='string'||encoder.encode(r.content).length>65536)throw Error('read-failed');
  if(r.content.includes('m0p.')||r.content.includes(this.env.M0_PROBE_TOKEN)||r.content.includes(this.env.M0_MODEL_PROXY_OPERATOR_TOKEN))throw Error('unsafe-report');
  return JSON.parse(r.content);}
 async network(vm:'project'|'g1'){
  // The project image also includes Node, but carries none of the Pi host modules.
  const mkdir=await this.vmEffect(vm,'mkdir',()=>this.sandbox(vm).exec(`mkdir -p ${MODULE_DIR}`,{timeout:5000}));if(!mkdir.success)throw Error('mkdir-failed');
  await this.write(vm,`${MODULE_DIR}/egress-probe.mjs`,egressSource);
  await this.write(vm,`${MODULE_DIR}/egress-entry.mjs`,egressEntry(vm==='project'?'project':'trusted'));
  const r=await this.vmEffect(vm,'network-probe',()=>this.sandbox(vm).exec(`node ${MODULE_DIR}/egress-entry.mjs`,{timeout:42000}));
  if(!r.success||r.exitCode!==0||r.stdout!=='egress-probe-finished\n')throw Error('network-child-failed');
  const report=await this.read(vm,EGRESS_OUTPUT);this.put(`report/network/${vm}`,report);await this.ctx.storage.sync();
  if(report.passed!==true||report.evidenceMode!=='cloud-network')throw Error('network-probe-failed');
 }
 async prepare(vm:'g1'|'g2'){await this.write(vm,`${MODULE_DIR}/go-pi-probe.mjs`,goSource);await this.write(vm,ENTRY,childSource);}
 async control<T>(action:'status'|'init/alpha'|'revoke'):Promise<T>{
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{const response=await untilAbort(this.env.MODEL_PROXY.fetch(new Request(`${MODEL_PROXY_ORIGIN}/probe/${LIVE_RUN}/${action}`,{
   method:action==='status'?'GET':'POST',headers:{authorization:`Bearer ${this.env.M0_MODEL_PROXY_OPERATOR_TOKEN}`},redirect:'manual',signal:ctrl.signal})),ctrl.signal);
   if(response.status!==200||response.headers.get('x-riffology-m0-mode')!=='go-live-only'||response.redirected)throw Error('proxy-response');
   reader=response.body!.getReader();let text='',bytes=0;
   for(let i=0;i<1024;i++){const r=await untilAbort(reader.read(),ctrl.signal);if(r.done)return JSON.parse(text) as T;
    bytes+=r.value.length;if(bytes>65536)throw Error('proxy-body-limit');text+=decoder.decode(r.value,{stream:true});}
   throw Error('proxy-chunk-limit');
  }finally{clearTimeout(timer);if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}}
 }
 async initializeProxy(){
  const before=await this.pipeline.effect('proxy-before',()=>this.control<Status>('status'));this.put('proxy-before',before);
  if(before.initialized||before.revoked||before.ledger||before.activeRequests!==0||before.upstreamDispatchIntents!==0)throw Error('proxy-already-used');
  this.put('proxy-init-attempted',true);await this.ctx.storage.sync();
  const init=await this.pipeline.effect('proxy-init',()=>this.control<Init>('init/alpha'));
  if(init.runId!==LIVE_RUN||init.mode!=='go-live-only'||init.capabilities.length!==2||init.expiresAtMs<=Date.now())throw Error('proxy-init-response');
  this.put('private/init',init);this.put('private/scope',{tenantId:'m0-alpha',projectId:`m0-alpha-${LIVE_RUN}`,sessionId:crypto.randomUUID()});
  this.put('private/marker',`M0_GO_${crypto.randomUUID().replaceAll('-','')}`);await this.ctx.storage.sync();
 }
 async input(vm:'g1'|'g2'){
  const init=this.get<Init>('private/init')!,scope=this.get('private/scope'),marker=this.get<string>('private/marker');
  const cap=init.capabilities.find(c=>c.callId===(vm==='g1'?'call-1':'call-2'));if(!cap)throw Error('cap-missing');
  let snapshot:unknown;
  if(vm==='g2'){
   const receipt=currentCheckpoint(this.ctx.storage);if(!receipt||this.get('destroyed/g1')!==true)throw Error('restore-precondition');
   const restored=await this.pipeline.effect('restore-checkpoint',()=>restoreCheckpoint(this.blobs(),receipt.revision));
   const digest=await sha256(restored.session);if(digest!==this.get<{sessionSha256:string}>('checkpoint')!.sessionSha256)throw Error('restore-digest');
   snapshot=JSON.parse(decoder.decode(restored.session));this.put('restored-digest',digest);await this.ctx.storage.sync();
  }
  await this.write(vm,INPUT,JSON.stringify({phase:vm==='g1'?'initial':'restored',scope,marker,snapshot,trustedCwd:`/opt/m0-go-${vm}`,
   invocation:{runId:LIVE_RUN,callId:cap.callId,token:cap.token,expiresAtMs:init.expiresAtMs,scope}}));
 }
 async execute(vm:'g1'|'g2'){
  const result=await this.vmEffect(vm,'model-child',()=>this.sandbox(vm).exec(`node ${ENTRY}`,{timeout:42000}));
  if(!result.success||result.exitCode!==0||result.stdout!=='go-probe-finished\n')throw Error('model-child-failed');
  const report=await this.read(vm,OUTPUT) as ChildReport;this.put(`report/${vm}`,report);await this.ctx.storage.sync();
  // Always collect the authoritative receipt on the following step, even if
  // the child returned a diagnostic failure. It never dispatches another call.
 }
 async terminal(ordinal:1|2){
  let status:Status|undefined;
  for(let i=0;i<10;i++){
   status=await this.pipeline.effect(`proxy-status-${ordinal}`,()=>this.control<Status>('status'));
   this.put(`proxy-${ordinal}`,status);await this.ctx.storage.sync();
   if(status.ledger?.calls[`call-${ordinal}`]?.state==='terminal'&&status.activeRequests===0)break;
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  const report=this.get<ChildReport>(`report/g${ordinal}`)!,receipt=status?.ledger?.calls[`call-${ordinal}`];
  if(!report?.passed||report.evidenceMode!=='go-live-proxy'||report.phase!==(ordinal===1?'initial':'restored')||!receipt
   ||receipt.state!=='terminal'||receipt.facts?.outcome!==(ordinal===1?'completed':'cancelled')||status?.activeRequests!==0
   ||status.ledger?.dispatchCount!==ordinal||receipt.dispatchOrdinal!==ordinal)throw Error('terminal-not-confirmed');
  const wire=report.requests.find(r=>r.path==='/v1/chat/completions');
  if(wire?.bodySha256!==receipt.payloadHash||wire.platformRequestId!==receipt.platformRequestId
   ||!receipt.facts.upstreamResponseId||!report.responseIds.includes(receipt.facts.upstreamResponseId))throw Error('receipt-correlation');
  if(ordinal===2&&report.inputSnapshotSha256!==this.get('restored-digest'))throw Error('restored-snapshot-correlation');
 }
 blobs(){return new R2Blobs(this.env.CHECKPOINTS,`m0-pi-live/${LIVE_RUN}`);}
 async checkpoint(){
  const snapshot=this.get<ChildReport>('report/g1')!.snapshot;if(!snapshot)throw Error('snapshot-missing');
  const session=encoder.encode(JSON.stringify(snapshot));
  const receipt=await this.pipeline.effect('save-checkpoint',()=>saveCheckpoint({entries:[],session,generation:1,parent:null,blobs:this.blobs(),authority:{
   current:async()=>currentCheckpoint(this.ctx.storage),commit:input=>commitCheckpoint(this.ctx.storage,input)}}));
  this.put('checkpoint',{...receipt,sessionSha256:await sha256(session),sessionBytes:session.length,prefix:`m0-pi-live/${LIVE_RUN}`});await this.ctx.storage.sync();
 }
 async destroy(vm:VM,cleanup=false){
  if(!this.get(`allocated/${vm}`)||this.get(`destroyed/${vm}`))return;
  await this.pipeline.effect(`destroy/${vm}`,async()=>{await this.sandbox(vm).destroy();this.put(`destroyed/${vm}`,true);await this.ctx.storage.sync();},cleanup);
 }
 async revoke(){
  if(!this.get('proxy-init-attempted'))return true;
  if(!this.get('proxy-revoked'))await this.pipeline.effect('proxy-revoke',async()=>{const r=await this.control<{revoked:boolean}>('revoke');
   if(!r.revoked)throw Error('revoke-unconfirmed');this.put('proxy-revoked',true);await this.ctx.storage.sync();},true);
  const final=await this.pipeline.effect('proxy-final',()=>this.control<Status>('status'),true);this.put('proxy-final',final);await this.ctx.storage.sync();
  return final.revoked&&final.activeRequests===0;
 }
}
export default {async fetch(request:Request,env:Env){return handleLiveRequest(request,env.M0_PROBE_TOKEN,async action=>{
 const host=env.HOST.getByName(`m0-pi-live-${HOST_ATTEMPT}`);return action==='accept'?host.accept():action==='cleanup'?host.cleanup():host.report();
});}} satisfies ExportedHandler<Env>;
