import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {serializeSignedCookie} from 'better-call';
import {createAuth} from '../../services/gateway/auth.ts';
import {gateway} from '../../services/gateway/app.ts';
import {sessionIdentity} from '../../services/gateway/session-identity.ts';
import {browserPrincipal,requirePreviewSession} from '../../services/preview/session.ts';
import {Admission} from '../../services/catalog/admission.ts';
import {ProjectCatalog} from '../../services/catalog/projects.ts';
import {digest} from '../../services/catalog/contracts.ts';
import {SqliteCatalog} from '../m1/sqlite-database.ts';
const origin='http://127.0.0.1:8795',secret='test-only-preview-auth-secret-000000000000000000',invite='e'.repeat(64);
async function fixture(t:{after(fn:()=>void):void}){
 const db=new SqliteCatalog();t.after(()=>db.sqlite.close());db.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/0002_auth.sql',import.meta.url),'utf8'));
 const now=Date.now();db.sqlite.prepare("INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES ('preview-invite',?,'preview@example.test',?,?)").run(await digest(invite),now,now+60000);
 const auth=createAuth({database:db.sqlite,catalog:db,origin,secret,googleClientId:'test-only',googleClientSecret:'test-only'}),context=await auth.$context;
 // Only identity provisioning is local: no Google exchange. Cookies, session
 // reads, sign-out, Admission and the preview JOIN below are real production code.
 const user=await context.internalAdapter.createUser({name:'Preview',email:'preview@example.test',emailVerified:true},{method:'oauth',oauth:{providerId:'google'}});assert.ok(user);
 async function newSession(){const session=await context.internalAdapter.createSession(user!.id);assert.ok(session);const cookie=(await serializeSignedCookie(context.authCookies.sessionToken.name,session.token,secret)).split(';')[0];return {session,cookie};}
 const first=await newSession();const identityFor=async(cookie:string)=>sessionIdentity(await auth.api.getSession({headers:new Headers({cookie}),query:{disableCookieCache:true}}));
 const identity=await identityFor(first.cookie);assert.ok(identity);const admission=new Admission(db),{tenantId}=await admission.accept(identity,invite),principal=await admission.principal(identity);
 const created=await new ProjectCatalog(db,new Set(['blank-v1'])).create(principal,tenantId,'preview-project',{title:'Preview',starterVersion:'blank-v1'}),workspaceId=created.project.workspace_id;
 db.sqlite.prepare("UPDATE catalog_projects SET status='ready' WHERE id=?").run(created.project.id);db.sqlite.prepare("UPDATE catalog_workspaces SET status='ready' WHERE id=?").run(workspaceId);
 const scope={tenantId,projectId:created.project.id,workspaceId,workspaceGeneration:1},browser=browserPrincipal(identity,principal);
 const handle=(cookie:string)=>gateway(new Request(origin+'/api/me',{headers:{cookie}}),{origin,database:db,identity:req=>identityFor(req.headers.get('cookie')??'')});
 return {db,auth,context,user,first,identity,principal,browser,scope,newSession,identityFor,handle};
}
test('real signed session resolves preview principal; library sign-out revokes only its own session',async t=>{
 const f=await fixture(t);await requirePreviewSession(f.db,f.browser,f.scope);assert.equal(f.browser.sessionId,f.first.session.id);assert.equal(f.browser.subject,f.user.id);assert.equal(f.browser.userId,f.principal.userId);assert.equal(f.browser.authVersion,f.principal.authVersion);assert.ok(f.browser.expiresAt>Date.now());
 const second=await f.newSession(),secondIdentity=await f.identityFor(second.cookie);assert.ok(secondIdentity);const other=browserPrincipal(secondIdentity,await new Admission(f.db).principal(secondIdentity));await requirePreviewSession(f.db,other,f.scope);
 const signedOut=await f.auth.handler(new Request(origin+'/api/auth/sign-out',{method:'POST',headers:{cookie:f.first.cookie,origin,'content-type':'application/json'},body:'{}'}));assert.equal(signedOut.status,200);
 await assert.rejects(requirePreviewSession(f.db,f.browser,f.scope));assert.equal(await f.identityFor(f.first.cookie),null);await requirePreviewSession(f.db,other,f.scope);assert.ok(await f.identityFor(second.cookie));
});
test('preview session JOIN rejects expiry, foreign scope, outdated authority and revoked membership',async t=>{
 const f=await fixture(t);await requirePreviewSession(f.db,f.browser,f.scope);
 for(const field of ['tenantId','projectId','workspaceId'] as const)await assert.rejects(requirePreviewSession(f.db,f.browser,{...f.scope,[field]:'foreign'}));
 await assert.rejects(requirePreviewSession(f.db,f.browser,{...f.scope,workspaceGeneration:2}));await assert.rejects(requirePreviewSession(f.db,{...f.browser,sessionId:'another-session'},f.scope));await assert.rejects(requirePreviewSession(f.db,{...f.browser,subject:'another-user'},f.scope));
 await assert.rejects(requirePreviewSession(f.db,f.browser,f.scope,()=>f.browser.expiresAt));
 f.db.sqlite.prepare('UPDATE auth_session SET expiresAt=? WHERE id=?').run(Date.now()-1000,f.first.session.id);await assert.rejects(requirePreviewSession(f.db,f.browser,f.scope));f.db.sqlite.prepare('UPDATE auth_session SET expiresAt=? WHERE id=?').run(f.first.session.expiresAt.getTime(),f.first.session.id);
 f.db.sqlite.prepare('UPDATE catalog_users SET auth_version=2 WHERE id=?').run(f.principal.userId);await assert.rejects(requirePreviewSession(f.db,f.browser,f.scope));f.db.sqlite.prepare('UPDATE catalog_users SET auth_version=1 WHERE id=?').run(f.principal.userId);
 f.db.sqlite.prepare("UPDATE catalog_memberships SET status='revoked' WHERE tenant_id=?").run(f.scope.tenantId);await assert.rejects(requirePreviewSession(f.db,f.browser,f.scope));
});
test('public me output never exposes private session identifiers or token',async t=>{
 const f=await fixture(t);const response=await f.handle(f.first.cookie);assert.equal(response.status,200);const text=await response.text();assert.equal(text.includes(f.first.session.id),false);assert.equal(text.includes(f.first.session.token),false);assert.equal(text.includes('sessionId'),false);assert.equal(text.includes('browserSession'),false);assert.equal(sessionIdentity(null),null);assert.equal((await f.handle(f.first.cookie+'tampered')).status,401);
 f.db.sqlite.prepare("UPDATE catalog_workspaces SET status='failed' WHERE id=?").run(f.scope.workspaceId);await assert.rejects(requirePreviewSession(f.db,f.browser,f.scope));
});

test('session expires while its primary database read is pending',async t=>{
 const f=await fixture(t);let now=f.browser.expiresAt-1,reads=0;
 const delayed={batch:f.db.batch.bind(f.db),async query<T>(statement:import('../../services/catalog/database.ts').Statement):Promise<T[]>{
  reads++;const rows=await f.db.query<T>(statement);now=f.browser.expiresAt;return rows;
 }};
 await assert.rejects(requirePreviewSession(delayed,f.browser,f.scope,()=>now),/preview-session-denied/);assert.equal(reads,1);
});
