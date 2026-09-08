import assert from 'node:assert/strict';
import test from 'node:test';
import { modelContentKey, MODEL_CONTENT_MAX_BYTES, ModelContentError, verifyModelContent } from '../../services/runtime/content.ts';
import type { ModelContentRef } from '../../services/workspace/protocol.ts';

const file = new TextEncoder().encode('trusted model source');
const file64 = btoa(String.fromCharCode(...file));
const fileSha = async (value: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value as BufferSource))].map(b => b.toString(16).padStart(2, '0')).join('');
const bytes = new TextEncoder().encode(JSON.stringify({schemaVersion:1,files:[{path:'model/main.py',bytes:file.byteLength,sha256:await fileSha(file),contentBase64:file64}]}));
const digest = async (value: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value as BufferSource))].map(b => b.toString(16).padStart(2, '0')).join('');
const ref = async (): Promise<ModelContentRef> => ({modelVersionId:'version-a',modelId:'queue',version:'2.1.0',contentRef:'models/queue/2.1.0.tar',contentSha256:await digest(bytes)});

test('private model resolver returns a frozen receipt after a full byte rehash', async () => {
  const frozen=await ref();
  const verified=await verifyModelContent(frozen,{size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer}),receipt=verified.receipt;
  assert.equal(modelContentKey(frozen),'model-content/models/queue/2.1.0.tar');
  assert.equal(modelContentKey({...frozen,contentRef:'r2://models/queue/2.1.0.tar'}),'model-content/models/queue/2.1.0.tar');
  assert.deepEqual(receipt.modelVersionId,frozen.modelVersionId);
  assert.equal(receipt.verifiedSha256,frozen.contentSha256);
  assert.equal(receipt.bytes,bytes.byteLength);
  assert.equal(receipt.fileCount,1);assert.equal(receipt.contentBytes,file.byteLength);
  assert.deepEqual(verified.manifest.files.map(file=>file.path),['model/main.py']);
});

test('resolver fails closed for oversize, digest mismatch and unsafe archive names', async () => {
  const frozen=await ref();
  await assert.rejects(verifyModelContent(frozen,{size:MODEL_CONTENT_MAX_BYTES+1,arrayBuffer:async()=>bytes.buffer}), (error:unknown)=>error instanceof ModelContentError && error.code==='model-content-oversize');
  await assert.rejects(verifyModelContent({...frozen,contentSha256:'0'.repeat(64)},{size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer}), (error:unknown)=>error instanceof ModelContentError && error.code==='model-content-mismatch');
  assert.throws(()=>modelContentKey({...frozen,contentRef:'../escape.tar'}), (error:unknown)=>error instanceof ModelContentError && error.code==='model-content-unknown');
  const malicious = new TextEncoder().encode(JSON.stringify({schemaVersion:1,files:[{path:'../escape',bytes:1,sha256:'0'.repeat(64),contentBase64:'YQ=='}]}));
  await assert.rejects(verifyModelContent({...frozen,contentSha256:await digest(malicious)},{size:malicious.byteLength,arrayBuffer:async()=>malicious.buffer}), (error:unknown)=>error instanceof ModelContentError && error.code==='model-content-unknown');
  for(const body of [
    {schemaVersion:1,files:[{path:'.riffology/control',bytes:1,sha256:await fileSha(new Uint8Array([97])),contentBase64:'YQ=='}]},
    {schemaVersion:1,files:[{path:'model/z.py',bytes:1,sha256:await fileSha(new Uint8Array([97])),contentBase64:'YQ=='},{path:'model/a.py',bytes:1,sha256:await fileSha(new Uint8Array([97])),contentBase64:'YQ=='}]},
    {schemaVersion:1,files:[{path:'model/a.py',bytes:1,sha256:await fileSha(new Uint8Array([97])),contentBase64:'YR=='}]},
  ]){const encoded=new TextEncoder().encode(JSON.stringify(body));await assert.rejects(verifyModelContent({...frozen,contentSha256:await digest(encoded)},{size:encoded.byteLength,arrayBuffer:async()=>encoded.buffer}),error=>error instanceof ModelContentError&&error.code==='model-content-unknown');}
});

test('resolver accepts only the canonical byte representation', async () => {
  const frozen=await ref(),parsed=JSON.parse(new TextDecoder().decode(bytes));
  const whitespace=new TextEncoder().encode(`${JSON.stringify(parsed,null,2)}\n`);
  await assert.rejects(verifyModelContent({...frozen,contentSha256:await digest(whitespace)},{size:whitespace.byteLength,arrayBuffer:async()=>whitespace.buffer}),error=>error instanceof ModelContentError&&error.code==='model-content-unknown');
  const row=parsed.files[0],reordered=new TextEncoder().encode(JSON.stringify({files:[{contentBase64:row.contentBase64,sha256:row.sha256,bytes:row.bytes,path:row.path}],schemaVersion:1}));
  await assert.rejects(verifyModelContent({...frozen,contentSha256:await digest(reordered)},{size:reordered.byteLength,arrayBuffer:async()=>reordered.buffer}),error=>error instanceof ModelContentError&&error.code==='model-content-unknown');
});

async function resolvePaths(paths:string[]) {
  const empty=new Uint8Array(),sha=await digest(empty);
  const encoded=new TextEncoder().encode(JSON.stringify({schemaVersion:1,files:paths.sort().map(path=>({path,bytes:0,sha256:sha,contentBase64:''}))}));
  return verifyModelContent({...await ref(),contentSha256:await digest(encoded)},{size:encoded.length,arrayBuffer:async()=>encoded.buffer});
}

test('model verification rejects packages that cannot become a canonical initial workspace',async()=>{
  for(const paths of [
    ['model/'+'a'.repeat(101)],
    ['model/.riffology/state'],
    ['model/\ud800'],
    ['model/file','model/file/child'],
    ['model'],
    Array.from({length:2046},(_,i)=>`model/d${i}/file`),
    Array.from({length:4091},(_,i)=>`model/file${i}`),
  ])await assert.rejects(resolvePaths(paths),error=>error instanceof ModelContentError&&error.code==='model-content-unknown');
});

test('model verification reserves exactly the public layout and platform README entries',async()=>{
  const verified=await resolvePaths(Array.from({length:4090},(_,i)=>`model/file${i}`));
  assert.equal(verified.receipt.fileCount,4090);
  const unicode=await resolvePaths([`docs/${'前'.repeat(24)}/${'x'.repeat(80)}.md`]);
  assert.equal(unicode.receipt.fileCount,1);
});
