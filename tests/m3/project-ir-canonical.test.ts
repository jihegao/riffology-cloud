import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readCanonicalIrDisplay} from '../../services/project-ir/canonical.ts';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {overlayWorkspaceArchive} from '../../services/turn-runtime/workspace-file-index.ts';
import {summarize} from '../../vendor/riffoid-ir-plugin/src/model-summary.mjs';
const encoder=new TextEncoder(),DRAFT='model/business-ir.draft.json',SETTINGS='.riffoid-ir/settings.json';
const archive=(files:Record<string,string|Uint8Array>)=>initialWorkspaceArchive(Object.fromEntries(Object.entries(files).map(([path,content])=>[path,typeof content==='string'?encoder.encode(content):content])));
const b1=()=>readFile(new URL('../../vendor/riffoid-ir-plugin/acceptance/b1/business-ir.json',import.meta.url),'utf8');

test('saved B1 facts use the pinned package summary and persisted mode',async()=>{
 const draft=await b1(),business=JSON.parse(draft);
 const result=await readCanonicalIrDisplay(archive({[DRAFT]:draft,[SETTINGS]:'{"mode":"ir"}'}));
 assert.equal(result.draft,draft);assert.equal(result.defaultMode,'ir');
 assert.deepEqual(result.currentModel,{type:'ir',ref:DRAFT,fingerprint:business.fingerprint,summary:summarize(business)});
});
test('an ordinary saved file edit replaces displayed facts without a prior IR registration',async()=>{
 const draft=await b1(),original=archive({[DRAFT]:draft}),business=JSON.parse(draft);
 business.payload.sections.mission_profile.collections.composite_tasks[0].definition.taskItems[1].firstWaveTime='00:45';
 const edited=JSON.stringify(business,null,2),saved=overlayWorkspaceArchive(original,{[DRAFT]:encoder.encode(edited)});
 const before=await readCanonicalIrDisplay(original),after=await readCanonicalIrDisplay(saved);
 assert.equal(after.draft,edited);assert.equal(after.defaultMode,'code');
 const tasks=(display:typeof after)=>(display.currentModel!.summary as {tasks:{firstWaveTime:string}[]}).tasks;
 assert.equal(tasks(before)[1]!.firstWaveTime,'00:40');assert.equal(tasks(after)[1]!.firstWaveTime,'00:45');
});
test('bad or unsupported draft JSON remains editable and never claims an IR current model',async()=>{
 for(const draft of ['{\n  "payload": BROKEN\n}','','null','[]','{"version":"other/v1"}','{"version":"aircraft-business-ir/v1"}','{"version":"aircraft-business-ir/v1","payload":{"sections":{"aircraft":{}}}}','\uFEFF{"version":"aircraft-business-ir/v1"}']){
  const result=await readCanonicalIrDisplay(archive({[DRAFT]:draft}));
  assert.equal(result.draft,draft);assert.deepEqual(result.currentModel,{type:'unknown',ref:DRAFT});
 }
});
test('missing draft is null and only an explicit persisted ir setting changes the default',async()=>{
 assert.deepEqual(await readCanonicalIrDisplay(archive({})),{draft:'',currentModel:null,defaultMode:'code'});
 for(const settings of ['{}','null','{','{"mode":"unknown"}','{"mode":"code"}']){
  assert.equal((await readCanonicalIrDisplay(archive({[SETTINGS]:settings}))).defaultMode,'code');
 }
 assert.deepEqual(await readCanonicalIrDisplay(archive({[SETTINGS]:'{"mode":"ir"}'})),{draft:'',currentModel:null,defaultMode:'ir'});
});
test('canonical display enforces exact per-file byte bounds without truncating',async()=>{
 const draft='{}'.padEnd(1024*1024,' '),settings='{"mode":"ir"}'.padEnd(4*1024,' ');
 const result=await readCanonicalIrDisplay(archive({[DRAFT]:draft,[SETTINGS]:settings}));
 assert.equal(result.draft,draft);assert.equal(result.defaultMode,'ir');
 await assert.rejects(readCanonicalIrDisplay(archive({[DRAFT]:draft+' '})),/workspace-content-limit/);
 await assert.rejects(readCanonicalIrDisplay(archive({[SETTINGS]:settings+' '})),/workspace-content-limit/);
 const multibyte='中'.repeat(Math.floor(1024*1024/3)+1);
 await assert.rejects(readCanonicalIrDisplay(archive({[DRAFT]:multibyte})),/workspace-content-limit/);
});
test('invalid canonical archives, directory substitution and non-UTF8 bytes fail explicitly',async()=>{
 await assert.rejects(readCanonicalIrDisplay(new Uint8Array([1])),/invalid-workspace-file-archive/);
 await assert.rejects(readCanonicalIrDisplay(archive({[DRAFT+'/child']:'x'})),/workspace-content-not-file/);
 await assert.rejects(readCanonicalIrDisplay(archive({[SETTINGS+'/child']:'x'})),/workspace-content-not-file/);
 for(const path of [DRAFT,SETTINGS])await assert.rejects(readCanonicalIrDisplay(archive({[path]:new Uint8Array([255])})),/encoded data was not valid|encoding/i);
});
