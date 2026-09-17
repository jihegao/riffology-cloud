import assert from 'node:assert/strict';
import test from 'node:test';
import profiles from '../../services/browser-preview/runtime/assets/profiles.json' with {type:'json'};
import delivery from '../../services/browser-preview/runtime/assets/delivery.json' with {type:'json'};
import {productionPreviewRegistry,reviewedPreviewInventory} from '../../services/browser-preview/production-registry.ts';
import {makeFixture} from '../../services/browser-preview/runtime/fixtures.mjs';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {workspaceArchiveReader} from '../../services/turn-runtime/workspace-file-index.ts';
import {validateSavedPreview} from '../../services/browser-preview/validator.ts';
import {packageCompatiblePreview,unpackPreviewPackage} from '../../services/browser-preview/packager.ts';
import {PREVIEW_SERVER_ADAPTER_SHA256} from '../../services/browser-preview/profiles.ts';
import {previewSha256} from '../../services/browser-preview/contract.ts';
test('committed reviewed production inventory resolves fixed profiles with immutable executable closure',async()=>{
 const registry=await productionPreviewRegistry();
 for(const p of profiles){const resolved=registry.resolve(p.runtime.profileId);assert.equal(resolved.trust,'verified-platform');assert.deepEqual(resolved.runtime,p.runtime);assert.deepEqual(resolved.assets,p.assetManifest);assert.deepEqual(resolved.packages,p.packages);}
 const unreviewed=structuredClone(profiles);unreviewed[0].verified=false;await assert.rejects(reviewedPreviewInventory(unreviewed,delivery),/production-inventory-invalid/);
 const poisoned=structuredClone(delivery);poisoned.profiles[0]='a'.repeat(64);await assert.rejects(reviewedPreviewInventory(profiles,poisoned),/production-inventory-invalid/);
 const moduleWorker=structuredClone(delivery);moduleWorker.executionBuildOptions.format='esm';await assert.rejects(reviewedPreviewInventory(profiles,moduleWorker),/production-inventory-invalid/);
 const absent=structuredClone(profiles);absent[0].assetManifest=absent[0].assetManifest.filter(a=>a.path!=='delivery/worker.bundle.mjs');await assert.rejects(reviewedPreviewInventory(absent,delivery),/production-inventory-invalid/);
});
for(const [kind,profileId] of [['queue','python-stdlib/v1'],['mesa','mesa-3.5.1/v1']])test(`real saved ${kind} archive validates and packages against verified platform profile with stable bytes`,async()=>{
 const profile=profiles.find(p=>p.runtime.profileId===profileId),runtimeFixture=await makeFixture(profile,kind);
 const files=Object.fromEntries(runtimeFixture.files.map(file=>[file.path,new Uint8Array(Buffer.from(file.base64,'base64'))]));
 assert.equal(await previewSha256(files['model/run.py']),PREVIEW_SERVER_ADAPTER_SHA256);
 // makeFixture's concatenation digest belongs only to its runtime-isolation fixture.
 // Build a genuine canonical saved-file archive and resolve its authority hash here.
 const archive=initialWorkspaceArchive(files),filesSha256=await workspaceArchiveReader(archive).sha256();
 assert.notEqual(filesSha256,runtimeFixture.manifest.filesSha256);
 const source={projectId:`saved-${kind}-test`,revisionId:`revision-${kind}-saved`,filesSha256};
 const registry=await productionPreviewRegistry(),checked=await validateSavedPreview(source,archive,profileId,registry);assert.equal(checked.status,'compatible');
 const first=await packageCompatiblePreview(checked.value);assert.equal(first.trust,'verified-platform');assert.equal(first.manifest.filesSha256,filesSha256);assert.equal(first.manifest.revisionId,source.revisionId);assert.notEqual(first.manifest.packageIdentity,runtimeFixture.manifest.packageIdentity);
 const again=await validateSavedPreview(source,archive,profileId,registry),second=await packageCompatiblePreview(again.value);assert.equal(second.manifest.packageIdentity,first.manifest.packageIdentity);assert.deepEqual(second.bytes,first.bytes);
 const unpacked=await unpackPreviewPackage(first.bytes);for(const [path,bytes]of unpacked.files)assert.deepEqual(bytes,files[path]);
 const changed={...files,'model/run.py':new TextEncoder().encode('import json\nfrom model import run\nprint("fake metrics")\n')},fakeArchive=initialWorkspaceArchive(changed);
 assert.deepEqual(await validateSavedPreview({...source,filesSha256:await workspaceArchiveReader(fakeArchive).sha256()},fakeArchive,profileId,registry),{status:'unsupported',reasonCode:'python-unsupported'});
});
