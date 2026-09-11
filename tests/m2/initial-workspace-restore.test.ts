import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectWorkspaceLifecycle, TurnBaseUnavailableError, type WorkspaceRevisionSource, type ProjectWorkspaceRpc } from '../../services/turn-runtime/workspace.ts';
import { SandboxProjectWorkspacePort, type ProjectWorkspaceSandboxApi } from '../../services/project-tools/workspace.ts';
import { initialWorkspaceReferenceFromReady, type ResolvedInitialWorkspace } from '../../services/turn-runtime/initial-workspace.ts';
import { initialCheckpoint } from '../../services/runtime/starter.ts';
import { initialWorkspaceArchive } from '../../services/turn-runtime/initial-workspace-archive.ts';
import { canonicalWorkspaceMarker, workspaceDigest } from '../../services/workspace/protocol.ts';
import { turnDigest } from '../../services/turn/protocol.ts';
import { sandboxActorIds } from '../../services/sandbox/policy.ts';
const identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1};
async function hash(bytes:Uint8Array){return Buffer.from(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes))).toString('hex');}
async function fixture(){
 const task={id:'task-a',tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:1000,deadlineAt:2000};
 const runtime={taskId:task.id,tenantId:task.tenantId,projectId:task.projectId,workspaceId:task.workspaceId,generation:1,runtimeId:'runtime-a',leaseId:'lease-a'},markerNonce='nonce-a';
 const checkpoint=await initialCheckpoint({task,identity:runtime,markerNonce});
 const reference=await initialWorkspaceReferenceFromReady({scope:identity.scope,task,runtime,markerNonce,ready:{receiptId:'receipt-a',initializedAt:1500,layoutVersion:'m1-empty-v1',markerSha256:await workspaceDigest(canonicalWorkspaceMarker(runtime,markerNonce)),checkpointRevision:checkpoint.revision}});
 const filesArchive=initialWorkspaceArchive({'model/main.py':new TextEncoder().encode('print("initial")\n')}),filesSha256=await hash(filesArchive);
 const resolved={reference,filesArchive,filesSha256,referenceSha256:await turnDigest(reference)},base={workspace:null,session:null,initial:{reference,filesSha256}};
 return {resolved,base};
}
test('initial source is verified before native resolution and supplied intact to restore',async()=>{
 const {resolved,base}=await fixture(),calls:string[]=[];
 const source:WorkspaceRevisionSource={async restore(){throw Error('saved source must not run');},async resolveInitial(reference,scope){assert.deepEqual(reference,base.initial.reference);assert.deepEqual(scope,identity.scope);calls.push('source');return resolved;}};
 const target:ProjectWorkspaceRpc={async restoreWorkspace(value,claimed,bytes){calls.push('restore');assert.deepEqual(value,identity);assert.deepEqual(claimed,base);assert.deepEqual(bytes,resolved.filesArchive);return {sha256:resolved.filesSha256,bytes:bytes!.length};},async freezeWorkspace(){throw Error('unused');},async abortWorkspace(){throw Error('unused');}};
 await new ProjectWorkspaceLifecycle(source,()=>{calls.push('native');return target;}).prepare(identity,base);assert.deepEqual(calls,['source','native','restore']);
});
test('initial corruption, missing source and substituted receipts fail without native allocation',async()=>{
 const {resolved,base}=await fixture();let natives=0;
 const rejectNative=()=>{natives++;throw Error('unexpected native allocation');};
 const bad:ResolvedInitialWorkspace[]=[{...resolved,filesArchive:new Uint8Array([1])},{...resolved,filesSha256:'a'.repeat(64)},{...resolved,referenceSha256:'a'.repeat(64)},{...resolved,reference:{...resolved.reference,markerNonce:'forged'}},{...resolved,reference:{} as never}];
 for(const value of bad)await assert.rejects(new ProjectWorkspaceLifecycle({async restore(){throw Error('unused');},async resolveInitial(){return value;}},rejectNative).prepare(identity,base),TurnBaseUnavailableError);
 for(const code of ['initial-workspace-checkpoint-missing','initial-workspace-checkpoint-mismatch','model-content-missing','model-content-mismatch'])await assert.rejects(new ProjectWorkspaceLifecycle({async restore(){throw Error('unused');},async resolveInitial(){throw Error(code);}},rejectNative).prepare(identity,base),TurnBaseUnavailableError);
 await assert.rejects(new ProjectWorkspaceLifecycle({async restore(){throw Error('unused');}},rejectNative).prepare(identity,base),TurnBaseUnavailableError);
 await assert.rejects(new ProjectWorkspaceLifecycle({async restore(){throw Error('unused');},async resolveInitial(){throw Error('r2-transport-lost');}},rejectNative).prepare(identity,base),/r2-transport-lost/);assert.equal(natives,0);
});
test('cross-scope initial base is rejected before either storage or native allocation',async()=>{
 const {base}=await fixture();let reads=0,natives=0;
 const lifecycle=new ProjectWorkspaceLifecycle({async restore(){throw Error('unused');},async resolveInitial(){reads++;throw Error('unused');}},()=>{natives++;throw Error('unused');});
 await assert.rejects(lifecycle.prepare({...identity,scope:{...identity.scope,tenantId:'tenant-b'}},base),TurnBaseUnavailableError);await assert.rejects(lifecycle.frozenFiles({...identity,scope:{...identity.scope,tenantId:'tenant-b'}},base),/base-conflict/);assert.equal(reads,0);assert.equal(natives,0);
});
test('native initial restore requires verified bytes and does not replace them with empty genesis',async()=>{
 const {base,resolved}=await fixture(),files=new Map<string,string>();let starts=0,writes=0;
 const sandbox:ProjectWorkspaceSandboxApi={async writeFile(path,content){writes++;files.set(path,content);return {success:true,path};},async readFile(path){return {success:true,path,content:files.get(path)!};},async startProcess(command,options){starts++;assert.match(command,/ restore /);return {id:options.processId,async waitForExit(){return {exitCode:0};},async getLogs(){return {stdout:JSON.stringify({ok:true,operation:'restore',sha256:resolved.filesSha256,bytes:resolved.filesArchive.length}),stderr:''};}};}};
 const actorId=(await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project,port=new SandboxProjectWorkspacePort(sandbox,actorId);
 await assert.rejects(port.restoreFiles(identity,base,null),/invalid-project-workspace-archive/);await assert.rejects(port.restoreFiles(identity,base,new Uint8Array([0])),/base-mismatch/);assert.equal(writes,0);assert.equal(starts,0);
 const result=await port.restoreFiles(identity,base,resolved.filesArchive);assert.equal(result.sha256,resolved.filesSha256);assert.equal(starts,1);assert.deepEqual(Buffer.from([...files.values()][0]!,'base64'),Buffer.from(resolved.filesArchive));
});

test('native archive adapter rejects another workspace initial provenance for restore and freeze',async()=>{
 const {base,resolved}=await fixture(),other={...identity,scope:{...identity.scope,tenantId:'tenant-b'}};let calls=0;
 const sandbox:ProjectWorkspaceSandboxApi={async writeFile(){calls++;throw Error('unused');},async readFile(){calls++;throw Error('unused');},async startProcess(){calls++;throw Error('unused');}};
 const actorId=(await sandboxActorIds(other.scope,other.turnId,other.dispatchId)).project,port=new SandboxProjectWorkspacePort(sandbox,actorId);
 await assert.rejects(port.restoreFiles(other,base,resolved.filesArchive),/base-mismatch/);await assert.rejects(port.frozenFiles(other,base),/base-mismatch/);assert.equal(calls,0);
});
