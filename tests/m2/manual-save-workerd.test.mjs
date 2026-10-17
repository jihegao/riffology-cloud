import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {manualReceipt} from '../../services/turn-runtime/manual-save.ts';
import {observerRpcData} from '../../services/preview/observer-rpc-data.ts';

test('receipt adapter releases only RPC disposal and keeps unknown symbols forbidden',()=>{
 const receipt={source:'manual-save',revisionId:'a'.repeat(64),objectKey:'manual/test',filesSha256:'b'.repeat(64),sessionSha256:null,committedAt:1};let disposed=0;
 const raw={...receipt,[Symbol.dispose](){disposed++;}};
 assert.throws(()=>manualReceipt(raw),/invalid-manual-save/);
 assert.deepEqual(manualReceipt(observerRpcData(raw)),receipt);assert.equal(disposed,1);
 assert.throws(()=>manualReceipt({...receipt,[Symbol('unknown')]:true}),/invalid-manual-save/);
 assert.throws(()=>observerRpcData({...receipt,[Symbol('unknown')]:true,[Symbol.dispose](){disposed++;}}),/observer-rpc-data-invalid/);assert.equal(disposed,2);
});

test('real Workspace RPC preserves completed GC, blocks unresolved GC, and recovers only original keys after admission stops',{timeout:60000},async()=>{
 const source=`
 import {WorkspaceAgent as BaseWorkspace} from './services/workspace/durable.ts';
 import {RevisionStore as BaseStore} from './services/turn-runtime/revision-store.ts';
 import {initialCheckpoint} from './services/runtime/starter.ts';
 import {checkpointKey} from './services/runtime/core.ts';
 import {canonicalWorkspaceMarker,workspaceDigest,workspaceAgentName} from './services/workspace/protocol.ts';
 export class RevisionStore extends BaseStore {
  async gcForTest(scope){const result=await super.maintainGc({scope,now:Date.now(),minAgeMs:1,pageSize:10,maxObjects:10});this.ctx.storage.sql.exec("UPDATE revision_store_operation SET phase='unknown'");await this.ctx.storage.sync();return result;}
  async gcStateForTest(){return this.ctx.storage.sql.exec('SELECT operation_key,kind,phase,payload_json FROM revision_store_operation').toArray();}
  async blockForTest(mode){
   const row=(await this.gcStateForTest())[0];if(!await this.ctx.storage.get('test:completed-gc'))await this.ctx.storage.put('test:completed-gc',row);
   const original=await this.ctx.storage.get('test:completed-gc'),state=JSON.parse(original.payload_json);
   if(mode==='foreign-completed')state.scope.workspaceId='foreign-workspace';
   else{delete state.result;state.status='unknown';state.phase=mode==='deleting'?'delete_candidates':'scan_manifests';state.deletingKey=mode==='deleting'?'turn-blobs-v3/tenant-alpha/project/workspace/files/'+ 'a'.repeat(64):null;}
   this.ctx.storage.sql.exec('UPDATE revision_store_operation SET kind=?,phase=?,payload_json=?',mode==='commit'?'commit':'gc','unknown',JSON.stringify(state));await this.ctx.storage.sync();return true;
  }
  async unblockForTest(){const row=await this.ctx.storage.get('test:completed-gc');this.ctx.storage.sql.exec('UPDATE revision_store_operation SET kind=?,phase=?,payload_json=?',row.kind,row.phase,row.payload_json);await this.ctx.storage.sync();return true;}

  async commitManual(input){const receipt=await super.commitManual(input);if(input.identity.operationId.startsWith('lost-')&&!await this.ctx.storage.get(input.identity.operationId)){await this.ctx.storage.put(input.identity.operationId,true);await this.ctx.storage.sync();throw Error('synthetic-lost-commit-ack');}return receipt;}
 }
 const fixtureStart=${Date.now()-60000};
 export class WorkspaceAgent extends BaseWorkspace {
  #stop;
  constructor(ctx,env){let enabled=true;super(ctx,{...env,APP_ORIGIN:'https://app.example.test',get MANUAL_SAVE_POLICY_JSON(){return JSON.stringify({schema:'manual-save-policy/v1',enabled,startsAt:fixtureStart,endsAt:fixtureStart+3600000,scope:{tenantId:'tenant-alpha',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},actor:{userId:'alpha',authVersion:1}});}});this.#stop=()=>{enabled=false;};}
  stopNewForTest(){this.#stop();return true;}

  async seed(scope){const task={id:'initial-task',tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:1000,deadlineAt:2000};const identity={taskId:task.id,tenantId:task.tenantId,projectId:task.projectId,workspaceId:task.workspaceId,generation:1,runtimeId:'initial-runtime',leaseId:'initial-lease'},markerNonce='fixture-nonce';const checkpoint=await initialCheckpoint({task,identity,markerNonce});await this.env.WORKSPACE_CHECKPOINTS.put(checkpointKey(identity),checkpoint.text);const runtimeReceipt={receiptId:'initial-ready',initializedAt:1500,layoutVersion:'m1-empty-v1',markerSha256:await workspaceDigest(canonicalWorkspaceMarker(identity,markerNonce)),checkpointRevision:checkpoint.revision};await this.ctx.storage.put('m1:workspace:initialization',{task,identity,markerNonce,runtimeReceipt,projection:{outcome:'ready'},projectionConfirmed:true});await this.ctx.storage.sync();}
  async diagnostics(){const state=await this.ctx.storage.get('m2:turn-journal');return {active:state.activeManualOperation,operations:Object.values(state.manualOperations).map(o=>({key:o.identity.operationId,status:o.status,createdAt:o.createdAt,revisionId:o.receipt?.revisionId??null})),turns:Object.keys(state.turns).length};}
 }
 export default {async fetch(request,env){const b=await request.json(),scope={tenantId:'tenant-alpha',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},actor={userId:'alpha',authVersion:1},stub=env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));try{let value;const store=env.REVISION_STORE.getByName('workspace-revisions-v3:tenant-alpha:project:workspace');if(b.action==='gc')value=await store.gcForTest(scope);else if(b.action==='gc-state')value=await store.gcStateForTest();else if(b.action==='block')value=await store.blockForTest(b.mode);else if(b.action==='unblock')value=await store.unblockForTest();else if(b.action==='stop')value=await stub.stopNewForTest();else if(b.action==='seed')value=await stub.seed(scope);else if(b.action==='state')value=await stub.manualSaveState({scope,actor});else if(b.action==='save')value=await stub.manualSave({scope,actor,key:b.key,body:b.body});else if(b.action==='status')value=await stub.manualSaveStatus({scope,actor,operationId:b.key});else value=await stub.diagnostics();return Response.json({ok:true,value});}catch(e){return Response.json({ok:false,error:e.message});}}};`;
 const bundle=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});
 let outbound=0;const worker='manual-save-workerd';
 const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{CATALOG:{type:'d1',id:'manual-catalog',name:'manual-catalog'},WORKSPACE_AGENT:{type:'durable-object',worker,exportName:'WorkspaceAgent'},REVISION_STORE:{type:'durable-object',worker,exportName:'RevisionStore'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'manual-checkpoints'}},exports:{WorkspaceAgent:{type:'durable-object',storage:'sqlite'},RevisionStore:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{outbound++;return new Response('denied',{status:403});}}}}]});
 const rpc=async body=>{const r=await mf.dispatchFetch('http://localhost/',{method:'POST',body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 try{
  await mf.ready;const db=await mf.getD1Database('CATALOG',worker);
  for(const path of ['0001_catalog.sql','0003_provisioning.sql','0004_operator_invitations.sql','0005_initial_operator.sql','0006_model_catalog.sql','0007_model_content_checks.sql','0010_project_budget_routes.sql','0012_project_archives.sql','0013_manual_save_fence.sql']){
   const sql=(await readFile('services/catalog/migrations/'+path,'utf8')).replace(/--[^\n]*/g,'');for(const statement of sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(statement.trim())await db.prepare(statement).run();
  }
  for(const sql of ["INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES('alpha','fixture','alpha','alpha@example.test',1000,1000)","INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES('tenant-alpha','alpha',1000,1000)","INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES('tenant-alpha','alpha',1000,1000)","INSERT INTO catalog_projects(id,tenant_id,owner_user_id,workspace_id,title,starter_version,status,created_at,updated_at) VALUES('project','tenant-alpha','alpha','workspace','Fixture','blank-v1','ready',1000,1000)","INSERT INTO catalog_workspaces(id,project_id,tenant_id,owner_user_id,status,created_at,updated_at) VALUES('workspace','project','tenant-alpha','alpha','ready',1000,1000)"])await db.prepare(sql).run();
  assert.equal((await rpc({action:'seed'})).ok,true);
  assert.equal((await rpc({action:'gc'})).value.status,'completed');const completedGc=(await rpc({action:'gc-state'})).value;assert.equal(completedGc[0].phase,'unknown');assert.equal(JSON.parse(completedGc[0].payload_json).phase,'completed');
  for(const [key,recover] of [['first',null],['lost-status','status'],['lost-post','save']]){
   const state=await rpc({action:'state'});assert.equal(state.ok,true,JSON.stringify(state));const body={schema:'project.manual-save/v1',base:state.value.base,changes:[{path:'docs/fixture.txt',encoding:'utf8',content:key}],deletes:[],artifacts:[{path:'docs/fixture.txt',title:'Fixture'}]};
   let saved=await rpc({action:'save',key,body});if(recover){assert.equal(saved.ok,false);assert.match(saved.error,/synthetic-lost-commit-ack/);const pending=await rpc({action:'diagnostics'});assert.equal(pending.value.operations.find(o=>o.key===key).status,'pending');saved=await rpc({action:recover,key,body});}
   assert.equal(saved.ok,true,JSON.stringify(saved));assert.equal(saved.value.status,'committed');assert.match(saved.value.revisionId,/^[a-f0-9]{64}$/);
   const again=await rpc({action:'status',key});assert.equal(again.value.revisionId,saved.value.revisionId);
  }
  assert.deepEqual((await rpc({action:'gc-state'})).value,completedGc,'manual saves preserve the completed GC result');
  const state=await rpc({action:'state'}),key='blocked-original',body={schema:'project.manual-save/v1',base:state.value.base,changes:[{path:'acceptance.txt',encoding:'utf8',content:'one bounded recovery'}],deletes:[],artifacts:[]};
  for(const mode of ['unknown','deleting','commit','foreign-completed']){assert.equal((await rpc({action:'block',mode})).ok,true);const blocked=await rpc({action:'save',key,body});assert.equal(blocked.ok,false);assert.match(blocked.error,/revision-store-operation-unavailable/);}
  const pending=(await rpc({action:'diagnostics'})).value.operations.find(o=>o.key===key);assert.equal(pending.status,'pending');
  await rpc({action:'stop'});const forbidden=await rpc({action:'save',key:'new-after-stop',body});assert.equal(forbidden.ok,false);assert.match(forbidden.error,/manual-save-policy-stopped/);
  await rpc({action:'unblock'});const observe=await rpc({action:'status',key});assert.equal(observe.value.status,'pending','GET cannot reconstruct absent original bytes');
  const recovered=await rpc({action:'save',key,body});assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal(recovered.value.status,'committed');
  const duplicate=await rpc({action:'save',key,body});assert.equal(duplicate.value.revisionId,recovered.value.revisionId);
  const settled=(await rpc({action:'diagnostics'})).value.operations.find(o=>o.key===key);assert.equal(settled.createdAt,pending.createdAt);assert.equal(settled.status,'committed');
  assert.deepEqual((await rpc({action:'gc-state'})).value,completedGc);
  const bucket=await mf.getR2Bucket('WORKSPACE_CHECKPOINTS',worker);assert.equal((await bucket.list({prefix:'manual-revisions-v1/'})).objects.length,4,'one immutable manifest per original operation');
  const final=await rpc({action:'diagnostics'});assert.equal(final.value.active,null);assert.equal(final.value.turns,0);assert.equal(final.value.operations.length,4);assert.ok(final.value.operations.every(o=>o.status==='committed'));
  const fences=await db.prepare('SELECT state,terminal_status FROM catalog_manual_save_fences').all();assert.equal(fences.results.length,4);assert.ok(fences.results.every(f=>f.state==='released'&&f.terminal_status==='committed'));assert.equal(outbound,0);
 }finally{await mf.dispose();}
});
