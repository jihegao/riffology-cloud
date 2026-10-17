import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveManagedCandidate} from '../../services/turn-runtime/managed-candidate-v3.ts';
import {managedCandidateRecoveryFiles,ManagedCandidateError} from '../../services/turn-runtime/managed-candidate.ts';
import {initialWorkspaceArchive} from '../../services/turn-runtime/initial-workspace-archive.ts';
import {workspaceArchiveReader,workspaceFileIndex} from '../../services/turn-runtime/workspace-file-index.ts';
import {buildProjectViews,readProjectViewsArchive,VIEW_LIMITS} from '../../services/project-views/package.ts';
import {digest} from '../../services/simulation/source.ts';

const encode=(text:string)=>new TextEncoder().encode(text);
const manifest={schema:'project.views/v1',files:['app/home.html','app/report.html','app/main.mjs','app/value.mjs','app/style.css','app/pixel.svg','docs/data.json'],views:[{id:'home',title:'Dashboard',entrypoint:'app/home.html'},{id:'report',title:'Report',entrypoint:'app/report.html'}]};
const texts=()=>({
 'app/home.html':'<!doctype html><link rel="stylesheet" href="./style.css"><h1>Home</h1><a href="./report.html">Report</a><script type="module" src="./main.mjs"></script>',
 'app/report.html':'<h1>Saved report</h1><a href="./home.html">Home</a>',
 'app/main.mjs':'import {value} from "./value.mjs";document.querySelector("h1").textContent=value;',
 'app/value.mjs':'export const value="Saved dashboard";',
 'app/style.css':'body { color: blue; background-image: url("./pixel.svg"); }',
 'app/pixel.svg':'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
 'docs/data.json':'{"value":1}',
});
const candidate=()=>({schemaVersion:3,operation:'pages',manifest:structuredClone(manifest),files:texts()});
function saved(raw:unknown=candidate(),base=initialWorkspaceArchive({})){
 const result=resolveManagedCandidate(raw,base);assert.equal(result.operation,'save');
 if(result.operation!=='save')throw Error('expected-save');return result;
}
const read=(archive:Uint8Array,path:string)=>workspaceArchiveReader(archive).read([{path,maxBytes:2*1024*1024}]).get(path)!;
const text=(archive:Uint8Array,path:string)=>new TextDecoder('utf8',{fatal:true}).decode(read(archive,path));
function reason(raw:unknown,expected:string,base?:Uint8Array){assert.throws(()=>saved(raw,base),(error:unknown)=>error instanceof ManagedCandidateError&&error.diagnostic.reason===expected);}

test('pages Turn produces a validated two-page package without a model and reports truthful authoring provenance',async()=>{
 const result=saved(),filesSha256=await digest(result.filesArchive);
 assert.deepEqual(result.validation,{status:'checked',schemaVersion:3,operation:'pages',traceValidation:'not-provided',execution:'not-recomputed'});
 assert.deepEqual(JSON.parse(text(result.filesArchive,'app/views.json')),manifest);
 assert.equal(workspaceFileIndex(result.filesArchive).files.some(f=>f.path==='model/model.py'),false);
 const source={kind:'saved-turn' as const,identity:{scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},sessionId:'session',turnId:'turn',dispatchId:'dispatch',generation:1},revision:{revisionId:'revision',objectKey:'turns/revision.json',filesSha256,sessionSha256:'b'.repeat(64),committedAt:1}};
 const pkg=await buildProjectViews(source,result.filesArchive);assert.equal(pkg?.manifest.views.length,2);
 const module=pkg!.assets.find(a=>a.path==='app/main.mjs')!;assert.match(atob(module.base64),/https:\/\/project.invalid\/app\/value.mjs/);
 await assert.rejects(buildProjectViews({...source,revision:{...source.revision,filesSha256:'f'.repeat(64)}},result.filesArchive),/source-mismatch/);
});

