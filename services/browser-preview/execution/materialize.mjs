import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,version as esbuildVersion} from 'esbuild';
import {canonicalPreviewJson,previewSha256} from '../contract.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),local=resolve(root,'.local/browser-preview');
const profiles=JSON.parse(await readFile(resolve(root,'services/browser-preview/runtime/assets/profiles.json'))),receipt=JSON.parse(await readFile(resolve(root,'services/browser-preview/runtime/assets/delivery.json')));
const directories={app:resolve(local,'app-assets'),execution:resolve(local,'execution-assets')};for(const dir of Object.values(directories))await mkdir(dir,{recursive:true});
const assets=[];
async function add(kind,path,bytes,type,expected=null){const sha256=await previewSha256(bytes),byteLength=bytes.length;if(expected&&(expected.sha256!==sha256||expected.byteLength!==byteLength))throw Error('static-delivery-source-mismatch:'+path);const url=kind==='app'?`/browser-preview-assets/${sha256}/${path}`:path,file=url.slice(1),dest=resolve(kind==='app'?directories.app:directories.execution,file);await mkdir(dirname(dest),{recursive:true});try{await writeFile(dest,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||await previewSha256(await readFile(dest))!==sha256)throw error;}const existing=assets.find(a=>a.url===url);if(existing){if(existing.sha256!==sha256||existing.byteLength!==byteLength)throw Error('static-delivery-collision');return existing;}const asset={url,file,sha256,byteLength,contentType:type,kind};assets.push(asset);return asset;}
const host=await add('app','host.bundle.mjs',await readFile(resolve(local,'host.bundle.mjs')),'text/javascript',receipt.host);
if(esbuildVersion!==receipt.esbuildVersion)throw Error('static-delivery-compiler-mismatch');
await build({entryPoints:[resolve(root,'services/browser-preview/runtime/renderer.mjs')],...receipt.buildOptions,outfile:resolve(local,'renderer.bundle.mjs'),logLevel:'warning'});
const renderer=await add('app','renderer.bundle.mjs',await readFile(resolve(local,'renderer.bundle.mjs')),'text/javascript');
const frameByProfile=new Map();
for(const profile of profiles){
 for(const asset of profile.assetManifest){const p=asset.path;let source;if(p.startsWith('assets/'))source=resolve(local,p);else if(p.startsWith('runtime/'))source=resolve(root,'services/browser-preview/runtime',p.slice(8));else if(p.startsWith('delivery/'))source=resolve(local,'delivery',asset.sha256,p.slice(9));else source=resolve(root,({'source/contract.ts':'services/browser-preview/contract.ts','source/model-spec.ts':'services/simulation/model-spec.ts','source/package-lock.json':'package-lock.json','source/prepare-assets.mjs':'services/browser-preview/runtime/prepare-assets.mjs'})[p]);await add('app',p,await readFile(source),'application/octet-stream',asset);}
 const frame=profile.assetManifest.find(a=>a.path==='delivery/frame.bundle.mjs'),worker=profile.assetManifest.find(a=>a.path==='delivery/worker.bundle.mjs');
 const frameBundle=await readFile(resolve(local,'delivery',frame.sha256,'frame.bundle.mjs'),'utf8'),template=await readFile(resolve(root,'services/browser-preview/runtime/frame.html'),'utf8');
 if(!template.includes('/* RIFFOLOGY_FRAME_BUNDLE */')||template.indexOf('/* RIFFOLOGY_FRAME_BUNDLE */')!==template.lastIndexOf('/* RIFFOLOGY_FRAME_BUNDLE */'))throw Error('frame-template-invalid');
 const frameBytes=new TextEncoder().encode(template.replace('/* RIFFOLOGY_FRAME_BUNDLE */',frameBundle)),frameDocumentSha256=await previewSha256(frameBytes);
 const deliveredFrame=await add('frame',`/runtime/${frameDocumentSha256}/frame.html`,frameBytes,'text/html');deliveredFrame.scriptSha256=frame.sha256;
 frameByProfile.set(profile.runtime.assetSha256,{url:deliveredFrame.url,sha256:deliveredFrame.sha256,byteLength:deliveredFrame.byteLength,scriptSha256:frame.sha256});
 if(!worker)throw Error('worker-delivery-missing');
}
// Reviewed baseline ships with its original unique bytes; shared bytes are rebuilt above.
await cp(resolve(root,'services/browser-preview/execution/retained/bytes'),directories.app,{recursive:true});
process.argv.push('--retain',resolve(root,'services/browser-preview/execution/retained/727c40f.json'));
// The immediately preceding release used the same frozen execution bytes as
// 727c40f but a newer host/receipt. Retain that exact host and both identities.
await cp(resolve(root,'services/browser-preview/execution/retained/pre-142-bytes/app-assets'),directories.app,{recursive:true});
process.argv.push('--retain',resolve(root,'services/browser-preview/execution/retained/pre-142.json'));
// Retention must be explicit: a prior reviewed index plus its original materialized files.
for(let i=2;i<process.argv.length;i++){if(process.argv[i]==='--update-index')continue;if(process.argv[i]!=='--retain')throw Error('unexpected-materializer-option');const retained=JSON.parse(await readFile(resolve(process.argv[++i])));if(retained.schema!=='riffology.browser-static-delivery/v3')throw Error('retained-static-delivery-isolation-incompatible');for(const asset of retained.assets){const frameMatch=asset.kind==='frame'&&/^\/runtime\/([a-f0-9]{64})\/frame.html$/.exec(asset.url);if(!['app','frame'].includes(asset.kind)||!/^[a-f0-9]{64}$/.test(asset.sha256)||!Number.isSafeInteger(asset.byteLength)||asset.byteLength<1||asset.file!==asset.url.slice(1)||asset.file.split('/').some(part=>!part||part==='.'||part==='..')||/[?#\\]/.test(asset.url)||asset.kind==='app'&&(!asset.url.startsWith('/browser-preview-assets/'+asset.sha256+'/')||asset.scriptSha256!==undefined)||asset.kind==='frame'&&(!frameMatch||frameMatch[1]!==asset.sha256||!/^[a-f0-9]{64}$/.test(asset.scriptSha256)))throw Error('retained-static-asset-invalid');if(assets.some(a=>a.url===asset.url))continue;const path=resolve(asset.kind==='app'?directories.app:directories.execution,asset.file),bytes=await readFile(path);if(await previewSha256(bytes)!==asset.sha256||bytes.length!==asset.byteLength)throw Error('retained-static-delivery-unavailable');assets.push(asset);}}
const sharedDelivery={hostModule:{url:host.url,sha256:host.sha256,byteLength:host.byteLength},rendererModule:{url:renderer.url,sha256:renderer.sha256,byteLength:renderer.byteLength},assetBaseUrl:'/browser-preview-assets'};
const versions=Object.fromEntries(profiles.map(p=>[p.runtime.assetSha256,{...sharedDelivery,frameDocument:frameByProfile.get(p.runtime.assetSha256)}]));
for(let i=2;i<process.argv.length;i++)if(process.argv[i]==='--retain'){const retained=JSON.parse(await readFile(resolve(process.argv[++i])));if(!retained.versions)throw Error('retained-delivery-version-map-missing');for(const [identity,delivery]of Object.entries(retained.versions)){if(!/^[a-f0-9]{64}$/.test(identity)||delivery.assetBaseUrl!=='/browser-preview-assets')throw Error('retained-delivery-version-invalid');for(const module of [delivery.hostModule,delivery.rendererModule])if(!module||!assets.some(a=>a.kind==='app'&&a.url===module.url&&a.sha256===module.sha256&&a.byteLength===module.byteLength))throw Error('retained-delivery-receipt-mismatch');const frame=delivery.frameDocument;if(!frame||!assets.some(a=>a.kind==='frame'&&a.url===frame.url&&a.sha256===frame.sha256&&a.byteLength===frame.byteLength&&a.scriptSha256===frame.scriptSha256))throw Error('retained-delivery-receipt-mismatch');if(versions[identity]&&canonicalPreviewJson(versions[identity])!==canonicalPreviewJson(delivery))throw Error('retained-delivery-version-collision');versions[identity]=delivery;}}
assets.sort((a,b)=>a.url<b.url?-1:1);
const output={schema:'riffology.browser-static-delivery/v3',runtimeProfiles:Object.keys(versions).sort(),delivery:versions[profiles[0].runtime.assetSha256],versions,assets};
const destination=resolve(root,'services/browser-preview/execution/assets/static-index.ts'),typescript=`// Generated by execution/materialize.mjs; reviewed platform fixed assets only.\nexport const browserPreviewStaticIndex = ${JSON.stringify(output,null,2)} as const;\n`;
if(process.argv.includes('--update-index'))await writeFile(destination,typescript);
else if(await readFile(destination,'utf8')!==typescript)throw Error('static-delivery-index-drift: review and --update-index');
await writeFile(resolve(local,'static-index.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({schema:output.schema,assetCount:assets.length,directories,host:output.delivery.hostModule,renderer:output.delivery.rendererModule},null,2));
