import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {directClearAppend} from '../../scripts/model/direct-project-clear.mjs';

test('temporary exact-actor RPC clears real SQLite/KV/alarm and retains original isolation without exposing content',{timeout:60000},async()=>{
  const capability='a'.repeat(64),configuration={capabilitySha256:createHash('sha256').update(capability).digest('hex'),expiresAt:Date.now()+60000,actors:{WorkspaceAgent:['target']},clearActors:{WorkspaceAgent:['target']}};
  const script=`import {DurableObject} from 'cloudflare:workers';
  export class WorkspaceAgent extends DurableObject{
    async alarm(){throw Error('unexpected-alarm');}
    async seed(){this.ctx.storage.kv.put('m2:turn-journal',{scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},message:'secret message',turns:{turn:{scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},sessionId:'session',turnId:'turn',dispatchId:'dispatch',generation:1}}});this.ctx.storage.sql.exec('CREATE TABLE contents(id INTEGER PRIMARY KEY, body TEXT)');this.ctx.storage.sql.exec("INSERT INTO contents VALUES(1,'secret source')");this.ctx.storage.sql.exec("CREATE TABLE product_turn_execution_isolations(identity_digest TEXT PRIMARY KEY,identity_json TEXT NOT NULL,fenced_at INTEGER NOT NULL,classification TEXT NOT NULL)");this.ctx.storage.sql.exec('INSERT INTO product_turn_execution_isolations VALUES(?,?,?,?)','digest',JSON.stringify({scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},sessionId:'session',turnId:'turn',dispatchId:'dispatch',generation:1}),1,'runtime-absent-and-fenced');await this.ctx.storage.setAlarm(Date.now()+3600000);await this.ctx.storage.sync();return true;}
    async remaining(){return {kv:[...this.ctx.storage.kv.list()].length,tables:this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('contents','product_turn_execution_isolations') ORDER BY name").toArray(),isolation:this.ctx.storage.sql.exec('SELECT count(*) AS n FROM product_turn_execution_isolations').one().n,alarm:await this.ctx.storage.getAlarm()};}
  }
  export default{async fetch(request,env){const input=await request.json(),stub=env.WORKSPACE_AGENT.getByName(input.name??'target');try{return Response.json(input.action==='seed'?await stub.seed():input.action==='remaining'?await stub.remaining():await stub.issue212DirectClear(input.input));}catch(error){return Response.json({error:error.message}, {status:409});}}};`+directClearAppend(configuration);
  const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,telemetry:{enabled:false},workers:[{config:{type:'worker',name:'direct-clear',compatibilityDate:'2026-09-05',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:script}}},env:{WORKSPACE_AGENT:{type:'durable-object',worker:'direct-clear',exportName:'WorkspaceAgent'}},exports:{WorkspaceAgent:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false}}]});
  const call=body=>mf.dispatchFetch('http://worker.test/',{method:'POST',body:JSON.stringify(body)});
  try{
    const seed=await call({action:'seed'});assert.equal(seed.status,200,await seed.clone().text());
    const invoke=(action,extra={})=>call({input:{action,actorName:'target',capability,...extra}});
    const inspection=await invoke('inspect');assert.equal(inspection.status,200,await inspection.clone().text());const body=await inspection.json();
    assert.equal(body.turnIdentities.length,1);assert.equal(body.kvCount,1);assert.doesNotMatch(JSON.stringify(body),/secret message|secret source/);
    assert.equal((await invoke('clear',{capability:'b'.repeat(64)})).status,409);
    assert.equal((await call({name:'outside',input:{action:'clear',actorName:'target',capability}})).status,409);
    const cleared=await invoke('clear');assert.equal(cleared.status,200,await cleared.clone().text());assert.equal((await cleared.json()).retainedIsolationRows,1);
    const after=await (await call({action:'remaining'})).json();assert.deepEqual(after,{kv:0,tables:[{name:'product_turn_execution_isolations'}],isolation:1,alarm:null});
  }finally{await mf.dispose();}
});

