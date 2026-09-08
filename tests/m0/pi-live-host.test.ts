import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { handleLiveRequest, HOST_ORIGIN, LIVE_RUN } from '../../spikes/m0-pi-live/worker.ts';
import { INPUT, OUTPUT, ENTRY, MODULE_DIR, EGRESS_OUTPUT } from '../../spikes/m0-pi-live/child.ts';
import * as liveDriver from '../../scripts/m0/pi-live-cloud.mjs';
// Wrangler declares *.mjs as Text assets; this Node-only test imports the
// actual side-effect-free CLI verifier instead of a bundled Text module.
const {checkLiveReport}=liveDriver as unknown as {checkLiveReport:(value:unknown)=>void};

// Only platform transports are replaced. The release coordinator, pipeline,
// R2 adapter, checkpoint hashes and authority commit all run unchanged.
const hooks = registerHooks({resolve(specifier, context, next) {
 const code=specifier==='cloudflare:workers'?'export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env}}'
  :specifier==='@cloudflare/sandbox'?'export class Sandbox{} export class ContainerProxy{} export function getSandbox(){throw Error("unexpected allocation")}'
  :/\/(?:go-pi-probe|egress-probe)\.mjs$/.test(specifier)?'export default "fixed fixture module source"':null;
 return code===null?next(specifier,context):{url:'data:text/javascript,'+encodeURIComponent(code),shortCircuit:true};
}});
const {M0PiLive,TrustedPiSandbox,ProjectSandbox}=await import('../../spikes/m0-pi-live/index.ts');hooks.deregister();
type VM='project'|'g1'|'g2';
const operator='synthetic-host-operator-'+'h'.repeat(32),proxyOperator='synthetic-proxy-operator-'+'p'.repeat(32);
const capability=(ordinal:number)=>`m0p.${LIVE_RUN}.${String(ordinal).repeat(64)}.${'a'.repeat(64)}`;
const snapshot={schema:1,history:[{role:'user',content:'synthetic remembered marker'}]};
function fixture() {
 const values=new Map<string,unknown>(),objects=new Map<string,Uint8Array>(),owned:Promise<unknown>[]=[],events:string[]=[],writes:{vm:VM;path:string;text:string}[]=[];
 const storage={kv:{get:<T>(key:string)=>structuredClone(values.get(key)) as T|undefined,put:(key:string,value:unknown)=>{values.set(key,structuredClone(value));}},
  sync:async()=>{},setAlarm:async()=>{},transactionSync:<T>(fn:()=>T)=>{const old=new Map(values);try{return fn();}catch(error){values.clear();for(const [k,v] of old)values.set(k,v);throw error;}}};
 const ctx={storage,waitUntil:(p:Promise<unknown>)=>owned.push(p)} as unknown as DurableObjectState;
 let initialized=false,revoked=false,count=0;
 const controls:Request[]=[];
 const status=()=>({initialized,revoked,mode:'go-live-only',activeRequests:0,upstreamDispatchIntents:count,
  rawTokenValueReservedMicrousd:count*461712,cashCharge:null,absoluteCashCapProven:false,ledger:initialized?{dispatchCount:count,heldMicrousd:count*461712,calls:Object.fromEntries(Array.from({length:count},(_,i)=>{
  const n=i+1;return [`call-${n}`,{state:'terminal',dispatchOrdinal:n,payloadHash:`payload-${n}`,platformRequestId:`platform-${n}`,facts:{outcome:n===1?'completed':'cancelled',upstreamResponseId:`upstream-${n}`}}];
 }))}:null});
 const env={M0_PROBE_TOKEN:operator,M0_MODEL_PROXY_OPERATOR_TOKEN:proxyOperator,
  MODEL_PROXY:{fetch:async(request:Request)=>{controls.push(request);const action=new URL(request.url).pathname.split('/').at(-1);events.push(`proxy:${action}`);
   if(action==='alpha'){initialized=true;return Response.json({runId:LIVE_RUN,mode:'go-live-only',expiresAtMs:Date.now()+60000,capabilities:[1,2].map(n=>({callId:`call-${n}`,token:capability(n)}))},{headers:{'x-riffology-m0-mode':'go-live-only'}});}
   if(action==='revoke')revoked=true;
   return Response.json(status(),{headers:{'x-riffology-m0-mode':'go-live-only'}});
  }},
  CHECKPOINTS:{put:async(key:string,bytes:Uint8Array,options:{onlyIf:{etagDoesNotMatch:string}})=>{assert.equal(options.onlyIf.etagDoesNotMatch,'*');events.push('r2:put');if(!objects.has(key))objects.set(key,Uint8Array.from(bytes));},
   get:async(key:string)=>{events.push('r2:get');const bytes=objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}}};
 const host=new M0PiLive(ctx,env as never);host.pipeline.operationMs=1000;
 const child=(vm:VM)=>{const n=vm==='g1'?1:2;return {passed:true,evidenceMode:'go-live-proxy',phase:n===1?'initial':'restored',snapshot:n===1?snapshot:null,
  sdkVersion:'0.85.0',proxyModelTransportAttempts:1,modelTransportAttempts:1,globalFetchCalls:0,wireHistoryMatches:true,restoredHistoryMatches:true,
  duplicatePromptRejected:true,events:[{deltaType:'text_delta'}],billingAmount:null,cancelledWhileActive:n===2,cancellation:n===2?{remote:'acknowledged'}:null,
  inputSnapshotSha256:n===2?host.get('restored-digest'):null,requests:[{path:'/v1/chat/completions',platformRequestId:`platform-${n}`,bodySha256:`payload-${n}`}],responseIds:[`upstream-${n}`]};};
 const sdks=Object.fromEntries((['project','g1','g2'] as VM[]).map(vm=>[vm,{
  writeFile:async(path:string,text:string)=>{events.push(`${vm}:write:${path}`);writes.push({vm,path,text});return {success:true};},
  exec:async(command:string,_options:unknown)=>{events.push(`${vm}:exec:${command}`);if(command===`node ${ENTRY}`)count++;
   return {success:true,exitCode:0,stdout:command===`node ${ENTRY}`?'go-probe-finished\n':command.startsWith('node ')?'egress-probe-finished\n':''};},
  readFile:async(path:string)=>({success:true,content:JSON.stringify(path===EGRESS_OUTPUT?{passed:true,evidenceMode:'cloud-network'}:child(vm))}),
  destroy:async()=>{events.push(`${vm}:destroy`);},
 }])) as Record<VM,{writeFile:(path:string,text:string)=>Promise<{success:boolean}>;exec:(command:string,options:unknown)=>Promise<{success:boolean;exitCode:number;stdout:string}>;readFile:(path:string)=>Promise<{success:boolean;content:string}>;destroy:()=>Promise<void>}>;
 host.sandbox=vm=>sdks[vm] as unknown as ReturnType<typeof host.sandbox>;
 const drain=async()=>{for(let i=0;i<20&&host.pipeline.state()?.cleanup!=='confirmed';i++)await host.alarm();await Promise.all(owned);};
 return {host,env,storage,objects,owned,events,writes,controls,sdks,child,status,drain};
}

