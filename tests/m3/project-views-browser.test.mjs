import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import worker from '../../services/browser-preview/execution/index.ts';
import {scope,projectFiles,packaged} from './project-views-fixture.mjs';
import {PROJECT_VIEW_FRAME_PATH} from '../../services/project-views/frame.mjs';
const web=new URL('../../services/web/',import.meta.url);
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
async function fixture(t,files=projectFiles(),artifactBackend=null){
 const initial=files?.pkg?files:await packaged(files);let current=initial.pkg,failure=false,authorityDelay=null,escapes=0,reads=0;
 const execution=createServer(async(req,res)=>{try{const response=await worker.fetch(new Request(executionOrigin+req.url,{headers:req.headers}),{APP_ORIGIN:appOrigin,EXECUTION_ORIGIN:executionOrigin,ALLOW_LOCALHOST_HTTP:'true'});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end();}});
 const app=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://app.test');
  if(url.pathname==='/escape'){escapes++;res.end('must not arrive');return;}
  if(url.pathname.endsWith('/project-views')){
   reads++;if(authorityDelay)await authorityDelay;if(failure){res.writeHead(503);res.end('{}');return;}
   res.setHeader('content-type','application/json');res.end(JSON.stringify(url.searchParams.has('identity')?{current:current.packageIdentity===url.searchParams.get('identity')}:{package:current,delivery:{executionOrigin,frameUrl:executionOrigin+PROJECT_VIEW_FRAME_PATH}}));return;
  }
  if(url.pathname.includes('/project-view-artifacts')){
   if(failure||url.searchParams.get('identity')!==current.packageIdentity){res.writeHead(403);res.end('{}');return;}
   try{const artifactId=url.pathname.split('/project-view-artifacts/')[1],query=artifactId?{artifactId,offset:Number(url.searchParams.get('offset')??0)}:{cursor:url.searchParams.get('cursor')};
    const result=artifactBackend?await artifactBackend(query):{items:[],nextCursor:null,version:'a'.repeat(64)};res.setHeader('content-type','application/json');res.end(JSON.stringify(result));
   }catch{res.writeHead(403);res.end('{}');}return;
  }
  if(url.pathname.endsWith('/model')||url.pathname.endsWith('/experiments')){res.setHeader('content-type','application/json');res.end(JSON.stringify(url.pathname.endsWith('/model')?{spec:null,version:null,reasonCode:'model-spec-missing',canRun:false,projectViews:{declared:true}}:{items:[]}));return;}
  if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end('<div id="model"></div><section id="simulation"></section><section id="history"></section><section id="runs"></section>');return;}
  try{const source=await readFile(new URL(url.pathname.slice(1),web));res.setHeader('content-type',url.pathname.endsWith('.js')?'application/javascript':'text/css');res.end(source);}catch{res.writeHead(404);res.end();}
 });
 const appPort=await listen(app),executionPort=await listen(execution);
 const appOrigin='http://127.0.0.1:'+appPort,executionOrigin='http://127.0.0.1:'+executionPort;
 t.after(async()=>{for(const s of [app,execution]){s.closeAllConnections();await new Promise(r=>s.close(r));}});
 const browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||'chrome'});
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const boot=async()=>{await page.goto(appOrigin);await page.evaluate(async scope=>{(await import('/i18n.js')).setLocale('en',{persist:false});const {createSimulationPanel}=await import('/simulation.js');window.api=async(path,options)=>{const response=await fetch(path,options);if(!response.ok)throw Error('request denied');return response.json();};window.panel=createSimulationPanel({root:document.querySelector('#simulation'),modelRoot:document.querySelector('#model'),historyRoot:document.querySelector('#history'),runsRoot:document.querySelector('#runs'),api:window.api});await panel.enter(scope);},scope);};
 await boot();
 return {page,boot,appOrigin,executionOrigin,errors,initial,set failure(v){failure=v;},set current(v){current=v;},get escapes(){return escapes;},get reads(){return reads;}};
}
test('saved generic pages render real DOM/modules/CSS/media; route and browser refresh restore the saved package',async t=>{
 const f=await fixture(t),p=f.page;let frame=p.frameLocator('iframe');
 await frame.locator('#value').waitFor();assert.equal(await frame.locator('#value').innerText(),'module loaded');
 await p.waitForFunction(()=>document.querySelector('iframe')!==null);
 const browserFrame=p.frames().find(x=>x.parentFrame());
 await browserFrame.waitForFunction(()=>window.projectData?.includes('saved project data')&&window.savedSnapshot?.revisionId==='revision-a');
 assert.equal(await frame.locator('h1').evaluate(e=>getComputedStyle(e).color),'rgb(0, 0, 255)');
 assert.equal(await frame.locator('img').evaluate(e=>e.complete&&e.naturalWidth>0),true);
 assert.equal(await p.locator('iframe').getAttribute('sandbox'),'allow-scripts');
 await frame.getByText('Report route').click();await p.frameLocator('iframe').getByText('Saved report').waitFor();
 await f.boot();await p.frameLocator('iframe').getByText('Saved report').waitFor();
 await mkdir('.local/project-views',{recursive:true});await p.screenshot({path:'.local/project-views/saved-report.png'});
 await writeFile('.local/project-views/frozen-project.tar',f.initial.bytes);assert.deepEqual((await packaged(projectFiles())).pkg,f.initial.pkg);
 assert.equal(f.errors.length,0,JSON.stringify(f.errors));
});
test('opaque page cannot read parent DOM/cookies/storage or send app fetch; failures destroy frame and recover',async t=>{
 const f=await fixture(t),p=f.page;await p.frameLocator('iframe').locator('#value').waitFor();const child=p.frames().find(x=>x.parentFrame());
 const denied=await child.evaluate(async app=>{const out={};for(const [k,fn]of Object.entries({parent:()=>parent.document.body.innerHTML,cookie:()=>document.cookie,storage:()=>localStorage.getItem('secret')}))try{out[k]=fn();}catch{out[k]='denied';}try{await fetch(app+'/escape');out.fetch='allowed';}catch{out.fetch='denied';}return out;},f.appOrigin);
 assert.deepEqual(denied,{parent:'denied',cookie:'denied',storage:'denied',fetch:'denied'});assert.equal(f.escapes,0);
 f.failure=true;
 // A read from an already displayed frame must recheck server authority.
 assert.equal(await child.evaluate(()=>riffoid.readFile('docs/data.json').then(()=>false,()=>true)),true);
 await p.evaluate(()=>panel.leave());assert.equal(await p.locator('iframe').count(),0);
 await p.evaluate(async scope=>panel.enter(scope),scope);await p.getByText('Saved pages unavailable',{exact:true}).waitFor();assert.equal(await p.locator('iframe').count(),0);
 f.failure=false;await p.getByRole('button',{name:'Retry page',exact:true}).click();await p.frameLocator('iframe').locator('#value').waitFor();
 // A package from a different project is rejected even when the API returns it.
 f.current=(await packaged(projectFiles(),{...scope,tenantId:'tenant-b',projectId:'project-b'})).pkg;
 await p.evaluate(()=>panel.leave());await p.evaluate(async scope=>panel.enter(scope),scope);assert.equal(await p.locator('iframe').count(),0);
 await p.getByText('Saved pages unavailable',{exact:true}).waitFor();
});