test('local Managed content clears while original remote references, pending costs and policy summaries survive without provider calls',{timeout:60000},async()=>{
  const capability='c'.repeat(64),configuration={capabilitySha256:createHash('sha256').update(capability).digest('hex'),expiresAt:Date.now()+60000,actors:{ManagedProductRuntime:['target']},clearActors:{ManagedProductRuntime:['target']}};
  const script=`import {DurableObject} from 'cloudflare:workers';
  export class ManagedProductRuntime extends DurableObject{
    async seed(){const identity={scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},sessionId:'session',turnId:'turn',dispatchId:'dispatch',generation:1},binding={schemaVersion:1,backend:'managed-agents',identity,inputSha256:'a'.repeat(64),remoteSessionId:'sess_original',remoteTurnId:'turn_original',reservedAt:1};this.ctx.storage.sql.exec('CREATE TABLE execution_bindings(identity TEXT PRIMARY KEY,session_key TEXT NOT NULL,value TEXT NOT NULL) STRICT');this.ctx.storage.sql.exec('INSERT INTO execution_bindings VALUES(?,?,?)',JSON.stringify(identity),'original',JSON.stringify(binding));this.ctx.storage.kv.put('budget',{policy:{policyId:'original-policy'},startedAt:1,stopped:null,simulations:[]});this.ctx.storage.kv.put('turn:turn',{input:identity,managedInput:{message:'private user message'},operation:'create',reserved:true,cost:null,observation:{execution:'completed',usage:{status:'unknown'}},closed:false});return true;}
    async remaining(){return {kv:[...this.ctx.storage.kv.list()].length,binding:JSON.parse(this.ctx.storage.sql.exec('SELECT value FROM execution_bindings').one().value),cost:JSON.parse(this.ctx.storage.sql.exec('SELECT summary_json FROM issue212_retained_execution_summaries').one().summary_json),budget:JSON.parse(this.ctx.storage.sql.exec('SELECT summary_json FROM issue212_retained_budget').one().summary_json)};}
  }
  export default{async fetch(request,env){const input=await request.json(),stub=env.MANAGED_TURN_RUNTIME.getByName('target');try{return Response.json(input.action==='seed'?await stub.seed():input.action==='remaining'?await stub.remaining():await stub.issue212DirectClear(input));}catch(error){return Response.json({error:error.message},{status:409});}}};`+directClearAppend(configuration);
  const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,telemetry:{enabled:false},workers:[{config:{type:'worker',name:'managed-clear',compatibilityDate:'2026-09-05',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:script}}},env:{MANAGED_TURN_RUNTIME:{type:'durable-object',worker:'managed-clear',exportName:'ManagedProductRuntime'}},exports:{ManagedProductRuntime:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{throw Error('provider-call-forbidden');}}}}]});
  const call=body=>mf.dispatchFetch('http://worker.test/',{method:'POST',body:JSON.stringify(body)});
  try{
    assert.equal((await call({action:'seed'})).status,200);
    const cleared=await call({action:'clear',actorName:'target',capability});assert.equal(cleared.status,200,await cleared.clone().text());const receipt=await cleared.json();assert.equal(receipt.retainedRemoteBindings,1);assert.equal(receipt.remoteDeletionPending,1);
    const remaining=await (await call({action:'remaining'})).json();assert.equal(remaining.kv,0);assert.equal(remaining.binding.remoteSessionId,'sess_original');assert.equal(remaining.cost.cost,null);assert.equal(remaining.cost.reserved,true);assert.equal(remaining.cost.operation,'create');assert.equal(remaining.budget.policy.policyId,'original-policy');assert.doesNotMatch(JSON.stringify(remaining),/private user message|managedInput/);
    const repeated=await call({action:'clear',actorName:'target',capability});assert.equal(repeated.status,200,await repeated.clone().text());assert.deepEqual(await (await call({action:'remaining'})).json(),remaining);
  }finally{await mf.dispose();}
});
