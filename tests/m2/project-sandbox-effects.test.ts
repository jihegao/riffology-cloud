import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyProjectEffectCapability } from '../../services/sandbox/capability.ts';
import { sandboxActorIds } from '../../services/sandbox/policy.ts';
import { ProjectSandboxFileEffects } from '../../services/tools/project-sandbox.ts';
import { toolCommandDigest, type ToolCommand } from '../../services/tools/protocol.ts';
import type { ToolCommandReference, ToolEffectReceipt } from '../../services/tools/ledger.ts';

const key='test-only-project-effect-capability-key-32-bytes',now=1_800_000_000_000;
const command:ToolCommand={schemaVersion:1,scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-a',deadlineAt:now+60_000,operation:'write',arguments:{path:'model/main.py',content:'print(1)'}};
const receipt=(effectId:string):ToolEffectReceipt=>({schemaVersion:1,scope:command.scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,effectId,phase:'running',outcome:null,errorCode:null,result:null,observedAt:now});

test('platform adapter derives actor and signs exact execute identity',async()=>{
  let resolved='',called=0;
  const effects=new ProjectSandboxFileEffects(key,actorId=>{resolved=actorId;return {
    async executeFileEffect(input){called++;await verifyProjectEffectCapability(key,actorId,input.command,input.effectId,input.capability,()=>now);return receipt(input.effectId);},
    async observeFileEffect(){throw Error('unused');},
  };},()=>now);
  const result=await effects.execute({command,effectId:'effect-a'}),expected=(await sandboxActorIds(command.scope,command.turnId,command.dispatchId)).project;
  assert.equal(resolved,expected);assert.equal(called,1);assert.equal(result.effectId,'effect-a');
});

test('observe validates retained reference before resolving a Sandbox actor',async()=>{
  let resolved=0;
  const expected=(await sandboxActorIds(command.scope,command.turnId,command.dispatchId)).project;
  const effects=new ProjectSandboxFileEffects(key,()=>{resolved++;return {
    async executeFileEffect(){throw Error('unused');},
    async observeFileEffect(input){await verifyProjectEffectCapability(key,expected,input.command,input.reference.effectId,input.capability,()=>now);return receipt(input.reference.effectId);},
  };},()=>now);
  const reference:ToolCommandReference={scope:command.scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,digest:await toolCommandDigest(command),effectId:'effect-a'};
  assert.equal((await effects.observe({reference,command})).phase,'running');assert.equal(resolved,1);
  await assert.rejects(()=>effects.observe({reference:{...reference,digest:'0'.repeat(64)},command}),/project-sandbox-reference-mismatch/);assert.equal(resolved,1);
});
