import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './browser-preview-test-fixture.mjs';
import {BrowserPreviewOrchestrator} from '../../services/browser-preview/orchestrator.ts';
import {SimulationHost} from '../../services/simulation/host.ts';
import {platformPreviewDelivery} from '../../services/browser-preview/platform-delivery.ts';
import {createTrustedPreviewRegistry} from '../../services/browser-preview/profiles.ts';
import {canonicalPreviewJson,previewSha256} from '../../services/browser-preview/contract.ts';
import {productionPreviewRegistry} from '../../services/browser-preview/production-registry.ts';
const actor={userId:'user-a',authVersion:1};
async function setup(configure=async()=>{}){const f=await fixture();await configure(f);await f.host().alarm();let allowed=true,head={identity:f.source.identity,receipt:f.source.receipt},starts=0;
 const simulations=()=>new SimulationHost(f.storage,f.scope,{authorize:async()=>allowed,hold:()=>{},quota:{},start:async()=>{starts++;throw Error('no-native-execution-on-submit');},observe:async()=>{},stop:async()=>{},destroy:async()=>{},running:async()=>false,publish:async()=>{}},()=>1000);
 const ports={authorize:async()=>{if(!allowed)throw Error('browser-preview-access-denied');},checkScope:()=>{},head:()=>head,saved:id=>id==='revision-a'?{identity:f.source.identity,receipt:f.source.receipt}:null,registry:f.ports.registry,builds:f.host(),bucket:f.ports.bucket,files:async()=>f.bytes,simulations:simulations(),canVerify:()=>true,image:'fixture-image',delivery:hash=>platformPreviewDelivery('http://127.0.0.1:8795','http://localhost:8821',hash)};
 const body={revisionId:'revision-a',packageIdentity:f.host().read('revision-a').state.packageIdentity,parameters:{},seed:42,intent:'experiment',idempotencyKey:'verify-a'};
 return {f,ports,body,service:()=>new BrowserPreviewOrchestrator(f.storage,f.scope,{...ports,simulations:simulations()}),revoke:()=>{allowed=false;},get starts(){return starts;},newHead:()=>{head={...head,receipt:{...head.receipt,revisionId:'revision-b',filesSha256:'d'.repeat(64)}};}};
}
test('historical Verify freezes original saved model and actual SimulationHost intent survives refresh without rerun',async()=>{
 const s=await setup();s.newHead();const result=await s.service().verify(actor,s.body);assert.equal(result.experiment.version.revisionId,'revision-a');assert.equal(result.experiment.stale,true);assert.equal(s.starts,0);
 const before=structuredClone(s.f.storage.values),read=await s.service().verification(actor,'verify-a');assert.equal(read.status,'accepted');assert.equal(read.experiment.runId,result.experiment.runId);assert.equal(read.captured.revisionId,'revision-a');assert.equal(Object.hasOwn(read.captured,'idempotencyKey'),false);assert.deepEqual(s.f.storage.values,before);
 const repeated=await s.service().verify(actor,s.body);assert.equal(repeated.experiment.runId,result.experiment.runId);await assert.rejects(s.service().verify(actor,{...s.body,parameters:{customers:31}}),/idempotency-conflict/);assert.equal([...s.f.storage.values.keys()].filter(k=>k.startsWith('simulation:run:')).length,1);assert.equal(s.starts,0);
});
test('ACL revocation during source or R2 await refuses private read and creates no server Run',async()=>{
 for(const stage of ['files','r2']){const s=await setup();if(stage==='files')s.ports.files=async()=>{s.revoke();return s.f.bytes;};else{const original=s.ports.bucket.get;s.ports.bucket={...s.ports.bucket,get:async key=>{const result=await original(key);s.revoke();return result;}};}
  await assert.rejects(s.service().verify(actor,s.body),/access-denied/);assert.equal([...s.f.storage.values.keys()].filter(k=>k.startsWith('simulation:run:')).length,0);assert.equal([...s.f.storage.values.keys()].filter(k=>k.startsWith('browser-preview:verify:')).length,0);
 }
});
test('explicit historical profile survives removed current registry only with frozen delivery',async()=>{
 const s=await setup();s.ports.registry=async()=>{throw Error('current-registry-unavailable');};const view=await s.service().view(actor,'revision-a','python-stdlib/v1');assert.equal(view.build.status,'ready');assert.equal(view.delivery.profile.verified,true);const bytes=await s.service().bytes(actor,s.body.packageIdentity);assert.ok(bytes.bytes.length>0);
 s.ports.delivery=()=>{throw Error('missing-retained-version');};const absent=await s.service().view(actor,'revision-a','python-stdlib/v1');assert.equal(absent.build,null);assert.equal(absent.reasonCode,'preview-runtime-unavailable');await assert.rejects(s.service().bytes(actor,s.body.packageIdentity),/source-unavailable/);
});
test('view of a retained v1 ready row rearms migration before exposing an unavailable package',async()=>{
 const currentRegistry=await productionPreviewRegistry(),current=currentRegistry.resolve('python-stdlib/v1'),oldAssets=[...current.assets,{path:'runtime/retired-v1-marker.bin',sha256:'e'.repeat(64),byteLength:1}].sort((a,b)=>a.path<b.path?-1:1),old={...current,runtime:{...current.runtime,assetSha256:await previewSha256(canonicalPreviewJson(oldAssets))},assets:oldAssets},oldRegistry=await createTrustedPreviewRegistry([old]);
 const s=await setup(async f=>{f.ports.registry=async()=>oldRegistry;});const oldIdentity=s.f.host().read('revision-a','python-stdlib/v1').state.packageIdentity;s.f.ports.registry=async()=>currentRegistry;s.ports.registry=s.f.ports.registry;
 const migrating=await s.service().view(actor,'revision-a','python-stdlib/v1');assert.equal(migrating.build.status,'building');assert.equal(migrating.delivery,null);assert.equal(s.f.storage.values.get('browser-preview:discovery:revision-a').status,'pending');
 await s.f.host().alarm();const ready=await s.service().view(actor,'revision-a','python-stdlib/v1');assert.equal(ready.build.status,'ready');assert.notEqual(ready.build.packageIdentity,oldIdentity);assert.equal(ready.delivery.profile.runtime.assetSha256,current.runtime.assetSha256);
});
test('Verify rejects browser metrics, wrong package/revision and actor scope',async()=>{
 const s=await setup();await assert.rejects(s.service().verify(actor,{...s.body,metrics:{completed:999}}));await assert.rejects(s.service().verify(actor,{...s.body,revisionId:'missing'}),/not-found/);await assert.rejects(s.service().bytes(actor,'a'.repeat(64)),/not-found/);assert.equal(s.starts,0);
});

