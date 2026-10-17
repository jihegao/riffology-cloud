import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {scope,projectFiles,packaged} from './project-views-fixture.mjs';
import {remoteBrowserFixture} from './project-view-remote-fixture.mjs';

// These are host UI/transport tests. The injected isolated-browser transport
// returns PNGs and page messages; it does not prove project HTML/module/CSS
// rendering or renderer egress isolation. Those require the renderer probe.
async function fixture(t,files=projectFiles(),artifactBackend=null){
 const initial=files?.pkg?files:await packaged(files);let current=initial.pkg,failure=false,reads=0;
 let f;f=await remoteBrowserFixture(t,{html:'<div id="model"></div><section id="simulation"></section><section id="history"></section><section id="runs"></section>',handler:async(_req,res,url)=>{
  if(url.pathname.endsWith('/project-views')){reads++;if(failure){res.writeHead(503);res.end('{}');return true;}res.setHeader('content-type','application/json');res.end(JSON.stringify(url.searchParams.has('identity')?{current:current.packageIdentity===url.searchParams.get('identity')}:{package:current,delivery:{executionOrigin:f.executionOrigin,transport:'isolated-browser/v1'}}));return true;}
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
   const nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>new URL(typeof input==='string'?input:input.url,location.href).origin===remoteFixture.executionOrigin?remoteFixture.fetch(input,init):nativeFetch(input,init);
   (await import('/i18n.js')).setLocale('en',{persist:false});const {createSimulationPanel}=await import('/simulation.js');
   window.api=async(path,options)=>{const response=await fetch(path,options);if(!response.ok)throw Error('request denied');return response.json();};
   window.panel=createSimulationPanel({root:document.querySelector('#simulation'),modelRoot:document.querySelector('#model'),historyRoot:document.querySelector('#history'),runsRoot:document.querySelector('#runs'),api:window.api});await panel.enter(scope);
  },scope);
 };
 await boot();
 return {...f,boot,initial,set failure(value){failure=value;},set current(value){current=value;},get reads(){return reads;}};
}
async function ready(p){await p.locator('.project-view-body canvas').waitFor();await p.waitForFunction(()=>remoteFixture.requests.some(r=>r.body.type==='poll'));await p.getByText('Saved page · browser local / unverified',{exact:true}).waitFor();}
async function remoteRequest(p,message,id=null){
 const sessionId=id??await p.evaluate(()=>Object.keys(remoteFixture.sessions).at(-1));
 await p.evaluate(({sessionId,message})=>remoteFixture.sessions[sessionId].polls.push({messages:[message]}),{sessionId,message});
 await p.waitForFunction(({sessionId,message})=>remoteFixture.sessions[sessionId].broker.some(m=>m.id===message.id),{sessionId,message});
 return p.evaluate(({sessionId,message})=>remoteFixture.sessions[sessionId].broker.find(m=>m.id===message.id),{sessionId,message});
}

test('saved page transport renders only a canvas; selected route and browser refresh restore the saved package',async t=>{
 const f=await fixture(t),p=f.page;await ready(p);
 assert.equal(await p.locator('iframe').count(),0);assert.equal(await p.locator('#value').count(),0);
 const first=await p.evaluate(()=>remoteFixture.requests.find(r=>r.body.package));assert.equal(first.body.package.packageIdentity,f.initial.pkg.packageIdentity);assert.equal(first.body.view.id,'home');
 await p.getByRole('tab',{name:'Report',exact:true}).click();
 await p.waitForFunction(()=>remoteFixture.requests.filter(r=>r.body.package).at(-1)?.body.view.id==='report');
 await p.waitForFunction(()=>remoteFixture.sessions['session-1'].closed);await ready(p);
 await f.boot();await ready(p);
 assert.equal(await p.getByRole('tab',{name:'Report',exact:true}).getAttribute('aria-selected'),'true');
 assert.equal(await p.evaluate(()=>remoteFixture.requests.find(r=>r.body.package).body.view.id),'report');
 await mkdir('.local/project-views',{recursive:true});await p.screenshot({path:'.local/project-views/remote-saved-report.png'});await writeFile('.local/project-views/frozen-project.tar',f.initial.bytes);assert.deepEqual((await packaged(projectFiles())).pkg,f.initial.pkg);
 assert.deepEqual(f.errors,[]);assert.deepEqual(f.nativeRemoteRequests,[]);
});

