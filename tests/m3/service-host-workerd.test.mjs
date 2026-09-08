import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {spec,scope,actor} from './run-fixture.ts';
import {serviceRunActorName} from '../../services/run/host.ts';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('real Workerd service task survives restart and expires without browser-driven reconciliation',{timeout:30000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'m3-host-'));
 const entry=`import {SqlServiceRunJournal} from './services/run/service.ts';import {DurableObject} from 'cloudflare:workers';import {ServiceRun as Base} from './services/run/durable.ts';
 export {TenantQuota} from './services/quota/durable.ts';
 export class ServiceRun extends Base{async inject(task){new SqlServiceRunJournal(this.ctx.storage,task.scope);this.ctx.storage.sql.exec("CREATE TRIGGER fail_run_create BEFORE INSERT ON service_runs BEGIN SELECT RAISE(ABORT,'injected-journal-failure'); END");}async recover(){this.ctx.storage.sql.exec('DROP TRIGGER fail_run_create');}async diagnostics(){const t=await this.ctx.storage.get('m3:service-task');return {task:t??null,alarm:await this.ctx.storage.getAlarm()};}async wake(){await this.alarm();}}
 export class Runtime extends DurableObject{
 async result(input){const stop=await this.ctx.storage.get('stop');return {reference:input.reference,scope:input.scope,status:stop?'stopped':await this.ctx.storage.get('started')?'healthy':'absent',stop:stop??null};}
 async start(input){if(!await this.ctx.storage.get('stop'))await this.ctx.storage.put('started',true);return this.result(input);}
 async observe(input){return this.result(input);}
 async stop(input){if(!await this.ctx.storage.get('stop'))await this.ctx.storage.put('stop',{reference:input.reference,scope:input.scope,confirmationId:'native-stop',observedAt:Date.now(),fenced:true});return this.result(input);}}
 export default {async fetch(req,env){if(req.method!=='POST')return new Response(null,{status:404});try{const b=await req.json();if(b.method==='quota')return Response.json({ok:true,value:await env.TENANT_QUOTA.getByName('tenant-quota:tenant-a').snapshot('tenant-a')});if(!['accept','snapshot','stop','diagnostics','wake','inject','recover'].includes(b.method))return new Response(null,{status:404});return Response.json({ok:true,value:await env.SERVICE_RUN.getByName(b.name)[b.method](...(b.args??[]))});}catch(e){return Response.json({ok:false,error:e.message});}}};`;
 const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'service-host-test.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const options=enabled=>({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:'service-host-test',compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{M3_SERVICE_ENABLED:{type:'text',value:enabled},TENANT_QUOTA_CAPACITY:{type:'text',value:'2'},TENANT_QUOTA_POLICY_VERSION:{type:'text',value:'test-v1'},SERVICE_RUN:{type:'durable-object',worker:'service-host-test',exportName:'ServiceRun'},SERVICE_RUNTIME:{type:'durable-object',worker:'service-host-test',exportName:'Runtime'},TENANT_QUOTA:{type:'durable-object',worker:'service-host-test',exportName:'TenantQuota'}},exports:{ServiceRun:{type:'durable-object',storage:'sqlite'},Runtime:{type:'durable-object',storage:'sqlite'},TenantQuota:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response(null,{status:403})}}}]});
 let mf;const call=async(name,method,...args)=>{const response=await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({name,method,args})}),r=await response.json();if(!r.ok)throw Error(r.error);return r.value;};
 try{
  mf=new Miniflare(options('false'));const task={runId:'run-a',scope,actor,requestKey:'key-a',spec:{...spec(),maxDurationMs:2000}},name=await serviceRunActorName(task);
  await assert.rejects(call(name,'accept',task),/disabled/);assert.deepEqual(await call(name,'diagnostics'),{task:null,alarm:null});
  await mf.dispose();mf=new Miniflare(options('true'));
  await assert.rejects(call('wrong-actor','accept',task),/actor-scope-denied/);assert.deepEqual(await call('wrong-actor','diagnostics'),{task:null,alarm:null});
  await call(name,'accept',task);assert.equal((await call(name,'diagnostics')).task.runId,task.runId);
  await assert.rejects(call(name,'accept',{...task,requestKey:'other-key'}),/task-conflict/);
  await call(name,'wake');assert.equal((await call(name,'snapshot')).status,'running');assert.equal((await call(name,'quota')).occupied,1);
  await mf.dispose();mf=new Miniflare(options('true'));
  const end=Date.now()+10000;let result;
  do{await wait(100);result=await call(name,'snapshot');}while(result.status!=='failed'&&Date.now()<end);
  assert.equal(result.status,'failed');assert.equal(result.errorCode,'service-deadline');
  const settledEnd=Date.now()+2000;while((await call(name,'diagnostics')).alarm!==null&&Date.now()<settledEnd)await wait(50);
  assert.equal((await call(name,'quota')).occupied,0);assert.equal((await call(name,'diagnostics')).alarm,null);
  await call(name,'accept',task);assert.equal((await call(name,'snapshot')).id,task.runId);assert.equal((await call(name,'snapshot')).status,'failed');
  const second={...task,runId:'run-b'},secondName=await serviceRunActorName(second);
  await call(secondName,'inject',second);await assert.rejects(call(secondName,'accept',second),/journal-failure/);
  const persisted=await call(secondName,'diagnostics');assert.equal(persisted.task.runId,'run-b');assert.ok(persisted.alarm!==null);
  await mf.dispose();mf=new Miniflare(options('true'));assert.equal((await call(secondName,'diagnostics')).task.runId,'run-b');
  await call(secondName,'recover');assert.equal((await call(secondName,'stop')).status,'cancelled');await call(secondName,'wake');assert.equal((await call(secondName,'diagnostics')).alarm,null);assert.equal((await call(secondName,'quota')).occupied,0);

 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
