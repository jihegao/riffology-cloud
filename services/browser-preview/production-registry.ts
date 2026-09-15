import committedProfiles from './runtime/assets/profiles.json' with {type:'json'};
import committedDelivery from './runtime/assets/delivery.json' with {type:'json'};
import {canonicalPreviewJson,parsePreviewRuntime,type PreviewRuntime} from './contract.ts';
import {createTrustedPreviewRegistry,type PreviewAsset,type PreviewProfileRegistry,type TrustedPreviewProfile} from './profiles.ts';
function fail():never{throw Error('browser-preview-production-inventory-invalid');}
function record(raw:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype)fail();
 const descriptors=Object.getOwnPropertyDescriptors(raw);
 if(Reflect.ownKeys(descriptors).length!==keys.length||keys.some(k=>!Object.hasOwn(descriptors,k)||!Object.hasOwn(descriptors[k]!,'value')))fail();
 return Object.fromEntries(keys.map(k=>[k,descriptors[k]!.value]));
}
function hash(raw:unknown):string{if(typeof raw!=='string'||! /^[a-f0-9]{64}$/.test(raw))fail();return raw;}
function length(raw:unknown):number{if(typeof raw!=='number'||!Number.isSafeInteger(raw)||raw<1)fail();return raw;}
/** Pure inventory check for platform-reviewed build outputs, not a package-supplied trust grant. */
export async function reviewedPreviewInventory(rawProfiles:unknown,rawDelivery:unknown):Promise<PreviewProfileRegistry>{
 if(!Array.isArray(rawProfiles)||rawProfiles.length!==2)fail();
 const entries:TrustedPreviewProfile[]=rawProfiles.map(raw=>{
  const p=record(raw,['runtime','packages','assetManifest','verified']);if(p.verified!==true||!Array.isArray(p.assetManifest))fail();
  const runtime:PreviewRuntime=parsePreviewRuntime(p.runtime);
  const packages=record(p.packages,Object.keys((p.packages??{}) as object));
  if(Object.values(packages).some(v=>typeof v!=='string'))fail();
  const assets:PreviewAsset[]=p.assetManifest.map(raw=>{const a=record(raw,['path','sha256','byteLength']);if(typeof a.path!=='string')fail();return {path:a.path,sha256:hash(a.sha256),byteLength:length(a.byteLength)};});
  for(const path of ['assets/pyodide.mjs','assets/pyodide.asm.mjs','assets/pyodide.asm.wasm','assets/python_stdlib.zip','assets/pyodide-lock.json','delivery/worker.bundle.mjs','delivery/frame.bundle.mjs','source/contract.ts','source/model-spec.ts','source/package-lock.json','source/prepare-assets.mjs'])if(!assets.some(a=>a.path===path))fail();
  return {runtime,packages:packages as Record<string,string>,assets,trust:'verified-platform'};
 });
 if(new Set(entries.map(p=>p.runtime.profileId)).size!==2)fail();
 const delivery=record(rawDelivery,['schema','profiles','host','esbuildVersion','buildOptions']);
 const host=record(delivery.host,['sha256','byteLength']);hash(host.sha256);length(host.byteLength);
 const options=record(delivery.buildOptions,['bundle','format','platform','target','external']);
 if(delivery.schema!=='riffology.browser-runtime-delivery/v1'||canonicalPreviewJson(delivery.profiles)!==canonicalPreviewJson(entries.map(p=>p.runtime.assetSha256))||typeof delivery.esbuildVersion!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(delivery.esbuildVersion)||canonicalPreviewJson(options)!==canonicalPreviewJson({bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*','ws']}))fail();
 return createTrustedPreviewRegistry(entries);
}
let production:Promise<PreviewProfileRegistry>|undefined;
/** Uses only the committed platform inventory; private package JSON never chooses entries. */
export function productionPreviewRegistry():Promise<PreviewProfileRegistry>{return production??=reviewedPreviewInventory(committedProfiles,committedDelivery);}
