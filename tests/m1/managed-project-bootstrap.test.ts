import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesManagedProjectBootstrap,managedProjectBootstrap,MANAGED_BOOTSTRAP_TITLE} from '../../services/workspace/managed-bootstrap.ts';
import {turnDigest} from '../../services/turn/protocol.ts';
import {gateway} from '../../services/gateway/app.ts';
import {HttpError} from '../../services/gateway/http.ts';
import {SqliteCatalog} from './sqlite-database.ts';
const principal={userId:'owner',authVersion:1},tenant='tenant-owner',key='issue77-one-project';
const body={title:MANAGED_BOOTSTRAP_TITLE,starterVersion:'blank-v1'};
async function policy(){return {schemaVersion:1 as const,policyId:'issue77-production-v1' as const,userId:principal.userId,tenantId:tenant,idempotencyKey:key,bodySha256:await turnDigest(body),enabled:true};}

test('bootstrap matches only the pinned principal, tenant, key, exact blank project body and digest',async()=>{
 const p=await policy();assert.equal(await matchesManagedProjectBootstrap(JSON.stringify(p),principal,tenant,key,body),true);
 for(const [actor,t,k,b] of [[{...principal,userId:'other'},tenant,key,body],[principal,'tenant-other',key,body],[principal,tenant,'another-key',body],[principal,tenant,key,{...body,title:'Other'}],[principal,tenant,key,{...body,modelId:'model',modelVersion:'v1'}],[principal,tenant,key,{title:body.title,templateId:'blank-v1'}],[principal,tenant,key,{...body,starterVersion:'other'}],[principal,tenant,key,{...body,extra:true}]] as const)assert.equal(await matchesManagedProjectBootstrap(p,actor,t,k,b),false);
 assert.equal(await matchesManagedProjectBootstrap({...p,enabled:false},principal,tenant,key,body),false);
 assert.equal(await matchesManagedProjectBootstrap({...p,bodySha256:'a'.repeat(64)},principal,tenant,key,body),false);
 assert.equal(await matchesManagedProjectBootstrap(undefined,principal,tenant,key,body),false);
 // A key-order change also needs the exact operator-pinned request digest.
 assert.equal(await matchesManagedProjectBootstrap(p,principal,tenant,key,{starterVersion:'blank-v1',title:body.title}),false);
});
test('bootstrap policy rejects extensions and invalid versions or identifiers instead of broadening authorization',async()=>{
 const p=await policy();for(const bad of [{...p,extra:true},{...p,schemaVersion:2},{...p,policyId:'rollover'},{...p,userId:'*'},{...p,idempotencyKey:''},{...p,bodySha256:'bad'},{...p,enabled:'true'},[],{},'{'])assert.throws(()=>managedProjectBootstrap(bad));
});
async function fixture(){
 const database=new SqliteCatalog();database.sqlite.exec("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES('owner','better-auth','auth-owner','owner@example.test',1,1);INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES('tenant-owner','owner',1,1);INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES('tenant-owner','owner',1,1)");
 const origin='https://bootstrap.test';let pinned=await policy(),fallbackCalls=0;
 const services={origin,database,identity:async()=>({subject:'auth-owner',email:'owner@example.test',emailVerified:true,platformVersion:1}),admitProject:async(actor:typeof principal,t:string,k:string,b:unknown)=>{if(await matchesManagedProjectBootstrap(pinned,actor,t,k,b))return null;fallbackCalls++;throw new HttpError('g5_admission_disabled',409);}};
 return {database,disable(){pinned={...pinned,enabled:false};},fallbackCalls:()=>fallbackCalls,create:(k=key,b:unknown=body)=>gateway(new Request(origin+'/api/tenants/'+tenant+'/projects',{method:'POST',headers:{origin,'content-type':'application/json','idempotency-key':k},body:JSON.stringify(b)}),services)};
}
test('ordinary catalog idempotency commits one bootstrap Project and no G5 route under concurrent replay',async()=>{
 const f=await fixture();try{
  const responses=await Promise.all(Array.from({length:5},()=>f.create()));const values=await Promise.all(responses.map(r=>r.json() as Promise<{project:{id:string};replayed:boolean}>));
  assert.equal(new Set(values.map(v=>v.project.id)).size,1);assert.equal(values.filter(v=>!v.replayed).length,1);assert.equal(f.fallbackCalls(),0);
  for(const table of ['catalog_projects','catalog_workspaces','catalog_creation_intents','catalog_outbox','catalog_audit_log'])assert.equal(f.database.count(table),1,table);
  assert.equal(f.database.count('catalog_project_budget_routes'),0);
  const before=f.database.count('catalog_outbox');assert.equal((await f.create('another-key')).status,409);assert.equal((await f.create(key,{...body,title:'Another project'})).status,409);assert.equal(f.fallbackCalls(),2);assert.equal(f.database.count('catalog_projects'),1);assert.equal(f.database.count('catalog_outbox'),before);
  f.disable();assert.equal((await f.create()).status,409);assert.equal(f.fallbackCalls(),3);assert.equal(f.database.count('catalog_projects'),1);
 }finally{f.database.sqlite.close();}
});
test('bootstrap response loss replays the committed ordinary creation without a second Project or budget route',async()=>{
 const f=await fixture();try{
  f.database.loseCommitResponse=true;assert.equal((await f.create()).status,503);assert.equal(f.database.count('catalog_projects'),1);
  f.database.loseCommitResponse=false;const replay=await f.create();assert.equal(replay.status,200);assert.equal((await replay.json() as {replayed:boolean}).replayed,true);
  assert.equal(f.database.count('catalog_creation_intents'),1);assert.equal(f.database.count('catalog_outbox'),1);assert.equal(f.database.count('catalog_project_budget_routes'),0);
 }finally{f.database.sqlite.close();}
});
