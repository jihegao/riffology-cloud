import assert from 'node:assert/strict';
import test from 'node:test';
import {
 BROWSER_JS_ENTRY_MAX_BYTES,
 BROWSER_JS_HOST_API,
 BROWSER_JS_SCHEMA,
 BROWSER_PREVIEW_JAVASCRIPT_SCHEMA,
 BROWSER_PREVIEW_JAVASCRIPT_SOURCE_PATHS,
 BROWSER_PREVIEW_SCHEMA,
 BROWSER_PREVIEW_SOURCE_PATHS,
 canonicalPreviewJson,
 createPreviewManifest,
 parseBrowserJsManifest,
 parsePreviewIdentityInput,
 previewPackageIdentity,
 previewSha256,
} from '../../services/browser-preview/contract.ts';
import {packageCompatiblePreview,unpackPreviewPackage} from '../../services/browser-preview/packager.ts';
import {previewIdentityFixture} from '../../services/browser-preview/fixtures/identity.ts';

const legacyGoldenIdentity='375bcbd0a4e4bf073c4929c2356fea551b4ba0f3f758c8b5c7aa2babda24be6e';
const encode=(value:string)=>new TextEncoder().encode(value);

test('legacy five-file package keeps its exact v1 identity and byte set',async()=>{
 assert.deepEqual(BROWSER_PREVIEW_SOURCE_PATHS,[
  'model/model.py','model/run.py','model/model-spec.json','model/visualization.json','app/requirements.lock',
 ]);
 assert.equal(await previewPackageIdentity(previewIdentityFixture),legacyGoldenIdentity);
 const values=['model bytes','adapter bytes','spec bytes','visualization bytes','lock bytes'];
 const sources=await Promise.all(BROWSER_PREVIEW_SOURCE_PATHS.map(async(path,index)=>({path,sha256:await previewSha256(values[index]!),byteLength:encode(values[index]!).byteLength})));
 const identity={...previewIdentityFixture,sources};
 const profile={runtime:identity.runtime,assets:[],packages:{},trust:'test-fixture' as const};
 const packaged=await packageCompatiblePreview({
  identity,
  files:new Map(BROWSER_PREVIEW_SOURCE_PATHS.map((path,index)=>[path,encode(values[index]!) ])),
  spec:{} as never,
  visualization:{} as never,
  frontend:null,
  profile,
 });
 const unpacked=await unpackPreviewPackage(packaged.bytes);
 assert.equal(unpacked.manifest.schema,BROWSER_PREVIEW_SCHEMA);
 assert.deepEqual([...unpacked.files.keys()],BROWSER_PREVIEW_SOURCE_PATHS);
 for(const [index,path] of BROWSER_PREVIEW_SOURCE_PATHS.entries())assert.deepEqual(unpacked.files.get(path),encode(values[index]!));
 assert.equal(new TextDecoder().decode(packaged.bytes),canonicalPreviewJson(JSON.parse(new TextDecoder().decode(packaged.bytes))));
});

test('javascript package identity includes the exact v2 seven-file closure',async()=>{
 assert.deepEqual(BROWSER_PREVIEW_JAVASCRIPT_SOURCE_PATHS,[...BROWSER_PREVIEW_SOURCE_PATHS,'frontend/manifest.json','frontend/main.mjs']);
 const sources=await Promise.all(BROWSER_PREVIEW_JAVASCRIPT_SOURCE_PATHS.map(async(path,index)=>{
  const value=`source-${index}-${path}`;
  return {path,sha256:await previewSha256(value),byteLength:encode(value).byteLength};
 }));
 const input={...previewIdentityFixture,schema:BROWSER_PREVIEW_JAVASCRIPT_SCHEMA,sources};
 const parsed=parsePreviewIdentityInput({...input,sources:[...sources].reverse()});
 assert.equal(parsed.schema,BROWSER_PREVIEW_JAVASCRIPT_SCHEMA);
 assert.deepEqual(parsed.sources.map(source=>source.path),BROWSER_PREVIEW_JAVASCRIPT_SOURCE_PATHS);
 const identity=await previewPackageIdentity(input);
 for(const path of ['frontend/manifest.json','frontend/main.mjs'] as const){
  const changed={...input,sources:sources.map(source=>source.path===path?{...source,sha256:'f'.repeat(64)}:source)};
  assert.notEqual(await previewPackageIdentity(changed),identity,path);
 }
 assert.throws(()=>parsePreviewIdentityInput({...input,schema:BROWSER_PREVIEW_SCHEMA}),/contract-invalid/);
 assert.throws(()=>parsePreviewIdentityInput({...previewIdentityFixture,schema:BROWSER_PREVIEW_JAVASCRIPT_SCHEMA}),/contract-invalid/);
 assert.throws(()=>parsePreviewIdentityInput({...input,sources:sources.map(source=>source.path==='frontend/main.mjs'?{...source,byteLength:BROWSER_JS_ENTRY_MAX_BYTES+1}:source)}),/contract-invalid/);
});

test('javascript frontend manifest is exact and cannot redirect its entry or dimensions',()=>{
 const manifest={schema:BROWSER_JS_SCHEMA,hostApi:BROWSER_JS_HOST_API,entry:'frontend/main.mjs' as const,width:600 as const,height:420 as const};
 assert.deepEqual(parseBrowserJsManifest(manifest),manifest);
 for(const changed of [
  {...manifest,entry:'frontend/other.mjs'},
  {...manifest,hostApi:'riffology.browser-host/v2'},
  {...manifest,width:601},
  {...manifest,height:421},
  {...manifest,network:true},
 ])assert.throws(()=>parseBrowserJsManifest(changed),/contract-invalid/);
});
