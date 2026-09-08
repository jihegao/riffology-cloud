import {verifyModelContent} from '../../services/runtime/content.ts';
import {digest} from '../../services/catalog/contracts.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteCatalog} from './sqlite-database.ts';
import {ProjectCatalog} from '../../services/catalog/projects.ts';
import {ProvisioningCatalog,type ProvisioningTask,type WorkspaceProjection} from '../../services/catalog/provisioning.ts';
import {ModelCatalog} from '../../services/catalog/models.ts';
const principal={userId:'alpha',authVersion:1};
async function fixture(){
 const db=new SqliteCatalog();db.seed('alpha');db.seed('bravo');
 const projects=new ProjectCatalog(db,new Set(['blank-v1']));const {project}=await projects.create(principal,'tenant-alpha','creation',{title:'Workspace',starterVersion:'blank-v1'});
 const catalog=new ProvisioningCatalog(db);return {db,project,catalog,kick:()=>catalog.kickProject(principal,'tenant-alpha',project.id)};
}
function receipt(task:ProvisioningTask,sequence=1):WorkspaceProjection{const now=Date.now();return {taskId:task.id,tenantId:task.tenantId,projectId:task.projectId,workspaceId:task.workspaceId,generation:task.generation,
 sequence,receiptId:`receipt-${sequence}`,updatedAt:now,outcome:'ready',reasonCode:'initialized',quotaReleased:true,
 runtimeReceipt:{receiptId:'runtime-receipt',initializedAt:now,layoutVersion:'m1-empty-v1',markerSha256:'a'.repeat(64),checkpointRevision:'b'.repeat(64)},
 stopReceipt:{confirmationId:'stop-confirmation',observedAt:now,nativeRunning:false,fenced:true}};}
