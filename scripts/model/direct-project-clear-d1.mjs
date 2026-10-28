/** One transaction for the explicitly selected existing projects. No tombstones.
 * Supply the live deletion-trigger definitions so they are restored byte-for-byte.
 * Account, invitation, usage/cost and execution-isolation stores are untouched.
 */
export function directD1ClearStatements(targets,modelIds,submissionIds,triggers){
  const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/.test(v))throw Error('direct-clear-invalid-identity');return v;};
  if(!targets.length||new Set(targets.map(t=>t.project_id)).size!==targets.length)throw Error('direct-clear-targets-invalid');
  const scope='issue212_clear_targets',guard='issue212_clear_assertion',statements=[];
  const add=(sql,...params)=>statements.push({sql,params});
  add(`CREATE TABLE ${scope}(project_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,generation INTEGER NOT NULL,workspace_generation INTEGER NOT NULL,created_at INTEGER NOT NULL) STRICT`);
  for(const t of targets){for(const k of ['project_id','tenant_id','workspace_id','owner_user_id'])id(t[k]);for(const k of ['generation','workspace_generation','created_at'])if(!Number.isSafeInteger(t[k]))throw Error('direct-clear-invalid-identity');add(`INSERT INTO ${scope} VALUES(?,?,?,?,?,?,?)`,t.project_id,t.tenant_id,t.workspace_id,t.owner_user_id,t.generation,t.workspace_generation,t.created_at);}
  add(`CREATE TABLE ${guard}(ok INTEGER NOT NULL CHECK(ok=1)) STRICT`);
  add(`INSERT INTO ${guard} SELECT CASE WHEN (SELECT count(*) FROM ${scope} s JOIN catalog_projects p ON p.id=s.project_id JOIN catalog_workspaces w ON w.id=s.workspace_id WHERE p.tenant_id=s.tenant_id AND p.workspace_id=s.workspace_id AND p.owner_user_id=s.owner_user_id AND p.generation=s.generation AND w.generation=s.workspace_generation AND p.created_at=s.created_at)=? THEN 1 ELSE 0 END`,targets.length);
  const projectIds=`SELECT project_id FROM ${scope}`,slots=modelIds.map(()=>'?').join(','),subSlots=submissionIds.map(()=>'?').join(',');
  modelIds.forEach(id);submissionIds.forEach(id);
  if(modelIds.length)add(`INSERT INTO ${guard} SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM catalog_projects WHERE source_model_version_id IN (${slots}) AND id NOT IN (${projectIds})) THEN 1 ELSE 0 END`,...modelIds);
  if(submissionIds.length)add(`INSERT INTO ${guard} SELECT CASE WHEN (SELECT count(*) FROM catalog_model_submissions WHERE id IN (${subSlots}) AND project_id IN (${projectIds}))=? THEN 1 ELSE 0 END`,...submissionIds,submissionIds.length);
  add(`INSERT INTO ${guard} SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM catalog_outbox WHERE project_id IN (${projectIds}) AND state NOT IN ('completed','failed')) AND NOT EXISTS(SELECT 1 FROM catalog_manual_save_fences WHERE project_id IN (${projectIds}) AND state='pending') THEN 1 ELSE 0 END`);
  const triggerNames=['catalog_submission_review_no_delete','catalog_submission_intent_no_delete','catalog_submission_no_delete','catalog_provisioning_receipts_no_delete','catalog_project_archive_items_immutable_delete','catalog_project_archive_receipts_immutable_delete','catalog_manual_save_fence_retain','catalog_model_content_check_no_delete','catalog_model_operator_intent_no_delete','catalog_model_audit_no_delete'];
  if(triggers.length!==triggerNames.length||new Set(triggers.map(t=>t.name)).size!==triggerNames.length)throw Error('direct-clear-trigger-set-conflict');
  for(const name of triggerNames){const t=triggers.find(t=>t.name===name);if(!t||typeof t.sql!=='string'||!t.sql.startsWith('CREATE TRIGGER '+name+' '))throw Error('direct-clear-trigger-set-conflict');add('DROP TRIGGER '+name);}
  if(submissionIds.length){add(`DELETE FROM catalog_submission_reviews WHERE submission_id IN (${subSlots})`,...submissionIds);add(`DELETE FROM catalog_submission_intents WHERE submission_id IN (${subSlots})`,...submissionIds);add(`DELETE FROM catalog_model_submissions WHERE id IN (${subSlots}) AND project_id IN (${projectIds})`,...submissionIds);}
  add(`DELETE FROM catalog_provisioning_receipts WHERE outbox_id IN (SELECT id FROM catalog_outbox WHERE project_id IN (${projectIds}))`);
  for(const table of ['catalog_preview_routes','catalog_manual_save_fences','catalog_project_archive_items','catalog_project_archive_receipts','catalog_project_budget_routes','catalog_creation_intents','catalog_outbox','catalog_workspaces'])add(`DELETE FROM ${table} WHERE project_id IN (${projectIds})`);
  add(`DELETE FROM catalog_projects WHERE id IN (${projectIds})`);
  if(modelIds.length){for(const table of ['catalog_model_content_checks','catalog_model_operator_intents','catalog_model_audit_log'])add(`DELETE FROM ${table} WHERE model_version_id IN (${slots})`,...modelIds);add(`DELETE FROM catalog_model_versions WHERE id IN (${slots})`,...modelIds);}
  for(const t of triggers)add(t.sql);
  add(`INSERT INTO ${guard} SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM catalog_projects WHERE id IN (${projectIds})) THEN 1 ELSE 0 END`);
  add('DROP TABLE '+guard);add('DROP TABLE '+scope);
  return statements;
}
