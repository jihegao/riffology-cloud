import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import test from 'node:test';

test('group queue survives actual Workerd alarms and SQLite restart with lost native acknowledgment', {timeout:45000}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'m4-groups-workerd-'));
 const source=`import {DurableObject} from 'cloudflare:workers';
 import {SimulationHost} from './services/simulation/host.ts';import {ExperimentGroupHost} from './services/simulation/groups.ts';import {SqlTenantQuota} from './services/quota/core.ts';
 const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1};
 const plan={source:{kind:'saved-turn',identity:{scope,sessionId:'s',turnId:'t',dispatchId:'d',generation:1},revision:{revisionId:'rev',objectKey:'saved/revision',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1}},spec:{schemaVersion:1,researchQuestion:'q',scope:'s',entities:['e'],mechanisms:['m'],assumptions:[],parameters:{x:{type:'integer',default:1}},metrics:{value:{}},limitations:[],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}},specSha256:'c'.repeat(64),entrypointSha256:'d'.repeat(64),dependencyLockSha256:'e'.repeat(64)};
 export class Sim extends DurableObject{
 host(){return new SimulationHost(this.ctx.storage,scope,{quota:{acquire:r=>new SqlTenantQuota(this.ctx.storage,{tenantId:'tenant-a',capacity:1,version:'v1'}).acquire(r),lookup:(_t,id)=>new SqlTenantQuota(this.ctx.storage,{tenantId:'tenant-a',capacity:1,version:'v1'}).lookup(id),dispatch:r=>new SqlTenantQuota(this.ctx.storage,{tenantId:'tenant-a',capacity:1,version:'v1'}).dispatch(r),confirmStopped:(r,p)=>new SqlTenantQuota(this.ctx.storage,{tenantId:'tenant-a',capacity:1,version:'v1'}).confirmStopped(r,p)},
 start:async input=>{const starts=await this.ctx.storage.get('starts')??[];starts.push(input.runId);await this.ctx.storage.put('starts',starts);const result={status:'stopped',result:{},stop:{confirmationId:'stop-'+input.runId,observedAt:Date.now(),fenced:true}};await this.ctx.storage.put('native:'+input.runId,result);if(starts.length===1)throw Error('lost-native-ack');return result;},
 observe:async input=>await this.ctx.storage.get('native:'+input.runId),stop:async input=>await this.ctx.storage.get('native:'+input.runId),destroy:async()=>{},running:async()=>false,publish:async record=>({metrics:{value:record.input.parameters.x},artifactSha256:'f'.repeat(64)}),authorize:async()=>true,hold:()=>{}},Date.now,{durationMs:30000,releaseGuardMs:1,quietMs:1});}
 groups(host=this.host()){return new ExperimentGroupHost(this.ctx.storage,scope,host,()=>true);}
 async alarm(){const host=this.host();await host.alarm();await this.groups(host).alarm();}
 async fetch(req){const b=await req.json(),groups=this.groups();if(b.op==='submit')return Response.json(await groups.submit(actor,'same',b.request,plan,'image',()=>true));if(b.op==='view')return Response.json(await groups.view(await groups.get(b.id),'a'.repeat(64)));if(b.op==='stats')return Response.json({starts:await this.ctx.storage.get('starts')??[]});return new Response(null,{status:404});}}
 export default{async fetch(req,env){return env.SIM.getByName('one').fetch(req)}}`;
 const bundle=await build({stdin:{contents:source,sourcefile:'groups-workerd.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:'groups-workerd',compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{SIM:{type:'durable-object',worker:'groups-workerd',exportName:'Sim'}},exports:{Sim:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false}}]};
 const request={revisionId:'rev',filesSha256:'a'.repeat(64),specSha256:'c'.repeat(64),hypothesis:'Does x increase value?',baseline:{label:'baseline',parameters:{x:1}},interventions:[{label:'intervention',parameters:{x:2}}],seeds:[42]};let mf;
 try{
  mf=new Miniflare(options);const call=async body=>(await mf.dispatchFetch('http://sim.test/',{method:'POST',body:JSON.stringify(body)})).json();const accepted=await call({op:'submit',request});assert.equal(accepted.children.length,2);assert.equal((await call({op:'stats'})).starts.length,0);
  for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,200));if((await call({op:'stats'})).starts.length===1)break;}
  assert.equal((await call({op:'stats'})).starts.length,1);await mf.dispose();mf=null;mf=new Miniflare(options);
  const replay=await call({op:'submit',request});assert.equal(replay.groupId,accepted.groupId);assert.deepEqual(replay.children,accepted.children);
  let view;for(let i=0;i<130;i++){await new Promise(r=>setTimeout(r,200));view=await call({op:'view',id:accepted.groupId});if(view.status==='completed')break;}
  assert.equal(view.status,'completed');assert.equal(view.progress.completed,2);assert.equal(view.summary[1].metrics.value.delta,1);const starts=(await call({op:'stats'})).starts;assert.deepEqual(starts,accepted.children.map(c=>c.runId));assert.equal(new Set(starts).size,2);
  await mf.dispose();mf=null;mf=new Miniflare(options);assert.equal((await call({op:'view',id:accepted.groupId})).status,'completed');assert.deepEqual((await call({op:'stats'})).starts,starts);
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
