import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('real SQLite rolls back saved journal and build alarm together; restart fires without page request',{timeout:25000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'preview-discovery-'));
 const entry=`import {DurableObject} from 'cloudflare:workers';
 import {DurableTurnStore} from './services/turn/store.ts';
 import {TurnJournal} from './services/turn/journal.ts';
 import {PREVIEW_DISCOVERY_PREFIX} from './services/browser-preview/discovery.ts';
 import {BROWSER_BUILD_WAKE_KEY} from './services/workspace/shared-alarm.ts';
 const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1};
 export class Host extends DurableObject{
  async alarm(){await this.ctx.storage.transaction(async tx=>{const rows=await tx.list({prefix:PREVIEW_DISCOVERY_PREFIX});await tx.put('alarm-proof',{count:rows.size,head:(await tx.get('m2:turn-journal')).workspaceHead.revisionId});await tx.delete(BROWSER_BUILD_WAKE_KEY);await tx.deleteAlarm();});await this.ctx.storage.sync();}
  async act(body){
   const store=new DurableTurnStore(this.ctx.storage),journal=new TurnJournal(store);
   if(body.action==='save'){
    const session=(await journal.createSession(scope,actor,'session-key',{title:'Saved'})).session;
    const turn=(await journal.submit(scope,actor,session.id,'turn-key',{message:'Build'})).turn,claim=(await journal.claim(scope,1)).turn;
    await journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId,runtimeGeneration:1,outcome:'failed'});
    const checkpoint={revisionId:'revision-a',objectKey:'turns/a.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:Date.now()+2000};
    const wrapped={kv:this.ctx.storage.kv,sync:()=>this.ctx.storage.sync(),transaction:op=>this.ctx.storage.transaction(tx=>op(new Proxy(tx,{get:(target,key)=>key==='setAlarm'?async at=>{await target.setAlarm(at);throw Error('injected-after-alarm');}:typeof target[key]==='function'?target[key].bind(target):target[key]})))};
    let error=null;try{await new TurnJournal(new DurableTurnStore(wrapped),()=>Date.now()+3000).commitCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId,runtimeGeneration:1,checkpoint});}catch(e){error=e.message;}
    const afterFailure={head:store.read().workspaceHead,discoveries:(await this.ctx.storage.list({prefix:PREVIEW_DISCOVERY_PREFIX})).size,wake:await this.ctx.storage.get(BROWSER_BUILD_WAKE_KEY),alarm:await this.ctx.storage.getAlarm()};
    await new TurnJournal(store,()=>Date.now()+3000).commitCheckpoint(scope,{turnId:turn.id,dispatchId:claim.dispatchId,runtimeGeneration:1,checkpoint});
    return {error,afterFailure,alarm:await this.ctx.storage.getAlarm(),checkpoint};
   }
   return {proof:await this.ctx.storage.get('alarm-proof'),head:store.read().workspaceHead,alarm:await this.ctx.storage.getAlarm()};
  }
 }
 export default {async fetch(req,env){return Response.json(await env.HOST.getByName('saved').act(await req.json()));}};`;
 const bundle=await build({stdin:{contents:entry,sourcefile:'preview-discovery.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const name='preview-discovery',options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{HOST:{type:'durable-object',worker:name,exportName:'Host'}},exports:{Host:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false}}]};
 let mf;
 const act=async action=>{const r=await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({action})});const text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
 try{
  mf=new Miniflare(options);const saved=await act('save');assert.equal(saved.error,'injected-after-alarm');assert.deepEqual(saved.afterFailure,{head:null,discoveries:0,alarm:null});assert.equal(saved.alarm,saved.checkpoint.committedAt);
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  // No request opens the Durable Object between restart and alarm delivery.
  await new Promise(resolve=>setTimeout(resolve,4000));
  const read=await act('read');assert.deepEqual(read.proof,{count:1,head:'revision-a'});assert.equal(read.head.revisionId,'revision-a');assert.equal(read.alarm,null);
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
