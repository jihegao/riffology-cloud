import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {serializeSignedCookie} from 'better-call';
import {createAuth,authOptions} from '../../services/gateway/auth.ts';
import {sessionIdentity} from '../../services/gateway/session-identity.ts';
import {legacyRecovery} from '../../services/gateway/recovery.ts';
import {entry} from '../../services/entry/index.ts';
import {gateway} from '../../services/gateway/app.ts';
import {ProjectCatalog} from '../../services/catalog/projects.ts';
import {TurnJournal} from '../../services/turn/journal.ts';
import {MemoryTurnStore} from '../../services/turn/store.ts';
import {digest} from '../../services/catalog/contracts.ts';
import {SqliteCatalog} from './sqlite-database.ts';
const canonical='https://app.riffoid.com',transport='https://transport.example.test',legacy='https://old.example.test',secret='offline-only-auth-signing-key-000000000000000000',token='c'.repeat(64);
async function fixture(){
  const db=new SqliteCatalog(),now=Date.now();db.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/0002_auth.sql',import.meta.url),'utf8'));
  db.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES ('invite',?,'alice@example.test',?,?)`).run(await digest(token),now,now+60000);
  const config={database:db.sqlite,catalog:db,origin:canonical,secret,googleClientId:'offline-only',googleClientSecret:'offline-only',sharedTransportRateLimit:true};
  const auth=createAuth(config),readonly=createAuth({...config,readOnlySession:true}),context=await auth.$context;
  const user=await context.internalAdapter.createUser({name:'Alice',email:'alice@example.test',emailVerified:true},{method:'oauth',oauth:{providerId:'google'}});assert.ok(user);
  const session=await context.internalAdapter.createSession(user.id);assert.ok(session);
  const cookie=(await serializeSignedCookie(context.authCookies.sessionToken.name,session.token,secret)).split(';')[0];
  const identity=async(req:Request)=>sessionIdentity(await auth.api.getSession({headers:req.headers,query:{disableCookieCache:true}}));
  const accepted=await gateway(new Request(transport+'/api/invitations/accept',{method:'POST',headers:{cookie,origin:canonical,'content-type':'application/json'},body:JSON.stringify({token})}),{origin:canonical,transportOrigin:transport,database:db,identity});assert.equal(accepted.status,200);
  const {tenantId}=await accepted.json() as any,userId=String(db.sqlite.prepare("SELECT id FROM catalog_users WHERE identity_issuer='better-auth' AND identity_subject=?").get(user.id)!.id),principal={userId,authVersion:1},project=(await new ProjectCatalog(db,new Set(['blank-v1'])).create(principal,tenantId,'project',{title:'Original',starterVersion:'blank-v1'})).project;
  db.sqlite.exec("UPDATE catalog_projects SET status='ready'; UPDATE catalog_workspaces SET status='ready'");
  const scope=await new ProjectCatalog(db,new Set()).workspace(principal,project.workspace_id),actor=principal,store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>Date.now());
  const s=await journal.createSession(scope,actor,'session',{title:'Original'});
  const turns={createSession:journal.createSession.bind(journal),submit:journal.submit.bind(journal),receipt:async(...args:Parameters<typeof journal.receipt>)=>({accepted:true,...await journal.receipt(...args)}),cancel:journal.cancel.bind(journal),replay:journal.replay.bind(journal),snapshot:journal.view.bind(journal),files:async()=>({}),diff:async()=>({}),artifact:async()=>({})};
  const services={canonical,origin:legacy,until:Date.now()+60000,database:db,identity:async(req:Request)=>sessionIdentity(await readonly.api.getSession({headers:req.headers,query:{disableCookieCache:true,disableRefresh:true}})),snapshot:journal.view.bind(journal),receipt:turns.receipt};
  const recover=(path:string,init:RequestInit={})=>legacyRecovery(new Request(legacy+path,{...init,headers:{cookie,...init.headers}}),services);
  const app=(request:Request)=>gateway(request,{origin:canonical,transportOrigin:transport,database:db,identity,turns});
  return {db,auth,readonly,config,user,session,cookie,services,recover,app,scope,actor,store,journal,s};
}
test('recovery reads stale sessions and original journal without session/database/journal writes; expired session is retained',async()=>{
  const f=await fixture();try{
    const old=Date.now()-2*3600000;f.db.sqlite.prepare('UPDATE auth_session SET updatedAt=?,expiresAt=? WHERE id=?').run(new Date(old).toISOString(),new Date(Date.now()+60000).toISOString(),f.session.id);
    const before=f.db.sqlite.prepare('SELECT * FROM auth_session WHERE id=?').get(f.session.id),journalBefore=JSON.stringify(f.store.read()),changes=Number(f.db.sqlite.prepare('SELECT total_changes() n').get()!.n);
    assert.equal((await f.recover('/api/auth/get-session')).status,200);assert.equal((await f.recover('/api/me')).status,200);assert.equal((await f.recover('/api/workspaces/'+f.scope.workspaceId)).status,200);
    assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM auth_session WHERE id=?').get(f.session.id),before);assert.equal(JSON.stringify(f.store.read()),journalBefore);assert.equal(Number(f.db.sqlite.prepare('SELECT total_changes() n').get()!.n),changes);
    f.db.sqlite.prepare('UPDATE auth_session SET expiresAt=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),f.session.id);const expiredChanges=Number(f.db.sqlite.prepare('SELECT total_changes() n').get()!.n);
    assert.equal((await f.recover('/api/me')).status,401);assert.ok(f.db.sqlite.prepare('SELECT id FROM auth_session WHERE id=?').get(f.session.id));assert.equal(Number(f.db.sqlite.prepare('SELECT total_changes() n').get()!.n),expiredChanges);
  }finally{f.db.sqlite.close();}
});
test('legacy permits only explicit reads: no auth callback/signout/refresh, app startup, events, preview, POST or expired-window access',async()=>{
  const f=await fixture();try{
    for(const path of ['/api/auth/callback/google','/api/auth/sign-in/social','/api/auth/sign-out','/api/workspaces/'+f.scope.workspaceId+'/events','/app.js','/browser-preview-assets/x','/api/admin/overview','/api/publications/readiness'])assert.equal((await f.recover(path)).status,403,path);
    assert.equal((await f.recover('/api/auth/callback/google?code=private&state=private')).status,400);
    assert.equal((await f.recover('/api/me',{method:'POST'})).status,403);assert.equal((await f.recover('/api/me',{headers:{upgrade:'websocket'}})).status,403);
    assert.equal((await f.recover('/api/me',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
    const page=await (await f.recover('/')).text();assert.match(page,/href="https:\/\/app.riffoid.com\/"/);assert.doesNotMatch(page,/app\.js|browser-preview|localStorage|sessionStorage/);
    assert.equal((await legacyRecovery(new Request(legacy+'/api/me'),f.services,f.services.until)).status,410);
    let identities=0;const staticServices={...f.services,identity:async()=>{identities++;throw Error('static page must not read identity');}};
    for(const path of ['/','/legacy-recovery.js','/legacy-local-runs/','/legacy-local-runs.js','/legacy-local-runs.css'])assert.equal((await legacyRecovery(new Request(legacy+path),staticServices,f.services.until)).status,200,path);
    assert.doesNotMatch(await (await legacyRecovery(new Request(legacy+'/'),staticServices,f.services.until)).text(),/<form/);
    for(const path of ['/api/me','/api/auth/get-session','/api/workspaces/'+f.scope.workspaceId])assert.equal((await legacyRecovery(new Request(legacy+path),staticServices,f.services.until)).status,410,path);
    for(const name of ['x-riffology-g5-read-session','x-riffology-g5-read-capability']){
      const denied=await legacyRecovery(new Request(legacy+'/api/workspaces/'+f.scope.workspaceId,{headers:{[name]:'proof'}}),staticServices);
      assert.equal(denied.status,403);assert.equal((await denied.json() as any).error,'legacy_g5_read_session_unavailable');
    }
    assert.equal(identities,0);
    f.db.sqlite.exec('UPDATE catalog_users SET auth_version=2');assert.equal((await f.recover('/api/me')).status,404);
    f.db.sqlite.exec("UPDATE catalog_users SET status='revoked'");assert.equal((await f.recover('/api/workspaces/'+f.scope.workspaceId)).status,404);
  }finally{f.db.sqlite.close();}
});
test('lost accepted response is never replayed; original authenticated key recovers exact turn and cross-scope/revoked reads fail closed',async()=>{
  const f=await fixture();try{
    let calls=0;const path=`/api/workspaces/${f.scope.workspaceId}/sessions/${f.s.session.id}/turns`;
    const response=await entry(new Request(canonical+path,{method:'POST',headers:{cookie:f.cookie,origin:canonical,'content-type':'application/json','idempotency-key':'original-key'},body:'{"message":"Original draft"}'}),{APP_ORIGIN:canonical,APP_TRANSPORT_ORIGIN:transport},async request=>{calls++;assert.equal((await f.app(request)).status,202);throw Error('lost accepted reply');});
    assert.equal(response.status,502);assert.equal(calls,1);assert.equal(Object.keys(f.store.read()!.turns).length,1);
    const snapshot=JSON.stringify(f.store.read()),receipt=await f.recover(path+'/receipt',{headers:{'idempotency-key':'original-key'}});assert.equal(receipt.status,200);
    const value=await receipt.json() as any;assert.equal(value.turn.id,Object.keys(f.store.read()!.turns)[0]);assert.equal(value.turn.requestKey,undefined);assert.equal(value.turn.payloadSha256,undefined);assert.equal(JSON.stringify(f.store.read()),snapshot);
    assert.equal((await f.recover(path+'/receipt',{headers:{'idempotency-key':'different-key'}})).status,404);assert.equal((await f.recover('/api/workspaces/unknown')).status,404);
    f.db.sqlite.exec("UPDATE catalog_memberships SET status='revoked'");assert.equal((await f.recover(path+'/receipt',{headers:{'idempotency-key':'original-key'}})).status,404);
  }finally{f.db.sqlite.close();}
});
test('real BetterAuth canonical callback/trusted origins stay fixed on actual transport URL and spoofed forwarding cannot redirect sign-in',async()=>{
  const f=await fixture();try{
    const options=authOptions(f.config);assert.equal(options.baseURL,canonical);assert.deepEqual(options.trustedOrigins,[canonical]);assert.deepEqual(options.advanced.ipAddress?.ipAddressHeaders,[]);assert.equal(options.rateLimit.enabled,true);assert.equal(options.rateLimit.max,30);
    const response=await entry(new Request(canonical+'/api/auth/sign-in/social',{method:'POST',headers:{origin:canonical,'content-type':'application/json','x-forwarded-host':'evil.test'},body:JSON.stringify({provider:'google',callbackURL:canonical+'/',disableRedirect:true})}),{APP_ORIGIN:canonical,APP_TRANSPORT_ORIGIN:transport},req=>f.auth.handler(req));
    assert.equal(response.status,200);const value=await response.json() as any;assert.equal(new URL(value.url).searchParams.get('redirect_uri'),canonical+'/api/auth/callback/google');assert.ok(response.headers.getSetCookie().length);assert.ok(response.headers.getSetCookie().every(cookie=>!cookie.includes('Domain=')));
    const denied=await f.auth.handler(new Request(transport+'/api/auth/sign-in/social',{method:'POST',headers:{origin:canonical,'content-type':'application/json'},body:JSON.stringify({provider:'google',callbackURL:'https://evil.test/'})}));assert.equal(denied.status,403);
    const replay=await f.auth.handler(new Request(transport+'/api/auth/callback/google?code=fixture&state=invalid'));assert.equal(replay.status,302);assert.ok(replay.headers.get('location')!.startsWith(canonical));
    const signout=await entry(new Request(canonical+'/api/auth/sign-out',{method:'POST',headers:{cookie:f.cookie,origin:canonical,'content-type':'application/json'},body:'{}'}),{APP_ORIGIN:canonical,APP_TRANSPORT_ORIGIN:transport},req=>f.auth.handler(req));assert.equal(signout.status,200);assert.equal(f.db.sqlite.prepare('SELECT id FROM auth_session WHERE id=?').get(f.session.id),undefined);
  }finally{f.db.sqlite.close();}
});
test('real gateway SSE through entry keeps cursor, rejects cross-site streams, and rechecks catalog revocation',async()=>{
  const f=await fixture();try{
    await f.journal.submit(f.scope,f.actor,f.s.session.id,'queued',{message:'fixture'});
    const path=`/api/workspaces/${f.scope.workspaceId}/events?after_sequence=0`,env={APP_ORIGIN:canonical,APP_TRANSPORT_ORIGIN:transport};
    assert.equal((await entry(new Request(canonical+path,{headers:{cookie:f.cookie,accept:'text/event-stream',origin:canonical,'sec-fetch-site':'cross-site'}}),env,f.app)).status,403);
    const response=await entry(new Request(canonical+path,{headers:{cookie:f.cookie,accept:'text/event-stream',origin:canonical,'last-event-id':'0'}}),env,f.app);assert.equal(response.status,200);
    const reader=response.body!.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/id: 1\nevent: turn\.queued/);
    f.db.sqlite.exec("UPDATE catalog_memberships SET status='revoked'");let content='';while(!content.includes('authorization_changed')){const chunk=await reader.read();if(chunk.done)break;content+=new TextDecoder().decode(chunk.value);}assert.match(content,/authorization_changed/);await reader.cancel();
    assert.equal(f.store.read()!.turns[Object.keys(f.store.read()!.turns)[0]!]!.status,'queued');
  }finally{f.db.sqlite.close();}
});
