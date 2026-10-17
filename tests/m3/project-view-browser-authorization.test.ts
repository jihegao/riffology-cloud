import test from 'node:test';
import assert from 'node:assert/strict';
import {Admission,type VerifiedIdentity} from '../../services/catalog/admission.ts';
import {OperatorCatalog} from '../../services/catalog/admin.ts';
import {ProjectCatalog} from '../../services/catalog/projects.ts';
import {digest} from '../../services/catalog/contracts.ts';
import type {Statement} from '../../services/catalog/database.ts';
import {gateway,type GatewayServices} from '../../services/gateway/app.ts';
import type {ProjectViewPackage} from '../../services/project-views/package.ts';
import {PROJECT_VIEW_FRAME_PATH,PROJECT_VIEW_FRAME_SHA256} from '../../services/project-views/frame.mjs';
import type {TurnActor,TurnScope} from '../../services/turn/protocol.ts';
import {SqliteCatalog} from '../m1/sqlite-database.ts';

// Real Gateway/Catalog authorization, synthetic identity and Workspace replies.
// No OAuth, page execution, provider, cloud resource or real-user acceptance.
const origin='https://app.example.test',identity='a'.repeat(64),marker='SYNTHETIC_WORKSPACE_BYTES';
const routes=[
 {name:'package',path:(workspace:string)=>`/api/workspaces/${workspace}/project-views`,kind:'package'},
 {name:'current package',path:(workspace:string)=>`/api/workspaces/${workspace}/project-views?identity=${identity}`,kind:'package'},
 {name:'artifact list',path:(workspace:string)=>`/api/workspaces/${workspace}/project-view-artifacts?identity=${identity}`,kind:'artifact'},
 {name:'artifact read',path:(workspace:string)=>`/api/workspaces/${workspace}/project-view-artifacts/artifact-${'b'.repeat(60)}?identity=${identity}&offset=0`,kind:'artifact'},
] as const;
type Invitation='ordinary'|'none'|'pending'|'initial_operator';
async function fixture(invitation:Invitation='ordinary'){
 const db=new SqliteCatalog(),now=Date.now(),catalog=new ProjectCatalog(db,new Set(['blank-v1']));
 for(const user of ['issuer','alpha','beta']){
  db.sqlite.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES(?,'better-auth',?,?,?,?)").run(user,user,user+'@example.test',now,now);
  db.sqlite.prepare('INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES(?,?,?,?)').run('tenant-'+user,user,now,now);
  db.sqlite.prepare('INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES(?,?,?,?)').run('tenant-'+user,user,now,now);
 }
 const verified=(user:string):VerifiedIdentity=>({subject:user,email:user+'@example.test',emailVerified:true,platformVersion:1});
 const admission=new Admission(db);
 if(invitation==='initial_operator'){
  // Purpose is set at the permitted pending INSERT, never by changing an
  // immutable invitation. Real acceptance triggers the initial operator grant.
  const token='c'.repeat(64);
  db.sqlite.prepare("INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at,purpose) VALUES('initial-alpha',?,'alpha@example.test',?,?,'initial_operator')").run(await digest(token),now,now+60000);
  await admission.accept(verified('alpha'),token);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM catalog_platform_roles WHERE user_id='alpha' AND role='operator' AND status='active'").get()!.n,1);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM catalog_invitations WHERE accepted_by='alpha' AND purpose='user'").get()!.n,0);
 }
 // Ordinary fixtures use the real operator issue and verified-email accept
 // path. Bootstrap must happen first because an active operator fences it.
 db.sqlite.prepare("INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES('issuer','operator','active',?,?)").run(now,now);
 const admin=new OperatorCatalog(db);
 for(const user of ['alpha','beta']){
  if(user==='alpha'&&invitation!=='ordinary'&&invitation!=='pending')continue;
  const issued=await admin.issue({userId:'issuer',authVersion:1},'invite-'+user,{email:user+'@example.test',expiresInDays:1});
  if(user!=='alpha'||invitation!=='pending')await admission.accept(verified(user),issued.token!);
 }
 const actor={userId:'alpha',authVersion:1};
 const created=await catalog.create(actor,'tenant-alpha','project-alpha',{title:'Synthetic browser pages',starterVersion:'blank-v1'});
 db.sqlite.prepare("UPDATE catalog_projects SET status='ready' WHERE id=?").run(created.project.id);
 db.sqlite.prepare("UPDATE catalog_workspaces SET status='ready' WHERE id=?").run(created.project.workspace_id);
 const scope=await catalog.workspace(actor,created.project.workspace_id),calls:Array<{kind:string;scope:TurnScope;actor:TurnActor;query?:unknown}>=[];
 let duringRpc:()=>void=()=>{};
 // Complete typed Workspace fixture. Hashes are synthetic; package integrity
 // and native DOM behavior are intentionally outside this authorization test.
 const pkg:ProjectViewPackage={
  schema:'project.view-package/v1',scope,revisionId:'revision-synthetic',filesSha256:'c'.repeat(64),
  manifest:{schema:'project.views/v1',files:['app/home.html'],views:[{id:'home',title:marker,entrypoint:'app/home.html'}]},
  assets:[{path:'app/home.html',mediaType:'text/html',base64:btoa('<h1>synthetic</h1>'),sourceSha256:'d'.repeat(64),sha256:'e'.repeat(64)}],
  packageIdentity:identity,
 };
 const services:GatewayServices={origin,database:db,identity:async request=>verified(request.headers.get('x-synthetic-user')??'alpha'),projectViews:{
  browserLocal:true,
  async read(owned,requester){calls.push({kind:'package',scope:owned,actor:requester});await Promise.resolve().then(()=>duringRpc());return {package:pkg,delivery:{execution:'browser-local',transport:'native-dom/v1',executionOrigin:origin,frameUrl:origin+PROJECT_VIEW_FRAME_PATH,frameSha256:PROJECT_VIEW_FRAME_SHA256}};},
  async artifacts(owned,requester,query){calls.push({kind:'artifact',scope:owned,actor:requester,query});await Promise.resolve().then(()=>duringRpc());return {items:[{syntheticBytes:marker}]};},
 }};
 const request=(route:typeof routes[number],user='alpha')=>gateway(new Request(origin+route.path(scope.workspaceId),{headers:{'x-synthetic-user':user}}),services);
 return {db,scope,actor,calls,request,setDuringRpc:(change:()=>void)=>{duringRpc=change;},archive:()=>db.sqlite.prepare('UPDATE catalog_projects SET archived_at=?,archive_epoch=archive_epoch+1 WHERE id=?').run(Date.now(),scope.projectId)};
}
async function denied(response:Response,status:number){assert.equal(response.status,status);const body=await response.text();assert.doesNotMatch(body,new RegExp(marker));assert.match(body,/"error"/);}

