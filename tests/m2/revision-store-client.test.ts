import assert from 'node:assert/strict';
import test from 'node:test';
import {RevisionStoreCheckpointPort,revisionCommitIntent,revisionCommitResolution} from '../../services/turn-runtime/revision-store-client.ts';

const receipt={
  revisionId:'revision-a',
  objectKey:'turns/tenant-a/project-a/workspace-a/1/session-a/turn-a/dispatch-a.json',
  filesSha256:'a'.repeat(64),
  sessionSha256:'b'.repeat(64),
  committedAt:1000,
};

test('revision-store commit resolution validates every explicit authority outcome',()=>{
  assert.deepEqual(revisionCommitResolution({status:'committed',receipt}),{status:'committed',receipt});
  for(const status of ['absent','pending','unavailable','conflict','aborted'] as const)assert.deepEqual(revisionCommitResolution({status}),{status});
});

test('revision-store commit resolution rejects ambiguous and extended wire shapes',()=>{
  for(const value of [null,receipt,{status:'committed'},{status:'committed',receipt,reason:'extra'},{status:'absent',receipt},{status:'unknown'}])assert.throws(()=>revisionCommitResolution(value),/invalid-revision-store-commit-resolution/);
});

test('checkpoint commit after client reconstruction uses the durable prepared operation',async()=>{
  const identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1},input={identity,outcome:'completed' as const,executionErrorCode:null,base:{workspace:null,session:null}},snapshot={identity,filesArchive:new TextEncoder().encode('files'),piSession:new TextEncoder().encode('session')};
  let frozen=0;const prepared=new Map<string,typeof snapshot>(),store={
    async prepareCommit(raw:typeof input&{snapshot:typeof snapshot}){const intent=await revisionCommitIntent(raw,raw.snapshot);prepared.set(intent.operationId,raw.snapshot);return intent;},
    async commitPrepared(raw:{operationId:string}){assert.ok(prepared.has(raw.operationId));return {status:'committed',receipt};},
    async reconcileCommit(){return {status:'absent'};},async abandonCommit(){return {status:'aborted'};},
  };
  const first=new RevisionStoreCheckpointPort(store as never,{async freeze(){frozen++;return snapshot;}}),intent=await first.prepare(input);
  const rebuilt=new RevisionStoreCheckpointPort(store as never,{async freeze(){throw Error('rebuilt-client-must-not-refreeze');}}),saved=await rebuilt.commit(input,intent);
  assert.equal(frozen,1);assert.deepEqual(saved,{status:'committed',receipt});
});
