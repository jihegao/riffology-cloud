import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {initial} from './browser-preview-initial-fixture.mjs';

test('real SQLite confirmed-ready atomic admission restarts into automatic private R2 package without GET',{timeout:25000},async()=>{
 const f=await initial(),dir=await mkdtemp(join(tmpdir(),'preview-initial-'));
 const entry=`import {DurableObject} from 'cloudflare:workers';
 import {DurableWorkspaceStore} from './services/workspace/store.ts';
 import {BrowserPreviewBuildHost} from './services/browser-preview/build-host.ts';
 import {InitialWorkspaceResolver} from './services/turn-runtime/initial-workspace.ts';
 import {productionPreviewRegistry} from './services/browser-preview/production-registry.ts';
 import {checkpointKey} from './services/runtime/core.ts';
 import {modelContentKey} from './services/runtime/content.ts';
 import {BROWSER_BUILD_WAKE_KEY} from './services/workspace/shared-alarm.ts';
 const scope=${JSON.stringify(f.f.scope)};
 export class Host extends DurableObject{
  build(){return new BrowserPreviewBuildHost(this.ctx.storage,scope,{registry:productionPreviewRegistry,bucket:this.env.CHECKPOINTS,files:async()=>{throw Error('no-saved-source');},resolveInitial:source=>new InitialWorkspaceResolver(this.env.CHECKPOINTS,this.env.MODELS).resolve(source.reference,scope),checkSource:source=>{const state=new DurableWorkspaceStore(this.ctx.storage).read();if(JSON.stringify(state.task)!==JSON.stringify(source.reference.task))throw Error('source-changed');}});}
  async alarm(){await this.build().alarm();const row=this.build().read(await this.ctx.storage.get('browser-preview:initial-source'));await this.ctx.storage.put('alarm-proof',{status:row?.state.status,sourceKind:row?.source.kind,sourceSha:row?.source.filesSha256,turnJournal:await this.ctx.storage.get('m2:turn-journal')??null});await this.ctx.storage.sync();}
  async act(body){
   if(body.action==='ready'){
    const state=body.state;await this.env.MODELS.put(modelContentKey(state.task.modelContent),Uint8Array.from(body.content));await this.env.CHECKPOINTS.put(checkpointKey(state.identity),body.checkpoint.text);
    const real=new DurableWorkspaceStore(this.ctx.storage);await real.update(()=>({...state,projectionConfirmed:false}));
    // Delay platform alarm delivery only, allowing process restart before it
    // fires. Production logical wake and initial source bytes are unchanged.
    const wrapped={sql:this.ctx.storage.sql,kv:this.ctx.storage.kv,sync:()=>this.ctx.storage.sync(),transaction:op=>this.ctx.storage.transaction(tx=>op(new Proxy(tx,{get:(target,key)=>key==='setAlarm'?async at=>{await target.setAlarm(Math.max(at,Date.now()+2000));if(body.fail)throw Error('injected-after-physical-alarm');}:typeof target[key]==='function'?target[key].bind(target):target[key]})))};
    let error=null;try{await new DurableWorkspaceStore(wrapped).update(()=>state);}catch(e){error=e.message;}
    const afterFailure={confirmed:real.read().projectionConfirmed,index:await this.ctx.storage.get('browser-preview:initial-source')??null,wake:await this.ctx.storage.get(BROWSER_BUILD_WAKE_KEY)??null,alarm:await this.ctx.storage.getAlarm()};
    if(body.fail){body.fail=false;await new DurableWorkspaceStore({...wrapped,transaction:op=>this.ctx.storage.transaction(tx=>op(new Proxy(tx,{get:(target,key)=>key==='setAlarm'?async at=>target.setAlarm(Math.max(at,Date.now()+2000)):typeof target[key]==='function'?target[key].bind(target):target[key]})))}).update(()=>state);}
    return {error,afterFailure,revision:await this.ctx.storage.get('browser-preview:initial-source'),alarm:await this.ctx.storage.getAlarm()};
   }
   const revision=await this.ctx.storage.get('browser-preview:initial-source'),row=this.build().read(revision);return {proof:await this.ctx.storage.get('alarm-proof'),row,alarm:await this.ctx.storage.getAlarm(),objects:(await this.env.CHECKPOINTS.list({prefix:'tenants/'})).objects.map(x=>x.key)};
  }
 }
 export default {async fetch(req,env){return Response.json(await env.HOST.getByName('initial').act(await req.json()));}};`;
 const bundled=await build({stdin:{contents:entry,sourcefile:'preview-initial.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'}),name='preview-initial';
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{HOST:{type:'durable-object',worker:name,exportName:'Host'},CHECKPOINTS:{type:'r2',name:'initial-checkpoints'},MODELS:{type:'r2',name:'initial-models'}},exports:{Host:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response(null,{status:403})}}}]};
 let mf;const act=async body=>{const r=await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify(body)}),text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
 try{
  mf=new Miniflare(options);const ready=await act({action:'ready',state:f.state,content:[...f.content],checkpoint:f.checkpoint,fail:true});assert.equal(ready.error,'injected-after-physical-alarm');assert.deepEqual(ready.afterFailure,{confirmed:false,index:null,wake:null,alarm:null});assert.equal(ready.revision,f.revision);assert.ok(ready.alarm>Date.now());
  await mf.dispose();mf=new Miniflare(options);await mf.ready;await new Promise(resolve=>setTimeout(resolve,4000));
  const read=await act({action:'read'});assert.equal(read.proof.status,'ready');assert.equal(read.proof.sourceKind,'initial-workspace');assert.equal(read.proof.turnJournal,null);assert.match(read.proof.sourceSha,/^[a-f0-9]{64}$/);assert.equal(read.row.receipt.trust,'verified-platform');assert.equal(read.alarm,null);assert.equal(read.objects.length,1);
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
