import assert from 'node:assert/strict';
import test from 'node:test';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {workspaceArchiveReader} from '../../services/turn-runtime/workspace-file-index.ts';
import {PreviewPlanResolver,previewSource,resolvedPreviewPlan} from '../../services/preview/source.ts';
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
 return {bucket,archive,receipt,resolver:new PreviewPlanResolver({files(source){if(source.kind!=='saved-turn')throw Error('wrong-source');return new R2TurnRevisionReader(bucket as never).files(source.identity,source.revision);}})};
}
test('saved revision produces a service plan pinned to declaration, entrypoint and lock hashes',async()=>{
 const f=await fixture(),plan=await f.resolver.resolve({kind:'saved-turn',identity,revision:f.receipt});
 assert.equal(plan.kind,'service');assert.deepEqual((plan.source.kind==='saved-turn'?plan.source.revision:null),f.receipt);assert.deepEqual(plan.declaration,declaration);
 for(const key of ['declarationSha256','entrypointSha256','dependencyLockSha256'] as const)assert.match(plan[key],/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(plan).includes('private-session'),false);assert.deepEqual(await f.resolver.resolve({kind:'saved-turn',identity,revision:f.receipt}),plan);
 const changed=await fixture({'app/preview.py':encode('print("changed")\n')});
 assert.notEqual((await changed.resolver.resolve({kind:'saved-turn',identity,revision:changed.receipt})).entrypointSha256,plan.entrypointSha256);
});
test('scope and corrupted saved archive are rejected before producing a plan',async()=>{
 const f=await fixture();await assert.rejects(f.resolver.resolve({kind:'saved-turn',identity:{...identity,scope:{...identity.scope,tenantId:'tenant-b'}},revision:f.receipt}),/scope-denied/);
 for(const key of f.bucket.objects.keys())if(key.includes('/files/'))f.bucket.objects.set(key,encode('corrupt'));
 await assert.rejects(f.resolver.resolve({kind:'saved-turn',identity,revision:f.receipt}),/object-conflict/);
 const other=await fixture();await assert.rejects(new PreviewPlanResolver({async files(){return other.archive;}}).resolve({kind:'saved-turn',identity,revision:{...other.receipt,filesSha256:'a'.repeat(64)}}),/revision-mismatch/);
});
test('missing or oversized declaration inputs cannot become executable plans',async()=>{
 const missingArchive=initialWorkspaceArchive({'README.md':encode('no service declaration')});
 await assert.rejects(new PreviewPlanResolver({async files(){return missingArchive;}}).resolve({kind:'saved-turn',identity,revision:{revisionId:'a'.repeat(64),objectKey:'missing',filesSha256:await workspaceArchiveReader(missingArchive).sha256(),sessionSha256:'b'.repeat(64),committedAt:1}}),/preview-declaration-missing/);
 const cases:Array<[Record<string,Uint8Array>,RegExp]>=[
  [{'app/preview.json':encode('{}')},/invalid-preview-declaration/],
  [{'app/preview.json':new Uint8Array([255])},/preview-declaration-invalid/],
  [{'app/preview.json':encode(JSON.stringify({...declaration,entrypoint:'app/missing.py'}))},/preview-declaration-target-missing/],
  [{'app/requirements.lock':new Uint8Array(64*1024+1)},/preview-declaration-target-invalid/],
 ];
 for(const [overrides,reason] of cases){const f=await fixture(overrides);await assert.rejects(f.resolver.resolve({kind:'saved-turn',identity,revision:f.receipt}),reason);}
});
test('archive reader snapshots once and bounds extraction without leaking its mutable bytes',async()=>{
 const raw=initialWorkspaceArchive(files()),reader=workspaceArchiveReader(raw),hash=await reader.sha256();raw.fill(0);
 const content=reader.read([{path:'app/preview.py',maxBytes:1024}]).get('app/preview.py')!;content.fill(0);
 assert.equal(await reader.sha256(),hash);assert.notEqual(reader.read([{path:'app/preview.py',maxBytes:1024}]).get('app/preview.py')![0],0);
 assert.throws(()=>reader.read([{path:'app',maxBytes:1024}]),/not-file/);
 assert.throws(()=>reader.read([{path:'app/preview.py',maxBytes:1}]),/limit/);
 assert.throws(()=>reader.read([{path:'app/preview.py',maxBytes:3*1024*1024}]),/limit/);
});

test('source contract refuses mixed provenance, accessors and mutable provider inputs',async()=>{
 const f=await fixture(),source={kind:'saved-turn' as const,identity,revision:f.receipt};
 assert.throws(()=>previewSource({...source,reference:{}}),/invalid-preview-source/);
 let read=false;const tampered={...source};Object.defineProperty(tampered,'identity',{enumerable:true,get(){read=true;return identity;}});
 assert.throws(()=>previewSource(tampered),/invalid-preview-source/);assert.equal(read,false);
 const plan=await new PreviewPlanResolver({async files(input){if(input.kind==='saved-turn')input.identity.scope.tenantId='mutated';return f.archive;}}).resolve(source);
 assert.equal(plan.source.kind,'saved-turn');if(plan.source.kind==='saved-turn')assert.equal(plan.source.identity.scope.tenantId,'tenant-a');
 assert.deepEqual(resolvedPreviewPlan(plan),plan);assert.throws(()=>resolvedPreviewPlan({...plan,identity}),/invalid-preview-source/);
});
