import test from 'node:test';
import assert from 'node:assert/strict';
import profiles from '../../services/browser-preview/runtime/assets/profiles.json' with {type:'json'};
import {makeFixture} from '../../services/browser-preview/runtime/fixtures.mjs';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {canonicalPreviewJson,previewSha256} from '../../services/browser-preview/contract.ts';
import {productionPreviewRegistry} from '../../services/browser-preview/production-registry.ts';
import {createTrustedPreviewRegistry} from '../../services/browser-preview/profiles.ts';
import {BrowserPreviewBuildHost} from '../../services/browser-preview/build-host.ts';
import {discoveryKey} from '../../services/browser-preview/discovery.ts';
import {BROWSER_BUILD_WAKE_KEY} from '../../services/workspace/shared-alarm.ts';
import {fixture} from './browser-preview-test-fixture.mjs';
for(const index of [0,1])test(`durable profile ${index} packages real saved archive with reference before create-only write`,async()=>{
 const f=await fixture(index);await f.host().alarm();const row=f.host().read('revision-a');assert.equal(row.state.status,'ready');assert.equal(row.profile.trust,'verified-platform');assert.deepEqual(row.profile.runtime,profiles[index].runtime);assert.equal(row.receipt.revisionId,'revision-a');assert.equal(f.puts,1);assert.equal(f.storage.alarm,null);assert.equal(f.storage.values.get(discoveryKey('revision-a')).status,'settled');assert.deepEqual(f.host().receipt(row.receipt.packageIdentity),row.receipt);
});
test('lost receipt commit reconciles same object after host restart, preserving durable reference',async()=>{
 const f=await fixture();f.storage.failReceipt=true;await f.host().alarm();assert.equal(f.host().read('revision-a').state.status,'building');assert.equal(f.objects.size,1);const id=f.host().read('revision-a').state.buildIdentity;
 f.storage.failReceipt=false;f.clock(3000);await f.host().alarm();assert.equal(f.host().read('revision-a').state.status,'ready');assert.equal(f.host().read('revision-a').state.packageIdentity,id);assert.equal(f.puts,1);assert.equal(f.storage.alarm,null);
});
test('three transport attempts terminate durably and concurrent alarm shares one advance',async()=>{
 const f=await fixture();f.ports.files=async()=>{throw Error('unavailable');};const h=f.host();await Promise.all([h.alarm(),h.alarm()]);assert.equal(f.storage.values.get(discoveryKey('revision-a')).attempts,1);f.clock(3000);await f.host().alarm();f.clock(7000);await f.host().alarm();assert.equal(f.host().read('revision-a').state.status,'failed');assert.equal(f.storage.alarm,null);assert.equal(f.storage.values.get(discoveryKey('revision-a')).attempts,3);
});
test('unknown source dependencies settle unsupported without R2 ready',async()=>{
 const f=await fixture(),p=profiles[0],raw=await makeFixture(p,'queue');const files=Object.fromEntries(raw.files.map(f=>[f.path,Buffer.from(f.base64,'base64')]));files['app/requirements.lock']=Buffer.from(JSON.stringify({schemaVersion:1,packages:{evil:'1'}}));const bytes=initialWorkspaceArchive(files);f.source.receipt.filesSha256=await previewSha256(bytes);f.storage.values.set(discoveryKey('revision-a'),f.source);f.ports.files=async()=>bytes;await f.host().alarm();assert.equal(f.host().read('revision-a').state.status,'unsupported');assert.equal(f.objects.size,0);assert.equal(f.storage.alarm,null);
});

test('settled v1 ready row automatically rearms and rebuilds against the current trusted runtime profile',async()=>{
 const f=await fixture(),currentRegistry=await productionPreviewRegistry(),current=currentRegistry.resolve('python-stdlib/v1');
 const oldAssets=[...current.assets,{path:'runtime/retired-v1-marker.bin',sha256:'e'.repeat(64),byteLength:1}].sort((a,b)=>a.path<b.path?-1:1),old={...current,runtime:{...current.runtime,assetSha256:await previewSha256(canonicalPreviewJson(oldAssets))},assets:oldAssets};
 const oldRegistry=await createTrustedPreviewRegistry([old]);f.ports.registry=async()=>oldRegistry;await f.host().alarm();
 const v1=f.host().read('revision-a','python-stdlib/v1');assert.equal(v1.state.status,'ready');assert.equal(v1.profile.runtime.assetSha256,old.runtime.assetSha256);assert.equal(f.storage.values.get(discoveryKey('revision-a')).status,'settled');
 f.ports.registry=async()=>currentRegistry;assert.deepEqual((await Promise.all([f.host().rearmStaleReady('revision-a'),f.host().rearmStaleReady('revision-a')])).sort(),[false,true]);
 const rearmed=f.host().read('revision-a','python-stdlib/v1');assert.equal(rearmed.state.status,'building');assert.equal(rearmed.profile,null);assert.equal(rearmed.receipt,null);assert.equal(f.storage.values.get(discoveryKey('revision-a')).status,'pending');assert.equal(f.storage.alarm,1000);
 await f.host().alarm();const v2=f.host().read('revision-a','python-stdlib/v1');assert.equal(v2.state.status,'ready');assert.equal(v2.profile.runtime.assetSha256,current.runtime.assetSha256);assert.notEqual(v2.state.packageIdentity,v1.state.packageIdentity);assert.equal(f.objects.size,2);assert.equal(f.storage.values.get(discoveryKey('revision-a')).status,'settled');
});

