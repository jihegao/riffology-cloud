import assert from 'node:assert/strict';
import test from 'node:test';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {workspaceArchiveReader} from '../../services/turn-runtime/workspace-file-index.ts';
import {PreviewPlanResolver} from '../../services/preview/source.ts';
import {R2TurnRevisionPort,R2TurnRevisionReader} from '../../services/turn-runtime/revision.ts';
const encode=(value:string)=>new TextEncoder().encode(value);
const identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1};
const declaration={schemaVersion:1,runtime:'python',entrypoint:'app/preview.py',dependencyLock:'app/requirements.lock',port:8080,healthPath:'/healthz',observation:{pagePath:'/observe',statePath:'/api/state'}};
function files(){return {'app/preview.json':encode(JSON.stringify(declaration)),'app/preview.py':encode('print("fixture")\n'),'app/requirements.lock':encode('# bundled standard library only\n')};}
class Bucket{
 objects=new Map<string,Uint8Array>();
 async put(key:string,bytes:Uint8Array){if(!this.objects.has(key))this.objects.set(key,Uint8Array.from(bytes));return null;}
 async get(key:string){const bytes=this.objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}
}
async function fixture(overrides:Record<string,Uint8Array>={}){
 const bucket=new Bucket(),archive=initialWorkspaceArchive({...files(),...overrides});
 const receipt=await new R2TurnRevisionPort(bucket as never,{async freeze(){return {identity,filesArchive:archive,piSession:encode('private-session')};}},()=>1000).commit({identity,base:{workspace:null,session:null},outcome:'completed',executionErrorCode:null});
 return {bucket,archive,receipt,resolver:new PreviewPlanResolver(new R2TurnRevisionReader(bucket as never))};
}
test('saved revision produces a service plan pinned to declaration, entrypoint and lock hashes',async()=>{
 const f=await fixture(),plan=await f.resolver.resolve(identity,f.receipt);
 assert.equal(plan.kind,'service');assert.deepEqual(plan.revision,f.receipt);assert.deepEqual(plan.declaration,declaration);
 for(const key of ['declarationSha256','entrypointSha256','dependencyLockSha256'] as const)assert.match(plan[key],/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(plan).includes('private-session'),false);assert.deepEqual(await f.resolver.resolve(identity,f.receipt),plan);
 const changed=await fixture({'app/preview.py':encode('print("changed")\n')});
 assert.notEqual((await changed.resolver.resolve(identity,changed.receipt)).entrypointSha256,plan.entrypointSha256);
});
test('scope and corrupted saved archive are rejected before producing a plan',async()=>{
 const f=await fixture();await assert.rejects(f.resolver.resolve({...identity,scope:{...identity.scope,tenantId:'tenant-b'}},f.receipt),/scope-denied/);
 for(const key of f.bucket.objects.keys())if(key.startsWith('turn-blobs/files/'))f.bucket.objects.set(key,encode('corrupt'));
 await assert.rejects(f.resolver.resolve(identity,f.receipt),/object-conflict/);
 const other=await fixture();await assert.rejects(new PreviewPlanResolver({async files(){return other.archive;}}).resolve(identity,{...other.receipt,filesSha256:'a'.repeat(64)}),/revision-mismatch/);
});
test('missing or oversized declaration inputs cannot become executable plans',async()=>{
 const cases:Record<string,Uint8Array>[]=[
  {'app/preview.json':encode('{}')},
  {'app/preview.json':new Uint8Array([255])},
  {'app/preview.json':encode(JSON.stringify({...declaration,entrypoint:'app/missing.py'}))},
  {'app/requirements.lock':new Uint8Array(64*1024+1)},
 ];
 for(const overrides of cases){const f=await fixture(overrides);await assert.rejects(f.resolver.resolve(identity,f.receipt));}
});
test('archive reader snapshots once and bounds extraction without leaking its mutable bytes',async()=>{
 const raw=initialWorkspaceArchive(files()),reader=workspaceArchiveReader(raw),hash=await reader.sha256();raw.fill(0);
 const content=reader.read([{path:'app/preview.py',maxBytes:1024}]).get('app/preview.py')!;content.fill(0);
 assert.equal(await reader.sha256(),hash);assert.notEqual(reader.read([{path:'app/preview.py',maxBytes:1024}]).get('app/preview.py')![0],0);
 assert.throws(()=>reader.read([{path:'app',maxBytes:1024}]),/not-file/);
 assert.throws(()=>reader.read([{path:'app/preview.py',maxBytes:1}]),/limit/);
 assert.throws(()=>reader.read([{path:'app/preview.py',maxBytes:3*1024*1024}]),/limit/);
});
