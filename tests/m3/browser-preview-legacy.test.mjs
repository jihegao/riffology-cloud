import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import profiles from '../../services/browser-preview/runtime/assets/profiles.json' with {type:'json'};
import {makeFixture} from '../../services/browser-preview/runtime/fixtures.mjs';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {previewSha256} from '../../services/browser-preview/contract.ts';
import {validateSavedPreview,PREVIEW_VALIDATION_VERSION} from '../../services/browser-preview/validator.ts';
import {packageCompatiblePreview} from '../../services/browser-preview/packager.ts';
import {checkedPackage} from '../../services/browser-preview/runtime/package-loader.mjs';
import {discoveryKey} from '../../services/browser-preview/discovery.ts';
import {fixture} from './browser-preview-test-fixture.mjs';

for(const index of [0,1])test(`legacy platform wrapper profile ${index}: exact bytes, bounded migration and no source mutation`,async()=>{
 const f=await fixture(index),profile=profiles[index],raw=await makeFixture(profile,index?'mesa':'queue');
 const files=Object.fromEntries(raw.files.map(x=>[x.path,Buffer.from(x.base64,'base64')]));
 files['model/run.py']=await readFile(new URL('../fixtures/preview-legacy-run.py',import.meta.url));
 assert.equal(await previewSha256(files['model/run.py']),'fa7987095bbc29f2c6d87e9b0f815415f88c9079ad7070fb7fe8b91e7ebf0898');
 const bytes=initialWorkspaceArchive(files),sha=await previewSha256(bytes);
 f.source.receipt.filesSha256=sha;f.ports.files=async()=>bytes;f.storage.values.set(discoveryKey('revision-a'),f.source);
 const registry=await f.ports.registry(),source={projectId:f.scope.projectId,revisionId:'revision-a',filesSha256:sha};
 const checked=await validateSavedPreview(source,bytes,profile.runtime.profileId,registry);assert.equal(checked.status,'compatible');
 const pkg=await packageCompatiblePreview(checked.value);
 const loaded=await checkedPackage(pkg.bytes,profiles);assert.equal(loaded.manifest.filesSha256,sha);assert.deepEqual(loaded.files.get('model/run.py'),new Uint8Array(files['model/run.py']));
 // Simulate persisted rejection produced by the old validator, then restart.
 await f.host().alarm();
 for(const p of profiles){const key='browser-preview:build:revision-a:'+p.runtime.profileId,row=f.storage.values.get(key);f.storage.values.set(key,{...row,validationVersion:undefined,receipt:null,modelSpec:null,state:{status:'unsupported',revisionId:'revision-a',profileId:p.runtime.profileId,buildIdentity:'a'.repeat(64),reasonCode:p.runtime.profileId===profile.runtime.profileId?'python-unsupported':'dependency-unsupported'}});}
 assert.equal(f.host().read('revision-a').state.reasonCode,'python-unsupported');
 assert.equal(await f.host().rearmStaleReady('revision-a'),true);
 await f.host().alarm();assert.equal(f.host().read('revision-a').state.status,'ready');assert.equal(f.host().read('revision-a').receipt.packageIdentity,pkg.manifest.packageIdentity);
 const reads=f.reads;assert.equal(await f.host().rearmStaleReady('revision-a'),false);assert.equal(f.reads,reads);assert.equal(await previewSha256(bytes),sha);
 // An arbitrary adapter is still rejected, even a one-byte modification.
 files['model/run.py']=Buffer.concat([files['model/run.py'],Buffer.from('\n')]);const changed=initialWorkspaceArchive(files);
 assert.deepEqual(await validateSavedPreview({...source,filesSha256:await previewSha256(changed)},changed,profile.runtime.profileId,registry),{status:'unsupported',reasonCode:'python-unsupported'});
});

test('current unsupported validation is not automatically retried on each read',async()=>{
 const f=await fixture();f.ports.files=async()=>initialWorkspaceArchive({});
 const key='browser-preview:build:revision-a:python-stdlib/v1';
 f.storage.values.set(key,{schemaVersion:1,validationVersion:PREVIEW_VALIDATION_VERSION,source:f.source,profile:null,modelSpec:null,receipt:null,state:{status:'unsupported',revisionId:'revision-a',profileId:'python-stdlib/v1',buildIdentity:'a'.repeat(64),reasonCode:'dependency-unsupported'}});
 assert.equal(await f.host().rearmStaleReady('revision-a'),false);
});
