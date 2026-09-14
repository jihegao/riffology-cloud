import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {build} from 'esbuild';import {Miniflare} from 'miniflare';
/** Real local platform chain; server identity provisioning and Runtime process
 * responses are fixtures. No Google, Docker, cloud calls or external network. */
export async function createPreviewVerticalFixture({observer=false,observerExecutor=false,workspaceExtension="",fixtureMethods=[],modelFiles={}}={}){
 const directory=await mkdtemp(join(tmpdir(),'preview-vertical-')),worker='preview-vertical-test',image='registry.example/service@sha256:'+'f'.repeat(64),expiresAt=Date.now()+600000;
 const entry=`import {createGatewayPublications} from './services/gateway/publication-services.ts';import {R2PublicationArtifacts} from './services/publication/artifacts.ts';import {R2ModelContentPort} from './services/runtime/content.ts';import {R2ModelContentUploadPort} from './services/runtime/model-upload.ts';import {createGatewayResearchExports} from './services/gateway/research-export-services.ts';import {createGatewaySimulationServices} from './services/gateway/simulation-services.ts';import {gateway} from './services/gateway/app.ts';import {catalogDatabase} from './services/catalog/database.ts';import {createGatewayPreviewServices} from './services/gateway/preview-services.ts';import {previewHost} from './services/gateway/preview-host.ts';
 import {turnRuntimeActorName} from './services/turn-runtime/identity.ts';import {DurableObject} from 'cloudflare:workers';import {readPrivateWebSocketRequest} from './services/preview/websocket-protocol.ts';
 import {WorkspaceAgent as Base} from './services/workspace/durable.ts';
 import {forwardRunningObserver} from './services/run/observer-forward.ts';
 import {observerExecutorActorName} from './services/preview/observer-executor-rpc.ts';
 import {observerArtifactDescriptor} from './services/preview/observer-artifacts.ts';
 import {SqlObserverCalls} from './services/preview/observer-calls.ts';
 import {WorkspaceObserverHost} from './services/workspace/observer-host.ts';
 import {DurableObserverAlarmPort} from './services/workspace/turn-alarm.ts';
 import {PreviewRoutes} from './services/preview/routes.ts';
 import {TurnJournal} from './services/turn/journal.ts';import {DurableTurnStore} from './services/turn/store.ts';
 import {initialWorkspaceArchive} from './services/turn-runtime/initial-workspace-archive.ts';
 import {revisionStoreActorName} from './services/turn-runtime/revision-store-client.ts';
 import {serviceRunActorName} from './services/run/host.ts';import {serviceRuntimeActorName} from './services/run/durable.ts';
 export {ServiceRun} from './services/run/durable.ts';export {TenantQuota} from './services/quota/durable.ts';export {RevisionStore} from './services/turn-runtime/revision-store.ts';
 export class WorkspaceAgent extends Base{
  ${workspaceExtension}
  async seed(scope,actor,key){
   const task={id:'workspace-task',tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:scope.workspaceGeneration,starterVersion:'m1-empty-v1',authVersion:1,createdAt:1,deadlineAt:9000};
   await this.ctx.storage.put('m1:workspace:initialization',{task,wakeAt:null,projection:{outcome:'ready'},projectionConfirmed:true});
   const j=new TurnJournal(new DurableTurnStore(this.ctx.storage));const session=(await j.createSession(scope,actor,'session-'+key,{title:'Fixture'})).session;
   await j.submit(scope,actor,session.id,'turn-'+key,{message:'Create fixture'});const turn=(await j.claim(scope,1)).turn;
   const identity={scope,sessionId:session.id,turnId:turn.id,dispatchId:turn.dispatchId,generation:1},encode=v=>new TextEncoder().encode(v);
   const filesArchive=initialWorkspaceArchive({...Object.fromEntries(Object.entries(${JSON.stringify(modelFiles)}).map(([k,v])=>[k,encode(v)])),'app/preview.json':encode(JSON.stringify({schemaVersion:1,runtime:'python',entrypoint:'app/main.py',dependencyLock:'app/requirements.lock',port:8080,healthPath:'/health',...(${observer}?{observation:{pagePath:'/observe',statePath:'/state'}}:{})})),'app/main.py':encode('print('+JSON.stringify(key)+')'),'app/requirements.lock':encode(JSON.stringify({schemaVersion:1,packages:{}}))});
   const resolution=await this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).commit({identity,base:turn.base,outcome:'completed',executionErrorCode:null,snapshot:{identity,filesArchive,piSession:encode('private-session')}});
   if(resolution.status!=='committed')throw Error('fixture-revision-commit-'+resolution.status);const receipt=resolution.receipt;
   await j.beginCheckpoint(scope,{turnId:turn.id,dispatchId:turn.dispatchId,runtimeGeneration:1,outcome:'completed'});
   await j.commitCheckpoint(scope,{turnId:turn.id,dispatchId:turn.dispatchId,runtimeGeneration:1,checkpoint:receipt});
   return {identity,revision:receipt};
  }
  async observerTurn(scope,actor){const j=new TurnJournal(new DurableTurnStore(this.ctx.storage));const session=(await j.createSession(scope,actor,'observer-session',{title:'Observer fixture'})).session;await j.submit(scope,actor,session.id,'observer-turn',{message:'Observe fixture'});const {turn}=await j.claim(scope,scope.workspaceGeneration);const identity={scope,sessionId:session.id,turnId:turn.id,dispatchId:turn.dispatchId,generation:scope.workspaceGeneration};await this.env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(identity)).seed(identity);return identity;}
  async cancelObserver(scope,actor,turnId){return new TurnJournal(new DurableTurnStore(this.ctx.storage)).cancel(scope,actor,turnId);}
  async observerClaim(command,start=true){const grant=await this.authorizeObserverCommand(command);await new PreviewRoutes(catalogDatabase(this.env.CATALOG)).register(grant.actor,command.scope,command.previewId,grant.binding.expiresAt);const calls=new SqlObserverCalls(this.ctx.storage,command.scope);await calls.accept(command,grant.targetDigest);if(start)await calls.start(command);return grant;}
  async observerRoute(command){const grant=await this.authorizeObserverCommand(command);return new PreviewRoutes(catalogDatabase(this.env.CATALOG)).register(grant.actor,command.scope,command.previewId,grant.binding.expiresAt);}
  async observerAccept(command){const grant=await this.authorizeObserverCommand(command);await new PreviewRoutes(catalogDatabase(this.env.CATALOG)).register(grant.actor,command.scope,command.previewId,grant.binding.expiresAt);return new WorkspaceObserverHost(this.ctx.storage,command.scope,{shouldStop:async()=>false,stop:async()=>false}).calls.accept(command,grant.targetDigest);}
  async observerAlarm(){return {wake:new DurableObserverAlarmPort(this.ctx.storage).read(),physical:await this.ctx.storage.getAlarm()};}
  async observerMaintenanceDue(){await new DurableObserverAlarmPort(this.ctx.storage).schedule(Date.now()-1);return this.alarm();}
  async observerRecord(command){return new SqlObserverCalls(this.ctx.storage,command.scope).snapshot(command);}
  async finishObserver(command){return new SqlObserverCalls(this.ctx.storage,command.scope).finish(command,{status:'failed',result:null,errorCode:'fixture-finished'});}
  async seedObserverArtifact(command,mode='completed'){
   const stateBytes=new TextEncoder().encode(JSON.stringify({simulation_state_id:'historical-state',sequence:1,state:{queue:3}}));
   const viewBytes=new TextEncoder().encode(JSON.stringify({type:'snapshot',text:'Historical view',truncated:false}));
   const state=(await observerArtifactDescriptor(command,'state',stateBytes)).receipt,view=(await observerArtifactDescriptor(command,'view',viewBytes)).receipt;
   if(mode!=='orphan'){
    const calls=new SqlObserverCalls(this.ctx.storage,command.scope,()=>command.deadlineAt-1);await calls.accept(command,'a'.repeat(64));await calls.start(command);
    await calls.finish(command,mode==='unknown'?{status:'unknown',result:null,errorCode:'fixture-unknown'}:{status:'completed',result:{schemaVersion:1,operation:command.operation,previewId:command.previewId,runtimeGeneration:command.scope.workspaceGeneration,state:{artifact:state},view:{artifact:view}},errorCode:null});
   }
   return {state,view};
  }
  async terminalObserver(identity){const j=new TurnJournal(new DurableTurnStore(this.ctx.storage)),input={turnId:identity.turnId,dispatchId:identity.dispatchId,runtimeGeneration:identity.generation};await j.beginCheckpoint(identity.scope,{...input,outcome:'completed'});return j.failCheckpoint(identity.scope,{...input,errorCode:'fixture-checkpoint-failed'});}
  async observerGate(enabled){this.env.M3_OBSERVER_ENABLED=enabled?'true':'false';}
  async diagnostics(){const rows=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='service_intents'").toArray();return {count:rows.length?this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM service_intents').one().n:0,wake:await this.ctx.storage.get('m3:service:wake-at')??null,alarm:await this.ctx.storage.getAlarm()};}
  async unready(){const s=await this.ctx.storage.get('m1:workspace:initialization');s.projectionConfirmed=false;await this.ctx.storage.put('m1:workspace:initialization',s);}
  async corruptTurnWake(value){if(value===null)await this.ctx.storage.delete('m2:turn:wake-at');else await this.ctx.storage.put('m2:turn:wake-at',value);}
 }
 export class ObserverExecutorFixture extends DurableObject{
  retained;readRetained;
  async readStats(){return {reads:await this.ctx.storage.get('reads')??0};}
  async lateReadCapability(){let denied=false;try{await this.readRetained.authorize();}catch{denied=true;}this.readRetained[Symbol.dispose]();this.readRetained=undefined;return {denied};}
  async readArtifact(command,receipt,capability){
   this.readRetained=capability.dup();await this.ctx.storage.put('reads',(await this.ctx.storage.get('reads')??0)+1);
   await capability.authorize();
   while(await this.ctx.storage.get('mode')==='read-hold')await new Promise(resolve=>setTimeout(resolve,20));
   await capability.authorize();
   const mode=await this.ctx.storage.get('mode');
   const content=new TextEncoder().encode(JSON.stringify(receipt.kind==='state'?{simulation_state_id:'historical-state',sequence:1,state:{queue:3}}:{type:'snapshot',text:'Historical view',truncated:false}));
   return {receipt:mode==='read-wrong-receipt'?{...receipt,sha256:'f'.repeat(64)}:receipt,content:mode==='read-wrong-content'?new Uint8Array([1]):content};
  }
  async lateCapability(){let denied=false;try{await this.retained.authorize();}catch{denied=true;}const cancelled=await this.retained.cancelled();let forwardDenied=false;try{await this.retained.forward(new Request('http://localhost:8080/state'));}catch{forwardDenied=true;}this.retained[Symbol.dispose]();this.retained=undefined;return {denied,cancelled,forwardDenied};}
  async configure(mode){await this.ctx.storage.put('mode',mode);}
  async diagnostics(){return {executions:await this.ctx.storage.get('executions')??0,stops:await this.ctx.storage.get('stops')??0};}
  async execute(command,capability){
   this.retained=capability.dup();
   await this.ctx.storage.put('executions',(await this.ctx.storage.get('executions')??0)+1);
   const grant=await capability.authorize();if(await capability.cancelled())throw Error('observer-cancelled');
   if(await this.ctx.storage.get('mode')==='unknown')throw Error('observer-fixture-lost-reply');
   const response=await capability.forward(new Request('http://localhost:8080'+grant.policy.statePath,{headers:{cookie:'must-strip=1'}}));
   const state=await response.json();await capability.authorize();
   return {stopped:true,result:{fixture:true,sequence:state.sequence,targetDigest:grant.targetDigest}};
  }
  async stop(command){await this.ctx.storage.put('stops',(await this.ctx.storage.get('stops')??0)+1);return await this.ctx.storage.get('mode')==='stopped';}
 }
 export class ProductRuntimeFixture extends DurableObject{
  async seed(identity){await this.ctx.storage.put({identity,expiresAt:Date.now()+600000,calls:[]});}
  async currentObserverExecution(identity){const expected=await this.ctx.storage.get('identity');if(JSON.stringify(identity)!==JSON.stringify(expected))throw Error('fixture-runtime-identity-denied');const calls=await this.ctx.storage.get('calls');calls.push(identity);await this.ctx.storage.put('calls',calls);return {expiresAt:await this.ctx.storage.get('expiresAt')};}
  async calls(){return await this.ctx.storage.get('calls')??[];}
 }
 export class Runtime extends DurableObject{
  observerHeld=false;observerCancelled=false;
  async holdObserver(value){this.observerHeld=value;}

  async forwarding(){return {observerCancelled:this.observerCancelled,observerForwards:await this.ctx.storage.get('observerForwards')??[],wsForwards:await this.ctx.storage.get('wsForwards')??[],wsMessages:await this.ctx.storage.get('wsMessages')??0,forwards:await this.ctx.storage.get('forwards')??[],starts:await this.ctx.storage.get('starts')??0};}
  async fetch(wire){
   const {input,request}=readPrivateWebSocketRequest(wire,'runtime');
   const calls=await this.ctx.storage.get('wsForwards')??[];calls.push({url:request.url,headers:Object.fromEntries(request.headers),runId:input.reference.runId});await this.ctx.storage.put('wsForwards',calls);
   const [client,server]=Object.values(new WebSocketPair());server.binaryType='arraybuffer';server.accept();
   server.addEventListener('message',async e=>{await this.ctx.storage.put('wsMessages',(await this.ctx.storage.get('wsMessages')??0)+1);server.send(e.data);});
   server.addEventListener('close',()=>{try{server.close(1000,'fixture closed');}catch{}});
   const headers=new Headers();const protocol=request.headers.get('sec-websocket-protocol')?.split(',')[0]?.trim();if(protocol)headers.set('sec-websocket-protocol',protocol);
   return new Response(null,{status:101,webSocket:client,headers});
  }
  async forwardObserverHttp(input,request,cancellation){const calls=await this.ctx.storage.get('observerForwards')??[];calls.push({input,url:request.url,method:request.method,headers:Object.fromEntries(request.headers)});await this.ctx.storage.put('observerForwards',calls);const container={running:true,getTcpPort:port=>({fetch:async()=>this.observerHeld?new Response(new ReadableStream({cancel:()=>{this.observerCancelled=true;}})):Response.json({simulation_state_id:'fixture-state',sequence:0,state:{running:true}},{headers:{'set-cookie':'must-not-leak=1','x-private':'private'}})})};return forwardRunningObserver(container,request,input.policy,input.deadlineAt,cancellation);}

  async forwardHttp(input,request){
   if(new URL(request.url).origin!=='http://localhost:8080')throw Error('fixture-invalid-internal-origin');
   const calls=await this.ctx.storage.get('forwards')??[];calls.push({url:request.url,method:request.method,headers:Object.fromEntries([...request.headers].filter(([name])=>!['cookie','authorization'].includes(name))),hasCookie:request.headers.has('cookie'),hasAuthorization:request.headers.has('authorization'),runId:input.reference.runId});await this.ctx.storage.put('forwards',calls);
   if(new URL(request.url).pathname==='/api/state')return Response.json({fixture:true,status:'running',runId:input.reference.runId});
   return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><h1>Vertical project</h1><button id="state">读取项目状态</button><pre id="result"></pre><script>document.querySelector("#state").onclick=async()=>{const r=await fetch("/api/state");document.querySelector("#result").textContent=await r.text();};</script></html>',{headers:{'content-type':'text/html; charset=utf-8'}});
  }

  async value(input){const stop=await this.ctx.storage.get('stop');return {reference:input.reference,scope:input.scope,status:stop?'stopped':await this.ctx.storage.get('started')?'healthy':'absent',stop:stop??null};}
  async start(input){await this.ctx.storage.put('starts',(await this.ctx.storage.get('starts')??0)+1);if(!await this.ctx.storage.get('stop'))await this.ctx.storage.put('started',true);await this.ctx.storage.put('input',input);return this.value(input);}
  async observe(input){return this.value(input);}
  async stop(input){if(!await this.ctx.storage.get('stop'))await this.ctx.storage.put('stop',{reference:input.reference,scope:input.scope,confirmationId:'stop-'+input.reference.runId,observedAt:Date.now(),fenced:true});return this.value(input);}
 }
 export default {async fetch(req,env){const url=new URL(req.url),database=catalogDatabase(env.CATALOG);
  if(url.origin==='https://app.example.test'&&url.pathname.startsWith('/api/'))return gateway(req,{origin:env.APP_ORIGIN,database,identity:async()=>({subject:'auth-user-a',email:'fixture@example.test',emailVerified:true,platformVersion:1,browserSession:{sessionId:'auth-session-a',expiresAt:Number(env.FIXTURE_SESSION_EXPIRY)}}),previews:createGatewayPreviewServices(env,database),simulations:createGatewaySimulationServices(env),researchExports:createGatewayResearchExports(env),publications:createGatewayPublications(env),publicationArtifacts:new R2PublicationArtifacts(env.WORKSPACE_CHECKPOINTS),modelContent:new R2ModelContentPort(env.WORKSPACE_CHECKPOINTS),modelUpload:new R2ModelContentUploadPort(env.WORKSPACE_CHECKPOINTS)});
  if(url.protocol==='https:'&&url.hostname.endsWith('.preview.example.test'))return previewHost(req,env,database);
  if(url.origin!=='https://fixture.test'||req.method!=='POST')return new Response(null,{status:404});
  try{const b=await req.json();let value;
   if(b.method==='observerForward'){const response=await env.WORKSPACE_AGENT.getByName('workspace:tenant-a:workspace-a').forwardObserverHttp(b.input,new Request(b.request.url,{method:b.request.method??'GET',headers:b.request.headers??{}}));value={status:response.status,body:await response.text(),headers:Object.fromEntries(response.headers)};}
   else if(b.method==='executorConfigure')value=await env.OBSERVER_EXECUTOR.getByName(await observerExecutorActorName(b.input)).configure(b.value);
   else if(b.method==='executorLateCapability')value=await env.OBSERVER_EXECUTOR.getByName(await observerExecutorActorName(b.input)).lateCapability();
   else if(b.method==='executorReadStats')value=await env.OBSERVER_EXECUTOR.getByName(await observerExecutorActorName(b.input)).readStats();
   else if(b.method==='executorLateReadCapability')value=await env.OBSERVER_EXECUTOR.getByName(await observerExecutorActorName(b.input)).lateReadCapability();
   else if(b.method==='executorDiagnostics')value=await env.OBSERVER_EXECUTOR.getByName(await observerExecutorActorName(b.input)).diagnostics();
   else if(b.method==='holdObserver')value=await env.SERVICE_RUNTIME.getByName(await serviceRuntimeActorName(b.input)).holdObserver(b.value);
   else if(b.method==='observerCalls')value=await env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(b.input)).calls();
   else if(b.method==='forwarding')value=await env.SERVICE_RUNTIME.getByName(await serviceRuntimeActorName(b.input)).forwarding();
   else if([...${JSON.stringify(fixtureMethods)},'readObserverArtifact','seedObserverArtifact','terminalObserver','corruptTurnWake','observerAccept','observerAlarm','observerMaintenanceDue','unready','seed','submitServiceRequest','serviceSnapshot','serviceView','observePreview','observerRoute','observerRecord','observerTurn','observerClaim','finishObserver','cancelObserver','observerGate','authorizeObserverCommand','bindPreview','revokePreview'].includes(b.method))value=await env.WORKSPACE_AGENT.getByName('workspace:tenant-a:workspace-a')[b.method](...(b.args??[]));
   else return new Response(null,{status:404});return Response.json({ok:true,value:b.method==='readObserverArtifact'?{...value,content:Array.from(value.content)}:value});
  }catch(e){return Response.json({ok:false,error:e.message});}
 }};`;
 const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'preview-vertical.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const options=()=>({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{...(observerExecutor?{OBSERVER_EXECUTOR:{type:'durable-object',worker,exportName:'ObserverExecutorFixture'}}:{}),APP_ORIGIN:{type:'text',value:'https://app.example.test'},M3_PREVIEW_ORIGIN:{type:'text',value:'https://preview.example.test'},FIXTURE_SESSION_EXPIRY:{type:'text',value:String(expiresAt)},CATALOG:{type:'d1',id:'preview-ticket-catalog',name:'preview-ticket-catalog'},M3_PREVIEW_ENABLED:{type:'text',value:'true'},M3_PREVIEW_WS_ENABLED:{type:'text',value:'true'},M3_SERVICE_ENABLED:{type:'text',value:'true'},M3_SERVICE_IMAGE:{type:'text',value:image},M2_TURNS_ENABLED:{type:'text',value:observer?'true':'false'},M3_OBSERVER_ENABLED:{type:'text',value:'false'},PRODUCT_TURN_RUNTIME:{type:'durable-object',worker,exportName:'ProductRuntimeFixture'},TENANT_QUOTA_CAPACITY:{type:'text',value:'4'},TENANT_QUOTA_POLICY_VERSION:{type:'text',value:'fixture-v1'},WORKSPACE_AGENT:{type:'durable-object',worker,exportName:'WorkspaceAgent'},SERVICE_RUN:{type:'durable-object',worker,exportName:'ServiceRun'},SERVICE_RUNTIME:{type:'durable-object',worker,exportName:'Runtime'},TENANT_QUOTA:{type:'durable-object',worker,exportName:'TenantQuota'},REVISION_STORE:{type:'durable-object',worker,exportName:'RevisionStore'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'workspace-service-revisions'}},exports:Object.fromEntries(['ObserverExecutorFixture','WorkspaceAgent','ServiceRun','Runtime','ProductRuntimeFixture','TenantQuota','RevisionStore'].map(name=>[name,{type:'durable-object',storage:'sqlite'}]))},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response(null,{status:403})}}}]});
 let mf=new Miniflare(options());let disposed=false;
 const dispose=async()=>{if(disposed)return;disposed=true;await mf.dispose();await rm(directory,{recursive:true,force:true});};
 const call=async(method,args=[],extra={})=>{const response=await mf.dispatchFetch('https://fixture.test/',{method:'POST',body:JSON.stringify({method,args,...extra})}),body=await response.json();if(!body.ok)throw Error(body.error);return body.value;};
 try{await mf.ready;let db=await mf.getD1Database('CATALOG',worker);
  for(const filename of ['0001_catalog.sql','0002_auth.sql','0003_provisioning.sql','0004_operator_invitations.sql','0005_initial_operator.sql','0006_model_catalog.sql','0007_model_content_checks.sql','0008_preview_routes.sql','0009_model_submissions.sql']){const schema=(await readFile(`services/catalog/migrations/${filename}`,'utf8')).replace(/--[^\n]*/g,'');for(const statement of schema.match(/\s*CREATE\s+TRIGGER[\s\S]*?\bEND\s*;|[^;]+;/gi)||[])await db.prepare(statement.trim()).run();}
  const inserts=[
   ["INSERT INTO auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('auth-user-a','Fixture','fixture@example.test',1,1,1)"],
   ["INSERT INTO auth_session(id,expiresAt,token,createdAt,updatedAt,userId,platformVersion) VALUES('auth-session-a',?,'fixture-session-token',1,1,'auth-user-a',1)",expiresAt],
   ["INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES('user-a','better-auth','auth-user-a','fixture@example.test',1,1)"],
   ["INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES('tenant-a','user-a',1,1)"],
   ["INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES('tenant-a','user-a',1,1)"],
   ["INSERT INTO catalog_projects(id,tenant_id,owner_user_id,workspace_id,title,starter_version,status,created_at,updated_at) VALUES('project-a','tenant-a','user-a','workspace-a','Fixture','blank-v1','ready',1,1)"],
   ["INSERT INTO catalog_workspaces(id,project_id,tenant_id,owner_user_id,status,created_at,updated_at) VALUES('workspace-a','project-a','tenant-a','user-a','ready',1,1)"]
  ];await db.batch(inserts.map(([query,...args])=>db.prepare(query).bind(...args)));

 const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1};
 await call('seed',[scope,actor,'vertical']);
 const submitted=await call('submitServiceRequest',[{scope,actor,key:'vertical-service',body:{maxDurationMs:300000}}]);
 const deadline=Date.now()+12000;let view;
 do{view=await call('serviceView',[{scope,runId:submitted.runId}]);if(view.run?.status==='running')break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);
 if(view.run?.status!=='running')throw Error('fixture-service-did-not-start');
 const input={reference:view.run.runtime,scope,spec:view.run.spec,lease:{tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,operation:'service-run',operationId:view.run.runtime.dispatchId,deadlineAt:view.run.runtime.deadlineAt,runId:view.run.id,leaseId:view.run.runtime.leaseId}};
 return {get db(){return db;},get mf(){return mf;},restart:async()=>{await mf.dispose();mf=new Miniflare(options());await mf.ready;db=await mf.getD1Database('CATALOG',worker);},scope,call,rotateAuthVersion:async version=>{await db.prepare("UPDATE catalog_users SET auth_version=? WHERE id='user-a'").bind(version).run();},holdObserver:value=>call('holdObserver',[],{input,value}),revokeMembership:async()=>{await db.prepare("UPDATE catalog_memberships SET status='revoked' WHERE tenant_id='tenant-a' AND user_id='user-a'").run();},runId:submitted.runId,dispose,revokeSession:async()=>{await db.prepare("DELETE FROM auth_session WHERE id='auth-session-a'").run();},diagnostics:()=>call('forwarding',[],{input})};
 }catch(error){await dispose();throw error;}
}
