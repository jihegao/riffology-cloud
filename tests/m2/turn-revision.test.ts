import assert from 'node:assert/strict';
import test from 'node:test';
import { R2TurnRevisionPort, R2TurnRevisionReader, turnRevisionLimits, turnRevisionObjectKey, type FrozenTurnSnapshotPort, type TurnRevisionBucket } from '../../services/turn-runtime/revision.ts';
import type { TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';
import type { TurnBaseCheckpoints } from '../../services/turn/protocol.ts';

const identity:TurnRuntimeIdentity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2};
const base:TurnBaseCheckpoints={workspace:null,session:null};
const commitInput=(outcome:'completed'|'failed'|'cancelled'|'interrupted'='completed',executionErrorCode:string|null=null,runtimeIdentity=identity,claimedBase:TurnBaseCheckpoints=base)=>({identity:runtimeIdentity,outcome,executionErrorCode,base:claimedBase});
class Bucket{
  objects=new Map<string,Uint8Array>();puts:string[]=[];loseAt=-1;failAt=-1;
  async put(key:string,value:Uint8Array){this.puts.push(key);const count=this.puts.length;if(count===this.failAt)throw Error('injected-put-failure');if(!this.objects.has(key))this.objects.set(key,Uint8Array.from(value));if(count===this.loseAt)throw Error('lost-put-response');return null;}
  async get(key:string){const value=this.objects.get(key);if(!value)return null;const bytes=Uint8Array.from(value);return {size:bytes.byteLength,body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}};}
}
function fixture(){const bucket=new Bucket(),files=new TextEncoder().encode('canonical project archive'),session=new TextEncoder().encode('{"format":"riffology-pi-session-v1"}');let freezes=0;const snapshots:FrozenTurnSnapshotPort={async freeze(runtimeIdentity){freezes++;return {identity:runtimeIdentity,filesArchive:files,piSession:session};}};const port=(clock=()=>1000)=>new R2TurnRevisionPort(bucket as unknown as TurnRevisionBucket,snapshots,clock);return {bucket,files,session,port,get freezes(){return freezes;}};}

test('R2 revision writes content-addressed project and trusted session blobs before one immutable manifest',async()=>{
  const f=fixture(),port=f.port(),receipt=await port.commit(commitInput()),replayed=await port.commit(commitInput());
  assert.equal(receipt.objectKey,'turns/tenant-a/project-a/workspace-a/2/session-a/turn-a/dispatch-a.json');assert.match(receipt.filesSha256,/^[a-f0-9]{64}$/);assert.match(receipt.sessionSha256,/^[a-f0-9]{64}$/);assert.deepEqual(replayed,receipt);assert.equal(f.freezes,1);assert.equal(f.bucket.puts.length,3);assert.deepEqual(await port.observe(identity),receipt);
  const manifest=JSON.parse(new TextDecoder().decode(f.bucket.objects.get(receipt.objectKey)!));assert.deepEqual(manifest.identity,identity);assert.deepEqual(manifest.base,base);assert.equal(manifest.files.sha256,receipt.filesSha256);assert.equal(manifest.piSession.sha256,receipt.sessionSha256);assert.notEqual(manifest.files.sha256,manifest.piSession.sha256);
});
test('verified restore returns immutable files and a session-bound Pi snapshot',async()=>{
  const f=fixture(),checkpoint=await f.port().commit(commitInput()),reader=new R2TurnRevisionReader(f.bucket as unknown as TurnRevisionBucket);
  assert.deepEqual(await reader.inspect(identity),{identity,receipt:checkpoint,outcome:'completed',executionErrorCode:null,base,files:{sha256:checkpoint.filesSha256,size:f.files.byteLength},piSession:{sha256:checkpoint.sessionSha256,size:f.session.byteLength}});
  assert.deepEqual(await reader.load(identity,checkpoint),f.session);
  const otherSession={...identity,sessionId:'session-b'},workspace=await reader.restore(otherSession,checkpoint,false);
  assert.deepEqual(workspace.filesArchive,f.files);assert.deepEqual(workspace.piSession,f.session);assert.deepEqual(workspace.receipt,checkpoint);
  await assert.rejects(reader.load(otherSession,checkpoint),/base-scope-denied/);
  const manifest=JSON.parse(new TextDecoder().decode(f.bucket.objects.get(checkpoint.objectKey)!));f.bucket.objects.set(manifest.piSession.objectKey,new TextEncoder().encode('damaged-session'));
  assert.deepEqual(await reader.files(identity,checkpoint),f.files,'file-only reads do not fetch the unrelated Pi Session blob');await assert.rejects(reader.restore(identity,checkpoint),/object-conflict/);
  assert.equal(await reader.load(identity,null),null);
});
test('restore rejects a valid manifest copied to a noncanonical receipt key',async()=>{
  const f=fixture(),checkpoint=await f.port().commit(commitInput()),forgedKey='turns/copied.json';
  f.bucket.objects.set(forgedKey,Uint8Array.from(f.bucket.objects.get(checkpoint.objectKey)!));
  const reader=new R2TurnRevisionReader(f.bucket as unknown as TurnRevisionBucket);
  await assert.rejects(reader.restore(identity,{...checkpoint,objectKey:forgedKey}),/base-scope-denied/);
});

