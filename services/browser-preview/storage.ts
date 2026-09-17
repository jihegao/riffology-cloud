import {canonicalPreviewJson,previewSha256,type BrowserPreviewManifest} from './contract.ts';
import {unpackPreviewPackage,type PreviewPackage} from './packager.ts';
import {PREVIEW_LIMITS} from './profiles.ts';
export type PreviewStorageScope={tenantId:string;projectId:string;workspaceId:string};
export type PreviewBuildIntent={scope:PreviewStorageScope;revisionId:string;buildIdentity:string;profileSha256:string};
export type PreviewBuildReceipt=PreviewBuildIntent&{packageIdentity:string;objectKey:string;sha256:string;byteLength:number;verifiedAt:number;trust:PreviewPackage['trust']};
export type PreviewReceiptPort={
 /** Durable, idempotent intent plus saved-files reference protection before R2 write. */
 begin(intent:PreviewBuildIntent):Promise<void>;
 /** Durable idempotent persist; conflict inputs must reject. Never merely an in-memory acknowledgement. */
 persist(receipt:PreviewBuildReceipt):Promise<PreviewBuildReceipt>;
};
export type PreviewObjectBucket={put(key:string,value:Uint8Array,options:{onlyIf:{etagDoesNotMatch:'*'};httpMetadata:{contentType:string}}):Promise<unknown>;get(key:string):Promise<{size:number;arrayBuffer():Promise<ArrayBuffer>}|null>};
function checkedScope(scope:PreviewStorageScope){if(!scope||Object.keys(scope).sort().join(',')!=='projectId,tenantId,workspaceId'||Object.values(scope).some(v=>typeof v!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(v)))throw Error('browser-preview-storage-scope-invalid');return {...scope};}
export function previewObjectKey(scope:PreviewStorageScope,packageIdentity:string){const s=checkedScope(scope);if(! /^[a-f0-9]{64}$/.test(packageIdentity))throw Error('browser-preview-package-invalid');return `tenants/${s.tenantId}/projects/${s.projectId}/workspaces/${s.workspaceId}/browser-preview/${packageIdentity}.json`;}
async function readChecked(bucket:PreviewObjectBucket,key:string,expectedSha:string,expectedLength:number){
 const object=await bucket.get(key);if(!object)return null;if(object.size!==expectedLength||object.size>PREVIEW_LIMITS.bundleBytes)throw Error('browser-preview-object-conflict');
 const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==expectedLength||await previewSha256(bytes)!==expectedSha)throw Error('browser-preview-object-conflict');return bytes;
}
/** Fixture packages cannot produce a production ready receipt. */
export async function storePreviewPackage(bucket:PreviewObjectBucket,receipts:PreviewReceiptPort,scope:PreviewStorageScope,packageValue:PreviewPackage,options:{now?:()=>number;allowTestFixture?:boolean}={}):Promise<PreviewBuildReceipt>{
 const s=checkedScope(scope),bytes=Uint8Array.from(packageValue.bytes);
 packageValue={...packageValue,manifest:structuredClone(packageValue.manifest),bytes};
 if(packageValue.trust!=='verified-platform'&&!(packageValue.trust==='test-fixture'&&options.allowTestFixture))throw Error('browser-preview-profile-unverified');
 const {manifest}=await unpackPreviewPackage(bytes);
 if(s.projectId!==manifest.projectId||canonicalPreviewJson(manifest)!==canonicalPreviewJson(packageValue.manifest)||await previewSha256(bytes)!==packageValue.sha256)throw Error('browser-preview-package-source-mismatch');
 const intent:PreviewBuildIntent={scope:s,revisionId:manifest.revisionId,buildIdentity:manifest.packageIdentity,profileSha256:await previewSha256(canonicalPreviewJson(manifest.runtime))};
 await receipts.begin(structuredClone(intent));
 const objectKey=previewObjectKey(s,manifest.packageIdentity);
 // Read first also reconciles an earlier persisted write whose response/receipt was lost.
 let saved:Uint8Array|null;try{saved=await readChecked(bucket,objectKey,packageValue.sha256,bytes.length);}catch(e){if(e instanceof Error&&e.message==='browser-preview-object-conflict')throw e;throw Error('browser-preview-storage-unavailable');}
 if(!saved){
  try{await bucket.put(objectKey,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json; charset=utf-8'}});}catch{/* Delivery unknown: only the same identity GET can resolve it. */}
  try{saved=await readChecked(bucket,objectKey,packageValue.sha256,bytes.length);}catch(e){if(e instanceof Error&&e.message==='browser-preview-object-conflict')throw e;throw Error('browser-preview-storage-unavailable');}
  if(!saved)throw Error('browser-preview-storage-unavailable');
 }
 const receipt:PreviewBuildReceipt={...intent,packageIdentity:manifest.packageIdentity,objectKey,sha256:packageValue.sha256,byteLength:bytes.length,verifiedAt:(options.now??Date.now)(),trust:packageValue.trust};
 const persisted=await receipts.persist(structuredClone(receipt));
 const {verifiedAt:_candidateAt,...candidate}=receipt;
 const {verifiedAt:_persistedAt,...stored}=persisted;
 if(canonicalPreviewJson(candidate)!==canonicalPreviewJson(stored)||!Number.isSafeInteger(persisted.verifiedAt)||persisted.verifiedAt<0)throw Error('browser-preview-receipt-conflict');
 return structuredClone(persisted);
}
/** The caller supplies a server-resolved receipt after its current project authorization. */
export async function readPreviewPackage(bucket:PreviewObjectBucket,authorizedScope:PreviewStorageScope,receipt:PreviewBuildReceipt,options:{allowTestFixture?:boolean}={}):Promise<{manifest:BrowserPreviewManifest;bytes:Uint8Array}>{
 const scope=checkedScope(authorizedScope);receipt=structuredClone(receipt);
 if(canonicalPreviewJson(scope)!==canonicalPreviewJson(receipt.scope)||receipt.objectKey!==previewObjectKey(scope,receipt.packageIdentity)||receipt.buildIdentity!==receipt.packageIdentity||receipt.trust!=='verified-platform'&&!(receipt.trust==='test-fixture'&&options.allowTestFixture)||!Number.isSafeInteger(receipt.byteLength)||receipt.byteLength<1||receipt.byteLength>PREVIEW_LIMITS.bundleBytes||! /^[a-f0-9]{64}$/.test(receipt.sha256))throw Error('browser-preview-read-denied');
 const bytes=await readChecked(bucket,receipt.objectKey,receipt.sha256,receipt.byteLength);if(!bytes)throw Error('browser-preview-source-unavailable');
 const {manifest}=await unpackPreviewPackage(bytes);
 if(manifest.projectId!==scope.projectId||manifest.revisionId!==receipt.revisionId||manifest.packageIdentity!==receipt.packageIdentity||await previewSha256(canonicalPreviewJson(manifest.runtime))!==receipt.profileSha256)throw Error('browser-preview-read-denied');
 return {manifest,bytes};
}
