import test from 'node:test';
import assert from 'node:assert/strict';
import {entry,entryResponse} from '../../services/entry/index.ts';
import {appTopology,publicHttpsOrigin} from '../../services/gateway/origins.ts';
import {publicTransportHeaders} from '../../services/gateway/transport-headers.ts';
const canonical='https://app.riffoid.com',transport='https://transport.example.test',legacy='https://old.example.test';
const env={APP_ORIGIN:canonical,APP_TRANSPORT_ORIGIN:transport,TWO_ACCOUNT_AUTH_MODE:'shared-limited'};

test('entry and Gateway preserve exactly the two untrusted G5 read proof inputs and drop internal authority claims',async()=>{
  const proof={'x-riffology-g5-read-session':'original-session','x-riffology-g5-read-capability':'original-capability'};
  const input={...proof,'x-riffology-user':'forged','x-riffology-g5-authority':'forged','x-riffology-oauth-egress':'forged','cf-connecting-ip':'1.2.3.4','x-forwarded-for':'1.2.3.4'};
  await entry(new Request(canonical+'/api/workspaces/w',{headers:input}),env,async req=>{
    const filtered=publicTransportHeaders(req.headers);
    for(const [name,value] of Object.entries(proof))assert.equal(filtered.get(name),value);
    for(const name of Object.keys(input).filter(name=>!(name in proof)))assert.equal(filtered.get(name),null,name);
    return new Response('{}');
  });
  const filtered=publicTransportHeaders(new Headers(input));
  assert.deepEqual(Object.fromEntries(filtered),proof);
});