test('manifest put response loss is recovered by exact readback without refreezing the snapshot',async()=>{
  const f=fixture();f.bucket.loseAt=3;const port=f.port(),recovered=await port.commit(commitInput());assert.equal(recovered.objectKey,turnRevisionObjectKey(identity));assert.deepEqual(await port.observe(identity),recovered);assert.equal(f.freezes,1);assert.equal(f.bucket.puts.length,3);
});

test('revision lineage accepts only existing scope-bound workspace and session heads',async()=>{
  const f=fixture(),port=f.port(),first=await port.commit(commitInput()),nextIdentity={...identity,turnId:'turn-b',dispatchId:'dispatch-b'},claimed={workspace:first,session:first},second=await port.commit(commitInput('completed',null,nextIdentity,claimed));
  const manifest=JSON.parse(new TextDecoder().decode(f.bucket.objects.get(second.objectKey)!));assert.deepEqual(manifest.base,claimed);
  const missing={revisionId:'missing-revision',objectKey:'turns/missing.json',filesSha256:'e'.repeat(64),sessionSha256:'f'.repeat(64),committedAt:1},before=f.freezes;
  await assert.rejects(port.commit(commitInput('completed',null,{...identity,turnId:'turn-c',dispatchId:'dispatch-c'},{workspace:missing,session:null})),/base-missing/);assert.equal(f.freezes,before);
  await assert.rejects(port.commit(commitInput('completed',null,{...identity,turnId:'turn-d',dispatchId:'dispatch-d'},{workspace:{...first,filesSha256:'f'.repeat(64)},session:null})),/base-conflict/);
  const otherIdentity={...identity,sessionId:'session-b',turnId:'turn-other',dispatchId:'dispatch-other'},other=await port.commit(commitInput('completed',null,otherIdentity));
  await assert.rejects(port.commit(commitInput('completed',null,{...identity,turnId:'turn-e',dispatchId:'dispatch-e'},{workspace:other,session:other})),/base-scope-denied/);
});

test('blob interruption leaves no saved manifest and a later observe is absent',async()=>{
  const f=fixture();f.bucket.failAt=2;const port=f.port();await assert.rejects(port.commit(commitInput()),/injected-put-failure/);assert.equal(await port.observe(identity),null);assert.equal(f.bucket.objects.has(turnRevisionObjectKey(identity)),false);
});

test('wrong snapshot identity and conflicting terminal outcome fail closed',async()=>{
  const f=fixture(),wrong:FrozenTurnSnapshotPort={async freeze(){return {identity:{...identity,dispatchId:'dispatch-b'},filesArchive:f.files,piSession:f.session};}},denied=new R2TurnRevisionPort(f.bucket as unknown as TurnRevisionBucket,wrong,()=>1000);
  await assert.rejects(denied.commit(commitInput()),/scope-denied/);assert.equal(f.bucket.puts.length,0);
  const port=f.port();await port.commit(commitInput());await assert.rejects(port.commit(commitInput('failed','provider-failed')),/revision-conflict/);
});

