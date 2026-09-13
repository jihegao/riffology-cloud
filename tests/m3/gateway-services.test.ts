import test from 'node:test';
import assert from 'node:assert/strict';
import {gateway} from '../../services/gateway/app.ts';
import {createGatewayServiceServices} from '../../services/gateway/service-services.ts';
import {ProjectCatalog} from '../../services/catalog/projects.ts';
import {SqliteCatalog} from '../m1/sqlite-database.ts';
import {spec} from './run-fixture.ts';
import type {ServiceIntentRecord} from '../../services/workspace/service-intents.ts';
import type {ServiceRunRecord} from '../../services/run/service.ts';
const origin='https://m1.example.test';
async function fixture(t:{after(fn:()=>void):void}){
 const db=new SqliteCatalog(),now=Date.now();t.after(()=>db.sqlite.close());
 db.sqlite.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES ('user-a','better-auth','subject-a','alice@example.test',?,?)").run(now,now);
 db.sqlite.prepare("INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES ('tenant-a','user-a',?,?)").run(now,now);
 db.sqlite.prepare("INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES ('tenant-a','user-a',?,?)").run(now,now);
 const actor={userId:'user-a',authVersion:1},created=await new ProjectCatalog(db,new Set(['blank-v1'])).create(actor,'tenant-a','project-key',{title:'Project',starterVersion:'blank-v1'}),workspaceId=created.project.workspace_id,scope={tenantId:'tenant-a',projectId:created.project.id,workspaceId,workspaceGeneration:1};
 const plan=spec().plan;plan.source.identity.scope=scope;
 const intent:ServiceIntentRecord={runId:'run-a',scope,actor,requestKey:'private-key',request:{runtimeImage:spec().runtimeImage,maxDurationMs:5000},source:plan.source,task:{runId:'run-a',scope,actor,requestKey:'private-key',spec:{...spec(),plan}},status:'delivered',createdAt:1000,updatedAt:2000,deliveryDeadlineAt:6000,nextAttemptAt:null,deliveryClaimedAt:1000,stopRequestedAt:null,stopForwardedAt:null,errorCode:null};
 let run:ServiceRunRecord|null=null,error:string|null=null,disposed=0;const calls:{method:string;input:any}[]=[],names:string[]=[];
 function output<T extends object>(value:T):T{const copy=structuredClone(value);Object.defineProperty(copy,Symbol.dispose,{value(){disposed++;}});return copy;}
 function record(method:string,input:unknown){calls.push({method,input});if(error)throw Error(error);}
 const workspace={async submitServiceRequest(input:any){record('submit',input);return output(intent);},async stopService(input:any){record('stop',input);return output({...intent,stopRequestedAt:2500});},async serviceView(input:any){record('view',input);return output({intent,run});},async listServices(input:any){record('list',input);return output({items:[intent],nextCursor:{createdAt:1000,runId:'run-a'}});}};
 const env={M3_SERVICE_ENABLED:'true',WORKSPACE_AGENT:{getByName(name:string){names.push(name);return workspace;}}};
 const services={origin,database:db,identity:async()=>({subject:'subject-a',email:'alice@example.test',emailVerified:true,platformVersion:1}),serviceRuns:createGatewayServiceServices(env)};
 const base=`/api/workspaces/${workspaceId}/services`;
 const get=(path=base,headers?:HeadersInit)=>gateway(new Request(origin+path,{headers}),services);
 const post=(path=base,body:unknown={maxDurationMs:5000},key:string|null='key-a',requestOrigin=origin)=>{const headers=new Headers({origin:requestOrigin,'content-type':'application/json'});if(key!==null)headers.set('idempotency-key',key);return gateway(new Request(origin+path,{method:'POST',headers,body:JSON.stringify(body)}),services);};
 return {db,env,intent,scope,actor,base,calls,names,get,post,get disposed(){return disposed;},setError(value:string|null){error=value;},running(){run={id:intent.runId,kind:'service',scope,actor,spec:intent.task!.spec,status:'running',createdAt:1000,updatedAt:3000,startedAt:2500,stopRequestedAt:null,runtime:{runId:'run-a',runtimeId:'private-runtime',dispatchId:'private-dispatch',leaseId:'private-lease',generation:1,deadlineAt:7000},errorCode:null};},ready(value=true){const status=value?'ready':'failed';db.sqlite.prepare('UPDATE catalog_projects SET status=? WHERE workspace_id=?').run(status,workspaceId);db.sqlite.prepare('UPDATE catalog_workspaces SET status=? WHERE id=?').run(status,workspaceId);}};
}
const publicKeys=['version','runId','kind','deliveryStatus','runStatus','createdAt','updatedAt','stopRequestedAt','errorCode'].sort();
test('real gateway and production service client publish only public fields and separate delivery from execution',async t=>{
 const f=await fixture(t);f.ready();const created=await f.post();assert.equal(created.status,202);const publicIntent=await created.json() as any;assert.deepEqual(Object.keys(publicIntent).sort(),publicKeys);assert.equal(publicIntent.deliveryStatus,'delivered');assert.equal(publicIntent.runStatus,null);assert.deepEqual(f.calls[0],{method:'submit',input:{scope:f.scope,actor:f.actor,key:'key-a',body:{maxDurationMs:5000}}});assert.deepEqual(f.names,['workspace:tenant-a:'+f.scope.workspaceId]);assert.equal(f.disposed,1);
 const pending=await (await f.get(f.base+'/run-a')).json() as any;assert.equal(pending.deliveryStatus,'delivered');assert.equal(pending.runStatus,null);f.running();const running=await (await f.get(f.base+'/run-a')).json() as any;assert.equal(running.runStatus,'running');assert.equal(running.updatedAt,3000);assert.deepEqual(Object.keys(running).sort(),publicKeys);
 const page=await (await f.get(f.base+'?limit=2&before_created_at=1001&before_run_id=run-b')).json() as any;assert.deepEqual(f.calls.at(-1),{method:'list',input:{scope:f.scope,limit:2,before:{createdAt:1001,runId:'run-b'}}});assert.deepEqual(Object.keys(page.items[0]).sort(),publicKeys);assert.deepEqual(page.nextCursor,{createdAt:1000,runId:'run-a'});
 const stopped=await f.post(f.base+'/run-a/stop',{},null);assert.equal(stopped.status,202);assert.equal((await stopped.json() as any).stopRequestedAt,2500);assert.equal(f.disposed,5);assert.deepEqual(f.calls.at(-1),{method:'stop',input:{scope:f.scope,runId:'run-a'}});
});
test('nonready and disabled service creation preserve authorized maintenance reads and stop',async t=>{
 const f=await fixture(t);assert.equal((await f.post()).status,409);assert.equal(f.calls.length,0);
 assert.equal((await f.get()).status,200);assert.equal((await f.get(f.base+'/run-a')).status,200);assert.equal((await f.post(f.base+'/run-a/stop',{},null)).status,202);
 f.ready();f.env.M3_SERVICE_ENABLED='false';const before=f.calls.length;assert.equal((await f.post()).status,503);assert.equal(f.calls.length,before);assert.equal((await f.get()).status,200);assert.equal((await f.get(f.base+'/run-a')).status,200);assert.equal((await f.post(f.base+'/run-a/stop',{},null)).status,202);
 f.ready(false);assert.equal((await f.get()).status,200);assert.equal((await f.post(f.base+'/run-a/stop',{},null)).status,202);
});
test('gateway rejects authority, origin and malformed request inputs before private RPC',async t=>{
 const f=await fixture(t);f.ready();for(const body of [{maxDurationMs:5000,runtimeImage:'attacker'},{maxDurationMs:0},{maxDurationMs:900001},{maxDurationMs:1.5},{maxDurationMs:'5000'},{},[]])assert.equal((await f.post(f.base,body)).status,400);
 for(const key of [null,''])assert.equal((await f.post(f.base,{maxDurationMs:5000},key)).status,400);
 assert.equal((await f.post(f.base+'?extra=1')).status,400);assert.equal((await f.post(f.base+'/run-a/stop',{extra:1})).status,400);
 for(const query of ['?limit=0','?limit=51','?limit=2&limit=3','?extra=1','?before_created_at=1000','?before_run_id=run-a','?before_created_at=1000&before_created_at=1001&before_run_id=run-a','?before_created_at=1000&before_run_id=run-a&before_run_id=run-b','?before_created_at=-1&before_run_id=run-a'])assert.equal((await f.get(f.base+query)).status,400,query);
 assert.equal((await f.get(f.base+'/run-a?extra=1')).status,400);assert.equal((await f.post(f.base+'/run-a/stop?extra=1',{})).status,400);
 assert.equal((await f.post(f.base,{maxDurationMs:5000},'key','https://attacker.test')).status,403);assert.equal((await f.get('/api/workspaces/other-workspace/services')).status,404);
 f.db.seed('user-b');const foreign=await new ProjectCatalog(f.db,new Set(['blank-v1'])).create({userId:'user-b',authVersion:1},'tenant-user-b','foreign-key',{title:'Foreign',starterVersion:'blank-v1'});const foreignBase='/api/workspaces/'+foreign.project.workspace_id+'/services';assert.equal((await f.get(foreignBase)).status,404);assert.equal((await f.get(foreignBase+'/run-a')).status,404);assert.equal((await f.post(foreignBase+'/run-a/stop',{})).status,404);assert.equal((await f.post(foreignBase)).status,404);
 assert.equal(f.calls.length,0);assert.equal(f.names.length,0);
 f.db.sqlite.prepare("UPDATE catalog_memberships SET status='revoked' WHERE tenant_id='tenant-a'").run();assert.equal((await f.get()).status,404);assert.equal((await f.post(f.base+'/run-a/stop',{})).status,404);assert.equal(f.calls.length,0);
});
test('gateway maps private failures without leaking internals and disposes sanitized RPC output',async t=>{
 const f=await fixture(t);f.ready();for(const [error,status] of [['service-intent-conflict',409],['service-intent-not-found',404],['workspace-actor-scope-denied',404],['private-stack-secret',503]] as const){f.setError(error);const response=await f.post();assert.equal(response.status,status);assert.equal((await response.text()).includes(error),false);}
 f.setError(null);f.intent.errorCode='private-runtime-secret';const response=await f.get(f.base+'/run-a'),view=await response.json() as any;assert.equal(view.errorCode,'service-unavailable');assert.equal(JSON.stringify(view).includes('private-runtime-secret'),false);assert.equal(f.disposed,1);
 f.db.sqlite.prepare("UPDATE catalog_users SET auth_version=2 WHERE id='user-a'").run();const count=f.calls.length;assert.equal((await f.get()).status,404);assert.equal((await f.post()).status,404);assert.equal(f.calls.length,count);
});
