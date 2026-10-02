import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},actor={userId:'invitee',authVersion:1};
const plan={source:{kind:'saved-turn',identity:{scope,sessionId:'s',turnId:'t',dispatchId:'d',generation:1},revision:{revisionId:'rev',objectKey:'saved',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1}},spec:{schemaVersion:1,researchQuestion:'q',scope:'s',entities:['e'],mechanisms:['m'],assumptions:[],parameters:{x:{type:'integer',default:1}},metrics:{value:{}},limitations:[],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}},specSha256:'c'.repeat(64),entrypointSha256:'d'.repeat(64),dependencyLockSha256:'e'.repeat(64)};
test('Workerd cold preparation exceeds 15s; cancellation, kill, restart and lost start/release ACKs retain their fences',{timeout:60000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'simulation-preparation-'));
 const source=`import {DurableObject} from 'cloudflare:workers';import {SimulationHost} from './services/simulation/host.ts';import {SqlTenantQuota} from './services/quota/core.ts';
 const scope=${JSON.stringify(scope)},actor=${JSON.stringify(actor)},plan=${JSON.stringify(plan)};
 export class Sim extends DurableObject{
  h=null;clock=()=>this.ctx.storage.kv.get('clock')??Date.now();
  count(key){this.ctx.storage.kv.put(key,(this.ctx.storage.kv.get(key)??0)+1);}
  host(){return this.h??=new SimulationHost(this.ctx.storage,scope,{quota:{acquire:r=>new SqlTenantQuota(this.ctx.storage,{tenantId:'tenant',capacity:1,version:'v1'},this.clock).acquire(r),lookup:(_t,id)=>new SqlTenantQuota(this.ctx.storage,{tenantId:'tenant',capacity:1,version:'v1'},this.clock).lookup(id),dispatch:r=>new SqlTenantQuota(this.ctx.storage,{tenantId:'tenant',capacity:1,version:'v1'},this.clock).dispatch(r),confirmStopped:async(r,p)=>{const result=await new SqlTenantQuota(this.ctx.storage,{tenantId:'tenant',capacity:1,version:'v1'},this.clock).confirmStopped(r,p);if(this.ctx.storage.kv.get('loseRelease')){this.ctx.storage.kv.put('loseRelease',false);throw Error('lost-release-ack');}return result;}},
   prepare:async(_input,check)=>{this.count('prepares');this.ctx.storage.kv.put('entered',Date.now());if(this.ctx.storage.kv.get('mode')==='cold')await new Promise(r=>setTimeout(r,16050));else while(!this.ctx.storage.kv.get('finish')){await new Promise(r=>setTimeout(r,100));await check();}await check();},
   start:async()=>{this.count('starts');if(this.ctx.storage.kv.get('loseStart'))throw Error('lost-start-ack');return {status:'running',result:null,stop:null};},
   observe:async()=>{this.count('observes');return {status:'running',result:null,stop:null};},
   stop:async()=>{this.count('stops');return {status:'stopped',result:null,stop:{confirmationId:'a'.repeat(64),observedAt:this.clock(),fenced:true}};},
   destroy:async()=>{this.count('destroys');},running:async()=>false,publish:async()=>{throw Error('unexpected-publish');},authorize:async()=>!this.ctx.storage.kv.get('kill'),unknownRun:async()=>{this.count('unknown');},hold:p=>this.ctx.waitUntil(p)},this.clock,{durationMs:100000,releaseGuardMs:20,quietMs:10});}
  async alarm(){await this.host().alarm();}
  async fetch(req){const b=await req.json();if(b.op==='flags'){for(const [k,v]of Object.entries(b.flags))this.ctx.storage.kv.put(k,v);return Response.json({ok:true});}if(b.op==='submit'){const run=await this.host().submit(actor,'key',b.request,plan,'image',()=>true);return Response.json(run);}if(b.op==='wake'){await this.host().alarm();return Response.json({ok:true});}if(b.op==='cancel'){await this.host().cancel(b.id);return Response.json({ok:true});}if(b.op==='get')return Response.json(await this.host().get(b.id));return Response.json(Object.fromEntries(['starts','prepares','stops','observes','unknown','destroys','entered'].map(k=>[k,this.ctx.storage.kv.get(k)??0])));}
 }
 export default{async fetch(req,env){const name=new URL(req.url).pathname.slice(1);return env.SIM.getByName(name).fetch(req)}}`;
 const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'simulation-preparation.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:'prep-test',compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{SIM:{type:'durable-object',worker:'prep-test',exportName:'Sim'}},exports:{Sim:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false}}]};
 let mf;const call=async(name,body)=>{const response=await mf.dispatchFetch('http://sim.test/'+name,{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 const until=async(fn,ms=3000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,50));}assert.fail('state deadline exceeded');};
 const request={revisionId:'rev',filesSha256:'a'.repeat(64),specSha256:'c'.repeat(64),parameters:{x:2},seed:42};
 try{
  mf=new Miniflare(options);
  await call('cold',{op:'flags',flags:{mode:'cold'}});const cold=await call('cold',{op:'submit',request});await call('cold',{op:'wake'});await until(async()=> (await call('cold',{op:'stats'})).entered);
  await new Promise(r=>setTimeout(r,15100));const preparing=await call('cold',{op:'get',id:cold.runId});assert.equal(preparing.status,'preparing');assert.equal(preparing.startClaimed,false);assert.equal(preparing.dispatchClaimed,false);assert.equal((await call('cold',{op:'stats'})).unknown,0);
  await until(async()=>{await call('cold',{op:'wake'});return (await call('cold',{op:'get',id:cold.runId})).status==='running';});assert.equal((await call('cold',{op:'stats'})).starts,1);
  for(const mode of ['cancel','kill']){
   const run=await call(mode,{op:'submit',request});await call(mode,{op:'wake'});await until(async()=>(await call(mode,{op:'stats'})).entered);
   if(mode==='cancel')await call(mode,{op:'cancel',id:run.runId});else await call(mode,{op:'flags',flags:{kill:true}});
   await call(mode,{op:'wake'});await until(async()=>(await call(mode,{op:'get',id:run.runId})).stop);await call(mode,{op:'wake'});await new Promise(r=>setTimeout(r,25));await call(mode,{op:'wake'});
   await until(async()=>{await call(mode,{op:'wake'});return (await call(mode,{op:'get',id:run.runId})).released;});
   const end=await call(mode,{op:'get',id:run.runId});assert.equal(end.status,'cancelled');assert.equal(end.released,true);assert.ok(end.failure);assert.equal(end.result,null);assert.equal((await call(mode,{op:'stats'})).starts,0);
  }
  const interrupted=await call('restart',{op:'submit',request});await call('restart',{op:'wake'});await until(async()=>(await call('restart',{op:'stats'})).entered);await mf.dispose();mf=new Miniflare(options);await call('restart',{op:'wake'});assert.equal((await call('restart',{op:'get',id:interrupted.runId})).failure.code,'simulation-preparation-interrupted');assert.equal((await call('restart',{op:'stats'})).prepares,1);assert.equal((await call('restart',{op:'stats'})).starts,0);
  await call('lost',{op:'flags',flags:{finish:true,loseStart:true}});const lost=await call('lost',{op:'submit',request});await call('lost',{op:'wake'});await until(async()=>(await call('lost',{op:'get',id:lost.runId})).preparation?.readyAt);await call('lost',{op:'wake'});const failure=(await call('lost',{op:'get',id:lost.runId})).failure;assert.equal(failure.code,'lost-start-ack');await mf.dispose();mf=new Miniflare(options);await call('lost',{op:'wake'});assert.equal((await call('lost',{op:'stats'})).starts,1);assert.ok((await call('lost',{op:'stats'})).observes>=1);
  await call('lost',{op:'cancel',id:lost.runId});await call('lost',{op:'wake'});await call('lost',{op:'wake'});await new Promise(r=>setTimeout(r,25));await call('lost',{op:'flags',flags:{loseRelease:true}});await call('lost',{op:'wake'});assert.equal((await call('lost',{op:'get',id:lost.runId})).released,false);await mf.dispose();mf=new Miniflare(options);await call('lost',{op:'wake'});const end=await call('lost',{op:'get',id:lost.runId});assert.equal(end.released,true);assert.deepEqual(end.failure,failure);assert.equal(end.status,'cancelled');
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
