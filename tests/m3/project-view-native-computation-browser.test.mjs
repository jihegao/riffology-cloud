import test from 'node:test';
import assert from 'node:assert/strict';
import {packaged,projectFiles,scope} from './project-views-fixture.mjs';
import {localBrowserFixture,projectFrame} from './project-view-local-fixture.mjs';

test('native DOM computes saved file data, pauses input-driven updates, resumes and reloads canonical defaults',async t=>{
 const files=projectFiles();
 files['app/home.html']='<!doctype html><h1>Native computation</h1><input id="factor" type="number" value="2"><button id="pause">Pause</button><button id="resume">Resume</button><output id="result">pending</output><output id="state">starting</output><output id="ticks">0</output><script type="module" src="./main.mjs"></script>';
 files['docs/data.json']='{"samples":[2,3,5]}';
 files['app/main.mjs']=`const data=JSON.parse((await riffoid.readFile('docs/data.json')).text);let paused=false,ticks=0;const factor=document.querySelector('#factor'),result=document.querySelector('#result'),state=document.querySelector('#state');const render=()=>{result.textContent=String(data.samples.reduce((a,b)=>a+b,0)*Number(factor.value));};factor.addEventListener('input',()=>{if(!paused)render();});document.querySelector('#pause').onclick=()=>{paused=true;state.textContent='paused';};document.querySelector('#resume').onclick=()=>{paused=false;state.textContent='running';render();};setInterval(()=>{if(!paused)document.querySelector('#ticks').textContent=String(++ticks);},50);render();state.textContent='running';`;
 const {pkg}=await packaged(files);let f;
 f=await localBrowserFixture(t,{handler:async(_req,res,url)=>{
  if(!url.pathname.endsWith('/project-views')&&!url.pathname.includes('/project-view-artifacts'))return false;
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify(url.pathname.includes('/project-view-artifacts')?{items:[],nextCursor:null,version:'a'.repeat(64)}:url.searchParams.has('identity')?{current:true}:{package:pkg,delivery:f.delivery}));return true;
 }});
 console.log(JSON.stringify({browserVersion:f.page.context().browser().version(),userAgent:await f.page.evaluate(()=>navigator.userAgent)}));
 const p=f.page,boot=async()=>p.evaluate(async scope=>{
  (await import('/i18n.js')).setLocale('en',{persist:false});const {createProjectViewsPanel}=await import('/project-views.js');
  window.api=async(path,options)=>{const r=await fetch(path,options);if(!r.ok)throw Error('denied');return r.json();};window.panel=createProjectViewsPanel({root:document.querySelector('#root'),api});await panel.enter(scope);
 },scope);
 await boot();await p.getByText('Saved page · browser local / unverified',{exact:true}).waitFor();let child=projectFrame(f);
 await child.locator('#result').filter({hasText:'20'}).waitFor();await child.waitForFunction(()=>Number(document.querySelector('#ticks').textContent)>=2);
 await child.locator('#factor').fill('5');assert.equal(await child.locator('#result').innerText(),'50');
 await child.locator('#pause').click();assert.equal(await child.locator('#state').innerText(),'paused');const ticks=await child.locator('#ticks').innerText();
 await child.locator('#factor').fill('3');await p.waitForTimeout(150);assert.equal(await child.locator('#ticks').innerText(),ticks);assert.equal(await child.locator('#result').innerText(),'50');
 await child.locator('#resume').click();assert.equal(await child.locator('#result').innerText(),'30');await child.waitForFunction(before=>Number(document.querySelector('#ticks').textContent)>Number(before),ticks);
 await p.reload();await boot();await p.getByText('Saved page · browser local / unverified',{exact:true}).waitFor();child=projectFrame(f);
 await child.locator('#result').filter({hasText:'20'}).waitFor();assert.equal(await child.locator('#factor').inputValue(),'2','reload reconstructs saved canonical content; unsaved JS memory is not persisted');
 await p.evaluate(()=>panel.leave());assert.equal(await p.locator('iframe').count(),0);assert.deepEqual(f.errors,[]);
 assert.equal(f.requests.some(r=>r.method!=='GET'||r.path.includes('project-view-sessions')||r.path.includes('/runs')||r.path.includes('/turns')),false);
 console.log(JSON.stringify({observations:{defaultResult:20,parameterResult:50,pausedInputResult:50,resumedResult:30,reloadedSavedDefault:20,frameCountAfterLeave:0},source:'local synthetic canonical package; actual native bootstrap/broker'}));
});