test('script throw, rejected promise and module load failure show a bounded failure and recover after repair',async t=>{
 for(const [kind,patch] of [
  ['module throw',{'app/main.mjs':'throw Error("PRIVATE_PROJECT_ERROR_TEXT");'}],
  ['inline reject',{'app/home.html':'<h1>Broken page</h1><script>Promise.reject(Error("PRIVATE_PROJECT_ERROR_TEXT"));</script>'}],
  ['script load',{'app/home.html':'<h1>Broken page</h1><script type="module" src="./style.css"></script>'}],
 ]){
  await t.test(kind,async t=>{
   const f=await fixture(t,{...projectFiles(),...patch}),p=f.page;
   await p.getByText('Page could not load',{exact:true}).waitFor();
   assert.equal(await p.locator('iframe').count(),0);
   assert.equal(await p.getByRole('button',{name:'Retry page',exact:true}).isVisible(),true);
   assert.equal(await p.getByText('Saved page · browser local / unverified',{exact:true}).count(),0);
   assert.equal((await p.locator('body').innerText()).includes('PRIVATE_PROJECT_ERROR_TEXT'),false);
   f.current=(await packaged()).pkg;
   await p.getByRole('button',{name:'Retry page',exact:true}).click();
   await p.frameLocator('iframe').locator('#value').waitFor();
   await p.getByText('Saved page · browser local / unverified',{exact:true}).waitFor();
  });
 }
});

