import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { PHASES, RELEASE_ORIGIN, RELEASE_RUN } from '../../spikes/m0-release/cloud-policy.ts';
import * as releaseDriver from '../../scripts/m0/release-cloud.mjs';
const {checkPhase}=releaseDriver as unknown as {checkPhase:(report:unknown,phase:string)=>void};
const hooks=registerHooks({resolve(specifier,context,next){
 const code=specifier==='cloudflare:workers'?'export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}'
  :specifier==='@cloudflare/sandbox'?'export class Sandbox{constructor(ctx,env){this.ctx=ctx;this.env=env}} export function getSandbox(){throw Error("unexpected allocation")}'
  :specifier.endsWith('/release-probe.mjs')?'export default "synthetic runtime source"':null;
 return code===null?next(specifier,context):{url:'data:text/javascript,'+encodeURIComponent(code),shortCircuit:true};
}});
const {ReleaseCoordinator,ReleaseSandbox,fetchRelease}=await import('../../spikes/m0-release/cloud-host.ts');hooks.deregister();
type VM='old'|'new'|'fault'|'rollback';
function fixture(){
 const values=new Map<string,unknown>(),blobs=new Map<string,Uint8Array>(),owned:Promise<unknown>[]=[],events:string[]=[];
 const storage={kv:{get:<T>(key:string)=>structuredClone(values.get(key)) as T,put:(key:string,value:unknown)=>{values.set(key,structuredClone(value));}},
  sync:async()=>{},setAlarm:async()=>{},transactionSync:<T>(fn:()=>T)=>fn()};
 const ctx={storage,waitUntil:(p:Promise<unknown>)=>owned.push(p)} as unknown as DurableObjectState;
 const env={M0_PROBE_TOKEN:'synthetic-release-operator-'+'x'.repeat(32),CHECKPOINTS:{put:async(key:string,bytes:Uint8Array)=>{if(!blobs.has(key))blobs.set(key,Uint8Array.from(bytes));},
  get:async(key:string)=>{const bytes=blobs.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}}};
 let host=new ReleaseCoordinator(ctx,env as never);
 const counters:Partial<Record<VM,number>>={},inputs=new Map<string,string>();let active:unknown=null;
 const sdks=Object.fromEntries((['old','new','fault','rollback'] as VM[]).map(vm=>[vm,{
  writeFile:async(path:string,value:string)=>{events.push(`${vm}:write`);inputs.set(`${vm}:${path}`,value);return {success:true};},
  exec:async()=>{const input=JSON.parse(inputs.get(`${vm}:/workspace/release-input.json`)!);events.push(`${vm}:${input.command}`);
   if(input.command==='initialize')counters[vm]=input.restore?.counter??0;
   if(input.command==='increment')counters[vm]!++;
   return {success:true,exitCode:0,stdout:JSON.stringify({protocol:input.fault==='protocol'?'m0-unknown':'m0-v1',format:input.fault==='format'?999:1,
    command:input.command,requestId:input.requestId,counter:counters[vm],pid:101,status:input.command==='read'?'observed':'completed',active:vm==='old'?active:null})};},
  startProcess:async(command:string)=>{assert.ok(command.endsWith('< /workspace/release-hold-input.json'));active={requestId:'rollout-hold-task',pid:101};return {id:'held-process',status:'running'};},
  getProcess:async()=>null,
  releaseLifecycle:async()=>({state:{status:'stopped'},lastStop:{observedAt:Date.now(),exitCode:0,reason:'runtime_signal',paramsValid:true}}),
  fixedStartupFailure:async()=>({failed:true,state:{status:'stopped_with_code',exitCode:42},businessDispatches:0,
   startupIssued:true,readinessConfirmed:false,expectedExitCode:42,observedExitCode:42,exitEvidence:'container-state',outcome:'confirmed'}),
  destroy:async()=>{events.push(`${vm}:destroy`);},
 }])) as Record<VM,any>;
 host.vm=role=>sdks[role];
 const drain=async()=>{let i=0;while(i<owned.length)await owned[i++];};
 const release=(v:'w1'|'w2')=>Object.defineProperty(host,'workerRelease',{value:v,configurable:true});
 const handoff=(v:'w1'|'w2')=>{host=new ReleaseCoordinator(ctx,env as never);host.vm=role=>sdks[role];release(v);};
 return {get host(){return host;},env,ctx,storage,values,blobs,owned,events,inputs,sdks,drain,release,handoff};
}
test('fixed phase sequence preserves R2 across Worker handoff and rejects real transport fault responses',async()=>{
 const f=fixture();for(const phase of PHASES){f.release(['baseline','rollback'].includes(phase)?'w1':'w2');await f.host.accept(phase);await f.drain();assert.equal(f.host.report().phases.at(-1)?.status,'completed',phase);checkPhase(f.host.report(),phase);}
 const receipts=f.host.report().receipts as Record<string,any>;
 assert.equal(receipts['baseline-increment'].counter,1);assert.equal(receipts['new-read-state'].counter,2);assert.equal(receipts['rollback-read-state'].counter,3);
 assert.equal(receipts['new/restored'].revision,receipts['checkpoint/1'].revision);assert.equal(receipts['rollback/restored'].revision,receipts['checkpoint/2'].revision);
 assert.equal(receipts['incompatible-events'].rejected.length,2);assert.equal(receipts['incompatible-events'].counterAfter,1);
 assert.equal(f.events.filter(x=>x.endsWith(':increment')).length,3);
 assert.ok(f.events.indexOf('old:destroy')<f.events.indexOf('new:initialize'));
 await f.host.cleanup();await f.host.alarm();assert.equal(f.host.report().cleanup,'confirmed');
 await assert.rejects(f.host.accept('baseline'));assert.equal(f.host.report().modelDispatches,0);
});
test('wrong Worker and phase replay fail before any VM effect',async()=>{
 const f=fixture();await assert.rejects(f.host.accept('compatibility'));assert.equal(f.events.length,0);
 await f.host.accept('baseline');await f.drain();const before=f.events.length;
 await assert.rejects(f.host.accept('baseline'));await assert.rejects(f.host.accept('compatibility'));assert.equal(f.events.length,before);
});
test('corrupt R2 checkpoint blocks fresh VM launch',async()=>{
 const f=fixture();await f.host.accept('baseline');await f.drain();
 for(const key of f.blobs.keys())f.blobs.set(key,new TextEncoder().encode('corrupt'));
 const before=f.events.length;await assert.rejects(f.host.restore('new'));assert.equal(f.events.length,before);
});
test('evicted RPC intent is retained; cleanup does not race delayed allocation',async()=>{
 const f=fixture();f.host.put('allocated',['old']);f.host.put('operation','old/source');
 await f.host.cleanup();await f.host.alarm();assert.equal(f.host.report().operation,'old/source');assert.equal(f.host.report().cleanup,'unconfirmed');assert.equal(f.events.length,0);
});
test('close during persisted effect intent fences the VM call',async()=>{
 const f=fixture();let count=0;f.storage.sync=async()=>{if(++count===1)f.host.put('closed',true);};
 let invoked=false;await assert.rejects(f.host.effect('late-write',async()=>{invoked=true;}));assert.equal(invoked,false);
});
test('operator routes bound input and permit only empty stream POST',async()=>{
 const f=fixture();let calls=0;const env={...f.env,HOST:{getByName:(name:string)=>{assert.equal(name,RELEASE_RUN);return {report:async()=>({}),accept:async()=>{calls++;return {};}};}}};
 const url=`${RELEASE_ORIGIN}/probe/${RELEASE_RUN}/baseline`,headers={authorization:`Bearer ${env.M0_PROBE_TOKEN}`};
 assert.equal((await fetchRelease(new Request(url,{method:'POST'}),env as never)).status,401);
 assert.equal((await fetchRelease(new Request(url+'?command=id',{method:'POST',headers}),env as never)).status,404);
 assert.equal((await fetchRelease(new Request(url,{method:'POST',headers,body:'{}'}),env as never)).status,400);
 const body=new ReadableStream<Uint8Array>({start(controller){controller.close();}});
 assert.equal((await fetchRelease(new Request(url,{method:'POST',headers,body,duplex:'half'} as RequestInit),env as never)).status,202);assert.equal(calls,1);
});

