import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolArtifactMaterializer } from '../../services/artifacts/materializer.ts';
import { toolArtifactDescriptor, type ToolArtifactStoreRpc } from '../../services/artifacts/protocol.ts';
import type { ToolEffectReceipt } from '../../services/tools/ledger.ts';
import type { ToolCommand } from '../../services/tools/protocol.ts';

const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const command=(operation:'read'|'write'='read'):ToolCommand=>({schemaVersion:1,scope,turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-a',deadlineAt:2000,operation,arguments:operation==='read'?{path:'model/a.txt'}:{path:'model/a.txt',content:'x'}});
const receipt=(result:Record<string,unknown>):ToolEffectReceipt=>({schemaVersion:1,scope,turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-a',effectId:'effect-a',phase:'terminal',outcome:'completed',errorCode:null,result,observedAt:1500});
const receiptFor=async(input:Parameters<ToolArtifactStoreRpc['materialize']>[0])=>{const descriptor=await toolArtifactDescriptor(input);return {schemaVersion:1 as const,artifactId:descriptor.artifactId,operation:descriptor.identity.operation,mediaType:'application/json' as const,bytes:descriptor.descriptor.bytes,sha256:descriptor.descriptor.sha256,createdAt:1500};};
const unusedLifecycle=()=>({async retain():Promise<never>{throw Error('unused');},async release():Promise<never>{throw Error('unused');},async references(){return [];}});

test('small results stay inline and large reads become bounded artifact references',async()=>{
  let calls=0;const store:ToolArtifactStoreRpc={...unusedLifecycle(),async materialize(input){calls++;assert.equal(input.identity.operation,'read');assert.ok(input.content.byteLength>16384);const descriptor=await toolArtifactDescriptor(input);return {intent:{operationId:descriptor.operationId,inputSha256:descriptor.inputSha256},receipt:await receiptFor(input)};},async reconcile(){throw Error('unused');},async read(){throw Error('unused');}};
  const materializer=new ToolArtifactMaterializer(store),small=receipt({kind:'read',content:'small'});assert.deepEqual(await materializer.materialize(small,command()),small);assert.equal(calls,0);
  const large=await materializer.materialize(receipt({kind:'read',content:'x'.repeat(20_000)}),command());assert.equal((large.result as any).kind,'artifact');assert.match((large.result as any).artifact.artifactId,/^artifact-[a-f0-9]{60}$/);assert.equal(calls,1);assert.ok(JSON.stringify(large.result).length<16384);
});

test('a lost materialize response completes only through exact artifact reconcile',async()=>{
  let reconciles=0,recovered:Awaited<ReturnType<typeof receiptFor>>|null=null;const store:ToolArtifactStoreRpc={...unusedLifecycle(),async materialize(input){recovered=await receiptFor(input);throw Error('lost-ack');},async reconcile(identity,intent){reconciles++;assert.equal(identity.effectId,'effect-a');assert.match(intent.operationId,/^artifact:/);return recovered;},async read(){throw Error('unused');}};
  const result=await new ToolArtifactMaterializer(store).materialize(receipt({kind:'read',content:'x'.repeat(20_000)}),command());assert.deepEqual((result.result as any).artifact,recovered);assert.equal(reconciles,1);
});

test('a store receipt that does not match the materialized bytes is rejected',async()=>{
  const store:ToolArtifactStoreRpc={...unusedLifecycle(),async materialize(input){const valid=await receiptFor(input);return {intent:{operationId:`artifact:${valid.artifactId}`,inputSha256:'c'.repeat(64)},receipt:{...valid,sha256:'d'.repeat(64)}};},async reconcile(){return null;},async read(){throw Error('unused');}};
  await assert.rejects(new ToolArtifactMaterializer(store).materialize(receipt({kind:'read',content:'x'.repeat(20_000)}),command()),/tool-artifact-receipt-conflict/);
});

test('large mutation output and an absent artifact reconciliation fail closed',async()=>{
  const unused:ToolArtifactStoreRpc={...unusedLifecycle(),async materialize(){throw Error('unused');},async reconcile(){return null;},async read(){throw Error('unused');}};
  await assert.rejects(new ToolArtifactMaterializer(unused).materialize(receipt({content:'x'.repeat(20_000)}),command('write')),/operation-denied/);
  const lost:ToolArtifactStoreRpc={...unusedLifecycle(),async materialize(){throw Error('lost-before-put');},async reconcile(){return null;},async read(){throw Error('unused');}};
  await assert.rejects(new ToolArtifactMaterializer(lost).materialize(receipt({content:'x'.repeat(20_000)}),command()),/lost-before-put/);
});
