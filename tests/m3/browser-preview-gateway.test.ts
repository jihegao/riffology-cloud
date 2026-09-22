import test from 'node:test';
import assert from 'node:assert/strict';
import {gateway} from '../../services/gateway/app.ts';
import {ProjectCatalog} from '../../services/catalog/projects.ts';
import {SqliteCatalog} from '../m1/sqlite-database.ts';
const origin='https://app.example.test';
test('browser routes enforce Catalog scope, strict Verify input and ready admission; GET never submits',async t=>{
 const db=new SqliteCatalog();t.after(()=>db.sqlite.close());const n=Date.now();
 db.sqlite.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at,auth_version,status) VALUES ('u','better-auth','sub','u@example.test',?,?,1,'active')").run(n,n);
 db.sqlite.prepare("INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES ('tenant','u',?,?)").run(n,n);db.sqlite.prepare("INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES ('tenant','u',?,?)").run(n,n);
 const actor={userId:'u',authVersion:1},project=await new ProjectCatalog(db,new Set(['blank-v1'])).create(actor,'tenant','p',{title:'P',starterVersion:'blank-v1'}),w=project.project.workspace_id;db.sqlite.prepare("UPDATE catalog_projects SET status='ready'").run();db.sqlite.prepare("UPDATE catalog_workspaces SET status='ready'").run();let posts=0;
 const services:any={origin,database:db,identity:async()=>({subject:'sub',email:'u@example.test',emailVerified:true,platformVersion:1}),browserPreviews:{view:async(scope:any,caller:any,revision:string)=>{assert.equal(scope.workspaceId,w);assert.deepEqual(caller,actor);return {revisionId:revision,build:null};},bytes:async()=>new TextEncoder().encode('{"canonical":true}'),verification:async()=>({status:'absent'}),retryVerification:async()=>({status:'absent'}),verify:async()=>{posts++;return {verificationId:'verify-a'};},retry:async()=>{posts++;return {retryId:'retry-a'};}}};
 const req=(path:string,init:RequestInit={})=>gateway(new Request(origin+path,{...init,headers:{origin,'content-type':'application/json'}}),services),base='/api/workspaces/'+w+'/browser-preview',body={revisionId:'revision-a',packageIdentity:'a'.repeat(64),parameters:{},seed:1,intent:'experiment',idempotencyKey:'verify-a'};
 assert.equal((await req(base+'?revisionId=old&profileId=mesa-3.5.1%2Fv1')).status,200);assert.equal((await req(base+'/verify/verify-a')).status,200);assert.equal((await req(base+'/retry/retry-a')).status,200);const bytes=await req(base+'/packages/'+'a'.repeat(64));assert.equal(await bytes.text(),'{"canonical":true}');assert.equal(bytes.headers.get('cache-control'),'no-store');assert.equal(posts,0);
 for(const query of ['?revisionId=x&revisionId=y','?profileId=unknown','?profileId=','?sourceKey=secret'])assert.equal((await req(base+query)).status,400);
 for(const bad of [{...body,metrics:{fake:999}},{...body,seed:-1},{...body,objectKey:'private'},{}])assert.equal((await req(base+'/verify',{method:'POST',body:JSON.stringify(bad)})).status,400);assert.equal(posts,0);
 const verifyResponse=await req(base+'/verify',{method:'POST',body:JSON.stringify(body)});assert.equal(verifyResponse.status,202);assert.deepEqual(Object.keys(await verifyResponse.json()).sort(),['verificationId']);assert.equal(posts,1);assert.equal((await req('/api/workspaces/foreign/browser-preview')).status,404);
 db.sqlite.prepare("UPDATE catalog_projects SET status='failed'").run();db.sqlite.prepare("UPDATE catalog_workspaces SET status='failed'").run();assert.equal((await req(base+'/verify',{method:'POST',body:JSON.stringify(body)})).status,409);assert.equal((await req(base+'/verify/verify-a')).status,200);assert.equal(posts,1);
});
