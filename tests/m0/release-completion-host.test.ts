import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {registerHooks} from 'node:module';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import * as driver from '../../scripts/m0/release-completion-cloud.mjs';
import {restoreCheckpoint} from '../../spikes/m0-storage/checkpoint.ts';
import {R2Blobs} from '../../spikes/m0-storage/adapters.ts';

const {checkCompletion}=driver as unknown as {checkCompletion:(report:unknown,options?:{expectedRuntimeSourceSha256:string})=>void};
const runtimeSource=readFileSync(new URL('../../services/runtime/release-probe.mjs',import.meta.url),'utf8');
const hooks=registerHooks({resolve(specifier,context,next){
 const code=specifier==='cloudflare:workers'?'export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}'
  :specifier==='@cloudflare/sandbox'?'export function getSandbox(){throw Error("unexpected remote allocation")}'
  :specifier.endsWith('/release-probe.mjs')?`export default ${JSON.stringify(runtimeSource)}`:null;
 return code===null?next(specifier,context):{url:'data:text/javascript,'+encodeURIComponent(code),shortCircuit:true};
}});
const {CompletionHost,default:worker,RUN,ORIGIN,SOURCE_PREFIX,SOURCE_REVISION,SOURCE_STATE_SHA}=await import('../../spikes/m0-release-completion/index.ts');
hooks.deregister();
const enc=new TextEncoder();
async function fixture(){
 const values=new Map<string,unknown>(),blobs=new Map<string,Uint8Array>(),events:string[]=[],pending:Promise<unknown>[]=[];
 const storage={kv:{get:<T>(key:string)=>structuredClone(values.get(key)) as T,put:(key:string,value:unknown)=>{values.set(key,structuredClone(value));}},sync:async()=>{},setAlarm:async()=>{},transactionSync:<T>(fn:()=>T)=>fn()};
 const ctx={storage,waitUntil:(p:Promise<unknown>)=>pending.push(p)} as unknown as DurableObjectState;
 const sourceManifest=new Uint8Array(await readFile(new URL('../../docs/evidence/runs/m0-release-upgrade-1788687064356/r2-manifest.json',import.meta.url)));
 const sourceState=new Uint8Array(await readFile(new URL('../../docs/evidence/runs/m0-release-upgrade-1788687064356/r2-state.json',import.meta.url)));
 blobs.set(`${SOURCE_PREFIX}/manifests/${SOURCE_REVISION}`,sourceManifest);blobs.set(`${SOURCE_PREFIX}/blobs/${SOURCE_STATE_SHA}`,sourceState);
 const bucket={put:async(key:string,bytes:Uint8Array)=>{assert.ok(key.startsWith(`m0-release-completion/${RUN}/`));events.push('r2:put');if(!blobs.has(key))blobs.set(key,Uint8Array.from(bytes));},
  get:async(key:string)=>{events.push('r2:get');const bytes=blobs.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}};
 const env={M0_PROBE_TOKEN:'synthetic-completion-operator-'+'x'.repeat(32),CHECKPOINTS:bucket};
 const faultResult={schemaVersion:1,probe:'native-entrypoint-exit-42',phase:'terminal',nativeRunning:false,ownerLost:false,businessDispatches:0,modelDispatches:0,
  intent:{owner:'fixed-owner',startedAt:Date.now()-10,deadlineAt:Date.now()+20000,startReturned:true,monitorAttached:true},closed:false,cleanup:'pending',cleanupAttempts:0,
  result:{outcome:'confirmed',reason:'exit-42',expectedExitCode:42,exitCode:42,monitor:{outcome:'unexpected-exit',exitCode:42,observedAt:Date.now()},nativeRunning:false,readiness:{port:3000,status:'rejected'},recordedAt:Date.now()}};
 const fault={run:async()=>{events.push('fault:run');return structuredClone(faultResult);},cleanup:async()=>{events.push('fault:cleanup');return {...structuredClone(faultResult),closed:true,cleanup:'confirmed'};}};
 const inputs=new Map<string,string>();let counter=0;
 const sdk={writeFile:async(path:string,value:string)=>{events.push('restore:write');inputs.set(path,value);return {success:true};},exec:async(command:string)=>{
  assert.equal(command,'node /workspace/release-probe.mjs < /workspace/release-input.json');
  const input=JSON.parse(inputs.get('/workspace/release-input.json')!);assert.equal(input.directory,'/workspace/m0-release');events.push(`restore:${input.command}`);
  if(input.command==='initialize')counter=input.restore.counter;if(input.command==='increment')counter++;
  return {success:true,exitCode:0,stdout:JSON.stringify({protocol:'m0-v1',format:1,command:input.command,requestId:input.requestId,counter,pid:101,replayed:false,status:input.command==='read'?'observed':'completed',active:null})};
 },destroy:async()=>{events.push('restore:destroy');}};
 const host=new CompletionHost(ctx,env as never);host.sandbox=()=>sdk as never;host.faultStub=()=>fault as never;
 const drive=async()=>{for(let i=0;i<8;i++){await host.alarm();if(host.report().state?.cleanup==='confirmed')break;}};
 return {host,env,ctx,values,blobs,events,sdk,fault,faultResult,drive,pending,sourceManifest,sourceState,bucket};
}
test('fixed completion consumes the prior R2 revision, proves 2 to 3, saves only a new prefix, and cleans in sequence',async()=>{
 const f=await fixture();await f.host.accept();await f.drive();const report=f.host.report();
 assert.equal(report.state?.phase,'completed');assert.equal(report.state.cleanup,'confirmed');assert.equal(report.restoreDestroyed,true);
 checkCompletion(report,{expectedRuntimeSourceSha256:createHash('sha256').update(runtimeSource).digest('hex')});
 for(const tamper of [(r:any)=>{r.sourceSha256='0'.repeat(64);},(r:any)=>{r.fault.result.monitor.exitCode=0;},(r:any)=>{r.fault.result.readiness.status='unconfirmed';},(r:any)=>{r.restored.revision='a'.repeat(64);},(r:any)=>{r.commands[1].replayed=true;},(r:any)=>{r.restoreDestroyed=false;}]){const changed=structuredClone(report);tamper(changed);assert.throws(()=>checkCompletion(changed,{expectedRuntimeSourceSha256:createHash('sha256').update(runtimeSource).digest('hex')}));}
 assert.deepEqual((report.commands as {counter:number}[]).map(c=>c.counter),[2,3,3]);
 assert.ok(f.events.indexOf('fault:cleanup')<f.events.indexOf('restore:write'));assert.ok(f.events.indexOf('r2:put')<f.events.indexOf('restore:destroy'));
 const checkpoint=report.checkpoint as {prefix:string;revision:string;counter:number};assert.equal(checkpoint.counter,3);
 const saved=await restoreCheckpoint(new R2Blobs(f.bucket as never,checkpoint.prefix),checkpoint.revision);
 assert.deepEqual(JSON.parse(new TextDecoder().decode(saved.session)),{schema:1,counter:3});
 assert.deepEqual(f.blobs.get(`${SOURCE_PREFIX}/manifests/${SOURCE_REVISION}`),f.sourceManifest);assert.deepEqual(f.blobs.get(`${SOURCE_PREFIX}/blobs/${SOURCE_STATE_SHA}`),f.sourceState);
 const before=f.events.length;await assert.rejects(f.host.accept(),/already-used/);await f.host.alarm();await f.host.cleanup();assert.equal(f.events.length,before);
});
test('corrupt source bytes reject before allocating the restore VM and retain original source keys',async()=>{
 const f=await fixture();f.blobs.set(`${SOURCE_PREFIX}/blobs/${SOURCE_STATE_SHA}`,enc.encode('corrupt'));
 await f.host.accept();await f.drive();assert.equal(f.host.report().state?.phase,'failed');assert.equal(f.host.report().state?.cleanup,'confirmed');
 assert.equal(f.events.filter(e=>e.startsWith('restore:')).length,0);assert.equal(f.events.includes('r2:put'),false);assert.equal(f.events.filter(e=>e==='fault:cleanup').length,1);
});
test('an unknown native exit cannot advance to source reads or restoration',async()=>{
 const f=await fixture();f.faultResult.result.outcome='unconfirmed';f.faultResult.result.reason='deadline';f.faultResult.result.exitCode=null as never;
 await f.host.accept();await f.drive();assert.equal(f.host.report().state?.phase,'failed');assert.equal(f.host.report().state?.cleanup,'confirmed');assert.deepEqual(f.events,['fault:run','fault:cleanup']);
});
test('a replayed increment cannot create an accepted checkpoint',async()=>{
 const f=await fixture(),exec=f.sdk.exec;f.sdk.exec=async command=>{const r=await exec(command),v=JSON.parse(r.stdout);if(v.command==='increment')v.replayed=true;return {...r,stdout:JSON.stringify(v)};};
 await f.host.accept();await f.drive();assert.equal(f.host.report().state?.phase,'failed');assert.equal(f.host.report().checkpoint,null);assert.equal(f.host.report().restoreDestroyed,true);assert.equal(f.events.includes('r2:put'),false);
});
test('close before accept persists a tombstone without any runtime effects',async()=>{
 const f=await fixture();await f.host.cleanup();await assert.rejects(f.host.accept(),/already-used/);await f.host.alarm();assert.equal(f.host.report().state?.cleanup,'confirmed');assert.deepEqual(f.events,[]);
});
test('close during an unresolved restore write waits for its actual settlement before destroy',async()=>{
 const f=await fixture();await f.host.accept();await f.host.alarm();let settle!:(result:{success:boolean})=>void,started!:()=>void;
 const dispatched=new Promise<void>(resolve=>{started=resolve;});f.sdk.writeFile=async()=>{f.events.push('restore:pending');started();return new Promise(resolve=>{settle=resolve;});};
 const alarm=f.host.alarm();await dispatched;await f.host.cleanup();await f.host.alarm();assert.equal(f.host.report().state?.operation,'restore/write');assert.equal(f.events.includes('restore:destroy'),false);
 settle({success:true});await alarm;await f.drive();assert.equal(f.events.filter(e=>e==='restore:pending').length,1);assert.equal(f.events.filter(e=>e==='restore:destroy').length,1);assert.equal(f.events.includes('restore:initialize'),false);assert.equal(f.host.report().state?.cleanup,'confirmed');
});
test('fixed operator routes reject arbitrary scope, body, methods and unknown actions; closed empty streams work',async()=>{
 const f=await fixture();let calls=0;const env={...f.env,HOST:{getByName:(name:string)=>{assert.equal(name,RUN);return {accept:async()=>{calls++;return {};},report:async()=>({}),cleanup:async()=>({})};}}};
 const url=`${ORIGIN}/probe/${RUN}/accept`,headers={authorization:`Bearer ${env.M0_PROBE_TOKEN}`};
 for(const [target,init,status] of [[url,{method:'POST'},401],[url+'?source=other',{method:'POST',headers},404],[url.replace(ORIGIN,'https://other.example'),{method:'POST',headers},404],[url.replace('/accept','/exec'),{method:'POST',headers},404],[url,{headers},405],[url,{method:'POST',headers,body:'{}'},400]] as const){
  const response=await worker.fetch(new Request(target,init),env as never);assert.equal(response.status,status);assert.ok(!(await response.text()).includes(env.M0_PROBE_TOKEN));
 }
 const body=new ReadableStream<Uint8Array>({start(c){c.close();}});const response=await worker.fetch(new Request(url,{method:'POST',headers,body,duplex:'half'} as RequestInit),env as never);
 assert.equal(response.status,202);assert.equal(calls,1);
});
