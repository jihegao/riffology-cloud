import type {ModelContentRef} from '../workspace/protocol.ts';
import {MODEL_CONTENT_MAX_BYTES, ModelContentError, modelContentKey, verifyModelContent, type ModelContentReceipt} from './content.ts';

export interface ModelContentUploadPort {
  upload(ref:ModelContentRef, bytes:Uint8Array, beforeWrite:()=>Promise<void>):Promise<ModelContentReceipt>;
}

/** An upload can create one immutable package; it cannot repair or replace an
 * occupied key. A write timeout is reconciled by reading, never by overwriting. */
export class R2ModelContentUploadPort implements ModelContentUploadPort {
  private readonly bucket:R2Bucket;
  constructor(bucket:R2Bucket) { this.bucket=bucket; }

  async upload(rawRef:ModelContentRef, rawBytes:Uint8Array, beforeWrite:()=>Promise<void>):Promise<ModelContentReceipt> {
    if (!rawRef || Object.getPrototypeOf(rawRef)!==Object.prototype ||
        Object.keys(rawRef).sort().join(',')!=='contentRef,contentSha256,modelId,modelVersionId,version' ||
        !Object.values(Object.getOwnPropertyDescriptors(rawRef)).every(property=>'value' in property && typeof property.value==='string') ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(rawRef.modelVersionId) || !/^[A-Za-z0-9._-]{1,128}$/.test(rawRef.modelId) ||
        !/^[A-Za-z0-9._-]{1,64}$/.test(rawRef.version) || typeof rawRef.contentRef!=='string' ||
        rawRef.contentRef.length>512 || !/^[a-f0-9]{64}$/.test(rawRef.contentSha256)) throw new ModelContentError('model-content-unknown');
    const ref=structuredClone(rawRef), key=modelContentKey(ref);
    if (!(rawBytes instanceof Uint8Array) || rawBytes.byteLength>MODEL_CONTENT_MAX_BYTES) throw new ModelContentError('model-content-oversize');
    // Snapshot before any asynchronous operation so caller mutation cannot
    // change the package after its hash and canonical form were checked.
    const bytes=new Uint8Array(rawBytes);
    await verifyModelContent(ref,{size:bytes.length,arrayBuffer:async()=>bytes.buffer});
    const existing=await this.read(ref,key,bytes);
    if (existing) return existing;
    await beforeWrite();
    try { await this.bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'}}); }
    catch { /* The server may have committed before its response was lost. */ }
    const receipt=await this.read(ref,key,bytes);
    if (!receipt) throw new ModelContentError('model-content-unknown');
    return receipt;
  }

  private async read(ref:ModelContentRef,key:string,bytes:Uint8Array):Promise<ModelContentReceipt|null> {
    let value:R2ObjectBody|null;
    try { value=await this.bucket.get(key); }
    catch { throw new ModelContentError('model-content-unknown'); }
    if (!value) return null;
    try {
      // Keep the exact representation for collision-independent comparison,
      // while using the shared verifier for size, hash, and archive rules.
      let stored:Uint8Array|undefined;
      const verified=await verifyModelContent(ref,{size:value.size,arrayBuffer:async()=>{
        const buffer=await value.arrayBuffer();stored=new Uint8Array(buffer);return buffer;
      }});
      if (!stored || stored.length!==bytes.length || stored.some((byte,index)=>byte!==bytes[index])) throw new ModelContentError('model-content-mismatch');
      return verified.receipt;
    } catch(error) {
      if(error instanceof ModelContentError) throw error;
      throw new ModelContentError('model-content-unknown');
    } finally { await value.body?.cancel().catch(()=>{}); }
  }
}
