import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const names=['artifact-views.js','simulation.js','i18n.js','i18n-bindings.js','locale-preference.js','workspace.css','styles.css'];
const assets=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(new URL('../../services/web/'+name,import.meta.url),'utf8')])));
async function fixture(t){
 const browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||'chrome'});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1024,height:800}});
 await page.route('https://views.test/**',route=>{const name=new URL(route.request().url()).pathname.slice(1);return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html',body:assets[name]??'<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/workspace.css"><div id="model"></div><div id="runs"><section id="simulation"></section><section id="history"></section></div>'});});
 await page.goto('https://views.test/');
 await page.evaluate(async()=>{
  (await import('/i18n.js')).setLocale('en',{persist:false});const {createSimulationPanel}=await import('/simulation.js');window.requests=[];
  window.model={canRun:false,version:null,spec:null,reasonCode:'model-spec-missing',artifacts:{revisionId:'design-rev',filesSha256:'a'.repeat(64),manifest:{schema:'riffology.model-artifacts/v1',files:[],views:[{id:'bdd',section:'model',title:'Structure',renderer:'graph',source:'design/bdd.json'},{id:'sysml',section:'model',title:'SysML',renderer:'source',source:'design/source.sysml'},{id:'metrics',section:'runs',title:'Measured metrics',renderer:'metrics',source:'runs.records'},{id:'history',section:'runs',title:'Saved runs',renderer:'history',source:'runs.records'}]},contents:{'design/source.sysml':'<img src=x onerror="window.executed=true">','design/bdd.json':JSON.stringify({schema:'riffology.design-graph/v1',kind:'bdd',nodes:[{id:'Crane',label:'Crane'},{id:'Truck',label:'Truck'}],edges:[{from:'Crane',to:'Truck',label:'loads'}]})}}};
  window.panel=createSimulationPanel({root:document.querySelector('#simulation'),modelRoot:document.querySelector('#model'),historyRoot:document.querySelector('#history'),runsRoot:document.querySelector('#runs'),api:async(path,init)=>{requests.push({path,method:init?.method??'GET'});if(init?.method)throw Error('unexpected-write');return path.endsWith('/model')?model:{items:[{runId:'old-run',experimentId:'old-run',version:{revisionId:'old-rev',filesSha256:'b'.repeat(64),specSha256:'c'.repeat(64)},parameters:{servers:1},seed:12,status:'completed',stale:true,released:true,result:{metrics:{completed:7}}}]};}});
  window.scope={tenantId:'tenant',workspaceId:'workspace'};await panel.enter(scope);
 });return page;
}
test('Model displays a non-runnable design and safe SysML/graph tabs; Runs views retain measured source identity',async t=>{
 const p=await fixture(t);assert.match(await p.locator('#model').innerText(),/Design saved/);assert.doesNotMatch(await p.locator('#runs').innerText(),/Cannot read|TypeError/);assert.equal(await p.getByRole('button',{name:'Run experiment',exact:true}).isDisabled(),true);
 const reads=await p.evaluate(()=>requests.length);await p.getByRole('tab',{name:'Structure',exact:true}).click();assert.equal(await p.locator('.design-graph rect').count(),2);assert.match(await p.locator('#model').innerText(),/SysML semantics have not been checked/);assert.match(await p.locator('#model').innerText(),/design-rev/);
 await mkdir('.local',{recursive:true});await p.screenshot({path:'.local/artifact-model-tabs.png'});
 await p.getByRole('tab',{name:'SysML',exact:true}).click();assert.equal(await p.locator('#model img').count(),0);assert.equal(await p.evaluate(()=>window.executed),undefined);
 await p.getByRole('tab',{name:'Measured metrics',exact:true}).click();assert.match(await p.locator('#runs').innerText(),/old-rev/);assert.match(await p.locator('#runs').innerText(),/"completed": 7/);assert.equal(await p.evaluate(()=>requests.length),reads);
 await p.getByRole('tab',{name:'Saved runs',exact:true}).click();assert.match(await p.locator('#runs').innerText(),/old-run/);assert.equal(await p.evaluate(()=>requests.length),reads);
 await p.evaluate(()=>panel.enter(scope));assert.equal(await p.getByRole('tab',{name:'SysML',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await p.getByRole('tab',{name:'Saved runs',exact:true}).getAttribute('aria-selected'),'true');
 await p.evaluate(async()=>{model.artifacts.manifest.views=model.artifacts.manifest.views.filter(v=>v.id!=='sysml');await panel.reload();});assert.equal(await p.locator('#model').getAttribute('data-selected-view'),'_overview');
 assert.ok((await p.evaluate(()=>requests)).every(r=>r.method==='GET'));
});
test('tab keyboard navigation and tenant/version boundaries never reuse a foreign selection',async t=>{
 const p=await fixture(t);const first=p.locator('#model [role="tab"]').first();await first.focus();await p.keyboard.press('ArrowRight');assert.equal(await p.getByRole('tab',{name:'Structure',exact:true}).getAttribute('aria-selected'),'true');await p.keyboard.press('End');assert.equal(await p.getByRole('tab',{name:'SysML',exact:true}).getAttribute('aria-selected'),'true');
 await p.evaluate(async()=>{scope={...scope,tenantId:'another-tenant'};await panel.enter(scope);});assert.equal(await p.locator('#model').getAttribute('data-selected-view'),'_overview');
 await p.getByRole('tab',{name:'Structure',exact:true}).click();await p.evaluate(async()=>{model.artifacts.filesSha256='d'.repeat(64);await panel.reload();});assert.equal(await p.locator('#model').getAttribute('data-selected-view'),'_overview');
});
