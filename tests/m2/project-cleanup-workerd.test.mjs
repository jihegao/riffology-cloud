import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('Project cleanup never starts native work, including destroy ACK loss and actor restart', {timeout:60000}, async()=>{
  const directory=await mkdtemp(join(tmpdir(),'project-cleanup-'));
  let mf;
  // Exercise the real ProjectToolSandbox, preparation ledger and Turn fence.
  // Only SDK transport is instrumented; this is not a native isolation test.
  const sdk=`import {DurableObject} from 'cloudflare:workers';
    export class Sandbox extends DurableObject {
      async readFile(){return this.startProcess();}
      async writeFile(){return this.startProcess();}
      async getProcess(){return this.startProcess();}
      async getProcessLogs(){return this.startProcess();}
      async startProcess(){this.ctx.storage.kv.put('nativeStarts',(this.ctx.storage.kv.get('nativeStarts')??0)+1);await this.ctx.storage.sync();throw Error('native-call-forbidden');}
      async destroy(){this.ctx.storage.kv.put('destroys',(this.ctx.storage.kv.get('destroys')??0)+1);await this.ctx.storage.sync();if(this.ctx.storage.kv.get('loseDestroyAck')){this.ctx.storage.kv.put('loseDestroyAck',false);await this.ctx.storage.sync();throw Error('destroy-ack-lost');}}
    }
    export class ContainerProxy {}`;
  const entry=`import {ProjectToolSandbox} from './services/sandbox/classes.ts';
    import {sandboxActorIds} from './services/sandbox/identity.ts';
    export class Project extends ProjectToolSandbox {
      async invoke(input){
        if(input.loseAck)this.ctx.storage.kv.put('loseDestroyAck',true);
        let result,error;
        try {
          if(input.action==='abort')result=await this.abortWorkspace(input.identity);
          if(input.action==='prepare')result=await this.prepareWorkspaceOnce(input.identity,{workspace:null,session:null},null,'prepare-a',Date.now()+10000);
          if(input.action==='freeze')result=await this.freezeWorkspace(input.identity,{workspace:null,session:null});
        }catch(caught){error=caught.message;}
        return {result:result??null,error:error??null,nativeStarts:this.ctx.storage.kv.get('nativeStarts')??0,destroys:this.ctx.storage.kv.get('destroys')??0};
      }
    }
    export default {async fetch(request,env){const input=await request.json(),name=(await sandboxActorIds(input.identity.scope,input.identity.turnId,input.identity.dispatchId)).project;return Response.json(await env.PROJECT.getByName(name).invoke(input));}};`;
  const bundle=await build({stdin:{contents:entry,resolveDir:fileURLToPath(new URL('../..',import.meta.url)),sourcefile:'project-cleanup-fixture.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent',plugins:[{name:'instrument-sdk',setup(build){build.onResolve({filter:/^@cloudflare\/sandbox$/},()=>({path:'sdk',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:sdk,loader:'js'}));}}]});
  const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:'cleanup-fixture',compatibilityDate:'2026-09-06',manifest:{mainModule:'entry.mjs',modules:{'entry.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{PROJECT:{type:'durable-object',worker:'cleanup-fixture',exportName:'Project'},M2_PROJECT_EFFECT_CAPABILITY_KEY:{type:'text',value:'fixture-only-project-effect-key-32-bytes'}},exports:{Project:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('denied',{status:403})}}}]};
  const identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1};
  const invoke=async(action,extra={})=>{const response=await mf.dispatchFetch('http://fixture.test/',{method:'POST',body:JSON.stringify({identity,action,...extra})});const body=await response.text();assert.equal(response.status,200,body);return JSON.parse(body);};
  try {
    mf=new Miniflare(options);await mf.ready;
    assert.deepEqual(await invoke('abort',{loseAck:true}),{result:null,error:'destroy-ack-lost',nativeStarts:0,destroys:1});
    await mf.dispose();mf=new Miniflare(options);await mf.ready;
    assert.deepEqual(await invoke('abort'),{result:{running:false,fenced:true},error:null,nativeStarts:0,destroys:2});
    const late=await invoke('prepare');assert.equal(late.error,'turn-sandbox-fenced');assert.equal(late.nativeStarts,0);
    const freeze=await invoke('freeze',{identity:{...identity,turnId:'turn-b',dispatchId:'dispatch-b'}});
    assert.equal(freeze.error,'native-call-forbidden');assert.equal(freeze.nativeStarts,1);assert.equal(freeze.destroys,0);
  } finally {if(mf)await mf.dispose();await rm(directory,{recursive:true,force:true});}
});
