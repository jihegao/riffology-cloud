import test from 'node:test';
import assert from 'node:assert/strict';
import {remoteBrowserFixture} from './project-view-remote-fixture.mjs';
async function fixture(t){
 const f=await remoteBrowserFixture(t,{html:'<section id="editor"></section>'});
 await f.page.evaluate(async()=>{
  const {setLocale}=await import('/i18n.js');setLocale('en');
  const {createManualSavePanel}=await import('/manual-save.js');
  window.f={calls:[],saved:[],mode:'ok',base:{revisionId:null,filesSha256:'a'.repeat(64),workspaceGeneration:1}};
  f.api=async(path,options={})=>{f.calls.push({path,...options});if(options.method==='POST'){f.body=JSON.parse(options.body);if(f.mode==='lost')throw Error('lost acknowledgement');return {status:'committed',operationId:options.headers['Idempotency-Key'],revisionId:'r1',filesSha256:'b'.repeat(64)};}if(path.includes('?path='))return{encoding:'utf8',content:'old content'};if(/manual-saves\//.test(path))return {status:'committed',operationId:path.split('/').at(-1),revisionId:'r1'};return {base:f.base,files:[{path:'docs/data.json'}],artifacts:[{path:'docs/data.json',title:'Data'}]};};
  f.create=()=>createManualSavePanel({root:document.querySelector('#editor'),api:f.api,onSaved:r=>f.saved.push(r)});
  f.editor=f.create();f.editor.enter({tenantId:'tenant-a',workspaceId:'workspace-a',canWrite:true});
 });
 await f.page.getByRole('button',{name:'Stage file change',exact:true}).waitFor();return f;
}
test('workbench stages explicit patch against canonical base and preserves upload declarations without a model call',async t=>{
 const {page:p,errors}=await fixture(t);
 await p.getByLabel('Project file path').fill('app/home.html');await p.getByLabel('Text content').fill('<h1>Saved page</h1>');
 await p.getByRole('button',{name:'Stage file change',exact:true}).click();assert.match(await p.locator('ul').textContent(),/\+ app\/home.html/);
 assert.equal(await p.evaluate(()=>f.calls.filter(c=>c.method==='POST').length),0);
 await p.getByRole('button',{name:'Confirm and save changes',exact:true}).click();await p.waitForFunction(()=>f.saved.length===1);
 const s=await p.evaluate(()=>({body:f.body,calls:f.calls,stored:Object.values(sessionStorage)}));
 assert.deepEqual(s.body.base,{revisionId:null,filesSha256:'a'.repeat(64),workspaceGeneration:1});assert.deepEqual(s.body.changes,[{path:'app/home.html',encoding:'utf8',content:'<h1>Saved page</h1>'}]);assert.deepEqual(s.body.artifacts,[{path:'docs/data.json',title:'Data'}]);assert.equal(s.calls.every(c=>c.path.includes('/manual-saves')),true);assert.equal(s.stored.some(s=>s.includes('Saved page')),false);assert.deepEqual(errors,[]);
});
test('lost acknowledgement locks writes and checks original operation after remount without persisting private text',async t=>{
 const {page:p}=await fixture(t);await p.evaluate(()=>f.mode='lost');await p.getByLabel('Project file path').fill('private.txt');await p.getByLabel('Text content').fill('private secret fixture');await p.getByRole('button',{name:'Stage file change',exact:true}).click();await p.getByRole('button',{name:'Confirm and save changes',exact:true}).click();await p.getByRole('button',{name:'Check original save',exact:true}).waitFor();
 assert.equal(await p.getByRole('button',{name:'Confirm and save changes',exact:true}).isDisabled(),true);
 const key=await p.evaluate(()=>{const item=Object.values(sessionStorage).find(s=>s.includes('"key"'));if(item.includes('private secret fixture'))throw Error('private body persisted');return JSON.parse(item).key;});
 await p.evaluate(()=>{f.editor.leave();document.querySelector('#editor').replaceChildren();f.editor=f.create();f.editor.enter({tenantId:'tenant-a',workspaceId:'workspace-a',canWrite:true});});
 await p.getByRole('button',{name:'Check original save',exact:true}).click();await p.waitForFunction(()=>f.saved.length===1);
 assert.equal(await p.evaluate(()=>f.calls.filter(c=>c.method==='POST').length),1);assert.equal(await p.evaluate(key=>f.calls.some(c=>c.path.endsWith('/'+key)),key),true);
});
test('late base response from prior workspace cannot replace new workspace base',async t=>{
 const {page:p}=await fixture(t);
 const result=await p.evaluate(async()=>{f.editor.leave();document.querySelector('#editor').replaceChildren();let first;const e=(await import('/manual-save.js')).createManualSavePanel({root:document.querySelector('#editor'),api:path=>path.includes('workspace-a')?new Promise(r=>first=r):Promise.resolve({base:{...f.base,revisionId:'b'},files:[],artifacts:[]})});e.enter({tenantId:'t',workspaceId:'workspace-a',canWrite:true});e.enter({tenantId:'t',workspaceId:'workspace-b',canWrite:false});first({base:f.base,files:[],artifacts:[]});await new Promise(r=>setTimeout(r,10));return{hidden:document.querySelector('#editor').hidden,disabled:[...document.querySelectorAll('button')].every(b=>b.disabled)};});assert.equal(result.hidden,true);assert.equal(result.disabled,true);
});
test('existing text can be read, replaced and explicitly removed from uploaded artifacts',async t=>{
 const {page:p}=await fixture(t);await p.getByLabel('Project file path').fill('docs/data.json');await p.getByRole('button',{name:'Read current file',exact:true}).click();await p.waitForFunction(()=>document.querySelector('textarea').value==='old content');await p.getByLabel('Mark as uploaded artifact').uncheck();await p.getByLabel('Text content').fill('{"updated":true}');await p.getByRole('button',{name:'Stage file change',exact:true}).click();await p.getByRole('button',{name:'Confirm and save changes',exact:true}).click();await p.waitForFunction(()=>f.saved.length===1);assert.deepEqual(await p.evaluate(()=>f.body.artifacts),[]);
});

test('browser storage failure prevents submission rather than losing original operation identity',async t=>{
 const {page:p}=await fixture(t);await p.getByLabel('Project file path').fill('app/home.html');await p.getByLabel('Text content').fill('content');await p.getByRole('button',{name:'Stage file change',exact:true}).click();await p.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('quota');};});await p.getByRole('button',{name:'Confirm and save changes',exact:true}).click();assert.equal(await p.evaluate(()=>f.calls.filter(c=>c.method==='POST').length),0);assert.match(await p.locator('[role=status]').textContent(),/Nothing was submitted/);
});

