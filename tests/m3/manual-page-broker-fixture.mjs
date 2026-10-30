import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

export const appOrigin='http://127.0.0.1:8795';
export const scopes=Object.fromEntries(['alpha','beta'].map(user=>[user,{tenantId:'tenant-'+user,projectId:'project-'+user,workspaceId:'workspace-'+user,workspaceGeneration:1}]));

/** Synthetic identities and initialization only. Saves, packages and artifact
 * receipts come from the real Gateway/Workspace/RevisionStore and local D1/R2.
 * This worker is bundled only inside this test, never a deployment entrypoint. */
export async function manualPageFixture(t,{browserLocal=false,projectIrTest=false,browserPreviewTest=false}={}){
 const browserPolicy=JSON.stringify({schema:'project-view-browser-policy/v1',enabled:true,startsAt:Date.now()-1000,endsAt:Date.now()+600000,dataEgress:'accepted',grants:Object.entries(scopes).map(([user,scope])=>({scope,actor:{userId:user,authVersion:1}}))});
 const source=`
 import {WorkspaceAgent as BaseWorkspace} from './services/workspace/durable.ts';
 import {ProjectIrAuthority} from './services/project-ir/authority.ts';
 import {RevisionStore as BaseRevisionStore} from './services/turn-runtime/revision-store.ts';
 import {revisionStoreActorName} from './services/turn-runtime/revision-store-client.ts';
 import {gateway} from './services/gateway/app.ts';
 import {catalogDatabase} from './services/catalog/database.ts';
 import {createGatewayManualSaveServices} from './services/gateway/manual-save-services.ts';
 import {createGatewayProjectViewServices} from './services/gateway/project-view-services.ts';
 import {createGatewayBrowserPreviewServices} from './services/gateway/browser-preview-services.ts';
 import {projectBrowserBuildAlarm} from './services/browser-preview/g4-build-hold.ts';
 import {serveProjectViewBrowserFrame} from './services/project-views/browser-delivery.ts';
 import {initialCheckpoint} from './services/runtime/starter.ts';
 import {checkpointKey} from './services/runtime/core.ts';
 import {canonicalWorkspaceMarker,workspaceDigest,workspaceAgentName} from './services/workspace/protocol.ts';
 const appOrigin=${JSON.stringify(appOrigin)},scopes=${JSON.stringify(scopes)};
 let browserPolicyEnabled=true;
 const localEnv=env=>({...env,APP_ORIGIN:appOrigin,BROWSER_PREVIEW_EXECUTION_ORIGIN:'http://localhost:8821',...(${JSON.stringify(browserLocal)}?{PROJECT_VIEW_BROWSER_POLICY_JSON:browserPolicyEnabled?${JSON.stringify(browserPolicy)}:'{"enabled":false}'}:{}),...(${JSON.stringify(browserPreviewTest)}?{TENANT_QUOTA:{getByName:()=>new Proxy({},{get:()=>()=>{throw Error('unexpected simulation quota call');}})}}:{})});
 // A test-only barrier holds bytes already read by the real RevisionStore.
 // It permits concurrent canonical saves/revocation before the production
 // Workspace's post-await package/authorization check returns any display.
 export class RevisionStore extends BaseRevisionStore {
  #irSourceBarrier=null;
  async serviceFiles(...args){
   const bytes=await super.serviceFiles(...args),barrier=this.#irSourceBarrier;
   if(${JSON.stringify(projectIrTest)}&&barrier&&!barrier.entered){barrier.entered=true;barrier.sourceKind=args[0]?.kind??null;barrier.start();await barrier.wait;}
   return bytes;
  }
  async projectIrSourceBarrierForTest(operation){
   if(!${JSON.stringify(projectIrTest)})throw Error('fixture disabled');
   if(operation==='arm'){
    if(this.#irSourceBarrier?.entered&&!this.#irSourceBarrier.released)throw Error('fixture source already held');
    let release,start;const wait=new Promise(r=>{release=r;}),started=new Promise(r=>{start=r;});
    this.#irSourceBarrier={wait,started,release,start,entered:false,released:false,sourceKind:null};
   }else if(operation==='release'){if(this.#irSourceBarrier){this.#irSourceBarrier.released=true;this.#irSourceBarrier.release();}}
   else if(operation==='wait'){if(!this.#irSourceBarrier)throw Error('fixture source not armed');await this.#irSourceBarrier.started;}
   else if(operation!=='state')throw Error('fixture operation denied');
   return {armed:this.#irSourceBarrier!==null,entered:this.#irSourceBarrier?.entered??false,released:this.#irSourceBarrier?.released??false,sourceKind:this.#irSourceBarrier?.sourceKind??null};
  }
 }
 export class WorkspaceAgent extends BaseWorkspace {
  #packageReads=0;
  constructor(ctx,env){
   const bound=localEnv(env);
   if(${JSON.stringify(projectIrTest)})for(const [name,kind]of [['PROJECT_RUNTIME','runtime'],['PRODUCT_TURN_RUNTIME','runtime'],['TRUSTED_PI_CAPACITY','capacity'],['TOOL_BRIDGE_AGENT','tools'],['TRUSTED_PI_SANDBOX','containers'],['PROJECT_SANDBOX','containers'],['SIMULATION_SANDBOX','containers']]){
    const deny=()=>{const key='fixture:execution-attempts',counts=ctx.storage.kv.get(key)??{runtime:0,capacity:0,tools:0,containers:0};counts[kind]++;ctx.storage.kv.put(key,counts);throw Error('fixture execution binding denied');};
    bound[name]={getByName:deny,idFromName:deny,get:deny};
   }
   super(ctx,bound);
  }
  async projectViews(input){this.#packageReads++;return super.projectViews(input);}
  packageReadsForTest(){return this.#packageReads;}
  async dropPackageAuthorityForTest(){this.ctx.storage.kv.delete('project-view-package-authority');await this.ctx.storage.sync();return {ok:true};}
  async projectIrSyntheticAgentForTest(input){
   if(!${JSON.stringify(projectIrTest)})throw Error('fixture disabled');
   const scope=scopes.alpha,actor={userId:'alpha',authVersion:1},authority=new ProjectIrAuthority(this.ctx.storage,this.env.WORKSPACE_CHECKPOINTS,scope,Date.now,async()=>{},actor);
   const counters=this.ctx.storage.kv.get('fixture:project-ir:counters')??{registrations:0,tools:0,browser:0,rejectedBrowser:0};
   if(input.operation==='register')counters.registrations++;else if(['project_ir_run','project_ir_result'].includes(input.operation))counters.tools++;else throw Error('fixture operation denied');
   this.ctx.storage.kv.put('fixture:project-ir:counters',counters);await this.ctx.storage.sync();
   return input.operation==='register'?authority.register({effectId:input.effectId,registration:input.registration}):authority.tool({effectId:input.effectId,operation:input.operation,input:input.input,observeOnly:input.observeOnly??false});
  }
  async projectIrBrowser(input){
   if(!${JSON.stringify(projectIrTest)})return super.projectIrBrowser(input);
   const key='fixture:project-ir:counters',counters=this.ctx.storage.kv.get(key)??{registrations:0,tools:0,browser:0,rejectedBrowser:0};
   counters.browser++;this.ctx.storage.kv.put(key,counters);await this.ctx.storage.sync();
   try{return await super.projectIrBrowser(input);}catch(error){const latest=this.ctx.storage.kv.get(key);latest.rejectedBrowser++;latest.lastRejection={operation:input.operation,message:error instanceof Error?error.message:String(error),status:typeof error?.status==='number'?error.status:null};this.ctx.storage.kv.put(key,latest);await this.ctx.storage.sync();throw error;}
  }
  async projectIrCountersForTest(){return {ir:this.ctx.storage.kv.get('fixture:project-ir:counters')??{registrations:0,tools:0,browser:0,rejectedBrowser:0},executionAttempts:this.ctx.storage.kv.get('fixture:execution-attempts')??{runtime:0,capacity:0,tools:0,containers:0}};}
  async seedForTest(scope){
   const task={id:'initial-'+scope.workspaceId,tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:1000,deadlineAt:2000};
   const identity={taskId:task.id,tenantId:task.tenantId,projectId:task.projectId,workspaceId:task.workspaceId,generation:1,runtimeId:'runtime-'+scope.workspaceId,leaseId:'lease-'+scope.workspaceId},markerNonce='synthetic-canary';
   const checkpoint=await initialCheckpoint({task,identity,markerNonce});
   await this.env.WORKSPACE_CHECKPOINTS.put(checkpointKey(identity),checkpoint.text);
   const runtimeReceipt={receiptId:'ready-'+scope.workspaceId,initializedAt:1500,layoutVersion:'m1-empty-v1',markerSha256:await workspaceDigest(canonicalWorkspaceMarker(identity,markerNonce)),checkpointRevision:checkpoint.revision};
   await this.ctx.storage.put('m1:workspace:initialization',{task,identity,markerNonce,runtimeReceipt,projection:{outcome:'ready'},projectionConfirmed:true,...(${JSON.stringify(browserPreviewTest)}?{wakeAt:null}:{})});await this.ctx.storage.sync();
  }
  async diagnosticsForTest(){const s=await this.ctx.storage.get('m2:turn-journal');if(!s?.turns||!s?.sessions||!s?.manualOperations)throw Error('fixture journal missing');return {turns:Object.keys(s.turns).length,sessions:Object.keys(s.sessions).length,active:s.activeManualOperation,operations:Object.values(s.manualOperations).map(o=>({id:o.identity.operationId,status:o.status,revisionId:o.receipt?.revisionId??null}))};}
  async previewForTest(revision,forget){
   if(!${JSON.stringify(browserPreviewTest)})throw Error('fixture disabled');
   if(forget)await this.ctx.storage.transaction(async tx=>{await tx.delete('browser-preview:discovery:'+revision);for(const profile of ['python-stdlib/v1','mesa-3.5.1/v1'])await tx.delete('browser-preview:build:'+revision+':'+profile);await projectBrowserBuildAlarm(tx,Date.now());});
   return {discovery:await this.ctx.storage.get('browser-preview:discovery:'+revision)??null,build:await this.ctx.storage.get('browser-preview:build:'+revision+':python-stdlib/v1')??null,alarm:await this.ctx.storage.getAlarm()};
  }
  async previewViewForTest(scope,revision){try{return {result:await super.browserPreviewView({scope,actor:{userId:'alpha',authVersion:1},revisionId:revision})};}catch(error){return {error:error?.message??String(error),stack:error?.stack??null};}}
 }
 export default {async fetch(request,env){
  const url=new URL(request.url),bound=localEnv(env),stub=scope=>env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));
  if(url.pathname==='/__fixture/disable-browser-policy'){browserPolicyEnabled=false;return Response.json({ok:true});}
  if(${JSON.stringify(browserLocal)}){const frame=serveProjectViewBrowserFrame(request,bound);if(frame)return frame;}
  if(${JSON.stringify(projectIrTest)}&&url.pathname==='/__fixture/project-ir-source-barrier')return Response.json(await env.REVISION_STORE.getByName(revisionStoreActorName(scopes.alpha)).projectIrSourceBarrierForTest(url.searchParams.get('operation')??'state'));
  if(${JSON.stringify(projectIrTest)}&&url.pathname==='/__fixture/project-ir-agent'){
   if(request.method!=='POST')return Response.json({error:'method denied'},{status:405});
   return Response.json(await stub(scopes.alpha).projectIrSyntheticAgentForTest(await request.json()));
  }
  if(${JSON.stringify(projectIrTest)}&&url.pathname==='/__fixture/project-ir-workspace'){
   if(request.method!=='POST')return Response.json({error:'method denied'},{status:405});
   const input=await request.json(),actor={userId:request.headers.get('x-synthetic-user')??'alpha',authVersion:input.authVersion??1};
   try{return Response.json(await stub(scopes.alpha).projectIrBrowser({scope:input.scope??scopes.alpha,actor,packageIdentity:input.packageIdentity,operation:input.operation,input:input.input}));}catch{return Response.json({denied:true},{status:403});}
  }
  if(${JSON.stringify(projectIrTest)}&&url.pathname==='/__fixture/project-ir-counts')return Response.json({alpha:await stub(scopes.alpha).projectIrCountersForTest(),beta:await stub(scopes.beta).projectIrCountersForTest(),executionBindings:'deny-and-count-local-fixture'});
  if(url.pathname==='/__fixture/seed'){for(const scope of Object.values(scopes))await stub(scope).seedForTest(scope);return Response.json({ok:true});}
  if(url.pathname==='/__fixture/diagnostics'){if(url.searchParams.get('user')==='alpha')return Response.json(await stub(scopes.alpha).diagnosticsForTest());const result={};for(const [name,scope]of Object.entries(scopes))result[name]=await stub(scope).diagnosticsForTest();return Response.json(result);}
  if(${JSON.stringify(browserPreviewTest)}&&url.pathname==='/__fixture/preview'){const user=url.searchParams.get('user')??'alpha',revision=url.searchParams.get('revision');return Response.json(await stub(scopes[user]).previewForTest(revision,url.searchParams.get('forget')==='1'));}
  if(${JSON.stringify(browserPreviewTest)}&&url.pathname==='/__fixture/preview-view')return Response.json(await stub(scopes.alpha).previewViewForTest(scopes.alpha,url.searchParams.get('revision')));
  if(url.pathname==='/__fixture/package-reads')return Response.json({reads:await stub(scopes.alpha).packageReadsForTest()});
  if(url.pathname==='/__fixture/drop-package-authority')return Response.json(await stub(scopes.alpha).dropPackageAuthorityForTest());
  if(url.pathname==='/__fixture/current'){try{return Response.json(await stub(scopes.alpha).projectViewCurrent({scope:scopes.alpha,actor:{userId:request.headers.get('x-synthetic-user')??'alpha',authVersion:1},identity:url.searchParams.get('identity')}));}catch{return Response.json({error:'denied'},{status:403});}}
  if(url.pathname==='/__fixture/stale-generation'){try{await stub(scopes.alpha).projectViews({scope:{...scopes.alpha,workspaceGeneration:2},actor:{userId:'alpha',authVersion:1}});return Response.json({denied:false});}catch{return Response.json({denied:true});}}
  return gateway(request,{origin:appOrigin,database:catalogDatabase(env.CATALOG),
   identity:async req=>{const user=req.headers.get('x-synthetic-user')??'alpha';return scopes[user]?{subject:user,email:user+'@example.test',emailVerified:true,platformVersion:1}:null;},
   manualSaves:createGatewayManualSaveServices(bound),projectViews:createGatewayProjectViewServices(bound),browserPreviews:createGatewayBrowserPreviewServices(bound),turns:{files:scope=>stub(scope).listFiles({scope})}});
 }};`;
 const bundle=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const worker='manual-page-broker';let outbound=0;
 const directory=await mkdtemp(join(tmpdir(),'manual-page-broker-'));
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{CATALOG:{type:'d1',id:'page-catalog',name:'page-catalog'},WORKSPACE_AGENT:{type:'durable-object',worker,exportName:'WorkspaceAgent'},REVISION_STORE:{type:'durable-object',worker,exportName:'RevisionStore'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'page-checkpoints'}},exports:{WorkspaceAgent:{type:'durable-object',storage:'sqlite'},RevisionStore:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{outbound++;return new Response('unexpected outbound',{status:403});}}}}]};
 let mf=new Miniflare(options);
 t.after(async()=>{await mf.dispose();await rm(directory,{recursive:true,force:true});});await mf.ready;
 let db=await mf.getD1Database('CATALOG',worker),bucket=await mf.getR2Bucket('WORKSPACE_CHECKPOINTS',worker);
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
 if(browserLocal)for(const user of Object.keys(scopes)){
  await db.prepare("INSERT INTO catalog_invitations(id,token_hash,normalized_email,state,issued_by,created_at,expires_at) VALUES(?,?,?,'pending',?,1000,?)").bind('browser-invite-'+user,user==='alpha'?'a'.repeat(64):'b'.repeat(64),user+'@example.test',user==='alpha'?'beta':'alpha',Date.now()+600000).run();
  await db.prepare("UPDATE catalog_invitations SET state='accepted',accepted_by=?,accepted_at=1001 WHERE id=?").bind(user,'browser-invite-'+user).run();
 }
 let manualPosts=0;
 const request=async(path,{user='alpha',method='GET',body,key}={})=>{
  const headers={'x-synthetic-user':user,Origin:appOrigin};if(body!==undefined)headers['content-type']='application/json';if(key)headers['Idempotency-Key']=key;
  if(method==='POST'&&/\/manual-saves$/.test(path))manualPosts++;
  const response=await mf.dispatchFetch(appOrigin+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await response.text();let result;try{result=JSON.parse(text);}catch{throw Error('fixture response is not JSON for '+path+': '+text.slice(0,300));}return {status:response.status,body:result};
 };
 const read=async(path,options)=>{const r=await request(path,options);if(r.status!==200)throw Error('fixture read denied '+r.status+': '+JSON.stringify(r.body));return r.body;};
 await read('/__fixture/seed');
 const base=user=>'/api/workspaces/'+scopes[user].workspaceId;
 return {get db(){return db;},get bucket(){return bucket;},base,request,read,rawRequest:(path,init={})=>mf.dispatchFetch(appOrigin+path,init),get outbound(){return outbound;},get manualPosts(){return manualPosts;},
  async restart(){await mf.dispose();mf=new Miniflare(options);await mf.ready;db=await mf.getD1Database('CATALOG',worker);bucket=await mf.getR2Bucket('WORKSPACE_CHECKPOINTS',worker);},
  async save(user,key,files){const current=await read(base(user)+'/manual-saves',{user});return request(base(user)+'/manual-saves',{user,method:'POST',key,body:{schema:'project.manual-save/v1',base:current.base,changes:Object.entries(files).map(([path,content])=>({path,encoding:'utf8',content})),deletes:[],artifacts:[{path:'docs/data.json',title:'Synthetic upload / unverified'}]}});},
  async footprint(){const fences=(await db.prepare('SELECT operation_id,state,terminal_status,revision_id FROM catalog_manual_save_fences ORDER BY operation_id').all()).results;return {journal:await read('/__fixture/diagnostics'),fences,keys:(await bucket.list()).objects.map(x=>x.key).sort(),manualPosts,outbound};},
 };
}
