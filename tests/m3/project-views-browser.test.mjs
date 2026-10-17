import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {scope,projectFiles,packaged} from './project-views-fixture.mjs';
import {localBrowserFixture,projectFrame} from './project-view-local-fixture.mjs';

// Real native DOM with the actual package/bootstrap/broker; fixture identity is synthetic.
async function fixture(t,files=projectFiles(),artifactBackend=null,extraHandler=null){
 const initial=files?.pkg?files:await packaged(files);let current=initial.pkg,failure=false,reads=0;
 let f;f=await localBrowserFixture(t,{html:'<div id="model"></div><section id="simulation"></section><section id="history"></section><section id="runs"></section>',handler:async(_req,res,url)=>{
  if(extraHandler&&await extraHandler(_req,res,url))return true;
  if(url.pathname.endsWith('/project-views')){reads++;if(failure){res.writeHead(503);res.end('{}');return true;}res.setHeader('content-type','application/json');res.end(JSON.stringify(url.searchParams.has('identity')?{current:current.packageIdentity===url.searchParams.get('identity')}:{package:current,delivery:f.delivery}));return true;}
  if(url.pathname.includes('/project-view-artifacts')){
   if(failure||url.searchParams.get('identity')!==current.packageIdentity){res.writeHead(403);res.end('{}');return true;}
   try{const artifactId=url.pathname.split('/project-view-artifacts/')[1],query=artifactId?{artifactId,offset:Number(url.searchParams.get('offset')??0)}:{cursor:url.searchParams.get('cursor')};const result=artifactBackend?await artifactBackend(query):{items:[],nextCursor:null,version:'a'.repeat(64)};res.setHeader('content-type','application/json');res.end(JSON.stringify(result));}catch{res.writeHead(403);res.end('{}');}return true;
  }
  if(url.pathname.endsWith('/model')||url.pathname.endsWith('/experiments')){res.setHeader('content-type','application/json');res.end(JSON.stringify(url.pathname.endsWith('/model')?{spec:null,version:null,reasonCode:'model-spec-missing',canRun:false,projectViews:{declared:true}}:{items:[]}));return true;}
  return false;
 }});
 const p=f.page;
 const boot=async()=>{
  await p.goto(f.origin);await p.evaluate(async scope=>{
   (await import('/i18n.js')).setLocale('en',{persist:false});const {createSimulationPanel}=await import('/simulation.js');
   window.api=async(path,options)=>{const response=await fetch(path,options);if(!response.ok)throw Error('request denied');return response.json();};
   window.panel=createSimulationPanel({root:document.querySelector('#simulation'),modelRoot:document.querySelector('#model'),historyRoot:document.querySelector('#history'),runsRoot:document.querySelector('#runs'),api:window.api});await panel.enter(scope);
  },scope);
 };
 await boot();
 return {...f,boot,initial,set failure(value){failure=value;},set current(value){current=value;},get reads(){return reads;}};
}
async function ready(p){await p.locator('.project-view-body iframe').waitFor();await p.getByText('Saved page · browser local / unverified',{exact:true}).waitFor();}
const noRemote=f=>assert.equal(f.requests.some(r=>r.path.includes('project-view-sessions')||r.path.includes('/project-views/v1/sessions')),false);

