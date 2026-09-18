import test from 'node:test';
import assert from 'node:assert/strict';
import {gateway} from '../../services/gateway/app.ts';
import {ProjectCatalog} from '../../services/catalog/projects.ts';
import {SqliteCatalog} from '../m1/sqlite-database.ts';

test('Managed status and cleanup require catalog ownership, CSRF, strict shape and actor authorization',async()=>{
 const database=new SqliteCatalog(),origin='https://m1.example.test';try{
  database.sqlite.exec("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES ('user-a','better-auth','subject-a','a@example.test',1,1); INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES ('tenant-a','user-a',1,1); INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES ('tenant-a','user-a',1,1)");
  const principal={userId:'user-a',authVersion:1},created=await new ProjectCatalog(database,new Set(['blank-v1'])).create(principal,'tenant-a','one',{title:'Managed',starterVersion:'blank-v1'}),base=`/api/workspaces/${created.project.workspace_id}/managed-acceptance`,calls:any[]=[];
  database.sqlite.prepare("UPDATE catalog_projects SET status='ready' WHERE id=?").run(created.project.id);database.sqlite.prepare("UPDATE catalog_workspaces SET status='ready' WHERE id=?").run(created.project.workspace_id);
  let denied=false;const method=async(scope:any,actor:any)=>{if(denied)throw Error('managed-policy-owner-denied');calls.push({scope,actor});return {billingSettled:false,liveSessions:0};};
  const services:any={origin,database,identity:async()=>({subject:'subject-a',email:'a@example.test',emailVerified:true,platformVersion:1}),turns:{managedAcceptanceStatus:method,cleanupManagedAcceptance:method}};
  const req=(path=base,body?:unknown,requestOrigin=origin)=>gateway(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{origin:requestOrigin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),services);
  assert.equal((await req()).status,200);assert.equal(calls[0].scope.projectId,created.project.id);assert.deepEqual(calls[0].actor,principal);
  assert.equal((await req(base+'/cleanup',{})).status,200);assert.equal(calls.length,2);
  assert.equal((await req(base+'/cleanup',{sessionId:'untrusted'})).status,400);assert.equal((await req(base+'/cleanup',{},'https://attacker.test')).status,403);assert.equal((await req(base+'?policyId=other')).status,400);assert.equal((await req('/api/workspaces/unknown/managed-acceptance')).status,404);assert.equal(calls.length,2);
  denied=true;assert.equal((await req()).status,403);assert.equal((await req(base+'/cleanup',{})).status,403);
  database.sqlite.prepare("UPDATE catalog_memberships SET status='revoked' WHERE tenant_id='tenant-a' AND user_id='user-a'").run();assert.equal((await req()).status,404);assert.equal((await req(base+'/cleanup',{})).status,404);
 }finally{database.sqlite.close();}
});