test('saved-page authority is rechecked through the real broker; leave, retry and foreign-package rejection close remote sessions',async t=>{
 const f=await fixture(t),p=f.page;await ready(p);f.failure=true;
 const denied=await remoteRequest(p,{id:1,type:'files.read',path:'docs/data.json'});assert.equal(denied.error,'request-denied');
 await p.evaluate(()=>panel.leave());assert.equal(await p.locator('canvas').count(),0);assert.equal(await p.evaluate(()=>remoteFixture.sessions['session-1'].closed),true);
 await p.evaluate(async scope=>panel.enter(scope),scope);await p.getByText('Saved pages unavailable',{exact:true}).waitFor();assert.equal(await p.locator('canvas').count(),0);
 f.failure=false;await p.getByRole('button',{name:'Retry page',exact:true}).click();await ready(p);
 f.current=(await packaged(projectFiles(),{...scope,tenantId:'tenant-b',projectId:'project-b'})).pkg;
 const before=await p.evaluate(()=>remoteFixture.nextId);await p.evaluate(()=>panel.leave());await p.evaluate(async scope=>panel.enter(scope),scope);
 await p.getByText('Saved pages unavailable',{exact:true}).waitFor();assert.equal(await p.locator('canvas').count(),0);assert.equal(await p.evaluate(()=>remoteFixture.nextId),before);
 assert.deepEqual(f.nativeRemoteRequests,[]);
});

test('route replacement waits for confirmed original cleanup and retries the original session before creating another',async t=>{
 const f=await fixture(t),p=f.page;await ready(p);
 await p.evaluate(()=>{remoteFixture.sessions['session-1'].closeConfirmed=false;});await p.getByRole('tab',{name:'Report',exact:true}).click();
 await p.getByText('Page unavailable',{exact:true}).waitFor();
 assert.equal(await p.locator('canvas').count(),0);assert.equal(await p.evaluate(()=>remoteFixture.nextId),1);assert.equal(await p.evaluate(()=>remoteFixture.sessions['session-1'].closed),false);
 await p.evaluate(()=>{remoteFixture.sessions['session-1'].closeConfirmed=true;});await p.getByRole('button',{name:'Retry page',exact:true}).click();await ready(p);
 const requests=await p.evaluate(()=>remoteFixture.requests),creates=requests.filter(r=>r.body.package),closes=requests.filter(r=>r.body.type==='close');
 assert.equal(creates.length,2);assert.equal(creates[1].body.view.id,'report');assert.equal(closes.length,2);assert.ok(closes.every(r=>r.authorization==='Bearer fixture-session-secret-1'&&r.url.endsWith('/session-1')));assert.ok(requests.indexOf(closes[1])<requests.indexOf(creates[1]));assert.deepEqual(f.nativeRemoteRequests,[]);
});

test('remote page failure, closed session and invalid raster show a bounded host failure and recover through a fresh session',async t=>{
 for(const kind of ['page-failed','session-closed','invalid-raster'])await t.test(kind,async t=>{
  const f=await fixture(t),p=f.page;await ready(p);
  await p.evaluate(async kind=>{
   panel.leave();const response=kind==='page-failed'?{messages:[{type:'failed',error:'page-script-failed'}]}:kind==='session-closed'?{messages:[],closed:true}:{messages:[],frame:{base64:'PRIVATE_PROJECT_ERROR_TEXT',width:800,height:600}};
   remoteFixture.seeds.push({polls:[response]});
  },kind);
  await p.evaluate(async scope=>panel.enter(scope),scope);await p.getByText('Page could not load',{exact:true}).waitFor();
  assert.equal(await p.locator('canvas').count(),0);assert.equal(await p.locator('iframe').count(),0);assert.equal((await p.locator('body').innerText()).includes('PRIVATE_PROJECT_ERROR_TEXT'),false);
  await p.getByRole('button',{name:'Retry page',exact:true}).click();await ready(p);assert.deepEqual(f.nativeRemoteRequests,[]);
 });
});

