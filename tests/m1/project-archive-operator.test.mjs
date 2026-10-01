import test from 'node:test';
import assert from 'node:assert/strict';
import operator from '../../scripts/model/project-archive-operator.ts';
import {SqliteCatalog} from './sqlite-database.ts';
import {ProjectCatalog} from '../../services/catalog/projects.ts';
import {ProjectArchives} from '../../services/catalog/project-archives.ts';
import {WorkspaceArchiveFence} from '../../services/workspace/archive-fence.ts';
import {workspaceAgentName} from '../../services/workspace/protocol.ts';
import {turnDigest} from '../../services/turn/protocol.ts';

async function fixture(t){
 const db=new SqliteCatalog();t.after(()=>db.sqlite.close());db.seed('owner');db.seed('operator');const now=Date.now(),principal={userId:'operator',authVersion:1};
 db.sqlite.prepare("INSERT INTO catalog_platform_roles(user_id,role,created_at,updated_at) VALUES('operator','operator',?,?)").run(now,now);
 db.sqlite.prepare("INSERT INTO catalog_invitations(id,token_hash,normalized_email,issued_by,created_at,expires_at) VALUES('invite',?,'owner@example.test','operator',?,?)").run('a'.repeat(64),now-1000,now+60000);db.sqlite.prepare("UPDATE catalog_invitations SET state='accepted',accepted_by='owner',accepted_at=? WHERE id='invite'").run(now);
 const catalog=new ProjectCatalog(db,new Set(['blank-v1'])),created=await catalog.create({userId:'owner',authVersion:1},'tenant-owner','create',{title:'secret contents stay private',starterVersion:'blank-v1'}),project=created.project;
 db.sqlite.prepare("UPDATE catalog_projects SET status='ready' WHERE id=?").run(project.id);db.sqlite.prepare("UPDATE catalog_workspaces SET status='ready' WHERE id=?").run(project.workspace_id);db.sqlite.prepare("UPDATE catalog_outbox SET state='completed' WHERE project_id=?").run(project.id);
 const archives=new ProjectArchives(db),values=new Map(),store={kv:{get:key=>structuredClone(values.get(key)),put:(key,value)=>values.set(key,structuredClone(value)),delete:key=>values.delete(key)},sync:async()=>{}},fence=new WorkspaceArchiveFence(store),calls=[];let blocker=[],afterPrepare=()=>{};
 const d1={prepare(sql){return {bind(...bindings){return {sql,values:bindings,all:async()=>({results:await db.query({sql,values:bindings})})};}};},batch:statements=>db.batch(statements)};
 const scope={schemaVersion:1,expiresAt:Date.now()+60000,operator:principal,cutoffAt:Date.now(),freezeRequestKey:'frozen-one'},secret='a'.repeat(64);
 const env={PROJECT_ARCHIVE_OPERATOR_CAPABILITY:secret,PROJECT_ARCHIVE_OPERATOR_SCOPE_JSON:JSON.stringify(scope),CATALOG:d1,WORKSPACE_AGENT:{getByName(name){assert.equal(name,workspaceAgentName(project.tenant_id,project.workspace_id));return {async prepareProjectArchive(input){calls.push(['prepare',input]);if(!input.dryRun)await fence.prepare({scope:input.target.scope,operationId:input.operationId,epoch:input.target.epoch,action:input.action,state:'prepared',wasArchived:input.target.archivedAt!==null});afterPrepare();return {blockers:blocker};},async finishProjectArchive(input){calls.push(['finish',input]);const target=await archives.target(input.actor,input.target.scope.tenantId,project.id,input.target.manifestId);const held=fence.get();if(held?.state==='archived'&&held.epoch===target.epoch)return;await fence.finish(input.actor.userId+':archive:'+input.requestKey,target.epoch,true);},async abortProjectArchive(input){calls.push(['abort',input]);await fence.abort(input.operationId);}};}}};
 const invoke=(body,headers={},targetEnv=env)=>operator.fetch(new Request('https://operator.test/operate',{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json','x-project-archive-mutation':scope.manifest?.digest??scope.freezeRequestKey,...headers},body:JSON.stringify(body)}),targetEnv);
 const freeze=async()=>{const result=await invoke({action:'freeze',confirmation:'freeze-invited-project-metadata'});assert.equal(result.status,200,await result.clone().text());const {manifest}=await result.json();scope.manifest={id:manifest.id,digest:manifest.digest,items:manifest.items,attempts:manifest.items.map(item=>({projectId:item.project_id,dryRunRequestKey:'dry-'+item.project_id,archiveRequestKey:'archive-'+item.project_id}))};env.PROJECT_ARCHIVE_OPERATOR_SCOPE_JSON=JSON.stringify(scope);return manifest;};
 return {db,scope,env,project,archives,calls,fence,invoke,freeze,block:reason=>{blocker=[reason];},afterPrepare:fn=>{afterPrepare=fn;}};
}
const check=id=>({action:'dry-run',confirmation:'check-frozen-project-archive',projectId:id});
const archive=id=>({action:'archive',confirmation:'archive-frozen-project',projectId:id});

test('temporary archive operator is inert without exact capability/scope/confirmation and exposes no arbitrary actions',async t=>{
 const f=await fixture(t);
 assert.equal((await f.invoke({action:'freeze',confirmation:'freeze-invited-project-metadata'},{authorization:'Bearer wrong'})).status,404);
 assert.equal((await f.invoke({action:'freeze',confirmation:'freeze-invited-project-metadata'},{},{...f.env,PROJECT_ARCHIVE_OPERATOR_SCOPE_JSON:'{}'})).status,503);
 assert.equal((await f.invoke({action:'freeze',confirmation:'freeze-invited-project-metadata'},{'x-project-archive-mutation':'wrong'})).status,409);
 for(const action of ['restore','resume','replay','execute','model-read','update'])assert.equal((await f.invoke({action,confirmation:'test'})).status,400);
 assert.equal((await f.invoke({action:'freeze',confirmation:'freeze-invited-project-metadata',cutoffAt:1})).status,400);
 assert.equal((await f.invoke({action:'freeze',confirmation:'freeze-invited-project-metadata'},{'content-type':'text/plain'})).status,400);
 assert.equal(f.db.count('catalog_project_archive_manifests'),0);assert.equal(f.calls.length,0);
});

test('freeze/dry-run/archive use immutable exact items and retained keys through the original Catalog/fence paths',async t=>{
 const f=await fixture(t),manifest=await f.freeze();assert.equal(manifest.total,1);assert.equal(manifest.ownerCount,1);assert.doesNotMatch(JSON.stringify(manifest),/secret contents/);assert.equal(await turnDigest({cutoffAt:f.scope.cutoffAt,items:f.scope.manifest.items}),manifest.digest);
 assert.equal((await f.invoke({action:'freeze',confirmation:'freeze-invited-project-metadata'})).status,409);
 assert.equal((await f.invoke(archive('foreign-project'))).status,409);
 assert.equal((await f.invoke({...archive(f.project.id),requestKey:'new-key'})).status,400);
 assert.equal((await f.invoke(archive(f.project.id),{'x-project-archive-mutation':'f'.repeat(64)})).status,409);
 assert.equal((await f.invoke(check(f.project.id))).status,200);assert.equal(f.fence.get(),null);
 const first=await f.invoke(archive(f.project.id));assert.equal(first.status,200,await first.clone().text());const receipt=(await first.json()).acknowledgement;
 assert.equal(receipt.outcome,'completed');assert.equal(receipt.request_key,f.scope.manifest.attempts[0].archiveRequestKey);assert.equal(f.fence.get().state,'archived');
 const replay=await f.invoke(archive(f.project.id));assert.equal(replay.status,200);assert.equal((await replay.json()).acknowledgement.id,receipt.id);assert.equal(f.db.count('catalog_project_archive_receipts'),1);
 assert.equal(f.calls.filter(([action])=>action==='prepare').length,2);assert.equal(f.calls.some(([,input])=>input?.action==='restore'),false);
 const read=await f.invoke({action:'read-manifest',confirmation:'read-frozen-project-metadata'});assert.equal(read.status,200);assert.equal((await read.json()).manifest.digest,manifest.digest);
 const drifted=structuredClone(f.scope);drifted.manifest.items[0].auth_version++;const denied=await f.invoke(archive(f.project.id),{},{...f.env,PROJECT_ARCHIVE_OPERATOR_SCOPE_JSON:JSON.stringify(drifted)});assert.equal(denied.status,503);
});

test('revoked operator/owner and expired scopes cannot dry-run or archive; expiry during proof only aborts its original fence',async t=>{
 const f=await fixture(t);await f.freeze();const originalCalls=f.calls.length;
 f.db.sqlite.prepare("UPDATE catalog_users SET auth_version=2 WHERE id='operator'").run();assert.equal((await f.invoke(check(f.project.id))).status,409);assert.equal((await f.invoke(archive(f.project.id))).status,409);assert.equal(f.calls.length,originalCalls);f.db.sqlite.prepare("UPDATE catalog_users SET auth_version=1 WHERE id='operator'").run();
 f.db.sqlite.prepare("UPDATE catalog_users SET auth_version=2 WHERE id='owner'").run();assert.equal((await f.invoke(archive(f.project.id))).status,409);assert.equal(f.calls.length,originalCalls);f.db.sqlite.prepare("UPDATE catalog_users SET auth_version=1 WHERE id='owner'").run();
 for(const delta of [-1,31*60_000]){const expired={...f.env,PROJECT_ARCHIVE_OPERATOR_SCOPE_JSON:JSON.stringify({...f.scope,expiresAt:Date.now()+delta})};assert.equal((await f.invoke(check(f.project.id),{},expired)).status,503);assert.equal((await f.invoke(archive(f.project.id),{},expired)).status,503);}
 let now=Date.now();t.mock.method(Date,'now',()=>now);f.afterPrepare(()=>{now=f.scope.expiresAt+1;});
 const expiredDuringProof=await f.invoke(archive(f.project.id));assert.equal(expiredDuringProof.status,503);assert.equal(f.db.count('catalog_project_archive_receipts'),0);assert.equal(f.fence.get(),null);assert.equal(f.calls.filter(([action])=>action==='abort').length,1);assert.equal(f.calls.filter(([action])=>action==='finish').length,0);
});

test('unknown execution yields the immutable blocked receipt and metadata responses have a hard byte limit',async t=>{
 const f=await fixture(t);await f.freeze();f.block('original-native-resource-unconfirmed');
 const denied=await f.invoke(archive(f.project.id));assert.equal(denied.status,200);const receipt=(await denied.json()).acknowledgement;assert.equal(receipt.outcome,'blocked');assert.equal(f.fence.get(),null);assert.equal((await f.invoke(archive(f.project.id))).status,200);assert.equal(f.db.count('catalog_project_archive_receipts'),1);
 f.db.sqlite.prepare("INSERT INTO catalog_project_archive_receipts(id,actor_user_id,project_id,action,request_key,manifest_id,archive_epoch,outcome,reason_code,created_at) VALUES('large','operator',?,'archive','large',?,0,'blocked',?,?)").run(f.project.id,f.scope.manifest.id,'x'.repeat(300000),Date.now());
 const read=await f.invoke({action:'read-manifest',confirmation:'read-frozen-project-metadata'});assert.equal(read.status,503);assert.deepEqual(await read.json(),{ok:false,error:'operator-response-limit'});
});
