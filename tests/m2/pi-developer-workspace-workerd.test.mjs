import {betaPolicy} from './private-beta-fixture.ts';
import {profile} from './production-profile-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

// Actual WorkspaceAgent, durable journal and D1 authorization. Readiness and
// provider/quota responses are explicit fixtures; this test sends no model input.
for(const beta of [false,true])test((beta?'Private Beta':'Pi developer')+' Workspace preserves markers across restart, serializes admission and rejects other actors',{timeout:45000},async()=>{
 const standing=await betaPolicy();
 const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},actor={userId:'owner',authVersion:1};
 const policy={schemaVersion:1,policyId:'issue77-production-v1',scope,userId:'owner',enabled:true,syntheticOnly:true,maxTurns:6,maxSessions:2,observedStopUsd:5,maxDurationMs:7200000,maxTurnObservationMs:300000,maxSimulationRuns:12};
 const entry=`
 import {DurableObject} from 'cloudflare:workers';
 import {WorkspaceAgent as ProductionWorkspace} from './services/workspace/durable.ts';
 import {WORKSPACE_STATE_KEY} from './services/workspace/shared-alarm.ts';
 import {workspaceAgentName} from './services/workspace/protocol.ts';
 import {PRIVATE_BETA_CAPACITY_ACTOR} from './services/model-budget/private-beta-policy.ts';
 export class Workspace extends ProductionWorkspace {
  async markerForTest(input){return this.ctx.storage.kv.get('pi-developer-turn:'+input.turnId)??null;}
  async seed(scope){const now=Date.now();await this.ctx.storage.put(WORKSPACE_STATE_KEY,{task:{id:'task',tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,starterVersion:'empty-v1',authVersion:1,createdAt:now,deadlineAt:now+3600000},projection:{outcome:'ready'},projectionConfirmed:true,wakeAt:null});}
  async seedRuns(scope,actor){const common={actor,status:'completed',released:true,releaseProof:{kind:'runtime-stopped',confirmationId:'actual-stored-release',observedAt:123},stop:{confirmationId:'actual-stored-stop',observedAt:122,nativeRunning:false,fenced:true},result:{artifactSha256:'a'.repeat(64)}};await this.ctx.storage.put('simulation:run:own',{...common,scope,runId:'own'});await this.ctx.storage.put('simulation:run:other',{...common,scope:{...scope,projectId:'private-other-project'},runId:'private-other-run'});}
  async dropBetaBindingForTest(input){this.ctx.storage.kv.delete('pi-developer-turn:'+input.turnId);await this.ctx.storage.sync();return this.env.PRIVATE_BETA_CAPACITY.getByName(PRIVATE_BETA_CAPACITY_ACTOR).dropBindingForTest({scope:input.scope,actor:input.actor,sessionId:input.sessionId,requestKey:input.key});}
  async alarm(){} // Keep this admission-only test from starting a runtime.
 }
 export class Managed extends DurableObject{
  async preflight(){if(await this.ctx.storage.get('stopped'))throw Error('fixture-budget-stopped');await new Promise(r=>setTimeout(r,30));await this.ctx.storage.put('preflights',(await this.ctx.storage.get('preflights')??0)+1);return {allowed:true};}
  async stop(){await this.ctx.storage.put('stopped',true);}
  async budgetStatus(){return {stopped:await this.ctx.storage.get('stopped')?'managed-usage-unknown':null,unresolved:1,cleanupPending:false,turnCount:0,preflights:await this.ctx.storage.get('preflights')??0};}
 }
 export class Quota extends DurableObject{async snapshot(){return {capacity:2,occupied:1,available:1,unknown:1,configuredPolicyMatches:true,leases:[{status:'unknown',projectId:'private-other-project',operationId:'private-operation'}]};}}
 export class Artifacts extends DurableObject{}
 ${beta?"export {PiDeveloperBudget as Developer} from './services/model-budget/pi-developer-durable.ts';":'export class Developer extends DurableObject {async assertQuiet(){}async admitTurn(){}}'}
 import {PrivateBetaCapacity as ProductionPrivateBetaCapacity} from './services/model-budget/private-beta-capacity.ts';
 export class PrivateBetaCapacity extends ProductionPrivateBetaCapacity {
  async dropBindingForTest(input){this.ctx.storage.sql.exec("UPDATE beta_slots SET turn_id=NULL,status='admitting' WHERE document=?",JSON.stringify(input));await this.ctx.storage.sync();}
  async quarantineUnboundForTest(){this.ctx.storage.sql.exec("UPDATE beta_slots SET status='quarantined' WHERE turn_id IS NULL");await this.ctx.storage.sync();}
  async operationsForTest(){return this.ctx.storage.sql.exec('SELECT action FROM beta_operations').toArray();}
 }
 export class Historical extends DurableObject {async assertExecutionQuiet(){return {};}async assertExecutionIsolated(){return {};}}
 export class Runtime extends DurableObject{}
 export class Capacity extends DurableObject{}
 export default {async fetch(request,env){const {method,...input}=await request.json();try{const stub=env.WORKSPACE_AGENT.getByName(workspaceAgentName(input.scope.tenantId,input.scope.workspaceId));let value;if(method==='betaForTest')value=await env.PRIVATE_BETA_CAPACITY.getByName(PRIVATE_BETA_CAPACITY_ACTOR)[input.action](...(input.args??[]));else if(method==='stop')value=await env.MANAGED_TURN_RUNTIME.getByName('managed-product-v1:tenant:project').stop();else if(method==='seed')value=await stub.seed(input.scope);else if(method==='seedRuns')value=await stub.seedRuns(input.scope,input.actor);else value=await stub[method](input);return Response.json({ok:true,value});}catch(e){return Response.json({ok:false,error:e.message});}}};`;
 const directory=await mkdtemp(join(tmpdir(),'managed-workspace-')),workerName='managed-workspace';let mf;
 try{
 const bundled=await build({stdin:{contents:entry,sourcefile:'managed-workspace.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const classes={PRIVATE_BETA_CAPACITY:'PrivateBetaCapacity',TENANT_MODEL_BUDGET:'Historical',G5_TOKEN_BUDGET:'Historical',WORKSPACE_AGENT:'Workspace',MANAGED_TURN_RUNTIME:'Managed',TENANT_QUOTA:'Quota',TOOL_ARTIFACT_STORE:'Artifacts',PI_DEVELOPER_BUDGET:'Developer',PRODUCT_TURN_RUNTIME:'Runtime',TRUSTED_PI_CAPACITY:'Capacity'};
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:workerName,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{...(beta?{PRIVATE_BETA_POLICY_JSON:{type:'text',value:JSON.stringify(standing)},PRODUCTION_MODEL_PROFILE_JSON:{type:'text',value:JSON.stringify(profile)},M2_MODEL_BUDGET_POLICY_VERSION:{type:'text',value:'beta-token-v1'}}:{}),CATALOG:{type:'d1',id:'catalog',name:'catalog'},M2_TURNS_ENABLED:{type:'text',value:'true'},G5_CONTROLLED_WINDOW_JSON:{type:'text',value:'{}'},PI_DEVELOPER_POLICY_JSON:{type:'text',value:JSON.stringify({schemaVersion:1,policyId:'developer-v1',tenantId:scope.tenantId,userId:actor.userId,enabled:true,billingMode:'observe'})},MANAGED_TESTING_JSON:{type:'text',value:JSON.stringify({schemaVersion:2,policyId:'owner-online-testing',tenantId:scope.tenantId,userId:actor.userId,enabled:true})},...Object.fromEntries(Object.entries(classes).map(([key,exportName])=>[key,{type:'durable-object',worker:workerName,exportName}]))},exports:Object.fromEntries(Object.values(classes).map(name=>[name,{type:'durable-object',storage:'sqlite'}]))},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('disabled',{status:403})}}}]};mf=new Miniflare(options);await mf.ready;
 const db=await mf.getD1Database('CATALOG',workerName),sql=(await readFile('services/catalog/migrations/0001_catalog.sql','utf8')).replace(/--[^\n]*/g,'');for(const statement of sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(statement.trim())await db.prepare(statement).run();
 await db.batch([
 db.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES('owner','test','owner','owner@example.test',1,1)"),
 db.prepare("INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES('tenant','owner',1,1)"),
 db.prepare("INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES('tenant','owner',1,1)"),
 db.prepare("INSERT INTO catalog_projects(id,tenant_id,owner_user_id,workspace_id,title,starter_version,status,created_at,updated_at) VALUES('project','tenant','owner','workspace','synthetic','empty-v1','ready',1,1)"),
 db.prepare("INSERT INTO catalog_workspaces(id,tenant_id,project_id,owner_user_id,status,created_at,updated_at) VALUES('workspace','tenant','project','owner','ready',1,1)")]);
 if(beta){
  for(const file of ['0004_operator_invitations.sql','0005_initial_operator.sql']){
   const migration=(await readFile('services/catalog/migrations/'+file,'utf8')).replace(/--[^\n]*/g,'');for(const statement of migration.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(statement.trim())await db.prepare(statement).run();
  }
  await db.prepare("INSERT INTO catalog_invitations(id,token_hash,normalized_email,state,purpose,issued_by,created_at,expires_at) VALUES('invite',?,'owner@example.test','pending','user','owner',1,?)").bind('a'.repeat(64),Date.now()+86400000).run();
  await db.prepare("UPDATE catalog_invitations SET state='accepted',accepted_by='owner',accepted_at=? WHERE id='invite'").bind(Date.now()).run();
 }
 const rpc=async(method,input={})=>(await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({method,scope,actor,...input})})).json();
 assert.equal((await rpc('seed')).ok,true);
 const created=await rpc('createSession',{key:'session',body:{title:'Synthetic'}});assert.equal(created.ok,true,JSON.stringify(created));let sessionId=created.value.session.id;
 if(beta){
  const cap=async(action,...args)=>{const result=await rpc('betaForTest',{action,args});assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
  await db.prepare("UPDATE catalog_users SET auth_version=2 WHERE id='owner'").run();actor.authVersion=2;
  const rejected={scope,actor:{...actor},sessionId,requestKey:'stale-session'};
  assert.equal((await rpc('submitTurn',{sessionId,key:rejected.requestKey,body:{message:'must not reserve'}})).error,'turn-session-not-found');
  assert.equal((await cap('snapshot')).active,0);
  // Reproduce the pre-fix sequence: reserve first, then fail journal validation.
  await cap('admitTurn',rejected);await cap('quarantineUnboundForTest');
  const before=await cap('snapshot');assert.equal(before.quarantined,1);assert.deepEqual(before.usage,[]);
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  const proof=(await rpc('privateBetaReleaseState',rejected)).value;assert.equal(proof.rejectedSession,true);assert.equal(proof.found,false);
  await cap('monitor');const after=await cap('snapshot');assert.equal(after.active,0);assert.deepEqual(after.usage,before.usage);
  assert.equal((await cap('operationsForTest')).filter(x=>x.action.startsWith('release-rejected-session:')).length,1);
  await cap('monitor');assert.equal((await cap('operationsForTest')).length,1);
  assert.equal((await rpc('submitTurn',{sessionId,key:rejected.requestKey,body:{message:'late old POST'}})).error,'turn-session-not-found');
  assert.equal((await rpc('privateBetaReleaseState',{...rejected,sessionId:'missing'})).value.rejectedSession,false);
  const fresh=await rpc('createSession',{key:'current-session',body:{title:'Current'}});assert.equal(fresh.ok,true);sessionId=fresh.value.session.id;
  assert.equal((await rpc('privateBetaReleaseState',{...rejected,sessionId})).value.rejectedSession,false);
  assert.equal((await rpc('submitTurn',{sessionId,key:'invalid',body:{message:''}})).error,'invalid-turn-message');
  assert.equal((await cap('snapshot')).active,0);
 }
 const input={sessionId,key:'first',body:{message:'synthetic FCFS'}};
 const pair=await Promise.all([rpc('submitTurn',input),rpc('submitTurn',{...input,key:'second'})]);assert.equal(pair.filter(r=>r.ok).length,1,JSON.stringify(pair));assert.equal(pair.find(r=>!r.ok).error,'managed-input-in-flight');
 const winner=pair.find(r=>r.ok).value.turn;assert.equal(winner.requestKey,'first');
 if(beta)assert.equal((await rpc('privateBetaReleaseState',{sessionId:created.value.session.id,requestKey:'stale-session'})).value.rejectedSession,false,'another queued Turn prevents rejected-session release proof');
 const receipt=await rpc('turnReceipt',{sessionId,key:'first'});assert.equal(receipt.ok,true,JSON.stringify(receipt));assert.equal(receipt.value.accepted,true);assert.equal(receipt.value.turn.id,winner.id);
 if(beta){
  await rpc('dropBetaBindingForTest',{sessionId,key:'first',turnId:winner.id});options.workers[0].config.env.PRIVATE_BETA_POLICY_JSON.value=JSON.stringify({...standing,enabled:false});await mf.dispose();mf=new Miniflare(options);await mf.ready;
  const missing=await rpc('turnReceipt',{sessionId,key:'first'});assert.equal(missing.ok,false);assert.equal(missing.error,'turn-receipt-not-found');const pausedRetry=await rpc('submitTurn',input);assert.equal(pausedRetry.ok,false);assert.match(pausedRetry.error,/private-beta-paused/);assert.equal((await rpc('turnReceipt',{sessionId,key:'first'})).ok,false);
  options.workers[0].config.env.PRIVATE_BETA_POLICY_JSON.value=JSON.stringify(standing);await mf.dispose();mf=new Miniflare(options);await mf.ready;const repaired=await rpc('submitTurn',input);assert.equal(repaired.ok,true,JSON.stringify(repaired));assert.equal(repaired.value.replayed,true);assert.equal(repaired.value.turn.id,winner.id);assert.equal((await rpc('turnReceipt',{sessionId,key:'first'})).value.accepted,true);
 }
 assert.deepEqual((await rpc('markerForTest',{turnId:winner.id})).value,beta?{policyId:standing.policyId,privateBeta:true}:{policyId:'developer-v1'});await mf.dispose();mf=new Miniflare(options);await mf.ready;
 assert.equal((await rpc('submitTurn',{...input,key:'after-restart'})).error,'managed-input-in-flight');
 const replays=await Promise.all([rpc('submitTurn',input),rpc('submitTurn',input)]);for(const replay of replays){assert.equal(replay.ok,true,JSON.stringify(replay));assert.equal(replay.value.replayed,true);assert.equal(replay.value.turn.id,winner.id);}
 assert.equal((await rpc('submitTurn',{...input,body:{message:'different'}})).error,'turn-idempotency-conflict');
 const view=await rpc('turnSnapshot');assert.equal(Object.keys(view.value.turns).length,1);assert.equal(view.value.runtimeBackend,'pi');assert.deepEqual(view.value.piDeveloperState,{billingMode:'observe',blocked:null,...(beta?{privateBeta:true}:{})});
 assert.equal((await rpc('submitTurn',{...input,actor:{userId:'other',authVersion:1}})).ok,false);
 const identity={scope,sessionId,turnId:winner.id,dispatchId:'forged-dispatch',generation:1};
 assert.equal((await rpc('piDeveloperTurnAuthorization',{identity})).ok,false);
 assert.equal((await rpc('piDeveloperTurnAuthorization',{identity:{...identity,turnId:'unmarked'}})).value,false);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
