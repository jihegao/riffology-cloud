import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveManagedCandidate} from '../../services/turn-runtime/managed-candidate-v3.ts';
import {managedCandidateFixture} from './fixtures/managed-candidate.ts';
import {packageManagedCandidate,managedCandidateRecoveryFiles} from '../../services/turn-runtime/managed-candidate.ts';
import {initialWorkspaceArchive} from '../../services/turn-runtime/initial-workspace-archive.ts';
import {workspaceArchiveReader,workspaceFileDiff,workspaceFileIndex} from '../../services/turn-runtime/workspace-file-index.ts';
import {readModelArtifacts,parseModelArtifacts,parseDesignGraph} from '../../services/simulation/model-artifacts.ts';
import {inspectModel,digest} from '../../services/simulation/source.ts';
const artifacts={schema:'riffology.model-artifacts/v1',files:[{path:'design/architecture.sysml',role:'sysml'},{path:'design/bdd.json',role:'graph'}],views:[
 {id:'sysml',section:'model',title:'SysML',renderer:'source',source:'design/architecture.sysml'},
 {id:'bdd',section:'model',title:'Blocks',renderer:'graph',source:'design/bdd.json'},
 {id:'animation',section:'preview',title:'Animation',renderer:'scene',source:'preview.trace'},
 {id:'metrics',section:'preview',title:'Metrics',renderer:'metrics',source:'preview.trace'},
 {id:'history',section:'runs',title:'History',renderer:'history',source:'runs.records'},
]};
const graph={schema:'riffology.design-graph/v1',kind:'bdd',nodes:[{id:'Crane',label:'Crane'},{id:'Truck',label:'Truck'}],edges:[{from:'Crane',to:'Truck',label:'loads'}]};
const design=()=>({schemaVersion:3,operation:'design',artifacts:structuredClone(artifacts),files:{'design/architecture.sysml':'part def Crane;','design/bdd.json':JSON.stringify(graph)}});
function saved(raw:unknown,base?:Uint8Array){const result=resolveManagedCandidate(raw,base);assert.equal(result.operation,'save');if(result.operation!=='save')throw Error('expected-save');return result;}
test('answer explicitly avoids packaging and rejects ambiguous save fields',()=>{
 assert.equal(resolveManagedCandidate({schemaVersion:3,operation:'answer'},undefined).operation,'answer');
 for(const extra of [{files:{}},{spec:null},{preview:null},{artifacts}])assert.throws(()=>resolveManagedCandidate({schemaVersion:3,operation:'answer',...extra},undefined),/managed-candidate-invalid/);
});
test('design-only Revision is inspectable, non-runnable and bound to the full saved digest',async()=>{
 const result=saved(design(),initialWorkspaceArchive({})),filesSha256=await digest(result.filesArchive);
 const source={kind:'saved-turn' as const,identity:{scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},sessionId:'session',turnId:'turn',dispatchId:'dispatch',generation:1},revision:{revisionId:'revision',objectKey:'turns/revision.json',filesSha256,sessionSha256:'b'.repeat(64),committedAt:1}};
 const inspected=await inspectModel(source,result.filesArchive,true);
 assert.equal(inspected.canRun,false);assert.equal(inspected.spec,null);assert.equal(inspected.artifacts?.revisionId,'revision');assert.deepEqual(inspected.artifacts?.manifest,artifacts);
 assert.equal(inspected.artifacts?.contents['design/bdd.json'],JSON.stringify(graph));
 await assert.rejects(inspectModel({...source,revision:{...source.revision,filesSha256:'f'.repeat(64)}},result.filesArchive,true),/source-mismatch/);
});
test('design overlay preserves actual compute, frontend, binary and unrelated saved content',()=>{
 const model=packageManagedCandidate(managedCandidateFixture('airport','javascript-canvas'));
 const binary=new Uint8Array([0,255,3]);
 const base=initialWorkspaceArchive({...Object.fromEntries(Object.entries(managedCandidateRecoveryFiles(model.filesArchive)).map(([k,v])=>[k,new TextEncoder().encode(v)])),'data/input.bin':binary});
 const result=saved(design(),base),recovered=managedCandidateRecoveryFiles(result.filesArchive),prior=managedCandidateRecoveryFiles(model.filesArchive);
 for(const [path,content]of Object.entries(prior))assert.equal(recovered[path],content,path);
 assert.deepEqual(workspaceArchiveReader(result.filesArchive).read([{path:'data/input.bin',maxBytes:3}]).get('data/input.bin'),binary);
 assert.equal(recovered['design/architecture.sysml'],'part def Crane;');
 const navigation=saved({...design(),files:{}},result.filesArchive);assert.deepEqual(readModelArtifacts(navigation.filesArchive),readModelArtifacts(result.filesArchive));
});
test('v3 model retains design while preserving strict v2 calculation validation',()=>{
 const base=saved(design()).filesArchive,candidate=managedCandidateFixture('airport');
 const raw={...candidate,schemaVersion:3,operation:'model',artifacts};
 const result=saved(raw,base);assert.deepEqual(readModelArtifacts(result.filesArchive)?.manifest,artifacts);
 assert.equal(result.validation.status==='checked'&&result.validation.traceValidation,'validated');
 candidate.preview.trace.snapshots[1]!.space={type:'lane',lanes:['wrong']};
 assert.throws(()=>saved({...raw,preview:candidate.preview},base),/managed-candidate-invalid/);
});
test('design path, role, size, graph reference and renderer boundaries fail closed',()=>{
 for(const path of ['../model.py','design/../model.py','model/model.py','design/view.html','https://example.com/a.md','design/a.js'])assert.throws(()=>saved({...design(),artifacts:{...artifacts,files:[{path,role:'document'}]}}));
 for(const [renderer,source,section]of [['html','design/bdd.json','model'],['graph','https://example.com/graph','model'],['scene','runs.records','preview'],['metrics','design/bdd.json','runs']])assert.throws(()=>parseModelArtifacts({...artifacts,views:[{id:'bad',title:'bad',renderer,source,section}]}));
 assert.throws(()=>saved({...design(),files:{...design().files,'model/model.py':'overwrite'}}));
 assert.throws(()=>saved({...design(),files:{...design().files,'design/architecture.sysml':'x'.repeat(128*1024+1)}}));
 assert.throws(()=>parseModelArtifacts({...artifacts,views:[artifacts.views[0],artifacts.views[0]]}));
 assert.throws(()=>parseDesignGraph({...graph,edges:[{from:'missing',to:'Truck',label:''}]}));
 assert.throws(()=>saved({...design(),files:{}}));
});


