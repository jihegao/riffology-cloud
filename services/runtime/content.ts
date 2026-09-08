import {validateInitialWorkspaceArchive} from '../workspace/initial-archive.ts';
import type { ModelContentRef } from '../workspace/protocol.ts';

/** Maximum package size accepted by the private resolver.  Archives are
 * verified before any future native materialization is allowed. */
export const MODEL_CONTENT_MAX_BYTES = 8 * 1024 * 1024;
export const MODEL_CONTENT_NAMESPACE = 'model-content';
export const MODEL_CONTENT_MAX_FILES = 4096;
export const MODEL_CONTENT_MAX_FILE_BYTES = 1024 * 1024;
const MODEL_CONTENT_ROOTS=new Set(['model','app','experiments','docs']);

export type ModelContentFile = { path: string; bytes: number; sha256: string };
export type ModelContentManifest = { schemaVersion: 1; files: ModelContentFile[] };

export type ModelContentReceipt = ModelContentRef & {
  namespace: typeof MODEL_CONTENT_NAMESPACE;
  bytes: number;
  verifiedSha256: string;
  fileCount: number;
  contentBytes: number;
};
export type VerifiedModelContent = { receipt: ModelContentReceipt; manifest: ModelContentManifest; files: Record<string, Uint8Array> };

export type ModelContentFailure = 'model-content-missing' | 'model-content-oversize' |
  'model-content-mismatch' | 'model-content-unknown';

export class ModelContentError extends Error {
  readonly code: ModelContentFailure;
  constructor(code: ModelContentFailure) { super(code); this.code=code; }
}

export interface ModelContentPort {
  /** Resolve only the platform-frozen reference. Callers cannot supply bytes. */
  resolve(ref: ModelContentRef): Promise<VerifiedModelContent>;
}

export function modelContentKey(ref: ModelContentRef): string {
  // contentRef is an opaque catalog value, but it must still be a safe object
  // name when mapped into the one private namespace.
  const objectName=ref.contentRef.startsWith('r2://') ? ref.contentRef.slice('r2://'.length) : ref.contentRef;
  if (!objectName || objectName.length>512 || objectName.normalize('NFC')!==objectName || /[\u0000-\u001f\u007f]/u.test(objectName) || objectName.includes('://') || objectName.startsWith('/') || objectName.includes('\\') ||
      objectName.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new ModelContentError('model-content-unknown');
  }
  return `${MODEL_CONTENT_NAMESPACE}/${objectName}`;
}

export async function verifyModelContent(ref: ModelContentRef, value: { size: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<VerifiedModelContent> {
  if (!Number.isSafeInteger(value.size) || value.size > MODEL_CONTENT_MAX_BYTES) throw new ModelContentError('model-content-oversize');
  const bytes = new Uint8Array(await value.arrayBuffer());
  if (bytes.byteLength !== value.size || bytes.byteLength > MODEL_CONTENT_MAX_BYTES) throw new ModelContentError('model-content-oversize');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== ref.contentSha256) throw new ModelContentError('model-content-mismatch');
  let parsed: unknown;
  try { parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { throw new ModelContentError('model-content-unknown'); }
  const rawFiles=parsed && typeof parsed==='object' && !Array.isArray(parsed) ? (parsed as Record<string,unknown>).files : undefined;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.getPrototypeOf(parsed)!==Object.prototype || Object.keys(parsed).length!==2 ||
      (parsed as Record<string,unknown>).schemaVersion!==1 || !Array.isArray(rawFiles) || rawFiles.length<1 || rawFiles.length>MODEL_CONTENT_MAX_FILES) throw new ModelContentError('model-content-unknown');
  const manifestFiles:ModelContentFile[]=[]; const packageFiles:Array<{path:string;bytes:number;sha256:string;contentBase64:string}>=[]; const files:Record<string,Uint8Array>={}; let total=0,previous:string|null=null;
  for (const item of rawFiles) {
    if (!item || typeof item!=='object' || Array.isArray(item) || Object.getPrototypeOf(item)!==Object.prototype || Object.keys(item).length!==4) throw new ModelContentError('model-content-unknown');
    const row=item as Record<string,unknown>, path=row.path;
    if (typeof path!=='string' || path.normalize('NFC')!==path || path.length<1 || path.length>512 || /[\u0000-\u001f\u007f]/u.test(path) || path.startsWith('/') || path.includes('\\') || path.split('/').some(part=>!part||part==='.'||part==='..') || !MODEL_CONTENT_ROOTS.has(path.split('/')[0]!) || (previous!==null&&path<=previous)) throw new ModelContentError('model-content-unknown');
    if (typeof row.contentBase64!=='string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.contentBase64)) throw new ModelContentError('model-content-unknown');
    const fileBytes=Uint8Array.from(atob(row.contentBase64),c=>c.charCodeAt(0));
    let canonical='';for(let i=0;i<fileBytes.length;i+=0x8000)canonical+=String.fromCharCode(...fileBytes.subarray(i,i+0x8000));
    if (btoa(canonical)!==row.contentBase64 || !Number.isSafeInteger(row.bytes) || row.bytes!==fileBytes.byteLength || row.bytes<0 || row.bytes>MODEL_CONTENT_MAX_FILE_BYTES || typeof row.sha256!=='string' || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new ModelContentError('model-content-unknown');
    const fileDigest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',fileBytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if (fileDigest!==row.sha256) throw new ModelContentError('model-content-unknown');
    previous=path;total+=fileBytes.byteLength;if(total>MODEL_CONTENT_MAX_BYTES)throw new ModelContentError('model-content-oversize');manifestFiles.push({path,bytes:fileBytes.byteLength,sha256:fileDigest});packageFiles.push({path,bytes:fileBytes.byteLength,sha256:fileDigest,contentBase64:row.contentBase64});files[path]=fileBytes;
  }
  // A content digest identifies one byte representation, not merely an
  // equivalent JSON value. This also makes independent package builders and
  // publication review reproducible.
  const canonicalBytes=new TextEncoder().encode(JSON.stringify({schemaVersion:1,files:packageFiles}));
  if(canonicalBytes.byteLength!==bytes.byteLength||canonicalBytes.some((byte,index)=>byte!==bytes[index]))throw new ModelContentError('model-content-unknown');
  // Reserve the platform README and public directories before reporting M1 ready.
  // Every accepted package must be representable by the first M2 restore.
  try { validateInitialWorkspaceArchive({...files,'README.md':new Uint8Array()}); }
  catch { throw new ModelContentError('model-content-unknown'); }
  const manifest={schemaVersion:1 as const,files:manifestFiles};
  const receipt:ModelContentReceipt={...structuredClone(ref),namespace:MODEL_CONTENT_NAMESPACE,bytes:bytes.byteLength,verifiedSha256:digest,fileCount:manifestFiles.length,contentBytes:total};
  return {receipt,manifest,files};
}

export class R2ModelContentPort implements ModelContentPort {
  private readonly bucket: R2Bucket;
  constructor(bucket: R2Bucket) { this.bucket=bucket; }
  async resolve(ref: ModelContentRef): Promise<VerifiedModelContent> {
    let value: R2ObjectBody | null;
    try { value = await this.bucket.get(modelContentKey(ref)); }
    catch { throw new ModelContentError('model-content-unknown'); }
    if (!value) throw new ModelContentError('model-content-missing');
    try {
      return await verifyModelContent(ref, value);
    }
    catch (error) { if (error instanceof ModelContentError) throw error; throw new ModelContentError('model-content-unknown'); }
    finally { await value.body?.cancel().catch(() => {}); }
  }
}
