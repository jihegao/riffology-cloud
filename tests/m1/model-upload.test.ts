import test from 'node:test';
import assert from 'node:assert/strict';
import {R2ModelContentUploadPort} from '../../services/runtime/model-upload.ts';
import {MODEL_CONTENT_MAX_BYTES,modelContentKey} from '../../services/runtime/content.ts';
import type {ModelContentRef} from '../../services/workspace/protocol.ts';
const sha=async(bytes:Uint8Array)=>Buffer.from(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))).toString('hex');
async function fixture(path='model/main.py',text='print(1)') {
  const content=Buffer.from(text);
  const bytes=new TextEncoder().encode(JSON.stringify({schemaVersion:1,files:[{path,bytes:content.length,sha256:await sha(content),contentBase64:content.toString('base64')}]}));
  const ref:ModelContentRef={modelId:'queue',modelVersionId:'queue:1',version:'1',contentRef:'queue/1.json',contentSha256:await sha(bytes)};
  return {bytes,ref};
}
class Bucket {
  objects=new Map<string,Uint8Array>(); reads=0; writes=0; cancellations=0;
  lost=false; failGet=false; failRead=false; failAfterPut=false; failWithoutCommit=false; race:Uint8Array|null=null;
  async get(key:string) {
    this.reads++;if(this.failGet)throw Error('storage unreachable');
    const bytes=this.objects.get(key);if(!bytes)return null;
    return {size:bytes.length,arrayBuffer:async()=>{if(this.failRead)throw Error('body lost');return new Uint8Array(bytes).buffer;},body:{cancel:async()=>{this.cancellations++;}}};
  }
  async put(key:string,bytes:Uint8Array,options:{onlyIf:{etagDoesNotMatch:string}}) {
    this.writes++;assert.deepEqual(options,{onlyIf:{etagDoesNotMatch:'*'}});
    if(this.failWithoutCommit)throw Error('put failed');
    if(this.race)this.objects.set(key,this.race);
    if(!this.objects.has(key))this.objects.set(key,new Uint8Array(bytes));
    if(this.failAfterPut)this.failGet=true;
    if(this.lost)throw Error('put response lost');
    return {};
  }
  port(){return new R2ModelContentUploadPort(this as unknown as R2Bucket);}
}
test('valid upload verifies readback, same byte replay has no second write',async()=>{
  const {ref,bytes}=await fixture(),bucket=new Bucket();let guards=0;
  const a=await bucket.port().upload(ref,bytes,async()=>{guards++;});
  const b=await bucket.port().upload(ref,bytes,async()=>{guards++;});
  assert.deepEqual(a,b);assert.equal(a.fileCount,1);assert.equal(bucket.writes,1);assert.equal(guards,1);assert.equal(bucket.cancellations,2);
});
test('size, hash, package paths and storage paths fail before any storage or guard',async()=>{
  const good=await fixture(),badPath=await fixture('model/../secret');
  const variants=[{...good,bytes:new Uint8Array(MODEL_CONTENT_MAX_BYTES+1)}, {...good,ref:{...good.ref,contentSha256:'0'.repeat(64)}},badPath,{...good,ref:{...good.ref,contentRef:'../secret'}}];
  for(const {ref,bytes} of variants){const bucket=new Bucket();await assert.rejects(bucket.port().upload(ref,bytes,async()=>{assert.fail('guard should not run');}));assert.equal(bucket.writes,0);assert.equal(bucket.reads,0);}
});
test('existing conflicting object remains unchanged and body is cancelled',async()=>{
  const good=await fixture(),other=await fixture('model/main.py','different'),bucket=new Bucket(),key=modelContentKey(good.ref);
  bucket.objects.set(key,other.bytes);
  await assert.rejects(bucket.port().upload(good.ref,good.bytes,async()=>{assert.fail('no writes');}),/model-content-mismatch/);
  assert.deepEqual(bucket.objects.get(key),other.bytes);assert.equal(bucket.writes,0);assert.equal(bucket.cancellations,1);
});
test('lost put response reconciles exact committed object without another put',async()=>{
  const {ref,bytes}=await fixture(),bucket=new Bucket();bucket.lost=true;
  assert.equal((await bucket.port().upload(ref,bytes,async()=>{})).verifiedSha256,ref.contentSha256);assert.equal(bucket.writes,1);
});
test('revoked guard prevents put after the preflight read',async()=>{
  const {ref,bytes}=await fixture(),bucket=new Bucket();
  await assert.rejects(bucket.port().upload(ref,bytes,async()=>{assert.equal(bucket.reads,1);throw Error('revoked');}),/revoked/);
  assert.equal(bucket.writes,0);
});
test('conditional competing write accepts identical bytes and rejects different bytes',async()=>{
  const good=await fixture(),other=await fixture('model/main.py','different');
  for(const same of [true,false]){const bucket=new Bucket();bucket.race=same?good.bytes:other.bytes;
    const pending=bucket.port().upload(good.ref,good.bytes,async()=>{});
    if(same)assert.equal((await pending).verifiedSha256,good.ref.contentSha256);else await assert.rejects(pending,/model-content-mismatch/);
    assert.deepEqual(bucket.objects.get(modelContentKey(good.ref)),bucket.race);assert.equal(bucket.writes,1);assert.equal(bucket.cancellations,1);
  }
});
test('uncertain initial get or body read never starts a put',async()=>{
  const {ref,bytes}=await fixture();
  for(const body of [true,false]){const bucket=new Bucket();bucket.objects.set(modelContentKey(ref),bytes);bucket.failRead=body;bucket.failGet=!body;
    await assert.rejects(bucket.port().upload(ref,bytes,async()=>{assert.fail('guard');}),/model-content-unknown/);assert.equal(bucket.writes,0);assert.equal(bucket.cancellations,body?1:0);
  }
});
test('caller mutations during guard cannot change the verified upload',async()=>{
  const {ref,bytes}=await fixture(),expected=new Uint8Array(bytes),key=modelContentKey(ref),bucket=new Bucket();
  await bucket.port().upload(ref,bytes,async()=>{bytes.fill(0);ref.contentRef='other';});
  assert.deepEqual(bucket.objects.get(key),expected);assert.equal(bucket.objects.has('model-content/other'),false);
});
test('failed or uncertain readback returns unknown without another write',async()=>{
  const {ref,bytes}=await fixture();
  for(const committed of [true,false]){const bucket=new Bucket();bucket.failAfterPut=committed;bucket.failWithoutCommit=!committed;
    await assert.rejects(bucket.port().upload(ref,bytes,async()=>{}),/model-content-unknown/);
    assert.equal(bucket.writes,1);assert.equal(bucket.objects.has(modelContentKey(ref)),committed);
  }
});
