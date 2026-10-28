import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SqliteCatalog} from './sqlite-database.ts';
import {ProjectCatalog} from '../../services/catalog/projects.ts';
import {directD1ClearStatements} from '../../scripts/model/direct-project-clear-d1.mjs';

async function setup(t){
  const db=new SqliteCatalog();t.after(()=>db.sqlite.close());
  for(const file of ['0008_preview_routes.sql','0009_model_submissions.sql','0013_manual_save_fence.sql'])db.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/'+file,import.meta.url),'utf8'));
  db.seed('owner');const catalog=new ProjectCatalog(db,new Set(['blank-v1'])),projects=[];
  for(let i=0;i<3;i++)projects.push((await catalog.create({userId:'owner',authVersion:1},'tenant-owner','create-'+i,{title:'secret '+i,starterVersion:'blank-v1'})).project);
  for(const p of projects){db.sqlite.prepare("UPDATE catalog_outbox SET state='completed' WHERE project_id=?").run(p.id);db.sqlite.prepare("UPDATE catalog_projects SET status='ready' WHERE id=?").run(p.id);db.sqlite.prepare("UPDATE catalog_workspaces SET status='ready' WHERE id=?").run(p.workspace_id);}
  const targets=projects.slice(0,2).map(p=>({project_id:p.id,tenant_id:p.tenant_id,workspace_id:p.workspace_id,owner_user_id:'owner',generation:p.generation,workspace_generation:p.generation,created_at:p.created_at}));
  const triggers=db.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('catalog_submission_review_no_delete','catalog_submission_intent_no_delete','catalog_submission_no_delete','catalog_provisioning_receipts_no_delete','catalog_project_archive_items_immutable_delete','catalog_project_archive_receipts_immutable_delete','catalog_manual_save_fence_retain','catalog_model_content_check_no_delete','catalog_model_operator_intent_no_delete','catalog_model_audit_no_delete') ORDER BY name").all();
  const execute=async statements=>db.batch(statements.map(s=>({sql:s.sql,values:s.params})));
  return {db,projects,targets,triggers,execute};
}

test('direct clear transaction deletes exact existing projects and children, retaining unrelated project, accounts, audit and schema guards',async t=>{
  const f=await setup(t),before=f.db.sqlite.prepare('SELECT * FROM catalog_projects WHERE id=?').get(f.projects[2].id),audits=f.db.count('catalog_audit_log');
  await f.execute(directD1ClearStatements(f.targets,[],[],f.triggers));
  assert.equal(f.db.count('catalog_projects'),1);assert.equal(f.db.count('catalog_workspaces'),1);assert.equal(f.db.count('catalog_outbox'),1);assert.equal(f.db.count('catalog_creation_intents'),1);
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM catalog_projects WHERE id=?').get(f.projects[2].id),before);assert.equal(f.db.count('catalog_users'),1);assert.equal(f.db.count('catalog_tenants'),1);assert.equal(f.db.count('catalog_audit_log'),audits);
  assert.deepEqual(f.db.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ("+f.triggers.map(()=>'?').join(',')+") ORDER BY name").all(...f.triggers.map(t=>t.name)),f.triggers);
  assert.deepEqual(f.db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'issue212_%'").get().n,0);
});

test('identity drift or pending source write aborts the whole transaction and retains all targets and deletion triggers',async t=>{
  const f=await setup(t),drift=structuredClone(f.targets);drift[0].created_at++;
  await assert.rejects(()=>f.execute(directD1ClearStatements(drift,[],[],f.triggers)),/CHECK constraint failed/);
  f.db.sqlite.prepare("UPDATE catalog_outbox SET state='unknown' WHERE project_id=?").run(f.targets[0].project_id);
  await assert.rejects(()=>f.execute(directD1ClearStatements(f.targets,[],[],f.triggers)),/CHECK constraint failed/);
  assert.equal(f.db.count('catalog_projects'),3);assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'issue212_%'").get().n,0);
  for(const trigger of f.triggers)assert.equal(f.db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(trigger.name).sql,trigger.sql);
});
