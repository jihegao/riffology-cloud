import test from 'node:test';
import assert from 'node:assert/strict';
import {observerExecutorActorName} from '../../services/preview/observer-executor-protocol.ts';
import type {ObserverCommand} from '../../services/preview/observer-protocol.ts';
const command=():ObserverCommand=>({schemaVersion:1,purpose:'observer',scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},sessionId:'session',turnId:'turn',dispatchId:'dispatch',commandId:'command',previewId:'preview',operation:'snapshot',deadlineAt:1});
test('executor identity isolates workspace generation and logical calls, and remains addressable after expiry',async()=>{
 const c=command(),name=await observerExecutorActorName(c);assert.match(name,/^observer-executor-[a-f0-9]{64}$/);
 for(const changed of [{...c,scope:{...c.scope,tenantId:'other'}},{...c,scope:{...c.scope,projectId:'other'}},{...c,scope:{...c.scope,workspaceId:'other'}},{...c,scope:{...c.scope,workspaceGeneration:2}},{...c,turnId:'other'},{...c,dispatchId:'other'},{...c,commandId:'other'}])assert.notEqual(await observerExecutorActorName(changed),name);
 assert.equal(await observerExecutorActorName({...c,operation:'reload',previewId:'other',deadlineAt:1000}),name);
 const pending=observerExecutorActorName(c);c.scope.tenantId='mutated';assert.equal(await pending,name);
});
test('invalid historical commands cannot derive an executor address',async()=>{
 for(const c of [{...command(),commandId:'../x'},{...command(),deadlineAt:0},{...command(),purpose:'browser'},{...command(),extra:true}])await assert.rejects(observerExecutorActorName(c as ObserverCommand));
});
