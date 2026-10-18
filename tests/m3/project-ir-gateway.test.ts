import test from 'node:test';
import assert from 'node:assert/strict';
import {Admission,type VerifiedIdentity} from '../../services/catalog/admission.ts';
import {OperatorCatalog} from '../../services/catalog/admin.ts';
import {ProjectCatalog} from '../../services/catalog/projects.ts';
import {gateway,type GatewayServices} from '../../services/gateway/app.ts';
import {createGatewayProjectViewServices,projectIrBrowserRequest} from '../../services/gateway/project-view-services.ts';
import type {TurnScope,TurnActor} from '../../services/turn/protocol.ts';
import {SqliteCatalog} from '../m1/sqlite-database.ts';
import type {Statement} from '../../services/catalog/database.ts';

// Real Gateway/Catalog and browser grant; synthetic identity and Workspace RPC.
const origin='https://app.example.test',packageIdentity='a'.repeat(64),marker='SYNTHETIC_IR_ONLY',clientId='00000000-0000-4000-8000-000000000001';
async function fixture(invited=true){
 const db=new SqliteCatalog(),now=Date.now(),catalog=new ProjectCatalog(db,new Set(['blank-v1']));
 for(const user of ['issuer','owner','foreign']){
  db.sqlite.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES(?,'better-auth',?,?,?,?)").run(user,user,user+'@example.test',now,now);
  db.sqlite.prepare('INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES(?,?,?,?)').run('tenant-'+user,user,now,now);
  db.sqlite.prepare('INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES(?,?,?,?)').run('tenant-'+user,user,now,now);
 }
 db.sqlite.prepare("INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES('issuer','operator','active',?,?)").run(now,now);
 const verified=(user:string):VerifiedIdentity=>({subject:user,email:user+'@example.test',emailVerified:true,platformVersion:1});
 if(invited){const issued=await new OperatorCatalog(db).issue({userId:'issuer',authVersion:1},'invite-owner',{email:'owner@example.test',expiresInDays:1});await new Admission(db).accept(verified('owner'),issued.token!);}
 const actor={userId:'owner',authVersion:1},created=await catalog.create(actor,'tenant-owner','project-ir',{title:'Synthetic IR page',starterVersion:'blank-v1'});
 db.sqlite.prepare("UPDATE catalog_projects SET status='ready'").run();db.sqlite.prepare("UPDATE catalog_workspaces SET status='ready'").run();
 const scope=await catalog.workspace(actor,created.project.workspace_id),calls:Array<{scope:TurnScope;actor:TurnActor;packageIdentity:string;operation:string;input:Record<string,unknown>}>=[];
 let during=()=>{},output:unknown={ready:true,marker};
 const env={APP_ORIGIN:origin,PROJECT_VIEW_BROWSER_POLICY_JSON:JSON.stringify({schema:'project-view-browser-policy/v1',enabled:true,startsAt:now-1000,endsAt:now+600000,dataEgress:'accepted',grants:[{scope,actor}]}),WORKSPACE_AGENT:{getByName:()=>({async projectViews(){return null;},async projectIrBrowser(input:typeof calls[number]){calls.push(input);await Promise.resolve().then(()=>during());return output;}})}};
 const services:GatewayServices={origin,database:db,identity:async request=>verified(request.headers.get('x-synthetic-user')??'owner'),projectViews:createGatewayProjectViewServices(env)};
 const request=(body:unknown={packageIdentity,operation:'records',input:{}},user='owner',extra:Record<string,string>={})=>gateway(new Request(origin+'/api/workspaces/'+scope.workspaceId+'/project-ir',{method:'POST',headers:{origin,'content-type':'application/json','x-synthetic-user':user,...extra},body:JSON.stringify(body)}),services);
 return {db,scope,actor,calls,env,services,request,setDuring:(fn:()=>void)=>{during=fn;},setOutput:(value:unknown)=>{output=value;},archive:()=>db.sqlite.prepare('UPDATE catalog_projects SET archived_at=?,archive_epoch=archive_epoch+1 WHERE id=?').run(Date.now(),scope.projectId)};
}
test('IR request uses current authenticated owner scope and the single purpose-bound RPC',async()=>{
 const f=await fixture();try{
  const response=await f.request();assert.equal(response.status,200);assert.deepEqual(await response.json(),{ready:true,marker});
  assert.deepEqual(f.calls,[{scope:f.scope,actor:f.actor,packageIdentity,operation:'records',input:{}}]);
  assert.equal((await f.request(undefined,'foreign')).status,404);assert.equal(f.calls.length,1);
  assert.equal((await f.request(undefined,'owner',{origin:'https://foreign.test'})).status,403);assert.equal(f.calls.length,1);
  for(const body of [{packageIdentity,operation:'project_ir_run',input:{}},{packageIdentity,operation:'show',input:{path:'../private'}},{packageIdentity,operation:'heartbeat',input:{clientId},scope:f.scope},{packageIdentity,operation:'submit',input:{runId:'forged',clientId,result:{}}}])assert.equal((await f.request(body)).status,400);
  assert.equal(f.calls.length,1);
 }finally{f.db.sqlite.close();}
});
test('IR request requires ordinary invitation, enabled browser policy and non-archived project before RPC',async()=>{
 const uninvited=await fixture(false);try{assert.equal((await uninvited.request()).status,403);assert.equal(uninvited.calls.length,0);}finally{uninvited.db.sqlite.close();}
 const f=await fixture();try{
  f.env.PROJECT_VIEW_BROWSER_POLICY_JSON='{}';assert.equal((await f.request()).status,403);assert.equal(f.calls.length,0);
  f.archive();assert.equal((await f.request()).status,409);assert.equal(f.calls.length,0);
 }finally{f.db.sqlite.close();}
});
for(const change of ['authVersion','membership','generation','policy','archive'])test(`IR awaited response is withheld after ${change} changes`,async()=>{
 const f=await fixture();try{
  f.setDuring(()=>{
   if(change==='authVersion')f.db.sqlite.prepare("UPDATE catalog_users SET auth_version=auth_version+1 WHERE id='owner'").run();
   if(change==='membership')f.db.sqlite.prepare("UPDATE catalog_memberships SET status='revoked' WHERE user_id='owner'").run();
   if(change==='generation'){f.db.sqlite.prepare('UPDATE catalog_workspaces SET generation=generation+1 WHERE id=?').run(f.scope.workspaceId);f.db.sqlite.prepare('UPDATE catalog_projects SET generation=generation+1 WHERE id=?').run(f.scope.projectId);}
   if(change==='policy')f.env.PROJECT_VIEW_BROWSER_POLICY_JSON='{}';
   if(change==='archive')f.archive();
  });
  const response=await f.request();assert.ok(response.status>=400);assert.doesNotMatch(await response.text(),new RegExp(marker));assert.equal(f.calls.length,1);
 }finally{f.db.sqlite.close();}
});
test('IR bounds input and output without giving an oversized submission to Workspace',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request({packageIdentity,operation:'submit',input:{clientId,runId:'run-'+clientId,result:{events:[],padding:'x'.repeat(257*1024)}}})).status,413);assert.equal(f.calls.length,0);
  f.setOutput({padding:'x'.repeat(513*1024)});const response=await f.request();assert.equal(response.status,413);assert.deepEqual(await response.json(),{error:'project-ir-response-too-large'});
 }finally{f.db.sqlite.close();}
});
test('IR browser input shape distinguishes completed failure records from arbitrary write capabilities',()=>{
 const request=(operation:string,input:Record<string,unknown>)=>projectIrBrowserRequest({packageIdentity,operation,input});
 assert.equal(request('submit',{clientId,runId:'run-'+clientId,error:'worker stopped'}).operation,'submit');
 for(const input of [{clientId,runId:'run-'+clientId,error:'worker stopped',result:{}},{clientId,tenantId:'foreign'}])assert.throws(()=>request('submit',input),/input-invalid/);
 assert.throws(()=>request('mode',{mode:'ir'}),/input-invalid/);assert.throws(()=>request('save-draft',{draft:'{}'}),/input-invalid/);
});

for(const change of ['policy','archive'])test(`IR closes ${change} revocation during the final awaited invitation query`,async()=>{
 const f=await fixture();try{
  const query=f.db.query.bind(f.db);let changed=false;
  f.db.query=async <T>(statement:Statement):Promise<T[]>=>{
   const rows=await query<T>(statement);
   if(!changed&&f.calls.length===1&&statement.sql.includes('FROM catalog_invitations i')&&statement.sql.includes("i.purpose='user'")){
    changed=true;assert.ok(rows.length>0);
    if(change==='policy')f.env.PROJECT_VIEW_BROWSER_POLICY_JSON='{}';else f.archive();
   }
   return rows;
  };
  const response=await f.request();assert.equal(response.status,change==='policy'?403:409);assert.doesNotMatch(await response.text(),new RegExp(marker));assert.equal(changed,true);assert.equal(f.calls.length,1);
 }finally{f.db.sqlite.close();}
});
