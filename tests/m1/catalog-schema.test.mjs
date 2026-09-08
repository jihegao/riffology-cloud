import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const migration=readFileSync(new URL('../../services/catalog/migrations/0001_catalog.sql',import.meta.url),'utf8');
function open(path=':memory:',migrate=true){const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON');if(migrate)db.exec(migration);return db;}
function insert(db,table,row){const cols=Object.keys(row);return db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`).run(...Object.values(row));}
function seed(db){const now=Date.now();for(const n of ['a','b','operator'])insert(db,'catalog_users',{id:n,identity_issuer:'test-issuer',identity_subject:n,normalized_email:`${n}@example.test`,created_at:now,updated_at:now});
 for(const n of ['a','b']){insert(db,'catalog_tenants',{id:`t-${n}`,owner_user_id:n,created_at:now,updated_at:now});insert(db,'catalog_memberships',{tenant_id:`t-${n}`,user_id:n,created_at:now,updated_at:now});}return now;}
function project(db,n='a',id='p-a',workspace='w-a',now=Date.now()){
 insert(db,'catalog_projects',{id,tenant_id:`t-${n}`,owner_user_id:n,workspace_id:workspace,title:'Synthetic project',starter_version:'empty-v1',created_at:now,updated_at:now});
 insert(db,'catalog_workspaces',{id:workspace,project_id:id,tenant_id:`t-${n}`,owner_user_id:n,created_at:now,updated_at:now});
}
function intent(db,{id='intent-a',actor='a',projectId='p-a',key='same-key',hash='a'.repeat(64),now=Date.now()}={}){
 insert(db,'catalog_creation_intents',{id,actor_user_id:actor,tenant_id:`t-${actor}`,idempotency_key:key,payload_hash:hash,project_id:projectId,created_at:now,updated_at:now});
}
function outbox(db,{id='out-a',tenant='t-a',projectId='p-a',workspace='w-a',generation=1,now=Date.now()}={}){
 insert(db,'catalog_outbox',{id,project_id:projectId,workspace_id:workspace,tenant_id:tenant,generation,available_at:now,created_at:now,updated_at:now});
}
function transaction(db,fn){db.exec('BEGIN');try{fn();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
function invite(db,id='invite-a',options={}){const now=Date.now();insert(db,'catalog_invitations',{id,token_hash:'a'.repeat(64),normalized_email:'a@example.test',created_at:now-10000,expires_at:now+60000,...options});}
function accept(db,id='invite-a',user='a',at=Date.now()){db.prepare("UPDATE catalog_invitations SET state='accepted',accepted_by=?,accepted_at=? WHERE id=?").run(user,at,id);}

test('migration executes on real SQLite with strict types and an auth-library-independent identity reference',t=>{
 const db=open();t.after(()=>db.close());seed(db);
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
 assert.equal(tables.length,10);assert.ok(tables.every(n=>n.startsWith('catalog_')));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.throws(()=>insert(db,'catalog_users',{id:'duplicate',identity_issuer:'test-issuer',identity_subject:'a',normalized_email:'a@example.test',created_at:0,updated_at:0}),/UNIQUE/);
 assert.throws(()=>db.exec("UPDATE catalog_users SET auth_version='not-an-integer' WHERE id='a'"),/INTEGER/);
 assert.throws(()=>db.exec("UPDATE catalog_users SET identity_subject='new-subject' WHERE id='a'"),/identity-immutable/);
});
test('personal tenants cannot import another member or acquire a second owner tenant',t=>{
 const db=open();t.after(()=>db.close());const now=seed(db);
 assert.throws(()=>insert(db,'catalog_memberships',{tenant_id:'t-a',user_id:'b',created_at:now,updated_at:now}),/FOREIGN KEY/);
 assert.throws(()=>insert(db,'catalog_tenants',{id:'t-other',owner_user_id:'a',created_at:now,updated_at:now}),/UNIQUE/);
 assert.throws(()=>db.exec("UPDATE catalog_tenants SET owner_user_id='operator' WHERE id='t-a'"),/owner-immutable/);
 assert.throws(()=>db.exec("UPDATE catalog_memberships SET tenant_id='t-b',user_id='b' WHERE tenant_id='t-a'"),/owner-immutable/);
});
test('workspace composite keys reject tenant, owner, project and reserved workspace substitution',t=>{
 const db=open();t.after(()=>db.close());const now=seed(db);project(db);
 insert(db,'catalog_projects',{id:'p-b',tenant_id:'t-b',owner_user_id:'b',workspace_id:'w-b',title:'B',starter_version:'empty-v1',created_at:now,updated_at:now});
 const row={id:'w-b',project_id:'p-b',tenant_id:'t-b',owner_user_id:'b',created_at:now,updated_at:now};
 for(const patch of [{tenant_id:'t-a'},{owner_user_id:'a'},{project_id:'p-a'},{id:'w-forged'}])assert.throws(()=>insert(db,'catalog_workspaces',{...row,...patch}),/FOREIGN KEY|UNIQUE/);
 insert(db,'catalog_workspaces',row);
 for(const [table,sql] of [['catalog_projects',"tenant_id='t-b',owner_user_id='b'"],['catalog_projects',"workspace_id='w-new'"],['catalog_workspaces',"tenant_id='t-b',owner_user_id='b'"],['catalog_workspaces',"project_id='p-b'"]])assert.throws(()=>db.exec(`UPDATE ${table} SET ${sql} WHERE id='${table==='catalog_projects'?'p-a':'w-a'}'`),/owner-immutable/);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('all lifecycle states are representable but generations never regress or become zero',t=>{
 const db=open();t.after(()=>db.close());seed(db);project(db);
 for(const table of ['catalog_projects','catalog_workspaces']){
  for(const status of ['provisioning','ready','failed','deleting'])db.prepare(`UPDATE ${table} SET status=?`).run(status);
  assert.throws(()=>db.exec(`UPDATE ${table} SET status='running'`),/CHECK/);
  assert.throws(()=>db.exec(`UPDATE ${table} SET generation=0`),/CHECK|regression/);
  db.exec(`UPDATE ${table} SET generation=2`);assert.throws(()=>db.exec(`UPDATE ${table} SET generation=1`),/generation-regression/);
 }
});
test('idempotency scope preserves the first payload and refuses a forged cross-tenant creation intent',t=>{
 const db=open();t.after(()=>db.close());seed(db);project(db);project(db,'a','p-a2','w-a2');project(db,'b','p-b','w-b');intent(db);
 assert.throws(()=>intent(db,{id:'intent-duplicate',projectId:'p-a2'}),/UNIQUE/);
 assert.throws(()=>intent(db,{id:'intent-conflict',projectId:'p-a2',hash:'b'.repeat(64)}),/UNIQUE/);
 assert.throws(()=>db.exec("UPDATE catalog_creation_intents SET payload_hash='"+'b'.repeat(64)+"' WHERE id='intent-a'"),/intent-immutable/);
 assert.equal(db.prepare("SELECT payload_hash FROM catalog_creation_intents WHERE id='intent-a'").get().payload_hash,'a'.repeat(64));
 intent(db,{id:'intent-b',actor:'b',projectId:'p-b'});
 assert.throws(()=>intent(db,{id:'intent-cross',actor:'b',projectId:'p-a2',key:'other'}),/FOREIGN KEY/);
 // SQL preserves comparison data; the Catalog HTTP layer owns replay/409 mapping.
});
test('project, workspace, intent and outbox commit atomically and survive reopening a real database file',t=>{
 const dir=mkdtempSync(join(tmpdir(),'catalog-schema-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'catalog.sqlite');let db=open(path);seed(db);
 assert.throws(()=>transaction(db,()=>{project(db);intent(db);outbox(db,{tenant:'t-b'});}),/FOREIGN KEY/);
 for(const table of ['catalog_projects','catalog_workspaces','catalog_creation_intents','catalog_outbox'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
 transaction(db,()=>{project(db);intent(db);outbox(db);});db.close();db=open(path,false);t.after(()=>db.close());
 assert.equal(db.prepare('SELECT state FROM catalog_outbox').get().state,'pending');assert.equal(db.prepare('SELECT count(*) AS n FROM catalog_projects').get().n,1);
 assert.throws(()=>outbox(db,{id:'out-duplicate'}),/UNIQUE/);assert.throws(()=>db.exec("UPDATE catalog_outbox SET generation=2 WHERE id='out-a'"),/outbox-identity-immutable/);
 db.exec("UPDATE catalog_outbox SET state='unknown',attempts=1 WHERE id='out-a'");assert.equal(db.prepare('SELECT state FROM catalog_outbox').get().state,'unknown');
});
test('invitations require a pending, unexpired, same-email active identity and valid 256-bit hash',t=>{
 const db=open();t.after(()=>db.close());seed(db);invite(db);
 assert.throws(()=>accept(db,'invite-a','b'),/admission-denied/);assert.throws(()=>accept(db,'invite-a','a',null),/CHECK/);
 db.exec("UPDATE catalog_users SET status='revoked' WHERE id='a'");assert.throws(()=>accept(db),/admission-denied/);db.exec("UPDATE catalog_users SET status='active' WHERE id='a'");
 accept(db);assert.equal(db.prepare("SELECT accepted_by FROM catalog_invitations WHERE id='invite-a'").get().accepted_by,'a');assert.throws(()=>accept(db),/invitation-immutable|admission-denied/);
 invite(db,'expired',{token_hash:'b'.repeat(64),expires_at:Date.now()-1000});assert.throws(()=>accept(db,'expired','a',Date.now()-2000),/admission-denied/);
 invite(db,'revoked',{token_hash:'c'.repeat(64)});db.prepare("UPDATE catalog_invitations SET state='revoked',revoked_at=? WHERE id='revoked'").run(Date.now());assert.throws(()=>accept(db,'revoked'),/invitation-immutable|admission-denied/);
 for(const hash of ['x'.repeat(64),'a'.repeat(63),'A'.repeat(64)])assert.throws(()=>invite(db,'bad-hash',{token_hash:hash}),/CHECK/);
 assert.throws(()=>invite(db,'already-accepted',{token_hash:'d'.repeat(64),state:'accepted',accepted_by:'a',accepted_at:Date.now()}),/must-start-pending/);
});
test('platform operator grants do not create content membership and audit is append-only metadata',t=>{
 const db=open();t.after(()=>db.close());const now=seed(db);insert(db,'catalog_platform_roles',{user_id:'operator',role:'operator',created_at:now,updated_at:now});
 assert.equal(db.prepare("SELECT count(*) AS n FROM catalog_memberships WHERE user_id='operator'").get().n,0);
 assert.throws(()=>insert(db,'catalog_memberships',{tenant_id:'t-a',user_id:'operator',created_at:now,updated_at:now}),/FOREIGN KEY/);
 const event={id:'audit-1',actor_user_id:'operator',tenant_id:'t-a',action:'quota.inspect',target_type:'tenant',target_id:'t-a',reason_code:'operator_requested',outcome:'accepted',request_id:'req-1',created_at:now};insert(db,'catalog_audit_log',event);
 assert.throws(()=>db.exec("UPDATE catalog_audit_log SET outcome='completed'"),/append-only/);assert.throws(()=>db.exec('DELETE FROM catalog_audit_log'),/append-only/);
 assert.throws(()=>db.exec("INSERT OR REPLACE INTO catalog_audit_log SELECT id,actor_user_id,tenant_id,action,target_type,target_id,reason_code,'completed',request_id,created_at FROM catalog_audit_log"),/append-only/);
 assert.throws(()=>insert(db,'catalog_audit_log',{...event,id:'audit-2',reason_code:'raw credential or file contents'}),/CHECK/);
 assert.equal(db.prepare('SELECT count(*) AS n FROM catalog_audit_log').get().n,1);
});
