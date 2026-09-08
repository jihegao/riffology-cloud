import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectCatalog } from '../../services/catalog/projects.ts';
import { SqliteCatalog } from './sqlite-database.ts';
const alpha = { userId: 'alpha', authVersion: 1 }, bravo = { userId: 'bravo', authVersion: 1 };
const body = { title: 'My model', starterVersion: 'blank-v1' };
function fixture() { const db = new SqliteCatalog(); db.seed('alpha'); db.seed('bravo'); return { db, catalog: new ProjectCatalog(db,new Set(['blank-v1'])) }; }

test('concurrent same-key create commits one project, workspace, intent, outbox and audit', async () => {
  const {db,catalog} = fixture();
  try {
    const results = await Promise.all(Array.from({length:12},()=>catalog.create(alpha,'tenant-alpha','request-one',body)));
    assert.equal(new Set(results.map(r=>r.project.id)).size,1);
    assert.equal(results.filter(r=>!r.replayed).length,1);
    for (const table of ['catalog_projects','catalog_workspaces','catalog_creation_intents','catalog_outbox','catalog_audit_log']) assert.equal(db.count(table),1);
    assert.equal(results[0].project.status,'provisioning');
    await assert.rejects(catalog.create(alpha,'tenant-alpha','request-one',{...body,title:'Changed'}),{message:'idempotency_conflict'});
    assert.equal(db.count('catalog_projects'),1);
  } finally { db.sqlite.close(); }
});

test('two owners run independently; foreign project/tenant and operator content access rejected', async () => {
  const {db,catalog} = fixture();
  try {
    const [a,b]=await Promise.all([catalog.create(alpha,'tenant-alpha','same',body),catalog.create(bravo,'tenant-bravo','same',body)]);
    assert.notEqual(a.project.id,b.project.id);
    assert.equal((await catalog.list(alpha,'tenant-alpha')).length,1);
    const now=Date.now(); db.sqlite.prepare(`INSERT INTO catalog_platform_roles(user_id,role,created_at,updated_at) VALUES ('bravo','operator',?,?)`).run(now,now);
    await assert.rejects(catalog.get(bravo,'tenant-alpha',a.project.id),{message:'not_found'});
    await assert.rejects(catalog.get(alpha,'tenant-alpha',b.project.id),{message:'not_found'});
    await assert.rejects(catalog.create(bravo,'tenant-alpha','foreign',body),{message:'not_found'});
    assert.equal(db.count('catalog_projects'),2);
  } finally { db.sqlite.close(); }
});

test('rejects client ownership, arbitrary starters and malformed values without writes', async () => {
  const {db,catalog}=fixture();
  try {
    for(const input of [{...body,tenant_id:'tenant-bravo'},{...body,owner:'bravo'},{...body,starterVersion:'https://evil.test/model'},{...body,title:'\u0000'},null,[]]) {
      await assert.rejects(catalog.create(alpha,'tenant-alpha','key',input),{message:'invalid_input'});
    }
    assert.equal(db.count('catalog_projects'),0);
  } finally { db.sqlite.close(); }
});

for(let failure=0;failure<5;failure++)test(`create SQL failure at statement ${failure} leaves no partial project`,async()=>{
  const {db,catalog}=fixture();
  try {
    db.failAt=failure; await assert.rejects(catalog.create(alpha,'tenant-alpha','key',body),/injected SQL failure/);
    for(const table of ['catalog_projects','catalog_workspaces','catalog_creation_intents','catalog_outbox','catalog_audit_log'])assert.equal(db.count(table),0);
    db.failAt=-1;assert.equal((await catalog.create(alpha,'tenant-alpha','key',body)).replayed,false);
  } finally {db.sqlite.close();}
});

test('lost commit response and process restart preserve creation identity and pending dispatch',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'riff-m1-'));let db=new SqliteCatalog(join(dir,'catalog.sqlite'));
  try {
    db.seed('alpha');let catalog=new ProjectCatalog(db,new Set(['blank-v1']));db.loseCommitResponse=true;
    await assert.rejects(catalog.create(alpha,'tenant-alpha','key',body),/lost committed response/);
    const prior=db.sqlite.prepare('SELECT id FROM catalog_projects').get()!.id;
    db.sqlite.close();db=new SqliteCatalog(join(dir,'catalog.sqlite'),false);catalog=new ProjectCatalog(db,new Set(['blank-v1']));
    const result=await catalog.create(alpha,'tenant-alpha','key',body);assert.equal(result.project.id,prior);assert.equal(result.replayed,true);
    assert.equal(db.count('catalog_outbox'),1);assert.equal(db.sqlite.prepare('SELECT state FROM catalog_outbox').get()!.state,'pending');
  } finally {db.sqlite.close();rmSync(dir,{recursive:true,force:true});}
});

test('revocation and tenant suspension are rechecked for old verified principals',async()=>{
  const {db,catalog}=fixture();
  try {
    const p=await catalog.create(alpha,'tenant-alpha','key',body);
    db.sqlite.exec("UPDATE catalog_users SET auth_version=2 WHERE id='alpha'");
    await assert.rejects(catalog.get(alpha,'tenant-alpha',p.project.id),{message:'not_found'});
    await assert.rejects(catalog.create(alpha,'tenant-alpha','next',body),{message:'not_found'});
    db.sqlite.exec("UPDATE catalog_tenants SET status='suspended' WHERE id='tenant-alpha'");
    await assert.rejects(catalog.get({...alpha,authVersion:2},'tenant-alpha',p.project.id),{message:'not_found'});
    assert.equal(db.count('catalog_projects'),1);
  } finally {db.sqlite.close();}
});