test('new project skill -> synthetic Pi writes pages -> canonical save -> cold restore -> remote canvas route and refresh without replay',async t=>{
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
 const pkg=await buildProjectViews(frozen.source,bytes),f=await fixture(t,{bytes,source:frozen.source,pkg}),p=f.page;await ready(p);await p.getByRole('tab',{name:'Report',exact:true}).click();await p.waitForFunction(()=>remoteFixture.requests.filter(r=>r.body.package).at(-1)?.body.view.id==='report');await f.boot();await ready(p);assert.equal(await p.evaluate(()=>remoteFixture.requests.find(r=>r.body.package).body.view.id),'report');assert.deepEqual({modelCalls,writes},before,'browser refresh must not dispatch another Pi turn');
});

test('real local R2 Artifact receipts, chunked reads, subscriptions and retired-reference denial traverse only the current remote broker',async t=>{
 const {artifactFixture}=await import('./project-view-artifact-fixture.mjs'),store=await artifactFixture(t),first=await store.call({op:'seed',n:1,text:'first private fixture'});
 const f=await fixture(t,projectFiles(),query=>store.call(query)),p=f.page;await ready(p);let sequence=0;
 const listing=(await remoteRequest(p,{id:++sequence,type:'artifacts.list',cursor:null})).value,receipt=listing.items[0];let offset=0,count=0;const chunks=[];
 do{const chunk=(await remoteRequest(p,{id:++sequence,type:'artifacts.read',artifactId:receipt.artifactId,offset})).value;assert.equal(chunk.offset,offset);assert.equal(chunk.receipt.sha256,receipt.sha256);chunks.push(Buffer.from(chunk.base64,'base64'));offset=chunk.nextOffset;count++;}while(offset!==null);
 const bytes=Buffer.concat(chunks);assert.equal(receipt.artifactId,first.receipt.artifactId);assert.ok(count>1);assert.equal(createHash('sha256').update(bytes).digest('hex'),first.receipt.sha256);assert.equal(JSON.parse(bytes).message,'first private fixture');assert.equal(receipt.objectKey,undefined);
 assert.deepEqual((await remoteRequest(p,{id:++sequence,type:'updates.subscribe'})).value,{subscribed:true});await p.waitForFunction(()=>remoteFixture.sessions['session-1'].broker.some(m=>m.type==='snapshot'&&m.snapshot.artifacts.items.length===1));
 const second=await store.call({op:'seed',n:2,text:'second private fixture'});await p.evaluate(()=>panel.reload());await p.waitForFunction(()=>remoteFixture.sessions['session-1'].broker.some(m=>m.type==='snapshot'&&m.snapshot.artifacts.items.length===2));
 await remoteRequest(p,{id:++sequence,type:'updates.cancel'});const before=await p.evaluate(()=>remoteFixture.sessions['session-1'].broker.filter(m=>m.type==='snapshot').length);await store.call({op:'seed',n:3,text:'third private fixture'});await p.evaluate(()=>panel.reload());assert.equal(await p.evaluate(()=>remoteFixture.sessions['session-1'].broker.filter(m=>m.type==='snapshot').length),before);
 await store.call({op:'release',ref:second.ref});assert.equal((await remoteRequest(p,{id:++sequence,type:'artifacts.read',artifactId:second.receipt.artifactId,offset:0})).error,'request-denied');await p.evaluate(()=>panel.leave());assert.equal(await p.locator('canvas').count(),0);assert.equal(await p.evaluate(()=>remoteFixture.sessions['session-1'].closed),true);assert.deepEqual(f.errors,[]);assert.deepEqual(f.nativeRemoteRequests,[]);
});
