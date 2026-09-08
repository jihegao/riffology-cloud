import assert from 'node:assert/strict';
import test from 'node:test';
import { issueProjectEffectCapability, verifyProjectEffectCapability } from '../../services/sandbox/capability.ts';
import type { ToolCommand } from '../../services/tools/protocol.ts';

const key='test-only-project-effect-capability-key-32-bytes';
const now=1_800_000_000_000;
const command:ToolCommand={schemaVersion:1,scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-a',deadlineAt:now+60_000,operation:'write',arguments:{path:'model/main.py',content:'print(1)'}};

test('project effect capability binds actor, scope, command, effect and expiry',async()=>{
  const capability=await issueProjectEffectCapability(key,{actorId:'m2-p-actor-a',command,effectId:'effect-a',expiresAt:now+300_000},()=>now);
  const claims=await verifyProjectEffectCapability(key,'m2-p-actor-a',command,'effect-a',capability,()=>now+1);
  assert.equal(claims.commandId,'command-a');
  await assert.rejects(()=>verifyProjectEffectCapability(key,'m2-p-actor-b',command,'effect-a',capability,()=>now+1),/project-effect-capability-mismatch/);
  await assert.rejects(()=>verifyProjectEffectCapability(key,'m2-p-actor-a',{...command,scope:{...command.scope,tenantId:'tenant-b'}},'effect-a',capability,()=>now+1),/project-effect-capability-mismatch/);
  await assert.rejects(()=>verifyProjectEffectCapability(key,'m2-p-actor-a',command,'effect-b',capability,()=>now+1),/project-effect-capability-mismatch/);
  await assert.rejects(()=>verifyProjectEffectCapability(key,'m2-p-actor-a',command,'effect-a',capability,()=>now+300_000),/project-effect-capability-expired/);
});

test('project effect capability rejects signature, shape, key and excessive TTL',async()=>{
  const capability=await issueProjectEffectCapability(key,{actorId:'m2-p-actor-a',command,effectId:'effect-a',expiresAt:now+300_000},()=>now);
  const tampered={...capability,mac:`${capability.mac.slice(0,-1)}${capability.mac.endsWith('0')?'1':'0'}`};
  await assert.rejects(()=>verifyProjectEffectCapability(key,'m2-p-actor-a',command,'effect-a',tampered,()=>now+1),/project-effect-capability-invalid-signature/);
  await assert.rejects(()=>verifyProjectEffectCapability('short','m2-p-actor-a',command,'effect-a',capability,()=>now+1),/invalid-project-effect-capability-key/);
  await assert.rejects(()=>issueProjectEffectCapability(key,{actorId:'m2-p-actor-a',command,effectId:'effect-a',expiresAt:now+600_001},()=>now),/invalid-project-effect-capability-expiry/);
  await assert.rejects(()=>verifyProjectEffectCapability(key,'m2-p-actor-a',command,'effect-a',{...capability,extra:true},()=>now+1),/invalid-project-effect-capability/);
});
