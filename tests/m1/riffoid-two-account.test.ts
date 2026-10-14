import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {serializeSignedCookie} from 'better-call';
import {authOptions,createAuth} from '../../services/gateway/auth.ts';
import {gateway} from '../../services/gateway/app.ts';
import {requireOrigin} from '../../services/gateway/http.ts';
import {SqliteCatalog} from './sqlite-database.ts';
import executionWorker from '../../services/browser-preview/execution/index.ts';
import {CANONICAL_APP_ORIGIN as canonical,EXISTING_APP_ORIGIN as legacy,publicHopProbe,canonicalResponseProbe} from '../../scripts/m1/riffoid-public-hop.ts';

test('public hop fixes HTTPS destination and retains browser source and opaque intent',async()=>{
  const request=new Request(canonical+'/api/workspaces/one/turns?opaque=%2F%26',{
    method:'POST',headers:{origin:canonical,'sec-fetch-site':'same-origin','content-type':'application/json',cookie:'fixture=opaque','idempotency-key':'original-intent','x-forwarded-host':'attacker.test','x-riffology-user-id':'forged'},body:'{"message":"fixture only"}',
  });
  const hop=publicHopProbe(request);
  assert.equal(hop.url,legacy+'/api/workspaces/one/turns?opaque=%2F%26');
  assert.equal(hop.headers.get('origin'),canonical);assert.equal(hop.headers.get('sec-fetch-site'),'same-origin');
  assert.equal(hop.headers.get('cookie'),'fixture=opaque');assert.equal(hop.headers.get('idempotency-key'),'original-intent');
  assert.equal(hop.headers.get('x-forwarded-host'),null);assert.equal(hop.headers.get('x-riffology-user-id'),null);
  assert.equal(hop.redirect,'manual');assert.equal(await hop.text(),'{"message":"fixture only"}');
  assert.throws(()=>requireOrigin(hop,legacy),/origin_denied/,'unchanged Gateway cannot accept a canonical write');
});

test('entry aliases, arbitrary Host and forwarded-source claims cannot change destination',()=>{
  for(const origin of ['https://riffoid.com','https://www.riffoid.com','https://app.riffoid.com.attacker.test','https://app.riffoid.com:444',legacy,'http://app.riffoid.com']){
    assert.throws(()=>publicHopProbe(new Request(origin+'/api/me',{headers:{host:'app.riffoid.com','x-forwarded-host':'app.riffoid.com'}})),/entry-origin-denied/);
  }
  assert.throws(()=>publicHopProbe(new Request(canonical+'/api/me',{headers:{host:'attacker.test'}})),/entry-host-denied/);
  assert.equal(new URL(publicHopProbe(new Request(canonical+'//attacker.test/path')).url).origin,legacy);
});

test('cross-site, old-source, absent and null Origin writes are denied before transport',()=>{
  for(const origin of [undefined,'null',legacy,'https://attacker.test']){
    const headers:Record<string,string>={'content-type':'application/json','x-forwarded-host':'app.riffoid.com'};
    if(origin!==undefined)headers.origin=origin;
    assert.throws(()=>publicHopProbe(new Request(canonical+'/api/auth/sign-out',{method:'POST',headers,body:'{}'})),/origin_denied/);
  }
  assert.throws(()=>publicHopProbe(new Request(canonical+'/api/auth/sign-out',{method:'POST',headers:{origin:canonical,'sec-fetch-site':'cross-site'},body:'{}'})),/origin_denied/);
});

test('WebSocket remains closed; a migration cannot turn on M3 preview',()=>{
  assert.throws(()=>publicHopProbe(new Request(canonical+'/api/previews/fixture',{headers:{origin:canonical,upgrade:'websocket'}})),/upgrade-not-prepared/);
  assert.throws(()=>publicHopProbe(new Request(canonical+'/api/me',{method:'OPTIONS'})),/method-not-prepared/);
});

