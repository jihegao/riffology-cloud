import {R2ModelContentPort,modelContentKey} from '../../services/runtime/content.ts';
import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { gateway } from '../../services/gateway/app.ts';
import { SqliteCatalog } from './sqlite-database.ts';

const origin='http://gateway.test';
test('gateway exposes published models and operator lifecycle, then copies by model version',async()=>{
  const db=new SqliteCatalog();const now=Date.now();for(const user of ['owner','operator']){db.sqlite.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES (?, 'better-auth', ?, ?, ?, ?)").run(user,user,`${user}@example.test`,now,now);db.sqlite.prepare("INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES (?, ?, ?, ?)").run(`tenant-${user}`,user,now,now);db.sqlite.prepare("INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES (?, ?, ?, ?)").run(`tenant-${user}`,user,now,now);}db.sqlite.prepare("INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES ('operator','operator','active',?,?)").run(now,now);
  const as=(userId:string)=>async(req:Request)=>({subject:userId,email:`${userId}@example.test`,emailVerified:true,platformVersion:1});
  const content=Buffer.from('print(1)\n'),serialized=Buffer.from(JSON.stringify({schemaVersion:1,files:[{path:'model/main.py',bytes:content.length,sha256:createHash('sha256').update(content).digest('hex'),contentBase64:content.toString('base64')}]})),packageSha=createHash('sha256').update(serialized).digest('hex');
  let present=true,reads=0;
  const modelContent=new R2ModelContentPort({async get(key:string){reads++;assert.equal(key,'model-content/inventory/2.1.0.json');return present?{size:serialized.length,arrayBuffer:async()=>Uint8Array.from(serialized).buffer}:null;}} as unknown as R2Bucket);
  const call=(userId:string,path:string,init:RequestInit={})=>gateway(new Request(origin+path,init),{origin,database:db,identity:as(userId),modelContent,provision:async()=>{}});
  try {
    const body={modelId:'inventory',version:'2.1.0',title:'Inventory',description:'Starter',starterVersion:'blank-v1',contentRef:'inventory/2.1.0.json',contentSha256:packageSha};
    assert.equal((await call('owner','/api/models')).status,200);
    const mutationHeaders={'content-type':'application/json','origin':origin};
    const created=await call('operator','/api/admin/models',{method:'POST',headers:{...mutationHeaders,'idempotency-key':'create-model'},body:JSON.stringify(body)});assert.equal(created.status,201);const model=await created.json() as {id:string};assert.ok(model.id);
    assert.equal((await call('owner','/api/admin/models')).status,404);
    assert.equal((await call('operator','/api/admin/models')).status,200);
    present=false;
    assert.equal((await call('operator',`/api/admin/models/${model.id}/validate`,{method:'POST',headers:{...mutationHeaders,'idempotency-key':'validate-model'},body:'{}'})).status,409);
    assert.equal((await call('owner',`/api/admin/models/${model.id}/validate`,{method:'POST',headers:{...mutationHeaders,'idempotency-key':'owner-validate'},body:'{}'})).status,404);assert.equal(reads,1);
    present=true;
    for(const action of ['validate','publish'])assert.equal((await call('operator',`/api/admin/models/${model.id}/${action}`,{method:'POST',headers:{...mutationHeaders,'idempotency-key':`${action}-model`},body:'{}'})).status,200);
    const listed=await call('owner','/api/models');const publicModel=(await listed.json() as {models:Array<Record<string,unknown>>}).models[0]!;assert.equal(publicModel.model_id,'inventory');assert.equal(publicModel.version,'2.1.0');assert.equal(Object.hasOwn(publicModel,'content_ref'),false);assert.equal(Object.hasOwn(publicModel,'created_by'),false);assert.equal(Object.hasOwn(publicModel,'id'),false);
    assert.equal((await call('owner','/api/models/inventory/versions/2.1.0')).status,200);
    const copied=await call('owner','/api/tenants/tenant-owner/projects',{method:'POST',headers:{...mutationHeaders,'idempotency-key':'model-copy'},body:JSON.stringify({title:'Copied',modelId:'inventory',modelVersion:'2.1.0'})});assert.equal(copied.status,202);
    const project=await copied.json() as {project:Record<string,unknown>};assert.equal(project.project.source_model_id,'inventory');assert.equal(project.project.source_model_version,'2.1.0');assert.equal(project.project.source_digest,packageSha);assert.equal(Object.hasOwn(project.project,'source_content_ref'),false);assert.equal(Object.hasOwn(project.project,'source_content_sha256'),false);
    assert.equal((await call('owner',`/api/admin/models/${model.id}/withdraw`,{method:'POST',headers:{...mutationHeaders,'idempotency-key':'withdraw-model'},body:'{}'})).status,404);
    assert.equal((await call('operator',`/api/admin/models/${model.id}/withdraw`,{method:'POST',headers:{...mutationHeaders,'idempotency-key':'withdraw-model'},body:'{}'})).status,200);
    const audit=await call('operator','/api/admin/audit');assert.equal((await audit.json() as {events:Array<{target_type:string}>}).events.some(event=>event.target_type==='model'),true);
    const denied=await call('owner','/api/tenants/tenant-owner/projects',{method:'POST',headers:{...mutationHeaders,'idempotency-key':'model-copy-2'},body:JSON.stringify({title:'Denied',modelId:'inventory',modelVersion:'2.1.0'})});assert.equal(denied.status,404);
  } finally {db.sqlite.close();}
});
