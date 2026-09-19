import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {profile} from './production-profile-fixture.ts';
import {betaPolicy} from './private-beta-fixture.ts';
import {modelCallReference} from '../../services/model-budget/core.ts';

test('standing Beta real SQLite/D1: invite scopes, cross-project contention, restart, pending usage, quarantine and pinned budgets',{timeout:90000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'private-beta-')),policy={...await betaPolicy(),maxCallsPerUserDay:1,maxCallsPerDay:2};
 const bundled=await build({stdin:{contents:`
 import {DurableObject,env as workerEnv} from 'cloudflare:workers';
 const originalNow=Date.now;Date.now=()=>originalNow()+Number(workerEnv.TEST_CLOCK_OFFSET??0);
 import {PrivateBetaCapacity as BaseCapacity} from './services/model-budget/private-beta-capacity.ts';
 export class PrivateBetaCapacity extends BaseCapacity {async observeCall(record){if(this.env.DROP_FINISH_ACK==='true'&&record.status==='completed')throw Error('fixture-lost-finish-ack');return super.observeCall(record);}}
 export {PiDeveloperBudget} from './services/model-budget/pi-developer-durable.ts';
 export {TenantModelBudget} from './services/model-budget/durable.ts';
 export {G5TenantModelBudget} from './services/model-budget/g5-token-durable.ts';
 export class Workspace extends DurableObject {
  async privateBetaReleaseState(input){return this.ctx.storage.kv.get('state')??{found:false,turnId:null,terminal:false,released:false,resourceWait:false,finishedAt:null};}
  async setState(value){this.ctx.storage.kv.put('state',value);}
  async cancelTurn(){this.ctx.storage.kv.put('cancelled',true);}
 }
 export default {async fetch(r,env){const {kind,name,method,args}=await r.json();try{const stub=kind==='legacy'?env.TENANT_MODEL_BUDGET.getByName('tenant-model-budget:'+name):kind==='capacity'?env.PRIVATE_BETA_CAPACITY.getByName('private-beta-capacity-v1'):kind==='workspace'?env.WORKSPACE_AGENT.getByName(name):env.PI_DEVELOPER_BUDGET.getByName('tenant-model-budget:'+name);return Response.json({value:await stub[method](...args)});}catch(e){return Response.json({error:e.message});}}};`,resolveDir:process.cwd(),sourcefile:'beta-test.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const classes={PRIVATE_BETA_CAPACITY:'PrivateBetaCapacity',PI_DEVELOPER_BUDGET:'PiDeveloperBudget',TENANT_MODEL_BUDGET:'TenantModelBudget',G5_TOKEN_BUDGET:'G5TenantModelBudget',WORKSPACE_AGENT:'Workspace'};
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},workers:[{config:{type:'worker',name:'beta-test',compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{...Object.fromEntries(Object.entries({MODEL_BUDGET_POLICY_VERSION:'legacy-test',MODEL_BUDGET_MAX_RESERVATION_ATTEMPTS_PER_TURN:'8',MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN:'8',MODEL_BUDGET_MAX_INPUT_TOKENS_PER_CALL:'262144',MODEL_BUDGET_MAX_OUTPUT_TOKENS_PER_CALL:'4096',MODEL_BUDGET_MAX_RESERVED_TOKENS_PER_TURN:'2129920',G5_TOKEN_BUDGET_POLICY_JSON:JSON.stringify({version:'g5-openai-luna-20260916-v1',maxReservationAttemptsPerTurn:8,maxDispatchedCallsPerTurn:8,maxInputTokensPerCall:262144,maxOutputTokensPerCall:4096,maxReservedTokensPerTurn:2129920})}).map(([k,value])=>[k,{type:'text',value}])),DROP_FINISH_ACK:{type:'text',value:'false'},TEST_CLOCK_OFFSET:{type:'text',value:'0'},CATALOG:{type:'d1',id:'catalog',name:'catalog'},PRIVATE_BETA_POLICY_JSON:{type:'text',value:JSON.stringify(policy)},PRODUCTION_MODEL_PROFILE_JSON:{type:'text',value:JSON.stringify(profile)},M2_MODEL_BUDGET_POLICY_VERSION:{type:'text',value:'beta-token-v1'},...Object.fromEntries(Object.entries(classes).map(([name,exportName])=>[name,{type:'durable-object',worker:'beta-test',exportName}]))},exports:Object.fromEntries([...new Set(Object.values(classes))].map(exportName=>[exportName,{type:'durable-object',storage:'sqlite'}]))},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('disabled',{status:403})}}}]};
 let mf;
 const rpc=async(kind,name,method,...args)=>{const result=await(await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({kind,name,method,args})})).json();if(result.error)throw Error(result.error);return result.value;};
 const cap=(method,...args)=>rpc('capacity','',method,...args);
 const scope=(user,project=1)=>({tenantId:'tenant-'+user,projectId:'project-'+user+'-'+project,workspaceId:'workspace-'+user+'-'+project,workspaceGeneration:1});
 const actor=user=>({userId:user,authVersion:1});
 const admission=(user,project=1,key='human-1')=>({scope:scope(user,project),actor:actor(user),sessionId:'session',requestKey:key});
 const request=(user,project=1,n=1)=>({schemaVersion:1,identity:{scope:scope(user,project),sessionId:'session',turnId:'turn-'+user+'-'+project,dispatchId:'dispatch-'+user+'-'+project,generation:1},actor:actor(user),callId:'call-'+n,requestId:'request-'+user+'-'+project+'-'+n,deadlineAt:Date.now()+60000,provider:'openai',model:profile.model,payloadSha256:'a'.repeat(64),inputTokenUpperBound:100,maxOutputTokens:20,inputBoundVersion:'utf8-provider-payload-plus-4096-v1',budgetPolicyVersion:'beta-token-v1'});
 const budget=(user,method,...args)=>rpc('budget','tenant-'+user,method,...args);
 const accept=async(user,project=1)=>{const a=admission(user,project);await budget(user,'admitTurn',a.scope,user,a.sessionId,a.requestKey,a.actor);await cap('bindTurn',a,request(user,project).identity.turnId);};
 try{
  mf=new Miniflare(options);await mf.ready;let db=await mf.getD1Database('CATALOG','beta-test');
  for(const filename of ['0001_catalog.sql','0004_operator_invitations.sql','0005_initial_operator.sql']){
   const sql=(await readFile('services/catalog/migrations/'+filename,'utf8')).replace(/--[^\n]*/g,'');for(const statement of sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(statement.trim())await db.prepare(statement).run();
  }
  for(const [idx,user] of ['alice','bob','carol','outsider'].entries()){
   await db.batch([
    db.prepare('INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES(?,?,?,?,1,1)').bind(user,'fixture',user,user+'@example.test'),
    db.prepare('INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES(?,?,1,1)').bind('tenant-'+user,user),
    db.prepare('INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES(?,?,1,1)').bind('tenant-'+user,user)]);
   if(user!=='outsider'){
    await db.prepare("INSERT INTO catalog_invitations(id,token_hash,normalized_email,state,purpose,issued_by,created_at,expires_at) VALUES(?,?,?,'pending','user',?,1,?)").bind('invite-'+user,String(idx+1).repeat(64),user+'@example.test','alice',Date.now()+86400000).run();
    await db.prepare("UPDATE catalog_invitations SET state='accepted',accepted_by=?,accepted_at=? WHERE id=?").bind(user,Date.now(),'invite-'+user).run();
   }
   for(const n of [1,2]){const s=scope(user,n);await db.batch([
    db.prepare("INSERT INTO catalog_projects(id,tenant_id,owner_user_id,workspace_id,title,starter_version,status,created_at,updated_at) VALUES(?,?,?,?,'fixture','empty-v1','ready',1,1)").bind(s.projectId,s.tenantId,user,s.workspaceId),
    db.prepare("INSERT INTO catalog_workspaces(id,tenant_id,project_id,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,?,'ready',1,1)").bind(s.workspaceId,s.tenantId,s.projectId,user)]);}
  }
  await assert.rejects(accept('outsider'),/admission-denied/);
  await assert.rejects(cap('admitTurn',{...admission('alice'),scope:scope('bob')}),/admission-denied/);
  const competing=await Promise.allSettled([accept('alice',1),accept('alice',2)]);assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);
  const project=competing[0].status==='fulfilled'?1:2,first=request('alice',project);
  await accept('bob');await assert.rejects(accept('carol'),/capacity-full/);
  const ref=modelCallReference((await budget('alice','reserve',first.identity.scope.tenantId,first)).record);
  assert.equal((await budget('alice','dispatch',first.identity.scope.tenantId,ref)).authorized,true);
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  await assert.rejects(accept('alice',project===1?2:1),/execution-unconfirmed|user-busy/);
  // The tenant's terminal commits but its capacity notification is lost.
  options.workers[0].config.env.DROP_FINISH_ACK.value='true';
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  await assert.rejects(budget('alice','finish',first.identity.scope.tenantId,ref,{outcome:'completed',errorCode:null,providerRequestId:'ended',usage:{kind:'unknown',observedAt:Date.now()}}),/fixture-lost-finish-ack/);
  assert.ok((await cap('snapshot')).usage.some(r=>r.status==='dispatched'));
  options.workers[0].config.env.DROP_FINISH_ACK.value='false';
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  await cap('monitor');assert.ok((await cap('snapshot')).usage.some(r=>r.status==='billing-pending'));
  // Complete terminal with unknown usage remains charged at the original reserve.
  const usage=await budget('alice','snapshot',first.identity.scope.tenantId,first.identity);assert.equal(usage.usage[0].observedNanodollars,null);
  await assert.rejects(budget('alice','reserve',first.identity.scope.tenantId,request('alice',project,2)),/budget-limit/);
  // A terminal UI alone cannot return the slot while resources are unreleased.
  const {workspaceAgentName}=await import('../../services/workspace/protocol.ts');
  const ws=workspaceAgentName(first.identity.scope.tenantId,first.identity.scope.workspaceId);
  await rpc('workspace',ws,'setState',{found:true,turnId:first.identity.turnId,terminal:true,released:false,resourceWait:false,finishedAt:null});
  await assert.rejects(accept('carol'),/capacity-full/);
  await rpc('workspace',ws,'setState',{found:true,turnId:first.identity.turnId,terminal:true,released:true,resourceWait:false,finishedAt:null});
  await accept('carol');assert.equal((await cap('snapshot')).active,2);
  // Fresh invited identity revocation is enforced on every dispatch.
  const second=request('bob');const secondRef=modelCallReference((await budget('bob','reserve',second.identity.scope.tenantId,second)).record);
  db=await mf.getD1Database('CATALOG','beta-test');await db.prepare("UPDATE catalog_users SET status='revoked' WHERE id='bob'").run();
  await assert.rejects(budget('bob','dispatch',second.identity.scope.tenantId,secondRef),/admission-denied|not_found/);
  await db.prepare("UPDATE catalog_users SET status='active' WHERE id='bob'").run();
  await budget('bob','dispatch',second.identity.scope.tenantId,secondRef);await budget('bob','markUnknown',second.identity.scope.tenantId,secondRef);
  assert.equal((await cap('snapshot')).quarantined,1);
  // Even a purported released Workspace cannot erase a model execution unknown.
  await rpc('workspace',workspaceAgentName(second.identity.scope.tenantId,second.identity.scope.workspaceId),'setState',{found:true,turnId:second.identity.turnId,terminal:true,released:true,resourceWait:false,finishedAt:null});
  await cap('monitor');assert.equal((await cap('snapshot')).quarantined,1);
  const before=await cap('snapshot');assert.ok(before.usage.some(x=>x.status==='billing-pending'&&x.reservedNanodollars>0));
  await cap('pause');assert.equal((await cap('snapshot')).paused,true);
  await assert.rejects(cap('authorizeTurn',scope('carol'),actor('carol'),request('carol').identity.turnId),/paused/);
  await assert.rejects(cap('resume'),/release-unconfirmed/);
  // UTC rollover restores daily allowance but cannot erase the original
  // unknown or cumulative reservations. A different project stays denied.
  options.workers[0].config.env.TEST_CLOCK_OFFSET.value=String(86400000);
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  await assert.rejects(accept('bob',2),/execution-unconfirmed|user-busy/);
  assert.equal((await cap('snapshot')).usage.reduce((n,r)=>n+r.reservedNanodollars,0),before.usage.reduce((n,r)=>n+r.reservedNanodollars,0));
  options.workers[0].config.env.TEST_CLOCK_OFFSET.value='0';
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  // A late trusted terminal can repair the original unknown; explicit resume
  // still requires authoritative release for every slot and preserves costs.
  await budget('bob','finish',second.identity.scope.tenantId,secondRef,{outcome:'completed',errorCode:null,providerRequestId:'late-ended',usage:{kind:'unknown',observedAt:Date.now()}});
  await rpc('workspace',workspaceAgentName(scope('carol').tenantId,scope('carol').workspaceId),'setState',{found:true,turnId:request('carol').identity.turnId,terminal:true,released:true,resourceWait:false,finishedAt:Date.now()});
  await cap('resume');assert.equal((await cap('snapshot')).active,0);assert.equal((await cap('snapshot')).paused,false);
  assert.equal((await cap('snapshot')).usage.reduce((n,r)=>n+r.reservedNanodollars,0),before.usage.reduce((n,r)=>n+r.reservedNanodollars,0));
  // No manifest is not an exemption: the real old ledger must be quiet.
  const historical={...request('carol'),budgetPolicyVersion:'legacy-test',callId:'legacy-unknown'};
  const old=await rpc('legacy','tenant-carol','reserve','tenant-carol',historical),oldRef=modelCallReference(old.record);
  await rpc('legacy','tenant-carol','dispatch','tenant-carol',oldRef);await rpc('legacy','tenant-carol','markUnknown','tenant-carol',oldRef);
  await assert.rejects(accept('carol',2),/execution-unconfirmed/);
  // New policy ID cannot reset cumulative exposure or occupied slots.
  options.workers[0].config.env.PRIVATE_BETA_POLICY_JSON.value=JSON.stringify({...policy,policyId:'replacement'});
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  await assert.rejects(cap('monitor'),/policy-conflict/);
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
