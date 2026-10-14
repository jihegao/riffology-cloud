import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const actor={userId:'reviewer',authVersion:3};
const scope=(suffix='copy')=>({tenantId:'tenant-reviewer',projectId:`project-${suffix}`,workspaceId:`workspace-${suffix}`,workspaceGeneration:1});
const sha=value=>value.repeat(64);
const source={modelVersionId:'submission-fire',modelId:'netlogo-fire-python-beta',version:'0.1.0',contentSha256:sha('a'),revisionId:'author-revision',filesSha256:sha('b'),specSha256:sha('c')};
const workerSource=`
 import {ManagedProductRuntime as Base} from './services/turn-runtime/managed-product.ts';
 import {managedProductActorName} from './services/workspace/managed-route.ts';
 import {SqlExecutionBindingStore} from './services/turn-runtime/backend-contract.ts';
 export class ManagedProductRuntime extends Base {
  async footprint(){return {kv:Array.from(this.ctx.storage.kv.list(),([key])=>key).sort(),tables:this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name").toArray().map(row=>row.name)};}
  async seedHistory(){this.ctx.storage.kv.put('turn:historical',{unknown:true});await this.ctx.storage.sync();}
  async seedBinding(scope){const identity={scope,sessionId:'session-old',turnId:'turn-old',dispatchId:'dispatch-old',generation:1};await new SqlExecutionBindingStore(this.ctx.storage).reserve({schemaVersion:1,identity,backend:'managed-agents',inputSha256:'d'.repeat(64),reservedAt:1,remoteSessionId:null,remoteTurnId:null});}
  async seedUnsettled(scope,kind){const policy={schemaVersion:2,policyId:'owner-online-test',scope,userId:'reviewer',enabled:true,syntheticOnly:false,maxTurns:null,maxSessions:null,observedStopUsd:null,maxDurationMs:null,maxTurnObservationMs:300000,maxSimulationRuns:null};this.ctx.storage.kv.put('budget',{policy,startedAt:1,stopped:null,simulations:[]});this.ctx.storage.kv.put('turn:unsettled',{reserved:true,closed:false,cleanupRequested:kind==='cleanup',observation:kind==='unknown'?{execution:'unknown'}:{execution:'completed'},cost:null});await this.ctx.storage.sync();}
 }
 export default {async fetch(request,env){const body=await request.json(),stub=env.MANAGED.getByName(managedProductActorName(body.scope));try{let value;if(body.action==='readiness')value=await stub.simulationReadiness(body.scope,body.actor);else if(body.action==='reserve')value=await stub.reserveSimulation(body.scope,body.runId,body.actor);else if(body.action==='status')value=await stub.budgetStatus(body.scope);else if(body.action==='footprint')value=await stub.footprint();else if(body.action==='seed-history')value=await stub.seedHistory();else if(body.action==='seed-binding')value=await stub.seedBinding(body.scope);else if(body.action==='seed-unsettled')value=await stub.seedUnsettled(body.scope,body.kind);else throw Error('unknown-action');return Response.json({ok:true,value});}catch(error){return Response.json({ok:false,error:error.message});}}};`;