test('live host rejects unauthenticated, mutable and nonempty routes before invoking the coordinator',async()=>{
 let calls=0;const invoke=async()=>{calls++;return {};},base=`${HOST_ORIGIN}/probe/${LIVE_RUN}`,headers={authorization:`Bearer ${operator}`};
 assert.equal((await handleLiveRequest(new Request(base+'/accept',{method:'POST'}),operator,invoke)).status,401);
 for(const url of [base+'/exec',base+'/accept?command=id',base.replace(LIVE_RUN,'another-run')+'/accept',base.replace(HOST_ORIGIN,'https://foreign.invalid')+'/accept'])
  assert.equal((await handleLiveRequest(new Request(url,{method:'POST',headers}),operator,invoke)).status,404);
 assert.equal((await handleLiveRequest(new Request(base+'/accept',{headers}),operator,invoke)).status,405);
 assert.equal((await handleLiveRequest(new Request(base+'/accept',{method:'POST',headers,body:'{}'}),operator,invoke)).status,400);
 assert.equal(calls,0);
 const empty=new ReadableStream<Uint8Array>({start(controller){controller.close();}});
 assert.equal((await handleLiveRequest(new Request(base+'/accept',{method:'POST',headers,body:empty,duplex:'half'} as RequestInit),operator,invoke)).status,202);
 assert.equal(calls,1);
 const failed=await handleLiveRequest(new Request(base+'/cleanup',{method:'POST',headers}),operator,async()=>{throw Error(proxyOperator);});
 assert.equal(failed.status,409);assert.ok(!(await failed.text()).includes(proxyOperator));
});

