import {canonicalPreviewJson,parsePreviewRuntime,previewSha256,type PreviewRuntime} from './contract.ts';
export const PREVIEW_LIMITS=Object.freeze({inputBytes:8192,resultBytes:8388608,frames:501,agentsPerFrame:10000,gridCells:1000000,deadlineMs:30000,maxSteps:500,cacheBytes:8388608,sourceBytes:1048576,bundleBytes:5242880});
export const PREVIEW_SOURCE_LOCKS=Object.freeze({'python-stdlib/v1':{},'mesa-3.5.1/v1':{mesa:'3.5.1',networkx:'3.6.1',numpy:'2.4.6',pandas:'3.0.2',scipy:'1.18.0',tqdm:'4.67.3'}});
export type PreviewAsset={path:string;sha256:string;byteLength:number};
export type TrustedPreviewProfile={runtime:PreviewRuntime;packages:Record<string,string>;assets:PreviewAsset[];trust:'verified-platform'|'test-fixture'};
export type PreviewProfileRegistry={resolve(profileId:PreviewRuntime['profileId']):TrustedPreviewProfile|null};
/** Only the platform composition root supplies these entries, never package JSON. */
export async function createTrustedPreviewRegistry(entries:readonly TrustedPreviewProfile[]):Promise<PreviewProfileRegistry>{
 const profiles=new Map<string,TrustedPreviewProfile>();
 const limitsSha256=await previewSha256(canonicalPreviewJson(PREVIEW_LIMITS));
 for(const entry of entries){
  const runtime=parsePreviewRuntime(entry.runtime);
  if(runtime.runtimeVersion!=='pyodide-314.0.6/v1'||runtime.adapterVersion!=='riffology.model-run/v1'||runtime.pythonVersion!=='3.14.2'||profiles.has(runtime.profileId)||runtime.limitsSha256!==limitsSha256||!['verified-platform','test-fixture'].includes(entry.trust)||!Array.isArray(entry.assets)||!entry.assets.length)throw Error('browser-preview-profile-invalid');
  const assets=entry.assets.map(a=>{
   if(!a||Object.keys(a).sort().join(',')!=='byteLength,path,sha256'||typeof a.path!=='string'||!/^[A-Za-z0-9_./+-]{1,240}$/.test(a.path)||a.path.split('/').some(p=>!p||p==='.'||p==='..')||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isSafeInteger(a.byteLength)||a.byteLength<1)throw Error('browser-preview-profile-invalid');
   return {...a};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if(new Set(assets.map(a=>a.path)).size!==assets.length||await previewSha256(canonicalPreviewJson(assets))!==runtime.assetSha256)throw Error('browser-preview-profile-invalid');
  if(runtime.dependencies.some(d=>!assets.some(a=>a.sha256===d.sha256)))throw Error('browser-preview-profile-invalid');
  const packages=entry.packages;
  if(!packages||typeof packages!=='object'||Array.isArray(packages)||Object.entries(packages).some(([name,version])=>!runtime.dependencies.some(d=>d.name===name&&d.version===version)))throw Error('browser-preview-profile-invalid');
  if(runtime.profileId==='python-stdlib/v1'&&(Object.keys(packages).length||runtime.dependencies.length)||runtime.profileId==='mesa-3.5.1/v1'&&(packages.mesa!=='3.5.1'||!runtime.dependencies.some(d=>d.name==='mesa'&&d.version==='3.5.1')))throw Error('browser-preview-profile-invalid');
  if(canonicalPreviewJson(packages)!==canonicalPreviewJson(PREVIEW_SOURCE_LOCKS[runtime.profileId]))throw Error('browser-preview-profile-invalid');
  profiles.set(runtime.profileId,{runtime,packages:{...packages},assets,trust:entry.trust});
 }
 return Object.freeze({resolve(profileId:PreviewRuntime['profileId']){const p=profiles.get(profileId);return p?structuredClone(p):null;}});
}
/** Fail closed until the verified production asset inventory is wired in. */
export const emptyPreviewRegistry:PreviewProfileRegistry=Object.freeze({resolve(){return null;}});
