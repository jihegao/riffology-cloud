import test from 'node:test';
import assert from 'node:assert/strict';
import {createGatewayProjectViewSessionServices} from '../../services/gateway/project-view-session-services.ts';
import {createGatewayProjectViewServices} from '../../services/gateway/project-view-services.ts';
import {parseProjectViewPolicy,projectViewAdmission,projectViewPolicyHash} from '../../services/project-views/policy.ts';
import type {ProjectViewPackage} from '../../services/project-views/package.ts';
import type {ProjectViewRuntimeIdentity,ProjectViewRuntimePort} from '../../services/project-views/runtime-protocol.ts';
import {gateway} from '../../services/gateway/app.ts';
import {SqliteCatalog} from '../m1/sqlite-database.ts';

const scope={tenantId:'tenant-alpha',projectId:'project-alpha',workspaceId:'workspace-alpha',workspaceGeneration:1},actor={userId:'alpha',authVersion:1},origin='https://app.example.test',image='registry.example.test/browser@sha256:'+'e'.repeat(64);
const view={id:'home',title:'Home',entrypoint:'app/home.html'};
const pkg:ProjectViewPackage={schema:'project.view-package/v1',scope,revisionId:'revision-one',filesSha256:'f'.repeat(64),manifest:{schema:'project.views/v1',files:['app/home.html'],views:[view]},assets:[],packageIdentity:'a'.repeat(64)};
async function fixture(){
 const now=Date.now(),raw=JSON.stringify({schema:'project-view-policy/v1',enabled:true,startsAt:now-1000,endsAt:now+600000,image,grants:[{scope,actor}]}),hash=await projectViewPolicyHash(raw);
 const env={APP_ORIGIN:origin,PROJECT_VIEW_POLICY_JSON:raw,PROJECT_VIEW_RUNTIME_POLICY_HASH:hash,PROJECT_VIEW_RUNTIME_IMAGE:image};
 let saved:ProjectViewRuntimeIdentity|null=null,valid=true,closeCount=0,starts=0,commands=0,packageReads=0,authorityReads=0,onCommand=()=>{},onStart=()=>{};
 const runtime:ProjectViewRuntimePort={
  async lookup(input){return saved&&input.sessionId===saved.sessionId&&input.actor.userId===saved.actor.userId&&input.workspaceId===saved.scope.workspaceId?structuredClone(saved):null;},
  async start(input){starts++;if(saved)assert.deepEqual(input.identity,saved);else saved=structuredClone(input.identity);onStart();return {id:input.identity.sessionId,status:'running',cleanupConfirmed:false,cleanupProofId:null};},
  async command(){commands++;onCommand();return {messages:[{type:'installed'}]};},
  async close(){closeCount++;return {closed:true,cleanupConfirmed:true};},
  async status(input){return {id:input.identity.sessionId,status:'running',cleanupConfirmed:false,cleanupProofId:null};},
 };
 const bound={...env,PROJECT_VIEW_RUNTIME:{getByName:()=>runtime},WORKSPACE_AGENT:{getByName:()=>({async projectViews(){packageReads++;return structuredClone(pkg);},async projectViewCurrent(){authorityReads++;return {current:valid};}})}};
 return {env,bound,runtime,service:createGatewayProjectViewSessionServices(bound),get starts(){return starts;},get closes(){return closeCount;},get commands(){return commands;},get packageReads(){return packageReads;},get authorityReads(){return authorityReads;},invalidate(){valid=false;},set onCommand(value:()=>void){onCommand=value;},set onStart(value:()=>void){onStart=value;}};
}
const create={requestId:'original-operation',packageIdentity:pkg.packageIdentity,viewId:'home'};

