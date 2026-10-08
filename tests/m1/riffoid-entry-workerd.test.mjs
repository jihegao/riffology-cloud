import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {serializeSignedCookie} from 'better-call';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createAuth} from '../../services/gateway/auth.ts';
import {SqliteCatalog} from './sqlite-database.ts';
import {digest} from '../../services/catalog/contracts.ts';
const canonical='https://app.riffoid.com',transport='https://transport.example.test',legacy='https://old.example.test';
const secret='offline-only-workerd-auth-signing-key-000000000000000',capability='offline-only-egress-capability-0000000000000000000000';
const migrations=['0001_catalog.sql','0002_auth.sql','0003_provisioning.sql','0004_operator_invitations.sql','0005_initial_operator.sql','0006_model_catalog.sql','0007_model_content_checks.sql','0010_project_budget_routes.sql','0012_project_archives.sql'];
const text=value=>({type:'text',value});
async function bundle(path){return (await build({stdin:{contents:`import handler from './${path}'; export * from './${path}'; export default {fetch(request,env,ctx){const headers=new Headers(request.headers);headers.set('host',new URL(request.url).host);${path==='services/entry/index.ts'?"headers.set('cf-connecting-ip',headers.get('x-fixture-native-client-ip')||'198.51.100.23');headers.delete('x-fixture-native-client-ip');headers.delete('cf-worker');":''}return handler.fetch(new Request(request,{headers}),env,ctx);}};`,resolveDir:process.cwd(),sourcefile:'local-host-adapter.mjs'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'})).outputFiles[0].text;}
function worker(name,code,env,handler){return new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},workers:[{config:{type:'worker',name,compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env','global_fetch_strictly_public'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:code}}},env,...(env.ENTRY_REPLAY?{exports:{EntryReplayGuard:{type:'durable-object',storage:'sqlite'}}}:{})},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler}}}]});}
// The test-only bundle adapter restores the URL Host removed by the local
// HTTP dispatch bridge. Browser Origin is preserved. Production has no adapter.
const dispatch=(mf,url,init={})=>mf.dispatchFetch(url,init);
const cookies=response=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');

// Two separate local Workerd instances. The entry's fixed public HTTPS fetch is
// routed to the other LOCAL instance by the test harness, never by a production
// service binding. Google token/JWKS are explicit signed fixtures. No network.
test('two local Workerd Workers: actual Gateway auth, canonical PKCE callback, original identity, recovery/CSRF/rate-limit and stream-safe entry',{timeout:60000},async()=>{
  const entryPair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const strict=key=>Object.fromEntries(Object.entries(key).filter(([name])=>['kty','crv','x','y','d'].includes(name)));
  const entryPrivate=JSON.stringify(strict(await crypto.subtle.exportKey('jwk',entryPair.privateKey))),entryPublic=JSON.stringify({'fixture-entry':strict(await crypto.subtle.exportKey('jwk',entryPair.publicKey))});
  const [gatewayCode,entryCode]=await Promise.all([bundle('services/gateway/index.ts'),bundle('services/entry/index.ts')]);
  const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);Object.assign(jwk,{kid:'fixture-key',alg:'RS256',use:'sig'});
  const idToken=await new SignJWT({email:'alice@example.test',email_verified:true,name:'Alice'}).setProtectedHeader({alg:'RS256',kid:'fixture-key'}).setIssuer('https://accounts.google.com').setAudience('offline-client').setSubject('original-google-subject').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  let tokenCalls=0,jwksCalls=0,unknownOutbound=0,hopCalls=0;
  const gatewayWorker=worker('original-gateway',gatewayCode,{CATALOG:{type:'d1',id:'offline-two-account',name:'offline-two-account'},APP_ORIGIN:text(canonical),APP_TRANSPORT_ORIGIN:text(transport),TWO_ACCOUNT_AUTH_MODE:text('signed-entry-v1'),ENTRY_SIGNING_PUBLIC_KEYS_JSON:text(entryPublic),ENTRY_REPLAY:{type:'durable-object',worker:'original-gateway',exportName:'EntryReplayGuard'},LEGACY_RECOVERY_ORIGIN:text(legacy),LEGACY_RECOVERY_UNTIL:text(new Date(Date.now()+3600000).toISOString()),BETTER_AUTH_SECRET:text(secret),GOOGLE_CLIENT_ID:text('offline-client'),GOOGLE_CLIENT_SECRET:text('offline-secret'),M1_GOOGLE_OAUTH_EGRESS_CAPABILITY:text(capability)},async request=>{
    assert.equal(request.headers.get('x-riffology-oauth-egress'),capability);
    if(request.url==='https://oauth2.googleapis.com/token'){
      tokenCalls++;const data=new URLSearchParams(await request.text());assert.equal(data.get('redirect_uri'),canonical+'/api/auth/callback/google');assert.ok(data.get('code_verifier'));assert.equal(data.get('code'),'offline-code');
      return Response.json({access_token:'fixture-access-token',token_type:'Bearer',expires_in:300,id_token:idToken});
    }
    if(request.url==='https://www.googleapis.com/oauth2/v3/certs'){jwksCalls++;return Response.json({keys:[jwk]});}
    unknownOutbound++;return new Response('offline-outbound-denied',{status:403});
  });
  let entryWorker,lastHop;const fixture=new SqliteCatalog();
  try{
    await gatewayWorker.ready;
    entryWorker=worker('new-account-entry',entryCode,{APP_ORIGIN:text(canonical),APP_TRANSPORT_ORIGIN:text(transport),TWO_ACCOUNT_AUTH_MODE:text('signed-entry-v1'),ENTRY_NATIVE_IP_BOUNDARY:text('cloudflare-direct-visitor-waf-v1'),ENTRY_SIGNING_KEY_ID:text('fixture-entry'),ENTRY_SIGNING_PRIVATE_JWK:text(entryPrivate)},async request=>{
      hopCalls++;assert.equal(new URL(request.url).origin,transport);assert.equal(request.headers.get('x-riffology-oauth-egress'),null);assert.equal(request.headers.get('x-forwarded-host'),null);
      const body=['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer();lastHop={url:request.url,method:request.method,headers:new Headers(request.headers),body};
      return dispatch(gatewayWorker,request.url,{method:request.method,headers:request.headers,body,redirect:'manual'});
    });await entryWorker.ready;
    const db=await gatewayWorker.getD1Database('CATALOG','original-gateway');
    for(const filename of migrations){const schema=(await readFile('services/catalog/migrations/'+filename,'utf8')).replace(/--[^\n]*/g,'');for(const statement of schema.match(/\s*CREATE\s+TRIGGER[\s\S]*?\bEND\s*;|[^;]+;/gi)||[])await db.prepare(statement.trim()).run();}
    fixture.sqlite.exec(await readFile('services/catalog/migrations/0002_auth.sql','utf8'));
    const now=Date.now(),invite='a'.repeat(64),inviteHash=await digest(invite);
    fixture.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES('invite',?,'alice@example.test',?,?)`).run(inviteHash,now,now+60000);
    const auth=createAuth({database:fixture.sqlite,catalog:fixture,origin:canonical,secret,googleClientId:'offline-client',googleClientSecret:'offline-secret'}),context=await auth.$context;
    const user=await context.internalAdapter.createUser({name:'Alice',email:'alice@example.test',emailVerified:true},{method:'oauth',oauth:{providerId:'google'}}),session=await context.internalAdapter.createSession(user.id);
    fixture.sqlite.prepare(`INSERT INTO auth_account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES('original-google-account','original-google-subject','google',?,?,?)`).run(user.id,new Date(now).toISOString(),new Date(now).toISOString());
    for(const table of ['auth_user','auth_session','auth_account','catalog_invitations'])for(const row of fixture.sqlite.prepare('SELECT * FROM '+table).all()){const names=Object.keys(row);await db.prepare(`INSERT INTO ${table} (${names.map(name=>'"'+name+'"').join(',')}) VALUES(${names.map(()=>'?').join(',')})`).bind(...Object.values(row)).run();}
    const oldCookie=(await serializeSignedCookie(context.authCookies.sessionToken.name,session.token,secret)).split(';')[0];
    const post=(path,body,headers={})=>dispatch(entryWorker,canonical+path,{method:'POST',headers:{origin:canonical,'content-type':'application/json',...headers},body:JSON.stringify(body),redirect:'manual'});
    const acceptance=await post('/api/invitations/accept',{token:invite},{cookie:oldCookie});assert.equal(acceptance.status,200,JSON.stringify({error:await acceptance.text(),hopCalls}));
    const originalPrincipal=(await (await dispatch(entryWorker,canonical+'/api/me',{headers:{cookie:oldCookie}})).json()).userId;
    const originalRateRows=(await db.prepare('SELECT * FROM auth_rate_limit ORDER BY id').all()).results;
    assert.equal((await dispatch(gatewayWorker,lastHop.url,{method:lastHop.method,headers:lastHop.headers,body:lastHop.body})).status,403,'valid transport proof cannot replay');
    for(const forged of [{'x-riffoid-client-ip':'198.51.100.99','cf-worker':'riffoid.com'},{'x-riffoid-entry-proof':'forged','x-riffoid-entry-signature':'forged','x-forwarded-for':'198.51.100.99'}])assert.equal((await dispatch(gatewayWorker,transport+'/api/me',{headers:{cookie:oldCookie,...forged}})).status,403);
    assert.deepEqual((await db.prepare('SELECT * FROM auth_rate_limit ORDER BY id').all()).results,originalRateRows,'invalid/replayed provenance performs no auth rate writes');
    assert.equal((await dispatch(gatewayWorker,canonical+'/api/me',{headers:{cookie:oldCookie}})).status,403);
    assert.equal((await dispatch(entryWorker,canonical+'/api/me')).status,401);
    assert.equal((await dispatch(gatewayWorker,transport+'/api/me',{headers:{cookie:oldCookie+'bad'}})).status,403);
    const signIn=await post('/api/auth/sign-in/social',{provider:'google',callbackURL:canonical+'/',disableRedirect:true},{'x-forwarded-host':'evil.test'});assert.equal(signIn.status,200);
    const authorization=new URL((await signIn.json()).url);assert.equal(authorization.origin,'https://accounts.google.com');assert.equal(authorization.searchParams.get('redirect_uri'),canonical+'/api/auth/callback/google');assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
    const state=authorization.searchParams.get('state'),stateCookie=cookies(signIn);assert.ok(stateCookie);assert.ok(signIn.headers.getSetCookie().every(cookie=>cookie.includes('Secure')&&cookie.includes('HttpOnly')&&cookie.includes('SameSite=Lax')&&!/;\s*Domain=/i.test(cookie)));
    const callbackPath='/api/auth/callback/google?code=offline-code&state='+encodeURIComponent(state);
    const callback=await dispatch(entryWorker,canonical+callbackPath,{headers:{cookie:stateCookie},redirect:'manual'});assert.equal(callback.status,302);assert.equal(callback.headers.get('location'),canonical+'/');
    const freshCookie=cookies(callback),fresh=(await (await dispatch(entryWorker,canonical+'/api/me',{headers:{cookie:freshCookie}})).json());assert.equal(fresh.userId,originalPrincipal);
    assert.equal((await db.prepare('SELECT count(*) n FROM auth_user').first()).n,1);assert.equal((await db.prepare('SELECT count(*) n FROM catalog_users').first()).n,1);assert.equal(tokenCalls,1);assert.ok(jwksCalls>=1);
    const beforeReplay=tokenCalls;const replay=await dispatch(entryWorker,canonical+callbackPath,{headers:{cookie:stateCookie},redirect:'manual'});assert.equal(replay.status,302);assert.equal(tokenCalls,beforeReplay,'used OAuth state cannot replay token exchange');
    assert.equal((await dispatch(gatewayWorker,legacy+callbackPath,{headers:{cookie:stateCookie},redirect:'manual'})).status,400);
    const priorSession=await db.prepare('SELECT * FROM auth_session WHERE id=?').bind(session.id).first(),rateBefore=(await db.prepare('SELECT * FROM auth_rate_limit ORDER BY id').all()).results;
    await db.prepare(`CREATE TRIGGER forbid_recovery_session_update BEFORE UPDATE ON auth_session BEGIN SELECT RAISE(ABORT,'recovery-must-not-write'); END;`).run();
    await db.prepare(`CREATE TRIGGER forbid_recovery_session_delete BEFORE DELETE ON auth_session BEGIN SELECT RAISE(ABORT,'recovery-must-not-delete'); END;`).run();
    const oldMe=await dispatch(gatewayWorker,legacy+'/api/me',{headers:{cookie:oldCookie}});assert.equal(oldMe.status,200);assert.equal((await oldMe.json()).userId,originalPrincipal);assert.equal(oldMe.headers.getSetCookie().length,0);
    assert.deepEqual(await db.prepare('SELECT * FROM auth_session WHERE id=?').bind(session.id).first(),priorSession);assert.deepEqual((await db.prepare('SELECT * FROM auth_rate_limit ORDER BY id').all()).results,rateBefore);
    await db.prepare('DROP TRIGGER forbid_recovery_session_update').run();await db.prepare('DROP TRIGGER forbid_recovery_session_delete').run();
    for(const path of ['/app.js','/browser-preview-assets/frame.html','/api/workspaces/unknown/events','/api/auth/sign-out'])assert.equal((await dispatch(gatewayWorker,legacy+path)).status,403);
    assert.equal((await dispatch(gatewayWorker,legacy+'/api/auth/sign-out',{method:'POST',headers:{cookie:oldCookie,origin:legacy},body:'{}'})).status,403);
    assert.equal((await post('/api/auth/sign-out',{}, {cookie:freshCookie,origin:legacy})).status,403);
    assert.equal((await dispatch(gatewayWorker,transport+'/api/auth/sign-out',{method:'POST',headers:{origin:legacy,'x-forwarded-host':'app.riffoid.com','content-type':'application/json'},body:'{}'})).status,403);
    assert.equal((await dispatch(entryWorker,canonical+'/',{headers:{upgrade:'websocket'}})).status,403);
    assert.equal((await post('/api/auth/sign-out',{}, {cookie:freshCookie})).status,200);assert.equal((await dispatch(entryWorker,canonical+'/api/me',{headers:{cookie:freshCookie}})).status,401);
    await db.prepare("UPDATE catalog_users SET status='revoked',auth_version=auth_version+1").run();assert.equal((await dispatch(gatewayWorker,legacy+'/api/me',{headers:{cookie:oldCookie}})).status,404);assert.equal((await dispatch(entryWorker,canonical+'/api/me',{headers:{cookie:oldCookie}})).status,404,'valid signed provenance never restores revoked identity');
    // Native-IP fixtures model the already verified platform ingress gate.
    // Spoofed forwarded IPs cannot evade the original limit, and a distinct
    // native visitor retains its own bucket even after the first is exhausted.
    let limited=false;for(let i=0;i<35;i++){const response=await post('/api/auth/sign-out',{}, {'x-fixture-native-client-ip':'198.51.100.201','x-forwarded-for':'10.0.0.'+i});if(response.status===429){limited=true;break;}}assert.ok(limited);
    assert.equal((await post('/api/auth/sign-out',{}, {'x-fixture-native-client-ip':'198.51.100.202','x-riffoid-client-ip':'198.51.100.201','x-forwarded-for':'198.51.100.201'})).status,200);
    const signinStatuses=[];for(let i=0;i<4;i++)signinStatuses.push((await post('/api/auth/sign-in/social',{provider:'google',callbackURL:canonical+'/',disableRedirect:true},{'x-fixture-native-client-ip':'198.51.100.203'})).status);
    assert.deepEqual(signinStatuses,[200,200,200,429]);
    assert.equal((await post('/api/auth/sign-in/social',{provider:'google',callbackURL:canonical+'/',disableRedirect:true},{'x-fixture-native-client-ip':'198.51.100.204'})).status,200);
    assert.equal(unknownOutbound,0);assert.ok(hopCalls>0);
  }finally{fixture.sqlite.close();if(entryWorker)await entryWorker.dispose();await gatewayWorker.dispose();}
});

test('unselected proxy auth mode keeps the actual Gateway application closed before any auth/storage/network work',{timeout:45000},async()=>{
  let outbound=0;const mf=worker('closed-proxy',await bundle('services/gateway/index.ts'),{APP_ORIGIN:text(canonical),APP_TRANSPORT_ORIGIN:text(transport),LEGACY_RECOVERY_ORIGIN:text(legacy),LEGACY_RECOVERY_UNTIL:text('2026-01-01T00:00:00.000Z')},()=>{outbound++;return new Response('offline-denied',{status:403});});
  try{
    await mf.ready;
    for(const [path,method] of [['/','GET'],['/api/auth/sign-in/social','POST'],['/api/auth/callback/google','GET'],['/api/me','GET']]){
      const response=await dispatch(mf,transport+path,{method,headers:method==='POST'?{origin:canonical,'content-type':'application/json'}:{},body:method==='POST'?'{}':undefined});
      assert.equal(response.status,503);assert.equal((await response.json()).error,'two_account_auth_disabled');
    }
    // No auth secrets, Catalog, assets or DO bindings: static recovery must not
    // construct BetterAuth or access storage, including after server expiry.
    for(const path of ['/','/legacy-recovery.js','/legacy-local-runs/','/legacy-local-runs.js','/legacy-local-runs.css'])assert.equal((await dispatch(mf,legacy+path)).status,200,path);
    for(const path of ['/api/me','/api/workspaces/w'])assert.equal((await dispatch(mf,legacy+path)).status,410,path);
    assert.equal(outbound,0);
  }finally{await mf.dispose();}
});
