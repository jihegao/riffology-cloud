import assert from 'node:assert/strict';
import test from 'node:test';
import { sandboxActorIds } from '../../services/sandbox/policy.ts';
import type { TurnExecutionObservation, TurnExecutionPort } from '../../services/turn-runtime/core.ts';
import type { TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';
import { ProjectWorkspaceLifecycle, TurnBaseUnavailableError, WorkspacePreparedExecutionPort, type ProjectWorkspaceRpc, type WorkspaceRevisionSource } from '../../services/turn-runtime/workspace.ts';

test('prepared execution freezes its absolute deadline before awaiting restoration',async()=>{
 let release!:()=>void,started!:()=>void,observed:number|undefined;
 const waiting=new Promise<void>(r=>{started=r;}),restored=new Promise<void>(r=>{release=r;});
 const port=new WorkspacePreparedExecutionPort({async prepare(){started();await restored;}} as never,{async start(input){observed=input.executionDeadlineAt;return running;},async observe(){return running;},async cancel(){return running;},async release(){return {running:false};}});
 const input={...identity,actor,message:'Build',base,executionDeadlineAt:5000};
 const pending=port.start(input);await waiting;input.executionDeadlineAt=9000;release();await pending;assert.equal(observed,5000);
});

const identity:TurnRuntimeIdentity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2};
const actor={userId:'user-a',authVersion:1};
const checkpoint={revisionId:'revision-a',objectKey:'turns/a.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1},base={workspace:checkpoint,session:null},archive=new Uint8Array([1,2,3]);
const running:TurnExecutionObservation={identity,phase:'running',outcome:null,events:[]};

test('workspace lifecycle restores the verified R2 files into the derived Project actor and freezes that actor',async()=>{
  const calls:unknown[]=[],source:WorkspaceRevisionSource={async restore(value,receipt,sessionBound){calls.push(['source',value,receipt,sessionBound]);return {identity:{...identity,turnId:'parent',dispatchId:'parent-dispatch'},receipt,filesArchive:archive,piSession:new Uint8Array([9])};}},sandbox:ProjectWorkspaceRpc={async restoreWorkspace(value,claimed,bytes){calls.push(['restore',value,claimed,bytes]);return {sha256:checkpoint.filesSha256,bytes:3};},async freezeWorkspace(value,claimed){calls.push(['freeze',value,claimed]);return archive;}};
  let actor='';const lifecycle=new ProjectWorkspaceLifecycle(source,value=>{actor=value;return sandbox;});await lifecycle.prepare(identity,base);const frozen=await lifecycle.frozenFiles(identity,base);
  assert.equal(actor,(await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project);assert.deepEqual(frozen,archive);assert.deepEqual(calls,[['source',identity,checkpoint,false],['restore',identity,base,archive],['freeze',identity,base]]);
});

test('genesis restore supplies no archive and a forged source receipt fails before resolving a Sandbox',async()=>{
  let resolved=0;const sandbox:ProjectWorkspaceRpc={async restoreWorkspace(_identity,_base,bytes){assert.equal(bytes,null);return {sha256:'x',bytes:1};},async freezeWorkspace(){return archive;}};
  const source:WorkspaceRevisionSource={async restore(_identity,receipt){return {identity,receipt:{...receipt,revisionId:'forged'},filesArchive:archive,piSession:new Uint8Array([9])};}},lifecycle=new ProjectWorkspaceLifecycle(source,()=>{resolved++;return sandbox;});
  await lifecycle.prepare(identity,{workspace:null,session:null});assert.equal(resolved,1);
  await assert.rejects(lifecycle.prepare(identity,base),TurnBaseUnavailableError);assert.equal(resolved,1);
});

test('verified base corruption becomes a terminal pre-execution failure while transport uncertainty remains unknown',async()=>{
  let starts=0,resolved=0;const execution:TurnExecutionPort={async start(){starts++;return running;},async observe(){return running;},async cancel(){return running;},async release(){return {running:false};}};
  const corrupted=new ProjectWorkspaceLifecycle({async restore(){throw Error('turn-revision-object-conflict');}},()=>{resolved++;throw Error('unused');});
  const terminal=await new WorkspacePreparedExecutionPort(corrupted,execution).start({...identity,actor,message:'Build',base});
  assert.equal(terminal.phase,'terminal');assert.equal(terminal.outcome,'failed');assert.equal(terminal.executionErrorCode,'turn-base-unavailable');assert.equal(terminal.stopped?.nativeRunning,false);assert.equal(terminal.stopped?.fenced,true);assert.equal(starts,0);assert.equal(resolved,0);
  const uncertain=new ProjectWorkspaceLifecycle({async restore(){throw Error('r2-transport-lost');}},()=>{resolved++;throw Error('unused');});
  await assert.rejects(new WorkspacePreparedExecutionPort(uncertain,execution).start({...identity,actor,message:'Build',base}),/r2-transport-lost/);assert.equal(starts,0);assert.equal(resolved,0);
});

test('prepared execution restores exactly once before native start and never from observe or cancel',async()=>{
  const calls:string[]=[],workspace={async prepare(){calls.push('prepare');}},execution:TurnExecutionPort={async start(){calls.push('start');return running;},async observe(){calls.push('observe');return running;},async cancel(){calls.push('cancel');return running;},async release(){calls.push('release');return {running:false};}},port=new WorkspacePreparedExecutionPort(workspace as never,execution);
  const accepted=await Promise.all([port.start({...identity,actor,message:'Build',base}),port.start({...identity,actor,message:'Build',base})]);assert.deepEqual(accepted,[running,running]);assert.deepEqual(calls,['prepare','start']);await assert.rejects(port.start({...identity,actor,message:'Different',base}),/execution-conflict/);await port.observe(identity);await port.cancel(identity);assert.deepEqual(calls,['prepare','start','observe','cancel']);
  const failed=new WorkspacePreparedExecutionPort({async prepare(){throw Error('restore-failed');}} as never,execution);await assert.rejects(failed.start({...identity,actor,message:'Build',base}),/restore-failed/);assert.equal(calls.filter(value=>value==='start').length,1);
});
