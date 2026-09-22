import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {gateway} from '../../services/gateway/app.ts';
import type {Database,Statement} from '../../services/catalog/database.ts';
import {SqliteCatalog} from './sqlite-database.ts';

const origin='https://locale.example.test';
const migration=(name:string)=>readFileSync(new URL(`../../services/catalog/migrations/${name}`,import.meta.url),'utf8');

function fixture(beforeLocaleBatch?:()=>void){
  const db=new SqliteCatalog(),now=1;
  db.sqlite.exec(migration('0011_user_locale_preferences.sql'));
  for(const id of ['account-a','account-b'])db.sqlite.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES(?,'better-auth',?,?,?,?)").run(id,id,`${id}@example.test`,now,now);
  let subject:string|null='account-a',beforeWrite=beforeLocaleBatch;
  const database:Database={
    query:statement=>db.query(statement),
    batch:async statements=>{
      if(beforeWrite&&statements.some(statement=>statement.sql.includes('catalog_user_locale_preferences'))){const hook=beforeWrite;beforeWrite=undefined;hook();}
      await db.batch(statements);
    },
  };
  const request=(path:string,init:RequestInit={},requestOrigin=origin)=>gateway(new Request(origin+path,init),{
    origin,database,identity:async()=>subject?{subject,email:`${subject}@example.test`,emailVerified:true,platformVersion:1}:null,
  });
  const headers={'content-type':'application/json',origin};
  return {
    db,
    setSubject:(value:string|null)=>{subject=value;},
    get:()=>request('/api/me/locale'),
    put:(body:unknown,requestOrigin=origin)=>request('/api/me/locale',{method:'PUT',headers:{...headers,origin:requestOrigin},body:JSON.stringify(body)}),
    preferenceCount:()=>Number(db.sqlite.prepare('SELECT count(*) AS count FROM catalog_user_locale_preferences').get()!.count),
  };
}

test('locale preference API requires an authenticated same-origin request and an exact body schema',async()=>{
  const f=fixture();
  try{
    assert.equal((await f.put({locale:'en'},'https://foreign.example.test')).status,403);
    f.setSubject(null);
    assert.equal((await f.get()).status,401);
    assert.equal((await f.put({locale:'en'})).status,401);
    f.setSubject('account-a');
    for(const body of [null,{},[],{locale:'fr'},{locale:'en',extra:true},{locale:1}])assert.equal((await f.put(body)).status,400,JSON.stringify(body));
    assert.equal(f.preferenceCount(),0);
  }finally{f.db.sqlite.close();}
});

test('locale preference reads and writes are isolated to the authenticated account',async()=>{
  const f=fixture();
  try{
    assert.deepEqual(await (await f.put({locale:'en'})).json(),{locale:'en'});
    f.setSubject('account-b');
    assert.deepEqual(await (await f.get()).json(),{locale:null});
    assert.deepEqual(await (await f.put({locale:'zh-CN'})).json(),{locale:'zh-CN'});
    f.setSubject('account-a');
    assert.deepEqual(await (await f.get()).json(),{locale:'en'});
  }finally{f.db.sqlite.close();}
});

test('the locale write SQL guard rejects revocation or auth-version changes after admission and before batch execution',async()=>{
  for(const [name,revoke] of [
    ['revocation',()=>"UPDATE catalog_users SET status='revoked' WHERE id='account-a'"],
    ['auth-version change',()=>"UPDATE catalog_users SET auth_version=2 WHERE id='account-a'"],
  ] as const){
    let db!:SqliteCatalog;
    const f=fixture(()=>db.sqlite.exec(revoke()));db=f.db;
    try{
      const response=await f.put({locale:'en'});
      assert.equal(response.status,404,name);
      assert.equal(f.preferenceCount(),0,name);
    }finally{f.db.sqlite.close();}
  }
});

test('0011 is additive over a 0001-through-0010 catalog with existing accounts and audit ledger rows',()=>{
  const sqlite=new DatabaseSync(':memory:');
  try{
    sqlite.exec('PRAGMA foreign_keys=ON');
    for(let version=1;version<=10;version++)sqlite.exec(migration(`${String(version).padStart(4,'0')}_${['catalog','auth','provisioning','operator_invitations','initial_operator','model_catalog','model_content_checks','preview_routes','model_submissions','project_budget_routes'][version-1]}.sql`));
    sqlite.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES('existing','better-auth','existing','existing@example.test',1,1)").run();
    sqlite.prepare("INSERT INTO auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('existing','Existing','existing@example.test',1,1,1)").run();
    sqlite.prepare("INSERT INTO catalog_audit_log(id,actor_user_id,action,target_type,target_id,reason_code,outcome,request_id,created_at) VALUES('audit-existing','existing','account.verified','user','existing','historical-ledger','completed','request-existing',1)").run();
    const accountBefore=sqlite.prepare('SELECT * FROM catalog_users WHERE id=?').get('existing');
    const authBefore=sqlite.prepare('SELECT * FROM auth_user WHERE id=?').get('existing');
    const ledgerBefore=sqlite.prepare('SELECT * FROM catalog_audit_log WHERE id=?').get('audit-existing');
    sqlite.exec(migration('0011_user_locale_preferences.sql'));
    assert.deepEqual(sqlite.prepare('SELECT * FROM catalog_users WHERE id=?').get('existing'),accountBefore);
    assert.deepEqual(sqlite.prepare('SELECT * FROM auth_user WHERE id=?').get('existing'),authBefore);
    assert.deepEqual(sqlite.prepare('SELECT * FROM catalog_audit_log WHERE id=?').get('audit-existing'),ledgerBefore);
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM catalog_user_locale_preferences').get()!.count,0);
  }finally{sqlite.close();}
});