test('ordinary accepted owner is the positive control for all four native browser reads',async()=>{
 const f=await fixture();try{
  for(const route of routes){const response=await f.request(route);assert.equal(response.status,200,route.name);const body=await response.json();if(route.name==='current package')assert.deepEqual(body,{current:true});else assert.match(JSON.stringify(body),new RegExp(marker));}
  assert.deepEqual(f.calls.map(c=>c.kind),routes.map(r=>r.kind));
  for(const call of f.calls){assert.deepEqual(call.scope,f.scope);assert.deepEqual(call.actor,f.actor);}
  assert.deepEqual(f.calls[2]!.query,{identity,cursor:null});
  assert.deepEqual(f.calls[3]!.query,{identity,artifactId:'artifact-'+'b'.repeat(60),offset:0});
 }finally{f.db.sqlite.close();}
});
for(const route of routes){
 test(`${route.name} denies absent, pending and initial-operator-only invitation before Workspace`,async()=>{
  for(const mode of ['none','pending','initial_operator'] as const){const f=await fixture(mode);try{await denied(await f.request(route),403);assert.equal(f.calls.length,0,mode);}finally{f.db.sqlite.close();}}
 });
 test(`${route.name} denies foreign owner and archived project before Workspace`,async()=>{
  const f=await fixture();try{await denied(await f.request(route,'beta'),404);assert.equal(f.calls.length,0);f.archive();await denied(await f.request(route),409);assert.equal(f.calls.length,0);}finally{f.db.sqlite.close();}
 });
 test(`${route.name} checks archive after the awaited post-RPC invitation query`,async()=>{
  const f=await fixture();try{
   const query=f.db.query.bind(f.db);let invitationReads=0,archivedAfterPostInvitation=false;
   f.db.query=async <T>(statement:Statement):Promise<T[]>=>{
    const rows=await query<T>(statement);
    if(statement.sql.includes('FROM catalog_invitations i')&&statement.sql.includes("i.purpose='user'")&&++invitationReads===2){
     assert.equal(f.calls.length,1);assert.ok(rows.length>0);
     // The invitation SQL saw an admitted owner, but its awaited result has
     // not returned to Gateway yet. The final workspace read must see archive.
     f.archive();archivedAfterPostInvitation=true;
    }
    return rows;
   };
   await denied(await f.request(route),409);
   assert.equal(invitationReads,2);assert.equal(archivedAfterPostInvitation,true);
   assert.equal(f.calls.length,1);assert.equal(f.calls[0]!.kind,route.kind);
  }finally{f.db.sqlite.close();}
 });
 const changes=[
  {name:'user auth_version changes',status:403,apply:(f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.prepare("UPDATE catalog_users SET auth_version=auth_version+1 WHERE id='alpha'").run()},
  {name:'user is revoked',status:403,apply:(f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.prepare("UPDATE catalog_users SET status='revoked' WHERE id='alpha'").run()},
  {name:'membership is revoked',status:403,apply:(f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.prepare("UPDATE catalog_memberships SET status='revoked' WHERE user_id='alpha'").run()},
  {name:'tenant is suspended',status:403,apply:(f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.prepare("UPDATE catalog_tenants SET status='suspended' WHERE id='tenant-alpha'").run()},
  {name:'project is archived',status:409,apply:(f:Awaited<ReturnType<typeof fixture>>)=>f.archive()},
 ];
 for(const change of changes)test(`${route.name} withholds awaited Workspace bytes when ${change.name}`,async()=>{
  const f=await fixture();try{f.setDuringRpc(()=>{change.apply(f);});await denied(await f.request(route),change.status);assert.equal(f.calls.length,1);assert.equal(f.calls[0]!.kind,route.kind);}finally{f.db.sqlite.close();}
 });
}
