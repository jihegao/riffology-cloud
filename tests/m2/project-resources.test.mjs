import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {freezeProjectResources,validateProjectResources,resourceText} from '../../services/project-resources/text.mjs';
import {projectResourcesFromArchive} from '../../services/project-resources/archive.ts';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const skill='---\nname: pages\ndescription: Build project pages\n---\nGenerate a local HTML page.';
function source(archive){return {kind:'saved-turn',identity:{scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1},revision:{revisionId:'rev-a',objectKey:'private/a.json',filesSha256:digest(archive),sessionSha256:'b'.repeat(64),committedAt:1000}};}
const files={'AGENTS.md':'Use project colors.','.pi/skills/pages/SKILL.md':skill,'.pi/prompts/page.md':'Create a page for $ARGUMENTS.','model/model.py':'not loaded','.pi/extensions/poison.mjs':'throw Error("must never load")','.pi/settings.json':'{"defaultTools":["bash"]}'};
const archive=()=>initialWorkspaceArchive(Object.fromEntries(Object.entries(files).map(([path,content])=>[path,Buffer.from(content)])));
test('canonical Revision freezes only text instructions with paths, source and content digests',async()=>{
 const bytes=archive(),s=source(bytes),bundle=await projectResourcesFromArchive(s,bytes);
 assert.equal(bundle.revisionId,'rev-a');assert.equal(bundle.filesSha256,s.revision.filesSha256);
 assert.deepEqual(bundle.resources.map(r=>r.path),['.pi/prompts/page.md','.pi/skills/pages/SKILL.md','AGENTS.md']);
 assert.deepEqual(validateProjectResources(JSON.parse(JSON.stringify(bundle)),scope),bundle);
 for(const r of bundle.resources)assert.equal(r.sha256,digest(r.content));
 await assert.rejects(projectResourcesFromArchive({...s,revision:{...s.revision,filesSha256:'c'.repeat(64)}},bytes),/source-mismatch/);
});
test('cross-project or changed text cannot reuse resource provenance',async()=>{
 const bundle=await projectResourcesFromArchive(source(archive()),archive());
 assert.throws(()=>validateProjectResources(bundle,{...scope,projectId:'project-b'}),/scope-denied/);
 const changed=structuredClone(bundle);changed.resources[0].content+='tampered';
 assert.throws(()=>validateProjectResources(changed,scope),/digest-mismatch/);
});
test('oversize resources and malformed/aliased/cyclic frontmatter fail explicitly',()=>{
 for(const content of ['---\nname: pages\ndescription: &a *a\n---\nbody','---\nname: pages\ninclude: AGENTS.md\n---\nbody','---\ndescription: text','---\nname: wrong\ndescription: text\n---\nbody'])assert.throws(()=>resourceText('.pi/skills/pages/SKILL.md',content),/project-resource-/);
 assert.throws(()=>freezeProjectResources({scope,revisionId:null,filesSha256:'a'.repeat(64),files:[{path:'AGENTS.md',content:'a'.repeat(8193)}]}),/invalid-text/);
 assert.throws(()=>freezeProjectResources({scope,revisionId:null,filesSha256:'a'.repeat(64),files:[{path:'../AGENTS.md',content:'secret'}]}),/invalid-text/);
});
test('save/restore uses new immutable bytes, preserving previous bundle identity',async()=>{
 const oldBytes=archive(),old=await projectResourcesFromArchive(source(oldBytes),oldBytes);
 const nextBytes=initialWorkspaceArchive({'AGENTS.md':Buffer.from('Use new colors.')}),next=await projectResourcesFromArchive(source(nextBytes),nextBytes);
 assert.notEqual(old.sha256,next.sha256);assert.notEqual(old.filesSha256,next.filesSha256);
 assert.match(old.resources.find(r=>r.path==='AGENTS.md').content,/project colors/);
 assert.deepEqual(await projectResourcesFromArchive(source(nextBytes),Uint8Array.from(nextBytes)),next);
});

