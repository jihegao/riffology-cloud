import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {runRiffoidOperation} from '../scripts/riffoid-cli.mjs';
import {IR_PLUGIN_VERSION,irFixedSkill,irToolDefinitions} from '../adapters/riffoid/platform.mjs';
const fixture=async t=>{const workspace=await mkdtemp(join(tmpdir(),'riffoid-cli-'));t.after(()=>rm(workspace,{recursive:true,force:true}));return workspace;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('Riffoid CLI preserves original draft text, mode and unrelated project views',async t=>{
 const workspace=await fixture(t);await mkdir(join(workspace,'app'));
 await writeFile(join(workspace,'app/views.json'),JSON.stringify({schema:'project.views/v1',files:['app/other.html'],views:[{id:'other',title:'Other',entrypoint:'app/other.html'}]}));
 const probe=async()=>({version:'0.1.0',module:'fixed-sdk'});
 const mode=await runRiffoidOperation({workspace,operation:'mode',input:{mode:'ir'},compiler:probe});
 assert.equal(mode.defaultMode,'ir');assert.equal(mode.existingModelConverted,false);assert.equal(mode.registration.state.modelMode,'ir');
 await runRiffoidOperation({workspace,operation:'install',input:{},compiler:probe});
 const views=JSON.parse(await readFile(join(workspace,'app/views.json'),'utf8'));
 assert.deepEqual(views.views.map(view=>view.id),['other','riffoid-ir']);assert.ok(views.files.includes('app/other.html'));
 const page=await readFile(join(workspace,'app/ir/app.html'),'utf8');assert.doesNotMatch(page,/127\.0\.0\.1:8514/);assert.doesNotMatch(page,/\/assets\//);
 await mkdir(join(workspace,'model'));const raw='{\n  "payload": BROKEN\n}';await writeFile(join(workspace,'model/business-ir.draft.json'),raw);
 const shown=await runRiffoidOperation({workspace,operation:'show',input:{},compiler:probe});
 assert.equal(shown.registration.state.draft,raw);assert.equal(shown.currentModel,null);assert.equal(shown.registration.workerSource,null);
 await assert.rejects(runRiffoidOperation({workspace,operation:'project_ir_run',input:{},compiler:probe}),/invalid-riffoid-ir-operation/);
 await assert.rejects(runRiffoidOperation({workspace,operation:'mode',input:{mode:'ir',root:'/outside'},compiler:probe}),/invalid-riffoid-ir-input/);
});
test('real SDK check/compile exports only hash-bound input, bundle, Plan and runtime for durable registration',async t=>{
 const workspace=await fixture(t);await mkdir(join(workspace,'model'));
 const raw=await readFile(new URL('../acceptance/b1/business-ir.json',import.meta.url),'utf8');await writeFile(join(workspace,'model/business-ir.draft.json'),raw);
 const checked=await runRiffoidOperation({workspace,operation:'project_ir_check',input:{draftRef:'model/business-ir.draft.json'}});
 assert.equal(checked.status,'passed',JSON.stringify(checked));assert.equal(checked.registration.files.length,1);assert.equal(checked.registration.state.draft,raw);
 const compiled=await runRiffoidOperation({workspace,operation:'project_ir_compile',input:{sealedRef:checked.sealedRef}});
 assert.equal(compiled.status,'succeeded',JSON.stringify(compiled));assert.equal(compiled.registration.files.length,4);
 const files=new Map(compiled.registration.files.map(file=>[file.path,Buffer.from(file.base64,'base64')]));
 for(const file of compiled.registration.files){assert.equal(sha(files.get(file.path)),file.sha256);assert.ok(file.path.includes('/'+file.sha256+'/'));assert.deepEqual(await readFile(join(workspace,file.path)),files.get(file.path));}
 const artifact=JSON.parse(files.get(compiled.browserArtifactRef));
 assert.equal(artifact.modelRef,checked.sealedRef);assert.ok(files.has(artifact.bundleRef));assert.ok(files.has(artifact.runtimeRef));
 assert.equal(artifact.toolchain.plugin,IR_PLUGIN_VERSION);assert.equal(artifact.toolchain.compiler,'0.1.0');assert.equal(artifact.toolchain.runtimeSha256,sha(files.get(artifact.runtimeRef)));
 assert.equal(compiled.registration.workerSource,await readFile(new URL('../browser/worker.js',import.meta.url),'utf8'));
 assert.ok(Buffer.byteLength(JSON.stringify(compiled))<1_000_000);
});
test('malformed draft returns SDK line/column diagnostics and never registers a compiled artifact',async t=>{
 const workspace=await fixture(t);await mkdir(join(workspace,'model'));const raw='{\n  "payload": \n}';await writeFile(join(workspace,'model/business-ir.draft.json'),raw);
 const result=await runRiffoidOperation({workspace,operation:'project_ir_check',input:{draftRef:'model/business-ir.draft.json'}});
 assert.equal(result.status,'failed');assert.equal(result.diagnostics[0].code,'invalid_json');assert.equal(result.diagnostics[0].line,3);assert.ok(result.diagnostics[0].column>0);
 assert.equal(result.registration.state.draft,raw);assert.deepEqual(result.registration.files,[]);
});
test('Riffoid platform definitions and skill use the installed shared package identity',async()=>{
 const skill=await irFixedSkill();assert.equal(skill.name,'riffoid-ir');assert.ok(skill.content.includes('plugin '+IR_PLUGIN_VERSION));assert.match(skill.content,/local\/unverified/);
 assert.deepEqual(irToolDefinitions.map(tool=>tool.name),['project_ir_check','project_ir_compile','project_ir_run','project_ir_result','project_ir_mode','project_ir_show','project_ir_install']);
});
