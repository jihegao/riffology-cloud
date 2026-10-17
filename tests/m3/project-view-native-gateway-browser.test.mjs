import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {manualPageFixture,appOrigin,scopes} from './manual-page-broker-fixture.mjs';
import {projectFiles} from './project-views-fixture.mjs';

// Synthetic authentication/ordinary invitation only. Real Gateway/Workspace,
// manual Revision/CAS, D1/R2, delivery, frame, package verifier and broker.
test('canonical local Gateway saves survive native DOM route refresh and cold reconstruction; current authority and policy revoke the frame',{timeout:60000},async t=>{
 const f=await manualPageFixture(t,{browserLocal:true});
 const files=version=>{const x=projectFiles();delete x['AGENTS.md'];delete x['.pi/skills/pages/SKILL.md'];x['app/value.mjs']='export const value='+JSON.stringify(version+' module')+';';x['app/report.html']='<h1>Saved report '+version+'</h1>';x['docs/data.json']=JSON.stringify({version});return x;};
 assert.equal((await f.save('alpha','native-v1',files('V1'))).body.status,'committed');const first=await f.read(f.base('alpha')+'/project-views');
 const browser=await chromium.launch({headless:true,...(process.env.M1_BROWSER_CHANNEL?{channel:process.env.M1_BROWSER_CHANNEL}:{})});t.after(()=>browser.close());
 const page=await browser.newPage(),requests=[],foreign=[];
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());requests.push({path:url.pathname,method:req.method()});
  if(url.origin!==appOrigin){foreign.push(url.origin);await route.abort();return;}
  if(url.pathname==='/'){
   await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><section id="root"></section><script type="module">import {setLocale} from "/i18n.js";import {createProjectViewsPanel} from "/project-views.js";setLocale("en",{persist:false});window.api=async(path,options)=>{const r=await fetch(path,options);if(!r.ok)throw Error("request denied");return r.json()};window.panel=createProjectViewsPanel({root:document.querySelector("#root"),api});window.entering=panel.enter('+JSON.stringify(scopes.alpha)+');</script>'});return;
  }
  if(/^\/[a-z0-9-]+\.js$/.test(url.pathname)){await route.fulfill({status:200,contentType:'application/javascript',body:await readFile(new URL('../../services/web/'+url.pathname.slice(1),import.meta.url),'utf8')});return;}
  const response=await f.rawRequest(url.pathname+url.search,{method:req.method(),headers:{...req.headers(),'x-synthetic-user':'alpha',Origin:appOrigin},...(req.postData()===null?{}:{body:req.postData()})});
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 const ready=async()=>{await page.getByText('Saved page · browser local / unverified',{exact:true}).waitFor();};
 const child=()=>page.frames().find(frame=>frame.url()===first.delivery.frameUrl);
 await page.goto(appOrigin);await ready();await child().waitForFunction(()=>window.loadedValue==='V1 module'&&window.projectData);
 assert.equal(await child().evaluate(()=>projectData),JSON.stringify({version:'V1'}));assert.equal(await page.locator('#value').count(),0);assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts');
 await page.getByRole('tab',{name:'Report',exact:true}).click();await page.frameLocator('iframe').getByText('Saved report V1',{exact:true}).waitFor();await page.reload();await ready();assert.equal(await page.frameLocator('iframe').getByText('Saved report V1',{exact:true}).count(),1);
 assert.equal((await f.save('alpha','native-v2',files('V2'))).body.status,'committed');const second=await f.read(f.base('alpha')+'/project-views');assert.notEqual(second.package.packageIdentity,first.package.packageIdentity);
 await f.restart();await page.reload();await ready();await page.frameLocator('iframe').getByText('Saved report V2',{exact:true}).waitFor();assert.equal((await f.read(f.base('alpha')+'/project-views')).package.packageIdentity,second.package.packageIdentity);
 await f.db.prepare("UPDATE catalog_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(scopes.alpha.tenantId,'alpha').run();await page.evaluate(()=>panel.reload());assert.equal(await page.locator('iframe').count(),0);
 await f.db.prepare("UPDATE catalog_memberships SET status='active' WHERE tenant_id=? AND user_id=?").bind(scopes.alpha.tenantId,'alpha').run();await page.evaluate(()=>panel.reload());assert.equal(await page.locator('iframe').count(),0);await page.getByRole('button',{name:'Retry page',exact:true}).click();await ready();
 await f.read('/__fixture/disable-browser-policy');await page.evaluate(()=>panel.reload());assert.equal(await page.locator('iframe').count(),0);
 const journal=await f.read('/__fixture/diagnostics?user=alpha');assert.equal(f.manualPosts,2);assert.equal(journal.turns,0);assert.equal(journal.sessions,0);assert.equal(f.outbound,0);
 assert.equal(requests.some(r=>r.path.includes('project-view-sessions')||r.path.includes('/project-views/v1/sessions')),false);assert.deepEqual(foreign,[]);
});
