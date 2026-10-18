import test from 'node:test';
import assert from 'node:assert/strict';
import {packaged,projectFiles,scope} from './project-views-fixture.mjs';
import {localBrowserFixture,projectFrame} from './project-view-local-fixture.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function open(t,script,{artifactDelay=0}={}){
 const files=projectFiles();files['app/home.html']='<p id="value">pending</p><script type="module" src="./main.mjs"></script>';files['app/main.mjs']=script;
 const {pkg}=await packaged(files);let f,authorizations=0;
 f=await localBrowserFixture(t,{handler:async(_req,res,url)=>{
  if(!url.pathname.endsWith('/project-views')&&!url.pathname.includes('/project-view-artifacts'))return false;
  res.setHeader('content-type','application/json');
  if(url.pathname.includes('/project-view-artifacts')){await delay(artifactDelay);res.end(JSON.stringify({items:[],nextCursor:null,version:'a'.repeat(64)}));}
  else if(url.searchParams.has('identity')){authorizations++;await delay(2600);res.end('{"current":true}');}
  else res.end(JSON.stringify({package:pkg,delivery:f.delivery}));return true;
 }});
 // Frame attachment precedes navigation in WebKit. Register the exact URL
 // observation before enter() can create/navigate the frame; never replace a
 // missing target frame with an arbitrary about:blank frame or a timed sleep.
 const navigation=f.page.waitForEvent('framenavigated',{predicate:frame=>frame.url()===f.frameUrl});
 await f.page.evaluate(async scope=>{(await import('/i18n.js')).setLocale('en',{persist:false});const {createProjectViewsPanel}=await import('/project-views.js');window.api=async(path,options)=>{const r=await fetch(path,options);if(!r.ok)throw Error('denied');return r.json();};window.panel=createProjectViewsPanel({root:document.querySelector('#root'),api,pollMs:60000});window.entering=panel.enter(scope);},scope);
 await f.page.locator('iframe').waitFor({state:'attached'});
 const exactFrameAtAttachment=Boolean(projectFrame(f)),child=await navigation;
 assert.equal(child.url(),f.frameUrl);
 console.log(JSON.stringify({fixtureObservation:{exactFrameAtAttachment,exactFrameAfterNavigation:true}}));
 return {f,child,authorizations:()=>authorizations};
}

test('native SDK file and subscribe wait for both real slow authorization boundaries', {timeout:30000},async t=>{
 const {f,child,authorizations}=await open(t,`void(async()=>{try{const data=JSON.parse((await riffoid.readFile('docs/data.json')).text);document.querySelector('#value').textContent=data.label;await riffoid.subscribe(()=>{});document.querySelector('#value').dataset.subscribed='yes';}catch(e){document.querySelector('#value').textContent='error:'+e.message;}})();`,{artifactDelay:600});
 await child.waitForFunction(()=>document.querySelector('#value').textContent!=='pending');
 assert.equal(await child.locator('#value').innerText(),'saved project data');
 await child.waitForFunction(()=>document.querySelector('#value').dataset.subscribed==='yes'||document.querySelector('#value').textContent.startsWith('error:'));
 assert.equal(await child.locator('#value').innerText(),'saved project data');assert.equal(await child.locator('#value').getAttribute('data-subscribed'),'yes');assert.equal(authorizations(),4);
 await f.page.evaluate(()=>panel.leave());assert.equal(await f.page.locator('iframe').count(),0);assert.deepEqual(f.errors,[]);
});

test('native module top-level awaited SDK read survives slow authorization within startup budget', {timeout:20000},async t=>{
 const {f,child}=await open(t,`const data=JSON.parse((await riffoid.readFile('docs/data.json')).text);document.querySelector('#value').textContent=data.label;`);
 await child.waitForFunction(()=>document.querySelector('#value').textContent==='saved project data');
 await f.page.getByText('Saved page · browser local / unverified',{exact:true}).waitFor();
 assert.equal(await child.locator('#value').innerText(),'saved project data');await f.page.evaluate(()=>panel.leave());assert.equal(await f.page.locator('iframe').count(),0);assert.deepEqual(f.errors,[]);
});


test('a real stalled authority fetch is aborted and the original frame stays closed across polling', {timeout:20000},async t=>{
 const files=projectFiles();files['app/main.mjs']='void riffoid.readFile("docs/data.json").catch(()=>{});';
 const {pkg}=await packaged(files);let f,identityReads=0,responseClosed=false;
 f=await localBrowserFixture(t,{handler:async(_req,res,url)=>{
  if(!url.pathname.endsWith('/project-views'))return false;
  if(url.searchParams.has('identity')){identityReads++;await new Promise(resolve=>res.once('close',()=>{responseClosed=true;resolve();}));return true;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({package:pkg,delivery:f.delivery}));return true;
 }});
 await f.page.evaluate(async scope=>{(await import('/i18n.js')).setLocale('en',{persist:false});const {createProjectViewsPanel}=await import('/project-views.js');window.api=async(path,options)=>{const r=await fetch(path,options);if(!r.ok)throw Error('denied');return r.json();};window.panel=createProjectViewsPanel({root:document.querySelector('#root'),api,pollMs:100});window.entering=panel.enter(scope);},scope);
 await f.page.locator('iframe').waitFor();await f.page.locator('iframe').waitFor({state:'detached',timeout:14000});
 await f.page.getByRole('button',{name:'Retry page',exact:true}).waitFor();await f.page.waitForTimeout(250);
 assert.equal(identityReads,1);assert.equal(responseClosed,true);assert.equal(f.requests.filter(r=>r.path.endsWith('/frame.html')).length,1);assert.equal(await f.page.locator('iframe').count(),0);await f.page.evaluate(()=>panel.leave());assert.deepEqual(f.errors,[]);
});
