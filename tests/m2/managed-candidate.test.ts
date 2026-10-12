import assert from 'node:assert/strict';
import test from 'node:test';
import {managedCandidateFixture} from './fixtures/managed-candidate.ts';
import {ManagedCandidateError,managedCandidateRecoveryFiles,packageManagedCandidate} from '../../services/turn-runtime/managed-candidate.ts';
import {managedTestingInstructions} from '../../services/turn-runtime/managed-testing-instructions.ts';
import {workspaceArchiveReader} from '../../services/turn-runtime/workspace-file-index.ts';
import {initialWorkspaceArchive} from '../../services/turn-runtime/initial-workspace-archive.ts';
import {PREVIEW_SOURCE_LOCKS} from '../../services/browser-preview/profiles.ts';

for(const domain of ['road','queue','grid','airport'] as const)test('Managed reported '+domain+' trace preserves its current model-specific renderer and spaces',()=>{
 const candidate=managedCandidateFixture(domain),packaged=packageManagedCandidate(candidate),files=managedCandidateRecoveryFiles(packaged.filesArchive);
 assert.deepEqual(packaged.validation,{status:'checked',schemaVersion:2,traceValidation:'validated',execution:'not-recomputed',profileId:'python-stdlib/v1'});
 for(const [path,text]of Object.entries(candidate.files))assert.equal(files[path],text);
 assert.deepEqual(JSON.parse(files['model/model-spec.json']!),candidate.spec);
 assert.equal(files['model/run.py']!.includes('from model import run'),true);
});
test('Managed keeps restricted JS and Python drawing roles while rejecting extra files and frontend capability gaps',()=>{
 const js=managedCandidateFixture('airport','javascript-canvas'),saved=managedCandidateRecoveryFiles(packageManagedCandidate(js).filesArchive);
 assert.equal(saved['frontend/main.mjs'],js.files['frontend/main.mjs']);assert.equal(saved['frontend/manifest.json'],js.files['frontend/manifest.json']);
 assert.equal(JSON.parse(saved['model/visualization.json']!).renderer,'javascript-canvas');
 assert.ok(packageManagedCandidate(managedCandidateFixture('grid','python-canvas')).filesArchive.length);
 const cases:Array<[ (v:ReturnType<typeof managedCandidateFixture>)=>void,string,string]>=[
  [v=>{delete v.files['frontend/main.mjs'];},'candidate.json','files'],
  [v=>{v.files['frontend/main.mjs']='import x from "https://example.invalid/x.mjs";\nexport function render(context) { return x; }';},'frontend/main.mjs','$'],
  [v=>{v.files['frontend/manifest.json']=v.files['frontend/manifest.json']!.replace('frontend/main.mjs','frontend/other.mjs');},'frontend/manifest.json','$'],
  [v=>{v.files['model/other.py']='';},'candidate.json','files'],
  [v=>{v.preview.profileId='unavailable/v1';},'candidate.json','preview.profileId'],
  [v=>{v.files['app/requirements.lock']='{"schemaVersion":1,"packages":{"requests":"1"}}';},'app/requirements.lock','packages'],
  [v=>{v.files['model/model.py']='import os\ndef run(config):\n    return {}';},'model/model.py','$'],
 ];
 for(const [edit,file,path]of cases){const candidate=structuredClone(js);edit(candidate);assert.throws(()=>packageManagedCandidate(candidate),error=>error instanceof ManagedCandidateError&&error.diagnostic.file===file&&error.diagnostic.path===path);}
 const mesa=managedCandidateFixture('grid');mesa.preview.profileId='mesa-3.5.1/v1';mesa.files['app/requirements.lock']=JSON.stringify({schemaVersion:1,packages:PREVIEW_SOURCE_LOCKS['mesa-3.5.1/v1']});
 assert.equal(packageManagedCandidate(mesa).validation.status,'checked');
});
test('Managed locates actual airport lane, frame, parameter, seed and metric mismatches in reported output',()=>{
 const changes:Array<[(v:ReturnType<typeof managedCandidateFixture>)=>void,string,string]>=[
  [v=>{v.preview.trace.snapshots[1]!.space={type:'lane',lanes:['road']};},'candidate.json','preview.trace.snapshots[1].agents[0].lane'],
  [v=>{v.preview.trace.snapshots[1]!.frame=0;},'candidate.json','preview.trace.snapshots[1].frame'],
  [v=>{v.preview.trace.snapshots[1]!.agents[0]!.position=-1;},'candidate.json','preview.trace.snapshots[1].agents[0].position'],
  [v=>{v.preview.trace.snapshots[2]!.metrics={};},'candidate.json','preview.trace.snapshots[2].metrics["completed"]'],
  [v=>{v.preview.trace.snapshots[2]!.metrics.completed=Infinity;},'candidate.json','preview.trace.snapshots[2].metrics["completed"]'],
  [v=>{v.preview.input.parameters.steps=501;},'candidate.json','preview.input.parameters.steps'],
  [v=>{v.preview.input.parameters.mode='other';},'candidate.json','preview.input.parameters["mode"]'],
  [v=>{v.preview.input.seed=-1;},'candidate.json','preview.input.seed'],
  [v=>{v.preview.input.parameters.steps=3;},'candidate.json','preview.input.parameters'],
  [v=>{v.spec.parameters.steps!.maximum=501;},'candidate.json','spec.parameters.steps'],
  [v=>{delete v.spec.parameters.steps!.minimum;},'candidate.json','spec.parameters.steps'],
  [v=>{v.spec.parameters.steps!.default=501;v.spec.parameters.steps!.maximum=501;},'candidate.json','spec.parameters.steps'],
  [v=>{v.files['model/results.json']=JSON.stringify({seed:43,parameters:v.preview.input.parameters,metrics:{completed:2},frameCount:3});},'model/results.json','seed'],
  [v=>{v.files['model/results.json']=JSON.stringify({seed:42,parameters:v.preview.input.parameters,metrics:{completed:99},frameCount:3});},'model/results.json','metrics'],
 ];
 for(const [edit,file,path]of changes){const candidate=managedCandidateFixture('airport');edit(candidate);assert.throws(()=>packageManagedCandidate(candidate),error=>error instanceof ManagedCandidateError&&error.diagnostic.file===file&&error.diagnostic.path===path);}
 const grid=managedCandidateFixture('grid');grid.files['model/visualization.json']=grid.files['model/visualization.json']!.replace('"grid"','"lane"');
 assert.throws(()=>packageManagedCandidate(grid),error=>error instanceof ManagedCandidateError&&error.diagnostic.path==='preview.trace.snapshots[0].space.type');
});
test('Managed recovery errors identify deterministic size/UTF-8 failures instead of treating them as unknown storage reads',()=>{
 for(const [bytes,reason]of [[new Uint8Array(128*1024+1),'recovery-file-too-large'],[new Uint8Array([255]),'invalid-utf8']] as const){
  const archive=initialWorkspaceArchive({'frontend/main.mjs':bytes});
  assert.throws(()=>managedCandidateRecoveryFiles(archive),error=>error instanceof ManagedCandidateError&&error.diagnostic.file==='frontend/main.mjs'&&error.diagnostic.path==='$'&&error.diagnostic.reason===reason);
 }
 const archive=initialWorkspaceArchive({'model/model.py':new TextEncoder().encode('a'.repeat(1024*1024))});
 assert.throws(()=>managedCandidateRecoveryFiles(archive),error=>error instanceof ManagedCandidateError&&error.diagnostic.reason==='managed-recovery-too-large');
 const crowded=managedCandidateFixture('airport');crowded.preview.trace.snapshots[0]!.agents=Array(10001).fill({});
 assert.throws(()=>packageManagedCandidate(crowded),error=>error instanceof ManagedCandidateError&&error.diagnostic.path==='preview.trace.snapshots[0].agents');
});
test('Managed legacy v1 candidates remain readable without claiming trace checks or discarding a saved JS view',()=>{
 const js=managedCandidateFixture('airport','javascript-canvas'),saved=managedCandidateRecoveryFiles(packageManagedCandidate(js).filesArchive);
 const legacy={schemaVersion:1,spec:js.spec,files:Object.fromEntries(['model/model.py','model/results.json','app/requirements.lock'].map(path=>[path,js.files[path]]))};
 const packaged=packageManagedCandidate(legacy,saved),restored=managedCandidateRecoveryFiles(packaged.filesArchive);
 assert.deepEqual(packaged.validation,{status:'checked',schemaVersion:1,traceValidation:'not-provided',execution:'not-recomputed'});
 for(const path of ['model/visualization.json','frontend/main.mjs','frontend/manifest.json'])assert.equal(restored[path],saved[path]);
 const original=packageManagedCandidate(legacy),reader=workspaceArchiveReader(original.filesArchive);
 assert.equal(JSON.parse(new TextDecoder().decode(reader.read([{path:'model/visualization.json',maxBytes:32768}]).get('model/visualization.json')!)).renderer,'lane');
 assert.throws(()=>packageManagedCandidate({...legacy,preview:js.preview}),/managed-candidate-schema/);
});
test('Managed candidate limits and instructions keep unknown outputs explicit and do not add new file or calculation protocols',()=>{
 const candidate=managedCandidateFixture('airport');candidate.preview.trace.snapshots[0]!.agents=Array.from({length:10000},(_,i)=>({id:'flight-'+i,type:'aircraft',state:'moving',lane:'runway',position:1}));
 assert.throws(()=>packageManagedCandidate(candidate),/managed-candidate-too-large/);
 assert.match(managedTestingInstructions,/schemaVersion":2/);assert.match(managedTestingInstructions,/reported data/);assert.match(managedTestingInstructions,/complete output observed/);
 assert.equal(managedTestingInstructions.includes('lanes":["road"]'),false);
});