test('manual-only skills require an explicit user command, not model-side resource loading',async()=>{
 const {ControlledResourceLoader}=await import('../../services/runtime/controlled-pi.mjs');
 const projectResources=freezeProjectResources({scope,revisionId:'revision-a',filesSha256:'a'.repeat(64),files:[{path:'.pi/skills/manual/SKILL.md',content:'---\nname: manual\ndescription: Manual only\ndisable-model-invocation: true\n---\nMANUAL_ONLY_TEXT'}]});
 const loader=new ControlledResourceLoader({scope,systemPrompt:'platform',projectResources});
 assert.throws(()=>loader.loadProjectResource('.pi/skills/manual/SKILL.md'),/explicit user command/);
 assert.doesNotMatch(loader.getAppendSystemPrompt().join('\n'),/Manual only/);
 assert.match(loader.expandProjectCommand('/skill:manual'),/MANUAL_ONLY_TEXT/);
 assert.equal(loader.getSkills().skills[0].disableModelInvocation,true);
});

test('safe resource diagnostics reach the trusted loader without forwarding arbitrary server text',async()=>{
 const {fetchResearchContext}=await import('../../services/trusted-pi/research-context.mjs');
 await assert.rejects(fetchResearchContext(async()=>Response.json({error:'project-resource-frontmatter-invalid'},{status:503}),{},1000),/project-resource-frontmatter-invalid/);
 await assert.rejects(fetchResearchContext(async()=>Response.json({error:'private server details'},{status:503}),{},1000),/^Error: research-context-request-failed$/);
});


test('malformed frozen text is diagnosed without blocking a repair task, then reloads after repair',async()=>{
 const brokenBytes=initialWorkspaceArchive({
  'AGENTS.md':Buffer.from(''),
  '.pi/skills/pages/SKILL.md':Buffer.from('---\ndescription: &poison *poison\n---\nBAD_TEXT_MUST_NOT_LOAD'),
  '.pi/prompts/good.md':Buffer.from('A valid prompt.'),
  '.pi/prompts/windows.md':Buffer.from('bad\r\ntext'),
  '.pi/prompts/utf8.md':Uint8Array.of(255),
 });
 const broken=await projectResourcesFromArchive(source(brokenBytes),brokenBytes);
 assert.equal(broken.resources.length,1);assert.equal(broken.diagnostics.length,4);
 assert.deepEqual(broken.diagnostics.map(d=>d.code).sort(),['empty-text','encoding-invalid','frontmatter-invalid','invalid-text']);
 assert.deepEqual(validateProjectResources(broken,scope),broken);
 const {ControlledResourceLoader}=await import('../../services/runtime/controlled-pi.mjs');
 const loader=new ControlledResourceLoader({scope,projectResources:broken,systemPrompt:'platform'});
 assert.deepEqual(loader.getAgentsFiles().agentsFiles,[]);
 assert.match(loader.getAppendSystemPrompt().join('\n'),/Repair these files/);
 assert.doesNotMatch(loader.getAppendSystemPrompt().join('\n'),/BAD_TEXT_MUST_NOT_LOAD|&poison/);
 assert.throws(()=>loader.loadProjectResource('.pi/skills/pages/SKILL.md'),/Unknown frozen/);
 const repairedBytes=initialWorkspaceArchive({'.pi/skills/pages/SKILL.md':Buffer.from(skill)});
 const repaired=await projectResourcesFromArchive(source(repairedBytes),repairedBytes);
 assert.equal(repaired.diagnostics,undefined);
 assert.match(new ControlledResourceLoader({scope,projectResources:repaired,systemPrompt:'platform'}).loadProjectResource('.pi/skills/pages/SKILL.md'),/Generate a local HTML page/);
 const tampered=structuredClone(broken);tampered.diagnostics[0].sha256='a'.repeat(64);
 assert.throws(()=>validateProjectResources(tampered,scope),/digest-mismatch/);
 const poison=structuredClone(broken);poison.diagnostics[0].code='attacker text';
 assert.throws(()=>validateProjectResources(poison,scope),/diagnostics-invalid/);
 await assert.rejects(projectResourcesFromArchive({...source(brokenBytes),revision:{...source(brokenBytes).revision,filesSha256:'c'.repeat(64)}},brokenBytes),/source-mismatch/);
});