test('saved DOM page renders modules CSS and media in an opaque iframe; route and refresh restore the canonical package',async t=>{
 const f=await fixture(t),p=f.page;await ready(p);const child=projectFrame(f);
 await child.waitForFunction(()=>window.loadedValue==='module loaded'&&window.projectData);assert.equal(await child.evaluate(()=>getComputedStyle(document.body).color),'rgb(0, 0, 255)');assert.equal(await child.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
 assert.equal(await p.locator('#value').count(),0);assert.equal(await p.locator('canvas').count(),0);assert.equal(await p.locator('.project-view-body iframe').getAttribute('sandbox'),'allow-scripts');
 await p.getByRole('tab',{name:'Report',exact:true}).click();await p.frameLocator('.project-view-body iframe').getByText('Saved report',{exact:true}).waitFor();
 await f.boot();await ready(p);assert.equal(await p.getByRole('tab',{name:'Report',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await p.frameLocator('.project-view-body iframe').getByText('Saved report',{exact:true}).count(),1);
 assert.deepEqual((await packaged(projectFiles())).pkg,f.initial.pkg);assert.deepEqual(f.errors,[]);noRemote(f);
});

test('actual broker authority failure removes native DOM; retry and foreign package denial never use remote fallback',async t=>{
 const f=await fixture(t),p=f.page;await ready(p);f.failure=true;
 await projectFrame(f).evaluate(()=>{window.denied=riffoid.readFile('docs/data.json').then(v=>v.text,()=>null);});
 await p.locator('.project-view-body iframe').waitFor({state:'detached'});await p.evaluate(()=>panel.leave());
 await p.evaluate(async scope=>panel.enter(scope),scope);await p.getByText('Saved pages unavailable',{exact:true}).waitFor();assert.equal(await p.locator('iframe').count(),0);
 f.failure=false;await p.getByRole('button',{name:'Retry page',exact:true}).click();await ready(p);
 f.current=(await packaged(projectFiles(),{...scope,tenantId:'tenant-b',projectId:'project-b'})).pkg;await p.evaluate(()=>panel.leave());await p.evaluate(async scope=>panel.enter(scope),scope);
 await p.getByText('Saved pages unavailable',{exact:true}).waitFor();assert.equal(await p.locator('iframe').count(),0);noRemote(f);
});

test('automatic read-only polls cannot reexecute the same DOM package after a read or permission failure until explicit retry',async t=>{
 for(const failureStatus of [503,403])await t.test(String(failureStatus),async t=>{
  const files=projectFiles();files['app/main.mjs']+=';parent.postMessage({type:"synthetic-project-executed"},"*");';const pkg=(await packaged(files)).pkg;let status=200,baseReads=0,failedReads=0;
  let f;f=await localBrowserFixture(t,{handler:async(_req,res,url)=>{
   if(url.pathname.includes('/project-view-artifacts')){res.setHeader('content-type','application/json');res.end(JSON.stringify({items:[],nextCursor:null,version:'a'.repeat(64)}));return true;}
   if(!url.pathname.endsWith('/project-views'))return false;
   if(url.searchParams.has('identity')){res.setHeader('content-type','application/json');res.end(JSON.stringify({current:true}));return true;}
   baseReads++;if(status!==200){failedReads++;res.writeHead(status);res.end('{}');return true;}
   res.setHeader('content-type','application/json');res.end(JSON.stringify({package:pkg,delivery:f.delivery}));return true;
  }});const p=f.page;
  await p.evaluate(async({scope})=>{
   const {createProjectViewsPanel}=await import('/project-views.js');(await import('/i18n.js')).setLocale('en',{persist:false});window.projectExecutions=0;
   addEventListener('message',e=>{if(e.source===document.querySelector('iframe')?.contentWindow&&e.origin==='null'&&e.data?.type==='synthetic-project-executed')projectExecutions++;});
   window.api=async(path,options)=>{const r=await fetch(path,options);if(!r.ok)throw Error('request denied');return r.json();};window.panel=createProjectViewsPanel({root:document.querySelector('#root'),api,pollMs:100});await panel.enter(scope);
  },{scope});
  await ready(p);await p.waitForFunction(()=>projectExecutions===1);const framesBefore=f.requests.filter(r=>r.path.endsWith('/frame.html')).length;
  status=failureStatus;await p.getByText('Saved pages unavailable',{exact:true}).waitFor();assert.ok(failedReads>0);assert.equal(await p.locator('iframe').count(),0);
  const readsBeforeRecovery=baseReads;status=200;
  for(let i=0;i<100&&baseReads<readsBeforeRecovery+2;i++)await p.waitForTimeout(20);
  assert.ok(baseReads>=readsBeforeRecovery+2,'automatic read-only polling continues after recovery');
  assert.equal(await p.locator('iframe').count(),0);assert.equal(await p.evaluate(()=>projectExecutions),1);assert.equal(f.requests.filter(r=>r.path.endsWith('/frame.html')).length,framesBefore);
  await p.getByRole('button',{name:'Retry page',exact:true}).click();await ready(p);await p.waitForFunction(()=>projectExecutions===2);noRemote(f);
 });
});

test('self navigation may send authorized bytes but ends the original native session and cannot automatically restart it',async t=>{
 const f=await fixture(t),p=f.page;await ready(p);const child=projectFrame(f);
 await child.evaluate(()=>{location.href='/outside?authorized=synthetic';});await p.getByText('Page navigation ended the saved page session',{exact:true}).waitFor();assert.equal(await p.locator('iframe').count(),0);
 await p.evaluate(async()=>(await import('/i18n.js')).setLocale('zh-CN',{persist:false}));await p.getByText('页面导航已结束当前页面会话',{exact:true}).waitFor();await p.evaluate(async()=>(await import('/i18n.js')).setLocale('en',{persist:false}));
 const frames=f.requests.filter(r=>r.path.endsWith('/frame.html')).length;await p.evaluate(()=>panel.reload());assert.equal(f.requests.filter(r=>r.path.endsWith('/frame.html')).length,frames);
 assert.ok(f.requests.some(r=>r.path==='/outside'));await p.getByRole('button',{name:'Retry page',exact:true}).click();await ready(p);noRemote(f);
});

test('navigation to a committed endless HTTP response closes the original native frame and port before another load',async t=>{
 let streamingResponse,streamClosed=false;const f=await fixture(t,projectFiles(),null,async(_req,res,url)=>{
  if(url.pathname!=='/never-ending-navigation')return false;
  streamingResponse=res;res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.write('<!doctype html><title>Streaming target</title>'+(' '.repeat(2048)));res.once('close',()=>{streamClosed=true;});return true;
 }),p=f.page;await ready(p);const child=projectFrame(f);
 await p.evaluate(()=>{window.originalFrame=document.querySelector('.project-view-body iframe');window.afterReadyLoads=0;originalFrame.addEventListener('load',()=>afterReadyLoads++);window.hostPortCloses=0;const close=MessagePort.prototype.close;MessagePort.prototype.close=function(){hostPortCloses++;return close.call(this);};});
 const response=p.waitForResponse(r=>r.url().endsWith('/never-ending-navigation')&&r.request().isNavigationRequest(),{timeout:5000});
 await child.evaluate(()=>{location.href='/never-ending-navigation';});assert.equal((await response).status(),200);
 assert.equal(streamingResponse.headersSent,true,'the actual HTTP navigation response was committed');assert.equal(streamingResponse.writableEnded,false,'the committed response has not finished');
 await p.getByText('Page navigation ended the saved page session',{exact:true}).waitFor({timeout:1000});
 assert.equal(await p.locator('iframe').count(),0);assert.equal(await p.evaluate(()=>afterReadyLoads),0,'there was no second load to trigger cleanup');assert.ok(await p.evaluate(()=>hostPortCloses)>=2,'the original broker and transferred local port are closed');
 for(let i=0;i<50&&!streamClosed;i++)await p.waitForTimeout(20);assert.equal(streamClosed,true,'removing the original frame cancels its streaming navigation');
 const reads=f.reads,frames=f.requests.filter(r=>r.path.endsWith('/frame.html')).length;for(let i=0;i<100&&f.reads===reads;i++)await p.waitForTimeout(60);
 assert.ok(f.reads>reads,'a subsequent automatic read-only poll completed');assert.equal(await p.locator('iframe').count(),0);assert.equal(f.requests.filter(r=>r.path.endsWith('/frame.html')).length,frames);
 await p.getByRole('button',{name:'Retry page',exact:true}).click();await ready(p);noRemote(f);
});

test('script failure is bounded in the host and explicit retry loads repaired saved bytes',async t=>{
 const broken=projectFiles();broken['app/main.mjs']='throw Error("PRIVATE_PROJECT_ERROR_TEXT");';const f=await fixture(t,broken),p=f.page;
 await p.getByText(/Page could not load|Page unavailable/).waitFor();assert.equal(await p.locator('iframe').count(),0);assert.equal((await p.locator('body').innerText()).includes('PRIVATE_PROJECT_ERROR_TEXT'),false);
 f.current=(await packaged()).pkg;await p.getByRole('button',{name:'Retry page',exact:true}).click();await ready(p);noRemote(f);
});

test('new project skill -> synthetic Pi writes pages -> canonical save -> cold restore -> native DOM route and refresh without replay',async t=>{
 const {createControlledPiSession}=await import('../../services/runtime/controlled-pi.mjs');
 const {initialWorkspaceArchive}=await import('../../services/workspace/initial-archive.ts');
 const {projectResourcesFromArchive}=await import('../../services/project-resources/archive.ts');
 const {buildProjectViews}=await import('../../services/project-views/package.ts');
 const generated=projectFiles(),stored=Object.fromEntries(Object.entries(generated).filter(([path])=>path==='AGENTS.md'||path.includes('/SKILL.md'))),allCalls=[];let modelCalls=0,writes=0;
 const saved=files=>{const bytes=initialWorkspaceArchive(Object.fromEntries(Object.entries(files).map(([path,content])=>[path,Buffer.from(content)])));return {bytes,source:{kind:'saved-turn',identity:{scope,sessionId:'e2e-session',turnId:'e2e-turn',dispatchId:'e2e-dispatch',generation:1},revision:{revisionId:'revision-a',objectKey:'fixture/saved.json',filesSha256:createHash('sha256').update(bytes).digest('hex'),sessionSha256:'b'.repeat(64),committedAt:1000}}};};
 const initial=saved(stored),model={provider:'riffology-local-e2e',id:'synthetic-page-author'};
 const output=(delta,finish_reason)=>`data: ${JSON.stringify({id:'fixture-e2e',object:'chat.completion.chunk',created:1,model:model.id,choices:[{index:0,delta,finish_reason}]})}\n\n`;
 const options={trustedCwd:'/tmp/riffology-e2e-trusted',scope:{tenantId:scope.tenantId,projectId:scope.projectId,sessionId:'e2e-session'},selectedModel:model,allowedModels:[model],providerDefinitions:[{provider:model.provider,config:{api:'openai-completions',baseUrl:'https://synthetic.invalid/v1',models:[{id:model.id,name:'Offline fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:16384,maxTokens:4096}]}}],resolveCredential:async()=> 'local-synthetic-fixture',systemPrompt:'Build project files through project_write. Do not execute project plugins.',projectResources:await projectResourcesFromArchive(initial.source,initial.bytes),bridge:{definitions:[{name:'project_write',label:'Write fixture project file',description:'Write one project file',parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false}}],execute:async call=>{assert.deepEqual(call.scope,{tenantId:scope.tenantId,projectId:scope.projectId,sessionId:'e2e-session'});stored[call.args.path]=call.args.content;writes++;return {content:[{type:'text',text:'saved fixture file'}],details:{fixture:true}};}},providerFetch:async(_input,init)=>{
  modelCalls++;allCalls.push(JSON.parse(init.body));let stream=output({role:'assistant'},null);
  if(modelCalls===1){const files=Object.entries(generated).filter(([path])=>path!=='AGENTS.md'&&!path.includes('/SKILL.md'));stream+=output({tool_calls:files.map(([path,content],index)=>({index,id:'write-'+index,type:'function',function:{name:'project_write',arguments:JSON.stringify({path,content})}}))},null)+output({},'tool_calls');}else stream+=output({content:'Synthetic page author completed.'},null)+output({},'stop');
  return new Response(stream+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 }};
 const host=await createControlledPiSession(options);t.after(()=>host.dispose());assert.equal((await host.prompt('/skill:pages Create a dashboard and report.')).outcome,'completed');assert.match(JSON.stringify(allCalls[0]),/Write app\/views.json/);assert.equal(writes,Object.keys(generated).length-2);
 const frozen=saved(stored),snapshot=host.snapshot(),before={modelCalls,writes};await host.dispose();await mkdir('.local/project-views',{recursive:true});await writeFile('.local/project-views/new-project.tar',frozen.bytes);await writeFile('.local/project-views/new-project-session.json',JSON.stringify(snapshot));
 const bytes=new Uint8Array(await readFile('.local/project-views/new-project.tar')),resources=await projectResourcesFromArchive(frozen.source,bytes),cold=await createControlledPiSession({...options,projectResources:resources,snapshot:JSON.parse(await readFile('.local/project-views/new-project-session.json','utf8'))});t.after(()=>cold.dispose());assert.deepEqual({modelCalls,writes},before,'cold restore must not replay provider or writes');
 const pkg=await buildProjectViews(frozen.source,bytes),f=await fixture(t,{bytes,source:frozen.source,pkg}),p=f.page;await ready(p);await p.getByRole('tab',{name:'Report',exact:true}).click();await p.frameLocator('.project-view-body iframe').getByText('Saved report',{exact:true}).waitFor();await f.boot();await ready(p);assert.equal(await p.frameLocator('.project-view-body iframe').getByText('Saved report',{exact:true}).count(),1);assert.deepEqual({modelCalls,writes},before,'browser refresh must not dispatch another Pi turn');
});

test('real local R2 artifacts, chunk reads and subscription cancellation use the native frame and current broker',async t=>{
 const {artifactFixture}=await import('./project-view-artifact-fixture.mjs'),store=await artifactFixture(t),first=await store.call({op:'seed',n:1,text:'first private fixture'});
 const f=await fixture(t,projectFiles(),query=>store.call(query)),p=f.page;await ready(p);const child=projectFrame(f);
 const listing=await child.evaluate(()=>riffoid.listArtifacts()),receipt=listing.items[0];let offset=0,count=0;const chunks=[];
 do{const chunk=await child.evaluate(({id,offset})=>riffoid.readArtifact(id,offset),{id:receipt.artifactId,offset});assert.equal(chunk.receipt.sha256,receipt.sha256);chunks.push(Buffer.from(chunk.base64,'base64'));offset=chunk.nextOffset;count++;}while(offset!==null);
 const bytes=Buffer.concat(chunks);assert.equal(receipt.artifactId,first.receipt.artifactId);assert.ok(count>1);assert.equal(createHash('sha256').update(bytes).digest('hex'),first.receipt.sha256);assert.equal(JSON.parse(bytes).message,'first private fixture');assert.equal(receipt.objectKey,undefined);
 // The default module already subscribed once; use a new explicit listener too.
 await child.evaluate(async()=>{window.snapshots=[];window.cancel=await riffoid.subscribe(s=>snapshots.push(s));});await child.waitForFunction(()=>snapshots.length>0);
 const second=await store.call({op:'seed',n:2,text:'second private fixture'});await p.evaluate(()=>panel.reload());await child.waitForFunction(()=>snapshots.some(s=>s.artifacts.items.length===2));
 await child.evaluate(()=>cancel());const before=await child.evaluate(()=>snapshots.length);await store.call({op:'seed',n:3,text:'third private fixture'});await p.evaluate(()=>panel.reload());assert.equal(await child.evaluate(()=>snapshots.length),before);
 await store.call({op:'release',ref:second.ref});await assert.rejects(child.evaluate(id=>riffoid.readArtifact(id,0),second.receipt.artifactId),/request-denied/);
 await p.evaluate(()=>panel.leave());assert.equal(await p.locator('iframe').count(),0);assert.deepEqual(f.errors,[]);noRemote(f);
});

test('route replacement discards an artifact reply arriving after the original frame and subscription were closed',async t=>{
 let release,waiting=false;const gate=new Promise(resolve=>{release=resolve;}),f=await fixture(t,projectFiles(),async()=>{waiting=true;await gate;return {items:[{marker:'OLD_SCOPE_ONLY'}],nextCursor:null,version:'a'.repeat(64)};}),p=f.page;
 await ready(p);assert.equal(waiting,true);await p.getByRole('tab',{name:'Report',exact:true}).click();await p.frameLocator('.project-view-body iframe').getByText('Saved report',{exact:true}).waitFor();
 release();await p.waitForTimeout(50);assert.equal(await projectFrame(f).evaluate(()=>window.savedSnapshot),undefined);assert.equal((await p.locator('body').innerText()).includes('OLD_SCOPE_ONLY'),false);
 await p.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));assert.equal(await p.locator('iframe').count(),0);noRemote(f);
});
