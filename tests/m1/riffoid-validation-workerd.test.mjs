import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validationCanonical as canonical,validationTransport as transport} from '../../services/entry/validation-policy.ts';
import {proofHeader,signatureHeader,forwardedHeaders,replayShard,base64url} from '../../services/entry/signature.ts';
const run='offline_workerd_validation_20261009',text=value=>({type:'text',value});
const strict=key=>Object.fromEntries(Object.entries(key).filter(([n])=>['kty','crv','x','y','d'].includes(n)));
async function bundle(contents){return (await build({stdin:{contents,resolveDir:process.cwd(),sourcefile:'validation-test-only.mjs'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'})).outputFiles[0].text;}
function worker(name,code,env,outbound,extra={}){const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},logRequests:false,...extra,workers:[{config:{type:'worker',name,compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env','global_fetch_strictly_public','enable_request_signal'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:code}}},env,...(env.ENTRY_REPLAY?{exports:{EntryReplayGuard:{type:'durable-object',storage:'sqlite'}}}:{})},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:outbound}}}]};const mf=new Miniflare(options);mf.fixtureOptions=options;return mf;}
const gatewaySource=`import handler from './services/gateway/index.ts';export * from './services/gateway/index.ts';export default {fetch(req,env,ctx){const headers=new Headers(req.headers);headers.set('host',new URL(req.url).host);return handler.fetch(new Request(req,{headers}),env,ctx);}};`;
const entrySource=`import handler from './services/entry/index.ts';export default {fetch(req,env,ctx){const headers=new Headers(req.headers);headers.set('host',new URL(req.url).host);headers.set('cf-connecting-ip',headers.get('x-fixture-native-ip')||'198.51.100.23');headers.delete('x-fixture-native-ip');return handler.fetch(new Request(req,{headers}),env,ctx);}};`;

// Fixture native ingress and loopback routing are explicit. This is local
// Workerd/SQLite coverage, never Cloudflare WAF/native-IP/platform acceptance.
test('real-time unused expiry and exact-proof replay through actual entry/Gateway/SQLite, simultaneous duplicate runs cannot sign again',{timeout:55000},async()=>{
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const privateKey=JSON.stringify(strict(await crypto.subtle.exportKey('jwk',pair.privateKey)));
  const publicKeys=JSON.stringify({'fixture-validation':strict(await crypto.subtle.exportKey('jwk',pair.publicKey))});
  const now=Date.now(),config=JSON.stringify({version:1,run,notBefore:now-1000,expires:now+299000,ips:{A:'198.51.100.23',B:'198.51.100.24'}});
  const [gwCode,entryCode]=await Promise.all([bundle(gatewaySource),bundle(entrySource)]);
  let gw,front,unknown=0,outgoing=0,originalA,expiryUnseen=true;
  const proofDigests=new Set();
  const env={APP_ORIGIN:text(canonical),APP_TRANSPORT_ORIGIN:text(transport),TWO_ACCOUNT_AUTH_MODE:text('signed-entry-v1'),RIFFOID_VALIDATION_CONFIG_JSON:text(config)};
  try{
    gw=worker('validation-gateway',gwCode,{...env,ENTRY_SIGNING_PUBLIC_KEYS_JSON:text(publicKeys),ENTRY_REPLAY:{type:'durable-object',worker:'validation-gateway',exportName:'EntryReplayGuard'}},()=>{unknown++;return new Response('offline-denied',{status:403});});await gw.ready;
    front=worker('validation-entry',entryCode,{...env,ENTRY_SIGNING_KEY_ID:text('fixture-validation'),ENTRY_SIGNING_PRIVATE_JWK:text(privateKey)},async request=>{
      outgoing++;assert.equal(new URL(request.url).origin,transport);assert.equal(request.headers.get('cookie'),null);
      const action=request.headers.get('x-riffoid-validation-case'),encoded=request.headers.get(proofHeader);
      const body=await request.arrayBuffer();assert.equal(body.byteLength,0);
      if(encoded){
        const digest=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encoded))));
        if(action==='expired')expiryUnseen=!proofDigests.has(digest);
        proofDigests.add(digest);
        if(new URL(request.url).pathname.includes('/A/')&&action==='primary')originalA={proof:encoded,signature:request.headers.get(signatureHeader),method:request.method,url:request.url,headers:new Headers(request.headers)};
        if(action==='replay'){
          assert.ok(encoded===originalA.proof,'exact proof changed');assert.ok(request.headers.get(signatureHeader)===originalA.signature,'signature changed');
          assert.ok(request.url===originalA.url&&request.method===originalA.method,'signed target changed');
          for(const h of forwardedHeaders)assert.ok(request.headers.get(h)===originalA.headers.get(h),'signed header changed');
        }
      }
      return gw.dispatchFetch(request.url,{method:request.method,headers:request.headers,body,redirect:'manual',signal:request.signal});
    });await front.ready;
    const post=(slot,operation)=>front.dispatchFetch(`${canonical}/__riffoid-validation/${run}/${slot}/${operation}`,{method:'POST',headers:{origin:canonical,'x-fixture-native-ip':slot==='A'?'198.51.100.23':'198.51.100.24'},body:''});
    for(const slot of ['A','B']){const r=await post(slot,'observe');assert.equal(r.status,200);assert.equal((await r.json()).nativeIpMatches,true);}
    const premature=await post('A','run');assert.equal(premature.status,503);assert.deepEqual(await premature.json(),{error:'validation_not_ready'});
    assert.equal(outgoing,2,'premature Run after observation must not consume begin or sign');
    // Fixture-only update of the existing entry runtime, same run/config/key.
    front.fixtureOptions.workers[0].config.env.ENTRY_NATIVE_IP_BOUNDARY=text('cloudflare-direct-visitor-waf-v1');
    await front.setOptions(front.fixtureOptions);
    const competing=Array.from({length:6},()=>post('A','run'));
    const b=await post('B','run');const summaryB=await b.json();assert.equal(b.status,200,JSON.stringify(summaryB));assert.equal(summaryB.results.at(-1).ipMatches,true);
    const responses=await Promise.all(competing),successes=responses.filter(r=>r.status===200);
    assert.equal(successes.length,1,'global begin permits one actual A run across concurrent invocations');
    assert.ok(responses.filter(r=>r.status!==200).every(r=>r.status===503));
    const summaryA=await successes[0].json();assert.deepEqual(summaryA.results.map(v=>[v.case,v.status,v.code]),[['begin',200,'accepted'],['primary',200,'accepted'],['replay',403,'entry_replay_denied'],['expired',403,'entry_proof_denied']]);
    assert.equal(summaryA.sameSignedInputsReplay,true);assert.equal(summaryA.realUnusedProofExpiry,true);assert.equal(expiryUnseen,true);
    assert.equal(proofDigests.size,3);assert.equal(outgoing,13,'normal 8 protocol calls plus 5 denied duplicate control lookups, not falsely capped HTTP ingress');
    for(const summary of [summaryA,summaryB])assert.ok(!/x-riffoid-entry|198\.51\.100|"nonce"|"signature"|"cookie"|"token"/i.test(JSON.stringify(summary)));
    for(const path of ['/','/api/me','/api/auth/sign-in/social']){
      assert.equal((await front.dispatchFetch(canonical+path)).status,503);
      assert.equal((await gw.dispatchFetch(transport+path)).status,503);
    }
    assert.equal(unknown,0,'Gateway has no provider/business/network calls');
  }finally{if(front)await front.dispose();if(gw)await gw.dispose();}
});

test('budget SQL atomicity/restart, scope/expiry, cleanup tombstone, schema privacy and original replay coexistence',{timeout:30000},async()=>{
  const now=Date.now(),c={version:1,run,notBefore:now-1000,expires:now+119000,ips:{A:'198.51.100.23',B:'198.51.100.24'}};
  const code=await bundle(`import {EntryReplayGuard as Original} from './services/entry/replay.ts';import {VALIDATION_ACTOR} from './services/entry/validation-policy.ts';
    let clock=${now};Date.now=()=>clock;
    export class EntryReplayGuard extends Original {snapshot(){const sql=this.ctx.storage.sql;return {columns:sql.exec('PRAGMA table_info(riffoid_validation_budget_v1)').toArray().map(v=>v.name),rows:sql.exec('SELECT run_id,slot,mask,expires FROM riffoid_validation_budget_v1 ORDER BY slot').toArray()};}}
    export default {async fetch(req,env){const v=await req.json();if(v.clock!==undefined)clock=v.clock;const a=env.ENTRY_REPLAY.getByName(v.shard||VALIDATION_ACTOR);try{if(v.method==='snapshot')return Response.json(await a.snapshot());if(v.method==='claim')return Response.json(await a.claim(v.value));if(v.method==='cleanup')return Response.json(await a.validationCleanup(v.run));return Response.json(await a.validationTake(v.value));}catch{return new Response('denied',{status:503});}}};`);
  const directory=await mkdtemp(join(tmpdir(),'riffoid-validation-budget-'));let mf,outgoing=0;
  const make=()=>worker('budget-test',code,{RIFFOID_VALIDATION_CONFIG_JSON:text(JSON.stringify(c)),ENTRY_REPLAY:{type:'durable-object',worker:'budget-test',exportName:'EntryReplayGuard'}},()=>{outgoing++;return new Response('offline-denied',{status:403});},{resourcePersistencePath:directory});
  const post=v=>mf.dispatchFetch('https://fixture.example.test/',{method:'POST',body:JSON.stringify(v)});
  const take=(slot,action,extra={})=>post({value:{run,slot,action},...extra});
  try{
    mf=make();await mf.ready;
    assert.equal(await (await take('A','begin')).json(),'spent');
    assert.equal(await (await take('A','observe')).json(),'accepted');
    const many=await Promise.all(Array.from({length:24},async()=> (await take('A','begin')).json()));
    assert.equal(many.filter(x=>x==='accepted').length,1);assert.equal(many.filter(x=>x==='spent').length,23);
    await mf.dispose();mf=make();await mf.ready;
    assert.equal(await (await take('A','begin')).json(),'spent','lease persists across isolate restart');
    assert.equal(await (await take('A','primary')).json(),'accepted');assert.equal(await (await take('A','replay')).json(),'accepted');assert.equal(await (await take('A','expired')).json(),'accepted');
    assert.equal((await take('B','expired')).status,503);assert.equal((await take('A','observe',{shard:'riffoid-entry-replay-v1:1'})).status,503);
    assert.equal((await post({value:{run:run+'x',slot:'A',action:'observe'}})).status,503);
    assert.equal(await (await take('B','observe')).json(),'accepted');
    const snapshot=await (await post({method:'snapshot'})).json();assert.deepEqual(snapshot.columns,['run_id','slot','mask','expires']);assert.equal(snapshot.rows.length,2);
    assert.equal((await post({method:'cleanup',run})).status,503,'cannot erase live gate');
    const nonce=base64url(crypto.getRandomValues(new Uint8Array(32)));
    const claim={method:'claim',shard:replayShard(nonce),value:{nonce,issued:now,expires:now+30000}};
    assert.equal(await (await post(claim)).json(),'accepted');assert.equal(await (await post(claim)).json(),'replay');
    assert.equal((await take('B','begin',{clock:c.expires})).status,503);
    assert.equal(await (await post({method:'cleanup',run,clock:c.expires})).json(),2);
    assert.equal((await post({method:'cleanup',run,clock:c.expires+1})).status,503,'unknown cleanup cannot reopen/delete its tombstone');
    const closed=await (await post({method:'snapshot'})).json();assert.equal(closed.rows.length,1);assert.equal(closed.rows[0].slot,'closed');
    assert.equal((await post({method:'cleanup',run,clock:c.expires+30000})).status,503);
    assert.equal(outgoing,0);
  }finally{if(mf)await mf.dispose();await rm(directory,{recursive:true,force:true});}
});
