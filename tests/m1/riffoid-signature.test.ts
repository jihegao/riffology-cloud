import test from 'node:test';
import assert from 'node:assert/strict';
import {entry} from '../../services/entry/index.ts';
import {authOptions} from '../../services/gateway/auth.ts';
import {base64url,clientIp,forwardedHeaders,proofHeader,signatureHeader,clientIpHeader,verifyEntry,signEntry,signedBody,signedRequestCapacity,validTime,replayShard,type ReplayClaim} from '../../services/entry/signature.ts';
const canonical='https://app.riffoid.com',transport='https://transport.example.test';
async function keys(kid='fixture-a'){
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const privateKey=await crypto.subtle.exportKey('jwk',pair.privateKey),publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey);
  const strict=(key:JsonWebKey,privateValue=false)=>Object.fromEntries(['kty','crv','x','y',...(privateValue?['d']:[])].map(name=>[name,key[name as keyof JsonWebKey]]));
  return {env:{APP_ORIGIN:canonical,APP_TRANSPORT_ORIGIN:transport,TWO_ACCOUNT_AUTH_MODE:'signed-entry-v1',ENTRY_NATIVE_IP_BOUNDARY:'cloudflare-direct-visitor-waf-v1',ENTRY_SIGNING_KEY_ID:kid,ENTRY_SIGNING_PRIVATE_JWK:JSON.stringify(strict(privateKey,true))},ring:{[kid]:strict(publicKey)}};
}
function replay(){const nonces=new Set<string>();let calls=0;return {nonces,get calls(){return calls;},getByName(name:string){return {async claim(v:ReplayClaim){calls++;assert.equal(name,replayShard(v.nonce));if(nonces.has(v.nonce))return 'replay' as const;nonces.add(v.nonce);return 'accepted' as const;}};}};}
async function signed(k:Awaited<ReturnType<typeof keys>>,init:RequestInit={},path='/api/me'){
  let result:Request|undefined;
  const headers=new Headers({'cf-connecting-ip':'198.51.100.23',origin:canonical,...Object.fromEntries(new Headers(init.headers))});
  const response=await entry(new Request(canonical+path,{...init,headers}),k.env,async req=>{result=req;return new Response('ok');});
  assert.equal(response.status,200,await response.text());assert.ok(result);return result;
}
const verifier=(k:Awaited<ReturnType<typeof keys>>,store=replay())=>({ENTRY_SIGNING_PUBLIC_KEYS_JSON:JSON.stringify(k.ring),ENTRY_REPLAY:store});
async function denied(request:Request,env:ReturnType<typeof verifier>){await assert.rejects(()=>verifyEntry(request,canonical,transport,env));}
function altered(req:Request,headers:Headers,url=req.url,body?:string):Request {return new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:body??'{}'});}