test('a new coordinator instance resumes only the next completed durable phase after Worker handoff',async()=>{
 const f=fixture();await f.host.accept('baseline');await f.drain();const old=f.host,head=f.host.report().checkpoint;
 f.handoff('w2');assert.notEqual(f.host,old);assert.deepEqual(f.host.report().checkpoint,head);
 const before=f.events.length;await assert.rejects(f.host.accept('baseline'));assert.equal(f.events.length,before);
 await f.host.accept('compatibility');await f.drain();assert.deepEqual(f.host.report().phases.map(p=>[p.phase,p.release,p.status]),[['baseline','w1','completed'],['compatibility','w2','completed']]);
 assert.equal(f.events.filter(e=>e==='old:initialize').length,1);assert.equal(f.events.filter(e=>e==='old:increment').length,1);
});

test('a persisted unfinished phase without a live owner cannot be accepted again',async()=>{
 const f=fixture();f.host.put('phases',[{phase:'baseline',release:'w1',startedAt:Date.now(),finishedAt:null,status:'running',error:null}]);
 f.handoff('w1');await assert.rejects(f.host.accept('baseline'),/phase-denied/);assert.equal(f.events.length,0);
 await f.host.cleanup();await f.host.alarm();assert.equal(f.host.report().closed,true);await assert.rejects(f.host.accept('baseline'));assert.equal(f.events.length,0);
});

