import assert from 'node:assert/strict';
import test from 'node:test';
import {freezeProjectResources,type ProjectResources} from '../../services/project-resources/text.mjs';
import {managedProjectResources,managedResourceContext} from '../../services/turn-runtime/managed-resources.ts';
import {managedInput,type ManagedInput} from '../../services/turn-runtime/managed-adapter.ts';
import {managedCorrelation,managedInputEnvelope} from '../../services/turn-runtime/managed-sdk-transport.ts';
import type {ExecutionBinding} from '../../services/turn-runtime/backend-contract.ts';
import {turnDigest,type TurnBaseCheckpoints} from '../../services/turn/protocol.ts';

const scope={tenantId:'tenant-resources',projectId:'project-resources',workspaceId:'workspace-resources',workspaceGeneration:1};
const checkpoint={revisionId:'revision-resources',objectKey:'turns/resource-revision.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1000};
const base={workspace:checkpoint,session:checkpoint};
const skill=(name:string,body:string,manual=false)=>`---\nname: ${name}\ndescription: Guidance for ${name}\n${manual?'disable-model-invocation: true\n':''}---\n${body}`;
function bundle(files:Array<{path:string;content:string}>=[
 {path:'AGENTS.md',content:'PROJECT_AGENT_GUIDANCE'},
 {path:'.pi/skills/review/SKILL.md',content:skill('review','UNSELECTED_REVIEW_BODY')},
 {path:'.pi/skills/manual/SKILL.md',content:skill('manual','MANUAL_ONLY_BODY',true)},
 {path:'.pi/prompts/outline.md',content:'UNSELECTED_OUTLINE_BODY'},
]):ProjectResources{return freezeProjectResources({scope,revisionId:checkpoint.revisionId,filesSha256:checkpoint.filesSha256,files});}
function context(resources:ProjectResources,message:string){
 const text=managedResourceContext(resources,message),line=text.split('\n').find(line=>line.startsWith('{'));
 assert.ok(line,'frozen resource context contains one JSON data record');
 return {text,data:JSON.parse(line)};
}
function input(projectResources?:ProjectResources):ManagedInput{return {identity:{scope,sessionId:'session-resources',turnId:'turn-resources',dispatchId:'dispatch-resources',generation:1},actor:{userId:'user-resources',authVersion:1},message:'Review this project',base,...(projectResources?{projectResources}:{})};}

test('Managed resource context includes AGENTS and an inert catalog without loading unselected bodies',()=>{
 assert.equal(managedResourceContext(undefined,'/skill:unknown'),'');
 const {text,data}=context(bundle(),'Please review this project');
 assert.deepEqual(data.agents.map((r:{content:string})=>r.content),['PROJECT_AGENT_GUIDANCE']);
 assert.deepEqual(data.catalog.map((r:{command:string})=>r.command),['/outline','/skill:review']);
 assert.equal(data.selected,undefined);
 for(const body of ['UNSELECTED_REVIEW_BODY','MANUAL_ONLY_BODY','UNSELECTED_OUTLINE_BODY'])assert.equal(text.includes(body),false);
 assert.equal(text.includes('/skill:manual'),false);
 assert.deepEqual({scope:data.scope,revisionId:data.revisionId,filesSha256:data.filesSha256},{scope:{tenantId:scope.tenantId,projectId:scope.projectId},revisionId:checkpoint.revisionId,filesSha256:checkpoint.filesSha256});
});

test('Managed explicit skill and prompt selection expands arguments once and permits manual-only selection',()=>{
 const resources=bundle([
  {path:'.pi/skills/manual/SKILL.md',content:skill('manual','Selected: $ARGUMENTS | $@',true)},
  {path:'.pi/prompts/outline.md',content:'Outline $ARGUMENTS'},
 ]),original=JSON.stringify(resources),args='$@ /skill:other';
 const selected=context(resources,`/skill:manual ${args}`).data;
 assert.equal(selected.selected.path,'.pi/skills/manual/SKILL.md');
 assert.equal(selected.selected.content,`Selected: ${args} | ${args}`);
 assert.equal(selected.catalog.some((r:{command:string})=>r.command==='/skill:manual'),false);
 assert.equal(context(resources,'/outline diagrams').data.selected.content,'Outline diagrams');
 assert.equal(context(resources,'/outline').data.selected.content,'Outline ');
 assert.equal(context(resources,'Review /skill:manual').data.selected,undefined);
 assert.equal(context(resources,'/unrelated-command').data.selected,undefined);
 assert.equal(JSON.stringify(resources),original,'command expansion does not mutate frozen input');
 assert.throws(()=>managedResourceContext(resources,'/skill:unknown'),/managed-resource-command-unknown/);
});

test('Managed resources bind the complete frozen digest to current scope and saved source',()=>{
 const resources=bundle();
 assert.deepEqual(managedProjectResources(resources,scope,base),resources);
 const wrongScope={...scope,projectId:'other-project'};
 assert.throws(()=>managedProjectResources(resources,wrongScope,base),/project-resource-scope-denied/);
 assert.throws(()=>managedProjectResources(resources,{...scope,tenantId:'other-tenant'},base),/project-resource-scope-denied/);
 for(const changedBase of [
  {workspace:null,session:null},
  {workspace:{...checkpoint,revisionId:'stale-revision'},session:null},
  {workspace:{...checkpoint,filesSha256:'c'.repeat(64)},session:null},
 ])assert.throws(()=>managedProjectResources(resources,scope,changedBase),/managed-resource-base-mismatch/);
 const tampered=structuredClone(resources);tampered.resources[0]!.content+=' altered';
 assert.throws(()=>managedProjectResources(tampered,scope,base),/project-resource-digest-mismatch/);
 assert.throws(()=>managedProjectResources({...resources,sha256:'0'.repeat(64)},scope,base),/project-resource-digest-mismatch/);
});

test('Managed initial source accepts only null revision and the declared initial archive digest',()=>{
 const task={id:'task-resources',tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:1000,deadlineAt:2000};
 const initial:TurnBaseCheckpoints={workspace:null,session:null,initial:{reference:{schemaVersion:1,scope,task,runtime:{taskId:task.id,tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,runtimeId:'runtime-resources',leaseId:'lease-resources'},markerNonce:'nonce-resources',markerSha256:'d'.repeat(64),checkpointRevision:'e'.repeat(64)},filesSha256:'f'.repeat(64)}};
 const resources=freezeProjectResources({scope,revisionId:null,filesSha256:initial.initial!.filesSha256,files:[{path:'AGENTS.md',content:'Initial project guidance'}]});
 assert.deepEqual(managedProjectResources(resources,scope,initial),resources);
 assert.throws(()=>managedProjectResources(resources,scope,{...initial,initial:{...initial.initial!,filesSha256:'0'.repeat(64)}}),/managed-resource-base-mismatch/);
 assert.throws(()=>managedProjectResources(freezeProjectResources({scope,revisionId:'saved-revision',filesSha256:initial.initial!.filesSha256,files:[]}),scope,initial),/managed-resource-base-mismatch/);
});

test('Managed normalized input preserves validated resources and their binding while legacy input stays unchanged',async()=>{
 const raw=input(bundle()),normalized=managedInput(raw);
 for(const key of ['identity','actor','message','base','projectResources'] as const)assert.deepEqual(normalized[key],raw[key]);
 assert.equal(await turnDigest(normalized),await turnDigest(managedInput(raw)));
 assert.equal(Object.hasOwn(managedInput(input()),'projectResources'),false);
 const frozenContext=managedResourceContext(normalized.projectResources,normalized.message),frozenDigest=await turnDigest(normalized);
 raw.projectResources!.resources[0]!.content='Changed after normalization';
 assert.equal(managedResourceContext(normalized.projectResources,normalized.message),frozenContext);
 assert.equal(await turnDigest(normalized),frozenDigest);
 assert.throws(()=>managedInput(raw),/project-resource-digest-mismatch/);
 const nextCheckpoint={...checkpoint,revisionId:'next-revision',filesSha256:'c'.repeat(64)},nextResources=freezeProjectResources({scope,revisionId:nextCheckpoint.revisionId,filesSha256:nextCheckpoint.filesSha256,files:[{path:'AGENTS.md',content:'New revision guidance'}]});
 const next=managedInput({...input(nextResources),base:{workspace:nextCheckpoint,session:nextCheckpoint}});
 assert.notEqual(await turnDigest(next),frozenDigest);
 assert.throws(()=>managedInput({...input(bundle()),message:'/skill:missing'}),/managed-resource-command-unknown/);
});

test('Managed command expansion rejects byte amplification before allocating a large selected body',()=>{
 const resources=bundle([{path:'.pi/skills/review/SKILL.md',content:skill('review','$@'.repeat(2000))}]);
 assert.throws(()=>managedResourceContext(resources,`/skill:review ${'界'.repeat(12)}`),/managed-resource-expansion-limit/);
 assert.throws(()=>managedInput({...input(resources),message:`/skill:review ${'x'.repeat(40)}`}),/managed-resource-expansion-limit/);
 const small=context(resources,'/skill:review ok').data;
 assert.equal(small.selected.content,'ok'.repeat(2000));
});

test('Managed malformed-resource diagnostics stay inert rather than loading invalid text',()=>{
 const resources=freezeProjectResources({scope,revisionId:checkpoint.revisionId,filesSha256:checkpoint.filesSha256,files:[],diagnostics:[{path:'.pi/skills/broken/SKILL.md',code:'frontmatter-invalid',sha256:'c'.repeat(64)}]});
 const {data}=context(resources,'Please repair the broken skill');
 assert.deepEqual(data.diagnostics,resources.diagnostics);assert.deepEqual(data.catalog,[]);assert.equal(data.selected,undefined);
 assert.throws(()=>managedResourceContext(resources,'/skill:broken'),/managed-resource-command-unknown/);
});

test('Managed frozen rendered text survives normalization and envelope reconstruction without reformatting',async()=>{
 const raw=input(bundle()),first=managedInput(raw);
 assert.equal(first.projectResourceText,managedResourceContext(first.projectResources,first.message));
 const originalText='\nFROZEN_FORMAT_V0: 保留原始文本 $ARGUMENTS\nCurrent user request:\n';
 const saved=managedInput({...raw,projectResourceText:originalText}),restored=managedInput(structuredClone(saved));
 assert.equal(restored.projectResourceText,originalText);
 assert.equal(await turnDigest(saved),await turnDigest(restored));
 const binding:ExecutionBinding={schemaVersion:1,identity:saved.identity,backend:'managed-agents',inputSha256:await turnDigest(saved),reservedAt:1000,remoteSessionId:null,remoteTurnId:null};
 assert.equal(await managedInputEnvelope(binding,saved.message,saved.projectResources,restored.projectResourceText),`[riffology-input-v1:${await managedCorrelation(binding)}]\n${originalText}${saved.message}`);
 assert.notEqual(await turnDigest(managedInput({...raw,projectResourceText:originalText+'changed'})),binding.inputSha256);
});

test('Managed rendered text requires a valid bound resource bundle and a bounded UTF-8 string',()=>{
 for(const projectResourceText of ['', 'Private injected context'])assert.throws(()=>managedInput({...input(),projectResourceText}),/managed-resource-text-invalid/);
 for(const projectResourceText of [null,0,false,{},'x'.repeat(68*1024+1),'界'.repeat(Math.floor(68*1024/3)+1)]){
  assert.throws(()=>managedInput({...input(bundle()),projectResourceText} as unknown as ManagedInput),/managed-resource-text-invalid/);
 }
 assert.throws(()=>managedInput({...input(bundle()),base:{workspace:null,session:null},projectResourceText:'Previously frozen text'}),/managed-resource-base-mismatch/);
 const tampered=bundle();tampered.resources[0]!.content+=' changed';
 assert.throws(()=>managedInput({...input(tampered),projectResourceText:'Previously frozen text'}),/project-resource-digest-mismatch/);
});
