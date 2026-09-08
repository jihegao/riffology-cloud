import assert from 'node:assert/strict';
import test from 'node:test';
import type { TurnBaseCheckpoints } from '../../services/turn/protocol.ts';
import type { TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';
import { ProductTurnSnapshotPort } from '../../services/turn-runtime/snapshot.ts';

const identity:TurnRuntimeIdentity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2};
const checkpoint={revisionId:'revision-a',objectKey:'turns/a.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1};
const base:TurnBaseCheckpoints={workspace:checkpoint,session:checkpoint};

test('snapshot combines the same validated identity and base from the two trust domains',async()=>{
  const calls:unknown[]=[],files=new Uint8Array([1,2]),session=new Uint8Array([3,4]);
  const port=new ProductTurnSnapshotPort({async frozenFiles(value,input){calls.push(['files',value,input]);return files;}},{async frozenSession(value){calls.push(['session',value]);return session;}});
  const result=await port.freeze(identity,base);
  assert.deepEqual(result,{identity,filesArchive:files,piSession:session});
  assert.deepEqual(calls,[['files',identity,base],['session',identity]]);
  files[0]=9;session[0]=9;assert.deepEqual(result.filesArchive,new Uint8Array([1,2]));assert.deepEqual(result.piSession,new Uint8Array([3,4]));
});

test('snapshot rejects malformed identity or base before either freezer runs',async()=>{
  let calls=0;const port=new ProductTurnSnapshotPort({async frozenFiles(){calls++;return new Uint8Array([1]);}},{async frozenSession(){calls++;return new Uint8Array([2]);}});
  await assert.rejects(port.freeze({...identity,generation:3} as never,base),/generation-conflict/);assert.equal(calls,0);
  await assert.rejects(port.freeze(identity,{workspace:{...checkpoint,revisionId:'bad revision'},session:null} as never),/invalid-turn-identifier/);assert.equal(calls,0);
});
