import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Runtime is deliberately a private RPC fixture. This proves durable delivery,
// ownership and recovery, not Python/container execution or public Preview.
test('Workspace service outbox delivers through real shared alarms and survives restart/gate closure',{timeout:45000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'m3-workspace-service-')),worker='workspace-service-test';
 const image='registry.example/service@sha256:'+'f'.repeat(64);
 const entry=`import {DurableObject} from 'cloudflare:workers';
 import {WorkspaceAgent as Base} from './services/workspace/durable.ts';
 import {TurnJournal} from './services/turn/journal.ts';import {DurableTurnStore} from './services/turn/store.ts';
 import {initialWorkspaceArchive} from './services/turn-runtime/initial-workspace-archive.ts';
 import {revisionStoreActorName} from './services/turn-runtime/revision-store-client.ts';
 import {serviceRunActorName} from './services/run/host.ts';import {serviceRuntimeActorName} from './services/run/durable.ts';
 export {ServiceRun} from './services/run/durable.ts';export {TenantQuota} from './services/quota/durable.ts';export {RevisionStore} from './services/turn-runtime/revision-store.ts';
 export class WorkspaceAgent extends Base{
  async seed(scope,actor,key){
   const task={id:'workspace-task',tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:scope.workspaceGeneration,starterVersion:'m1-empty-v1',authVersion:1,createdAt:1,deadlineAt:9000};
   await this.ctx.storage.put('m1:workspace:initialization',{task,wakeAt:null,projection:{outcome:'ready'},projectionConfirmed:true});
   const j=new TurnJournal(new DurableTurnStore(this.ctx.storage));const session=(await j.createSession(scope,actor,'session-'+key,{title:'Fixture'})).session;
   await j.submit(scope,actor,session.id,'turn-'+key,{message:'Create fixture'});const turn=(await j.claim(scope,1)).turn;
   const identity={scope,sessionId:session.id,turnId:turn.id,dispatchId:turn.dispatchId,generation:1},encode=v=>new TextEncoder().encode(v);
   const filesArchive=initialWorkspaceArchive({'app/preview.json':encode(JSON.stringify({schemaVersion:1,runtime:'python',entrypoint:'app/main.py',dependencyLock:'app/requirements.lock',port:8080,healthPath:'/health'})),'app/main.py':encode('print('+JSON.stringify(key)+')'),'app/requirements.lock':encode(JSON.stringify({schemaVersion:1,packages:{}}))});
   const receipt=await this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).commit({identity,base:turn.base,outcome:'completed',executionErrorCode:null,snapshot:{identity,filesArchive,piSession:encode('private-session')}});
   await j.beginCheckpoint(scope,{turnId:turn.id,dispatchId:turn.dispatchId,runtimeGeneration:1,outcome:'completed'});
   await j.commitCheckpoint(scope,{turnId:turn.id,dispatchId:turn.dispatchId,runtimeGeneration:1,checkpoint:receipt});
   return {identity,revision:receipt};
  }
  async diagnostics(){const rows=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='service_intents'").toArray();return {count:rows.length?this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM service_intents').one().n:0,wake:await this.ctx.storage.get('m3:service:wake-at')??null,alarm:await this.ctx.storage.getAlarm()};}
  async unready(){const s=await this.ctx.storage.get('m1:workspace:initialization');s.projectionConfirmed=false;await this.ctx.storage.put('m1:workspace:initialization',s);}
  async corruptTurnWake(value){if(value===null)await this.ctx.storage.delete('m2:turn:wake-at');else await this.ctx.storage.put('m2:turn:wake-at',value);}
 }
 export class Runtime extends DurableObject{
  async forwarding(){return {calls:await this.ctx.storage.get('forwards')??[],starts:await this.ctx.storage.get('starts')??0};}
  async forwardHttp(input,request){const calls=await this.ctx.storage.get('forwards')??[];const observed={input,url:request.url,method:request.method,headers:Object.fromEntries(request.headers),body:await request.text()};calls.push(observed);await this.ctx.storage.put('forwards',calls);return Response.json(observed);}

  async value(input){const stop=await this.ctx.storage.get('stop');return {reference:input.reference,scope:input.scope,status:stop?'stopped':await this.ctx.storage.get('started')?'healthy':'absent',stop:stop??null};}
  async start(input){await this.ctx.storage.put('starts',(await this.ctx.storage.get('starts')??0)+1);if(!await this.ctx.storage.get('stop'))await this.ctx.storage.put('started',true);await this.ctx.storage.put('input',input);return this.value(input);}
  async observe(input){return this.value(input);}
  async stop(input){if(!await this.ctx.storage.get('stop'))await this.ctx.storage.put('stop',{reference:input.reference,scope:input.scope,confirmationId:'stop-'+input.reference.runId,observedAt:Date.now(),fenced:true});return this.value(input);}
 }
 export default {async fetch(req,env){try{const b=await req.json();let value;
  if(b.method==='forward'){const response=await env.WORKSPACE_AGENT.getByName('workspace:tenant-a:workspace-a').forwardPreviewHttp(b.args[0],new Request('https://public.example/api/state?q=1',{method:'POST',headers:{cookie:'secret-access-cookie',authorization:'Bearer private','x-private':'private','content-type':'application/json'},body:'{\"hello\":1}'}));value=await response.json();}
  else if(b.method==='forwarding')value=await env.SERVICE_RUNTIME.getByName(await serviceRuntimeActorName(b.input)).forwarding();
  else if(b.method==='run')value=await env.SERVICE_RUN.getByName(await serviceRunActorName(b.task)).snapshot();
  else if(b.method==='quota')value=await env.TENANT_QUOTA.getByName('tenant-quota:tenant-a').snapshot('tenant-a');
  else if(['exchangePreviewTicket','authorizePreviewAccess','revokePreviewAccess','issuePreviewTicket','redeemPreviewTicket','bindPreview','currentPreview','revokePreview','previewTarget','seed','submitService','submitServiceRequest','serviceView','listServices','stopService','serviceSnapshot','diagnostics','corruptTurnWake','unready'].includes(b.method))value=await env.WORKSPACE_AGENT.getByName(b.name??'workspace:tenant-a:workspace-a')[b.method](...(b.args??[]));
  else return new Response(null,{status:404});return Response.json({ok:true,value});
 }catch(e){return Response.json({ok:false,error:e.message});}}};`;
 const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'workspace-service-test.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const options=(enabled,configuredImage=image,previewEnabled='true')=>({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{CATALOG:{type:'d1',id:'preview-ticket-catalog',name:'preview-ticket-catalog'},M3_PREVIEW_ENABLED:{type:'text',value:previewEnabled},M3_SERVICE_ENABLED:{type:'text',value:enabled},M3_SERVICE_IMAGE:{type:'text',value:configuredImage},M2_TURNS_ENABLED:{type:'text',value:'false'},TENANT_QUOTA_CAPACITY:{type:'text',value:'4'},TENANT_QUOTA_POLICY_VERSION:{type:'text',value:'fixture-v1'},WORKSPACE_AGENT:{type:'durable-object',worker,exportName:'WorkspaceAgent'},SERVICE_RUN:{type:'durable-object',worker,exportName:'ServiceRun'},SERVICE_RUNTIME:{type:'durable-object',worker,exportName:'Runtime'},TENANT_QUOTA:{type:'durable-object',worker,exportName:'TenantQuota'},REVISION_STORE:{type:'durable-object',worker,exportName:'RevisionStore'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'workspace-service-revisions'}},exports:Object.fromEntries(['WorkspaceAgent','ServiceRun','Runtime','TenantQuota','RevisionStore'].map(name=>[name,{type:'durable-object',storage:'sqlite'}]))},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response(null,{status:403})}}}]});
 let mf;const call=async(method,args=[],body={})=>{const response=await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({method,args,...body})});const r=await response.json();if(!r.ok)throw Error(r.error);return r.value;};
 const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1},request={runtimeImage:image,maxDurationMs:60000};
 const until=async(read,predicate)=>{const end=Date.now()+12000;let result;do{result=await read();if(predicate(result))return result;await wait(100);}while(Date.now()<end);assert.fail('condition timed out: '+JSON.stringify(result));};
 try{
  mf=new Miniflare(options('true'));await mf.ready;let db=await mf.getD1Database('CATALOG',worker);
  for(const filename of ['0001_catalog.sql','0002_auth.sql','0003_provisioning.sql','0004_operator_invitations.sql','0005_initial_operator.sql','0006_model_catalog.sql','0007_model_content_checks.sql']){const schema=(await readFile(`services/catalog/migrations/${filename}`,'utf8')).replace(/--[^\n]*/g,'');for(const statement of schema.match(/\s*CREATE\s+TRIGGER[\s\S]*?\bEND\s*;|[^;]+;/gi)||[])await db.prepare(statement.trim()).run();}
  const expiresAt=Date.now()+120000,principal={userId:'user-a',authVersion:1,subject:'auth-user-a',sessionId:'auth-session-a',expiresAt},nonce='19'.repeat(32);
  const inserts=[
   ["INSERT INTO auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('auth-user-a','Fixture','fixture@example.test',1,1,1)"],
   ["INSERT INTO auth_session(id,expiresAt,token,createdAt,updatedAt,userId,platformVersion) VALUES('auth-session-a',?,'fixture-session-token',1,1,'auth-user-a',1)",expiresAt],
   ["INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES('user-a','better-auth','auth-user-a','fixture@example.test',1,1)"],
   ["INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES('tenant-a','user-a',1,1)"],
   ["INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES('tenant-a','user-a',1,1)"],
   ["INSERT INTO catalog_projects(id,tenant_id,owner_user_id,workspace_id,title,starter_version,status,created_at,updated_at) VALUES('project-a','tenant-a','user-a','workspace-a','Fixture','blank-v1','ready',1,1)"],
   ["INSERT INTO catalog_workspaces(id,project_id,tenant_id,owner_user_id,status,created_at,updated_at) VALUES('workspace-a','project-a','tenant-a','user-a','ready',1,1)"]
  ];await db.batch(inserts.map(([query,...args])=>db.prepare(query).bind(...args)));
  const source=await call('seed',[scope,actor,'first']);
  // An invalid sibling wake makes alarm projection fail after the SQL insert.
  // The first intent, service wake and physical alarm must roll back together.
  await call('corruptTurnWake',['invalid']);
  await assert.rejects(call('submitService',[{scope,actor,key:'rollback',request}]),/invalid-workspace-alarm-time/);
  assert.deepEqual(await call('diagnostics'),{count:0,wake:null,alarm:null});await call('corruptTurnWake',[null]);
  const input={scope,actor,key:'service-a',request},record=await call('submitService',[input]);assert.deepEqual(record.source,{kind:'saved-turn',...source});
  await call('seed',[scope,actor,'second']);const replay=await call('submitService',[input]);assert.equal(replay.runId,record.runId);assert.deepEqual(replay.source,record.source);assert.equal(replay.deliveryDeadlineAt,record.deliveryDeadlineAt);
  await assert.rejects(call('submitService',[{...input,actor:{...actor,authVersion:2}}]),/conflict/);
  await assert.rejects(call('submitService',[{...input,scope:{...scope,tenantId:'other'}}]),/scope-denied/);
  await assert.rejects(call('serviceSnapshot',[{scope:{...scope,workspaceGeneration:2},runId:record.runId}]),/scope-denied/);
  // Restart before polling. No wake RPC is exposed in this fixture.
  await mf.dispose();mf=new Miniflare(options('true'));
  const delivered=await until(()=>call('serviceSnapshot',[{scope,runId:record.runId}]),r=>r.status==='delivered');assert.deepEqual(delivered.task.spec.plan.source,record.source);
  await until(()=>call('run',[],{task:delivered.task}),r=>r?.status==='running');assert.equal((await call('quota')).occupied,1);
  const activeView=await call('serviceView',[{scope,runId:record.runId}]);assert.equal(activeView.intent.status,'delivered');assert.equal(activeView.run.status,'running');assert.equal(activeView.run.id,record.runId);
  const previewRequest={scope,actor,key:'preview-a',runId:record.runId,expectedPreviewId:null},preview=await call('bindPreview',[previewRequest]);
  assert.equal(preview.runId,record.runId);assert.equal((await call('previewTarget',[{scope,previewId:preview.previewId}])).run.status,'running');
  const ticketInput={scope,principal,previewId:preview.previewId,nonce},issued=await call('issuePreviewTicket',[ticketInput]);
  await assert.rejects(call('redeemPreviewTicket',[{scope,ticket:issued.ticket,nonce:'20'.repeat(32)}]),/denied/);
  const claims=await call('redeemPreviewTicket',[{scope,ticket:issued.ticket,nonce}]);assert.equal(claims.purpose,'browser');assert.equal(claims.binding.previewId,preview.previewId);assert.deepEqual(claims.principal,principal);
  await assert.rejects(call('redeemPreviewTicket',[{scope,ticket:issued.ticket,nonce}]),/denied/);
  const exchangedTicket=await call('issuePreviewTicket',[ticketInput]),access=await call('exchangePreviewTicket',[{scope,ticket:exchangedTicket.ticket,nonce,previewId:preview.previewId}]);
  const accessInput={scope,access:access.access,previewId:preview.previewId};
  assert.equal((await call('authorizePreviewAccess',[accessInput])).binding.previewId,preview.previewId);
  await assert.rejects(call('exchangePreviewTicket',[{scope,ticket:exchangedTicket.ticket,nonce,previewId:preview.previewId}]),/denied/);
  await assert.rejects(call('authorizePreviewAccess',[{...accessInput,previewId:'wrong-preview'}]),/denied/);
  const forwarded=await call('forward',[accessInput]);assert.equal(forwarded.url,'http://localhost:8080/api/state?q=1');assert.equal(forwarded.method,'POST');assert.deepEqual(forwarded.headers,{'content-type':'application/json'});assert.equal(forwarded.body,'{"hello":1}');assert.deepEqual(forwarded.input.spec,activeView.run.spec);assert.deepEqual(forwarded.input.reference,activeView.run.runtime);assert.deepEqual(forwarded.input.scope,scope);assert.deepEqual(forwarded.input.lease,{tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,operation:'service-run',operationId:activeView.run.runtime.dispatchId,deadlineAt:activeView.run.runtime.deadlineAt,runId:record.runId,leaseId:activeView.run.runtime.leaseId});
  await assert.rejects(call('forward',[{...accessInput,previewId:'wrong-preview'}]),/denied/);assert.equal((await call('forwarding',[],{input:forwarded.input})).calls.length,1);assert.equal((await call('forwarding',[],{input:forwarded.input})).starts,1);
  const revokeTicket=await call('issuePreviewTicket',[ticketInput]),revokable=await call('exchangePreviewTicket',[{scope,ticket:revokeTicket.ticket,nonce,previewId:preview.previewId}]);
  const unconsumed=await call('issuePreviewTicket',[ticketInput]);
  await mf.dispose();mf=new Miniflare(options('true',image,'false'));
  await assert.rejects(call('forward',[accessInput]),/preview-disabled/);assert.equal((await call('forwarding',[],{input:forwarded.input})).calls.length,1);
  await assert.rejects(call('authorizePreviewAccess',[accessInput]),/preview-disabled/);await call('revokePreviewAccess',[{scope,access:revokable.access}]);
  await assert.rejects(call('issuePreviewTicket',[ticketInput]),/preview-disabled/);await assert.rejects(call('redeemPreviewTicket',[{scope,ticket:unconsumed.ticket,nonce}]),/preview-disabled/);
  await mf.dispose();mf=new Miniflare(options('true','registry.example/changed@sha256:'+'e'.repeat(64)));
  await assert.rejects(call('redeemPreviewTicket',[{scope,ticket:issued.ticket,nonce}]),/denied/);
  assert.equal((await call('authorizePreviewAccess',[accessInput])).binding.previewId,preview.previewId);await assert.rejects(call('authorizePreviewAccess',[{...accessInput,access:revokable.access}]),/access-denied/);
  db=await mf.getD1Database('CATALOG',worker);await db.prepare("DELETE FROM auth_session WHERE id='auth-session-a'").run();
  await assert.rejects(call('forward',[accessInput]),/session-denied/);assert.equal((await call('forwarding',[],{input:forwarded.input})).calls.length,1);
  await assert.rejects(call('authorizePreviewAccess',[accessInput]),/session-denied/);
  await assert.rejects(call('issuePreviewTicket',[ticketInput]),/session-denied/);await assert.rejects(call('redeemPreviewTicket',[{scope,ticket:unconsumed.ticket,nonce}]),/session-denied/);
  assert.equal((await call('currentPreview',[{scope}])).previewId,preview.previewId);
  assert.equal((await call('bindPreview',[previewRequest])).previewId,preview.previewId);
  const afterImageChange=await call('submitService',[input]);assert.equal(afterImageChange.runId,record.runId);assert.deepEqual(afterImageChange.task,delivered.task);
  const publicInput={scope,actor,key:input.key,body:{maxDurationMs:request.maxDurationMs}};
  const policyReplay=await call('submitServiceRequest',[publicInput]);assert.equal(policyReplay.runId,record.runId);assert.equal(policyReplay.request.runtimeImage,image);
  await assert.rejects(call('submitServiceRequest',[{...publicInput,body:{maxDurationMs:1000}}]),/conflict/);
  await assert.rejects(call('submitService',[{...input,key:'old-image-new-request'}]),/image-conflict/);
  await mf.dispose();mf=new Miniflare(options('false'));
  await assert.rejects(call('submitService',[{...input,key:'closed'}]),/disabled/);assert.equal((await call('serviceSnapshot',[{scope,runId:record.runId}])).runId,record.runId);
  await assert.rejects(call('stopService',[{scope:{...scope,projectId:'other'},runId:record.runId}]),/scope-denied/);
  await call('unready');await assert.rejects(call('forward',[accessInput]),/workspace-not-ready/);assert.equal((await call('forwarding',[],{input:forwarded.input})).calls.length,1);await call('revokePreviewAccess',[{scope,access:access.access}]);await assert.rejects(call('authorizePreviewAccess',[accessInput]),/workspace-not-ready/);await assert.rejects(call('issuePreviewTicket',[ticketInput]),/workspace-not-ready/);await assert.rejects(call('redeemPreviewTicket',[{scope,ticket:unconsumed.ticket,nonce}]),/workspace-not-ready/);await call('stopService',[{scope,runId:record.runId}]);
  await assert.rejects(call('previewTarget',[{scope,previewId:preview.previewId}]),/workspace-not-ready/);
  await call('revokePreview',[{scope,previewId:preview.previewId,reason:'workspace-retired'}]);
  assert.equal((await call('currentPreview',[{scope}])).reason,'workspace-retired');
  const restoredList=await call('listServices',[{scope,limit:1}]);assert.equal(restoredList.items.length,1);assert.equal(restoredList.items[0].runId,record.runId);assert.equal(restoredList.nextCursor,null);
  await until(()=>call('serviceSnapshot',[{scope,runId:record.runId}]),r=>r.stopForwardedAt!==null);
  await until(()=>call('run',[],{task:delivered.task}),r=>r.status==='stopped');await until(()=>call('quota'),r=>r.occupied===0);
  assert.equal((await call('serviceView',[{scope,runId:record.runId}])).run.status,'stopped');
  await assert.rejects(call('listServices',[{scope:{...scope,projectId:'other'}}]),/scope-denied/);
  await assert.rejects(call('serviceView',[{scope:{...scope,projectId:'other'},runId:record.runId}]),/scope-denied/);
  await call('stopService',[{scope,runId:record.runId}]);const final=await call('serviceSnapshot',[{scope,runId:record.runId}]);assert.equal(final.status,'delivered');assert.equal((await call('diagnostics')).wake,null);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
