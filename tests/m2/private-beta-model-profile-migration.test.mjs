import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {betaPolicy,meterOnlyPolicy} from './private-beta-fixture.ts';
import {profile} from './production-profile-fixture.ts';
import {profileDigest} from '../../services/model-proxy/production-profile.ts';
import {turnDigest} from '../../services/turn/protocol.ts';

test('same-actor model profile migration preserves history, fails closed and persists exact replay proof',{timeout:120000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'beta-model-profile-'));
 const previous=meterOnlyPolicy(await betaPolicy());
 const nextProfile={...profile,profileVersion:'fixture-model-upgrade-v2',model:'fixture-new-model',rates:{...profile.rates,version:'fixture-rates-v2',inputNanodollarsPerToken:3,outputNanodollarsPerToken:8},acceptance:{...profile.acceptance,evidenceSha256:'c'.repeat(64)}};
 const next={...previous,profileSha256:await profileDigest(nextProfile)};
 const previousDigest=await turnDigest({...previous,enabled:false}),nextDigest=await turnDigest({...next,enabled:false});
 const bundle=await build({stdin:{contents:`
  import {PrivateBetaCapacity as Base} from './services/model-budget/private-beta-capacity.ts';
  export class Capacity extends Base {
   async seed(digest){
    this.ctx.storage.sql.exec('INSERT INTO beta_policy VALUES(1,?)',digest);
    this.ctx.storage.sql.exec("INSERT INTO beta_slots VALUES('old-slot','user',?,1,'old-turn','released')",JSON.stringify({originalIdentity:'unchanged'}));
    this.ctx.storage.sql.exec("INSERT INTO beta_calls VALUES('observed','old-slot','user','2026-01-01',?,125,'observed'),('pending','old-slot','user','2026-01-01',?,375,'billing-pending')",JSON.stringify({model:'fixture-model'}),JSON.stringify({model:'fixture-model'}));
    this.ctx.storage.sql.exec("INSERT INTO beta_call_metering VALUES('observed',1,NULL),('pending',1,2)");
    this.ctx.storage.sql.exec("INSERT INTO beta_alerts VALUES('old-alert',1,'historical-alert')");
    this.ctx.storage.sql.exec("INSERT INTO beta_operations(action,actor_json,at) VALUES('historical-pause','{}',1)");
    this.ctx.storage.kv.put('beta-paused',true);await this.ctx.storage.sync();
   }
   async fixtureState(slotStatus,callStatus,paused=true){
    this.ctx.storage.sql.exec('UPDATE beta_slots SET status=?',slotStatus);
    this.ctx.storage.sql.exec("UPDATE beta_calls SET status=? WHERE key='observed'",callStatus);
    this.ctx.storage.kv.put('beta-paused',paused);await this.ctx.storage.sync();
   }
   async auditFailure(on){this.ctx.storage.sql.exec(on?"CREATE TRIGGER fail_profile_migration BEFORE INSERT ON beta_operations WHEN NEW.action LIKE 'migrate-model-profile:%' BEGIN SELECT RAISE(ABORT,'fixture-audit-failure'); END":"DROP TRIGGER fail_profile_migration");}
   async mutate(){this.ctx.storage.sql.exec("INSERT INTO beta_alerts VALUES('new-alert',2,'new-evidence')");await this.ctx.storage.sync();}
   async proof(action){
    if(action==='hide')this.ctx.storage.sql.exec("UPDATE beta_operations SET action='hidden-proof' WHERE action LIKE 'migrate-model-profile:%'");
    if(action==='restore'){const rows=this.ctx.storage.sql.exec('SELECT transition_digest,at FROM beta_model_profile_migrations ORDER BY at').toArray();for(const row of rows)this.ctx.storage.sql.exec("UPDATE beta_operations SET action=? WHERE action='hidden-proof' AND at=?",'migrate-model-profile:'+row.transition_digest,row.at);}
    await this.ctx.storage.sync();
   }
   dump(){return {policy:this.ctx.storage.sql.exec('SELECT * FROM beta_policy').toArray(),slots:this.ctx.storage.sql.exec('SELECT * FROM beta_slots ORDER BY key').toArray(),calls:this.ctx.storage.sql.exec('SELECT * FROM beta_calls ORDER BY key').toArray(),metering:this.ctx.storage.sql.exec('SELECT * FROM beta_call_metering ORDER BY call_key').toArray(),alerts:this.ctx.storage.sql.exec('SELECT * FROM beta_alerts ORDER BY key').toArray(),operations:this.ctx.storage.sql.exec('SELECT * FROM beta_operations ORDER BY id').toArray(),migrations:this.ctx.storage.sql.exec('SELECT * FROM beta_model_profile_migrations ORDER BY at').toArray(),quotaMigrations:this.ctx.storage.sql.exec('SELECT * FROM beta_policy_migrations').toArray(),paused:this.ctx.storage.kv.get('beta-paused')};}
  }
  export default {async fetch(r,env){const {method,args,name}=await r.json();try{return Response.json({value:await env.PRIVATE_BETA_CAPACITY.getByName(name??'private-beta-capacity-v1')[method](...args)});}catch(e){return Response.json({error:e.message});}}};
 `,resolveDir:process.cwd(),sourcefile:'profile-migration-test.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 let outboundAttempts=0;
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},workers:[{config:{type:'worker',name:'profile-migration-test',compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{PRIVATE_BETA_POLICY_JSON:{type:'text',value:JSON.stringify(next)},PRODUCTION_MODEL_PROFILE_JSON:{type:'text',value:JSON.stringify(nextProfile)},M2_MODEL_PROVIDER:{type:'text',value:'openai'},M2_MODEL_ID:{type:'text',value:nextProfile.model},PRODUCTION_ACCEPTED_EVIDENCE_SHA256:{type:'text',value:nextProfile.acceptance.evidenceSha256},PRIVATE_BETA_CAPACITY:{type:'durable-object',worker:'profile-migration-test',exportName:'Capacity'}},exports:{Capacity:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{outboundAttempts++;throw Error('unexpected-outbound-request');}}}}]};
 let mf;
 const restart=async(policy=next,configuredProfile=nextProfile,patch={})=>{await mf?.dispose();const env=options.workers[0].config.env;env.PRIVATE_BETA_POLICY_JSON.value=JSON.stringify(policy);env.PRODUCTION_MODEL_PROFILE_JSON.value=JSON.stringify(configuredProfile);env.M2_MODEL_PROVIDER.value=patch.provider??'openai';env.M2_MODEL_ID.value=patch.model??configuredProfile.model;env.PRODUCTION_ACCEPTED_EVIDENCE_SHA256.value=patch.evidence??configuredProfile.acceptance.evidenceSha256;mf=new Miniflare(options);await mf.ready;};
 const rpc=async(method,...args)=>{const result=await(await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({method,args})})).json();if(result.error)throw Error(result.error);return result.value;};
 const inputFor=async(oldPolicy)=>({previousProfileSha256:oldPolicy.profileSha256,expectedPolicySha256:await turnDigest({...oldPolicy,enabled:false}),expectedLedgerSha256:(await rpc('migrationState')).ledgerSha256});
 const preserved=(before,after)=>{for(const key of ['slots','calls','metering','alerts','quotaMigrations','paused'])assert.deepEqual(after[key],before[key],key);};
 try{
  await restart();
  let input=await inputFor(previous);
  await assert.rejects(rpc('migrateModelProfile',input),/policy-unpinned/);
  await rpc('seed',previousDigest);input=await inputFor(previous);
  const before=await rpc('dump');
  assert.equal((await rpc('snapshot')).policyReady,false);await assert.rejects(rpc('monitor'),/policy-conflict/);
  for(const bad of [null,{}, {...input,extra:true},{...input,previousProfileSha256:next.profileSha256},{...input,previousProfileSha256:'x'},{...input,expectedPolicySha256:'0'.repeat(64)},{...input,expectedLedgerSha256:'0'.repeat(64)}]){
   await assert.rejects(rpc('migrateModelProfile',bad),/migration-invalid|policy-conflict|state-conflict/);assert.deepEqual(await rpc('dump'),before);
  }
  // Changing a second policy field cannot masquerade as a model transition.
  for(const patch of [{policyId:'replacement'},{startsAt:previous.startsAt-1},{reviewAt:previous.reviewAt+1},{maxActiveTurns:3},{releaseTimeoutMs:previous.releaseTimeoutMs+1},{warningCallsPerMinute:previous.warningCallsPerMinute+1},{historicalIsolation:[{tenantId:'new',manifests:[{schemaVersion:1,ledger:'legacy',proofs:[]},{schemaVersion:1,ledger:'g5',proofs:[]}]}]}]){
   await restart({...next,...patch});await assert.rejects(rpc('migrateModelProfile',input),/policy-conflict/);assert.deepEqual(await rpc('dump'),before);
  }
  for(const [configuredProfile,patch] of [[profile,{}],[nextProfile,{model:profile.model}],[nextProfile,{provider:'opencode-go'}],[nextProfile,{evidence:profile.acceptance.evidenceSha256}],[nextProfile,{evidence:''}]]){
   await restart(next,configuredProfile,patch);await assert.rejects(rpc('migrateModelProfile',input),/profile-denied/);assert.deepEqual(await rpc('dump'),before);
  }
  await restart();
  for(const status of ['admitting','active','quarantined']){
   await rpc('fixtureState',status,'observed');const blocked=await rpc('dump');
   await assert.rejects(rpc('migrateModelProfile',await inputFor(previous)),/release-unconfirmed/);assert.deepEqual(await rpc('dump'),blocked);
  }
  for(const status of ['reserved','dispatched','unknown']){
   await rpc('fixtureState','released',status);const blocked=await rpc('dump');
   await assert.rejects(rpc('migrateModelProfile',await inputFor(previous)),/release-unconfirmed/);assert.deepEqual(await rpc('dump'),blocked);
  }
  await rpc('fixtureState','released','observed',false);const open=await rpc('dump');
  await assert.rejects(rpc('migrateModelProfile',await inputFor(previous)),/requires-pause/);assert.deepEqual(await rpc('dump'),open);
  await rpc('fixtureState','released','observed');input=await inputFor(previous);
  await rpc('auditFailure',true);await assert.rejects(rpc('migrateModelProfile',input),/fixture-audit-failure/);assert.deepEqual(await rpc('dump'),before);await rpc('auditFailure',false);
  await rpc('mutate');const updated=await rpc('dump');await assert.rejects(rpc('migrateModelProfile',input),/state-conflict/);assert.deepEqual(await rpc('dump'),updated);
  input=await inputFor(previous);
  const concurrent=await Promise.all([rpc('migrateModelProfile',input,{userId:'operator',authVersion:1}),rpc('migrateModelProfile',input)]);
  assert.deepEqual(concurrent.map(r=>r.replayed).sort(),[false,true]);
  const after=await rpc('dump');preserved(updated,after);assert.deepEqual(after.operations.slice(0,-1),updated.operations);
  assert.equal(after.policy[0].digest,nextDigest);assert.equal(after.operations.length,updated.operations.length+1);assert.equal(after.migrations.length,1);
  assert.deepEqual(JSON.parse(after.migrations[0].previous_document),{...previous,enabled:false});assert.deepEqual(JSON.parse(after.migrations[0].next_document),{...next,enabled:false});assert.equal(after.migrations[0].ledger_digest,input.expectedLedgerSha256);
  assert.equal((await rpc('snapshot')).policyReady,true);assert.equal((await rpc('snapshot')).paused,true);
  await restart();assert.equal((await rpc('migrateModelProfile',input)).replayed,true);assert.deepEqual(await rpc('dump'),after);
  await assert.rejects(rpc('migrateModelProfile',{...input,expectedLedgerSha256:'0'.repeat(64)}),/policy-conflict/);
  await rpc('proof','hide');const broken=await rpc('dump');await assert.rejects(rpc('migrateModelProfile',input),/policy-conflict/);assert.deepEqual(await rpc('dump'),broken);await rpc('proof','restore');
  // Replays are observation-only even after resumed/occupied state changes.
  await rpc('fixtureState','active','observed',false);const resumed=await rpc('dump');assert.equal((await rpc('migrateModelProfile',input)).replayed,true);assert.deepEqual(await rpc('dump'),resumed);
  await rpc('fixtureState','released','observed');
  // Configuration rollback alone stays closed. An explicit reverse transition
  // preserves all records and permits a later upgrade on the same actor.
  await restart(previous,profile);await assert.rejects(rpc('monitor'),/policy-conflict/);
  const rollbackInput=await inputFor(next),preRollback=await rpc('dump');
  assert.equal((await rpc('migrateModelProfile',rollbackInput)).replayed,false);const rolledBack=await rpc('dump');preserved(preRollback,rolledBack);assert.equal(rolledBack.migrations.length,2);assert.equal(rolledBack.policy[0].digest,previousDigest);
  await restart();const againInput=await inputFor(previous);assert.equal((await rpc('migrateModelProfile',againInput)).replayed,false);assert.equal((await rpc('dump')).migrations.length,3);assert.equal((await rpc('snapshot')).policyReady,true);
  const other=await(await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({name:'replacement',method:'migrateModelProfile',args:[againInput]})})).json();assert.match(other.error,/actor-denied/);
  assert.equal(outboundAttempts,0);
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
