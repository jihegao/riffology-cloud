import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {betaPolicy} from './private-beta-fixture.ts';
import {turnDigest} from '../../services/turn/protocol.ts';

test('review extension changes only the pinned deadline, atomically preserves ledgers and pause, and rejects unsafe transitions',{timeout:90000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'beta-review-'));
  const original={...await betaPolicy(),startsAt:Date.now()-86400000,reviewAt:Date.now()-1000};
  const extended={...original,reviewAt:Date.now()+86400000};
  const expectedPolicySha256=await turnDigest({...original,enabled:false});
  const input={previousReviewAt:original.reviewAt,expectedPolicySha256};
  const bundle=await build({stdin:{contents:`
    import {PrivateBetaCapacity as Base} from './services/model-budget/private-beta-capacity.ts';
    export class Capacity extends Base {
      async seed(digest){
        this.ctx.storage.sql.exec('INSERT INTO beta_policy VALUES(1,?)',digest);
        this.ctx.storage.sql.exec("INSERT INTO beta_slots VALUES('old-slot','user','{}',1,'old-turn','released')");
        this.ctx.storage.sql.exec("INSERT INTO beta_calls VALUES('observed','old-slot','user','2026-01-01','{}',125,'observed'),('pending','old-slot','user','2026-01-01','{}',375,'billing-pending')");
        this.ctx.storage.sql.exec("INSERT INTO beta_alerts VALUES('old-alert',1,'historical-alert')");
        this.ctx.storage.kv.put('beta-paused',true);await this.ctx.storage.sync();
      }
      async fixtureState(slotStatus,callStatus){
        this.ctx.storage.sql.exec('UPDATE beta_slots SET status=?',slotStatus);
        this.ctx.storage.sql.exec("UPDATE beta_calls SET status=? WHERE key='observed'",callStatus);await this.ctx.storage.sync();
      }
      dump(){return {policy:this.ctx.storage.sql.exec('SELECT * FROM beta_policy').toArray(),slots:this.ctx.storage.sql.exec('SELECT * FROM beta_slots ORDER BY key').toArray(),calls:this.ctx.storage.sql.exec('SELECT * FROM beta_calls ORDER BY key').toArray(),alerts:this.ctx.storage.sql.exec('SELECT * FROM beta_alerts').toArray(),operations:this.ctx.storage.sql.exec('SELECT * FROM beta_operations').toArray(),paused:this.ctx.storage.kv.get('beta-paused')};}
    }
    export default {async fetch(r,env){const {method,args}=await r.json();try{return Response.json({value:await env.PRIVATE_BETA_CAPACITY.getByName('private-beta-capacity-v1')[method](...args)});}catch(e){return Response.json({error:e.message});}}};
  `,resolveDir:process.cwd(),sourcefile:'extension-test.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
  const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},workers:[{config:{type:'worker',name:'extension-test',compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{PRIVATE_BETA_POLICY_JSON:{type:'text',value:JSON.stringify(extended)},PRIVATE_BETA_CAPACITY:{type:'durable-object',worker:'extension-test',exportName:'Capacity'}},exports:{Capacity:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{throw Error('unexpected-outbound-request');}}}}]};
  let mf;
  const restart=async policy=>{await mf?.dispose();options.workers[0].config.env.PRIVATE_BETA_POLICY_JSON.value=JSON.stringify(policy);mf=new Miniflare(options);await mf.ready;};
  const rpc=async(method,...args)=>{const result=await(await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({method,args})})).json();if(result.error)throw Error(result.error);return result.value;};
  const unchangedExceptPinAndAudit=(a,b)=>{for(const key of ['slots','calls','alerts','paused'])assert.deepEqual(a[key],b[key],key);};
  try{
    await restart(extended);
    await assert.rejects(rpc('extendReview',input),/policy-unpinned/);
    await rpc('seed',expectedPolicySha256);
    const before=await rpc('dump');
    const notMigrated=await rpc('snapshot');assert.notEqual(notMigrated.policySha256,notMigrated.pinnedPolicySha256);
    await assert.rejects(rpc('monitor'),/policy-conflict/);
    for(const bad of [null,{}, {...input,extra:true},{...input,previousReviewAt:extended.reviewAt},{...input,expectedPolicySha256:'x'}, {...input,expectedPolicySha256:'0'.repeat(64)}])await assert.rejects(rpc('extendReview',bad),/extension-invalid|policy-conflict/);
    for(const change of [{policyId:'replacement'},{startsAt:original.startsAt-1},{maxNanodollarsTotal:original.maxNanodollarsTotal+1},{maxActiveTurns:original.maxActiveTurns+1}]){
      await restart({...extended,...change});
      await assert.rejects(rpc('extendReview',input),/policy-conflict/);
      assert.deepEqual(await rpc('dump'),before);
    }
    for(const reviewAt of [original.reviewAt-1,Date.now()-1]){
      await restart({...extended,reviewAt});
      await assert.rejects(rpc('extendReview',input),/extension-invalid/);
      assert.deepEqual(await rpc('dump'),before);
    }
    await restart(extended);
    for(const status of ['admitting','active','quarantined']){
      await rpc('fixtureState',status,'observed');const blocked=await rpc('dump');
      await assert.rejects(rpc('extendReview',input),/release-unconfirmed/);
      assert.deepEqual(await rpc('dump'),blocked);
    }
    for(const status of ['reserved','dispatched','unknown']){
      await rpc('fixtureState','released',status);const blocked=await rpc('dump');
      await assert.rejects(rpc('extendReview',input),/release-unconfirmed/);
      assert.deepEqual(await rpc('dump'),blocked);
    }
    await rpc('fixtureState','released','observed');
    const changed=await rpc('extendReview',input,{userId:'operator',authVersion:1});
    assert.equal(changed.replayed,false);assert.equal(changed.reviewAt,extended.reviewAt);
    const after=await rpc('dump');unchangedExceptPinAndAudit(before,after);
    assert.equal(after.policy[0].digest,await turnDigest({...extended,enabled:false}));
    const migrated=await rpc('snapshot');assert.equal(migrated.policySha256,migrated.pinnedPolicySha256);
    assert.equal(after.operations.length,1);assert.match(after.operations[0].action,/^extend-review:/);
    assert.deepEqual(JSON.parse(after.operations[0].actor_json),{userId:'operator',authVersion:1});
    // A lost RPC ACK and restart do not add another audit or reset pause.
    await restart(extended);assert.equal((await rpc('extendReview',input)).replayed,true);
    assert.deepEqual(await rpc('dump'),after);assert.equal((await rpc('snapshot')).paused,true);
    await restart(original);await assert.rejects(rpc('monitor'),/policy-conflict/);
    assert.deepEqual(await rpc('dump'),after);
  }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