async function migrate(db){
 for(const file of ['0001_catalog.sql','0006_model_catalog.sql','0009_model_submissions.sql','0012_project_archives.sql']){
  const sql=(await readFile(`services/catalog/migrations/${file}`,'utf8')).replace(/--[^\n]*/g,'');
  for(const statement of sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(statement.trim())await db.prepare(statement).run();
 }
}
async function seedCatalog(db){
 const statements=[
  ["INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,status,auth_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",['author','test','author','author@example.test','active',1,1,1]],
  ["INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,status,auth_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",['reviewer','test','reviewer','reviewer@example.test','active',3,1,1]],
  ["INSERT INTO catalog_tenants(id,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,?,?)",['tenant-author','author','active',1,1]],
  ["INSERT INTO catalog_tenants(id,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,?,?)",['tenant-reviewer','reviewer','active',1,1]],
  ["INSERT INTO catalog_memberships(tenant_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?)",['tenant-author','author','owner','active',1,1]],
  ["INSERT INTO catalog_memberships(tenant_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?)",['tenant-reviewer','reviewer','owner','active',1,1]],
  ["INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?)",['reviewer','operator','active',1,1]],
  ["INSERT INTO catalog_projects(id,tenant_id,owner_user_id,workspace_id,title,starter_version,status,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",['project-author','tenant-author','author','workspace-author','Author source','blank-v1','ready',1,1,1]],
  ["INSERT INTO catalog_workspaces(id,project_id,tenant_id,owner_user_id,status,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",['workspace-author','project-author','tenant-author','author','ready',1,1,1]],
  ["INSERT INTO catalog_model_versions(id,model_id,version,status,title,description,starter_version,content_ref,content_sha256,last_transition_id,created_by,created_at,validated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[source.modelVersionId,source.modelId,source.version,'published','Fire','Reviewed Fire candidate','blank-v1','publication/fire',source.contentSha256,'publish-fire','reviewer',1,2,3]],
  ["INSERT INTO catalog_model_submissions(id,tenant_id,project_id,workspace_id,workspace_generation,created_by,model_id,version,title,description,snapshot_json,status,review_note,reviewed_by,model_version_id,created_at,updated_at,last_intent_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[source.modelVersionId,'tenant-author','project-author','workspace-author',1,'author',source.modelId,source.version,'Fire','Reviewed Fire candidate',JSON.stringify({contentSha256:source.contentSha256,version:{revisionId:source.revisionId,filesSha256:source.filesSha256,specSha256:source.specSha256}}),'published','approved','reviewer',source.modelVersionId,1,3,'review-fire']],
  ["INSERT INTO catalog_submission_intents(id,actor_user_id,operation,idempotency_key,payload_hash,submission_id,created_at) VALUES(?,?,?,?,?,?,?)",['review-fire','reviewer','submission.review','approve-fire',sha('e'),source.modelVersionId,2]],
  ["INSERT INTO catalog_submission_reviews(id,submission_id,actor_user_id,decision,note,created_at) VALUES(?,?,?,?,?,?)",['review-fire',source.modelVersionId,'reviewer','approve','approved',2]],
 ];
 for(const [sql,values] of statements)await db.prepare(sql).bind(...values).run();
 for(const suffix of ['copy','history','binding','archived']){
  const s=scope(suffix);
  await db.prepare("INSERT INTO catalog_projects(id,tenant_id,owner_user_id,workspace_id,title,starter_version,status,generation,created_at,updated_at,source_model_version_id,source_model_id,source_model_version,source_digest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(s.projectId,s.tenantId,'reviewer',s.workspaceId,'Fire copy','blank-v1','ready',1,4,4,source.modelVersionId,source.modelId,source.version,source.contentSha256).run();
  await db.prepare("INSERT INTO catalog_workspaces(id,project_id,tenant_id,owner_user_id,status,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(s.workspaceId,s.projectId,s.tenantId,'reviewer','ready',1,4,4).run();
 }
}
async function fixture(){
 const bundle=await build({stdin:{contents:workerSource,sourcefile:'managed-reviewed-copy-fixture.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const directory=await mkdtemp(join(tmpdir(),'managed-reviewed-copy-')),worker='managed-reviewed-copy-test';let outbound=0;
 const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},logRequests:false,resourcePersistencePath:directory,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{CATALOG:{type:'d1',id:'catalog',name:'catalog'},MANAGED:{type:'durable-object',worker,exportName:'ManagedProductRuntime'},MANAGED_TURN_RUNTIME:{type:'durable-object',worker,exportName:'ManagedProductRuntime'},MANAGED_TESTING_JSON:{type:'text',value:JSON.stringify({schemaVersion:2,policyId:'owner-online-test',tenantId:'tenant-reviewer',userId:'reviewer',enabled:true})}},exports:{ManagedProductRuntime:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler(){outbound++;return new Response('denied',{status:403});}}}}]});
 await mf.ready;const db=await mf.getD1Database('CATALOG',worker);await migrate(db);await seedCatalog(db);
 return {db,outbound:()=>outbound,async call(body){const response=await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();},async close(){await mf.dispose();await rm(directory,{recursive:true,force:true});}};
}

test('reviewed copied project gets one read-only-probed native Run reservation and no provider request',{timeout:60000},async t=>{
 const f=await fixture();t.after(()=>f.close());const target=scope(),initial=await f.call({action:'footprint',scope:target});assert.equal(initial.ok,true,JSON.stringify(initial));const before=initial.value;
 assert.deepEqual(before,{kv:[],tables:[]});
 const ready=await f.call({action:'readiness',scope:target,actor});assert.equal(ready.ok,true,JSON.stringify(ready));assert.deepEqual(ready.value,{schemaVersion:1,mode:'reviewed-copy-first-run',allowed:true,scope:target,source,maxDistinctRuns:1,remainingDistinctRuns:1});
 assert.deepEqual((await f.call({action:'footprint',scope:target})).value,before);assert.equal(f.outbound(),0);
 const reserved=await f.call({action:'reserve',scope:target,actor,runId:'run-fire'});assert.deepEqual(reserved,{ok:true,value:{reserved:true}});assert.equal(f.outbound(),0);
 const after=await f.call({action:'readiness',scope:target,actor});assert.equal(after.ok,true);assert.equal(after.value.allowed,false);assert.equal(after.value.remainingDistinctRuns,0);
 await f.db.prepare("UPDATE catalog_platform_roles SET status='revoked',updated_at=6 WHERE user_id='reviewer'").run();assert.equal((await f.call({action:'reserve',scope:target,actor,runId:'run-fire'})).error,'managed-reviewed-copy-denied');
 await f.db.prepare("UPDATE catalog_platform_roles SET status='active',updated_at=7 WHERE user_id='reviewer'").run();
 assert.deepEqual(await f.call({action:'reserve',scope:target,actor,runId:'run-fire'}),reserved);
 assert.equal((await f.call({action:'reserve',scope:target,actor,runId:'run-other'})).error,'managed-reviewed-copy-simulation-limit');
 assert.equal((await f.call({action:'reserve',scope:target,runId:'run-fire'})).error,'managed-reviewed-copy-denied');
 const status=await f.call({action:'status',scope:target});assert.equal(status.value.simulationCount,1);assert.equal(status.value.turnCount,0);assert.equal(status.value.records.length,0);assert.equal(f.outbound(),0);
});

test('reviewed-copy admission fails closed on current catalog authority and any durable history',{timeout:60000},async t=>{
 const f=await fixture();t.after(()=>f.close());const target=scope();
 for(const [sql,values,error] of [
  ["UPDATE catalog_users SET auth_version=4,updated_at=4 WHERE id='reviewer'",[],actor],
  ["UPDATE catalog_platform_roles SET status='revoked',updated_at=4 WHERE user_id='reviewer'",[],actor],
  ["UPDATE catalog_projects SET archived_at=4,archive_epoch=1,updated_at=4 WHERE id=?",[target.projectId],actor],
 ]){
  await f.db.prepare(sql).bind(...values).run();const denied=await f.call({action:'readiness',scope:target,actor:error});assert.equal(denied.ok,false);assert.match(denied.error,/managed-reviewed-copy-denied/);
  if(sql.includes('auth_version'))await f.db.prepare("UPDATE catalog_users SET auth_version=3,updated_at=5 WHERE id='reviewer'").run();
  else if(sql.includes('platform_roles'))await f.db.prepare("UPDATE catalog_platform_roles SET status='active',updated_at=5 WHERE user_id='reviewer'").run();
  else await f.db.prepare("UPDATE catalog_projects SET archived_at=NULL,archive_epoch=2,updated_at=5 WHERE id=?").bind(target.projectId).run();
 }
 assert.equal((await f.call({action:'readiness',scope:target,actor:{...actor,authVersion:2}})).error,'managed-reviewed-copy-denied');
 const history=scope('history');await f.call({action:'seed-history',scope:history});assert.equal((await f.call({action:'readiness',scope:history,actor})).error,'managed-reviewed-copy-not-fresh');
 const binding=scope('binding');await f.call({action:'seed-binding',scope:binding});assert.equal((await f.call({action:'readiness',scope:binding,actor})).error,'managed-reviewed-copy-not-fresh');
 const archived=scope('archived');await f.db.prepare("UPDATE catalog_projects SET archived_at=6,archive_epoch=1,updated_at=6 WHERE id=?").bind(archived.projectId).run();assert.equal((await f.call({action:'readiness',scope:archived,actor})).error,'managed-reviewed-copy-denied');
 for(const kind of ['unknown','cleanup']){const existing=scope(kind);await f.call({action:'seed-unsettled',scope:existing,kind});const blocked=await f.call({action:'readiness',scope:existing,actor});assert.equal(blocked.ok,true);assert.equal(blocked.value.mode,'existing-managed-budget');assert.equal(blocked.value.allowed,false);}
 assert.equal(f.outbound(),0);
});

test('production Workspace exposes a source-bound admission marker and fails closed when the new RPC is unavailable',{timeout:60000},async()=>{
 const entry=`
  import {DurableObject} from 'cloudflare:workers';
  import {WorkspaceAgent as BaseWorkspace} from './services/workspace/durable.ts';
  import {WORKSPACE_STATE_KEY} from './services/workspace/shared-alarm.ts';
  import {workspaceAgentName,canonicalWorkspaceMarker,workspaceDigest} from './services/workspace/protocol.ts';
  import {revisionStoreActorName} from './services/turn-runtime/revision-store-client.ts';
  import {packageManagedCandidate} from './services/turn-runtime/managed-candidate.ts';
  import {workspaceArchiveReader} from './services/turn-runtime/workspace-file-index.ts';
  import {managedCandidateFixture} from './tests/m2/fixtures/managed-candidate.ts';
  import {digest} from './services/simulation/source.ts';
  const published={modelVersionId:'${source.modelVersionId}',modelId:'${source.modelId}',version:'${source.version}',contentSha256:'${source.contentSha256}',revisionId:'${source.revisionId}',filesSha256:'${source.filesSha256}'};
  export class RevisionStore extends DurableObject{
   #candidate(){return managedCandidateFixture('airport','javascript-canvas');}
   async #archive(){return packageManagedCandidate(this.#candidate()).filesArchive;}
   async info(){const bytes=await this.#archive(),spec=workspaceArchiveReader(bytes).read([{path:'model/model-spec.json',maxBytes:32768}]).get('model/model-spec.json');return {filesSha256:await digest(bytes),specSha256:await digest(spec)};}
   async resolveInitial(reference){const info=await this.info();return {reference,referenceSha256:'e'.repeat(64),filesArchive:await this.#archive(),filesSha256:info.filesSha256};}
   async serviceFiles(){return this.#archive();}
  }
  export class Managed extends DurableObject{
   async mode(value){this.ctx.storage.kv.put('mode',value);await this.ctx.storage.sync();}
   async simulationReadiness(scope){const mode=this.ctx.storage.kv.get('mode');if(mode==='unavailable')throw Error('rpc-unavailable');const info=await this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).info();return {schemaVersion:1,mode:'reviewed-copy-first-run',allowed:true,scope,source:{...published,specSha256:mode==='mismatch'?'f'.repeat(64):info.specSha256},maxDistinctRuns:1,remainingDistinctRuns:1};}
  }
  export class Workspace extends BaseWorkspace{
   async seed(scope,actor){const now=Date.now(),task={id:'task-copy',tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,starterVersion:'blank-v1',authVersion:actor.authVersion,createdAt:now,deadlineAt:now+3600000,modelContent:{modelVersionId:published.modelVersionId,modelId:published.modelId,version:published.version,contentRef:'publication/fire',contentSha256:published.contentSha256}},identity={taskId:task.id,tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,runtimeId:'runtime-copy',leaseId:'lease-copy'},markerNonce='nonce-copy',markerSha256=await workspaceDigest(canonicalWorkspaceMarker(identity,markerNonce));this.ctx.storage.kv.put(WORKSPACE_STATE_KEY,{task,identity,markerNonce,runtimeReceipt:{receiptId:'ready-copy',initializedAt:now,layoutVersion:'m1-empty-v1',markerSha256,checkpointRevision:'d'.repeat(64)},phase:'runtime_ready',projection:{outcome:'ready'},projectionConfirmed:true,wakeAt:null,quotaReleased:false});await this.ctx.storage.sync();}
  }
  export class Dummy extends DurableObject{}
  export default{async fetch(request,env){const body=await request.json(),workspace=env.WORKSPACE_AGENT.getByName(workspaceAgentName(body.scope.tenantId,body.scope.workspaceId)),managed=env.MANAGED_TURN_RUNTIME.getByName('managed-product-v1:'+body.scope.tenantId+':'+body.scope.projectId);try{let value;if(body.action==='seed')value=await workspace.seed(body.scope,body.actor);else if(body.action==='mode')value=await managed.mode(body.mode);else value=await workspace.modelSpec({scope:body.scope,actor:body.actor});return Response.json({ok:true,value});}catch(error){return Response.json({ok:false,error:error.message});}}};`;
 const bundled=await build({stdin:{contents:entry,sourcefile:'managed-reviewed-copy-workspace.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const directory=await mkdtemp(join(tmpdir(),'managed-reviewed-copy-workspace-')),worker='managed-reviewed-copy-workspace';let outbound=0;
 const classes={WORKSPACE_AGENT:'Workspace',MANAGED_TURN_RUNTIME:'Managed',REVISION_STORE:'RevisionStore',SIMULATION_SANDBOX:'Dummy'};
 const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},logRequests:false,resourcePersistencePath:directory,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{...Object.fromEntries(Object.entries(classes).map(([key,exportName])=>[key,{type:'durable-object',worker,exportName}])),WORKSPACE_CHECKPOINTS:{type:'r2',name:'checkpoints'},M4_SIMULATION_IMAGE:{type:'text',value:'example.invalid/native@sha256:'+'1'.repeat(64)},M2_TURNS_ENABLED:{type:'text',value:'false'},MANAGED_TESTING_JSON:{type:'text',value:JSON.stringify({schemaVersion:2,policyId:'owner-online-test',tenantId:'tenant-reviewer',userId:'reviewer',enabled:true})}},exports:Object.fromEntries(Object.values(classes).map(name=>[name,{type:'durable-object',storage:'sqlite'}]))},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler(){outbound++;return new Response('denied',{status:403});}}}}]});
 const target=scope(),rpc=async body=>(await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({scope:target,actor,...body})})).json();
 try{
  await mf.ready;assert.equal((await rpc({action:'seed'})).ok,true);
  const model=await rpc({action:'model'});assert.equal(model.ok,true,JSON.stringify(model));assert.equal(model.value.canRun,true,JSON.stringify(model));assert.equal(model.value.simulationAdmission.mode,'reviewed-copy-first-run');assert.equal(model.value.simulationAdmission.source.contentSha256,source.contentSha256);assert.equal(model.value.simulationAdmission.currentVersion.revisionId,null);assert.notEqual(model.value.simulationAdmission.currentVersion.filesSha256,source.filesSha256);assert.equal(model.value.simulationAdmission.currentVersion.specSha256,model.value.simulationAdmission.source.specSha256);
  await rpc({action:'mode',mode:'mismatch'});const mismatch=await rpc({action:'model'});assert.equal(mismatch.value.canRun,false);assert.equal(mismatch.value.capabilityReason,'managed-simulation-admission-denied');assert.equal(mismatch.value.simulationAdmission,undefined);
  await rpc({action:'mode',mode:'unavailable'});const unavailable=await rpc({action:'model'});assert.equal(unavailable.value.canRun,false);assert.equal(unavailable.value.capabilityReason,'managed-simulation-admission-unavailable');assert.equal(unavailable.value.simulationAdmission,undefined);assert.equal(outbound,0);
 }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});
