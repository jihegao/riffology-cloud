import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,Storage} from './browser-preview-test-fixture.mjs';
import {InitialWorkspaceResolver} from '../../services/turn-runtime/initial-workspace.ts';
import {verifyModelContent,modelContentKey} from '../../services/runtime/content.ts';
import {initialCheckpoint} from '../../services/runtime/starter.ts';
import {checkpointKey} from '../../services/runtime/core.ts';
import {canonicalWorkspaceMarker,workspaceDigest} from '../../services/workspace/protocol.ts';
import {previewSha256} from '../../services/browser-preview/contract.ts';
import {projectInitialPreviewDiscovery,discoveryKey} from '../../services/browser-preview/discovery.ts';
import {BrowserPreviewBuildHost} from '../../services/browser-preview/build-host.ts';
import {BrowserPreviewOrchestrator} from '../../services/browser-preview/orchestrator.ts';
import {frozenSource} from '../../services/browser-preview/source.ts';
import {SimulationHost} from '../../services/simulation/host.ts';
import {platformPreviewDelivery} from '../../services/browser-preview/platform-delivery.ts';
import {makeFixture} from '../../services/browser-preview/runtime/fixtures.mjs';
import profiles from '../../services/browser-preview/runtime/assets/profiles.json' with {type:'json'};
const encoder=new TextEncoder(),actor={userId:'user-a',authVersion:1};
const object=bytes=>({size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
async function initial(index=0){
 const f=await fixture(index),model=await makeFixture(profiles[index],index?'mesa':'queue');
 const files=await Promise.all(model.files.map(async row=>{const bytes=Buffer.from(row.base64,'base64');return {path:row.path,bytes:bytes.length,sha256:await previewSha256(bytes),contentBase64:row.base64};}));files.sort((a,b)=>a.path.localeCompare(b.path));
 const content=encoder.encode(JSON.stringify({schemaVersion:1,files})),modelContent={modelVersionId:'version-a',modelId:'model-a',version:1,contentRef:'copy/source.json',contentSha256:await previewSha256(content)};
 const task={id:'task-a',tenantId:f.scope.tenantId,projectId:f.scope.projectId,workspaceId:f.scope.workspaceId,generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:1000,deadlineAt:2000,modelContent};
 const runtime={taskId:task.id,tenantId:task.tenantId,projectId:task.projectId,workspaceId:task.workspaceId,generation:1,runtimeId:'runtime-a',leaseId:'lease-a'},markerNonce='nonce-a';
 const verified=await verifyModelContent(modelContent,object(content)),checkpoint=await initialCheckpoint({task,identity:runtime,markerNonce},verified.receipt);
 const state={schemaVersion:1,task,identity:runtime,markerNonce,runtimeReceipt:{receiptId:'receipt-a',initializedAt:1500,layoutVersion:'m1-empty-v1',markerSha256:await workspaceDigest(canonicalWorkspaceMarker(runtime,markerNonce)),checkpointRevision:checkpoint.revision},projection:{outcome:'ready'},projectionConfirmed:true,wakeAt:null};
 f.storage.values.clear();let resolves=0,scopeValid=true;
 const resolver=new InitialWorkspaceResolver({get:async key=>key===checkpointKey(runtime)?object(encoder.encode(checkpoint.text)):null},{get:async key=>key===modelContentKey(modelContent)?object(content):null});
 await f.storage.transaction(tx=>projectInitialPreviewDiscovery(tx,state,{...state,projectionConfirmed:false}));
 const revision=f.storage.values.get('browser-preview:initial-source'),source=f.storage.values.get(discoveryKey(revision));
 const ports={...f.ports,checkSource:source=>{if(!scopeValid||source.reference?.task.generation!==1)throw Error('browser-preview-source-unavailable');},files:async()=>{throw Error('saved must not resolve');},resolveInitial:async source=>{resolves++;assert.ok(f.storage.alarm!==null,'physical wake rearmed before private source I/O');return resolver.resolve(source.reference,f.scope);}};
 const host=()=>new BrowserPreviewBuildHost(f.storage,f.scope,ports,()=>1000);
 return {f,state,content,checkpoint,resolver,source,revision,ports,host,get resolves(){return resolves;},revoke:()=>{scopeValid=false;}};
}
for(const index of [0,1])test(`initial ${index} provenance resolves frozen model bytes and persists before create-only R2 without saved Turn`,async()=>{
 const s=await initial(index);await s.host().alarm();const row=s.host().read(s.revision);assert.equal(row.state.status,'ready');assert.equal(row.source.kind,'initial-workspace');assert.ok(row.source.filesSha256);assert.equal(row.source.revisionId,s.revision);assert.equal(Object.hasOwn(row.source,'identity'),false);assert.equal(Object.hasOwn(row.source,'receipt'),false);assert.equal(s.resolves,1);assert.equal(s.f.puts,1);
 const ref=[...s.f.storage.values].find(([key])=>key.startsWith('browser-preview:reference:'))[1];assert.deepEqual(ref.source,frozenSource(row.source));assert.equal(ref.source.filesSha256,row.source.filesSha256);assert.equal(s.f.storage.values.get(discoveryKey(s.revision)).status,'settled');assert.equal(s.f.storage.alarm,null);
 const before=structuredClone(s.f.storage.values);await s.host().alarm();assert.deepEqual(s.f.storage.values,before);assert.equal(s.resolves,1);
});
test('confirmed-ready projector admits only model-content transition and never mints discovery from legacy ready read',async()=>{
 const s=await initial(),storage=new Storage();
 for(const next of [{...s.state,projectionConfirmed:false},{...s.state,projection:{outcome:'unknown'}},{...s.state,task:{...s.state.task,modelContent:undefined}}])await storage.transaction(tx=>projectInitialPreviewDiscovery(tx,next,null));
 await storage.transaction(tx=>projectInitialPreviewDiscovery(tx,s.state,s.state));assert.equal(storage.values.size,0);
 await storage.transaction(tx=>projectInitialPreviewDiscovery(tx,s.state,{...s.state,projectionConfirmed:false}));assert.equal(storage.values.get('browser-preview:initial-source'),s.revision);assert.equal(storage.values.get(discoveryKey(s.revision)).filesSha256,null);
});
test('initial history uses existing native initial source, saved head wins, same-key Verify and read-only receipts survive restart',async()=>{
 const s=await initial();await s.host().alarm();let head=s.host().initial();
 const simulations=()=>new SimulationHost(s.f.storage,s.f.scope,{authorize:async()=>true,hold:()=>{},quota:{},start:async()=>{throw Error('no-native-on-submit');},observe:async()=>{},stop:async()=>{},destroy:async()=>{},running:async()=>false,publish:async()=>{}},()=>1000);
 const ports={authorize:async()=>{},checkScope:()=>{},checkSource:s.ports.checkSource,head:()=>head,saved:id=>id===s.revision?s.host().source(id):null,registry:s.ports.registry,builds:s.host(),bucket:s.f.ports.bucket,files:async source=>{assert.equal(source.kind,'initial-workspace');return (await s.resolver.resolve(source.reference,s.f.scope)).filesArchive;},simulations:simulations(),canVerify:()=>true,image:'fixture-image',delivery:hash=>platformPreviewDelivery('http://127.0.0.1:8795','http://localhost:8821',hash)};
 const service=()=>new BrowserPreviewOrchestrator(s.f.storage,s.f.scope,{...ports,simulations:simulations()}),body={revisionId:s.revision,packageIdentity:s.host().read(s.revision).state.packageIdentity,parameters:{},seed:42,intent:'experiment',idempotencyKey:'initial-verify-a'};
 const view=await service().view(actor);assert.equal(view.sourceKind,'initial-workspace');assert.equal(view.referenceSha256,s.source.referenceSha256);
 const a=await service().verify(actor,body);assert.equal(a.experiment.version.revisionId,null);assert.equal(a.experiment.version.filesSha256,s.host().source(s.revision).filesSha256);
 head={identity:s.f.source.identity,receipt:{...s.f.source.receipt,revisionId:'saved-new',filesSha256:'e'.repeat(64)}};
 const before=structuredClone(s.f.storage.values),receipt=await service().verification(actor,body.idempotencyKey);assert.equal(receipt.status,'accepted');assert.equal(receipt.experiment.runId,a.experiment.runId);assert.equal(receipt.experiment.stale,true);assert.deepEqual(s.f.storage.values,before);
 const b=await service().verify(actor,body);assert.equal(a.experiment.runId,b.experiment.runId);assert.equal([...s.f.storage.values.keys()].filter(k=>k.startsWith('simulation:run:')).length,1);assert.equal([...s.f.storage.values].find(([k])=>k.startsWith('browser-preview:verify:'))[1].source.kind,'initial-workspace');
});
test('initial resolver tamper and revoked source after await never write private package; failed attempt can explicitly recover',async()=>{
 const s=await initial(),original=s.ports.resolveInitial;s.ports.resolveInitial=async source=>({...await original(source),referenceSha256:'f'.repeat(64)});
 await s.host().alarm();s.f.clock(3000); // custom host clock below exercises all three persisted attempts
 await new BrowserPreviewBuildHost(s.f.storage,s.f.scope,s.ports,()=>3000).alarm();await new BrowserPreviewBuildHost(s.f.storage,s.f.scope,s.ports,()=>7000).alarm();const row=s.host().read(s.revision);assert.equal(row.state.status,'failed');assert.equal(s.f.puts,0);
 s.ports.resolveInitial=original;await s.host().retry(s.revision,'python-stdlib/v1',row.state.buildIdentity,'retry-initial-a');await s.host().alarm();assert.equal(s.host().read(s.revision).state.status,'ready');
 const r=await initial();r.ports.resolveInitial=async source=>{const value=await r.resolver.resolve(source.reference,r.f.scope);r.revoke();return value;};await r.host().alarm();assert.equal(r.f.puts,0);assert.equal(r.host().source(r.revision).filesSha256,null);
 assert.throws(()=>new BrowserPreviewBuildHost(r.f.storage,{...r.f.scope,tenantId:'tenant-b'},r.ports).source(r.revision),/read-denied/);
 await assert.rejects(r.resolver.resolve(r.source.reference,{...r.f.scope,tenantId:'tenant-b'}),/scope-denied/);
});