test('cold recovery includes original page text, manifest and data while later edits preserve media and unrelated base bytes',()=>{
 const binary=new Uint8Array([137,80,78,71,0,255]),skill='---\nname: pages\ndescription: Build pages\n---\nSaved skill';
 const base=initialWorkspaceArchive({'app/existing.png':binary,'model/model.py':encode('KEEP_MODEL'),'design/notes.md':encode('KEEP_DESIGN'),'.pi/skills/pages/SKILL.md':encode(skill),'data/opaque.bin':binary});
 const raw=candidate();raw.manifest.files.push('app/existing.png');const first=saved(raw,base),recovered=managedCandidateRecoveryFiles(first.filesArchive);
 assert.equal(recovered['app/views.json'],JSON.stringify(raw.manifest));
 for(const [path,content]of Object.entries(texts()))assert.equal(recovered[path],content,path);
 assert.match(recovered['app/main.mjs']!,/from "\.\/value.mjs"/);assert.doesNotMatch(recovered['app/main.mjs']!,/https:\/\/project.invalid/);
 assert.equal(Object.hasOwn(recovered,'app/existing.png'),false);assert.equal(Object.hasOwn(recovered,'.pi/skills/pages/SKILL.md'),false);
 const second=saved({...raw,files:{'app/report.html':'<h1>Updated report</h1>'}},first.filesArchive);
 assert.equal(text(second.filesArchive,'app/report.html'),'<h1>Updated report</h1>');
 for(const [path,content]of Object.entries(texts()))if(path!=='app/report.html')assert.equal(text(second.filesArchive,path),content,path);
 for(const path of ['app/existing.png','data/opaque.bin'])assert.deepEqual(read(second.filesArchive,path),binary);
 assert.equal(text(second.filesArchive,'model/model.py'),'KEEP_MODEL');assert.equal(text(second.filesArchive,'design/notes.md'),'KEEP_DESIGN');assert.equal(text(second.filesArchive,'.pi/skills/pages/SKILL.md'),skill);
 assert.equal(managedCandidateRecoveryFiles(second.filesArchive)['app/report.html'],'<h1>Updated report</h1>');
 const renamed={...raw,manifest:{...raw.manifest,files:raw.manifest.files.filter(p=>p!=='docs/data.json')},files:{}};
 assert.equal(text(saved(renamed,second.filesArchive).filesArchive,'docs/data.json'),texts()['docs/data.json']);
});

test('page patches accept only declared text assets and cannot bypass frozen model, design or instruction roles',()=>{
 for(const path of ['app/extra.html','../escape.html','app/../escape.html','/app/home.html','https://example.com/a.html'])reason({...candidate(),files:{[path]:'changed'}},'pages-file-role-invalid');
 for(const path of ['model/results.json','frontend/main.mjs','design/notes.md','AGENTS.md']){
  const raw=candidate();raw.manifest.files.push(path);reason({...raw,files:{[path]:'changed'}},'pages-file-role-invalid');
 }
 const raw=candidate();raw.manifest.files.push('app/new.png');reason({...raw,files:{'app/new.png':'not binary'}},'pages-file-role-invalid');
 reason({...candidate(),files:{'app/home.html':{encoding:'base64',content:'QQ=='}}},'utf8-text-required');
 reason({...candidate(),files:{'app/home.html':'\ud800'}},'utf8-text-required');
 reason({...candidate(),preview:{}},'pages-fields-invalid');
 reason({...candidate(),manifest:{...manifest,files:[...manifest.files,'app/views.json']}},'pages-manifest-self-reference');
 assert.throws(()=>saved({schemaVersion:3,operation:'design',artifacts:{schema:'riffology.model-artifacts/v1',files:[],views:[]},files:{'app/home.html':'smuggled'}}),/managed-candidate-invalid/);
});

test('page commit uses the delivery parser to reject missing assets and invalid or undeclared module imports',()=>{
 reason({...candidate(),files:{}},'project-view-asset-missing');
 for(const source of ['import "./missing.mjs";','import "https://example.test/lib.mjs";','import "library";','const name="./value.mjs";import(name);'])assert.throws(()=>saved({...candidate(),files:{...texts(),'app/main.mjs':source}}),/managed-candidate-invalid/);
 for(const path of ['../escape.html','app/node_modules/main.mjs','app/vendor/main.mjs'])reason({...candidate(),manifest:{...manifest,files:[path]}},'project-view-manifest-invalid');
 reason({...candidate(),manifest:{...manifest,views:[{id:'missing',title:'Missing',entrypoint:'app/missing.html'}]}},'project-view-manifest-invalid');
 const corrupted=initialWorkspaceArchive({'app/views.json':encode('{"schema":"changed"}')});
 assert.throws(()=>managedCandidateRecoveryFiles(corrupted),/managed-candidate-invalid/);
});

test('candidate, asset, package and cold-text limits remain bounded including inherited assets',()=>{
 reason({...candidate(),files:{...texts(),'app/home.html':'x'.repeat(VIEW_LIMITS.fileBytes+1)}},'project-view-size-limit');
 reason({...candidate(),files:{...texts(),'app/home.html':'x'.repeat(300000),'app/report.html':'x'.repeat(300000)}},'candidate-too-large');
 const largeFiles:Record<string,Uint8Array>={};for(let i=0;i<9;i++)largeFiles[`app/large-${i}.txt`]=encode('x'.repeat(VIEW_LIMITS.fileBytes));
 const tooLarge=candidate();tooLarge.manifest.files.push(...Object.keys(largeFiles));reason(tooLarge,'project-view-size-limit',initialWorkspaceArchive(largeFiles));
 const coldFiles:Record<string,Uint8Array>={};for(let i=0;i<5;i++)coldFiles[`app/cold-${i}.txt`]=encode('x'.repeat(220000));
 const tooMuchText=candidate();tooMuchText.manifest.files.push(...Object.keys(coldFiles));reason(tooMuchText,'managed-recovery-too-large',initialWorkspaceArchive(coldFiles));
 const valid=saved();assert.deepEqual(readProjectViewsArchive(valid.filesArchive)?.manifest,manifest);
});
