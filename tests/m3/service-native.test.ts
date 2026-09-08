import assert from 'node:assert/strict';
import test from 'node:test';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {PreviewPlanResolver} from '../../services/preview/source.ts';
import {SandboxServiceNativeBackend,type ServiceSandboxApi} from '../../services/run/native.ts';
import type {ServiceRuntimeInput} from '../../services/run/runtime-protocol.ts';
import {spec,scope,reference} from './run-fixture.ts';
async function fixture(){
 const s=spec(),encoder=new TextEncoder(),archive=initialWorkspaceArchive({'app/preview.json':encoder.encode(JSON.stringify(s.plan.declaration)),'app/main.py':encoder.encode('print(1)'),'app/requirements.lock':encoder.encode('{"schemaVersion":1,"packages":{}}'),'docs/padding':new Uint8Array(700000)});
 s.plan.revision.filesSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(archive)))].map(x=>x.toString(16).padStart(2,'0')).join('');const source={async files(){return archive;}};s.plan=await new PreviewPlanResolver(source).resolve(s.plan.identity,s.plan.revision);
 const ref=reference('run-a'),input:ServiceRuntimeInput={reference:ref,scope,spec:s,lease:{tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,operation:'service-run',runId:ref.runId,operationId:ref.dispatchId,deadlineAt:ref.deadlineAt,generation:1,leaseId:ref.leaseId}};
 const chunks:Uint8Array[]=[],controls:string[]=[],commands:string[]=[];
 const files=new Map<string,string>();
 const api:ServiceSandboxApi={async writeFile(path,value){
  assert.match(path,/^\/var\/lib\/riffology\/(?:services\/[a-f0-9]{52}\.input\.json|archives\/[a-f0-9]{52}\.[0-9]+\.chunk\.json)$/);
  files.set(path,value);if(path.includes('/services/'))controls.push(value);
 },async exec(command,options){
  assert.equal(Object.hasOwn(options,'stdin'),false);commands.push(command);
  const upload=/^python3 \/opt\/riffology\/service_upload\.py ([a-f0-9]{52}) < (\/var\/lib\/riffology\/archives\/\1\.[0-9]+\.chunk\.json)$/.exec(command);
  if(upload){const token=upload[1]!,raw=JSON.parse(files.get(upload[2]!)!),bytes=Buffer.from(raw.data,'base64');chunks.push(bytes);return {success:true,exitCode:0,stdout:JSON.stringify({schemaVersion:1,token,offset:raw.offset,bytes:bytes.length,total:raw.total,complete:raw.offset+bytes.length===raw.total})};}
  assert.match(command,/^python3 \/opt\/riffology\/service_process\.py (?:start|observe|stop) [a-f0-9]{52}$/);const token=command.split(' ').at(-1)!;
  return {success:true,exitCode:0,stdout:JSON.stringify({schemaVersion:1,token,status:'healthy',stop:null})};}};
 return {input,archive,source,api,chunks,controls,commands,backend:new SandboxServiceNativeBackend(api,source,s.runtimeImage,()=>1000)};
}
test('native adapter revalidates fixed source and uploads bounded chunks without shell interpolation',async()=>{
 const f=await fixture();assert.equal((await f.backend.start(f.input)).status,'healthy');assert.ok(f.chunks.length>=3);assert.ok(f.chunks.every(x=>x.length<=256*1024));assert.deepEqual(Buffer.concat(f.chunks),Buffer.from(f.archive));
 const control=JSON.parse(f.controls[0]!);assert.equal(control.filesSha256,f.input.spec.plan.revision.filesSha256);assert.equal(control.entrypointSha256,f.input.spec.plan.entrypointSha256);assert.equal(f.controls[0]!.includes(f.input.spec.plan.revision.objectKey),false);
});
test('wrong pinned source or image fails before uploading or executing',async()=>{
 const f=await fixture();await assert.rejects(f.backend.start({...f.input,spec:{...f.input.spec,plan:{...f.input.spec.plan,entrypointSha256:'0'.repeat(64)}}}),/source-conflict/);
 await assert.rejects(f.backend.start({...f.input,spec:{...f.input.spec,runtimeImage:'wrong/image@sha256:'+'a'.repeat(64)}}),/image-conflict/);assert.equal(f.commands.length,0);assert.equal(f.controls.length,0);
});
test('unconfirmed chunk write cannot progress to native start',async()=>{
 const f=await fixture(),api={...f.api,async exec(){return {success:true,exitCode:0,stdout:JSON.stringify({schemaVersion:1,token:'wrong',offset:0,bytes:1,total:1,complete:true})};}};
 await assert.rejects(new SandboxServiceNativeBackend(api,f.source,f.input.spec.runtimeImage,()=>1000).start(f.input),/upload-receipt/);assert.equal(f.controls.length,0);
});

test('failed private chunk write never executes upload or native start',async()=>{
 const f=await fixture(),api={...f.api,async writeFile(){throw Error('write-ack-lost');}};
 await assert.rejects(new SandboxServiceNativeBackend(api,f.source,f.input.spec.runtimeImage,()=>1000).start(f.input),/write-ack-lost/);
 assert.equal(f.commands.length,0);assert.equal(f.controls.length,0);
});
