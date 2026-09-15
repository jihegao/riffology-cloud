import assert from 'node:assert/strict';
import test from 'node:test';
import {canonicalPreviewJson,createPreviewManifest,parsePreviewIdentityInput,parsePreviewManifest,parsePreviewRunInput,parsePreviewVerifyRequest,previewBuildView,previewPackageIdentity} from '../../services/browser-preview/contract.ts';
import {previewIdentityFixture as fixture,previewRunFixture} from '../../services/browser-preview/fixtures/identity.ts';
test('identity freezes saved revision, all source files, dependency closure and runtime assets',async()=>{
 const identity=await previewPackageIdentity(fixture);
 assert.equal(await previewPackageIdentity({...fixture,sources:[...fixture.sources].reverse()}),identity);
 const cases=[{...fixture,revisionId:'revision-other'},{...fixture,projectId:'project-other'},{...fixture,filesSha256:'c'.repeat(64)},{...fixture,sources:fixture.sources.map((f,i)=>i===0?{...f,sha256:'d'.repeat(64)}:f)},{...fixture,runtime:{...fixture.runtime,assetSha256:'e'.repeat(64)}},{...fixture,runtime:{...fixture.runtime,dependencies:[{name:'numpy',version:'2.4.6',sha256:'f'.repeat(64)}]}}];
 for(const changed of cases)assert.notEqual(await previewPackageIdentity(changed),identity);
 const manifest=await createPreviewManifest(fixture);assert.deepEqual(await parsePreviewManifest(manifest),manifest);
 await assert.rejects(parsePreviewManifest({...manifest,packageIdentity:'0'.repeat(64)}),/contract-invalid/);
});
test('schema refuses unknown fields, source traversal, private metadata and getter evaluation',()=>{
 for(const changed of [{...fixture,session:'secret'},{...fixture,schema:'riffology.browser-preview/v2'},{...fixture,sources:[...fixture.sources.slice(1),fixture.sources[1]]},{...fixture,sources:fixture.sources.map((f,i)=>i===0?{...f,path:'../session.json'}:f)}])assert.throws(()=>parsePreviewIdentityInput(changed),/contract-invalid/);
 let read=false;const getter={...fixture};Object.defineProperty(getter,'runtime',{enumerable:true,get(){read=true;return fixture.runtime;}});assert.throws(()=>parsePreviewIdentityInput(getter),/contract-invalid/);assert.equal(read,false);
 assert.equal(canonicalPreviewJson({z:2,a:{c:3,b:1}}),'{"a":{"b":1,"c":3},"z":2}');
});
test('run/Verify use unchanged uint32 seed and parameters, never browser results or object keys',()=>{
 assert.deepEqual(parsePreviewRunInput(previewRunFixture),previewRunFixture);
 for(const seed of [-1,4294967296,0.5,NaN])assert.throws(()=>parsePreviewRunInput({...previewRunFixture,seed}),/contract-invalid/);
 const verify={...previewRunFixture,revisionId:fixture.revisionId,packageIdentity:'c'.repeat(64),intent:'experiment',idempotencyKey:'verify-original'};
 assert.deepEqual(parsePreviewVerifyRequest(verify),verify);
 for(const bad of [{...verify,metrics:{cost:0}},{...verify,objectKey:'private/key'},{...verify,intent:'evidence'},{...previewRunFixture,steps:20}])assert.throws(()=>('intent' in bad?parsePreviewVerifyRequest(bad):parsePreviewRunInput(bad)),/contract-invalid/);
});
test('stale is read-only head relationship and preserves original build',()=>{
 const build={status:'ready' as const,revisionId:fixture.revisionId,profileId:fixture.runtime.profileId,buildIdentity:'a'.repeat(64),packageIdentity:'b'.repeat(64),sha256:'c'.repeat(64),byteLength:100};
 const old=previewBuildView(build,'new-revision');assert.equal(old.stale,true);assert.deepEqual(old.build,build);assert.equal(previewBuildView(build,fixture.revisionId).stale,false);old.build.revisionId='changed';assert.equal(build.revisionId,fixture.revisionId);
});
