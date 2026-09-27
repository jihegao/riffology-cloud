import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkedPackage,checkedAssets} from './package-loader.mjs';
import {makeFixture} from './fixtures.mjs';
import {BROWSER_PREVIEW_JAVASCRIPT_SCHEMA,BROWSER_PREVIEW_JAVASCRIPT_SOURCE_PATHS,canonicalPreviewJson,createPreviewManifest,previewSha256} from '../contract.ts';
import {LIMITS} from './protocol.mjs';
const profiles=JSON.parse(await readFile(new URL('./assets/profiles.json',import.meta.url)));
const raw = value => new TextEncoder().encode(canonicalPreviewJson(value));
async function replaceFile(envelope,path,value){const copy=structuredClone(envelope),i=copy.files.findIndex(f=>f.path===path),bytes=raw(value);copy.files[i].base64=Buffer.from(bytes).toString('base64');const {packageIdentity,...input}=copy.manifest;input.sources[i]={path,sha256:await previewSha256(bytes),byteLength:bytes.length};copy.manifest=await createPreviewManifest(input);return copy;}
async function javascriptFixture(profile){
 const legacy=await makeFixture(profile),content=new Map(legacy.files.map(file=>[file.path,Uint8Array.from(Buffer.from(file.base64,'base64'))]));
 content.set('model/visualization.json',raw({schema:'riffology.visualization/v1',protocol:'riffology.visual/v0.1',renderer:'javascript-canvas',metricKeys:['completed']}));
 content.set('frontend/manifest.json',raw({schema:'riffology.browser-js/v1',hostApi:'riffology.browser-host/v1',entry:'frontend/main.mjs',width:600,height:420}));
 content.set('frontend/main.mjs',new TextEncoder().encode("export function render(context){return {schema:'riffology.browser-scene/v1',marks:[]}}"));
 const sources=await Promise.all(BROWSER_PREVIEW_JAVASCRIPT_SOURCE_PATHS.map(async path=>({path,sha256:await previewSha256(content.get(path)),byteLength:content.get(path).byteLength})));
 const {packageIdentity,...identity}=legacy.manifest;const manifest=await createPreviewManifest({...identity,schema:BROWSER_PREVIEW_JAVASCRIPT_SCHEMA,sources});
 return {manifest,files:BROWSER_PREVIEW_JAVASCRIPT_SOURCE_PATHS.map(path=>({path,base64:Buffer.from(content.get(path)).toString('base64')}))};
}
test('downloaded canonical package binds exact profile, input Spec, visualization and byte digests',async()=>{
 const fixture=await makeFixture(profiles[0]);const checked=await checkedPackage(raw(fixture),profiles);assert.equal(checked.manifest.packageIdentity,fixture.manifest.packageIdentity);assert.equal(checked.spec.parameters.servers.default,2);
 const damaged=structuredClone(fixture);damaged.files[0].base64=Buffer.from('tampered').toString('base64');await assert.rejects(checkedPackage(raw(damaged),profiles),/source-mismatch/);
 await assert.rejects(checkedPackage(new TextEncoder().encode(JSON.stringify(fixture,null,2)),profiles),/noncanonical/);
 const unpadded=structuredClone(fixture);const padded=unpadded.files.find(f=>f.base64.endsWith('='));assert(padded);padded.base64=padded.base64.replace(/=+$/,'');await assert.rejects(checkedPackage(raw(unpadded),profiles),/base64-invalid/);
 await assert.rejects(checkedPackage(raw(fixture),[]),/profile-unavailable/);
 const visual={schema:'riffology.visualization/v1',protocol:'riffology.visual/v0.1',renderer:'lane',metricKeys:['not_in_spec']};await assert.rejects(checkedPackage(raw(await replaceFile(fixture,'model/visualization.json',visual)),profiles),/visualization-invalid/);
 visual.metricKeys=['completed','completed'];await assert.rejects(checkedPackage(raw(await replaceFile(fixture,'model/visualization.json',visual)),profiles),/visualization-invalid/);
 const spec=structuredClone(checked.spec);spec.execution.entrypoint='model/other.py';await assert.rejects(checkedPackage(raw(await replaceFile(fixture,'model/model-spec.json',spec)),profiles),/entrypoint-invalid/);
 await assert.rejects(checkedPackage(raw(await replaceFile(fixture,'app/requirements.lock',{schemaVersion:1,packages:{micropip:'0.11.1'}})),profiles),/lock-mismatch/);
 const altered=structuredClone(fixture);altered.files[1].base64=Buffer.from('# forged server metrics\n').toString('base64');const {packageIdentity,...identity}=altered.manifest;identity.sources[1]={path:'model/run.py',sha256:await previewSha256('# forged server metrics\n'),byteLength:24};altered.manifest=await createPreviewManifest(identity);await assert.rejects(checkedPackage(raw(altered),profiles),/server-adapter-mismatch/);
});
test('v2 seven-file package binds the exact frontend manifest and source while v1 remains five files',async()=>{
 const fixture=await javascriptFixture(profiles[0]),checked=await checkedPackage(raw(fixture),profiles);
 assert.equal(checked.manifest.schema,BROWSER_PREVIEW_JAVASCRIPT_SCHEMA);assert.equal(checked.visualization.renderer,'javascript-canvas');assert.equal(checked.frontend.manifest.entry,'frontend/main.mjs');assert.match(checked.frontend.source,/export function render/);
 const missing=structuredClone(fixture);missing.files.pop();await assert.rejects(checkedPackage(raw(missing),profiles),/package-invalid/);
 const wrongRenderer=await replaceFile(fixture,'model/visualization.json',{schema:'riffology.visualization/v1',protocol:'riffology.visual/v0.1',renderer:'grid',metricKeys:['completed']});await assert.rejects(checkedPackage(raw(wrongRenderer),profiles),/package-schema-mismatch/);
 const redirected=await replaceFile(fixture,'frontend/manifest.json',{schema:'riffology.browser-js/v1',hostApi:'riffology.browser-host/v1',entry:'frontend/other.mjs',width:600,height:420});await assert.rejects(checkedPackage(raw(redirected),profiles),/js-frontend-invalid/);
});
test('fixed assets require exact count, original digest and original length; no HTTP fallback',async()=>{
 const bytes=new TextEncoder().encode('synthetic-fixed-asset'),asset={path:'assets/test',sha256:await previewSha256(bytes),byteLength:bytes.length};
 assert.deepEqual((await checkedAssets([{path:asset.path,bytes}],{assetManifest:[asset]})).get(asset.path),bytes);
 await assert.rejects(checkedAssets([],{assetManifest:[asset]}),/assets-invalid/);
 await assert.rejects(checkedAssets([{path:asset.path,bytes:new Uint8Array(bytes.length)}],{assetManifest:[asset]}),/assets-mismatch/);
});
test('committed profile identities include exact execution bundles and entire build input closure',async()=>{
 for(const profile of profiles){assert.equal(await previewSha256(canonicalPreviewJson(profile.assetManifest)),profile.runtime.assetSha256);assert.equal(await previewSha256(canonicalPreviewJson(LIMITS)),profile.runtime.limitsSha256);for(const path of ['delivery/worker.bundle.mjs','delivery/frame.bundle.mjs','source/contract.ts','source/model-spec.ts','source/package-lock.json','source/prepare-assets.mjs'])assert(profile.assetManifest.some(a=>a.path===path),path);for(const dep of profile.runtime.dependencies)assert(profile.assetManifest.some(a=>a.sha256===dep.sha256),dep.name);}
});