test('close while SDK creation is pending preserves ownership until settlement and never initializes the late VM',async()=>{
 const f=fixture();let settle!:(result:{success:boolean})=>void;let started!:()=>void;
 const dispatched=new Promise<void>(resolve=>{started=resolve;});
 f.sdks.old.writeFile=async()=>{f.events.push('old:pending-source');started();return new Promise(resolve=>{settle=resolve;});};
 await f.host.accept('baseline');await dispatched;await f.host.cleanup();await f.host.alarm();
 assert.equal(f.host.report().cleanup,'unconfirmed');assert.equal(f.host.report().operation,'old/source');assert.deepEqual(f.events,['old:pending-source']);
 settle({success:true});await f.drain();await f.host.alarm();
 assert.deepEqual(f.events,['old:pending-source','old:destroy']);assert.equal(f.host.report().cleanup,'confirmed');assert.equal(f.host.report().phases[0]!.status,'unknown');
});

test('hold uses an immutable dedicated input while bounded reads wait for the real running marker',async()=>{
 const f=fixture();await f.host.accept('baseline');await f.drain();f.release('w2');await f.host.accept('compatibility');await f.drain();
 let starts=0,reads=0;const original=f.sdks.old.exec;
 f.sdks.old.startProcess=async(command:string)=>{starts++;assert.ok(command.endsWith('< /workspace/release-hold-input.json'));return {id:'held-process',status:'starting'};};
 f.sdks.old.exec=async()=>{const response=await original(),value=JSON.parse(response.stdout);if(value.requestId.startsWith('hold-before-rollout-')){
  reads++;value.active=reads>=3?{requestId:'rollout-hold-task',pid:101}:null;return {...response,stdout:JSON.stringify(value)};}return response;};
 await f.host.accept('hold');await f.drain();assert.equal(f.host.report().phases.at(-1)!.status,'completed');assert.equal(starts,1);assert.equal(reads,3);
 assert.equal(JSON.parse(f.inputs.get('old:/workspace/release-hold-input.json')!).command,'hold');
 assert.equal(JSON.parse(f.inputs.get('old:/workspace/release-input.json')!).command,'read');
});

test('a child that fails to emit the requested incompatible protocol cannot satisfy the rejection evidence',async()=>{
 const f=fixture();await f.host.accept('baseline');await f.drain();f.release('w2');const original=f.sdks.old.exec;
 f.sdks.old.exec=async()=>{const response=await original(),value=JSON.parse(response.stdout);if(value.requestId==='rejection-protocol')value.protocol='m0-v1';return {...response,stdout:JSON.stringify(value)};};
 await f.host.accept('compatibility');await f.drain();assert.equal(f.host.report().closed,true);assert.equal(f.host.report().phases.at(-1)!.status,'unknown');
 assert.equal((f.host.report().receipts as Record<string,unknown>)['incompatible-events'],undefined);assert.equal(f.events.filter(e=>e==='old:increment').length,1);
});

function startupFixture(initial:{status:string;exitCode?:number},after:{status:string;exitCode?:number},failure?:Error){
 const f=fixture(),sandbox=new ReleaseSandbox(f.ctx as never,f.env as never);let starts=0,reads=0;
 sandbox.getState=async()=> (++reads===1?initial:after) as Awaited<ReturnType<typeof sandbox.getState>>;
 sandbox.startAndWaitForPorts=(async()=>{starts++;if(failure)throw failure;}) as typeof sandbox.startAndWaitForPorts;
 return {sandbox,get starts(){return starts;}};
}
test('old exit code 42 cannot masquerade as this invocation successfully injecting startup failure',async()=>{
 const f=startupFixture({status:'stopped_with_code',exitCode:42},{status:'stopped_with_code',exitCode:42});
 const result=await f.sandbox.fixedStartupFailure();assert.equal(f.starts,0);assert.equal(result.failed,false);assert.equal(result.outcome,'unconfirmed');
});
test('startup fault requires a fresh dispatch with exact observed exit 42 and cannot replay',async()=>{
 const f=startupFixture({status:'stopped'},{status:'stopped_with_code',exitCode:42},Error('Container exited before we could determine the container health, exit code: 42'));
 const result=await f.sandbox.fixedStartupFailure();assert.equal(f.starts,1);assert.equal(result.failed,true);assert.equal(result.observedExitCode,42);
 await assert.rejects(f.sandbox.fixedStartupFailure(),/startup-never-replay/);assert.equal(f.starts,1);
 const unknown=startupFixture({status:'stopped'},{status:'stopped'},Error('transport-timeout'));
 assert.equal((await unknown.sandbox.fixedStartupFailure()).failed,false);assert.equal(unknown.starts,1);
});