test('browser admission is default closed and binds exact actor, scope, image and raw policy pin',async()=>{
 const f=await fixture();assert.ok(parseProjectViewPolicy(f.env.PROJECT_VIEW_POLICY_JSON));
 await projectViewAdmission(f.env,scope,actor);
 for(const changed of [{PROJECT_VIEW_POLICY_JSON:undefined},{PROJECT_VIEW_RUNTIME_POLICY_HASH:'b'.repeat(64)},{PROJECT_VIEW_RUNTIME_IMAGE:'sha256:'+'b'.repeat(64)},{APP_ORIGIN:'http://outside.test'},{PROJECT_VIEW_POLICY_JSON:JSON.stringify({...JSON.parse(f.env.PROJECT_VIEW_POLICY_JSON),enabled:false})}])await assert.rejects(projectViewAdmission({...f.env,...changed},scope,actor),/admission-closed/);
 for(const [s,a]of [[{...scope,workspaceGeneration:2},actor],[scope,{...actor,authVersion:2}],[{...scope,projectId:'foreign'},actor]] as const)await assert.rejects(projectViewAdmission(f.env,s,a),/admission-closed/);
 for(const mutation of [{extra:true},{endsAt:Date.now()+2*86400000},{grants:[]},{image:'browser:latest'}])assert.equal(parseProjectViewPolicy(JSON.stringify({...JSON.parse(f.env.PROJECT_VIEW_POLICY_JSON),...mutation})),null);
});
test('production page discovery stays closed without a complete explicit browser grant',async()=>{
 const f=await fixture();const closed=createGatewayProjectViewServices({...f.bound,PROJECT_VIEW_POLICY_JSON:'{}'});
 await assert.rejects(closed.read(scope,actor),/admission-closed/);assert.equal(f.packageReads,0);
 const open=createGatewayProjectViewServices(f.bound),result=await open.read(scope,actor);
 assert.deepEqual(result.delivery,{executionOrigin:origin,transport:'isolated-browser-authenticated/v1',sessionPath:'/api/workspaces/workspace-alpha/project-view-sessions'});
});
test('authenticated sessions derive their package server-side; command authority never transfers the archive',async()=>{
 const f=await fixture();let authorizations=0;const auth=async()=>{authorizations++;};
 assert.deepEqual(await f.service.start(scope,actor,create,auth),{id:create.requestId});
 assert.equal(f.packageReads,1);const before=f.packageReads;
 await f.service.command(scope.workspaceId,actor,create.requestId,{type:'poll'},auth);
 assert.equal(f.packageReads,before);assert.ok(f.authorityReads>=3);assert.ok(authorizations>=6);
 await assert.rejects(f.service.command(scope.workspaceId,{userId:'foreign',authVersion:1},create.requestId,{type:'poll'},auth),/session-denied/);assert.equal(f.commands,1);
 for(const extra of [{...create,package:pkg},{...create,scope},{...create,viewId:'missing'}])await assert.rejects(f.service.start(scope,actor,extra,auth));
});
test('a package replacement during pixel delivery drops the old result and closes the original session',async()=>{
 const f=await fixture();await f.service.start(scope,actor,create,async()=>{});f.onCommand=()=>f.invalidate();
 await assert.rejects(f.service.command(scope.workspaceId,actor,create.requestId,{type:'poll'},async()=>{}),/package-changed/);
 assert.equal(f.closes,1);
 // A new auth version may clean up the old browser, never read/input through it.
 assert.deepEqual(await f.service.close(scope.workspaceId,{...actor,authVersion:2},create.requestId),{closed:true,cleanupConfirmed:true});
 assert.equal(f.closes,2);
});
test('revocation after a started browser closes only the original identity before returning',async()=>{
 const f=await fixture();let allowed=true;f.onStart=()=>{allowed=false;};
 await assert.rejects(f.service.start(scope,actor,create,async()=>{if(!allowed)throw Error('revoked');}),/revoked/);
 assert.equal(f.starts,1);assert.equal(f.closes,1);
});

test('real Catalog ownership and accepted invitation guard session routes; cleanup survives membership removal',async t=>{
 const f=await fixture(),db=new SqliteCatalog();t.after(()=>db.sqlite.close());
 for(const user of ['alpha','beta']){
  db.sqlite.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES(?,'better-auth',?,?,1000,1000)").run(user,user,user+'@example.test');
  db.sqlite.prepare("INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES(?,?,1000,1000)").run('tenant-'+user,user);
  db.sqlite.prepare("INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES(?,?,1000,1000)").run('tenant-'+user,user);
 }
 db.sqlite.prepare("INSERT INTO catalog_projects(id,tenant_id,owner_user_id,workspace_id,title,starter_version,status,created_at,updated_at) VALUES(? ,?,'alpha',?,'Pages','blank-v1','ready',1000,1000)").run(scope.projectId,scope.tenantId,scope.workspaceId);
 db.sqlite.prepare("INSERT INTO catalog_workspaces(id,project_id,tenant_id,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,'alpha','ready',1000,1000)").run(scope.workspaceId,scope.projectId,scope.tenantId);
 db.sqlite.prepare("INSERT INTO catalog_invitations(id,token_hash,normalized_email,state,issued_by,created_at,expires_at) VALUES('accepted',?,'alpha@example.test','pending','beta',1000,?)").run('d'.repeat(64),Date.now()+60000);
 db.sqlite.prepare("UPDATE catalog_invitations SET state='accepted',accepted_by='alpha',accepted_at=1001 WHERE id='accepted'").run();
 const services={origin,database:db,identity:async(request:Request)=>{const user=request.headers.get('x-synthetic-user')??'alpha';return {subject:user,email:user+'@example.test',emailVerified:true,platformVersion:1};},projectViewSessions:f.service};
 const post=(path:string,body:unknown,user='alpha',requestOrigin=origin)=>gateway(new Request(origin+path,{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json','x-synthetic-user':user},body:JSON.stringify(body)}),services);
 const base='/api/workspaces/'+scope.workspaceId+'/project-view-sessions';
 assert.equal((await post(base,create,'beta')).status,404);assert.equal(f.starts,0);
 assert.equal((await post(base,create,'alpha','https://foreign.test')).status,403);assert.equal(f.starts,0);
 assert.equal((await post(base,create)).status,201);assert.equal(f.starts,1);
 db.sqlite.prepare("DELETE FROM catalog_memberships WHERE user_id='alpha'").run();
 assert.equal((await post(base+'/'+create.requestId,{type:'poll'})).status,404);assert.equal(f.commands,0);
 assert.equal((await post('/api/project-view-sessions/'+create.requestId+'/close',{workspaceId:scope.workspaceId})).status,200);
 assert.equal(f.closes,1);
 assert.equal((await post('/api/project-view-sessions/'+create.requestId+'/close',{workspaceId:scope.workspaceId},'beta')).status,404);assert.equal(f.closes,1);
});