test('host-only cookies remain separate and Location must already be canonical',()=>{
  const headers=new Headers({location:canonical+'/', 'cache-control':'no-store'});
  headers.append('set-cookie','__Secure-riffology.session_token=fixture; Path=/; HttpOnly; Secure; SameSite=Lax');
  headers.append('set-cookie','__Secure-riffology.oauth_state=fixture; Path=/; HttpOnly; Secure; SameSite=Lax');
  const response=new Response(null,{status:302,headers});
  assert.equal(canonicalResponseProbe(response),response);assert.equal(response.headers.getSetCookie().length,2);
  for(const location of [legacy+'/?code=private-fixture&state=private-fixture','//attacker.test/','https://app.riffoid.com.attacker.test/']){
    assert.throws(()=>canonicalResponseProbe(new Response(null,{status:302,headers:{location}})),/noncanonical-location/);
  }
  assert.throws(()=>canonicalResponseProbe(new Response(null,{headers:{'set-cookie':'fixture=x; Domain=riffoid.com; Secure'}})),/cookie-domain-not-prepared/);
});

test('SSE stays incremental and cancellation reaches the original stream without a retry',async()=>{
  let control!:ReadableStreamDefaultController<Uint8Array>,canceled=false;
  const stream=new ReadableStream<Uint8Array>({start(c){control=c;},cancel(){canceled=true;}});
  const response=new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-store, no-transform'}});
  const forwarded=canonicalResponseProbe(response);
  assert.equal(forwarded,response);assert.equal(stream.locked,false);
  const reader=forwarded.body!.getReader();control.enqueue(new TextEncoder().encode('id: 7\ndata: fixture\n\n'));
  assert.match(new TextDecoder().decode((await reader.read()).value),/id: 7/);
  await reader.cancel();assert.equal(canceled,true);
  const hop=publicHopProbe(new Request(canonical+'/api/workspaces/fixture/events?after_sequence=7',{headers:{'last-event-id':'7',accept:'text/event-stream'}}));
  assert.equal(hop.headers.get('last-event-id'),'7');assert.match(hop.url,/after_sequence=7$/);
});

test('actual Browser Execution rejects same-site delivery and keeps the separate execution origin',async()=>{
  for(const executionOrigin of ['https://preview.riffoid.com','https://app.riffoid.com']){
    const response=await executionWorker.fetch(new Request(executionOrigin+'/'),{APP_ORIGIN:canonical,EXECUTION_ORIGIN:executionOrigin,ALLOW_LOCALHOST_HTTP:'false'} as BrowserExecutionEnv);
    assert.equal(response.status,503);assert.equal(await response.text(),'execution delivery unavailable');
  }
  const executionOrigin='https://offline-execution.original-account.workers.dev';
  const env={APP_ORIGIN:canonical,EXECUTION_ORIGIN:executionOrigin,ALLOW_LOCALHOST_HTTP:'false'} as BrowserExecutionEnv;
  assert.equal((await executionWorker.fetch(new Request(executionOrigin+'/'),env)).status,404,'approved isolated site, unknown asset stays closed');
  assert.equal((await executionWorker.fetch(new Request('https://attacker.test/'),env)).status,503);
});

