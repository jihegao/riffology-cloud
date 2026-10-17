import test from 'node:test';
import assert from 'node:assert/strict';
import {createGatewayManualSaveServices} from '../../services/gateway/manual-save-services.ts';
import {manualArtifactReceipts} from '../../services/project-views/manual-artifacts.ts';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},actor={userId:'user',authVersion:1};
test('manual saves reject production and mixed origins before obtaining a Workspace stub',async()=>{
 for(const [app,execution] of [['https://app.example','http://localhost:8821'],['http://localhost:8795','https://execution.example'],['http://localhost:8795','http://localhost:8795']]){
  let calls=0;const service=createGatewayManualSaveServices({APP_ORIGIN:app,BROWSER_PREVIEW_EXECUTION_ORIGIN:execution,WORKSPACE_AGENT:{getByName(){calls++;throw Error('unexpected');}}});
  for(const call of [()=>service.state(scope,actor),()=>service.save(scope,actor,'key',{}),()=>service.status(scope,actor,'key')])assert.throws(call,/local-only/);
  assert.equal(calls,0);
 }
});
test('local save service preserves authenticated scope and original operation key',async()=>{
 const seen=[];const stub={manualSaveState:async i=>{seen.push(i);return {files:[]};},manualSave:async i=>{seen.push(i);return {operationId:i.key,status:'pending'};},manualSaveStatus:async i=>{seen.push(i);return {operationId:i.operationId,status:'committed'};}};
 const service=createGatewayManualSaveServices({APP_ORIGIN:'http://127.0.0.1:8795',BROWSER_PREVIEW_EXECUTION_ORIGIN:'http://localhost:8821',WORKSPACE_AGENT:{getByName:()=>stub}});
 await service.state(scope,actor,'docs/data.json');await service.save(scope,actor,'same-key',{changes:[]});await service.status(scope,actor,'same-key');
 assert.deepEqual(seen.map(x=>x.actor),[actor,actor,actor]);assert.equal(seen[0].path,'docs/data.json');assert.equal(seen[1].key,seen[2].operationId);
});
test('uploaded artifact identities bind revision and bytes without a fabricated tool receipt',async()=>{
 const bytes=initialWorkspaceArchive({'docs/data.json':new TextEncoder().encode('{"value":1}')}),revision={source:'manual-save',revisionId:'a'.repeat(64),objectKey:'manual/object',filesSha256:'b'.repeat(64),sessionSha256:null,committedAt:1};
 const [item]=await manualArtifactReceipts(revision,bytes,[{path:'docs/data.json',title:'Uploaded data'}]);
 assert.equal(item.source,'user-upload');assert.match(item.artifactId,/^manual-artifact-[a-f0-9]{64}$/);assert.equal(item.bytes,11);assert.equal(item.mediaType,'application/json');assert.equal('turnId' in item,false);assert.equal('toolCallId' in item,false);
 const [changed]=await manualArtifactReceipts({...revision,revisionId:'c'.repeat(64)},bytes,[{path:'docs/data.json',title:'Uploaded data'}]);assert.notEqual(changed.artifactId,item.artifactId);
 await assert.rejects(manualArtifactReceipts(revision,bytes,[{path:'docs/missing.json',title:'Missing'}]),/invalid/);
});

test('artifact-only manual revisions invalidate the frozen package and old broker identity',async()=>{
 const {packaged}=await import('./project-views-fixture.mjs'),{buildProjectViews}=await import('../../services/project-views/package.ts');
 const {bytes,pkg}=await packaged();const source={kind:'manual-save',identity:{scope:pkg.scope,actor,operationId:'save'},revision:{source:'manual-save',revisionId:'a'.repeat(64),objectKey:'manual/object',filesSha256:pkg.filesSha256,sessionSha256:null,committedAt:1}};
 const first=await buildProjectViews(source,bytes),second=await buildProjectViews({...source,revision:{...source.revision,revisionId:'b'.repeat(64)}},bytes);
 assert.equal(first.revisionId,'a'.repeat(64));assert.notEqual(first.packageIdentity,second.packageIdentity);
});