test('corrupt or missing immutable blob prevents checkpoint observation',async()=>{
  const f=fixture(),port=f.port(),receipt=await port.commit(commitInput()),manifest=JSON.parse(new TextDecoder().decode(f.bucket.objects.get(receipt.objectKey)!));f.bucket.objects.set(manifest.piSession.objectKey,new TextEncoder().encode('tampered'));
  await assert.rejects(port.observe(identity),/object-conflict/);f.bucket.objects.delete(manifest.piSession.objectKey);await assert.rejects(port.observe(identity),/object-conflict/);
});

test('restore bounds aggregate blobs and verifies bytes after storage metadata',async()=>{
  const f=fixture(),port=f.port(),receipt=await port.commit(commitInput()),manifest=JSON.parse(new TextDecoder().decode(f.bucket.objects.get(receipt.objectKey)!));
  manifest.files.size=40*1024*1024;manifest.piSession.size=40*1024*1024;f.bucket.objects.set(receipt.objectKey,new TextEncoder().encode(JSON.stringify(manifest)));
  await assert.rejects(port.observe(identity),/object-too-large/);
  const oversized=new Uint8Array(turnRevisionLimits.maxManifestBytes+1),lyingBucket={
    async put(){return null;},
    async get(){return {size:1,body:new ReadableStream({start(controller){controller.enqueue(oversized);controller.close();}}),async arrayBuffer(){return oversized.buffer;}};},
  };
  const reader=new R2TurnRevisionReader(lyingBucket as unknown as TurnRevisionBucket);
  await assert.rejects(reader.restore(identity,receipt),/object-too-large/);
});

test('forged blob keys and empty frozen artifacts fail closed',async()=>{
  const f=fixture(),port=f.port(),receipt=await port.commit(commitInput()),bytes=f.bucket.objects.get(receipt.objectKey)!,manifest=JSON.parse(new TextDecoder().decode(bytes));
  manifest.files.objectKey='turn-blobs-v3/tenant-a/project-a/workspace-a/sessions/'+manifest.files.sha256;f.bucket.objects.set(receipt.objectKey,new TextEncoder().encode(JSON.stringify(manifest)));
  await assert.rejects(port.observe(identity),/invalid-turn-revision-manifest/);
  for(const empty of ['files','session'] as const){
    const bucket=new Bucket(),snapshots:FrozenTurnSnapshotPort={async freeze(runtimeIdentity){return {identity:runtimeIdentity,filesArchive:empty==='files'?new Uint8Array():f.files,piSession:empty==='session'?new Uint8Array():f.session};}};
    await assert.rejects(new R2TurnRevisionPort(bucket as unknown as TurnRevisionBucket,snapshots,()=>1000).commit(commitInput()),/invalid-frozen-turn-snapshot/);assert.equal(bucket.puts.length,0);
  }
});

test('identity key and snapshot bounds reject traversal-shaped ids, stale generation and oversized bytes',async()=>{
  assert.throws(()=>turnRevisionObjectKey({...identity,turnId:'..'}),/turn-identifier/);assert.throws(()=>turnRevisionObjectKey({...identity,generation:3}),/generation-conflict/);
  const bucket=new Bucket(),snapshots:FrozenTurnSnapshotPort={async freeze(runtimeIdentity){return {identity:runtimeIdentity,filesArchive:new Uint8Array(turnRevisionLimits.maxBlobBytes),piSession:new Uint8Array(1)};}};
  await assert.rejects(new R2TurnRevisionPort(bucket as unknown as TurnRevisionBucket,snapshots,()=>1000).commit(commitInput()),/frozen-turn-snapshot/);assert.equal(bucket.puts.length,0);
});

