import assert from 'node:assert/strict';
import test from 'node:test';
import { InitialWorkspaceResolver, initialWorkspaceReferenceFromReady, isInitialWorkspaceSourceFailure } from '../../services/turn-runtime/initial-workspace.ts';
import { initialCheckpoint } from '../../services/runtime/starter.ts';
import { checkpointKey } from '../../services/runtime/core.ts';
import { modelContentKey, verifyModelContent } from '../../services/runtime/content.ts';
import { canonicalWorkspaceMarker, workspaceDigest, type WorkspaceTask } from '../../services/workspace/protocol.ts';
import { workspaceFileIndex } from '../../services/turn-runtime/workspace-file-index.ts';
const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const runtime={taskId:'task-a',tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',generation:1,runtimeId:'runtime-a',leaseId:'lease-a'};
const encode=(text:string)=>new TextEncoder().encode(text);
async function fixture(withModel=false){
  const task:WorkspaceTask={id:'task-a',tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:1000,deadlineAt:2000};
  const objects=new Map<string,Uint8Array>();let reads=0;
  const object=(bytes:Uint8Array)=>({size:bytes.length,async arrayBuffer(){return Uint8Array.from(bytes).buffer;}});
  let model;
  if(withModel){const content=encode('print("verified initial model")\n');const serialized=JSON.stringify({schemaVersion:1,files:[{path:'model/main.py',bytes:content.length,sha256:await workspaceDigest(new TextDecoder().decode(content)),contentBase64:Buffer.from(content).toString('base64')}]});
    task.modelContent={modelVersionId:'model-version-a',modelId:'queue',version:'1',contentRef:'queue-v1.json',contentSha256:await workspaceDigest(serialized)};
    const bytes=encode(serialized);objects.set(modelContentKey(task.modelContent),bytes);model=await verifyModelContent(task.modelContent,object(bytes));
  }
  const checkpoint=await initialCheckpoint({task,identity:runtime,markerNonce:'nonce-a'},model?.receipt);objects.set(checkpointKey(runtime),encode(checkpoint.text));
  const ready={receiptId:'receipt-a',initializedAt:1500,layoutVersion:'m1-empty-v1' as const,markerSha256:await workspaceDigest(canonicalWorkspaceMarker(runtime,'nonce-a')),checkpointRevision:checkpoint.revision,...(model?{modelContent:model.receipt}:{})};
  const reference=await initialWorkspaceReferenceFromReady({scope,task,runtime,markerNonce:'nonce-a',ready});
  const bucket={async get(key:string){reads++;const bytes=objects.get(key);return bytes?object(bytes):null;}} as unknown as R2Bucket;
  return {reference,objects,resolver:new InitialWorkspaceResolver(bucket,bucket),get reads(){return reads;}};
}
test('blank initial base restores public README and layout without old control metadata',async()=>{
  const f=await fixture(),first=await f.resolver.resolve(f.reference,scope),second=await f.resolver.resolve(structuredClone(f.reference),scope);
  assert.deepEqual(first,second);const entries=workspaceFileIndex(first.filesArchive).files;
  assert.deepEqual(entries.filter(row=>row.type==='file').map(row=>row.path),['README.md']);
  assert.ok(entries.some(row=>row.path==='model'&&row.type==='directory'));assert.ok(entries.every(row=>!row.path.startsWith('.riffology')));
  assert.equal(first.reference.checkpointRevision,f.reference.checkpointRevision);assert.match(first.referenceSha256,/^[a-f0-9]{64}$/);
});
test('official package bytes and initial checkpoint are both verified before archive creation',async()=>{
  const f=await fixture(true),resolved=await f.resolver.resolve(f.reference,scope);
  assert.deepEqual(workspaceFileIndex(resolved.filesArchive).files.filter(row=>row.type==='file').map(row=>row.path),['README.md','model/main.py']);
  assert.ok(Buffer.from(resolved.filesArchive).includes(Buffer.from('print("verified initial model")\n')));
  const key=modelContentKey(f.reference.task.modelContent!);f.objects.set(key,encode('corrupt'));
  await assert.rejects(f.resolver.resolve(f.reference,scope),/model-content-mismatch/);f.objects.delete(key);
  await assert.rejects(f.resolver.resolve(f.reference,scope),/model-content-missing/);
});
test('scope, generation and marker substitution fail before storage access',async()=>{
  const f=await fixture();
  await assert.rejects(f.resolver.resolve(f.reference,{...scope,tenantId:'tenant-b'}),/scope-denied/);
  await assert.rejects(f.resolver.resolve({...f.reference,runtime:{...runtime,generation:2}},scope),/scope-denied/);
  await assert.rejects(f.resolver.resolve({...f.reference,markerNonce:'other-nonce'},scope),/marker-mismatch/);assert.equal(f.reads,0);
});
test('missing or corrupt M1 checkpoint cannot silently become an empty base',async()=>{
  const f=await fixture(),key=checkpointKey(runtime);f.objects.delete(key);await assert.rejects(f.resolver.resolve(f.reference,scope),/checkpoint-missing/);
  f.objects.set(key,encode('{}'));await assert.rejects(f.resolver.resolve(f.reference,scope),/checkpoint-mismatch/);
  // Even a newly claimed hash cannot turn arbitrary JSON into the M1 contract.
  await assert.rejects(f.resolver.resolve({...f.reference,checkpointRevision:await workspaceDigest('{}')},scope),/checkpoint-mismatch/);
});
test('model version substitution cannot reuse the original initialized receipt',async()=>{
  const f=await fixture(true);const task={...f.reference.task,modelContent:{...f.reference.task.modelContent!,version:'2'}};
  await assert.rejects(f.resolver.resolve({...f.reference,task},scope),/checkpoint-mismatch/);
});


test('model transport failures remain retryable and require the separate content binding',async()=>{
 const f=await fixture(true);
 const checkpointBucket={async get(key:string){const bytes=f.objects.get(key);return bytes?{size:bytes.length,async arrayBuffer(){return Uint8Array.from(bytes).buffer;}}:null;}} as unknown as R2Bucket;
 await assert.rejects(new InitialWorkspaceResolver(checkpointBucket).resolve(f.reference,scope),error=>isInitialWorkspaceSourceFailure(error));
 const network=Error('temporary network failure');
 const modelBucket={async get(){throw network;}} as unknown as R2Bucket;
 await assert.rejects(new InitialWorkspaceResolver(checkpointBucket,modelBucket).resolve(f.reference,scope),error=>error===network&&!isInitialWorkspaceSourceFailure(error));
 const readFailure={async get(){return {size:1,async arrayBuffer(){throw network;}};}} as unknown as R2Bucket;
 await assert.rejects(new InitialWorkspaceResolver(checkpointBucket,readFailure).resolve(f.reference,scope),error=>error===network&&!isInitialWorkspaceSourceFailure(error));
});
