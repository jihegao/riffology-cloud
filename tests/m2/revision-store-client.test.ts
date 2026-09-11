import assert from 'node:assert/strict';
import test from 'node:test';
import {revisionCommitResolution} from '../../services/turn-runtime/revision-store-client.ts';

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
