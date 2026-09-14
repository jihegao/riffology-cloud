import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
test('Workerd preparation survives response loss and restart; early cancellation never restores',{timeout:60000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'project-preparation-workerd-'));let mf;
 const bundle=await build({stdin:{contents:`import {DurableObject} from 'cloudflare:workers';
 import {ProjectPreparationLedger} from './services/project-tools/preparation.ts';
 export class Preparation extends DurableObject{ledger=new ProjectPreparationLedger(this.ctx.storage,()=>true);
 async invoke(input){const identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1};const restore=async()=>{this.ctx.storage.kv.put('restores',(this.ctx.storage.kv.get('restores')??0)+1);await this.ctx.storage.sync();await new Promise(r=>setTimeout(r,10));return {sha256:'a'.repeat(64),bytes:10240};};
 let observation;if(input.action==='close')await this.ledger.close(identity);else if(input.action==='observe')observation=this.ledger.observe(identity,'prepare-a');else{try{observation=await this.ledger.prepare(identity,{workspace:null,session:null},'prepare-a',input.deadlineAt,restore);if(input.loseAck)throw Error('lost-ack');}catch(error){return {error:error.message,restores:this.ctx.storage.kv.get('restores')??0};}}return {observation,restores:this.ctx.storage.kv.get('restores')??0};}}
 export default{async fetch(request,env){const input=await request.json();return Response.json(await env.PREP.getByName(input.actor).invoke(input));}};`,resolveDir:fileURLToPath(new URL('../..',import.meta.url)),sourcefile:'project-preparation-workerd.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:'preparation-fixture',compatibilityDate:'2026-09-06',manifest:{mainModule:'entry.mjs',modules:{'entry.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{PREP:{type:'durable-object',worker:'preparation-fixture',exportName:'Preparation'}},exports:{Preparation:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('denied',{status:403})}}}]};
 const deadlineAt=Date.now()+50000,invoke=async(actor,action,loseAck=false)=>{const response=await mf.dispatchFetch('http://fixture.test/',{method:'POST',body:JSON.stringify({actor,action,loseAck,deadlineAt})});assert.equal(response.status,200);return response.json();};
 try{mf=new Miniflare(options);await mf.ready;assert.deepEqual(await invoke('lost','prepare',true),{error:'lost-ack',restores:1});await invoke('cancelled','close');const concurrent=await Promise.all([invoke('concurrent','prepare'),invoke('concurrent','prepare')]);assert.ok(concurrent.every(v=>v.restores===1&&v.observation.status==='ready'));await mf.dispose();mf=new Miniflare(options);await mf.ready;assert.equal((await invoke('lost','observe')).observation.status,'ready');assert.equal((await invoke('lost','prepare')).restores,1);assert.deepEqual(await invoke('cancelled','prepare'),{error:'project-preparation-closed',restores:0});}finally{if(mf)await mf.dispose();await rm(directory,{recursive:true,force:true});}
});