test('new saved discovery preserves earlier build retry and uses local journal time',async()=>{
 const {projectPreviewDiscoveries}=await import('../../services/browser-preview/discovery.ts');
 const f=await fixture(),storage=f.storage;storage.values.set(BROWSER_BUILD_WAKE_KEY,500);
 const state={scope:f.scope,manualOperations:{},turns:{'turn-b':{id:'turn-b',sessionId:'session-a',dispatchId:'dispatch-b',runtimeGeneration:1,persistenceOutcome:'saved',finishedAt:2000,checkpoint:{...f.source.receipt,revisionId:'revision-b',committedAt:9000}}}};
 await storage.transaction(tx=>projectPreviewDiscoveries(tx,state,null));
 assert.equal(storage.values.get(discoveryKey('revision-b')).nextAttemptAt,2000);assert.equal(storage.alarm,500);assert.equal(storage.values.get(BROWSER_BUILD_WAKE_KEY),500);
});

test('Mesa storage failure never overwrites stdlib unsupported and frozen platform profile reconciles after registry update',async()=>{
 const f=await fixture(1);f.storage.failReceipt=true;await f.host().alarm();const original=f.host().read('revision-a','mesa-3.5.1/v1');assert.equal(original.state.status,'building');
 const {createTrustedPreviewRegistry}=await import('../../services/browser-preview/profiles.ts');f.ports.registry=()=>createTrustedPreviewRegistry([]);f.storage.failReceipt=false;f.clock(3000);await f.host().alarm();
 assert.equal(f.host().read('revision-a','mesa-3.5.1/v1').state.status,'ready');assert.equal(f.host().read('revision-a','mesa-3.5.1/v1').state.packageIdentity,original.state.buildIdentity);assert.equal(f.puts,1);assert.equal(f.host().read('revision-a','python-stdlib/v1').state.status,'unsupported');
 const failed=await fixture(1);failed.storage.failReceipt=true;await failed.host().alarm();failed.clock(3000);await failed.host().alarm();failed.clock(7000);await failed.host().alarm();assert.equal(failed.host().read('revision-a','mesa-3.5.1/v1').state.status,'failed');assert.equal(failed.host().read('revision-a','python-stdlib/v1').state.status,'unsupported');
});

test('restart after third durable rearm performs no fourth source or R2 operation',async()=>{
 const f=await fixture();f.storage.failReceipt=true;await f.host().alarm();const row=f.host().read('revision-a'),reads=f.reads,puts=f.puts;
 const saved=f.storage.values.get(discoveryKey('revision-a'));f.storage.values.set(discoveryKey('revision-a'),{...saved,attempts:3,nextAttemptAt:7000});f.clock(7000);await f.host().alarm();
 assert.equal(f.reads,reads);assert.equal(f.puts,puts);assert.equal(f.host().read('revision-a').state.status,'failed');assert.equal(f.host().read('revision-a').state.buildIdentity,row.state.buildIdentity);assert.equal(f.storage.alarm,null);
});
test('frozen compatible row becoming unsupported cannot settle with an orphan building status',async()=>{
 const f=await fixture(1),profile=await f.ports.registry();f.storage.values.set('browser-preview:build:revision-a:python-stdlib/v1',{schemaVersion:1,source:f.source,profile:profile.resolve('python-stdlib/v1'),modelSpec:null,receipt:null,state:{status:'building',revisionId:'revision-a',profileId:'python-stdlib/v1',buildIdentity:'a'.repeat(64),attempt:1}});
 await f.host().alarm();assert.equal(f.host().read('revision-a','python-stdlib/v1').state.status,'building');assert.equal(f.storage.values.get(discoveryKey('revision-a')).status,'pending');f.clock(3000);await f.host().alarm();f.clock(7000);await f.host().alarm();assert.equal(f.host().read('revision-a','python-stdlib/v1').state.status,'failed');assert.equal(f.host().read('revision-a','python-stdlib/v1').state.buildIdentity,'a'.repeat(64));assert.equal(f.storage.alarm,null);
});

for(const index of [0,1])test('source unavailable placeholder recovers matching profile '+index+' without blocking behind unsupported sibling',async()=>{
 const f=await fixture(index),files=f.ports.files;f.ports.files=async()=>{throw Error('source-unavailable');};
 await f.host().alarm();f.clock(3000);await f.host().alarm();f.clock(7000);await f.host().alarm();
 for(const id of ['python-stdlib/v1','mesa-3.5.1/v1']){const failed=f.host().read('revision-a',id);assert.equal(failed.state.status,'failed');assert.equal(failed.profile,null);assert.equal(failed.modelSpec,null);assert.equal(failed.receipt,null);}
 const id=profiles[index].runtime.profileId,failed=f.host().read('revision-a',id);f.ports.files=files;await f.host().retry('revision-a',id,failed.state.buildIdentity,'retry-source-'+index);await f.host().alarm();
 const ready=f.host().read('revision-a',id);assert.equal(ready.state.status,'ready');assert.equal(ready.state.revisionId,'revision-a');assert.equal(ready.profile.trust,'verified-platform');assert.equal(f.host().read('revision-a',profiles[1-index].runtime.profileId).state.status,'unsupported');assert.equal(f.puts,1);assert.equal(f.storage.alarm,null);
 await f.host().retry('revision-a',id,failed.state.buildIdentity,'retry-source-'+index);assert.equal(f.host().read('revision-a',id).state.packageIdentity,ready.state.packageIdentity);assert.equal(f.storage.alarm,null);
});