test('design save preserves opaque base files larger than the display reader limit',()=>{
 const binary=new Uint8Array(3*1024*1024);binary[0]=255;binary[binary.length-1]=17;
 const base=initialWorkspaceArchive({'data/large.bin':binary}),next=saved(design(),base);
 assert.equal(workspaceFileDiff(next.filesArchive,base).changes.some(c=>c.path==='data/large.bin'),false);
});

test('graph kinds and endpoints reject JSON arrays instead of coercing them into identifiers',()=>{
 assert.throws(()=>parseDesignGraph({...graph,kind:['bdd']}),/design-graph-invalid/);
 for(const field of ['from','to']){
  const edge={...graph.edges[0]!,[field]:[graph.edges[0]![field as 'from'|'to']]};
  assert.throws(()=>parseDesignGraph({...graph,edges:[edge]}),/design-graph-invalid/);
  assert.throws(()=>saved({...design(),files:{...design().files,'design/bdd.json':JSON.stringify({...graph,edges:[edge]})}}),/managed-candidate-invalid/);
 }
});

test('manifest roles and view bindings require strings even when a JSON array spells a valid value',()=>{
 assert.throws(()=>parseModelArtifacts({...artifacts,files:[{path:'design/architecture.sysml',role:['sysml']}],views:[]}),/model-artifacts-invalid/);
 const views=[
  {...artifacts.views[0],source:['design/architecture.sysml']},
  {...artifacts.views[2],renderer:['scene']},
  {...artifacts.views[4],section:['runs']},
 ];
 for(const view of views)assert.throws(()=>parseModelArtifacts({...artifacts,views:[view]}),/model-view/);
});

