// Real Better Auth cookies + actual Gateway invitation acceptance. Only auth
// fixture identities/invitations are inserted; no model/build/Run state is seeded.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {serializeSignedCookie} from 'better-call';
import {createAuth} from '../../services/gateway/auth.ts';
import {SqliteCatalog} from '../../tests/m1/sqlite-database.ts';
import {digest} from '../../services/catalog/contracts.ts';
export async function migrateLocalCatalog(db){
 for(const filename of ['0001_catalog.sql','0002_auth.sql','0003_provisioning.sql','0004_operator_invitations.sql','0005_initial_operator.sql','0006_model_catalog.sql','0007_model_content_checks.sql','0010_project_budget_routes.sql']){
  const schema=(await readFile(`services/catalog/migrations/${filename}`,'utf8')).replace(/--[^\n]*/g,'');
  for(const statement of schema.match(/\s*CREATE\s+TRIGGER[\s\S]*?\bEND\s*;|[^;]+;/gi)||[])await db.prepare(statement.trim()).run();
 }
}
export async function authenticatedTenants(mf,worker,{origin,secret}){
 const db=await mf.getD1Database('CATALOG',worker),fixture=new SqliteCatalog(),identities=[];
 try{
  fixture.sqlite.exec(await readFile('services/catalog/migrations/0002_auth.sql','utf8'));
  const auth=createAuth({database:fixture.sqlite,catalog:fixture,origin,secret,googleClientId:'fixture-only',googleClientSecret:'fixture-only'}),context=await auth.$context,now=Date.now();
  for(const name of ['owner','outsider']){
   const email=`g3-${name}@example.test`,token=(name==='owner'?'f':'e').repeat(64);
   fixture.sqlite.prepare('INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES(?,?,?,?,?)').run(`g3-${name}`,await digest(token),email,now,now+3600000);
   const user=await context.internalAdapter.createUser({name:`G3 ${name}`,email,emailVerified:true},{method:'oauth',oauth:{providerId:'google'}}),session=await context.internalAdapter.createSession(user.id);
   const cookie=(await serializeSignedCookie(context.authCookies.sessionToken.name,session.token,secret)).split(';')[0];identities.push({name,cookie,subject:user.id,sessionId:session.id,token});
  }
  for(const table of ['auth_user','auth_session','catalog_invitations'])for(const row of fixture.sqlite.prepare(`SELECT * FROM ${table}`).all()){
   const keys=Object.keys(row);await db.prepare(`INSERT INTO ${table} (${keys.map(key=>`"${key}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...keys.map(key=>row[key])).run();
  }
 }finally{fixture.sqlite.close();}
 for(const identity of identities){
  const headers={cookie:identity.cookie,origin,'content-type':'application/json'};
  const accepted=await mf.dispatchFetch(`${origin}/api/invitations/accept`,{method:'POST',headers,body:JSON.stringify({token:identity.token})});assert.equal(accepted.status,200,await accepted.clone().text());
  identity.tenantId=(await accepted.json()).tenantId;identity.headers=headers;
  const me=await mf.dispatchFetch(`${origin}/api/me`,{headers});assert.equal(me.status,200);identity.me=await me.json();
 }
 assert.notEqual(identities[0].tenantId,identities[1].tenantId);
 return {owner:identities[0],outsider:identities[1]};
}
