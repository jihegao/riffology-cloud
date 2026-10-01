import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {BROWSER_PREVIEW_GENERATION_CONTRACT as contract,BROWSER_PREVIEW_JAVASCRIPT_EXAMPLE as javascriptExample,BROWSER_PREVIEW_PYTHON_DRAW_EXAMPLE as pythonDrawExample,BROWSER_PREVIEW_SERVER_ADAPTER as adapter,BROWSER_PREVIEW_SERVER_ADAPTER_SHA256 as adapterSha,createProductTrustedPiRelease} from '../../services/trusted-pi/release-candidate.mjs';
import {BROWSER_PREVIEW_JAVASCRIPT_SOURCE_PATHS,BROWSER_PREVIEW_SOURCE_PATHS,canonicalPreviewJson,previewSha256} from '../../services/browser-preview/contract.ts';
import {PREVIEW_LIMITS,PREVIEW_SOURCE_LOCKS,createTrustedPreviewRegistry} from '../../services/browser-preview/profiles.ts';
import {inspectGeneratedBrowserPreview} from '../../services/browser-preview/generation.mjs';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {workspaceArchiveReader} from '../../services/turn-runtime/workspace-file-index.ts';
import {validateFrontendScene} from '../../services/browser-preview/runtime/js-scene.mjs';
import {makeFixture} from '../../services/browser-preview/runtime/fixtures.mjs';
import {productionPreviewRegistry} from '../../services/browser-preview/production-registry.ts';
const encode=s=>new TextEncoder().encode(s);
const now=1800000000000,identity={scope:{tenantId:'tenant-test',projectId:'project-test',workspaceId:'workspace-test',workspaceGeneration:1},sessionId:'session-test',turnId:'turn-test',dispatchId:'dispatch-test',generation:1},actor={userId:'user-test',authVersion:1};
test('fixed generation contract shares package paths, profiles, seed and limits',()=>{
 assert.deepEqual(contract.sourcePaths,BROWSER_PREVIEW_SOURCE_PATHS);
 assert.deepEqual([...contract.sourcePaths,...contract.javascriptSourcePaths],BROWSER_PREVIEW_JAVASCRIPT_SOURCE_PATHS);
 assert.deepEqual(contract.javascriptManifest,{schema:'riffology.browser-js/v1',hostApi:'riffology.browser-host/v1',entry:'frontend/main.mjs',width:600,height:420});
 assert.deepEqual(contract.mesaPackages,PREVIEW_SOURCE_LOCKS['mesa-3.5.1/v1']);
 assert.deepEqual(contract.profiles,{stdlib:'python-stdlib/v1',mesa:'mesa-3.5.1/v1'});
 assert.equal(contract.seedMaximum,4294967295);assert.equal(contract.maxSteps,PREVIEW_LIMITS.maxSteps);assert.equal(contract.frames,PREVIEW_LIMITS.frames);assert.equal(contract.resultBytes,PREVIEW_LIMITS.resultBytes);
 assert.equal(contract.serverOutputBytes,16384);assert.equal(contract.serverOutputTotalBytes,32768);
});
test('embedded standalone adapter snapshot equals its declared digest',async()=>{
 assert.equal(await previewSha256(adapter),adapterSha);assert.equal(adapter.endsWith('\n'),true);
 assert.match(adapter,/from model import run/);assert.match(adapter,/trace = run\(config\)/);assert.match(adapter,/final = trace\['snapshots'\]\[-1\]/);assert.doesNotMatch(adapter,/requests|micropip|fetch|eval\(/);
});
test('embedded adapter equals canonical server-owned implementation in integrated candidate',async()=>{
 // Required integration check: no fallback fixture or skip when the server task is absent.
 const original=await readFile(new URL('../../services/run/model_run_adapter.py',import.meta.url));
 assert.deepEqual(encode(adapter),new Uint8Array(original));assert.equal(await previewSha256(original),adapterSha);
});
test('embedded JavaScript example is executable and matches the exact scene contract',async()=>{
 assert.doesNotMatch(javascriptExample,/\b(?:import|eval|Function|fetch|Worker|postMessage)\b/);
 const module=await import('data:text/javascript;base64,'+Buffer.from(javascriptExample).toString('base64'));
 const scene=module.render({snapshot:{metrics:{completed:42}}});
 assert.deepEqual(validateFrontendScene(scene),scene);
 assert.deepEqual(scene.marks[0],{kind:'rect',id:'completed',x:20,y:40,width:42,height:24,fill:'#2563eb'});
});
test('actual release resolveOptions injects generation policy and original adapter with legacy/evidence guards',async()=>{
 const calls=[];
 const release=createProductTrustedPiRelease({clock:()=>now,modelFetch:async()=>{throw Error('generation-test-must-not-call-model');},toolFetch:async input=>{calls.push(new URL(input).pathname);return Response.json({model:null,experiments:[]});}});
 const options=await release.resolveOptions({identity,actor,executionDeadlineAt:now+600000});
 assert.deepEqual(calls,['/v1/research']);assert.deepEqual(options.fixedSkills.map(s=>s.name),['simulation']);
 const content=options.fixedSkills[0].content;assert.ok(content.includes('project_install_preview_adapter'));assert.ok(content.includes(adapterSha));assert.equal(content.includes(adapter),false);
 for(const path of [...contract.sourcePaths,...contract.javascriptSourcePaths])assert.ok(content.includes(path));
 assert.match(content,/six|mesa.*3\.5\.1/i);assert.match(content,/Queue code must remain CPython 3\.11 compatible/);assert.match(content,/Preserve existing working SimPy and server Preview/);
 assert.match(content,/do not convert them/i);assert.match(content,/renderer:"javascript-canvas"/);assert.match(content,/exports exactly a named function render/);assert.match(content,/event is null, \{type:"pointer",x:number,y:number,button:integer\}, or \{type:"select",id:string\}/);assert.match(content,/only M1 frontend events/);assert.ok(content.includes(javascriptExample));for(const fields of ['x,y,width,height,fill','x,y,radius,fill','x1,y1,x2,y2,stroke,width','x,y,text,fill,size'])assert.ok(content.includes(fields));assert.match(content,/steps and horizon are ordinary parameters/);assert.match(content,/Do not clamp, coerce, truncate/);
 assert.match(content,/unverified visualization/);assert.match(content,/server independently recomputes/);assert.match(content,/baseline and intervention/);assert.match(content,/never fabricate a second configuration/);
 assert.ok(content.includes(pythonDrawExample));assert.match(content,/New models use model-authored drawing by default/);assert.match(content,/a new Revision/);
 assert.doesNotMatch(content,/Choose python-canvas only when|Choose javascript-canvas only|Only when the user requests a model-specific/);
 assert.doesNotMatch(content,/pip install|micropip\.install|wrangler deploy/);
});
test('Pi forest drawing example builds against the actual saved-source validator and platform adapter',async()=>{
 const [profile]=JSON.parse(await readFile(new URL('../../services/browser-preview/runtime/assets/profiles.json',import.meta.url),'utf8'));
 const fixture=await makeFixture(profile,'fire',null,adapter);
 const files=Object.fromEntries(fixture.files.map(file=>[file.path,new Uint8Array(Buffer.from(file.base64,'base64'))]));
 const archive=initialWorkspaceArchive(files),source={projectId:'project-test',revisionId:'revision-fire',filesSha256:await workspaceArchiveReader(archive).sha256()};
 const result=await inspectGeneratedBrowserPreview(source,archive,'stdlib',{registry:await productionPreviewRegistry()});
 assert.equal(result.status,'compatible');assert.equal(result.value.visualization.renderer,'python-canvas');
 assert.ok(new TextDecoder().decode(result.value.files.get('model/model.py')).includes(pythonDrawExample));
});
async function generatedFixture({wrapper=adapter,parameters={steps:{type:'integer',default:2,minimum:1,maximum:500},mode:{type:'enum',default:'base',values:['base','other']},enabled:{type:'boolean',default:true},'arrival-rate':{type:'number',default:0.5,minimum:0,maximum:1}}}={}){
 const files={
  'model/model.py':encode('import random\n\ndef run(config):\n    rng = random.Random(config["seed"])\n    return {"model":"queue", "snapshots":[]}\n'),
  'model/run.py':encode(wrapper),
  'model/model-spec.json':encode(JSON.stringify({schemaVersion:1,researchQuestion:'Queue?',scope:'Queue',entities:['customer'],mechanisms:['service'],assumptions:['bounded'],parameters,metrics:{completed:{}},limitations:['fixture'],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}})),
  'model/visualization.json':encode('{"schema":"riffology.visualization/v1","protocol":"riffology.visual/v0.1","renderer":"lane","metricKeys":["completed"]}'),
  'app/requirements.lock':encode('{"schemaVersion":1,"packages":{}}'),
 };
 const archive=initialWorkspaceArchive(files),source={projectId:'project-test',revisionId:'revision-test',filesSha256:await workspaceArchiveReader(archive).sha256()};
 const assets=[{path:'runtime/test-only.bin',sha256:await previewSha256('not-pyodide'),byteLength:11}];
 const runtime={profileId:'python-stdlib/v1',runtimeVersion:'pyodide-314.0.6/v1',adapterVersion:'riffology.model-run/v1',pythonVersion:'3.14.2',visualProtocol:'riffology.visual/v0.1',limitsSha256:await previewSha256(canonicalPreviewJson(PREVIEW_LIMITS)),assetSha256:await previewSha256(canonicalPreviewJson(assets)),dependencies:[]};
 return {source,archive,registry:await createTrustedPreviewRegistry([{runtime,assets,packages:{},trust:'test-fixture'}])};
}
test('generation check uses saved source/defaults and rejects alternate wrapper or unknown profile',async()=>{
 const f=await generatedFixture(),result=await inspectGeneratedBrowserPreview(f.source,f.archive,'stdlib',{registry:f.registry});assert.equal(result.status,'compatible');assert.equal(result.value.profile.trust,'test-fixture');
 const changed=await generatedFixture({wrapper:adapter+'\n# alternate generated implementation\n'});assert.deepEqual(await inspectGeneratedBrowserPreview(changed.source,changed.archive,'stdlib',{registry:changed.registry}),{status:'unsupported',reasonCode:'python-unsupported'});
 assert.deepEqual(await inspectGeneratedBrowserPreview(f.source,f.archive,'stdlib'),{status:'unsupported',reasonCode:'profile-unavailable'});
 await assert.rejects(inspectGeneratedBrowserPreview(f.source,f.archive,'simpy'),/kind-invalid/);
 const invalid=await generatedFixture({parameters:{steps:{type:'integer',default:501,minimum:1,maximum:501}}});assert.deepEqual(await inspectGeneratedBrowserPreview(invalid.source,invalid.archive,'stdlib',{registry:invalid.registry}),{status:'unsupported',reasonCode:'model-spec-invalid'});
});
