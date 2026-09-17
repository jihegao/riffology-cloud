import test from 'node:test';import assert from 'node:assert/strict';
import {g4DurableComputeCounts,readG4NativeSample} from '../../services/model-budget/g4-compute-counts.ts';
import {createGatewayG4WindowServices} from '../../services/gateway/g4-compute-services.ts';
import {gateway} from '../../services/gateway/app.ts';import {SqliteCatalog} from '../m1/sqlite-database.ts';
const scope={tenantId:'tenant',projectId:'p',workspaceId:'w',workspaceGeneration:1};
test('durable counts retain unknown cost and never equate admission with successful native execution',()=>{
 const window:any={calls:[{state:'unknown',accounted:8,dispatch_at:100},{state:'reserved',accounted:9,dispatch_at:null}]};
 const result=g4DurableComputeCounts(scope,window,[],[],[]);assert.equal(result.provider.dispatched,1);assert.equal(result.provider.unsettled,2);assert.equal(result.provider.accountedNanodollars,17);assert.equal(result.provider.successfulExecutions,null);
 assert.throws(()=>g4DurableComputeCounts(scope,window,[{scope:{...scope,tenantId:'foreign'}}] as any,[],[]),/scope-denied/);
 assert.throws(()=>g4DurableComputeCounts(scope,{calls:[{accounted:Number.MAX_SAFE_INTEGER,dispatch_at:null},{accounted:1,dispatch_at:null}]} as any,[],[],[]),/overflow/);
});
test('private native sample preserves absent/owner denied as null; malformed samples cannot claim zero',async()=>{
 assert.equal((await readG4NativeSample(undefined,scope)).attempts,null);
 assert.equal((await readG4NativeSample({nativeAttemptSnapshot:async()=>{throw Error('sandbox-counter-owner-denied');}},scope)).supported,false);
 assert.equal((await readG4NativeSample({nativeAttemptSnapshot:async()=>({supported:true,noAddedCalls:true,attempts:{}})},scope)).supported,false);
 const sample={schema:'riffology.g4-native-attempts/v1',actorId:'actual-actor',supported:true,noAddedCalls:true,semantics:'attempt-before-call',attempts:{init:1,startProcess:2,execControl:0,execFilework:3,taskStart:1}};
 assert.deepEqual(await readG4NativeSample({nativeAttemptSnapshot:async(identity)=>{assert.equal(identity,scope);return sample;}},scope),sample);
 assert.deepEqual(await readG4NativeSample({nativeAttemptSnapshot:async()=>({supported:false,noAddedCalls:true,admitted:null,dispatched:null})},scope,true),{supported:false,noAddedCalls:true,admitted:null,dispatched:null});
});
test('tenant snapshot selects server actor, checks fixed policy user and does not admit a task',async()=>{
 let reads=0;const snapshot=createGatewayG4WindowServices({TENANT_MODEL_BUDGET:{getByName(name){assert.equal(name,'tenant-model-budget:tenant');return {g4WindowSnapshot:async(tenant)=>{reads++;assert.equal(tenant,'tenant');return {policy:{tenantId:'tenant',userId:'u'},startedAt:null,deadlineAt:null};}};}}});
 const result=await snapshot('tenant',{userId:'u',authVersion:1});assert.equal(result.deadlineAt,null);assert.equal(result.readOnly,true);assert.equal(reads,1);await assert.rejects(snapshot('tenant',{userId:'foreign',authVersion:1}),/scope-denied/);
});
test('tenant read API authenticates owner before/after await and rejects query/write without task admission',async t=>{
 const db=new SqliteCatalog();t.after(()=>db.sqlite.close());const n=Date.now();db.sqlite.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at,auth_version,status) VALUES ('u','better-auth','sub','u@example.test',?,?,1,'active')").run(n,n);db.sqlite.prepare("INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES ('tenant','u',?,?)").run(n,n);db.sqlite.prepare("INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES ('tenant','u',?,?)").run(n,n);
 let reads=0,revoke=false;const origin='https://app.example.test';const services:any={origin,database:db,identity:async()=>({subject:'sub',email:'u@example.test',emailVerified:true,platformVersion:1}),g4WindowSnapshot:async()=>{reads++;if(revoke)db.sqlite.prepare("UPDATE catalog_memberships SET status='revoked'").run();return {startedAt:null,deadlineAt:null};}};
 const req=(tail='',method='GET')=>gateway(new Request(origin+'/api/tenants/tenant/g4-window'+tail,{method,headers:{origin}}),services);
 assert.equal((await req()).status,200);assert.equal(reads,1);assert.equal((await req('?actor=foreign')).status,400);assert.equal((await req('','POST')).status,400);assert.equal(reads,1);revoke=true;assert.equal((await req()).status,404);assert.equal(reads,2);assert.equal((await req()).status,404);assert.equal(reads,2);
});