test('strict configured topology has an explicit opt-in and reversible single-origin default',()=>{
  assert.deepEqual(appTopology({APP_ORIGIN:legacy}),{canonical:legacy,transport:legacy,proxied:false});
  const config={...env,LEGACY_RECOVERY_ORIGIN:legacy,LEGACY_RECOVERY_UNTIL:'2026-10-15T00:00:00.000Z',BROWSER_PREVIEW_EXECUTION_ORIGIN:'https://execution.example.net'};
  assert.equal(appTopology(config).recovery,legacy);
  for(const value of ['http://app.test','https://app.test/','https://app.test/path','https://user@app.test','https://app.test:443','https://127.0.0.1','https://localhost','https://[::1]'])assert.throws(()=>publicHttpsOrigin(value));
  for(const bad of [{APP_TRANSPORT_ORIGIN:canonical},{LEGACY_RECOVERY_ORIGIN:transport,LEGACY_RECOVERY_UNTIL:config.LEGACY_RECOVERY_UNTIL},{LEGACY_RECOVERY_UNTIL:'2026-10-15'},{BROWSER_PREVIEW_EXECUTION_ORIGIN:'https://execution.riffoid.com'},{BROWSER_PREVIEW_EXECUTION_ORIGIN:'https://execution.example.test'}])assert.throws(()=>appTopology({...config,...bad}));
  assert.throws(()=>appTopology({APP_ORIGIN:canonical,LEGACY_RECOVERY_ORIGIN:legacy}));
});
test('entry keeps genuine canonical Origin, opaque cookie/key/cursor, body and fixed HTTPS target; strips forwarding and capabilities',async()=>{
  let calls=0;
  const req=new Request(canonical+'/api/workspaces/w/sessions/s/turns?limit=2',{method:'POST',headers:{origin:canonical,'content-type':'application/json',cookie:'original=opaque','idempotency-key':'original-key','last-event-id':'12','x-forwarded-host':'evil.test','x-forwarded-for':'1.2.3.4',forwarded:'host=evil.test','x-riffology-oauth-egress':'fake','cf-access-jwt-assertion':'fake',host:'app.riffoid.com'},body:'{"message":"original"}'});
  const response=await entry(req,env,async forwarded=>{
    calls++;assert.equal(forwarded.url,transport+'/api/workspaces/w/sessions/s/turns?limit=2');
    assert.equal(forwarded.headers.get('origin'),canonical);assert.equal(forwarded.headers.get('cookie'),'original=opaque');
    assert.equal(forwarded.headers.get('idempotency-key'),'original-key');assert.equal(forwarded.headers.get('last-event-id'),'12');
    for(const name of ['host','x-forwarded-host','x-forwarded-for','forwarded','x-riffology-oauth-egress','cf-access-jwt-assertion'])assert.equal(forwarded.headers.get(name),null);
    assert.equal(forwarded.redirect,'manual');assert.equal(await forwarded.text(),'{"message":"original"}');return Response.json({accepted:true},{status:202});
  });assert.equal(response.status,202);assert.equal(calls,1);
});
test('entry rejects unknown hosts, spoofed Host, noncanonical writes, cross-site intent, preflight and upgrades without fetch',async()=>{
  let calls=0;const send=async()=>{calls++;return new Response('bad');};
  for(const request of [new Request(transport+'/'),new Request(canonical+'/',{headers:{host:'evil.test'}}),new Request(canonical+'/api/me',{method:'OPTIONS'}),new Request(canonical+'/',{headers:{upgrade:'websocket'}}),new Request(canonical+'/api/auth/sign-out',{method:'POST',headers:{origin:legacy}}),new Request(canonical+'/api/auth/sign-out',{method:'POST',headers:{origin:canonical,'sec-fetch-site':'cross-site'}}),new Request(canonical+'/api/auth/sign-out',{method:'POST'})])assert.ok((await entry(request,env,send)).status>=400);
  assert.equal(calls,0);
});
test('client path cannot replace configured origin; connection failure never retries',async()=>{
  for(const path of ['//evil.test/token','/%2f%2fevil.test','/api/me?next=https://evil.test']){
    let calls=0;assert.equal((await entry(new Request(canonical+path),env,async req=>{calls++;assert.equal(new URL(req.url).origin,transport);throw Error('lost-response');})).status,502);assert.equal(calls,1);
  }
});
test('response accepts host-only canonical auth cookies and fixed Google Location, refuses transport/open redirects and shared-domain cookies',async()=>{
  const req=new Request(canonical+'/api/auth/sign-in/social',{method:'POST'});
  const headers=new Headers();headers.append('set-cookie','__Secure-riffology.session_token=a; Path=/; Secure; HttpOnly; SameSite=Lax');headers.append('set-cookie','__Secure-riffology.oauth_state=b; Path=/; Secure; HttpOnly; SameSite=Lax');
  const response=entryResponse(new Response(null,{status:302,headers:new Headers([...headers,['location',canonical+'/']])}),req,canonical);
  assert.deepEqual(response.headers.getSetCookie(),headers.getSetCookie());
  const google='https://accounts.google.com/o/oauth2/v2/auth?redirect_uri='+encodeURIComponent(canonical+'/api/auth/callback/google');
  assert.equal(entryResponse(new Response(null,{status:302,headers:{location:google}}),req,canonical).status,302);
  for(const location of [transport+'/',legacy+'/', '//evil.test','/\\evil.test','/%0d%0aLocation:evil',google+'&redirect_uri=https://evil.test',google.replace('accounts.google.com','evil.test')])assert.throws(()=>entryResponse(new Response(null,{status:302,headers:{location}}),req,canonical));
  for(const cookie of ['__Secure-riffology.session_token=a; Path=/; Secure; HttpOnly; SameSite=Lax; Domain=riffoid.com','__Secure-riffology.session_token=a; Path=/; Secure; SameSite=Lax','other=a; Path=/; Secure; HttpOnly; SameSite=Lax'])assert.throws(()=>entryResponse(new Response(null,{headers:{'set-cookie':cookie}}),req,canonical));
  assert.throws(()=>entryResponse(new Response(null,{status:302,headers:{location:google}}),new Request(canonical+'/api/me'),canonical));
});
test('entry streams SSE chunks and propagates consumer cancellation without buffering or another fetch',async()=>{
  let cancelled=0,calls=0;const encoder=new TextEncoder();
  const body=new ReadableStream({start(c){c.enqueue(encoder.encode('id: 7\nevent: fixture\ndata: {}\n\n'));},cancel(){cancelled++;}});
  const response=await entry(new Request(canonical+'/api/workspaces/w/events',{headers:{accept:'text/event-stream','last-event-id':'6'}}),env,async req=>{calls++;assert.equal(req.headers.get('last-event-id'),'6');return new Response(body,{headers:{'content-type':'text/event-stream'}});});
  const reader=response.body!.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/id: 7/);await reader.cancel();assert.equal(cancelled,1);assert.equal(calls,1);assert.equal(response.headers.get('cache-control'),'no-store, no-transform');
});

test('proxy authentication defaults closed, requires explicit shared-limited mode and rejects arbitrary trust settings',()=>{
  assert.equal(appTopology({...env,TWO_ACCOUNT_AUTH_MODE:undefined}).authentication,'disabled');
  assert.equal(appTopology({...env,TWO_ACCOUNT_AUTH_MODE:'shared-limited'}).authentication,'shared-limited');
  for(const value of ['true','trusted-forwarded-ip','any',''])assert.throws(()=>appTopology({...env,TWO_ACCOUNT_AUTH_MODE:value}));
  assert.throws(()=>appTopology({APP_ORIGIN:canonical,TWO_ACCOUNT_AUTH_MODE:'shared-limited'}));
});
