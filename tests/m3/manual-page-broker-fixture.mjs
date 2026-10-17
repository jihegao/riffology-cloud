import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

export const appOrigin='http://127.0.0.1:8795';
export const scopes=Object.fromEntries(['alpha','beta'].map(user=>[user,{tenantId:'tenant-'+user,projectId:'project-'+user,workspaceId:'workspace-'+user,workspaceGeneration:1}]));

/** Synthetic identities and initialization only. Saves, packages and artifact
 * receipts come from the real Gateway/Workspace/RevisionStore and local D1/R2.
 * This worker is bundled only inside this test, never a deployment entrypoint. */
export async function manualPageFixture(t){
 const source=`
 import {WorkspaceAgent as BaseWorkspace} from './services/workspace/durable.ts';
 export {RevisionStore} from './services/turn-runtime/revision-store.ts';
 import {gateway} from './services/gateway/app.ts';
 import {catalogDatabase} from './services/catalog/database.ts';
 import {createGatewayManualSaveServices} from './services/gateway/manual-save-services.ts';
 import {createGatewayProjectViewServices} from './services/gateway/project-view-services.ts';
 import {initialCheckpoint} from './services/runtime/starter.ts';
 import {checkpointKey} from './services/runtime/core.ts';
 import {canonicalWorkspaceMarker,workspaceDigest,workspaceAgentName} from './services/workspace/protocol.ts';
 const appOrigin=${JSON.stringify(appOrigin)},scopes=${JSON.stringify(scopes)};
 const localEnv=env=>({...env,APP_ORIGIN:appOrigin,BROWSER_PREVIEW_EXECUTION_ORIGIN:'http://localhost:8821'});
 export class WorkspaceAgent extends BaseWorkspace {
  constructor(ctx,env){super(ctx,localEnv(env));}
  async seedForTest(scope){
   const task={id:'initial-'+scope.workspaceId,tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:1000,deadlineAt:2000};
   const identity={taskId:task.id,tenantId:task.tenantId,projectId:task.projectId,workspaceId:task.workspaceId,generation:1,runtimeId:'runtime-'+scope.workspaceId,leaseId:'lease-'+scope.workspaceId},markerNonce='synthetic-canary';
   const checkpoint=await initialCheckpoint({task,identity,markerNonce});
   await this.env.WORKSPACE_CHECKPOINTS.put(checkpointKey(identity),checkpoint.text);
   const runtimeReceipt={receiptId:'ready-'+scope.workspaceId,initializedAt:1500,layoutVersion:'m1-empty-v1',markerSha256:await workspaceDigest(canonicalWorkspaceMarker(identity,markerNonce)),checkpointRevision:checkpoint.revision};
   await this.ctx.storage.put('m1:workspace:initialization',{task,identity,markerNonce,runtimeReceipt,projection:{outcome:'ready'},projectionConfirmed:true});await this.ctx.storage.sync();
  }
  async diagnosticsForTest(){const s=await this.ctx.storage.get('m2:turn-journal');if(!s?.turns||!s?.sessions||!s?.manualOperations)throw Error('fixture journal missing');return {turns:Object.keys(s.turns).length,sessions:Object.keys(s.sessions).length,active:s.activeManualOperation,operations:Object.values(s.manualOperations).map(o=>({id:o.identity.operationId,status:o.status,revisionId:o.receipt?.revisionId??null}))};}
 }
 export default {async fetch(request,env){
  const url=new URL(request.url),bound=localEnv(env),stub=scope=>env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));
  if(url.pathname==='/__fixture/seed'){for(const scope of Object.values(scopes))await stub(scope).seedForTest(scope);return Response.json({ok:true});}
  if(url.pathname==='/__fixture/diagnostics'){const result={};for(const [name,scope]of Object.entries(scopes))result[name]=await stub(scope).diagnosticsForTest();return Response.json(result);}
  if(url.pathname==='/__fixture/stale-generation'){try{await stub(scopes.alpha).projectViews({scope:{...scopes.alpha,workspaceGeneration:2},actor:{userId:'alpha',authVersion:1}});return Response.json({denied:false});}catch{return Response.json({denied:true});}}
  return gateway(request,{origin:appOrigin,database:catalogDatabase(env.CATALOG),
   identity:async req=>{const user=req.headers.get('x-synthetic-user')??'alpha';return scopes[user]?{subject:user,email:user+'@example.test',emailVerified:true,platformVersion:1}:null;},
   manualSaves:createGatewayManualSaveServices(bound),projectViews:createGatewayProjectViewServices(bound),turns:{files:scope=>stub(scope).listFiles({scope})}});
 }};`;
 const bundle=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const worker='manual-page-broker';let outbound=0;
 const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{CATALOG:{type:'d1',id:'page-catalog',name:'page-catalog'},WORKSPACE_AGENT:{type:'durable-object',worker,exportName:'WorkspaceAgent'},REVISION_STORE:{type:'durable-object',worker,exportName:'RevisionStore'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'page-checkpoints'}},exports:{WorkspaceAgent:{type:'durable-object',storage:'sqlite'},RevisionStore:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{outbound++;return new Response('unexpected outbound',{status:403});}}}}]});
 t.after(()=>mf.dispose());await mf.ready;
 const db=await mf.getD1Database('CATALOG',worker),bucket=await mf.getR2Bucket('WORKSPACE_CHECKPOINTS',worker);
 for(const file of ['0001_catalog.sql','0003_provisioning.sql','0004_operator_invitations.sql','0005_initial_operator.sql','0006_model_catalog.sql','0007_model_content_checks.sql','0010_project_budget_routes.sql','0012_project_archives.sql','0013_manual_save_fence.sql']){
  const sql=(await readFile('services/catalog/migrations/'+file,'utf8')).replace(/--[^\n]*/g,'');
  for(const statement of sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(statement.trim())await db.prepare(statement).run();
 }
 for(const [user,s]of Object.entries(scopes))for(const [sql,values]of [
  ["INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES(?,'better-auth',?,?,1000,1000)",[user,user,user+'@example.test']],
  ["INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES(?,?,1000,1000)",[s.tenantId,user]],
  ["INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES(?,?,1000,1000)",[s.tenantId,user]],
  ["INSERT INTO catalog_projects(id,tenant_id,owner_user_id,workspace_id,title,starter_version,status,created_at,updated_at) VALUES(?,?,?,?,'Synthetic pages','blank-v1','ready',1000,1000)",[s.projectId,s.tenantId,user,s.workspaceId]],
  ["INSERT INTO catalog_workspaces(id,project_id,tenant_id,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,?,'ready',1000,1000)",[s.workspaceId,s.projectId,s.tenantId,user]],
 ])await db.prepare(sql).bind(...values).run();
 let manualPosts=0;
 const request=async(path,{user='alpha',method='GET',body,key}={})=>{
  const headers={'x-synthetic-user':user,Origin:appOrigin};if(body!==undefined)headers['content-type']='application/json';if(key)headers['Idempotency-Key']=key;
  if(method==='POST'&&/\/manual-saves$/.test(path))manualPosts++;
  const response=await mf.dispatchFetch(appOrigin+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json()};
 };
 const read=async(path,options)=>{const r=await request(path,options);if(r.status!==200)throw Error('fixture read denied '+r.status+': '+JSON.stringify(r.body));return r.body;};
 await read('/__fixture/seed');
 const base=user=>'/api/workspaces/'+scopes[user].workspaceId;
 return {db,bucket,base,request,read,get outbound(){return outbound;},get manualPosts(){return manualPosts;},
  async save(user,key,files){const current=await read(base(user)+'/manual-saves',{user});return request(base(user)+'/manual-saves',{user,method:'POST',key,body:{schema:'project.manual-save/v1',base:current.base,changes:Object.entries(files).map(([path,content])=>({path,encoding:'utf8',content})),deletes:[],artifacts:[{path:'docs/data.json',title:'Synthetic upload / unverified'}]}});},
  async footprint(){const fences=(await db.prepare('SELECT operation_id,state,terminal_status,revision_id FROM catalog_manual_save_fences ORDER BY operation_id').all()).results;return {journal:await read('/__fixture/diagnostics'),fences,keys:(await bucket.list()).objects.map(x=>x.key).sort(),manualPosts,outbound};},
 };
}
