import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import profiles from '../../services/browser-preview/runtime/assets/profiles.json' with {type:'json'};
import {makeFixture} from '../../services/browser-preview/runtime/fixtures.mjs';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {previewSha256} from '../../services/browser-preview/contract.ts';
import {validateSavedPreview,parsePreviewVisualization,PREVIEW_VALIDATION_VERSION} from '../../services/browser-preview/validator.ts';
import {packageCompatiblePreview} from '../../services/browser-preview/packager.ts';
import {checkedPackage} from '../../services/browser-preview/runtime/package-loader.mjs';
import {fixture} from './browser-preview-test-fixture.mjs';
import retainedIndex from '../../services/browser-preview/execution/retained/pre-142.json' with {type:'json'};
import pre142Profiles from '../../services/browser-preview/execution/retained/profiles-pre-142.json' with {type:'json'};
import baselineIndex from '../../services/browser-preview/execution/retained/727c40f.json' with {type:'json'};
import {browserPreviewStaticIndex} from '../../services/browser-preview/execution/assets/static-index.ts';

test('saved Python Canvas source is opt-in, versioned, and requires a draw hook',async()=>{
  assert.equal(PREVIEW_VALIDATION_VERSION,'reviewed-platform-adapters/v3');
  const f=await fixture(0),registry=await f.ports.registry(),raw=await makeFixture(profiles[0],'traffic');
  const files=Object.fromEntries(raw.files.map(item=>[item.path,Buffer.from(item.base64,'base64')]));
  const source=async values=>{const archive=initialWorkspaceArchive(values);return {archive,identity:{projectId:f.scope.projectId,revisionId:'revision-canvas',filesSha256:await previewSha256(archive)}};};
  const saved=await source(files);
  const checked=await validateSavedPreview(saved.identity,saved.archive,'python-stdlib/v1',registry);
  assert.equal(checked.status,'compatible');
  assert.equal(checked.value.visualization.renderer,'python-canvas');
  const pkg=await packageCompatiblePreview(checked.value);
  const loaded=await checkedPackage(pkg.bytes,profiles);
  assert.equal(loaded.visualization.renderer,'python-canvas');
  assert.equal(loaded.manifest.packageIdentity,pkg.manifest.packageIdentity);

  const noDraw={...files,'model/model.py':Buffer.from((await readFile(new URL('../../services/browser-preview/runtime/fixtures/traffic.py',import.meta.url),'utf8')).split('\ndef draw(')[0])};
  const missing=await source(noDraw);
  assert.deepEqual(await validateSavedPreview(missing.identity,missing.archive,'python-stdlib/v1',registry),{status:'unsupported',reasonCode:'python-unsupported'});
  const invalid={...files,'model/visualization.json':Buffer.from(JSON.stringify({schema:'riffology.visualization/v1',protocol:'riffology.visual/v0.1',renderer:'python-canvas',metricKeys:['cars_in_network'],script:'alert(1)'}))};
  const rejected=await source(invalid);
  assert.deepEqual(await validateSavedPreview(rejected.identity,rejected.archive,'python-stdlib/v1',registry),{status:'unsupported',reasonCode:'visualization-invalid'});
  assert.throws(()=>parsePreviewVisualization({...loaded.visualization,script:'alert(1)'},loaded.spec),/visualization-invalid/);

  const legacy={...files,'model/visualization.json':Buffer.from(JSON.stringify({...loaded.visualization,renderer:'grid'}))};
  const old=await source(legacy),legacyChecked=await validateSavedPreview(old.identity,old.archive,'python-stdlib/v1',registry);
  assert.equal(legacyChecked.status,'compatible');
  const legacyPackage=await packageCompatiblePreview(legacyChecked.value);
  assert.notEqual(legacyPackage.manifest.packageIdentity,pkg.manifest.packageIdentity);
});

test('pre-142 retained host and dependency lock remain byte-exact for future source changes',async()=>{
  const oldLock=pre142Profiles[0].assetManifest.find(item=>item.path==='source/package-lock.json');
  assert.ok(oldLock);
  for(const expectedSha of [retainedIndex.delivery.hostModule.sha256,oldLock.sha256]){
    const asset=retainedIndex.assets.find(item=>item.kind==='app'&&item.sha256===expectedSha);
    assert.ok(asset);
    const bytes=await readFile(new URL(`../../services/browser-preview/execution/retained/pre-142-bytes/app-assets/${asset.file}`,import.meta.url));
    assert.equal(bytes.length,asset.byteLength);
    assert.equal(await previewSha256(bytes),asset.sha256);
  }
});

test('every historical delivery byte remains available in a clean checkout',async()=>{
  const generated=new Set(profiles.flatMap(profile=>profile.assetManifest.map(asset=>`/browser-preview-assets/${asset.sha256}/${asset.path}`)));
  generated.add(browserPreviewStaticIndex.delivery.hostModule.url);
  generated.add(browserPreviewStaticIndex.delivery.rendererModule.url);
  for(const profile of profiles)generated.add(browserPreviewStaticIndex.versions[profile.runtime.assetSha256].frameDocument.url);
  const historical=new Map([...baselineIndex.assets,...retainedIndex.assets].map(asset=>[asset.url,asset]));
  let frozen=0;
  for(const asset of historical.values()){
    if(generated.has(asset.url))continue;
    const bucket=asset.kind==='app'?'app-assets':'execution-assets';
    const locations=[`../../services/browser-preview/execution/retained/bytes/${asset.file}`,`../../services/browser-preview/execution/retained/pre-142-bytes/${bucket}/${asset.file}`];
    let bytes=null;
    for(const location of locations){try{bytes=await readFile(new URL(location,import.meta.url));break;}catch(error){if(error.code!=='ENOENT')throw error;}}
    assert.ok(bytes,`missing retained bytes: ${asset.url}`);
    assert.equal(bytes.length,asset.byteLength,asset.url);
    assert.equal(await previewSha256(bytes),asset.sha256,asset.url);
    frozen++;
  }
  assert.ok(frozen>=12);
});

test('unchanged server model/run.py executes the same Canvas model source without visual APIs',async()=>{
  const raw=await makeFixture(profiles[0],'traffic'),files=Object.fromEntries(raw.files.map(item=>[item.path,Buffer.from(item.base64,'base64')]));
  const directory=await mkdtemp(join(tmpdir(),'riffology-canvas-'));
  try{
    for(const path of ['model/model.py','model/run.py','model/model-spec.json'])await writeFile(join(directory,path.slice(6)),files[path]);
    await writeFile(join(directory,'input.json'),JSON.stringify({schemaVersion:1,runId:'local-server-contract',parameters:{steps:2,grid_size:15},seed:7}));
    execFileSync('python3',[join(directory,'run.py'),'--input',join(directory,'input.json'),'--output',join(directory,'result.json')],{timeout:10000});
    const result=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
    assert.deepEqual(result.metrics,{cars_in_network:1,average_speed:1});
    const summary=JSON.parse(await readFile(join(directory,'summary.json'),'utf8'));
    assert.equal(summary.model,'traffic-python-canvas');assert.equal(summary.frame,2);
  }finally{await rm(directory,{recursive:true,force:true});}
});
