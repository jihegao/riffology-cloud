import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const policy={schemaVersion:1,policyId:'invited-runs-v1',enabled:true,maxActiveRuns:1,maxRunsPerUser:1,maxGroupRuns:8,durationMs:600000,releaseGuardMs:360000,quietMs:30000};
test('actual Workerd/SQLite invited capacity survives restart, gates original Beta authority and isolates globally',{timeout:30000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'invited-run-workerd-'));
 const source=`import {DurableObject} from 'cloudflare:workers';import {InvitedRunCapacity} from './services/simulation/invited-capacity-durable.ts';export {InvitedRunCapacity};
 export class Beta extends DurableObject{async authorizeRunAdmission(scope,actor){if(this.env.BETA_OPEN!=='true'||actor.userId!=='invitee'||actor.authVersion!==1||scope.tenantId!=='tenant'||scope.projectId!=='new-project')throw Error('private-beta-admission-denied');await this.ctx.storage.put('checks',(await this.ctx.storage.get('checks')??0)+1);return {quotaMode:'meter-only'};}async checks(){return await this.ctx.storage.get('checks')??0;}}
 export default{async fetch(request,env){try{const input=await request.json(),capacity=env.INVITED_RUN_CAPACITY.getByName('invited-run-capacity-v1');const result=input.op==='acquire'?await capacity.acquire(input.request,input.actor):input.op==='dispatch'?await capacity.dispatch(input.reference):input.op==='lookup'?await capacity.lookup(input.tenantId,input.operationId):input.op==='stop'?await capacity.confirmStopped(input.reference,input.proof):input.op==='unknown'?await capacity.markUnknown(input.reference):input.op==='resume'?await capacity.resume():input.op==='checks'?await env.PRIVATE_BETA_CAPACITY.getByName('private-beta-capacity-v1').checks():await capacity.snapshot();return Response.json(result??null);}catch(error){return Response.json({error:error.message},{status:409});}}};`;
 const bundle=await build({stdin:{contents:source,sourcefile:'invited-run-workerd.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},workers:[{config:{type:'worker',name:'invited-run-test',compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{INVITED_RUNS_POLICY_JSON:{type:'text',value:JSON.stringify(policy)},BETA_OPEN:{type:'text',value:'true'},PRIVATE_BETA_CAPACITY:{type:'durable-object',worker:'invited-run-test',exportName:'Beta'},INVITED_RUN_CAPACITY:{type:'durable-object',worker:'invited-run-test',exportName:'InvitedRunCapacity'}},exports:{Beta:{type:'durable-object',storage:'sqlite'},InvitedRunCapacity:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{throw Error('unexpected-outbound');}}}}]};
 let mf;const restart=async()=>{await mf?.dispose();mf=new Miniflare(options);await mf.ready;};
 const call=async body=>{const response=await mf.dispatchFetch('https://runs.test/',{method:'POST',body:JSON.stringify(body)});return {status:response.status,value:await response.json()};};
 const actor={userId:'invitee',authVersion:1},request={tenantId:'tenant',projectId:'new-project',workspaceId:'workspace',generation:1,operation:'simulation-run',operationId:'run-a',runId:'run-a',deadlineAt:Date.now()+600000};
 try{
  await restart();assert.equal((await call({op:'acquire',request,actor:{...actor,authVersion:2}})).status,409);
  const first=(await call({op:'acquire',request,actor})).value,reference={...request,leaseId:first.lease.leaseId};await restart();assert.equal((await call({op:'acquire',request,actor})).value.lease.leaseId,reference.leaseId);
  options.workers[0].config.env.BETA_OPEN.value='false';await restart();assert.equal((await call({op:'dispatch',reference})).value.error,'private-beta-admission-denied');assert.equal((await call({op:'lookup',tenantId:'tenant',operationId:'run-a'})).value.lease.status,'held');
  options.workers[0].config.env.BETA_OPEN.value='true';await restart();assert.equal((await call({op:'dispatch',reference})).value.authorized,true);await restart();assert.equal((await call({op:'dispatch',reference})).value.authorized,false);
  await call({op:'unknown',reference});await restart();assert.equal((await call({op:'snapshot'})).value.paused,true);assert.equal((await call({op:'resume'})).status,409);
  assert.equal((await call({op:'acquire',request:{...request,operationId:'bypass',runId:'bypass'},actor})).value.error,'invited-runs-paused');
  const proof={kind:'runtime-stopped',confirmationId:'original-stop',observedAt:Date.now()};assert.equal((await call({op:'stop',reference,proof})).value.released,true);await restart();assert.equal((await call({op:'stop',reference,proof})).value.released,false);assert.equal((await call({op:'snapshot'})).value.paused,true);
  await call({op:'resume'});const next={...request,operationId:'next-run',runId:'next-run'};const queued=(await call({op:'acquire',request:next,actor})).value;const nextRef={...next,leaseId:queued.lease.leaseId};assert.equal((await call({op:'stop',reference:nextRef,proof:{kind:'never-started',confirmationId:'cancel-before-start',observedAt:Date.now()}})).value.released,true);
  const snapshot=(await call({op:'snapshot'})).value;assert.equal(snapshot.occupied,0);assert.equal(snapshot.observed.dispatched,1);assert.equal(snapshot.observed.released,2);assert.ok((await call({op:'checks'})).value>=6);
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
