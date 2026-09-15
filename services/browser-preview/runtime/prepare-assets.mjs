import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {canonicalPreviewJson, previewSha256} from '../contract.ts';
import {LIMITS} from './protocol.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = resolve(root, '.local/browser-preview');
const metadata = JSON.parse(await readFile(new URL('./assets/upstream.json', import.meta.url)));
await mkdir(resolve(output,'assets'),{recursive:true});
for (const expected of metadata.assets) {
  const path = resolve(output,expected.path);
  let bytes; try {bytes = await readFile(path);} catch {}
  if (!bytes || bytes.length !== expected.byteLength || await previewSha256(bytes) !== expected.sha256) {
    const response = await fetch(expected.url,{signal:AbortSignal.timeout(120000)}); if (!response.ok) throw Error('runtime-asset-download-failed');
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== expected.byteLength || await previewSha256(bytes) !== expected.sha256) throw Error('runtime-asset-download-mismatch');
    await writeFile(path,bytes);
  }
}
const sources = ['worker.mjs','host.mjs','frame.mjs','renderer.mjs','package-loader.mjs','protocol.mjs','frame.html'];
const runtimeAssets = await Promise.all(sources.map(async file => {const bytes = await readFile(new URL(file,import.meta.url)); return {path:'runtime/'+file,sha256:await previewSha256(bytes),byteLength:bytes.length};}));
for (const [path,file] of [['source/contract.ts','services/browser-preview/contract.ts'],['source/model-spec.ts','services/simulation/model-spec.ts'],['source/package-lock.json','package-lock.json'],['source/prepare-assets.mjs','services/browser-preview/runtime/prepare-assets.mjs']]) {
  const bytes = await readFile(resolve(root,file));runtimeAssets.push({path,sha256:await previewSha256(bytes),byteLength:bytes.length});
}
// Execution bundles do not import the registry: hash actual bytes before producing it.
for (const entry of ['worker','frame']) {
  const path = resolve(output,`${entry}.bundle.mjs`);
  await build({entryPoints:[resolve(root,`services/browser-preview/runtime/${entry}.mjs`)],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:path,external:['node:*','ws'],logLevel:'warning'});
  const bytes = await readFile(path);runtimeAssets.push({path:`delivery/${entry}.bundle.mjs`,sha256:await previewSha256(bytes),byteLength:bytes.length});
  const immutable = resolve(output,'delivery',await previewSha256(bytes),`${entry}.bundle.mjs`);
  await mkdir(dirname(immutable),{recursive:true});
  try {await writeFile(immutable,bytes,{flag:'wx'});} catch (error) {if(error.code !== 'EEXIST' || await previewSha256(await readFile(immutable)) !== await previewSha256(bytes)) throw error;}
}
const profiles = [];
for (const [profileId, mesa] of [['python-stdlib/v1',false],['mesa-3.5.1/v1',true]]) {
  const fixed = metadata.assets.filter(a => mesa || !a.path.endsWith('.whl')).map(({path,sha256,byteLength}) => ({path,sha256,byteLength}));
  const assetManifest = [...fixed,...runtimeAssets].sort((a,b) => a.path < b.path ? -1 : 1);
  const dependencies = mesa ? [...metadata.dependencies].sort((a,b) => a.name < b.name ? -1 : 1) : [];
  const runtime = {profileId,runtimeVersion:'pyodide-314.0.6/v1',adapterVersion:'riffology.model-run/v1',pythonVersion:metadata.pythonVersion,assetSha256:await previewSha256(canonicalPreviewJson(assetManifest)),visualProtocol:'riffology.visual/v0.1',limitsSha256:await previewSha256(canonicalPreviewJson(LIMITS)),dependencies};
  profiles.push({runtime,packages:mesa ? {mesa:'3.5.1',networkx:'3.6.1',numpy:'2.4.6',pandas:'3.0.2',scipy:'1.18.0',tqdm:'4.67.3'} : {},assetManifest,verified:true});
}
const profilePath = new URL('./assets/profiles.json',import.meta.url);
if (process.argv.includes('--update-manifest')) await writeFile(profilePath, JSON.stringify(profiles,null,2)+'\n');
else if (canonicalPreviewJson(JSON.parse(await readFile(profilePath))) !== canonicalPreviewJson(profiles)) throw Error('runtime-profile-source-changed: review and run --update-manifest');
await build({entryPoints:[resolve(root,'services/browser-preview/runtime/host.mjs')],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:resolve(output,'host.bundle.mjs'),external:['node:*','ws'],logLevel:'warning'});
const hostBytes = await readFile(resolve(output,'host.bundle.mjs'));
const delivery={schema:'riffology.browser-runtime-delivery/v1',profiles:profiles.map(p => p.runtime.assetSha256),host:{sha256:await previewSha256(hostBytes),byteLength:hostBytes.length},esbuildVersion:(await import('esbuild')).version,buildOptions:{bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*','ws']}};
const deliveryPath=new URL('./assets/delivery.json',import.meta.url);
if(process.argv.includes('--update-manifest'))await writeFile(deliveryPath,JSON.stringify(delivery,null,2)+'\n');
else if(canonicalPreviewJson(JSON.parse(await readFile(deliveryPath)))!==canonicalPreviewJson(delivery))throw Error('runtime-delivery-mismatch: host receipt changed');
await writeFile(resolve(output,'delivery.json'),JSON.stringify(delivery,null,2)+'\n');
console.log(JSON.stringify({profiles:profiles.map(p => ({profileId:p.runtime.profileId,assetSha256:p.runtime.assetSha256,dependencyCount:p.runtime.dependencies.length,assetBytes:p.assetManifest.reduce((n,a) => n+a.byteLength,0)})),bundles:output},null,2));