test('signed entry defaults closed, missing config/IP/source gate fails without an upstream call',async()=>{
  const k=await keys();let calls=0;const send=async()=>{calls++;return new Response('bad');};
  for(const override of [{TWO_ACCOUNT_AUTH_MODE:undefined},{ENTRY_SIGNING_PRIVATE_JWK:undefined},{ENTRY_NATIVE_IP_BOUNDARY:undefined}])assert.equal((await entry(new Request(canonical+'/'),{...k.env,...override},send)).status,503);
  for(const headers of ([{},{'cf-connecting-ip':'forged'},{'cf-connecting-ip':'198.51.100.23','cf-worker':'riffoid.com'},{'cf-connecting-ip':'198.51.100.23, 203.0.113.7'}] as Record<string,string>[]))assert.equal((await entry(new Request(canonical+'/',{headers}),k.env,send)).status,403);
  assert.equal(calls,0);
});
test('exact body, raw path/query ordering and all allowed semantics survive verified transport; supplied IP is overwritten',async()=>{
  const k=await keys(),store=replay();const bytes='{"message":"original","unicode":"火"}';
  const req=await signed(k,{method:'POST',body:bytes,headers:{'content-type':'application/json',cookie:'original=opaque','idempotency-key':'original-key','last-event-id':'12','x-riffology-g5-read-session':'session','x-riffology-g5-read-capability':'cap','x-riffoid-client-ip':'6.6.6.6','x-forwarded-for':'7.7.7.7'}},'/api/w?x=%2F&x=1&empty=');
  const headers=new Headers(req.headers);headers.set(clientIpHeader,'8.8.8.8');headers.set('authorization','untrusted');
  const verified=await verifyEntry(altered(req,headers,req.url,bytes),canonical,transport,verifier(k,store));
  assert.equal(await verified.text(),bytes);assert.equal(verified.url,transport+'/api/w?x=%2F&x=1&empty=');assert.equal(verified.headers.get(clientIpHeader),'198.51.100.23');
  for(const h of [proofHeader,signatureHeader,'authorization','x-forwarded-for'])assert.equal(verified.headers.get(h),null,h);
  assert.equal(verified.headers.get('cookie'),'original=opaque');assert.equal(verified.headers.get('x-riffology-g5-read-capability'),'cap');assert.equal(store.calls,1);
});
test('original raw URI retains a bare query marker, duplicate order and percent spelling',async()=>{
  const k=await keys();
  for(const path of ['/api/me?','/api/me?x=%2f&x=%2F&empty=','//api/me?x=1']){
    const req=await signed(k,{},path);assert.equal(req.url,transport+path);
    const proof=JSON.parse(Buffer.from(req.headers.get(proofHeader)!,'base64url').toString());assert.equal(proof[5],path);
    await verifyEntry(req,canonical,transport,verifier(k));
  }
  await assert.rejects(()=>signEntry(new Request(transport+'/api/other'),new Request(canonical+'/api/me',{headers:{'cf-connecting-ip':'198.51.100.23'}}),canonical,k.env),{message:'entry_source_denied'});
});
test('tampering every signed field, cross host/path/query/method and duplicate proof headers fails before replay store',async()=>{
  const k=await keys(),req=await signed(k),store=replay(),env=verifier(k,store);
  const encoded=req.headers.get(proofHeader)!;const original=JSON.parse(Buffer.from(encoded,'base64url').toString());
  for(let field=0;field<12;field++){
    const changed=original.slice();changed[field]=typeof changed[field]==='number'?changed[field]+1:changed[field]+'x';
    const h=new Headers(req.headers);h.set(proofHeader,base64url(new TextEncoder().encode(JSON.stringify(changed))));await denied(altered(req,h),env);
  }
  for(const url of ['https://evil.example.test/api/me',transport+'/api/other',transport+'/api/me?x=1'])await denied(altered(req,new Headers(req.headers),url),env);
  await denied(new Request(req.url,{method:'DELETE',headers:req.headers}),env);
  for(const [name,value] of [[proofHeader,encoded+','+encoded],[signatureHeader,req.headers.get(signatureHeader)!+',bad'],['host','evil.example.test']]){const h=new Headers(req.headers);h.set(name,value);await denied(altered(req,h),env);}
  assert.equal(store.calls,0);
});
test('every forwarded header is bound, including cookie/origin/CSRF/G5/range/cursor; unknown claims are stripped',async()=>{
  const k=await keys(),req=await signed(k),store=replay();
  for(const name of forwardedHeaders){const h=new Headers(req.headers);h.set(name,'mutated');await denied(altered(req,h),verifier(k,store));}
  assert.equal(store.calls,0);
});
test('oversized signed URL and headers reject before fetch; response loss never retries a signed write',async()=>{
  const k=await keys();let calls=0;const send=async()=>{calls++;throw Error('lost-response');};
  const headers={'cf-connecting-ip':'198.51.100.23',origin:canonical};
  assert.equal((await entry(new Request(canonical+'/api/me?data='+'x'.repeat(2000),{headers}),k.env,send)).status,414);
  assert.equal((await entry(new Request(canonical+'/api/me',{headers:{...headers,cookie:'x'.repeat(16384)}}),k.env,send)).status,431);assert.equal(calls,0);
  assert.equal((await entry(new Request(canonical+'/api/w',{method:'POST',headers:{...headers,'content-type':'application/json','idempotency-key':'original-key'},body:'{}'}),k.env,send)).status,502);assert.equal(calls,1);
});
test('a same-zone or outside Worker without the entry private key cannot forge IP or sign with a peer key',async()=>{
  const entryKey=await keys(),peer=await keys('fixture-peer'),peerReq=await signed(peer);
  await denied(peerReq,verifier(entryKey));
  const req=await signed(entryKey),p=JSON.parse(Buffer.from(req.headers.get(proofHeader)!,'base64url').toString());p[9]='203.0.113.9';const h=new Headers(req.headers);h.set(proofHeader,base64url(new TextEncoder().encode(JSON.stringify(p))));await denied(altered(req,h),verifier(entryKey));
});
test('one nonce is accepted once under concurrent verification; replay storage fault/full fails closed',async()=>{
  const k=await keys(),req=await signed(k),store=replay();
  const results=await Promise.allSettled(Array.from({length:12},()=>verifyEntry(altered(req,new Headers(req.headers)),canonical,transport,verifier(k,store))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(store.nonces.size,1);
  for(const behavior of ['throw','full']){const fresh=await signed(k);await assert.rejects(()=>verifyEntry(fresh,canonical,transport,{ENTRY_SIGNING_PUBLIC_KEYS_JSON:JSON.stringify(k.ring),ENTRY_REPLAY:{getByName(){return {async claim(){if(behavior==='throw')throw Error('store unavailable');return 'full';}};}}}),{message:'entry_replay_unavailable'});}
});
test('body mutation burns nonce without auth; length/compression/stream ambiguity is rejected',async()=>{
  const k=await keys(),req=await signed(k,{method:'POST',body:'{}','headers':{'content-type':'application/json'}}),store=replay();
  await denied(altered(req,new Headers(req.headers),req.url,'{"changed":true}'),verifier(k,store));assert.equal(store.nonces.size,1);
  await denied(altered(req,new Headers(req.headers)),verifier(k,store));
  for(const headers of ([{'content-length':'3'},{'content-length':'2, 2'},{'content-length':'02'},{'content-encoding':'gzip'},{'transfer-encoding':'chunked','content-length':'2'},{'transfer-encoding':'gzip, chunked'}] as Record<string,string>[]))await assert.rejects(()=>signedBody(new Request(transport+'/api/w',{method:'POST',headers,body:'{}'})));
  await assert.rejects(()=>signedBody(new Request(transport+'/api/w',{method:'POST',body:'x'.repeat(32769)})),{message:'body_too_large'});
});
test('request cancellation terminates a stalled stream without send, replay or automatic retry',async()=>{
  const abort=new AbortController();let cancelled=0;const stream=new ReadableStream<Uint8Array>({cancel(){cancelled++;}});
  const req=new Request(transport+'/api/w',{method:'POST',body:stream,signal:abort.signal,duplex:'half'} as RequestInit);const pending=signedBody(req);abort.abort();await assert.rejects(()=>pending,{message:'request_cancelled'});assert.equal(cancelled,1);
});
test('short lifetime and future skew are exact; revoked/public-key ring changes take effect each request',async()=>{
  const now=Date.now();assert.ok(validTime(now+5000,now+35000,now));
  for(const [issued,expires] of [[now+5001,now+35001],[now-30000,now],[now,now+30001],[NaN,now+30000]])assert.equal(validTime(issued,expires,now),false);
  const a=await keys(),b=await keys('fixture-b'),req=await signed(a);const both={ENTRY_SIGNING_PUBLIC_KEYS_JSON:JSON.stringify({...a.ring,...b.ring}),ENTRY_REPLAY:replay()};
  await verifyEntry(req,canonical,transport,both);await verifyEntry(await signed(b),canonical,transport,both);
  await denied(await signed(a),verifier(b));
  await assert.rejects(()=>verifyEntry(awaitRequest(),canonical,transport,{ENTRY_SIGNING_PUBLIC_KEYS_JSON:'{}',ENTRY_REPLAY:replay()}));
  function awaitRequest(){return new Request(transport+'/api/me');}
});
test('valid cryptographic signatures still fail with expired/future timestamps, no replay store mutation',async()=>{
  const k=await keys(),store=replay();
  for(const delta of [-31000,6000]){
    const native=new Request(canonical+'/api/me',{headers:{'cf-connecting-ip':'198.51.100.23'}});
    const req=await signEntry(new Request(transport+'/api/me'),native,canonical,k.env,Date.now()+delta);
    await denied(req,verifier(k,store));
  }assert.equal(store.calls,0);
});
test('unresolved replay RPC times out and pre-claim cancellation fails closed (does not prove late persistence)',async()=>{
  const k=await keys(),req=await signed(k);let claims=0;
  const store={getByName(){return {claim(){claims++;return new Promise<'accepted'>(()=>{});}};}};
  await assert.rejects(()=>verifyEntry(req,canonical,transport,{ENTRY_SIGNING_PUBLIC_KEYS_JSON:JSON.stringify(k.ring),ENTRY_REPLAY:store}),{message:'entry_replay_unavailable'});assert.equal(claims,1);
  const abort=new AbortController(),fresh=await signed(k);const pending=verifyEntry(new Request(fresh,{signal:abort.signal}),canonical,transport,{ENTRY_SIGNING_PUBLIC_KEYS_JSON:JSON.stringify(k.ring),ENTRY_REPLAY:store});abort.abort();await assert.rejects(()=>pending);assert.equal(claims,1);
});
test('simulated store: RPC already issued may persist after timeout/cancellation; same proof replay denied, no auth or retry',{timeout:10000},async()=>{
  const k=await keys();
  for(const failure of ['timeout','cancel']){
    let resolveIssued!:()=>void,release!:()=>void,resolvePersisted!:()=>void;
    const issued=new Promise<void>(resolve=>{resolveIssued=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;}),persisted=new Promise<void>(resolve=>{resolvePersisted=resolve;});
    const nonces=new Set<string>();let claims=0,auth=0;
    const store={getByName(){return {async claim(v:ReplayClaim){claims++;if(nonces.has(v.nonce))return 'replay' as const;resolveIssued();await hold;nonces.add(v.nonce);resolvePersisted();return 'accepted' as const;}};}};
    const req=await signed(k),abort=new AbortController(),env={ENTRY_SIGNING_PUBLIC_KEYS_JSON:JSON.stringify(k.ring),ENTRY_REPLAY:store};
    const admission=verifyEntry(new Request(req,{signal:abort.signal}),canonical,transport,env).then(()=>{auth++;});
    await issued;if(failure==='cancel')abort.abort();
    await assert.rejects(()=>admission,{message:'entry_replay_unavailable'});assert.equal(claims,1);assert.equal(auth,0);assert.equal(nonces.size,0);
    release();await persisted;assert.equal(nonces.size,1);assert.equal(claims,1,'late completion does not issue another RPC');assert.equal(auth,0);
    await assert.rejects(()=>verifyEntry(new Request(req),canonical,transport,env).then(()=>{auth++;}),{message:'entry_replay_denied'});assert.equal(claims,2,'second RPC is the explicit replay test only');assert.equal(auth,0);
  }
});
test('bounded uploads preserve8MiB only on the original model route, and concurrent allocations reject without queue',async()=>{
  const url=transport+'/api/admin/models/model-a/content',body='x'.repeat(8*1024*1024);
  assert.equal((await signedBody(new Request(url,{method:'POST',body}))).length,body.length);
  await assert.rejects(()=>signedBody(new Request(url,{method:'POST',headers:{'content-length':String(body.length+1)},body})),{message:'body_too_large'});
  await assert.rejects(()=>signedBody(new Request(transport+'/api/other',{method:'POST',body})),{message:'body_too_large'});
  assert.equal((await signedBody(new Request(transport+'/api/w',{method:'POST',headers:{'transfer-encoding':'chunked'},body:'decoded bytes'}))).length,13);
  const request=new Request(url,{method:'POST',body:'{}'}),release=signedRequestCapacity(request);
  assert.throws(()=>signedRequestCapacity(new Request(url,{method:'POST',body:'{}'})),{message:'entry_body_capacity'});release();release();signedRequestCapacity(request)();
});
test('IP parsing has no header/list/port/zone-id ambiguity; native IPv6 is canonicalized',()=>{
  assert.equal(clientIp('2001:0DB8::1'),'2001:db8::1');assert.equal(clientIp('::ffff:192.0.2.1'),'::ffff:c000:201');
  for(const bad of [null,'','01.2.3.4','256.1.2.3','1.2.3.4:80','1.2.3.4, 2.3.4.5','[::1]','fe80::1%en0','0x7f000001'])assert.throws(()=>clientIp(bad));
});
test('auth uses only verified IP header, original endpoint limits and canonical trusted origin',()=>{
  const options=authOptions({database:{} as never,catalog:{} as never,origin:canonical,secret:'fixture-secret-not-real-000000000000000000',googleClientId:'fixture',googleClientSecret:'fixture',sharedTransportRateLimit:true,verifiedEntryIp:true});
  assert.deepEqual(options.advanced.ipAddress?.ipAddressHeaders,[clientIpHeader]);assert.deepEqual(options.trustedOrigins,[canonical]);assert.deepEqual(options.rateLimit,{enabled:true,storage:'database',modelName:'auth_rate_limit',window:60,max:30});
});
test('signed SSE body is never buffered; response cancel is propagated with one fetch',async()=>{
  const k=await keys(),store=replay();let calls=0,cancelled=0;
  const response=await entry(new Request(canonical+'/api/events',{headers:{'cf-connecting-ip':'198.51.100.23',accept:'text/event-stream','last-event-id':'12'}}),k.env,async req=>{
    calls++;await verifyEntry(req,canonical,transport,verifier(k,store));return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('id: 13\ndata: {}\n\n'));},cancel(){cancelled++;}}),{headers:{'content-type':'text/event-stream'}});
  });const reader=response.body!.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/id: 13/);await reader.cancel();assert.equal(calls,1);assert.equal(cancelled,1);
});
