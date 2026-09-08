import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {serializeSignedCookie} from 'better-call';
import {createAuth} from '../../services/gateway/auth.ts';
import {gateway} from '../../services/gateway/app.ts';
import {digest} from '../../services/catalog/contracts.ts';
import {SqliteCatalog} from './sqlite-database.ts';
const origin='http://127.0.0.1:8795',secret='test-only-auth-signing-key-0000000000000000000000',invite='c'.repeat(64);
async function setup(){
  const db=new SqliteCatalog();db.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/0002_auth.sql',import.meta.url),'utf8'));
  const now=Date.now();db.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES ('invite',?,'alice@example.test',?,?)`).run(await digest(invite),now,now+60000);
  const auth=createAuth({database:db.sqlite,catalog:db,origin,secret,googleClientId:'test-only',googleClientSecret:'test-only'});
  const context=await auth.$context;
  // Local identity fixture, explicitly no Google exchange. Real library hooks,
  // session database, cookie verification and application authorization below.
  const user=await context.internalAdapter.createUser({name:'Alice',email:'alice@example.test',emailVerified:true},{method:'oauth',oauth:{providerId:'google'}});
  assert.ok(user);const session=await context.internalAdapter.createSession(user.id);assert.ok(session);
  const cookie=(await serializeSignedCookie(context.authCookies.sessionToken.name,session.token,secret)).split(';')[0];
  const handle=(path:string,init:RequestInit={})=>gateway(new Request(origin+path,init),{origin,database:db,identity:async req=>{
    const v=await auth.api.getSession({headers:req.headers,query:{disableCookieCache:true}});
    return v?{subject:v.user.id,email:v.user.email,emailVerified:v.user.emailVerified,platformVersion:v.session.platformVersion}:null;
  }});
  const headers={cookie,origin,'content-type':'application/json'};
  return {db,auth,context,user,session,cookie,headers,handle};
}
test('real library session + invitation + project API; tampered cookie and CSRF rejected',async()=>{
  const f=await setup();
  try{
    assert.equal((await f.handle('/api/me')).status,401);
    assert.equal((await f.handle('/api/me',{headers:{cookie:f.cookie+'bad'}})).status,401);
    assert.equal((await f.handle('/api/invitations/accept',{method:'POST',headers:{...f.headers,origin:'https://attacker.test'},body:JSON.stringify({token:invite})})).status,403);
    const response=await f.handle('/api/invitations/accept',{method:'POST',headers:f.headers,body:JSON.stringify({token:invite})});assert.equal(response.status,200);
    const {tenantId}=await response.json() as {tenantId:string};
    const create=await f.handle(`/api/tenants/${tenantId}/projects`,{method:'POST',headers:{...f.headers,'idempotency-key':'one'},body:JSON.stringify({title:'Test model',starterVersion:'blank-v1'})});
    assert.equal(create.status,202);assert.equal((await create.json() as {project:{status:string}}).project.status,'provisioning');
    assert.equal((await f.handle(`/api/tenants/${tenantId}/projects`,{headers:{cookie:f.cookie}})).status,200);
    // Mutation must not accept a valid session as a substitute for same-origin intent.
    assert.equal((await f.handle(`/api/tenants/${tenantId}/projects`,{method:'POST',headers:{cookie:f.cookie,'content-type':'application/json'},body:'{}'})).status,403);
    const second='d'.repeat(64),now=Date.now();f.db.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES ('second',?,'alice@example.test',?,?)`).run(await digest(second),now,now+60000);
    assert.equal((await f.handle('/api/invitations/accept',{method:'POST',headers:f.headers,body:JSON.stringify({token:second})})).status,200);
    assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM catalog_audit_log WHERE action='invitation.accept'").get()!.n,2);
    f.db.sqlite.prepare('DELETE FROM auth_session WHERE id=?').run(f.session.id);
    assert.equal((await f.handle('/api/me',{headers:{cookie:f.cookie}})).status,401);
  }finally{f.db.sqlite.close();}
});
test('auth library signup hooks reject uninvited identities and platform revocation fences old sessions',async()=>{
  const f=await setup();
  try{
    const denied=await f.context.internalAdapter.createUser({name:'Stranger',email:'stranger@example.test',emailVerified:true},{method:'oauth',oauth:{providerId:'google'}});assert.equal(denied,null);
    const unverified=await f.context.internalAdapter.createUser({name:'Alice',email:'alice@example.test',emailVerified:false},{method:'oauth',oauth:{providerId:'google'}});assert.equal(unverified,null);
    await f.handle('/api/invitations/accept',{method:'POST',headers:f.headers,body:JSON.stringify({token:invite})});
    f.db.sqlite.exec('UPDATE catalog_users SET auth_version=2');
    assert.equal((await f.handle('/api/me',{headers:{cookie:f.cookie}})).status,404);
    f.db.sqlite.exec("UPDATE catalog_users SET status='revoked'");
    assert.equal(await f.context.internalAdapter.createSession(f.user.id),null);
    const csrf=await f.auth.handler(new Request(origin+'/api/auth/sign-out',{method:'POST',headers:{...f.headers,origin:'https://attacker.test'},body:'{}'}));assert.equal(csrf.status,403);
    const signup=await f.auth.handler(new Request(origin+'/api/auth/sign-up/email',{method:'POST',headers:f.headers,body:JSON.stringify({email:'bad@example.test',password:'badpassword',name:'Bad'})}));assert.ok(signup.status>=400);
  }finally{f.db.sqlite.close();}
});
test('operator API denies tenant owners, then exposes invitation and platform metadata after role grant',async()=>{
  const f=await setup();
  try{
    await f.handle('/api/invitations/accept',{method:'POST',headers:f.headers,body:JSON.stringify({token:invite})});
    assert.equal((await f.handle('/api/admin/overview',{headers:{cookie:f.cookie}})).status,404);
    const now=Date.now();
    const catalogUserId=String(f.db.sqlite.prepare("SELECT id FROM catalog_users WHERE identity_issuer='better-auth' AND identity_subject=?").get(f.user.id)!.id);
    f.db.sqlite.prepare(`INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES (?,'operator','active',?,?)`).run(catalogUserId,now,now);
    const overview=await f.handle('/api/admin/overview',{headers:{cookie:f.cookie}});assert.equal(overview.status,200);
    assert.equal((await overview.json() as {tenants:number}).tenants,1);
    const denied=await f.handle('/api/admin/invitations',{method:'POST',headers:{...f.headers,origin:'https://attacker.test','idempotency-key':'gateway-admin'},body:JSON.stringify({email:'new@example.test',expiresInDays:7})});
    assert.equal(denied.status,403);
    const issued=await f.handle('/api/admin/invitations',{method:'POST',headers:{...f.headers,'idempotency-key':'gateway-admin'},body:JSON.stringify({email:'new@example.test',expiresInDays:7})});
    assert.equal(issued.status,201);
    const result=await issued.json() as {invitation:{id:string};token:string};assert.match(result.token,/^[0-9a-f]{64}$/);
    assert.equal((await f.handle('/api/admin/invitations',{headers:{cookie:f.cookie}})).status,200);
    assert.equal((await f.handle('/api/admin/tenants',{headers:{cookie:f.cookie}})).status,200);
    assert.equal((await f.handle('/api/admin/audit',{headers:{cookie:f.cookie}})).status,200);
    assert.equal((await f.handle(`/api/admin/invitations/${result.invitation.id}/revoke`,{method:'POST',headers:f.headers,body:'{}'})).status,200);
    f.db.sqlite.prepare("UPDATE catalog_platform_roles SET status='revoked',updated_at=? WHERE user_id=?").run(now+1,catalogUserId);
    assert.equal((await f.handle('/api/admin/overview',{headers:{cookie:f.cookie}})).status,404);
  }finally{f.db.sqlite.close();}
});