test('claim response loss and concurrent kicks preserve one task/deadline/auth version and one dispatch audit',async()=>{
 const f=await fixture();try{
  f.db.loseCommitResponse=true;await assert.rejects(f.kick(),/lost committed response/);f.db.loseCommitResponse=false;
  const rows=await Promise.all(Array.from({length:6},()=>f.kick()));assert.ok(rows[0]);for(const row of rows)assert.deepEqual(row,rows[0]);
  assert.equal(rows[0].mode,'accept');assert.equal(rows[0].task.authVersion,1);assert.equal(await f.catalog.verifyTask(rows[0].task),true);
  assert.equal(f.db.sqlite.prepare('SELECT attempts FROM catalog_outbox').get()!.attempts,1);
  assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM catalog_audit_log WHERE action='workspace.dispatch'").get()!.n,1);
  assert.equal(f.db.sqlite.prepare('SELECT state FROM catalog_creation_intents').get()!.state,'dispatched');
  assert.equal(await f.catalog.verifyTask({...rows[0].task,starterVersion:'other'}),false);
  f.db.sqlite.exec('UPDATE catalog_users SET auth_version=2');assert.equal(await f.catalog.verifyTask(rows[0].task),false);
  assert.equal(await f.catalog.taskKnown(rows[0].task),true);assert.equal(await f.catalog.taskKnown({...rows[0].task,authVersion:2}),false);
  await assert.rejects(f.kick(),{message:'not_found'});
 }finally{f.db.sqlite.close();}
});
test('claimed model project freezes content source, validates its runtime receipt and survives model withdrawal',async()=>{
 const db=new SqliteCatalog();db.seed('alpha');db.seed('operator');const now=Date.now();db.sqlite.prepare("INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES ('operator','operator','active',?,?)").run(now,now);
 const packageBytes=new TextEncoder().encode(JSON.stringify({schemaVersion:1,files:[{path:'model/main.py',bytes:1,sha256:await digest('x'),contentBase64:'eA=='}]}));const packageSha=await digest(new TextDecoder().decode(packageBytes));
 const models=new ModelCatalog(db,Date.now,{resolve:ref=>verifyModelContent(ref,{size:packageBytes.length,arrayBuffer:async()=>packageBytes.buffer})});const d=await models.createDraft({userId:'operator',authVersion:1},'model_create',{modelId:'queue',version:'2.1.0',title:'Queue',description:'Queue',starterVersion:'blank-v1',contentRef:'queue/2.1.0.json',contentSha256:packageSha});await models.transition({userId:'operator',authVersion:1},d.id,'validated','validate');await models.transition({userId:'operator',authVersion:1},d.id,'published','publish');
 const project=await new ProjectCatalog(db,new Set(['blank-v1']),models).create(principal,'tenant-alpha','model-copy',{title:'Queue copy',modelId:'queue',modelVersion:'2.1.0'});const catalog=new ProvisioningCatalog(db),claimed=(await catalog.kickProject(principal,'tenant-alpha',project.project.id))!;assert.deepEqual(claimed.task.modelContent,{modelVersionId:d.id,modelId:'queue',version:'2.1.0',contentRef:'queue/2.1.0.json',contentSha256:packageSha});await models.transition({userId:'operator',authVersion:1},d.id,'withdrawn','withdraw');const replay=await catalog.kickProject(principal,'tenant-alpha',project.project.id);assert.deepEqual(replay?.task,claimed.task);
 const base=receipt(claimed.task),content={...claimed.task.modelContent!,namespace:'model-content' as const,bytes:packageBytes.length,verifiedSha256:claimed.task.modelContent!.contentSha256,fileCount:1,contentBytes:1};
 assert.deepEqual(await catalog.project({...base,runtimeReceipt:{...base.runtimeReceipt!,modelContent:{...content,contentSha256:'e'.repeat(64),verifiedSha256:'e'.repeat(64)}}}),{applied:false});
 assert.deepEqual(await catalog.project({...base,runtimeReceipt:{...base.runtimeReceipt!,modelContent:content}}),{applied:true});
 db.sqlite.exec("UPDATE catalog_outbox SET source_content_sha256='e' WHERE id='missing'");db.sqlite.close();
});
test('private bounded sweep advances browserless creation, preserves original revoked version, and backs off fairly',async()=>{
 const f=await fixture();try{
  const projects=new ProjectCatalog(f.db,new Set(['blank-v1']));for(let i=0;i<11;i++)await projects.create(principal,'tenant-alpha',`more-${i}`,{title:'Background',starterVersion:'blank-v1'});
  f.db.sqlite.exec('UPDATE catalog_users SET auth_version=2');
  const first=await f.catalog.sweep();assert.equal(first.length,10);for(const {task,mode} of first){assert.equal(mode,'accept');assert.equal(task.authVersion,1);assert.equal(await f.catalog.taskKnown(task),true);assert.equal(await f.catalog.verifyTask(task),false);}
  const next=await f.catalog.sweep();assert.equal(next.length,2);assert.equal(new Set([...first,...next].map(x=>x.task.id)).size,12);
  assert.equal((await f.catalog.sweep()).length,0);await assert.rejects(f.catalog.sweep(11),{message:'invalid_input'});
  assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM catalog_creation_intents WHERE state='dispatched'").get()!.n,12);
 }finally{f.db.sqlite.close();}
});
test('sweep retains unknown as observation-only and quarantines legacy tasks missing original authorization',async()=>{
 const f=await fixture(),clock=Date.now;try{const task=(await f.kick())!.task;
  await f.catalog.project({...receipt(task),outcome:'unknown',reasonCode:'runtime-unknown',quotaReleased:false,runtimeReceipt:null,stopReceipt:null});
  const observations=await f.catalog.sweep();assert.equal(observations.length,1);assert.equal(observations[0].mode,'observe');assert.deepEqual(observations[0].task,task);
  // Emulate a pre-0003 outbox: its new nullable column has no historical actor
  // version. The scheduled path must never infer authorization from the owner.
  f.db.sqlite.exec('DROP TRIGGER catalog_outbox_actor_version_immutable; UPDATE catalog_outbox SET actor_auth_version=NULL');Date.now=()=>task.deadlineAt+1;
  assert.deepEqual(await f.catalog.sweep(),[]);assert.equal(await f.catalog.taskKnown(task),false);
 }finally{Date.now=clock;f.db.sqlite.close();}
});
test('lost sweep commit response leaves recoverable same task and no duplicate claim intent',async()=>{
 const f=await fixture(),clock=Date.now;try{f.db.loseCommitResponse=true;await assert.rejects(f.catalog.sweep(),/lost committed response/);f.db.loseCommitResponse=false;
  const saved=f.db.sqlite.prepare('SELECT id,deadline_at,available_at FROM catalog_outbox').get()!;Date.now=()=>Number(saved.available_at)+1;
  const result=await f.catalog.sweep();assert.equal(result.length,1);assert.equal(result[0].task.id,saved.id);assert.equal(result[0].task.deadlineAt,saved.deadline_at);
  assert.equal(f.db.sqlite.prepare('SELECT attempts FROM catalog_outbox').get()!.attempts,1);
 }finally{Date.now=clock;f.db.sqlite.close();}
});
test('unauthorized tenant and project kicks cannot claim another owner outbox',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.catalog.kickProject({userId:'bravo',authVersion:1},'tenant-alpha',f.project.id),{message:'not_found'});
  await assert.rejects(f.catalog.kickProject(principal,'tenant-bravo',f.project.id),{message:'not_found'});
  assert.equal(f.db.sqlite.prepare('SELECT state FROM catalog_outbox').get()!.state,'pending');
 }finally{f.db.sqlite.close();}
});
test('a claimed task whose first DO acceptance was lost remains the same accept identity after its deadline',async()=>{
 const f=await fixture(),clock=Date.now;try{const before=(await f.kick())!;Date.now=()=>before.task.deadlineAt+1;
  assert.deepEqual(await f.kick(),before);assert.equal(await f.catalog.verifyTask(before.task),true);
  // Accept is durable ingress only: WorkspaceAgent must record deadline failure,
  // not start initialization. Catalog accepts its scoped cleanup terminal below.
  const expired:WorkspaceProjection={...receipt(before.task),outcome:'failed',reasonCode:'deadline',runtimeReceipt:null,stopReceipt:null};
  assert.deepEqual(await f.catalog.project(expired),{applied:true});assert.equal(await f.kick(),null);
 }finally{Date.now=clock;f.db.sqlite.close();}
});
test('revocation after claim rejects ready but permits the original scope authority-revoked cleanup receipt',async()=>{
 const f=await fixture();try{const task=(await f.kick())!.task,r=receipt(task);f.db.sqlite.exec('UPDATE catalog_users SET auth_version=2');
  assert.equal(await f.catalog.verifyTask(task),false);assert.deepEqual(await f.catalog.project(r),{applied:false});
  assert.deepEqual(await f.catalog.project({...r,outcome:'failed',reasonCode:'authority-revoked',runtimeReceipt:null,stopReceipt:null}),{applied:true});
  assert.equal(f.db.sqlite.prepare('SELECT status FROM catalog_projects').get()!.status,'failed');
 }finally{f.db.sqlite.close();}
});
test('verified runtime/checkpoint/stop receipt atomically projects ready and replay is harmless after response loss',async()=>{
 const f=await fixture();try{const task=(await f.kick())!.task,r=receipt(task);f.db.loseCommitResponse=true;
  await assert.rejects(f.catalog.project(r),/lost committed response/);f.db.loseCommitResponse=false;
  assert.deepEqual(await f.catalog.project(r),{applied:true});assert.equal(await f.kick(),null);
  assert.equal(f.db.sqlite.prepare('SELECT status FROM catalog_projects').get()!.status,'ready');assert.equal(f.db.sqlite.prepare('SELECT status FROM catalog_workspaces').get()!.status,'ready');
  assert.equal(f.db.sqlite.prepare('SELECT state FROM catalog_creation_intents').get()!.state,'completed');assert.equal(f.db.sqlite.prepare('SELECT state FROM catalog_outbox').get()!.state,'completed');
  assert.equal(f.db.count('catalog_provisioning_receipts'),1);assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM catalog_audit_log WHERE action='workspace.project'").get()!.n,1);
  await assert.rejects(f.catalog.project({...r,updatedAt:r.updatedAt+1}),{message:'idempotency_conflict'});
 }finally{f.db.sqlite.close();}
});
test('ready requires complete initialization and stop evidence, released quota, and no arbitrary metadata',async()=>{
 const f=await fixture();try{const r=receipt((await f.kick())!.task);
  for(const patch of [{runtimeReceipt:null},{stopReceipt:null},{quotaReleased:false},{reasonCode:'runtime-unknown'},{secret:'raw'}])await assert.rejects(f.catalog.project({...r,...patch} as WorkspaceProjection),{message:'invalid_input'});
  await assert.rejects(f.catalog.project({...r,runtimeReceipt:{...r.runtimeReceipt!,markerSha256:'bad'}}),{message:'invalid_input'});
  await assert.rejects(f.catalog.project({...r,runtimeReceipt:{...r.runtimeReceipt!,initializedAt:r.stopReceipt!.observedAt+1}}),{message:'invalid_input'});
  assert.equal(f.db.count('catalog_provisioning_receipts'),0);assert.equal(f.db.sqlite.prepare('SELECT status FROM catalog_projects').get()!.status,'provisioning');
 }finally{f.db.sqlite.close();}
});
test('foreign scope, stale generation and deleting projects reject late projection without partial writes',async()=>{
 const f=await fixture();try{const r=receipt((await f.kick())!.task);
  for(const patch of [{tenantId:'tenant-bravo'},{projectId:'wrong-project'},{workspaceId:'wrong-workspace'},{generation:2}])assert.deepEqual(await f.catalog.project({...r,...patch}),{applied:false});
  f.db.sqlite.exec('UPDATE catalog_projects SET generation=2');assert.deepEqual(await f.catalog.project(r),{applied:false});
  assert.equal(f.db.count('catalog_provisioning_receipts'),0);
 }finally{f.db.sqlite.close();}
 const g=await fixture();try{const r=receipt((await g.kick())!.task);g.db.sqlite.exec("UPDATE catalog_projects SET status='deleting'");assert.deepEqual(await g.catalog.project(r),{applied:false});assert.equal(g.db.count('catalog_provisioning_receipts'),0);}finally{g.db.sqlite.close();}
});
test('unknown is observation-only, may advance to a terminal receipt, and cannot overwrite terminal ready',async()=>{
 const f=await fixture();try{const task=(await f.kick())!.task;const unknown:WorkspaceProjection={...receipt(task),outcome:'unknown',reasonCode:'runtime-unknown',quotaReleased:false,runtimeReceipt:null,stopReceipt:null};
  assert.deepEqual(await f.catalog.project(unknown),{applied:true});assert.equal((await f.kick())!.mode,'observe');
  const ready=receipt(task,2);assert.deepEqual(await f.catalog.project(ready),{applied:true});
  assert.deepEqual(await f.catalog.project({...unknown,receiptId:'unknown-late',sequence:3}),{applied:false});
  assert.deepEqual(await f.catalog.project(unknown),{applied:true});assert.equal(f.db.sqlite.prepare('SELECT status FROM catalog_projects').get()!.status,'ready');
  assert.equal(f.db.sqlite.prepare('SELECT projection_sequence FROM catalog_outbox').get()!.projection_sequence,2);
 }finally{f.db.sqlite.close();}
});
test('stopped and failed retain fixed reasons; unknown quota cannot be projected as terminal failure',async()=>{
 for(const outcome of ['stopped','failed'] as const){const f=await fixture();try{const r:WorkspaceProjection={...receipt((await f.kick())!.task),outcome,reasonCode:outcome==='stopped'?'stop-requested':'quota-denied',runtimeReceipt:null,stopReceipt:null};
  await assert.rejects(f.catalog.project({...r,quotaReleased:false}),{message:'invalid_input'});assert.deepEqual(await f.catalog.project(r),{applied:true});
  assert.equal(f.db.sqlite.prepare('SELECT status FROM catalog_projects').get()!.status,'failed');assert.equal(f.db.sqlite.prepare('SELECT reason_code FROM catalog_workspaces').get()!.reason_code,r.reasonCode);
 }finally{f.db.sqlite.close();}}
});
for(let failure=0;failure<6;failure++)test(`projection failure at SQL ${failure} rolls back every state and audit, then safely retries`,async()=>{
 const f=await fixture();try{const r=receipt((await f.kick())!.task);f.db.failAt=failure;await assert.rejects(f.catalog.project(r),/injected SQL failure/);f.db.failAt=-1;
  assert.equal(f.db.count('catalog_provisioning_receipts'),0);assert.equal(f.db.sqlite.prepare('SELECT status FROM catalog_projects').get()!.status,'provisioning');assert.equal(f.db.sqlite.prepare('SELECT status FROM catalog_workspaces').get()!.status,'provisioning');
  assert.equal(f.db.sqlite.prepare('SELECT state FROM catalog_creation_intents').get()!.state,'dispatched');assert.equal(f.db.sqlite.prepare('SELECT state FROM catalog_outbox').get()!.state,'processing');assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM catalog_audit_log WHERE action='workspace.project'").get()!.n,0);
  assert.deepEqual(await f.catalog.project(r),{applied:true});
 }finally{f.db.sqlite.close();}
});
