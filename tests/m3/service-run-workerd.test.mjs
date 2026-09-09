import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
test('service journal persists dispatch and stop fences across actual Workerd restart', {timeout:30_000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'m3-service-workerd-'));
 const entry=`import {DurableObject} from 'cloudflare:workers';import {SqlServiceRunJournal} from './services/run/service.ts';
 export class Journal extends DurableObject{
 async call(method,args){if(!['create','get','begin','healthy','unknown','requestStop','confirmStopped'].includes(method))throw Error('unknown-method');
 const journal=new SqlServiceRunJournal(this.ctx.storage,{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1});return journal[method](...args);}}
 export default{async fetch(req,env){if(req.method!=='POST')return new Response(null,{status:404});try{const {method,args}=await req.json();return Response.json({ok:true,value:await env.JOURNAL.getByName('private-test').call(method,args)});}catch(e){return Response.json({ok:false,error:e.message});}}};`;
 const bundle=await build({stdin:{contents:entry,sourcefile:'service-run-test.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:'service-test',compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{JOURNAL:{type:'durable-object',worker:'service-test',exportName:'Journal'}},exports:{Journal:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response(null,{status:403})}}}]};
 let mf;
 const call=async(method,...args)=>{const result=await (await mf.dispatchFetch('http://service.test/',{method:'POST',body:JSON.stringify({method,args})})).json();if(!result.ok)throw Error(result.error);return result.value;};
 try{
  mf=new Miniflare(options);
  const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1};
  const spec={plan:{schemaVersion:1,kind:'service',source:{kind:'saved-turn',identity:{scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'turn-dispatch',generation:1},revision:{revisionId:'revision-a',objectKey:'saved/revision',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1}},declaration:{schemaVersion:1,runtime:'python',entrypoint:'app/main.py',dependencyLock:'app/requirements.lock',port:8080,healthPath:'/health'},declarationSha256:'c'.repeat(64),entrypointSha256:'d'.repeat(64),dependencyLockSha256:'e'.repeat(64)},runtimeImage:'registry.example/runtime@sha256:'+'f'.repeat(64),maxDurationMs:60000};
  const run=await call('create',actor,'request-a',spec),ref={runId:run.id,runtimeId:'runtime-a',dispatchId:'dispatch-a',leaseId:'lease-a',generation:1,deadlineAt:Date.now()+30000};
  const starts=await Promise.all([call('begin',ref),call('begin',ref)]);assert.deepEqual(starts.map(x=>x.dispatch).sort(),[false,true]);
  await mf.dispose();mf=null;mf=new Miniflare(options);
  assert.equal((await call('create',actor,'request-a',spec)).id,run.id);assert.equal((await call('begin',ref)).dispatch,false);
  await call('requestStop',run.id);await assert.rejects(call('healthy',ref),/health-denied/);
  const proof={confirmationId:'stop-a',observedAt:Date.now(),outcome:'stopped',errorCode:null};assert.equal((await call('confirmStopped',ref,proof)).status,'stopped');
  await mf.dispose();mf=null;mf=new Miniflare(options);
  assert.equal((await call('get',run.id)).status,'stopped');assert.equal((await call('confirmStopped',ref,proof)).status,'stopped');
  assert.equal((await call('begin',ref)).dispatch,false);await assert.rejects(call('healthy',ref),/health-denied/);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
