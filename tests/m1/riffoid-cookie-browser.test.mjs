import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {serializeSignedCookie} from 'better-call';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createAuth} from '../../services/gateway/auth.ts';
import {sessionIdentity} from '../../services/gateway/session-identity.ts';
import {entry} from '../../services/entry/index.ts';
import {gateway} from '../../services/gateway/app.ts';
import {legacyRecovery} from '../../services/gateway/recovery.ts';
import {Admission} from '../../services/catalog/admission.ts';
import {digest} from '../../services/catalog/contracts.ts';
import {SqliteCatalog} from './sqlite-database.ts';
const canonical='https://app.riffoid.com',legacy='https://old.example.test',transport='https://transport.example.test';

// Fresh disposable browser, fully intercepted requests, real auth library with
// a signed synthetic Google provider. The HTML document is a driver fixture.
test('fresh offline Chromium: canonical Google state/session cookies remain host-only, legacy cookie stays isolated and signout revokes only new session',{timeout:45000},async()=>{
  const db=new SqliteCatalog(),originalFetch=globalThis.fetch,secret='offline-only-browser-auth-signing-key-000000000000000';let browser,tokenCalls=0,unexpectedNetwork=0;
  try{
    db.sqlite.exec(await readFile('services/catalog/migrations/0002_auth.sql','utf8'));const now=Date.now(),invite='f'.repeat(64);
    db.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES ('browser-invite',?,'alice@example.test',?,?)`).run(await digest(invite),now,now+60000);
    const config={database:db.sqlite,catalog:db,origin:canonical,secret,googleClientId:'offline-browser-client',googleClientSecret:'offline-only',googleOAuthEgress:{capability:'offline-only-browser-capability-0000000000000000'},sharedTransportRateLimit:true};
    const auth=createAuth(config),readonly=createAuth({...config,readOnlySession:true}),context=await auth.$context,user=await context.internalAdapter.createUser({name:'Alice',email:'alice@example.test',emailVerified:true},{method:'oauth',oauth:{providerId:'google'}}),oldSession=await context.internalAdapter.createSession(user.id);
    db.sqlite.prepare(`INSERT INTO auth_account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES('browser-google-account','original-google-subject','google',?,?,?)`).run(user.id,new Date(now).toISOString(),new Date(now).toISOString());
    await new Admission(db).accept({subject:user.id,email:user.email,emailVerified:true,platformVersion:1},invite);
    const originalPrincipal=await new Admission(db).principal({subject:user.id,email:user.email,emailVerified:true,platformVersion:1});
    const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);Object.assign(jwk,{kid:'browser-fixture',alg:'RS256',use:'sig'});
    const idToken=await new SignJWT({email:'alice@example.test',email_verified:true,name:'Alice'}).setProtectedHeader({alg:'RS256',kid:'browser-fixture'}).setIssuer('https://accounts.google.com').setAudience(config.googleClientId).setSubject('original-google-subject').setIssuedAt().setExpirationTime('5m').sign(privateKey);
    globalThis.fetch=async(input,init)=>{
      const url=String(input);if(url==='https://oauth2.googleapis.com/token'){tokenCalls++;assert.equal(new URLSearchParams(init.body).get('redirect_uri'),canonical+'/api/auth/callback/google');return Response.json({access_token:'fixture-only',token_type:'Bearer',expires_in:300,id_token:idToken});}
      if(url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});unexpectedNetwork++;throw Error('offline-network-denied');
    };
    browser=await chromium.launch({headless:true,args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost']});const contextBrowser=await browser.newContext({serviceWorkers:'block'});
    const signed=(await serializeSignedCookie(context.authCookies.sessionToken.name,oldSession.token,secret)).split(';')[0],separator=signed.indexOf('=');
    await contextBrowser.addCookies([{name:signed.slice(0,separator),value:signed.slice(separator+1),url:legacy,secure:true,httpOnly:true,sameSite:'Lax'}]);
    const backend=async request=>new URL(request.url).pathname.startsWith('/api/auth/')?auth.handler(request):gateway(request,{origin:canonical,transportOrigin:transport,database:db,identity:async req=>sessionIdentity(await auth.api.getSession({headers:req.headers,query:{disableCookieCache:true}}))});
    await contextBrowser.route('**/*',async route=>{
      const browserRequest=route.request(),url=new URL(browserRequest.url());if(![canonical,legacy,transport].includes(url.origin)){unexpectedNetwork++;await route.abort();return;}
      let response;
      if(url.origin===canonical&&url.pathname==='/')response=new Response('<!doctype html><title>Offline browser driver</title>',{headers:{'content-type':'text/html'}});
      else{
        const request=new Request(url,{method:browserRequest.method(),headers:await browserRequest.allHeaders(),body:browserRequest.postDataBuffer()??undefined});
        if(url.origin===canonical)response=await entry(request,{APP_ORIGIN:canonical,APP_TRANSPORT_ORIGIN:transport,TWO_ACCOUNT_AUTH_MODE:'shared-limited'},backend);
        else if(url.origin===legacy)response=await legacyRecovery(request,{canonical,origin:legacy,until:Date.now()+60000,database:db,identity:async req=>sessionIdentity(await readonly.api.getSession({headers:req.headers,query:{disableCookieCache:true,disableRefresh:true}})),snapshot:async()=>{throw Error('not-used');},receipt:async()=>{throw Error('not-used');}});
        else response=await backend(request);
      }
      const headers=Object.fromEntries(response.headers);if(response.headers.getSetCookie().length)headers['set-cookie']=response.headers.getSetCookie().join('\n');
      await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
    });
    const page=await contextBrowser.newPage();await page.goto(canonical+'/');assert.equal((await contextBrowser.cookies(canonical)).length,0);
    assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/me');return response.status;}),401);
    const authorization=await page.evaluate(async()=>{const response=await fetch('/api/auth/sign-in/social',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'google',callbackURL:location.origin+'/',disableRedirect:true})});return response.json();});
    const state=new URL(authorization.url).searchParams.get('state');assert.ok(state);assert.ok((await contextBrowser.cookies(canonical)).every(cookie=>cookie.domain==='app.riffoid.com'&&cookie.secure&&cookie.httpOnly&&cookie.sameSite==='Lax'));
    const callback=await page.evaluate(async path=>{const response=await fetch(path,{redirect:'manual'});return response.type;},'/api/auth/callback/google?code=offline-code&state='+encodeURIComponent(state));assert.equal(callback,'opaqueredirect');await page.goto(canonical+'/');assert.equal(page.url(),canonical+'/');
    const me=await page.evaluate(async()=>{const response=await fetch('/api/me');return response.json();});assert.equal(me.userId,originalPrincipal.userId);
    const newCookies=await contextBrowser.cookies(canonical);assert.ok(newCookies.some(cookie=>cookie.name==='__Secure-riffology.session_token'));assert.ok(newCookies.every(cookie=>cookie.domain==='app.riffoid.com'&&cookie.secure&&cookie.httpOnly&&cookie.sameSite==='Lax'));
    assert.equal((await contextBrowser.cookies(transport)).length,0);assert.equal((await contextBrowser.cookies(legacy)).length,1);
    assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/auth/sign-out',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});return response.status;}),200);
    assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/me');return response.status;}),401);assert.ok(db.sqlite.prepare('SELECT id FROM auth_session WHERE id=?').get(oldSession.id));
    await page.goto(legacy+'/');assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/me');return response.status;}),200);
    assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/auth/sign-out',{method:'POST',body:'{}'});return response.status;}),403);
    assert.equal(tokenCalls,1);assert.equal(unexpectedNetwork,0);assert.equal(db.count('auth_user'),1);assert.equal(db.count('catalog_users'),1);
  }finally{globalThis.fetch=originalFetch;await browser?.close();db.sqlite.close();}
});