test('a request-bound preflight rejection unlocks editing; arbitrary error responses stay unknown',async t=>{
 const {page:p}=await fixture(t);await p.evaluate(()=>{const original=f.api;f.api=async(path,options={})=>{if(options.method==='POST'){f.calls.push({path,...options});return {operationId:options.headers['Idempotency-Key'],status:'rejected',requestSha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(options.body)))].map(n=>n.toString(16).padStart(2,'0')).join('')};}return original(path,options);};f.editor.leave();document.querySelector('#editor').replaceChildren();f.editor=f.create();f.editor.enter({tenantId:'tenant-a',workspaceId:'workspace-a',canWrite:true});});
 await p.getByLabel('Project file path').fill('app/a.html');await p.getByLabel('Text content').fill('hello');await p.getByRole('button',{name:'Stage file change',exact:true}).click();await p.getByRole('button',{name:'Confirm and save changes',exact:true}).click();await p.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('Save rejected'));
 assert.equal(await p.getByRole('button',{name:'Confirm and save changes',exact:true}).isDisabled(),false);assert.equal(await p.getByLabel('Text content').isDisabled(),false);assert.equal(await p.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('riffology:manual-save:')).length),0);
});
test('explicit pending recovery resubmits the frozen original key and body after observation',async t=>{
 const {page:p}=await fixture(t);await p.evaluate(()=>{let writes=0;const original=f.api;f.api=async(path,options={})=>{if(options.method==='POST'){f.calls.push({path,...options});writes++;return {operationId:options.headers['Idempotency-Key'],status:writes===1?'pending':'committed'};}if(/manual-saves\//.test(path)){f.calls.push({path,...options});return {operationId:path.split('/').at(-1),status:'pending'};}return original(path,options);};f.editor.leave();document.querySelector('#editor').replaceChildren();f.editor=f.create();f.editor.enter({tenantId:'tenant-a',workspaceId:'workspace-a',canWrite:true});});
 await p.getByLabel('Project file path').fill('app/a.html');await p.getByLabel('Text content').fill('hello');await p.getByRole('button',{name:'Stage file change',exact:true}).click();await p.getByRole('button',{name:'Confirm and save changes',exact:true}).click();await p.getByRole('button',{name:'Check original save',exact:true}).click();await p.waitForFunction(()=>f.saved.length===1);
 const writes=await p.evaluate(()=>f.calls.filter(c=>c.method==='POST'));assert.equal(writes.length,2);assert.equal(writes[0].body,writes[1].body);assert.equal(writes[0].headers['Idempotency-Key'],writes[1].headers['Idempotency-Key']);
});
test('oversized JSON is rejected before allocating or sending a save operation',async t=>{
 const {page:p}=await fixture(t);
 await p.evaluate(()=>{const inputs=document.querySelectorAll('#editor input');const path=inputs[0],content=document.querySelector('textarea'),stage=[...document.querySelectorAll('button')].find(b=>b.textContent==='Stage file change');for(let i=0;i<3;i++){path.value=`docs/control-${i}.txt`;content.value='\u0001'.repeat(250000);stage.click();}});
 await p.getByRole('button',{name:'Confirm and save changes',exact:true}).click();assert.equal(await p.evaluate(()=>f.calls.filter(c=>c.method==='POST').length),0);assert.equal(await p.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('riffology:manual-save:')).length),0);assert.match(await p.locator('[role=status]').textContent(),/exceeds the limit/);
});
test('refresh recovery accepts only the original JSON digest and keeps the original key without storing content',async t=>{
 const {page:p}=await fixture(t);
 await p.evaluate(()=>{const original=f.api;let writes=0;f.api=async(path,options={})=>{if(options.method==='POST'){f.calls.push({path,...options});writes++;return {operationId:options.headers['Idempotency-Key'],status:writes===1?'pending':'committed'};}if(/manual-saves\//.test(path)){f.calls.push({path,...options});return {operationId:path.split('/').at(-1),status:'pending'};}return original(path,options);};f.editor.leave();document.querySelector('#editor').replaceChildren();f.editor=f.create();f.editor.enter({tenantId:'tenant-a',workspaceId:'workspace-a',canWrite:true});});
 await p.getByLabel('Project file path').fill('app/private.html');await p.getByLabel('Text content').fill('private content fixture');await p.getByRole('button',{name:'Stage file change',exact:true}).click();await p.getByRole('button',{name:'Confirm and save changes',exact:true}).click();await p.waitForFunction(()=>f.calls.some(c=>c.method==='POST'));
 const body=await p.getByLabel('Original save request JSON').inputValue();const key=await p.evaluate(()=>f.calls.find(c=>c.method==='POST').headers['Idempotency-Key']);
 assert.equal(await p.evaluate(()=>Object.values(sessionStorage).some(v=>v.includes('private content fixture'))),false);
 await p.evaluate(()=>{f.editor.leave();document.querySelector('#editor').replaceChildren();f.editor=f.create();f.editor.enter({tenantId:'tenant-a',workspaceId:'workspace-a',canWrite:true});});
 await p.getByLabel('Original save request JSON').fill(body.replace('private content fixture','tampered content'));
 await p.getByRole('button',{name:'Verify and resume original save',exact:true}).click();await p.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('does not match'));assert.equal(await p.evaluate(()=>f.calls.filter(c=>c.method==='POST').length),1);
 await p.getByLabel('Original save request JSON').fill(body);await p.getByRole('button',{name:'Verify and resume original save',exact:true}).click();await p.waitForFunction(()=>f.saved.length===1);
 const writes=await p.evaluate(()=>f.calls.filter(c=>c.method==='POST'));assert.equal(writes.length,2);assert.equal(writes[1].headers['Idempotency-Key'],key);assert.equal(writes[1].body,body);
});