const secret='offline-only-two-account-auth-key-00000000000000000000';
function fixture(){
  const db=new SqliteCatalog();db.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/0002_auth.sql',import.meta.url),'utf8'));
  db.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES ('fixture',?,'migration@example.test',?,?)`).run('a'.repeat(64),Date.now(),Date.now()+60_000);
  const config={database:db.sqlite,catalog:db,origin:canonical,secret,googleClientId:'offline-only',googleClientSecret:'offline-only'};
  return {db,config,auth:createAuth(config)};
}

test('actual BetterAuth keeps fixed canonical baseURL and a single trusted origin',async()=>{
  const f=fixture();try{
    const options=authOptions(f.config),context=await f.auth.$context;
    assert.equal(options.baseURL,canonical);assert.deepEqual(options.trustedOrigins,[canonical]);
    assert.equal(context.baseURL,canonical+'/api/auth');
    assert.equal(options.advanced.cookiePrefix,'riffology');assert.equal(options.advanced.useSecureCookies,true);
    assert.equal(context.authCookies.sessionToken.attributes.domain,undefined);
    assert.equal(context.authCookies.sessionToken.attributes.httpOnly,true);assert.equal(context.authCookies.sessionToken.attributes.sameSite,'lax');
  }finally{f.db.sqlite.close();}
});

test('actual BetterAuth sign-in builds canonical Google callback despite transport URL and forged proxy headers',async()=>{
  const f=fixture();const original=globalThis.fetch;let outbound=0;
  globalThis.fetch=async()=>{outbound++;throw Error('offline-outbound-denied');};
  try{
    const response=await f.auth.handler(new Request(legacy+'/api/auth/sign-in/social',{method:'POST',headers:{origin:canonical,'sec-fetch-site':'same-origin','content-type':'application/json','x-forwarded-host':'attacker.test','x-forwarded-proto':'http'},body:JSON.stringify({provider:'google',callbackURL:canonical+'/'})}));
    assert.equal(response.status,200);const body=await response.json() as {url:string};
    const google=new URL(body.url);assert.equal(google.origin,'https://accounts.google.com');
    assert.equal(google.searchParams.get('redirect_uri'),canonical+'/api/auth/callback/google');
    assert.ok(google.searchParams.get('state'));assert.ok(google.searchParams.get('code_challenge'));
    assert.ok(response.headers.getSetCookie().length);for(const cookie of response.headers.getSetCookie()){assert.match(cookie,/Secure/);assert.doesNotMatch(cookie,/;\s*domain=/i);}
    assert.equal(outbound,0);
    // This deliberately calls the library in isolation. Gateway still rejects
    // this transport URL/canonical combination, as the Workerd test proves.
  }finally{globalThis.fetch=original;f.db.sqlite.close();}
});

test('actual BetterAuth rejects attacker callback URL and legacy-source sign-out',async()=>{
  const f=fixture();try{
    const user=await (await f.auth.$context).internalAdapter.createUser({name:'Fixture',email:'migration@example.test',emailVerified:true},{method:'oauth',oauth:{providerId:'google'}});
    const context=await f.auth.$context,session=await context.internalAdapter.createSession(user.id);
    const cookie=(await serializeSignedCookie(context.authCookies.sessionToken.name,session.token,secret)).split(';')[0];
    const response=await f.auth.handler(new Request(legacy+'/api/auth/sign-out',{method:'POST',headers:{origin:legacy,cookie,'content-type':'application/json'},body:'{}'}));
    assert.equal(response.status,403);
    const callback=await f.auth.handler(new Request(canonical+'/api/auth/sign-in/social',{method:'POST',headers:{origin:canonical,'content-type':'application/json'},body:JSON.stringify({provider:'google',callbackURL:'https://attacker.test/'})}));
    assert.equal(callback.status,403);
  }finally{f.db.sqlite.close();}
});

test('actual Gateway rejects canonical request before identity resolution; transport request also requires source separation',async()=>{
  const f=fixture();let identities=0;
  try{
    const services={origin:legacy,database:f.db,identity:async()=>{identities++;return null;}};
    const direct=await gateway(new Request(canonical+'/api/me'),services);assert.equal(direct.status,403);
    const hop=publicHopProbe(new Request(canonical+'/api/invitations/accept',{method:'POST',headers:{origin:canonical,'content-type':'application/json'},body:'{}'}));
    assert.equal((await gateway(hop,services)).status,403);assert.equal(identities,0);
  }finally{f.db.sqlite.close();}
});

test('actual BetterAuth rejects invalid OAuth state without any provider request',async()=>{
  const f=fixture(),original=globalThis.fetch;let outbound=0;
  globalThis.fetch=async()=>{outbound++;throw Error('offline-outbound-denied');};
  try{
    const signIn=await f.auth.handler(new Request(canonical+'/api/auth/sign-in/social',{method:'POST',headers:{origin:canonical,'content-type':'application/json'},body:JSON.stringify({provider:'google',callbackURL:canonical+'/'})}));
    assert.equal(signIn.status,200);
    const cookie=signIn.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    for(const url of [canonical,legacy]){
      const response=await f.auth.handler(new Request(url+'/api/auth/callback/google?code=offline-invalid-code&state=offline-invalid-state',{headers:{cookie}}));
      assert.equal(response.status,302);assert.equal(new URL(response.headers.get('location')!).origin,canonical);
      assert.match(response.headers.get('location')!,/error=/);
    }
    assert.equal(outbound,0);assert.equal(f.db.sqlite.prepare('SELECT count(*) AS n FROM auth_user').get()!.n,0);
  }finally{globalThis.fetch=original;f.db.sqlite.close();}
});
