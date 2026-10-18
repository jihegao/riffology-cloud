import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {profile} from './production-profile-fixture.ts';
import {betaPolicy,meterOnlyPolicy} from './private-beta-fixture.ts';
import {turnDigest} from '../../services/turn/protocol.ts';

// Real Workerd SQLite/D1 and the production capacity classes. Workspace and
// model/native outcomes are synthetic authorities; no provider/container runs.
async function fixture(t,{initializeNative=true,nativeAvailable=true}={}){
 const dir=await mkdtemp(join(tmpdir(),'beta-maintenance-')),policy=meterOnlyPolicy(await betaPolicy()),policySha=await turnDigest({...policy,enabled:false});
 const built=await build({stdin:{contents:`
 import {DurableObject} from 'cloudflare:workers';
 import {PrivateBetaCapacity as Base} from './services/model-budget/private-beta-capacity.ts';
 import {TrustedPiCapacity as Native} from './services/capacity/durable.ts';
 export class Beta extends Base {
  async seedForTest(hash){this.ctx.storage.sql.exec('INSERT INTO beta_policy VALUES(1,?)',hash);await this.ctx.storage.sync();}
  async inspectionForTest(){return {rows:['beta_policy','beta_slots','beta_calls','beta_operations','beta_alerts','beta_call_metering'].map(n=>this.ctx.storage.sql.exec('SELECT * FROM '+n+' ORDER BY 1').toArray()),kv:[...this.ctx.storage.kv.list()],alarm:await this.ctx.storage.getAlarm()};}
  async terminalForTest(key,status){this.ctx.storage.sql.exec('UPDATE beta_calls SET status=? WHERE key=?',status,key);await this.ctx.storage.sync();}
  async beginLostAckForTest(input,actor){await this.beginMaintenance(input,actor);throw Error('synthetic-response-lost');}
  async endLostAckForTest(input,actor){await this.endMaintenance(input,actor);throw Error('synthetic-response-lost');}
  async corruptMaintenanceForTest(){this.ctx.storage.kv.put('beta-maintenance-state',null);await this.ctx.storage.sync();}
 }
 export class NativeCapacity extends Native {
  proofCalls=0;proofGate=null;releaseGate=null;waiting=false;proofFault=null;
  async maintenanceQuiescence(){this.proofCalls++;const proof=super.maintenanceQuiescence();if(this.proofGate){this.waiting=true;await this.proofGate;this.waiting=false;}if(this.proofFault==='unknown')return {...proof,quiescent:null};return proof;}
  proofCallsForTest(){return this.proofCalls;}
  proofWaitingForTest(){return this.waiting;}
  gateProofForTest(){this.proofGate=new Promise(resolve=>{this.releaseGate=resolve;});}
  releaseProofForTest(){this.releaseGate?.();this.proofGate=null;}
  proofFaultForTest(value){this.proofFault=value;}
  async inspectionForTest(){return {rows:this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").toArray().filter(r=>r.name.startsWith('trusted_pi_')||r.name.startsWith('paired_')).map(r=>({name:r.name,rows:this.ctx.storage.sql.exec('SELECT * FROM '+r.name+' ORDER BY 1').toArray()})),alarm:await this.ctx.storage.getAlarm()};}
 }
 export class Workspace extends DurableObject {
  async privateBetaReleaseState(){return this.ctx.storage.kv.get('state')??{found:false,turnId:null,terminal:false,released:false,resourceWait:false,finishedAt:null};}
  async setState(v){this.ctx.storage.kv.put('state',v);}
  async cancelTurn(){this.ctx.storage.kv.put('cancelled',true);}
  async cancelled(){return this.ctx.storage.kv.get('cancelled')??false;}
 }
 export default {async fetch(r,env){const {kind,name,method,args}=await r.json();try{const ns=kind==='beta'?env.PRIVATE_BETA_CAPACITY:kind==='native'?env.TRUSTED_PI_CAPACITY:env.WORKSPACE_AGENT;return Response.json({value:await ns.getByName(name)[method](...args)});}catch(e){return Response.json({error:e.message});}}};`,resolveDir:process.cwd(),sourcefile:'maintenance-test.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const classes={PRIVATE_BETA_CAPACITY:'Beta',TRUSTED_PI_CAPACITY:'NativeCapacity',WORKSPACE_AGENT:'Workspace'};
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},workers:[{config:{type:'worker',name:'maintenance-test',compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:built.outputFiles[0].text}}},env:{CATALOG:{type:'d1',id:'catalog',name:'catalog'},PRIVATE_BETA_POLICY_JSON:{type:'text',value:JSON.stringify(policy)},PRODUCTION_MODEL_PROFILE_JSON:{type:'text',value:JSON.stringify(profile)},TRUSTED_PI_CAPACITY_LIMIT:{type:'text',value:'1'},TRUSTED_PI_CAPACITY_POLICY_VERSION:{type:'text',value:'native-test-v1'},M2_WORKSPACE_RUNTIME_REUSE_ENABLED:{type:'text',value:'true'},...Object.fromEntries(Object.entries(classes).map(([k,v])=>[k,{type:'durable-object',worker:'maintenance-test',exportName:v}]))},exports:Object.fromEntries(Object.values(classes).map(v=>[v,{type:'durable-object',storage:'sqlite'}]))},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('disabled',{status:403})}}}]};
 if(!nativeAvailable)delete options.workers[0].config.env.TRUSTED_PI_CAPACITY;
 let mf=new Miniflare(options);await mf.ready;
 t.after(async()=>{await mf.dispose();await rm(dir,{recursive:true,force:true});});
 const rpc=async(kind,name,method,...args)=>{const d=await(await mf.dispatchFetch('http://fixture/',{method:'POST',body:JSON.stringify({kind,name,method,args})})).json();if(d.error)throw Error(d.error);return d.value;};
 const cap=(method,...args)=>rpc('beta','private-beta-capacity-v1',method,...args),native=(method,...args)=>rpc('native','trusted-pi-capacity:application',method,...args);
 const scope=user=>({tenantId:'tenant-'+user,projectId:'project-'+user,workspaceId:'workspace-'+user,workspaceGeneration:1}),actor=user=>({userId:user,authVersion:1}),admission=(user,key='original')=>({scope:scope(user),actor:actor(user),sessionId:'session',requestKey:key});
 const db=await mf.getD1Database('CATALOG','maintenance-test');
 for(const filename of ['0001_catalog.sql','0004_operator_invitations.sql','0005_initial_operator.sql','0012_project_archives.sql']){
  const sql=(await readFile('services/catalog/migrations/'+filename,'utf8')).replace(/--[^\n]*/g,'');for(const stmt of sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])if(stmt.trim())await db.prepare(stmt).run();
 }
 for(const [i,user]of ['alice','bob','carol'].entries()){
  const s=scope(user);await db.batch([
   db.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES(?,'fixture',?,?,1,1)").bind(user,user,user+'@example.test'),
   db.prepare('INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES(?,?,1,1)').bind(s.tenantId,user),
   db.prepare('INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES(?,?,1,1)').bind(s.tenantId,user),
   db.prepare("INSERT INTO catalog_projects(id,tenant_id,owner_user_id,workspace_id,title,starter_version,status,created_at,updated_at) VALUES(?,?,?,?,'fixture','empty-v1','ready',1,1)").bind(s.projectId,s.tenantId,user,s.workspaceId),
   db.prepare("INSERT INTO catalog_workspaces(id,tenant_id,project_id,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,?,'ready',1,1)").bind(s.workspaceId,s.tenantId,s.projectId,user),
   db.prepare("INSERT INTO catalog_invitations(id,token_hash,normalized_email,state,purpose,issued_by,created_at,expires_at) VALUES(?,?,?,'pending','user',?,1,?)").bind('invite-'+user,String(i+1).repeat(64),user+'@example.test',user,Date.now()+86400000)]);
  await db.prepare("UPDATE catalog_invitations SET state='accepted',accepted_by=?,accepted_at=? WHERE id=?").bind(user,Date.now(),'invite-'+user).run();
 }
 await cap('seedForTest',policySha);
 const coldId=n=>({tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',sessionId:'session',operationId:n,turnId:n,generation:1});
 if(initializeNative){const cold=await native('request',coldId('initialize'));
 await native('cancelNeverStarted',{...coldId('initialize'),ticketId:cold.ticket.ticketId,leaseId:cold.ticket.leaseId},{kind:'never-started',proofId:'initialize-cancel',observedAt:Date.now()});}
 const operator={userId:'operator',authVersion:1},begin=(requestId='maintenance',expectedRevision=0)=>({requestId,expectedRevision,expectedPolicySha256:policySha});
 const workspace=async(user,method,...args)=>{const {workspaceAgentName}=await import('../../services/workspace/protocol.ts');return rpc('workspace',workspaceAgentName(scope(user).tenantId,scope(user).workspaceId),method,...args);};
 const released=user=>workspace(user,'setState',{found:true,turnId:'turn-'+user,terminal:true,released:true,resourceWait:false,finishedAt:Date.now()});
 return {cap,native,foreignNative:()=>rpc('native','foreign','maintenanceQuiescence'),scope,actor,admission,operator,begin,policy,policySha,coldId,workspace,released,async restart(nextPolicy=policy){options.workers[0].config.env.PRIVATE_BETA_POLICY_JSON.value=JSON.stringify(nextPolicy);await mf.dispose();mf=new Miniflare(options);await mf.ready;}};
}

test('maintenance preserves admitted work and receipts across restart; state reads are inert; original proof gates end',{timeout:90000},async t=>{
 const f=await fixture(t),{cap,native}=f;
 await assert.rejects(cap('maintenanceQuiescence','maintenance',f.operator),/conflict/);
 const admitted=await cap('admitTurn',f.admission('alice'));
 const beforeBegin=await cap('inspectionForTest'),ack=await cap('beginMaintenance',f.begin(),f.operator);
 assert.equal(ack.receipt.revision,1);assert.deepEqual((await cap('inspectionForTest')).rows,beforeBegin.rows,'begin touches only its own maintenance KV');
 await assert.rejects(cap('maintenanceQuiescence','foreign-request',f.operator),/conflict/);
 await assert.rejects(cap('maintenanceQuiescence','maintenance',{userId:'another-operator',authVersion:1}),/conflict/);
 await assert.rejects(cap('maintenanceQuiescence','maintenance',{...f.operator,authVersion:2}),/conflict/);
 assert.deepEqual(await cap('admitTurn',f.admission('alice')),{...admitted,replayed:true});
 await assert.rejects(cap('admitTurn',f.admission('bob')),/maintenance-held/);
 await cap('bindTurn',f.admission('alice'),'turn-alice');
 await cap('authorizeTurn',f.scope('alice'),f.actor('alice'),'turn-alice');
 await cap('authorizeTool',f.scope('alice'),f.actor('alice'),'turn-alice',Date.now()+1000);
 const req={schemaVersion:1,identity:{scope:f.scope('alice'),sessionId:'session',turnId:'turn-alice',dispatchId:'dispatch',generation:1},actor:f.actor('alice'),callId:'call',requestId:'call-request',deadlineAt:Date.now()+60000,provider:'openai',model:profile.model,payloadSha256:'a'.repeat(64),inputTokenUpperBound:100,maxOutputTokens:20,inputBoundVersion:'utf8-provider-payload-plus-4096-v1',budgetPolicyVersion:'beta-token-v1'};
 const reservation=await cap('reserve',req);await cap('checkDispatch',req);
 assert.equal(await f.workspace('alice','cancelled'),false);
 const end={...f.begin(),expectedRevision:1};await assert.rejects(cap('endMaintenance',end,f.operator),/release-unconfirmed/);
 await f.restart();assert.deepEqual(await cap('beginMaintenance',f.begin(),f.operator),{...ack,replayed:true});
 assert.deepEqual((await cap('maintenanceStatus','maintenance',f.operator)).receipts.begin,ack.receipt);
 await assert.rejects(cap('beginMaintenance',f.begin(),{...f.operator,authVersion:2}),/conflict/);
 await assert.rejects(cap('beginMaintenance',{...f.begin(),expectedRevision:2},f.operator),/conflict/);
 const betaBefore=await cap('inspectionForTest'),nativeBefore=await native('inspectionForTest');
 const callsBefore=await native('proofCallsForTest');await cap('maintenanceStatus','maintenance',f.operator);assert.equal(await native('proofCallsForTest'),callsBefore,'historical receipt GET has no native RPC');
 for(let n=0;n<3;n++){const s=await cap('maintenanceStatus');assert.equal(s.ledger.activeSlots,1);assert.equal(s.actualContainerReleaseVerified,false);const q=await cap('maintenanceQuiescence','maintenance',f.operator);assert.equal(q.quiescent,false);assert.equal(q.ledger.activeSlots,1);assert.equal(q.native.quiescent,true);assert.equal(q.revision,1);assert.equal(q.hold.requestId,'maintenance');assert.equal(q.actualContainerReleaseVerified,false);}
 assert.deepEqual(await cap('inspectionForTest'),betaBefore);assert.deepEqual(await native('inspectionForTest'),nativeBefore);
 await f.released('alice');await cap('terminalForTest',reservation.key,'unknown');
 assert.equal((await cap('maintenanceQuiescence','maintenance',f.operator)).quiescent,false);
 await assert.rejects(cap('endMaintenance',end,f.operator),/release-unconfirmed/);
 // Synthetic original authority supplies the execution terminal; normal
 // monitor/release remains separate from every maintenance state operation.
 await cap('terminalForTest',reservation.key,'observed');await cap('monitor');
 const blocked=await native('request',f.coldId('occupied'));
 const occupied=await cap('maintenanceQuiescence','maintenance',f.operator);assert.equal(occupied.quiescent,false);assert.equal(occupied.native.coldUnresolved,1);
 await assert.rejects(cap('endMaintenance',end,f.operator),/release-unconfirmed/);
 await native('cancelNeverStarted',{...f.coldId('occupied'),ticketId:blocked.ticket.ticketId,leaseId:blocked.ticket.leaseId},{kind:'never-started',proofId:'occupied-cancel',observedAt:Date.now()});
 assert.equal((await cap('maintenanceQuiescence','maintenance',f.operator)).quiescent,true,'fresh pre-rollout proof does not end the barrier');
 const ended=await cap('endMaintenance',end,f.operator);assert.equal(ended.receipt.revision,2);
 assert.deepEqual(await cap('endMaintenance',end,f.operator),{...ended,replayed:true});
 const oldBegin=await cap('beginMaintenance',f.begin(),f.operator);
 assert.deepEqual(oldBegin.receipt,ack.receipt);assert.deepEqual(oldBegin.current,{revision:2,hold:null},'historical begin ACK does not re-open hold');
 const next=await cap('beginMaintenance',f.begin('next',2),f.operator);
 assert.equal(next.receipt.revision,3);
 const oldEnd=await cap('endMaintenance',end,f.operator);
 assert.deepEqual(oldEnd.receipt,ended.receipt);assert.equal(oldEnd.current.hold.requestId,'next');assert.equal(oldEnd.current.revision,3);
 assert.equal((await cap('maintenanceStatus')).hold.requestId,'next','old end ACK cannot clear a later hold');
 await assert.rejects(cap('endMaintenance',{...f.begin('next',2),expectedRevision:3,expectedPolicySha256:'f'.repeat(64)},f.operator),/conflict/);
});

test('missing original native proof fails closed without initializing a ledger, and foreign actor is denied',{timeout:90000},async t=>{
 const f=await fixture(t,{initializeNative:false});await f.cap('beginMaintenance',f.begin(),f.operator);
 const before=await f.native('inspectionForTest');assert.deepEqual(before,{rows:[],alarm:null});
 await assert.rejects(f.native('maintenanceQuiescence'),/proof-missing/);
 await assert.rejects(f.cap('maintenanceQuiescence','maintenance',f.operator),/proof-missing/);
 await assert.rejects(f.cap('endMaintenance',{...f.begin(),expectedRevision:1},f.operator),/proof-missing/);
 assert.deepEqual(await f.native('inspectionForTest'),before);
 assert.equal((await f.cap('maintenanceStatus')).hold.requestId,'maintenance');
 await assert.rejects(f.foreignNative(),/actor-scope-denied/);
 await f.cap('corruptMaintenanceForTest');
 await assert.rejects(f.cap('maintenanceStatus'),/state-invalid/);
 await assert.rejects(f.cap('admitTurn',f.admission('alice')),/state-invalid/);
 await assert.rejects(f.cap('endMaintenance',{...f.begin(),expectedRevision:1},f.operator),/state-invalid/);
});

test('lost maintenance ACK recovers by original ID; retained idle and partially released pairs cannot open admission',{timeout:90000},async t=>{
 const f=await fixture(t),{cap,native}=f;
 await assert.rejects(cap('beginLostAckForTest',f.begin(),f.operator),/synthetic-response-lost/);
 const recovered=await cap('maintenanceStatus','maintenance',f.operator);
 assert.equal(recovered.hold.requestId,'maintenance');assert.equal(recovered.receipts.begin.revision,1);
 await f.restart();const replay=await cap('beginMaintenance',f.begin(),f.operator);
 assert.deepEqual(replay.receipt,recovered.receipts.begin);assert.equal(replay.replayed,true);assert.equal(replay.current.hold.requestId,'maintenance');
 const binding={sessionId:'paired-session',turnId:'paired-turn',dispatchId:'paired-dispatch',bindingEpoch:1};
 let pair=await native('requestPair',f.scope('alice'),'retained');pair=await native('bind',pair.ref,binding);
 const proofs=Object.fromEntries(['project','trustedPi'].map(domain=>[domain,{schemaVersion:1,domain,leaseId:pair.ref.leaseId,leaseEpoch:pair.ref.leaseEpoch,bindingEpoch:1,status:'quiescent',remaining:0,proofId:'handoff-'+domain,observedAt:Date.now()}]));
 pair=await native('confirmHandoff',pair.ref,binding,proofs);assert.equal(pair.status,'idle');
 const end={...f.begin(),expectedRevision:1},before=await native('inspectionForTest');
 assert.equal((await native('maintenanceQuiescence')).quiescent,false);
 const idle=await cap('maintenanceQuiescence','maintenance',f.operator);assert.equal(idle.quiescent,false);assert.equal(idle.native.pairUnresolved,1);assert.equal(idle.ledger.quiescent,true);
 await assert.rejects(cap('endMaintenance',end,f.operator),/release-unconfirmed/);
 assert.deepEqual(await native('inspectionForTest'),before,'reading or failed end cannot retire idle pair or change alarm');
 pair=await native('cancelPair',pair.ref);assert.equal(pair.status,'releasing');
 const release=domain=>({schemaVersion:1,domain,leaseId:pair.ref.leaseId,leaseEpoch:pair.ref.leaseEpoch,kind:'never-started',proofId:'release-'+domain,observedAt:Date.now(),absentSince:null});
 await native('confirmPairReleased',pair.ref,{project:release('project')});
 assert.equal((await cap('maintenanceQuiescence','maintenance',f.operator)).quiescent,false,'partial pair release remains closed');
 await assert.rejects(cap('endMaintenance',end,f.operator),/release-unconfirmed/);
 await native('confirmPairReleased',pair.ref,{trustedPi:release('trustedPi')});
 assert.equal((await native('maintenanceQuiescence')).quiescent,true);
 const betaQuietBefore=await cap('inspectionForTest'),nativeQuietBefore=await native('inspectionForTest');
 const quiet=await cap('maintenanceQuiescence','maintenance',f.operator);assert.equal(quiet.quiescent,true);assert.equal(quiet.hold.requestId,'maintenance');assert.equal(quiet.actualContainerReleaseVerified,false);
 assert.deepEqual(await cap('inspectionForTest'),betaQuietBefore);assert.deepEqual(await native('inspectionForTest'),nativeQuietBefore,'positive proof does not change ledgers or alarm');
 await assert.rejects(cap('endLostAckForTest',end,f.operator),/synthetic-response-lost/);
 await f.restart();const ended=await cap('endMaintenance',end,f.operator);
 assert.equal(ended.replayed,true);assert.deepEqual(ended.current,{revision:2,hold:null});assert.equal(ended.receipt.revision,2);
});

test('admit/begin race is serialized and kill/pause/resume cannot bypass or erase a maintenance hold',{timeout:90000},async t=>{
 const f=await fixture(t),{cap}=f;
 const race=await Promise.allSettled([cap('admitTurn',f.admission('alice')),cap('beginMaintenance',f.begin(),f.operator)]);
 assert.equal(race[1].status,'fulfilled');
 if(race[0].status==='fulfilled'){await cap('bindTurn',f.admission('alice'),'turn-alice');}
 else assert.match(race[0].reason.message,/maintenance-held/);
 await assert.rejects(cap('admitTurn',f.admission('bob')),/maintenance-held/);
 const end={...f.begin(),expectedRevision:1};
 await cap('pause');
 await assert.rejects(cap('maintenanceQuiescence','maintenance',f.operator),/controls-changed/);
 await assert.rejects(cap('authorizeTurn',f.scope('alice'),f.actor('alice'),'turn-alice'),/paused/);
 await assert.rejects(cap('endMaintenance',end,f.operator),/release-unconfirmed|controls-changed|conflict/);
 assert.equal((await cap('maintenanceStatus')).hold.requestId,'maintenance');
 if(race[0].status==='fulfilled'){await f.released('alice');}
 await cap('resume');
 await assert.rejects(cap('maintenanceQuiescence','maintenance',f.operator),/conflict/);
 await assert.rejects(cap('admitTurn',f.admission('bob')),/maintenance-held/);
 await assert.rejects(cap('endMaintenance',end,f.operator),/conflict/);
 await f.restart({...f.policy,enabled:false});
 await assert.rejects(cap('maintenanceQuiescence','maintenance',f.operator),/controls-changed/);
 await assert.rejects(cap('admitTurn',f.admission('carol')),/paused/);
 await assert.rejects(cap('endMaintenance',end,f.operator),/controls-changed|conflict/);
 await f.restart({...f.policy,maxActiveTurns:3});
 await assert.rejects(cap('maintenanceQuiescence','maintenance',f.operator),/controls-changed|conflict/);
 await assert.rejects(cap('endMaintenance',end,f.operator),/controls-changed|conflict/);
 assert.equal((await cap('maintenanceStatus')).hold.requestId,'maintenance');
});

test('fresh quiescence fails closed on missing/unknown native authority and rechecks controls after the RPC',{timeout:90000},async t=>{
 const missing=await fixture(t,{initializeNative:false,nativeAvailable:false});await missing.cap('beginMaintenance',missing.begin(),missing.operator);
 await assert.rejects(missing.cap('maintenanceQuiescence','maintenance',missing.operator),/proof-unavailable/);
 const f=await fixture(t),{cap,native}=f;await cap('beginMaintenance',f.begin(),f.operator);
 await native('proofFaultForTest','unknown');const betaBefore=await cap('inspectionForTest'),nativeBefore=await native('inspectionForTest');
 await assert.rejects(cap('maintenanceQuiescence','maintenance',f.operator),/proof-unavailable/);
 assert.deepEqual(await cap('inspectionForTest'),betaBefore);assert.deepEqual(await native('inspectionForTest'),nativeBefore);
 await native('proofFaultForTest',null);await native('gateProofForTest');
 const reading=cap('maintenanceQuiescence','maintenance',f.operator);
 // A real-time bounded yield, rather than a fixed number of event-loop turns.
 try{const deadline=Date.now()+3000;while(!await native('proofWaitingForTest')){if(Date.now()>=deadline)throw Error('proof-RPC-not-reached');await new Promise(resolve=>setTimeout(resolve,1));}
  await cap('pause');
 }finally{await native('releaseProofForTest');}
 await assert.rejects(reading,/controls-changed/);
 assert.equal((await cap('maintenanceStatus')).hold.requestId,'maintenance');
});
