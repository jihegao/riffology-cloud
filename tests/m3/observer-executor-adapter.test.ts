import test from 'node:test';
import assert from 'node:assert/strict';
import {executeObserverCapability} from '../../services/observer-browser/executor.ts';
import type {ObserverExecutorCapabilityPort} from '../../services/preview/observer-executor-protocol.ts';
import type {ObserverCommand} from '../../services/preview/observer-protocol.ts';
const command=():ObserverCommand=>({schemaVersion:1,purpose:'observer',scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},sessionId:'session',turnId:'turn',dispatchId:'dispatch',commandId:'command',previewId:'preview',operation:'snapshot',deadlineAt:Date.now()+10000});
const resources={browser:{async run():Promise<never>{throw Error('must-not-start-browser');}},artifacts:{async save():Promise<never>{throw Error('must-not-save');}}};
function pending(){let entered!:()=>void;const ready=new Promise<void>(r=>{entered=r;});return {ready,run:()=>{entered();return new Promise<never>(()=>{});}};}
test('capability disconnect cancels a noncooperative authority query before the command deadline',async()=>{
 const auth=pending();let queries=0;
 const capability:ObserverExecutorCapabilityPort={authorize:auth.run,forward:async()=>{throw Error('must-not-forward');},cancelled:async()=>{queries++;await auth.ready;throw Error('disconnected');}};
 const started=Date.now();await assert.rejects(executeObserverCapability(command(),capability,resources),/observer-execution-cancelled/);assert.equal(queries,1);assert.ok(Date.now()-started<2000);
});
test('parent cancellation settles while remote cancellation polling is hung',async()=>{
 const auth=pending(),poll=pending(),controller=new AbortController();
 const result=executeObserverCapability(command(),{authorize:auth.run,forward:async()=>{throw Error('must-not-forward');},cancelled:poll.run},resources,controller.signal);
 await Promise.all([auth.ready,poll.ready]);controller.abort();await assert.rejects(result,/observer-execution-cancelled/);
});
test('capability revocation is polled serially and cancels waiting authority',async()=>{
 const auth=pending();let queries=0,concurrent=0,maxConcurrent=0;
 const result=executeObserverCapability(command(),{authorize:auth.run,forward:async()=>{throw Error('must-not-forward');},cancelled:async()=>{concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);await auth.ready;concurrent--;return ++queries===2;}},resources);
 await assert.rejects(result,/observer-execution-cancelled/);assert.equal(queries,2);assert.equal(maxConcurrent,1);
});
