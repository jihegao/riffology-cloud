import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('Model inspection returning after archive reflects the closed gate while preserving saved history and restore',{timeout:30000},async()=>{
 const spec={schemaVersion:1,researchQuestion:'How does capacity affect wait?',scope:'One queue',entities:['customer'],mechanisms:['FCFS'],assumptions:['Fixed arrivals'],parameters:{servers:{type:'integer',default:1}},metrics:{wait:{unit:'min'}},limitations:['No abandonment'],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
 const directory=await mkdtemp(join(tmpdir(),'model-archive-race-')),worker='model-race';let mf;
 const bundle=await build({stdin:{sourcefile:'model-race-fixture.ts',resolveDir:process.cwd(),contents:`
 import {DurableObject} from 'cloudflare:workers';
 import {WorkspaceAgent as Base} from './services/workspace/durable.ts';
 import {TenantQuota} from './services/quota/durable.ts';export {TenantQuota};
 import {RevisionStore} from './services/turn-runtime/revision-store.ts';export {RevisionStore};
 import {revisionStoreActorName} from './services/turn-runtime/revision-store-client.ts';
 import {TurnJournal} from './services/turn/journal.ts';
 import {DurableTurnStore} from './services/turn/store.ts';
 import {initialWorkspaceArchive} from './services/turn-runtime/initial-workspace-archive.ts';
 import {WORKSPACE_STATE_KEY} from './services/workspace/shared-alarm.ts';
 import {workspaceAgentName} from './services/workspace/protocol.ts';
 import {turnRuntimeActorName} from './services/turn-runtime/identity.ts';
 import {ProjectArchives} from './services/catalog/project-archives.ts';
 import {catalogDatabase} from './services/catalog/database.ts';
 import {createGatewayProjectArchives} from './services/gateway/project-archive-services.ts';
 const spec=${JSON.stringify(spec)},scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},actor={userId:'owner',authVersion:1};
 const specText=JSON.stringify(spec);
 let armed=false,entered=false,release;
 globalThis.__modelInspectionBarrier=async()=>{if(armed){armed=false;entered=true;await new Promise(resolve=>{const timer=setTimeout(resolve,15000);release=()=>{clearTimeout(timer);resolve();};});}};
 export class Capacity extends DurableObject{async archiveResources(scope){return {scope,quiescent:true,coldUnresolved:0,pairUnresolved:0,pair:null};}}
 // Native release is an exact-identity fixture; no runtime is allocated.
 export class ReleasedRuntime extends DurableObject{async seed(identity){this.ctx.storage.kv.put('identity',identity);await this.ctx.storage.sync();}async archiveRuntimeResources(identity){if(JSON.stringify(this.ctx.storage.kv.get('identity'))!==JSON.stringify(identity))throw Error('fixture-runtime-scope-denied');return {identity,runtime:null,isolation:{classification:'runtime-released',fencedAt:1}};}}
 export class NeverExecute extends DurableObject{async start(){throw Error('unexpected-native-start');}}
 export class Workspace extends Base{
  async seed(){const journal=new TurnJournal(new DurableTurnStore(this.ctx.storage)),session=(await journal.createSession(scope,actor,'session',{title:'Model'})).session;await journal.submit(scope,actor,session.id,'turn',{message:'Saved model'});const turn=(await journal.claim(scope,1)).turn,identity={scope,sessionId:session.id,turnId:turn.id,dispatchId:turn.dispatchId,generation:1},encode=text=>new TextEncoder().encode(text),filesArchive=initialWorkspaceArchive({'model/model-spec.json':encode(specText),'model/run.py':encode('print(1)'),'app/requirements.lock':encode('{"schemaVersion":1,"packages":{}}')});
   const revision=await this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).commit({identity,base:turn.base,outcome:'completed',executionErrorCode:null,snapshot:{identity,filesArchive,piSession:encode('saved session')}});if(revision.status!=='committed')throw Error('fixture-save-failed');await journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:turn.dispatchId,runtimeGeneration:1,outcome:'completed'});await journal.commitCheckpoint(scope,{turnId:turn.id,dispatchId:turn.dispatchId,runtimeGeneration:1,checkpoint:revision.receipt});
   this.ctx.storage.kv.put(WORKSPACE_STATE_KEY,{task:{id:'initial',tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,starterVersion:'empty-v1',authVersion:1,createdAt:1,deadlineAt:9000},phase:'stopped',quotaReleased:true,projection:{outcome:'ready'},projectionConfirmed:true,wakeAt:null});await this.ctx.storage.sync();await this.env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(identity)).seed(identity);return revision.receipt;
  }
  async persisted(){return {fence:this.ctx.storage.kv.get('project-archive-fence-v1')??null,runs:[...(await this.ctx.storage.list({prefix:'simulation:run:'})).values()]};}
  async gate(enabled){this.env.M4_SIMULATION_ENABLED=enabled?'true':'false';}
 }
 export default{async fetch(request,env){const input=await request.json(),stub=env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));let value;try{if(input.method==='arm'){armed=true;entered=false;value=true;}else if(input.method==='entered')value=entered;else if(input.method==='release'){release();value=true;}else if(input.method==='archive'||input.method==='restore')value=await createGatewayProjectArchives(new ProjectArchives(catalogDatabase(env.CATALOG)),env.WORKSPACE_AGENT).transition(actor,scope.tenantId,scope.projectId,input.method,input.method);else if(input.method==='model')value=await stub.modelSpec({scope});else if(input.method==='gate')value=await stub.gate(input.enabled);else value=await stub[input.method]();return Response.json({ok:true,value});}catch(error){return Response.json({ok:false,error:error.message});}}};
 `},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent',plugins:[{name:'inspection-await-barrier',setup(build){build.onLoad({filter:/services\/simulation\/source\.ts$/},async args=>{const source=await readFile(args.path,'utf8'),needle='specSha256:await digest(specBytes)',replacement='specSha256:await (async()=>{await globalThis.__modelInspectionBarrier?.();return digest(specBytes);})()';assert.equal(source.split(needle).length,2,'pause at the production semantic-spec SHA await');return {contents:source.replace(needle,replacement),loader:'ts',resolveDir:dirname(args.path)};});}}]});
 try{
  mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{PRODUCT_TURN_RUNTIME:{type:'durable-object',worker,exportName:'ReleasedRuntime'},CATALOG:{type:'d1',id:'model-race-catalog',name:'model-race-catalog'},WORKSPACE_AGENT:{type:'durable-object',worker,exportName:'Workspace'},REVISION_STORE:{type:'durable-object',worker,exportName:'RevisionStore'},TENANT_QUOTA:{type:'durable-object',worker,exportName:'TenantQuota'},TRUSTED_PI_CAPACITY:{type:'durable-object',worker,exportName:'Capacity'},SIMULATION_SANDBOX:{type:'durable-object',worker,exportName:'NeverExecute'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'model-race-revisions'},TENANT_QUOTA_CAPACITY:{type:'text',value:'1'},TENANT_QUOTA_POLICY_VERSION:{type:'text',value:'original-v1'},M4_SIMULATION_ENABLED:{type:'text',value:'true'},M4_SIMULATION_IMAGE:{type:'text',value:'fixture-image'}},exports:Object.fromEntries(['Workspace','RevisionStore','TenantQuota','Capacity','NeverExecute','ReleasedRuntime'].map(name=>[name,{type:'durable-object',storage:'sqlite'}]))},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('denied',{status:403})}}}]});await mf.ready;
  const db=await mf.getD1Database('CATALOG',worker);
  for(const name of ['0001_catalog.sql','0004_operator_invitations.sql','0005_initial_operator.sql','0012_project_archives.sql']){const sql=(await readFile('services/catalog/migrations/'+name,'utf8')).replace(/--[^\n]*/g,'');for(const statement of sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(statement.trim())await db.prepare(statement).run();}
  await db.batch([
   db.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES('owner','test','owner','owner@example.test',1,1)"),
   db.prepare("INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES('tenant','owner',1,1)"),
   db.prepare("INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES('tenant','owner',1,1)"),
   db.prepare("INSERT INTO catalog_projects(id,tenant_id,owner_user_id,workspace_id,title,starter_version,status,created_at,updated_at) VALUES('project','tenant','owner','workspace','Saved model','empty-v1','ready',1,1)"),
   db.prepare("INSERT INTO catalog_workspaces(id,tenant_id,project_id,owner_user_id,status,created_at,updated_at) VALUES('workspace','tenant','project','owner','ready',1,1)")]);
  const rpc=async(method,rest={})=>{const response=await mf.dispatchFetch('http://model-race.test/',{method:'POST',body:JSON.stringify({method,...rest})}).catch(error=>{throw Error('fixture-'+method+'-transport',{cause:error});}),body=await response.json();assert.equal(body.ok,true,JSON.stringify(body));return body.value;};
  const revision=await rpc('seed'),before=await rpc('model');assert.equal(before.canRun,true);assert.deepEqual(before.spec,spec);assert.equal(before.version.revisionId,revision.revisionId);
  await rpc('arm');const pending=rpc('model');void pending.catch(()=>{});const deadline=Date.now()+5000;while(!await rpc('entered')){assert.ok(Date.now()<deadline,'inspection reaches its internal SHA await');await new Promise(resolve=>setTimeout(resolve,10));}
  const archived=await rpc('archive');assert.equal(archived.outcome,'completed',JSON.stringify(archived));assert.equal((await rpc('persisted')).fence.state,'archived');assert.ok((await db.prepare("SELECT archived_at FROM catalog_projects WHERE id='project'").first()).archived_at);
  await rpc('release');const after=await pending;assert.equal(after.canRun,false);assert.equal(after.capabilityReason,'project_archived');assert.deepEqual(after.spec,before.spec);assert.deepEqual(after.version,before.version);
  const frozen=await rpc('persisted'),history=await rpc('model');assert.equal(history.canRun,false);assert.equal(history.capabilityReason,'project_archived');assert.deepEqual(history.version,before.version);assert.deepEqual(await rpc('persisted'),frozen);assert.deepEqual(frozen.runs,[]);
  assert.equal((await rpc('restore')).outcome,'completed');assert.equal((await rpc('model')).canRun,true);assert.deepEqual((await rpc('persisted')).runs,[]);
  await rpc('arm');const gateRead=rpc('model');void gateRead.catch(()=>{});const gateDeadline=Date.now()+5000;while(!await rpc('entered')){assert.ok(Date.now()<gateDeadline);await new Promise(resolve=>setTimeout(resolve,10));}await rpc('gate',{enabled:false});await rpc('release');assert.equal((await gateRead).canRun,false);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
