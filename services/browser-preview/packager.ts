import {BROWSER_PREVIEW_SOURCE_PATHS,canonicalPreviewJson,createPreviewManifest,parsePreviewManifest,previewSha256,type BrowserPreviewManifest,type PreviewSourcePath} from './contract.ts';
import {PREVIEW_LIMITS} from './profiles.ts';
import type {CompatiblePreview} from './validator.ts';
export type PreviewPackage={manifest:BrowserPreviewManifest;bytes:Uint8Array;sha256:string;trust:CompatiblePreview['profile']['trust']};
type PreviewPackageEnvelope={manifest:BrowserPreviewManifest;files:{path:PreviewSourcePath;base64:string}[]};
function base64(bytes:Uint8Array):string{let value='';for(const byte of bytes)value+=String.fromCharCode(byte);return btoa(value);}
function decodeBase64(raw:unknown):Uint8Array{
 if(typeof raw!=='string'||raw.length>Math.ceil(PREVIEW_LIMITS.sourceBytes/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw))throw Error('browser-preview-package-invalid');
 const bytes=Uint8Array.from(atob(raw),v=>v.charCodeAt(0));if(base64(bytes)!==raw)throw Error('browser-preview-package-invalid');return bytes;
}
/** Canonical UTF-8 JSON envelope, no timestamps, archive metadata or source normalization. */
export async function packageCompatiblePreview(input:CompatiblePreview):Promise<PreviewPackage>{
 if(canonicalPreviewJson(input.identity.runtime)!==canonicalPreviewJson(input.profile.runtime))throw Error('browser-preview-profile-mismatch');
 const manifest=await createPreviewManifest(input.identity);
 const files:BROWSER_FILES=[];
 if(input.files.size!==BROWSER_PREVIEW_SOURCE_PATHS.length)throw Error('browser-preview-package-invalid');
 for(const source of manifest.sources){const bytes=input.files.get(source.path);if(!bytes||bytes.length!==source.byteLength||await previewSha256(bytes)!==source.sha256)throw Error('browser-preview-package-source-mismatch');files.push({path:source.path,base64:base64(bytes)});}
 const bytes=new TextEncoder().encode(canonicalPreviewJson({manifest,files}));if(bytes.length>PREVIEW_LIMITS.bundleBytes)throw Error('browser-preview-package-limit');
 return {manifest,bytes,sha256:await previewSha256(bytes),trust:input.profile.trust};
}
type BROWSER_FILES=PreviewPackageEnvelope['files'];
/** Authorized delivery still owns permissions; this checks downloaded immutable bytes. */
export async function unpackPreviewPackage(raw:Uint8Array):Promise<{manifest:BrowserPreviewManifest;files:Map<PreviewSourcePath,Uint8Array>}>{
 const bytes=Uint8Array.from(raw);if(bytes.length>PREVIEW_LIMITS.bundleBytes)throw Error('browser-preview-package-limit');
 let envelope:PreviewPackageEnvelope;try{envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('browser-preview-package-invalid');}
 if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).sort().join(',')!=='files,manifest'||!Array.isArray(envelope.files)||envelope.files.length!==BROWSER_PREVIEW_SOURCE_PATHS.length)throw Error('browser-preview-package-invalid');
 const manifest=await parsePreviewManifest(envelope.manifest),files=new Map<PreviewSourcePath,Uint8Array>();
 for(let i=0;i<manifest.sources.length;i++){const source=manifest.sources[i]!,file=envelope.files[i];if(!file||Object.keys(file).sort().join(',')!=='base64,path'||file.path!==source.path)throw Error('browser-preview-package-invalid');const content=decodeBase64(file.base64);if(content.length!==source.byteLength||await previewSha256(content)!==source.sha256)throw Error('browser-preview-package-source-mismatch');files.set(source.path,content);}
 if(new TextDecoder().decode(bytes)!==canonicalPreviewJson(envelope))throw Error('browser-preview-package-noncanonical');
 return {manifest,files};
}