test('capture sync uncertainty and concurrent same-key retry freeze exactly one server Run',async()=>{
 const s=await setup();let lose=true;s.f.storage.sync=async()=>{if(lose&&[...s.f.storage.values.keys()].some(k=>k.startsWith('browser-preview:verify:'))){lose=false;throw Error('capture-sync-unknown');}};
 await assert.rejects(s.service().verify(actor,s.body),/capture-sync-unknown/);const pending=await s.service().verification(actor,'verify-a');assert.equal(pending.status,'absent');assert.equal(pending.captured.packageIdentity,s.body.packageIdentity);
 const [a,b]=await Promise.all([s.service().verify(actor,s.body),s.service().verify(actor,s.body)]);assert.equal(a.experiment.runId,b.experiment.runId);assert.equal([...s.f.storage.values.keys()].filter(k=>k.startsWith('simulation:run:')).length,1);assert.equal(s.starts,0);
});
test('retry GET is read-only, accepted key never resets and new explicit key recovers same package',async()=>{
 const s=await setup(),f=await fixture();f.storage.failReceipt=true;await f.host().alarm();const identity=f.host().read('revision-a').state.buildIdentity;f.clock(3000);await f.host().alarm();f.clock(7000);await f.host().alarm();assert.equal(f.host().read('revision-a').state.status,'failed');
 const ports={...s.ports,builds:f.host(),bucket:f.ports.bucket,saved:id=>id==='revision-a'?{identity:f.source.identity,receipt:f.source.receipt}:null,head:()=>({identity:f.source.identity,receipt:f.source.receipt})},service=()=>new BrowserPreviewOrchestrator(f.storage,f.scope,ports),body={revisionId:'revision-a',profileId:'python-stdlib/v1',buildIdentity:identity,idempotencyKey:'retry-a'};
 const ack=await service().retry(actor,body);assert.equal(ack.retryId,'retry-a');assert.equal(ack.status,'accepted');const before=structuredClone(f.storage.values),receipt=await service().retryVerification(actor,'retry-a');assert.equal(receipt.status,'accepted');assert.deepEqual(receipt.captured,{revisionId:body.revisionId,profileId:body.profileId,buildIdentity:identity});assert.deepEqual(f.storage.values,before);
 await f.host().alarm();f.clock(9000);await f.host().alarm();f.clock(13000);await f.host().alarm();assert.equal(f.host().read('revision-a').state.status,'failed');await service().retry(actor,body);assert.equal(f.storage.values.get('browser-preview:discovery:revision-a').attempts,3);assert.equal(f.storage.alarm,null);
 f.storage.failReceipt=false;await service().retry(actor,{...body,idempotencyKey:'retry-b'});await f.host().alarm();assert.equal(f.host().read('revision-a').state.packageIdentity,identity);assert.equal(f.puts,1);
});
test('Verify ready admission rechecks after awaited source and rejects wrong Workspace generation',async()=>{
 const s=await setup();let ready=true;s.ports.authorizeVerify=async()=>{if(!ready)throw Error('workspace-not-ready');};s.ports.files=async()=>{ready=false;return s.f.bytes;};await assert.rejects(s.service().verify(actor,s.body),/not-ready/);assert.equal([...s.f.storage.values.keys()].filter(k=>k.startsWith('simulation:run:')).length,0);
 const other=new BrowserPreviewOrchestrator(s.f.storage,{...s.f.scope,workspaceId:'other-workspace'},s.ports);await assert.rejects(other.bytes(actor,s.body.packageIdentity),/read-denied/);
 s.ports.checkScope=()=>{throw Error('workspace-actor-scope-denied');};await assert.rejects(s.service().view(actor),/scope-denied/);
});