test('live host completes exactly two ordered calls, durably restores R2 after g1 destroy and cleans once',async()=>{
 const f=fixture();await f.host.accept();await f.drain();const report=f.host.report();
 assert.equal(report.state!.phase,'completed');assert.equal(report.state!.cleanup,'confirmed');
 assert.doesNotThrow(()=>checkLiveReport(report));
 assert.deepEqual(report.destroyed,{g1:true,g2:true,project:true});
 const first=f.events.indexOf(`g1:exec:node ${ENTRY}`),destroy=f.events.indexOf('g1:destroy'),second=f.events.indexOf(`g2:exec:node ${ENTRY}`);
 assert.ok(first>=0&&destroy>first&&second>destroy);
 assert.ok(f.events.slice(first,destroy).includes('r2:put'));assert.ok(f.events.slice(destroy,second).includes('r2:get'));
 assert.equal(f.events.filter(e=>e.endsWith(`exec:node ${ENTRY}`)).length,2);
 assert.equal(f.events.filter(e=>e==='proxy:alpha').length,1);assert.equal(f.events.filter(e=>e==='proxy:revoke').length,1);
 assert.equal(f.objects.size,2);assert.equal(f.host.get<{sequence:number}>('current')!.sequence,1);
 const inputs=f.writes.filter(w=>w.path===INPUT).map(w=>({vm:w.vm,value:JSON.parse(w.text)}));
 assert.deepEqual(inputs.map(i=>i.vm),['g1','g2']);assert.equal(inputs[0]!.value.snapshot,undefined);assert.deepEqual(inputs[1]!.value.snapshot,snapshot);
 assert.deepEqual(inputs.map(i=>i.value.invocation.callId),['call-1','call-2']);assert.equal(inputs[0]!.value.invocation.token,capability(1));assert.equal(inputs[1]!.value.invocation.token,capability(2));
 for(const w of f.writes){assert.ok(!w.text.includes(operator));assert.ok(!w.text.includes(proxyOperator));if(w.vm==='project')assert.ok(!w.text.includes('m0p.'));}
 for(const request of f.controls){assert.equal(request.headers.get('authorization'),`Bearer ${proxyOperator}`);assert.equal(request.redirect,'manual');}
 const publicText=JSON.stringify(report);for(const secret of [operator,proxyOperator,capability(1),capability(2)])assert.ok(!publicText.includes(secret));
 const eventCount=f.events.length;await f.host.cleanup();await f.host.alarm();await assert.rejects(f.host.accept(),/already-used/);assert.equal(f.events.length,eventCount);
});

test('cloud verifier rejects invalid budget amounts and changed final receipts from a valid host run',async()=>{
 const f=fixture();await f.host.accept();await f.drain();const report=f.host.report();checkLiveReport(report);
 for(const held of [null,-1,923425,1.5]){
  const changed=structuredClone(report);Object.assign(changed.proxyFinal!,{rawTokenValueReservedMicrousd:held});
  assert.throws(()=>checkLiveReport(changed),`budget ${String(held)} must fail`);
 }
 const heldMismatch=structuredClone(report);Object.assign(heldMismatch.proxyFinal!,{rawTokenValueReservedMicrousd:1});assert.throws(()=>checkLiveReport(heldMismatch));
 for(const callId of ['call-1','call-2'])for(const field of ['payloadHash','platformRequestId','state'] as const){
  const changed=structuredClone(report),final=changed.proxyFinal as ReturnType<typeof f.status>;final.ledger!.calls[callId]![field]='tampered';
  assert.throws(()=>checkLiveReport(changed),`${callId} ${field} must fail`);
 }
 for(const callId of ['call-1','call-2']){
  const changed=structuredClone(report),final=changed.proxyFinal as ReturnType<typeof f.status>;final.ledger!.calls[callId]!.facts.outcome='failed';
  assert.throws(()=>checkLiveReport(changed),`${callId} outcome must fail`);
 }
 const dispatchMismatch=structuredClone(report);(dispatchMismatch.proxyFinal as ReturnType<typeof f.status>).ledger!.dispatchCount=3;
 assert.throws(()=>checkLiveReport(dispatchMismatch));
});

test('restore refuses an undestroyed generation and corrupt R2 contents before writing a second capability',async()=>{
 const f=fixture();await f.host.accept();await f.host.initializeProxy();f.host.put('report/g1',f.child('g1'));await f.host.checkpoint();
 await assert.rejects(f.host.input('g2'),/restore-precondition/);assert.equal(f.writes.length,0);
 f.host.put('destroyed/g1',true);const key=[...f.objects.keys()].find(k=>k.includes('/blobs/'))!;f.objects.set(key,new TextEncoder().encode('corrupt'));
 await assert.rejects(f.host.input('g2'),/corrupt checkpoint/);assert.equal(f.writes.length,0);
});