test('v3 resource overlays preserve unrelated bytes and support later skill updates in design and model saves',()=>{
 const encode=(value:string)=>new TextEncoder().encode(value),binary=new Uint8Array([0,255,17]);
 const firstSkill='---\nname: review\ndescription: Review project files\n---\nFirst saved skill';
 const resources={'AGENTS.md':'Project task guidance','.pi/skills/review/SKILL.md':firstSkill,'.pi/prompts/outline.md':'Outline $ARGUMENTS'};
 const base=initialWorkspaceArchive({'data/input.bin':binary,'docs/notes.md':encode('Keep these notes')});
 const initial=saved({...design(),files:{...design().files,...resources}},base);
 const text=(archive:Uint8Array,path:string)=>new TextDecoder('utf8',{fatal:true}).decode(workspaceArchiveReader(archive).read([{path,maxBytes:128*1024}]).get(path)!);
 for(const [path,content]of Object.entries(resources))assert.equal(text(initial.filesArchive,path),content,path);
 assert.equal(text(initial.filesArchive,'docs/notes.md'),'Keep these notes');
 assert.deepEqual(workspaceArchiveReader(initial.filesArchive).read([{path:'data/input.bin',maxBytes:3}]).get('data/input.bin'),binary);
 const updatedSkill=firstSkill.replace('First saved skill','Updated saved skill'),candidate=managedCandidateFixture('airport');
 const next=saved({...candidate,schemaVersion:3,operation:'model',artifacts,files:{...candidate.files,'.pi/skills/review/SKILL.md':updatedSkill}},initial.filesArchive);
 assert.equal(text(next.filesArchive,'.pi/skills/review/SKILL.md'),updatedSkill);
 for(const path of ['AGENTS.md','.pi/prompts/outline.md','docs/notes.md','design/architecture.sysml','design/bdd.json'])assert.equal(text(next.filesArchive,path),text(initial.filesArchive,path),path);
 assert.deepEqual(workspaceArchiveReader(next.filesArchive).read([{path:'data/input.bin',maxBytes:3}]).get('data/input.bin'),binary);
});

test('v3 resource writes cannot expand into plugins, settings, arbitrary hidden paths or traversal',()=>{
 const candidate=managedCandidateFixture('airport');
 for(const path of ['.pi/extensions/evil.ts','.pi/settings.json','.agents/skills/review/SKILL.md','.pi/skills/review/helper.ts','.pi/prompts/../settings.md','../AGENTS.md','docs/../AGENTS.md','/AGENTS.md','AGENTS.md/child','.pi/prompts/outline.md/child']){
  for(const raw of [design(),{...candidate,schemaVersion:3,operation:'model',artifacts}]){
   assert.throws(()=>saved({...raw,files:{...raw.files,[path]:'Do not execute this file'}}),/managed-candidate-(invalid|schema)/,path);
  }
 }
});

test('v3 saves validate new resource text instead of freezing malformed skills for later use',()=>{
 for(const content of ['Missing frontmatter and description','---\nname: other\ndescription: Wrong name\n---\nBody','---\ndescription: Missing terminator','---\ndescription: Has CR\n---\nBody\r','---\ndescription: Has NUL\n---\nBody\0']){
  assert.throws(()=>saved({...design(),files:{...design().files,'.pi/skills/review/SKILL.md':content}}),/managed-candidate-invalid/);
 }
 assert.throws(()=>saved({...design(),files:{...design().files,'.pi/prompts/large.md':'x'.repeat(8193)}}),/managed-candidate-invalid/);
});

test('v3 resource limits apply to the final archive including unchanged inherited files',()=>{
 const encode=(value:string)=>new TextEncoder().encode(value),patch=(path:string,content:string)=>({...design(),files:{...design().files,[path]:content}});
 const sixteen=Object.fromEntries(Array.from({length:16},(_,i)=>[`.pi/prompts/p${i}.md`,encode('Saved prompt')]));
 const atCountLimit=saved(design(),initialWorkspaceArchive(sixteen));
 assert.equal(workspaceFileIndex(atCountLimit.filesArchive).files.filter(entry=>entry.type==='file'&&entry.path.startsWith('.pi/prompts/')).length,16);
 assert.throws(()=>saved(patch('.pi/prompts/extra.md','Extra prompt'),atCountLimit.filesArchive),/managed-candidate-invalid/);
 const atTotalLimit=initialWorkspaceArchive(Object.fromEntries(Array.from({length:3},(_,i)=>[`.pi/prompts/p${i}.md`,encode('x'.repeat(8192))])));
 const allowed=saved(design(),atTotalLimit);
 assert.throws(()=>saved(patch('.pi/prompts/extra.md','x'),allowed.filesArchive),/managed-candidate-invalid/);
 const inheritedTooLarge=initialWorkspaceArchive({'.pi/prompts/large.md':encode('x'.repeat(8193))});
 assert.throws(()=>saved(design(),inheritedTooLarge),/managed-candidate-invalid/);
});
