import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT_WORKSPACE_ARCHIVE_PROGRAM, PROJECT_WORKSPACE_ARCHIVE_ROOT, SandboxProjectWorkspacePort, projectWorkspaceArchiveLimits, type ProjectWorkspaceSandboxApi } from '../../services/project-tools/workspace.ts';
import { sandboxActorIds } from '../../services/sandbox/policy.ts';
import type { TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';

const identity:TurnRuntimeIdentity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2};
async function digest(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes)))].map(value=>value.toString(16).padStart(2,'0')).join('');}
function encoded(bytes:Uint8Array){return Buffer.from(bytes).toString('base64');}
class Sandbox implements ProjectWorkspaceSandboxApi{
  files=new Map<string,string>();starts:Array<{command:string;options:unknown}>=[];frozen=new TextEncoder().encode('canonical archive');exitCode=0;badReport=false;
  async writeFile(path:string,content:string){this.files.set(path,content);return {success:true,path,bytesWritten:Buffer.from(content,'base64').byteLength};}
  async readFile(path:string){const content=this.files.get(path);if(content===undefined)throw Error('missing');return {success:true,path,content};}
  async startProcess(command:string,options:any){
    this.starts.push({command,options});const [operation,token]=command.split(' ').slice(-2),path=`${PROJECT_WORKSPACE_ARCHIVE_ROOT}/${token}.${operation==='freeze'?'output':'input'}.tar`;
    if(operation==='freeze')this.files.set(path,encoded(this.frozen));const bytes=Buffer.from(this.files.get(path)!,'base64'),sha256=await digest(bytes),report=this.badReport?{ok:true,operation,bytes:bytes.byteLength,sha256:'0'.repeat(64)}:{ok:true,operation,bytes:bytes.byteLength,sha256};
    return {id:options.processId,async waitForExit(){return {exitCode:this.exitCode??0};},async getLogs(){return {stdout:JSON.stringify(report),stderr:''};},exitCode:this.exitCode};
  }
}

test('project workspace adapter derives one actor and runs fixed restore then freeze commands',async()=>{
  const sandbox=new Sandbox(),actor=(await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project,port=new SandboxProjectWorkspacePort(sandbox,actor),archive=new TextEncoder().encode('prior canonical archive'),checkpoint={revisionId:'revision-a',objectKey:'turns/a.json',filesSha256:await digest(archive),sessionSha256:'b'.repeat(64),committedAt:1},base={workspace:checkpoint,session:null};
  const restored=await port.restoreFiles(identity,base,archive);assert.equal(restored.sha256,checkpoint.filesSha256);assert.equal(sandbox.starts.length,1);assert.match(sandbox.starts[0]!.command,new RegExp(`^/usr/bin/python3 ${PROJECT_WORKSPACE_ARCHIVE_PROGRAM} restore [a-f0-9]{52}$`));assert.deepEqual(sandbox.starts[0]!.options,{processId:(sandbox.starts[0]!.options as any).processId,autoCleanup:false,timeout:120_000,cwd:'/',encoding:'utf8',env:{LANG:'C.UTF-8',PATH:'/usr/bin:/bin',RIFFOLOGY_WORKSPACE_ROOT:'/workspace',RIFFOLOGY_ARCHIVE_ROOT:PROJECT_WORKSPACE_ARCHIVE_ROOT}});assert.match((sandbox.starts[0]!.options as any).processId,/^ws-r-[a-f0-9]{40}-[a-f0-9]{8}$/);
  const frozen=await port.frozenFiles(identity,base);assert.deepEqual(frozen,sandbox.frozen);assert.equal(sandbox.starts.length,2);assert.match(sandbox.starts[1]!.command,/ freeze [a-f0-9]{52}$/);assert.match((sandbox.starts[1]!.options as any).processId,/^ws-f-[a-f0-9]{40}-[a-f0-9]{8}$/);assert.notEqual((sandbox.starts[1]!.options as any).processId,(sandbox.starts[0]!.options as any).processId);
});

test('genesis restore installs the canonical empty archive without caller bytes',async()=>{
  const sandbox=new Sandbox(),actor=(await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project,port=new SandboxProjectWorkspacePort(sandbox,actor),result=await port.restoreFiles(identity,{workspace:null,session:null},null);
  assert.equal(result.bytes,projectWorkspaceArchiveLimits.emptyArchiveBytes);const input=[...sandbox.files.entries()].find(([path])=>path.endsWith('.input.tar'))!;assert.equal(Buffer.from(input[1],'base64').byteLength,projectWorkspaceArchiveLimits.emptyArchiveBytes);
});

test('wrong actor, base bytes, process result and caller-shaped genesis fail before trust advances',async()=>{
  const bytes=new Uint8Array([1,2,3]),checkpoint={revisionId:'revision-a',objectKey:'turns/a.json',filesSha256:await digest(bytes),sessionSha256:'b'.repeat(64),committedAt:1},base={workspace:checkpoint,session:null};
  const wrongSandbox=new Sandbox(),wrong=new SandboxProjectWorkspacePort(wrongSandbox,'m2-p-wrong');await assert.rejects(wrong.restoreFiles(identity,base,bytes),/actor-scope-denied/);assert.equal(wrongSandbox.starts.length,0);
  const sandbox=new Sandbox(),actor=(await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project,port=new SandboxProjectWorkspacePort(sandbox,actor);
  await assert.rejects(port.restoreFiles(identity,base,new Uint8Array([9])),/base-mismatch/);assert.equal(sandbox.starts.length,0);
  await assert.rejects(port.restoreFiles(identity,{workspace:null,session:null},bytes),/base-mismatch/);assert.equal(sandbox.starts.length,0);
  sandbox.badReport=true;await assert.rejects(port.restoreFiles(identity,base,bytes),/result-mismatch/);assert.equal(sandbox.starts.length,1);
});