for(const mismatch of ['payload','platform','upstream','ordinal','outcome'] as const)test(`first receipt ${mismatch} mismatch prevents checkpoint and second model dispatch`,async()=>{
 const f=fixture();const original=f.sdks.g1.readFile;f.sdks.g1.readFile=async path=>{const result=await original(path);if(path!==OUTPUT)return result;
  const report=JSON.parse(result.content);if(mismatch==='payload')report.requests[0].bodySha256='wrong';if(mismatch==='platform')report.requests[0].platformRequestId='wrong';if(mismatch==='upstream')report.responseIds=['wrong'];return {...result,content:JSON.stringify(report)};};
 const originalFetch=f.env.MODEL_PROXY.fetch;f.env.MODEL_PROXY.fetch=async request=>{const response=await originalFetch(request);const body=await response.json() as ReturnType<typeof f.status>;
  const call=body.ledger?.calls['call-1'];if(call&&mismatch==='ordinal')call.dispatchOrdinal=2;if(call&&mismatch==='outcome')call.facts.outcome='cancelled';return Response.json(body,{headers:response.headers});};
 await f.host.accept();await f.drain();assert.equal(f.host.report().state!.phase,'failed');assert.equal(f.host.report().state!.cleanup,'confirmed');
 assert.ok(f.host.get('proxy-1'));assert.ok(f.host.get('proxy-final'));assert.equal(f.objects.size,0);
 assert.equal(f.events.filter(e=>e.endsWith(`exec:node ${ENTRY}`)).length,1);assert.equal(f.writes.filter(w=>w.vm==='g2').length,0);
});

test('diagnostic failure preserves the child and authoritative receipt, then revokes and destroys',async()=>{
 const f=fixture();const original=f.sdks.g1.readFile;f.sdks.g1.readFile=async path=>{const r=await original(path);return path===OUTPUT?{...r,content:JSON.stringify({...JSON.parse(r.content),passed:false})}:r;};
 await f.host.accept();await f.drain();assert.equal(f.host.get<{passed:boolean}>('report/g1')!.passed,false);
 assert.ok(f.host.get('proxy-1'));assert.ok(f.host.get('proxy-final'));assert.equal(f.host.get('proxy-revoked'),true);
 assert.equal(f.host.report().state!.phase,'failed');assert.equal(f.host.report().destroyed.g1,true);assert.equal(f.host.report().destroyed.g2,false);
});

test('negative network report is persisted without initializing the provider',async()=>{
 const f=fixture();f.sdks.project.readFile=async()=>({success:true,content:JSON.stringify({passed:false,evidenceMode:'cloud-network'})});
 await f.host.accept();await f.drain();assert.equal(f.host.get<{passed:boolean}>('report/network/project')!.passed,false);
 assert.equal(f.controls.length,0);assert.deepEqual(f.host.report().destroyed,{project:true,g1:false,g2:false});
});

test('SDK command failures cannot be promoted to successful network evidence or a model dispatch',async()=>{
 const f=fixture();f.sdks.project.exec=async(command)=>{f.events.push(command);return {success:true,exitCode:127,stdout:'egress-probe-finished\n'};};
 await f.host.accept();await f.drain();assert.equal(f.host.report().state!.phase,'failed');assert.equal(f.controls.length,0);assert.equal(f.host.get('report/network/project'),undefined);
 assert.equal(f.host.report().destroyed.project,true);
});

test('secret-bearing child output is rejected before durable public evidence',async()=>{
 for(const leaked of [operator,proxyOperator,capability(1)]){
  const f=fixture();await f.host.accept();f.sdks.g1.readFile=async()=>({success:true,content:JSON.stringify({leaked})});
  await assert.rejects(f.host.execute('g1'),/unsafe-report/);assert.equal(f.host.get('report/g1'),undefined);assert.ok(!JSON.stringify(f.host.report()).includes(leaked));
 }
});

test('late SDK creation remains owned after timeout and is destroyed only after settlement',async()=>{
 const f=fixture();let finish!:(value:{success:boolean;exitCode:number;stdout:string})=>void;
 f.host.pipeline.operationMs=10;
 f.sdks.project.exec=()=>new Promise(resolve=>{f.events.push('project:pending-create');finish=resolve;});
 await f.host.accept();await f.host.alarm();
 assert.equal(f.host.report().state!.operation,'project/mkdir');assert.equal(f.host.report().state!.cleanup,'unconfirmed');
 await f.host.cleanup();await f.host.alarm();assert.deepEqual(f.events,['project:pending-create']);assert.equal(f.controls.length,0);
 finish({success:true,exitCode:0,stdout:''});await Promise.all(f.owned);await f.host.alarm();
 assert.deepEqual(f.events,['project:pending-create','project:destroy']);assert.equal(f.host.report().state!.cleanup,'confirmed');
 assert.equal(f.host.report().state!.phase,'failed');assert.equal(f.writes.length,0);
});

test('both VM classes keep control secrets out of env and enable intercepted allowlisted outbound',()=>{
 for(const Class of [TrustedPiSandbox,ProjectSandbox]){const vm=new Class({} as never,{} as never);assert.deepEqual(vm.envVars,{});assert.equal(vm.enableInternet,false);assert.equal(vm.interceptHttps,true);assert.equal(vm.allowedHosts.length,1);}
 assert.ok(MODULE_DIR.startsWith('/opt/'));
});
