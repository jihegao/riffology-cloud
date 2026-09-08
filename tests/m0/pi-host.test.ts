import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { handleHostRequest, ORIGIN } from '../../spikes/m0-pi-host/worker.ts';
const hooks = registerHooks({resolve(specifier, context, next) {
 const code = specifier === 'cloudflare:workers' ? 'export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env}}'
 : specifier === '@cloudflare/sandbox' ? 'export class Sandbox{} export class ContainerProxy{} export function getSandbox(){throw Error("unexpected allocation")}'
 : specifier.endsWith('/resource-loading-probe.mjs') ? 'export default "fixed probe source"' : null;
 return code === null ? next(specifier,context) : {url:'data:text/javascript,'+encodeURIComponent(code),shortCircuit:true};
}});
const {M0PiHost} = await import('../../spikes/m0-pi-host/index.ts');hooks.deregister();
function fixture() {
 const values=new Map<string,unknown>(), owned:Promise<unknown>[]=[], calls:string[]=[];
 const storage={kv:{get:<T>(k:string)=>structuredClone(values.get(k)) as T|undefined,put:(k:string,v:unknown)=>{values.set(k,structuredClone(v))}},sync:async()=>{},setAlarm:async()=>{}};
 const ctx={storage,waitUntil:(p:Promise<unknown>)=>owned.push(p)};
 const host=new M0PiHost(ctx as unknown as DurableObjectState,{M0_RUN_ID:'resource-loading-20260906'} as never);
 const sdk={writeFile:async()=>{calls.push('write');return {success:true}},exec:async()=>{calls.push('exec');return {success:true,exitCode:0,stdout:'resource-probe-finished\n'}},readFile:async()=>({success:true,content:JSON.stringify({passed:true})}),destroy:async()=>{calls.push('destroy')}};
 host.sandbox=()=>sdk as unknown as ReturnType<typeof host.sandbox>;
 host.operationMs=10;
 return {host,storage,owned,calls,sdk};
}
test('resource host fences cleanup before accept and rejects altered fixed routes before allocation',async()=>{
 const f=fixture();await f.host.cleanup();await assert.rejects(f.host.accept());assert.deepEqual(f.calls,[]);
 const env={M0_RUN_ID:'resource-loading-20260906',M0_PROBE_TOKEN:'x'.repeat(40)};let calls=0;
 const invoke=async()=>{calls++;return {}};
 assert.equal((await handleHostRequest(new Request(ORIGIN+'/probe/'+env.M0_RUN_ID+'/accept',{method:'POST'}),env,invoke)).status,401);
 for(const suffix of ['other/accept',env.M0_RUN_ID+'/exec',env.M0_RUN_ID+'/accept?command=x'])assert.equal((await handleHostRequest(new Request(ORIGIN+'/probe/'+suffix,{method:'POST',headers:{authorization:'Bearer '+env.M0_PROBE_TOKEN}}),env,invoke)).status,404);
 assert.equal(calls,0);
});
test('resource host runs once and retains closed evidence after cleanup',async()=>{
 const f=fixture();await f.host.accept();await f.host.alarm();await f.host.alarm();await f.host.alarm();
 assert.equal(f.host.state()!.phase,'completed');assert.equal(f.host.state()!.cleanup,'confirmed');assert.equal(f.host.state()!.closed,true);
 assert.deepEqual(f.calls,['write','write','exec','destroy']);await assert.rejects(f.host.accept());
});
test('timeout retains actual RPC ownership until late creation settles then destroys without executing',async()=>{
 const f=fixture();let finish!:(v:{success:boolean})=>void;
 f.sdk.writeFile=()=>new Promise(resolve=>{f.calls.push('pending-write');finish=resolve});
 await f.host.accept();await f.host.alarm();
 assert.equal(f.host.state()!.cleanup,'unconfirmed');assert.equal(f.host.state()!.operation,'write-module');
 await f.host.cleanup();await f.host.alarm();assert.deepEqual(f.calls,['pending-write']);
 finish({success:true});await Promise.all(f.owned);await f.host.alarm();
 assert.equal(f.host.state()!.cleanup,'confirmed');assert.deepEqual(f.calls,['pending-write','destroy']);
});
test('unknown persisted RPC after eviction refuses replay and cleanup claim',async()=>{
 const f=fixture();await f.host.accept();f.host.set({phase:'executing',allocated:true,operation:'execute-probe'});await f.host.alarm();
 assert.equal(f.host.state()!.cleanup,'unconfirmed');assert.equal(f.host.state()!.phase,'failed');assert.deepEqual(f.calls,[]);
});
test('cleanup during RPC fences remaining writes and probe execution',async()=>{
 const f=fixture();f.sdk.writeFile=async()=>{f.calls.push('write');await f.host.cleanup();return {success:true}};
 await f.host.accept();await f.host.alarm();assert.deepEqual(f.calls,['write','destroy']);assert.equal(f.host.state()!.phase,'failed');
});
test('eviction between settled exec and collecting never dispatches exec again',async()=>{
 const f=fixture();await f.host.accept();f.host.set({phase:'executing',allocated:true});f.storage.kv.put('exec-attempted',true);
 await f.host.alarm();assert.deepEqual(f.calls,['destroy']);assert.equal(f.host.state()!.phase,'failed');assert.equal(f.host.state()!.cleanup,'confirmed');
});
