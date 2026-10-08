import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {base64url,replayShard} from '../../services/entry/signature.ts';
const nonce=()=>base64url(crypto.getRandomValues(new Uint8Array(32)));

test('actual replay DO: atomic concurrency, durable restart, shard/scope/clock guard, bounded capacity/cleanup, SQL fault',{timeout:45000},async()=>{
  const code=(await build({stdin:{contents:`import {EntryReplayGuard} from './services/entry/replay.ts';import {replayShard} from './services/entry/signature.ts';
    let clock=Date.now();Date.now=()=>clock;
    export class FixtureGuard extends EntryReplayGuard {
      count(){return this.ctx.storage.sql.exec('SELECT count(*) n FROM entry_replay_v1').one().n;}
      fill(){this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS entry_replay_v1(nonce TEXT PRIMARY KEY,expires INTEGER NOT NULL)');for(let i=0;i<4096;i++)this.ctx.storage.sql.exec('INSERT OR IGNORE INTO entry_replay_v1 VALUES(?,?)','fixture-'+i,Date.now()+35000);}
      breakWrites(){this.ctx.storage.sql.exec("CREATE TRIGGER reject_nonce BEFORE INSERT ON entry_replay_v1 BEGIN SELECT RAISE(ABORT,'fixture write fault'); END");}
    }
    export default {async fetch(req,env){const v=await req.json();if(v.clock!==undefined)clock=v.clock;const actor=env.ENTRY_REPLAY.getByName(v.shard||replayShard(v.nonce));try{if(v.action==='fill'){await actor.fill();return Response.json({});}if(v.action==='fault'){await actor.breakWrites();return Response.json({});}if(v.action==='count')return Response.json(await actor.count());return Response.json(await actor.claim({nonce:v.nonce,issued:v.issued,expires:v.expires}));}catch{return new Response('denied',{status:503});}}};`,resolveDir:process.cwd(),sourcefile:'replay-test-only.mjs'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'})).outputFiles[0].text;
  const directory=await mkdtemp(join(tmpdir(),'riffoid-replay-fixture-'));let mf,outbound=0;
  const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:'replay-fixture',compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:code}}},env:{ENTRY_REPLAY:{type:'durable-object',worker:'replay-fixture',exportName:'FixtureGuard'}},exports:{FixtureGuard:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{outbound++;return new Response('offline-denied',{status:403});}}}}]};
  const post=v=>mf.dispatchFetch('https://fixture.example.test/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v)});
  const now=Date.now(),n=nonce(),claim={nonce:n,issued:now,expires:now+30000,clock:now};
  try{
    mf=new Miniflare(options);await mf.ready;
    const results=await Promise.all(Array.from({length:24},async()=>{const response=await post(claim);assert.equal(response.status,200);return response.json();}));
    assert.equal(results.filter(v=>v==='accepted').length,1);assert.equal(results.filter(v=>v==='replay').length,23);assert.equal(await (await post({...claim,action:'count'})).json(),1);
    await mf.dispose();mf=new Miniflare(options);await mf.ready;
    assert.equal(await (await post(claim)).json(),'replay','nonce persists across process/actor restart');
    for(const bad of [{issued:now-30000,expires:now},{issued:now+5001,expires:now+35001},{expires:now+30001},{shard:replayShard(n)==='riffoid-entry-replay-v1:0'?'riffoid-entry-replay-v1:1':'riffoid-entry-replay-v1:0'}])assert.equal((await post({...claim,...bad})).status,503);
    let capacityNonce;do{capacityNonce=nonce();}while(replayShard(capacityNonce)===replayShard(n));
    const full={...claim,nonce:capacityNonce};await post({...full,action:'fill'});assert.equal(await (await post(full)).json(),'full');assert.equal(await (await post({...full,action:'count'})).json(),4096);
    const later={...full,clock:now+36000,issued:now+36000,expires:now+66000};assert.equal(await (await post(later)).json(),'accepted');assert.equal(await (await post({...later,action:'count'})).json(),4033,'cleanup deletes at most64 expired rows then inserts one');
    await post({...later,action:'fault'});let failed;do{failed=nonce();}while(replayShard(failed)!==replayShard(capacityNonce));assert.equal((await post({...later,nonce:failed})).status,503);assert.equal(await (await post({...later,action:'count'})).json(),4033,'failed transaction rolls cleanup and insert back');
    assert.equal(outbound,0);
  }finally{if(mf)await mf.dispose();await rm(directory,{recursive:true,force:true});}
});