test('concurrent different terminal manifests have one immutable winner',async()=>{
  const f=fixture(),clock=()=>1000,first=f.port(clock),second=f.port(clock),results=await Promise.allSettled([first.commit(commitInput()),second.commit(commitInput('failed','provider-failed'))]);
  assert.equal(results.filter(item=>item.status==='fulfilled').length,1);assert.equal(results.filter(item=>item.status==='rejected').length,1);assert.ok(await first.observe(identity));
});

test('initial content provenance is verified before freeze and preserved without a fake parent Turn',async()=>{
  const {initialCheckpoint}=await import('../../services/runtime/starter.ts'),{checkpointKey}=await import('../../services/runtime/core.ts'),{canonicalWorkspaceMarker,workspaceDigest}=await import('../../services/workspace/protocol.ts'),{initialWorkspaceReferenceFromReady,InitialWorkspaceResolver}=await import('../../services/turn-runtime/initial-workspace.ts');
  const f=fixture(),task={id:'task-initial',tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',generation:2,starterVersion:'blank-v1',authVersion:1,createdAt:1000,deadlineAt:2000},runtime={taskId:task.id,tenantId:task.tenantId,projectId:task.projectId,workspaceId:task.workspaceId,generation:2,runtimeId:'runtime-initial',leaseId:'lease-initial'},markerNonce='nonce-initial';
  const checkpoint=await initialCheckpoint({task,identity:runtime,markerNonce});f.bucket.objects.set(checkpointKey(runtime),new TextEncoder().encode(checkpoint.text));
  const reference=await initialWorkspaceReferenceFromReady({scope:identity.scope,task,runtime,markerNonce,ready:{receiptId:'ready-initial',initializedAt:1500,layoutVersion:'m1-empty-v1',markerSha256:await workspaceDigest(canonicalWorkspaceMarker(runtime,markerNonce)),checkpointRevision:checkpoint.revision}}),resolved=await new InitialWorkspaceResolver(f.bucket as unknown as R2Bucket).resolve(reference,identity.scope),initial={reference,filesSha256:resolved.filesSha256};
  await assert.rejects(f.port().commit(commitInput('completed',null,identity,{workspace:null,session:null,initial:{...initial,filesSha256:'0'.repeat(64)}})),/initial-workspace-files-mismatch/);assert.equal(f.freezes,0);assert.equal(f.bucket.puts.length,0);
  await assert.rejects(f.port().commit(commitInput('completed',null,{...identity,scope:{...identity.scope,tenantId:'tenant-b'}},{workspace:null,session:null,initial})),/scope-denied/);assert.equal(f.freezes,0);assert.equal(f.bucket.puts.length,0);
  const receipt=await f.port().commit(commitInput('completed',null,identity,{workspace:null,session:null,initial})),reader=new R2TurnRevisionReader(f.bucket as unknown as TurnRevisionBucket),files=await reader.workspaceFiles(identity,receipt);
  assert.equal(files.base,null);assert.deepEqual(files.initial,initial);assert.deepEqual((await reader.inspect(identity))!.base,{workspace:null,session:null,initial});
  f.bucket.objects.delete(checkpointKey(runtime));const before=f.freezes,puts=f.bucket.puts.length;
  await assert.rejects(f.port().commit(commitInput('completed',null,{...identity,turnId:'missing-initial',dispatchId:'missing-initial-dispatch'},{workspace:null,session:null,initial})),/checkpoint-missing/);assert.equal(f.freezes,before);assert.equal(f.bucket.puts.length,puts);
});

test('official initial revision resolves model bytes only from the explicit model bucket',async()=>{
  const {initialCheckpoint}=await import('../../services/runtime/starter.ts'),{checkpointKey}=await import('../../services/runtime/core.ts'),{canonicalWorkspaceMarker,workspaceDigest}=await import('../../services/workspace/protocol.ts'),{initialWorkspaceReferenceFromReady,InitialWorkspaceResolver}=await import('../../services/turn-runtime/initial-workspace.ts'),{modelContentKey,verifyModelContent}=await import('../../services/runtime/content.ts');
  const f=fixture(),models=new Bucket(),content='print("official")\n',packageText=JSON.stringify({schemaVersion:1,files:[{path:'model/main.py',bytes:new TextEncoder().encode(content).length,sha256:await workspaceDigest(content),contentBase64:Buffer.from(content).toString('base64')}]}),modelContent={modelVersionId:'version-initial',modelId:'queue',version:'1',contentRef:'queue-v1.json',contentSha256:await workspaceDigest(packageText)};
  const task={id:'task-model',tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',generation:2,starterVersion:'blank-v1',authVersion:1,createdAt:1000,deadlineAt:2000,modelContent},runtime={taskId:task.id,tenantId:task.tenantId,projectId:task.projectId,workspaceId:task.workspaceId,generation:2,runtimeId:'runtime-model',leaseId:'lease-model'},markerNonce='nonce-model';
  models.objects.set(modelContentKey(modelContent),new TextEncoder().encode(packageText));const verified=await verifyModelContent(modelContent,(await models.get(modelContentKey(modelContent)))!);
  const checkpoint=await initialCheckpoint({task,identity:runtime,markerNonce},verified.receipt);f.bucket.objects.set(checkpointKey(runtime),new TextEncoder().encode(checkpoint.text));
  const reference=await initialWorkspaceReferenceFromReady({scope:identity.scope,task,runtime,markerNonce,ready:{receiptId:'ready-model',initializedAt:1500,layoutVersion:'m1-empty-v1',markerSha256:await workspaceDigest(canonicalWorkspaceMarker(runtime,markerNonce)),checkpointRevision:checkpoint.revision}}),modelBucket=models as unknown as R2Bucket;
  const resolved=await new InitialWorkspaceResolver(f.bucket as unknown as R2Bucket,modelBucket).resolve(reference,identity.scope),initial={reference,filesSha256:resolved.filesSha256},input=commitInput('completed',null,identity,{workspace:null,session:null,initial});
  // Even a same-key object in the checkpoint bucket must not act as a fallback.
  f.bucket.objects.set(modelContentKey(modelContent),new TextEncoder().encode(packageText));
  await assert.rejects(f.port().commit(input),/model-source-required/);assert.equal(f.freezes,0);assert.equal(f.bucket.puts.length,0);
  const receipt=await new R2TurnRevisionPort(f.bucket as unknown as TurnRevisionBucket,{async freeze(runtimeIdentity){return {identity:runtimeIdentity,filesArchive:resolved.filesArchive,piSession:f.session};}},()=>1000,modelBucket).commit(input);
  assert.equal(receipt.filesSha256,resolved.filesSha256);
  models.objects.delete(modelContentKey(modelContent));
  await assert.rejects(new R2TurnRevisionPort(f.bucket as unknown as TurnRevisionBucket,{async freeze(){throw Error('must-not-freeze');}},()=>1000,modelBucket).commit({...input,identity:{...identity,turnId:'model-missing',dispatchId:'model-missing-dispatch'}}),/model-content-missing/);
});

test('issue 77: legacy v3 Pi manifests restore without rewriting immutable bytes',async()=>{
 const f=fixture(),receipt=await f.port().commit(commitInput());
 const value=JSON.parse(new TextDecoder().decode(f.bucket.objects.get(receipt.objectKey)!));assert.equal(value.schemaVersion,4);assert.equal(value.backendState.backend,'pi');
 delete value.backendState;value.schemaVersion=3;const bytes=new TextEncoder().encode(JSON.stringify(value));f.bucket.objects.set(receipt.objectKey,bytes);
 const revisionId=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),legacy={...receipt,revisionId};
 const reader=new R2TurnRevisionReader(f.bucket as unknown as TurnRevisionBucket);assert.deepEqual(await reader.load(identity,legacy),f.session);assert.equal((await reader.backendState(identity,legacy)).backend,'pi');assert.deepEqual(f.bucket.objects.get(receipt.objectKey),bytes);
});
test('issue 77: managed reference round trips through immutable revision without placeholder Pi session',async()=>{
 const {stageFrozenTurnSnapshot,readFrozenTurnSnapshot}=await import('../../services/turn-runtime/revision.ts');
 const {readManifest}=await import('../../services/turn-runtime/revision-gc.ts');
 const f=fixture(),backendState={schemaVersion:1 as const,backend:'managed-agents' as const,recovery:'remote-reference' as const,identity,sessionId:'remote-session',turnId:'remote-turn'},snapshot={identity,filesArchive:f.files,backendState};
 const staged=await stageFrozenTurnSnapshot(f.bucket as unknown as TurnRevisionBucket,snapshot);
 assert.deepEqual(await readFrozenTurnSnapshot(f.bucket as unknown as TurnRevisionBucket,identity,staged),snapshot);
 const port=new R2TurnRevisionPort(f.bucket as unknown as TurnRevisionBucket,{async freeze(){return snapshot;}},()=>1000),receipt=await port.commit(commitInput());
 const manifest=JSON.parse(new TextDecoder().decode(f.bucket.objects.get(receipt.objectKey)!));assert.equal(manifest.schemaVersion,4);assert.ok(manifest.sessionState);assert.equal(Object.hasOwn(manifest,'piSession'),false);
 const reader=new R2TurnRevisionReader(f.bucket as unknown as TurnRevisionBucket),restored=await reader.restore(identity,receipt,true);assert.equal(restored.piSession,null);assert.deepEqual(restored.backendState,backendState);assert.deepEqual(await reader.files(identity,receipt),f.files);
 await assert.rejects(reader.load(identity,receipt),/backend-mismatch/);
 assert.equal((await readManifest(f.bucket as any,receipt.objectKey,identity.scope)).size,2);
 manifest.backendState.identity={...identity,sessionId:'another-session'};f.bucket.objects.set(receipt.objectKey,new TextEncoder().encode(JSON.stringify(manifest)));await assert.rejects(port.observe(identity),/scope-denied/);
});
test('issue 77: writer rollback preserves v4 readers and emits legacy Pi format only for new revisions',async()=>{
 const f=fixture(),first=await f.port().commit(commitInput()),next={...identity,turnId:'rollback-turn',dispatchId:'rollback-dispatch'};
 const rollback=new R2TurnRevisionPort(f.bucket as unknown as TurnRevisionBucket,{async freeze(){return {identity:next,filesArchive:f.files,piSession:f.session};}},()=>2000,undefined,3);
 const saved=await rollback.commit(commitInput('completed',null,next,{workspace:first,session:first}));
 assert.equal(JSON.parse(new TextDecoder().decode(f.bucket.objects.get(saved.objectKey)!)).schemaVersion,3);
 assert.equal(JSON.parse(new TextDecoder().decode(f.bucket.objects.get(first.objectKey)!)).schemaVersion,4);
 const reader=new R2TurnRevisionReader(f.bucket as unknown as TurnRevisionBucket);assert.deepEqual(await reader.load(next,saved),f.session);assert.deepEqual(await reader.load(identity,first),f.session);
});
for(const recovery of ['files-only','unrecoverable'] as const)test(`issue 77: ${recovery} Managed recovery survives publication, restore and GC without a false live Session reference`,async()=>{
 const {readManifest}=await import('../../services/turn-runtime/revision-gc.ts');
 const f=fixture(),backendState={schemaVersion:1 as const,backend:'managed-agents' as const,recovery};
 const port=new R2TurnRevisionPort(f.bucket as unknown as TurnRevisionBucket,{async freeze(){return {identity,filesArchive:f.files,backendState};}},()=>1000);
 const receipt=await port.commit(commitInput());assert.deepEqual(await port.commit(commitInput()),receipt);
 const reader=new R2TurnRevisionReader(f.bucket as unknown as TurnRevisionBucket),restored=await reader.restore(identity,receipt,true);
 assert.equal(restored.piSession,null);assert.deepEqual(restored.backendState,backendState);assert.deepEqual(restored.filesArchive,f.files);
 assert.equal((await readManifest(f.bucket as any,receipt.objectKey,identity.scope)).size,2);await assert.rejects(reader.load(identity,receipt),/backend-mismatch/);
});
