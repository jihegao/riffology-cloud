import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {betaPolicy,meterOnlyPolicy} from './private-beta-fixture.ts';
import {turnDigest} from '../../services/turn/protocol.ts';

test('same actor quota migration atomically preserves occupied/unknown/billing rows, audits and pause; restart/replay fail closed',{timeout:90000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'beta-quota-'));
 const previous=await betaPolicy(),next=meterOnlyPolicy(previous),priorDigest=await turnDigest({...previous,enabled:false});
 const bundle=await build({stdin:{contents:`
  import {PrivateBetaCapacity as Base} from './services/model-budget/private-beta-capacity.ts';
  export class Capacity extends Base {
   async seed(digest){
    this.ctx.storage.sql.exec('INSERT INTO beta_policy VALUES(1,?)',digest);
    this.ctx.storage.sql.exec("INSERT INTO beta_slots VALUES('old-slot','user','{}',1,'old-turn','quarantined')");
    this.ctx.storage.sql.exec("INSERT INTO beta_calls VALUES('observed','old-slot','user','2026-01-01','{}',125,'observed'),('pending','old-slot','user','2026-01-01','{}',375,'billing-pending'),('unknown','old-slot','user','2026-01-01','{}',500,'unknown')");
    this.ctx.storage.sql.exec("INSERT INTO beta_alerts VALUES('old-alert',1,'execution-unknown')");
    this.ctx.storage.sql.exec("INSERT INTO beta_operations(action,actor_json,at) VALUES('historical-pause','{}',1)");
    this.ctx.storage.kv.put('beta-paused',true);await this.ctx.storage.sync();
   }
   async auditFailure(on){this.ctx.storage.sql.exec(on?"CREATE TRIGGER fail_migration BEFORE INSERT ON beta_operations WHEN NEW.action LIKE 'remove-quotas:%' BEGIN SELECT RAISE(ABORT,'fixture-audit-failure'); END":"DROP TRIGGER fail_migration");}
   async mutate(){this.ctx.storage.sql.exec("INSERT INTO beta_alerts VALUES('new-alert',2,'new-evidence')");await this.ctx.storage.sync();}
   dump(){return {policy:this.ctx.storage.sql.exec('SELECT * FROM beta_policy').toArray(),slots:this.ctx.storage.sql.exec('SELECT * FROM beta_slots ORDER BY key').toArray(),calls:this.ctx.storage.sql.exec('SELECT * FROM beta_calls ORDER BY key').toArray(),alerts:this.ctx.storage.sql.exec('SELECT * FROM beta_alerts ORDER BY key').toArray(),operations:this.ctx.storage.sql.exec('SELECT * FROM beta_operations ORDER BY id').toArray(),migrations:this.ctx.storage.sql.exec('SELECT * FROM beta_policy_migrations').toArray(),paused:this.ctx.storage.kv.get('beta-paused')};}
  }
  export default {async fetch(r,env){const {method,args,name}=await r.json();try{return Response.json({value:await env.PRIVATE_BETA_CAPACITY.getByName(name??'private-beta-capacity-v1')[method](...args)});}catch(e){return Response.json({error:e.message});}}};
 `,resolveDir:process.cwd(),sourcefile:'quota-test.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},workers:[{config:{type:'worker',name:'quota-test',compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{PRIVATE_BETA_POLICY_JSON:{type:'text',value:JSON.stringify(next)},PRIVATE_BETA_CAPACITY:{type:'durable-object',worker:'quota-test',exportName:'Capacity'}},exports:{Capacity:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{throw Error('unexpected-outbound-request');}}}}]};
 let mf;
 const restart=async policy=>{await mf?.dispose();options.workers[0].config.env.PRIVATE_BETA_POLICY_JSON.value=JSON.stringify(policy);mf=new Miniflare(options);await mf.ready;};
 const rpc=async(method,...args)=>{const result=await(await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({method,args})})).json();if(result.error)throw Error(result.error);return result.value;};
 try{
  await restart(next);
  await assert.rejects(rpc('monitor'),/policy-unpinned/);
  const empty=await rpc('migrationState');
  let input={previousPolicy:previous,expectedPolicySha256:priorDigest,expectedLedgerSha256:empty.ledgerSha256};
  await assert.rejects(rpc('removeQuotas',input),/policy-unpinned/);
  await rpc('seed',priorDigest);const before=await rpc('dump');
  input={...input,expectedLedgerSha256:(await rpc('migrationState')).ledgerSha256};
  assert.equal((await rpc('snapshot')).policyReady,false);
  await assert.rejects(rpc('monitor'),/policy-conflict/);
  for(const bad of [null,{}, {...input,extra:true},{...input,previousPolicy:next},{...input,expectedPolicySha256:'0'.repeat(64)},{...input,expectedLedgerSha256:'0'.repeat(64)}]){
   await assert.rejects(rpc('removeQuotas',bad),/migration-invalid|policy-conflict|state-conflict/);assert.deepEqual(await rpc('dump'),before);
  }
  for(const patch of [{policyId:'replacement'},{startsAt:previous.startsAt-1},{reviewAt:previous.reviewAt+1},{maxActiveTurns:3},{profileSha256:'0'.repeat(64)},{releaseTimeoutMs:previous.releaseTimeoutMs+1},{historicalIsolation:[{tenantId:'new',manifests:[{schemaVersion:1,ledger:'legacy',proofs:[]},{schemaVersion:1,ledger:'g5',proofs:[]}]}]}]){
   await restart({...next,...patch});await assert.rejects(rpc('removeQuotas',input),/policy-conflict/);assert.deepEqual(await rpc('dump'),before);
  }
  await restart(next);await rpc('auditFailure',true);
  await assert.rejects(rpc('removeQuotas',input),/fixture-audit-failure/);
  assert.deepEqual(await rpc('dump'),before);await rpc('auditFailure',false);
  // The snapshot guard refuses evidence that changed after the operator read.
  await rpc('mutate');const updated=await rpc('dump');await assert.rejects(rpc('removeQuotas',input),/state-conflict/);assert.deepEqual(await rpc('dump'),updated);
  input={...input,expectedLedgerSha256:(await rpc('migrationState')).ledgerSha256};
  const migrated=await rpc('removeQuotas',input,{userId:'operator',authVersion:1});assert.equal(migrated.replayed,false);
  const after=await rpc('dump');
  for(const key of ['slots','calls','alerts','paused'])assert.deepEqual(after[key],updated[key],key);
  assert.deepEqual(after.operations.slice(0,-1),updated.operations);assert.equal(after.operations.length,updated.operations.length+1);
  assert.equal(after.migrations.length,1);assert.equal(after.migrations[0].ledger_digest,input.expectedLedgerSha256);
  assert.deepEqual(JSON.parse(after.migrations[0].previous_document),previous);assert.deepEqual(JSON.parse(after.migrations[0].next_document),next);
  assert.equal(after.policy[0].digest,await turnDigest({...next,enabled:false}));
  assert.equal((await rpc('snapshot')).policySchemaVersion,2);assert.equal((await rpc('snapshot')).policyReady,true);assert.equal((await rpc('snapshot')).limits.maxNanodollarsTotal,null);
  await restart(next);assert.equal((await rpc('removeQuotas',input)).replayed,true);assert.deepEqual(await rpc('dump'),after);
  await assert.rejects(rpc('authorizeTurn',{}, {},'old-turn'),/paused/);assert.equal((await rpc('snapshot')).quarantined,1);assert.equal((await rpc('snapshot')).paused,true);
  await restart(previous);await assert.rejects(rpc('monitor'),/policy-conflict/);assert.deepEqual(await rpc('dump'),after);
  const other=await(await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({name:'replacement',method:'migrationState',args:[]})})).json();assert.match(other.error,/actor-denied/);
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
