import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

// Actual WorkspaceAgent, durable journal and D1 authorization. Readiness and
// provider/quota responses are explicit fixtures; this test sends no model input.
for(const testing of [false,true])test(`Managed ${testing?'account testing':'acceptance'} Workspace serializes concurrent submissions and exposes only authorized scoped resource evidence`,{timeout:45000},async()=>{
 const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},actor={userId:'owner',authVersion:1};
 const policy={schemaVersion:1,policyId:'issue77-production-v1',scope,userId:'owner',enabled:true,syntheticOnly:true,maxTurns:6,maxSessions:2,observedStopUsd:5,maxDurationMs:7200000,maxTurnObservationMs:300000,maxSimulationRuns:12};
 const entry=`
 import {DurableObject} from 'cloudflare:workers';
 import {WorkspaceAgent as ProductionWorkspace} from './services/workspace/durable.ts';
 import {WORKSPACE_STATE_KEY} from './services/workspace/shared-alarm.ts';
 import {workspaceAgentName} from './services/workspace/protocol.ts';
 export class Workspace extends ProductionWorkspace {
  async legacyPiRouteForTest(){await this.ctx.storage.delete('managed-product-route-v1');}
  async seed(scope){const now=Date.now();await this.ctx.storage.put(WORKSPACE_STATE_KEY,{task:{id:'task',tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,starterVersion:'empty-v1',authVersion:1,createdAt:now,deadlineAt:now+3600000},projection:{outcome:'ready'},projectionConfirmed:true,wakeAt:null});}
  async seedRuns(scope,actor){const common={actor,status:'completed',released:true,releaseProof:{kind:'runtime-stopped',confirmationId:'actual-stored-release',observedAt:123},stop:{confirmationId:'actual-stored-stop',observedAt:122,nativeRunning:false,fenced:true},result:{artifactSha256:'a'.repeat(64)}};await this.ctx.storage.put('simulation:run:own',{...common,scope,runId:'own'});await this.ctx.storage.put('simulation:run:other',{...common,scope:{...scope,projectId:'private-other-project'},runId:'private-other-run'});}
  async alarm(){} // Keep this admission-only test from starting a runtime.
 }
 export class Managed extends DurableObject{
  async preflight(){if(await this.ctx.storage.get('stopped'))throw Error('fixture-budget-stopped');await new Promise(r=>setTimeout(r,30));await this.ctx.storage.put('preflights',(await this.ctx.storage.get('preflights')??0)+1);return {allowed:true};}
  async stop(){await this.ctx.storage.put('stopped',true);}
  async budgetStatus(){return {stopped:await this.ctx.storage.get('stopped')?'managed-usage-unknown':null,unresolved:1,cleanupPending:false,turnCount:0,preflights:await this.ctx.storage.get('preflights')??0};}
 }
 export class Quota extends DurableObject{async snapshot(){return {capacity:2,occupied:1,available:1,unknown:1,configuredPolicyMatches:true,leases:[{status:'unknown',projectId:'private-other-project',operationId:'private-operation'}]};}}
 export class Artifacts extends DurableObject{}
 export default {async fetch(request,env){const {method,...input}=await request.json();try{const stub=env.WORKSPACE_AGENT.getByName(workspaceAgentName(input.scope.tenantId,input.scope.workspaceId));let value;if(method==='stop')value=await env.MANAGED_TURN_RUNTIME.getByName('managed-product-v1:tenant:project').stop();else if(method==='seed')value=await stub.seed(input.scope);else if(method==='seedRuns')value=await stub.seedRuns(input.scope,input.actor);else value=await stub[method](input);return Response.json({ok:true,value});}catch(e){return Response.json({ok:false,error:e.message});}}};`;
 const directory=await mkdtemp(join(tmpdir(),'managed-workspace-')),workerName='managed-workspace';let mf;
 try{
 const bundled=await build({stdin:{contents:entry,sourcefile:'managed-workspace.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const classes={WORKSPACE_AGENT:'Workspace',MANAGED_TURN_RUNTIME:'Managed',TENANT_QUOTA:'Quota',TOOL_ARTIFACT_STORE:'Artifacts'};
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:workerName,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{CATALOG:{type:'d1',id:'catalog',name:'catalog'},M2_TURNS_ENABLED:{type:'text',value:'false'},...(testing?{MANAGED_TESTING_JSON:{type:'text',value:JSON.stringify({schemaVersion:2,policyId:'owner-online-testing',tenantId:scope.tenantId,userId:actor.userId,enabled:true})}}:{MANAGED_ACCEPTANCE_JSON:{type:'text',value:JSON.stringify(policy)}}),...Object.fromEntries(Object.entries(classes).map(([key,exportName])=>[key,{type:'durable-object',worker:workerName,exportName}]))},exports:Object.fromEntries(Object.values(classes).map(name=>[name,{type:'durable-object',storage:'sqlite'}]))},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('disabled',{status:403})}}}]};mf=new Miniflare(options);await mf.ready;
 const db=await mf.getD1Database('CATALOG',workerName),sql=(await readFile('services/catalog/migrations/0001_catalog.sql','utf8')).replace(/--[^\n]*/g,'');for(const statement of sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(statement.trim())await db.prepare(statement).run();
 await db.batch([
 db.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES('owner','test','owner','owner@example.test',1,1)"),
 db.prepare("INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES('tenant','owner',1,1)"),
 db.prepare("INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES('tenant','owner',1,1)"),
 db.prepare("INSERT INTO catalog_projects(id,tenant_id,owner_user_id,workspace_id,title,starter_version,status,created_at,updated_at) VALUES('project','tenant','owner','workspace','synthetic','empty-v1','ready',1,1)"),
 db.prepare("INSERT INTO catalog_workspaces(id,tenant_id,project_id,owner_user_id,status,created_at,updated_at) VALUES('workspace','tenant','project','owner','ready',1,1)")]);
 const rpc=async(method,input={})=>(await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({method,scope,actor,...input})})).json();
 assert.equal((await rpc('seed')).ok,true);
 const created=await rpc('createSession',{key:'session',body:{title:'Synthetic'}});assert.equal(created.ok,true,JSON.stringify(created));const sessionId=created.value.session.id;
 const input={sessionId,key:'first',body:{message:'synthetic FCFS'}};
 const pair=await Promise.all([rpc('submitTurn',input),rpc('submitTurn',{...input,key:'second'})]);assert.equal(pair.filter(r=>r.ok).length,1,JSON.stringify(pair));assert.equal(pair.find(r=>!r.ok).error,'managed-input-in-flight');
 const winner=pair.find(r=>r.ok).value.turn;assert.equal(winner.requestKey,'first');
 await rpc('stop');await mf.dispose();mf=new Miniflare(options);await mf.ready;
 assert.equal((await rpc('submitTurn',{...input,key:'after-restart'})).error,'managed-input-in-flight');
 const replays=await Promise.all([rpc('submitTurn',input),rpc('submitTurn',input)]);for(const replay of replays){assert.equal(replay.ok,true,JSON.stringify(replay));assert.equal(replay.value.replayed,true);assert.equal(replay.value.turn.id,winner.id);}
 assert.equal((await rpc('submitTurn',{...input,body:{message:'different'}})).error,'turn-idempotency-conflict');
 const view=await rpc('turnSnapshot');assert.equal(Object.keys(view.value.turns).length,1);assert.deepEqual(view.value.managedState,{stopped:'managed-usage-unknown',unresolved:1,cleanupPending:false});
 await rpc('seedRuns');const status=await rpc('managedAcceptanceStatus');assert.equal(status.ok,true,JSON.stringify(status));assert.equal(status.value.preflights,1);assert.equal(status.value.resources.simulations.length,1);assert.equal(status.value.resources.simulations[0].releaseProof.confirmationId,'actual-stored-release');assert.equal(status.value.resources.simulations[0].stop.confirmationId,'actual-stored-stop');assert.deepEqual(status.value.resources.tenantQuota,{capacity:2,occupied:1,available:1,unknown:1,configuredPolicyMatches:true,leaseStatusCounts:{unknown:1}});assert.equal(JSON.stringify(status).includes('private-other'),false);assert.equal(JSON.stringify(status).includes('private-operation'),false);
 assert.equal((await rpc('managedAcceptanceStatus',{actor:{...actor,userId:'other'}})).ok,false);assert.equal((await rpc('managedAcceptanceStatus',{scope:{...scope,projectId:'other'}})).ok,false);assert.equal((await rpc('managedAcceptanceStatus',{actor:{...actor,authVersion:2}})).ok,false);
 if(testing){
  // A pre-testing Pi journal has no pinned Managed route. The stored journal
  // is real here; this fixture does not claim an actual provider run.
  assert.equal((await rpc('legacyPiRouteForTest')).ok,true);
  const legacy=await rpc('turnSnapshot');assert.equal(legacy.ok,true,JSON.stringify(legacy));
  assert.equal(legacy.value.runtimeBackend,'pi');assert.equal(legacy.value.managedState,undefined);
  assert.equal(legacy.value.turns[winner.id].status,winner.status);
  const denied=await rpc('submitTurn',{...input,key:'pi-must-stay-closed'});
  assert.equal(denied.ok,false);assert.equal(denied.error,'turn-runtime-not-ready');
  assert.equal(Object.keys((await rpc('turnSnapshot')).value.turns).length,1);
 }
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
