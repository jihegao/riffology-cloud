import test from 'node:test';
import assert from 'node:assert/strict';
import {issueExecutionIsolationAuthority,verifyExecutionIsolationAuthority} from '../../services/model-budget/execution-isolation-capability.ts';

const secret='fixture-execution-isolation-authority-key-32-bytes';
const proof={schemaVersion:1,callKey:'a'.repeat(64),turnKey:'b'.repeat(64),recordDigest:'c'.repeat(64),evidenceSha256:'d'.repeat(64),isolatedAt:1,classification:'runtime-absent-and-fenced'};

test('execution isolation authority binds exact ledger, tenant and proof',async()=>{
 const authority=await issueExecutionIsolationAuthority(secret,'legacy','tenant-a',proof);
 await verifyExecutionIsolationAuthority(secret,'legacy','tenant-a',proof,authority);
 await assert.rejects(verifyExecutionIsolationAuthority(secret,'g5','tenant-a',proof,authority),/authority-invalid/);
 await assert.rejects(verifyExecutionIsolationAuthority(secret,'legacy','tenant-b',proof,authority),/authority-invalid/);
 await assert.rejects(verifyExecutionIsolationAuthority(secret,'legacy','tenant-a',{...proof,evidenceSha256:'e'.repeat(64)},authority),/authority-invalid/);
 await assert.rejects(verifyExecutionIsolationAuthority(secret,'legacy','tenant-a',proof,'0'.repeat(64)),/authority-invalid/);
});