test('new project skill -> synthetic Pi writes pages -> canonical save -> runtime cold restore -> browser navigation and refresh',async t=>{
 const {createControlledPiSession}=await import('../../services/runtime/controlled-pi.mjs');
 const {initialWorkspaceArchive}=await import('../../services/workspace/initial-archive.ts');
 const {projectResourcesFromArchive}=await import('../../services/project-resources/archive.ts');
 const {buildProjectViews}=await import('../../services/project-views/package.ts');
 const {createHash}=await import('node:crypto');
 const {projectFiles}=await import('./project-views-fixture.mjs');
 const generated=projectFiles(),stored=Object.fromEntries(Object.entries(generated).filter(([p])=>p==='AGENTS.md'||p.includes('/SKILL.md'))),allCalls=[];let modelCalls=0,writes=0;
 const saved=files=>{const bytes=initialWorkspaceArchive(Object.fromEntries(Object.entries(files).map(([p,c])=>[p,Buffer.from(c)])));return {bytes,source:{kind:'saved-turn',identity:{scope,sessionId:'e2e-session',turnId:'e2e-turn',dispatchId:'e2e-dispatch',generation:1},revision:{revisionId:'revision-a',objectKey:'fixture/saved.json',filesSha256:createHash('sha256').update(bytes).digest('hex'),sessionSha256:'b'.repeat(64),committedAt:1000}}};};
 const initial=saved(stored),model={provider:'riffology-local-e2e',id:'synthetic-page-author'};
 const output=(delta,finish_reason)=>`data: ${JSON.stringify({id:'fixture-e2e',object:'chat.completion.chunk',created:1,model:model.id,choices:[{index:0,delta,finish_reason}]})}\n\n`;
 const options={trustedCwd:'/tmp/riffology-e2e-trusted',scope:{tenantId:scope.tenantId,projectId:scope.projectId,sessionId:'e2e-session'},selectedModel:model,allowedModels:[model],providerDefinitions:[{provider:model.provider,config:{api:'openai-completions',baseUrl:'https://synthetic.invalid/v1',models:[{id:model.id,name:'Offline fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:16384,maxTokens:4096}]}}],resolveCredential:async()=> 'local-synthetic-fixture',systemPrompt:'Build project files through project_write. Do not execute project plugins.',projectResources:await projectResourcesFromArchive(initial.source,initial.bytes),bridge:{definitions:[{name:'project_write',label:'Write fixture project file',description:'Write one project file',parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false}}],execute:async call=>{assert.deepEqual(call.scope,{tenantId:scope.tenantId,projectId:scope.projectId,sessionId:'e2e-session'});stored[call.args.path]=call.args.content;writes++;return {content:[{type:'text',text:'saved fixture file'}],details:{fixture:true}};}},providerFetch:async(input,init)=>{
   modelCalls++;allCalls.push(JSON.parse(init.body));let stream=output({role:'assistant'},null);
   if(modelCalls===1){const files=Object.entries(generated).filter(([p])=>p!=='AGENTS.md'&&!p.includes('/SKILL.md'));stream+=output({tool_calls:files.map(([path,content],index)=>({index,id:'write-'+index,type:'function',function:{name:'project_write',arguments:JSON.stringify({path,content})}}))},null)+output({},'tool_calls');}
   else stream+=output({content:'Synthetic page author completed.'},null)+output({},'stop');
   return new Response(stream+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  }};
 const host=await createControlledPiSession(options);t.after(()=>host.dispose());
 assert.equal((await host.prompt('/skill:pages Create a dashboard and report.')).outcome,'completed');assert.match(JSON.stringify(allCalls[0]),/Write app\/views.json/);assert.equal(writes,Object.keys(generated).length-2);
 const frozen=saved(stored),snapshot=host.snapshot(),before={modelCalls,writes};await host.dispose();
 await mkdir('.local/project-views',{recursive:true});await writeFile('.local/project-views/new-project.tar',frozen.bytes);await writeFile('.local/project-views/new-project-session.json',JSON.stringify(snapshot));
 const bytes=new Uint8Array(await readFile('.local/project-views/new-project.tar')),resources=await projectResourcesFromArchive(frozen.source,bytes);
 const cold=await createControlledPiSession({...options,projectResources:resources,snapshot:JSON.parse(await readFile('.local/project-views/new-project-session.json','utf8'))});t.after(()=>cold.dispose());
 assert.deepEqual({modelCalls,writes},before,'cold restore must not replay provider or writes');
 const pkg=await buildProjectViews(frozen.source,bytes),f=await fixture(t,{bytes,source:frozen.source,pkg});
 await f.page.frameLocator('iframe').locator('#value').waitFor();await f.page.frameLocator('iframe').getByText('Report route').click();await f.page.frameLocator('iframe').getByText('Saved report').waitFor();await f.boot();await f.page.frameLocator('iframe').getByText('Saved report').waitFor();
 assert.deepEqual({modelCalls,writes},before,'browser refresh must not dispatch another Pi turn');
});


test('real local R2 Artifact receipts, chunked reads, updates, cancellation and retired reference denial reach only current page',async t=>{
 const {artifactFixture}=await import('./project-view-artifact-fixture.mjs');const store=await artifactFixture(t);
 const first=await store.call({op:'seed',n:1,text:'first private fixture'});
 const f=await fixture(t,projectFiles(),query=>store.call(query)),p=f.page;
 await p.frameLocator('iframe').locator('#value').waitFor();const child=p.frames().find(x=>x.parentFrame());
 const read=await child.evaluate(async()=>{
  const listing=await riffoid.listArtifacts(),receipt=listing.items[0];let offset=0,binary='',count=0;
  do{const chunk=await riffoid.readArtifact(receipt.artifactId,offset);if(chunk.offset!==offset||chunk.receipt.sha256!==receipt.sha256)throw Error('receipt mismatch');binary+=atob(chunk.base64);offset=chunk.nextOffset;count++;}while(offset!==null);
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  return {receipt,count,digest,body:JSON.parse(new TextDecoder().decode(bytes)).message};
 });
 assert.equal(read.receipt.artifactId,first.receipt.artifactId);assert.equal(read.digest,first.receipt.sha256);assert.ok(read.count>1);assert.equal(read.body,'first private fixture');assert.equal(read.receipt.objectKey,undefined);
 await child.evaluate(async()=>{window.updates=[];window.cancelUpdate=await riffoid.subscribe(s=>updates.push(s));});
 await child.waitForFunction(()=>updates.length>0&&updates.at(-1).artifacts.items.length===1);
 const second=await store.call({op:'seed',n:2,text:'second private fixture'});
 await p.evaluate(()=>panel.refresh?.());
 // The host polls existing state; no Observer/model execution is started.
 await child.waitForFunction(()=>updates.at(-1)?.artifacts?.items.length===2,{},{timeout:10000});
 const before=await child.evaluate(()=>{cancelUpdate();return updates.length;});await new Promise(r=>setTimeout(r,50));
 await store.call({op:'release',ref:second.ref});
 assert.equal(await child.evaluate(id=>riffoid.readArtifact(id).then(()=>false,()=>true),second.receipt.artifactId),true);
 await p.evaluate(()=>panel.leave());assert.equal(await p.locator('iframe').count(),0);
 assert.ok(before>=1);assert.equal(f.errors.length,0,JSON.stringify(f.errors));
});
