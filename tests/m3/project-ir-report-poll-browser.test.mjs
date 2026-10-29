import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {packaged,scope} from './project-views-fixture.mjs';
import {projectIrFixture} from './project-ir-fixture.ts';
import {localBrowserFixture,projectFrame} from './project-view-local-fixture.mjs';

// One shared actual IR/Report package, native opaque frame, real B1 Worker and
// runtime. Only RPC authority and delivery ordering are synthetic/loopback.
// No provider, cloud runtime, authentication or online ACC is exercised here.
const hash=value=>createHash('sha256').update(value).digest('hex');
const ready=p=>p.getByText('Saved page · browser local / unverified',{exact:true}).waitFor();
const noRemote=f=>assert.equal(f.requests.some(r=>r.path.includes('project-view-sessions')||r.path.includes('/project-views/v1/sessions')||r.path==='/v1'),false);

async function sharedFixture(t,initial){
 const packageRoot=new URL('../../vendor/riffoid-ir-plugin/',import.meta.url);
 const names=['browser/runtime.js','browser/worker.js','browser/app.js','browser/app.html','browser/app.css','package.json','acceptance/b1/expected.json'];
 const [runtimeSource,workerSource,appSource,appHtml,appCss,packageSource,expectedSource]=await Promise.all(names.map(path=>readFile(new URL(path,packageRoot),'utf8')));
 const {summarize}=await import(new URL('src/model-summary.mjs',packageRoot));
 const version=JSON.parse(packageSource).version,expected=JSON.parse(expectedSource).baseline;
 const graph=await projectIrFixture({runtimeSource,workerSource,pluginVersion:version}),workerSha256=hash(workerSource);
 const reportHtml='<h1>Saved poll-fence Report</h1><script>window.reportLoaded=true;void riffoid.subscribe(snapshot=>{window.reportSnapshot=snapshot;});</script>';
 const views=[{id:'report',title:'Report',entrypoint:'app/report.html'},{id:'ir',title:'IR Model',entrypoint:'app/ir/app.html'}];
 if(initial==='ir')views.reverse();
 const files={'app/views.json':JSON.stringify({schema:'project.views/v1',files:['app/report.html','app/ir/app.html','app/ir/app.js','app/ir/app.css'],views}),
  'app/report.html':reportHtml,'app/ir/app.html':appHtml.replace('src="http://127.0.0.1:8514/v1/bridge.js"','type="application/json"').replaceAll('/assets/','./'),
  'app/ir/app.js':appSource,'app/ir/app.css':appCss};
 const {pkg}=await packaged(files),runId='run-00000000-0000-4000-8000-000000000071';
 const record={runId,status:'pending',createdAt:'2026-10-19T00:00:00.000Z',modelRef:graph.artifact.modelRef,bundleRef:graph.artifact.bundleRef,
  browserArtifactRef:graph.browserArtifactRef,runtimeRef:graph.artifact.runtimeRef,workerSha256,toolchain:graph.artifact.toolchain,inputs:{seed:0},
  businessFingerprint:graph.artifact.businessFingerprint,planFingerprint:graph.artifact.planFingerprint,
  execution:{location:'user-browser',host:'riffoid',runtimeVersion:graph.artifact.toolchain.browserRuntime,verification:'local-unverified'},
  recordRef:`.riffoid-ir/runs/${runId}/record.json`,diagnostics:[]};
 let f,ownedClient=null,claimDeliveries=0,submissions=0;
 const operations=[],workers=[],workerCloses=[],consoleErrors=[],httpFailures=[];
 f=await localBrowserFixture(t,{handler:async(req,res,url)=>{
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return true;}
  if(url.pathname.endsWith('/project-views')){res.setHeader('content-type','application/json');res.end(JSON.stringify(url.searchParams.has('identity')?{current:url.searchParams.get('identity')===pkg.packageIdentity}:{package:pkg,delivery:f.delivery}));return true;}
  if(url.pathname.includes('/project-view-artifacts')){res.setHeader('content-type','application/json');res.end(JSON.stringify({items:[],nextCursor:null,version:'a'.repeat(64)}));return true;}
  if(!url.pathname.endsWith('/project-ir'))return false;
  assert.equal(req.method,'POST');assert.equal(req.headers.authorization,undefined);
  if(req.headers['content-type']!=='application/json'){res.writeHead(415,{'content-type':'application/json'});res.end(JSON.stringify({error:'json_required'}));return true;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  assert.deepEqual(Object.keys(body).sort(),['input','operation','packageIdentity']);assert.equal(body.packageIdentity,pkg.packageIdentity);operations.push(body.operation);
  let value;
  if(body.operation==='heartbeat'){
   if(ownedClient===null){ownedClient=body.input.clientId;claimDeliveries++;record.status='running';value={connected:true,run:{...record},artifact:graph.artifact,runtimeSource,workerSource};}
   else{assert.equal(body.input.clientId,ownedClient,'the same original IR client owns every renewal');value={connected:true};}
  }else if(body.operation==='submit'){
   submissions++;assert.equal(submissions,1);assert.equal(body.input.runId,runId);assert.equal(body.input.clientId,ownedClient);assert.equal(body.input.error,undefined);
   const result=body.input.result;assert.equal(result.planFingerprint,graph.artifact.planFingerprint);assert.equal(result.runtimeVersion,graph.artifact.toolchain.browserRuntime);assert.equal(result.seed,0);assert.equal(result.stopReason,expected.stop_reason);
   assert.deepEqual(Object.fromEntries(['planned_sorties','launched_sorties','completed_sorties','successful_mission_waves','cancelled_sorties','delayed_sorties','elapsed_minutes'].map(key=>[key,result.metrics[key]])),{planned_sorties:2,launched_sorties:2,completed_sorties:2,successful_mission_waves:2,cancelled_sorties:0,delayed_sorties:0,elapsed_minutes:60});
   for(const wantedEvents of [expected.selected_events,expected.same_minute_order]){let cursor=0;for(const wanted of wantedEvents){const index=result.events.findIndex((event,i)=>i>=cursor&&Object.entries(wanted).every(([key,value])=>event[key]===value));assert.ok(index>=cursor,JSON.stringify(wanted));cursor=index+1;}}
   Object.assign(record,result,{status:'succeeded',finishedAt:'2026-10-19T00:00:01.000Z'});value=record;
  }else if(body.operation==='draft')value={draft:JSON.stringify(graph.business,null,2)};
  else if(body.operation==='show')value={currentModel:{type:'ir',summary:summarize(graph.business)}};
  else if(body.operation==='records')value={records:[{runId,status:record.status,createdAt:record.createdAt}]};
  else if(body.operation==='project_ir_result'){assert.equal(body.input.runId,runId);value=record;}
  else if(body.operation==='detach')value={disconnected:true};
  else{res.writeHead(400);value={error:'unexpected-operation'};}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(value));return true;
 }});
 const p=f.page;p.on('worker',worker=>{workers.push(worker);workerCloses.push(new Promise(resolve=>worker.once('close',resolve)));});
 p.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
 p.on('response',response=>{if(response.status()>=400)httpFailures.push({url:response.url(),status:response.status()});});
 const navigation=p.waitForEvent('framenavigated',{predicate:frame=>frame.url()===f.frameUrl});
 await p.evaluate(async scope=>{
  (await import('/i18n.js')).setLocale('en',{persist:false});const {createProjectViewsPanel}=await import('/project-views.js');
  const schedule=setTimeout.bind(window),cancel=clearTimeout.bind(window),Channel=MessageChannel;
  const controls=window.crossPoll={timers:new Map(),nextTimer:-1,channels:[],packageReads:0,armed:null,pending:null,settled:0};
  window.setTimeout=(callback,ms,...args)=>{if(ms!==60000)return schedule(callback,ms,...args);const id=controls.nextTimer--;controls.timers.set(id,()=>callback(...args));return id;};
  window.clearTimeout=id=>{if(!controls.timers.delete(id))cancel(id);};
  window.MessageChannel=function(){const channel=new Channel(),entry={port:channel.port1,posts:0,closes:0};controls.channels.push(entry);const post=entry.port.postMessage.bind(entry.port),close=entry.port.close.bind(entry.port);entry.port.postMessage=(...args)=>{entry.posts++;return post(...args);};entry.port.close=()=>{entry.closes++;return close();};return channel;};
  controls.firePoll=()=>{if(controls.timers.size!==1)throw Error('expected-one-poll');const [id,callback]=controls.timers.entries().next().value;controls.timers.delete(id);callback();};
  controls.release=outcome=>{const pending=controls.pending;if(!pending)throw Error('missing-deferred-delivery');controls.pending=null;if(outcome==='reject')pending.reject(Error('synthetic-old-publish-rejection'));else pending.resolve(pending.value);};
  const api=async(path,options)=>{
   const operation=options?.body?JSON.parse(options.body).operation:null;
   const kind=path.split('?')[0].endsWith('/project-views')?(path.includes('?identity=')?'publish':'package'):operation==='project_ir_result'?'ir-result':null;
   if(kind==='package')controls.packageReads++;
   // Match the production host API wrapper: a caller's differently cased
   // content-type header must not be combined with its default JSON header.
   const response=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options?.headers}});if(!response.ok)throw Error('fixture-request-denied');const value=await response.json();
   if(kind!==null&&controls.armed===kind){controls.armed=null;try{return await new Promise((resolve,reject)=>{const pending=controls.pending={resolve,reject,value,kind,aborted:options.signal.aborted};options.signal.addEventListener('abort',()=>{pending.aborted=true;},{once:true});});}finally{controls.settled++;}}
   return value;
  };
  window.panel=createProjectViewsPanel({root:document.querySelector('#root'),api,pollMs:60000});await panel.enter(scope);
 },scope);
 const initialFrame=await navigation;await ready(p);await p.waitForFunction(()=>crossPoll.timers.size===1);
 t.diagnostic(JSON.stringify({fixture:'actual-shared-ir-report',initial,packageIdentity:pkg.packageIdentity,pluginVersion:version,workerSha256,runtimeSha256:graph.artifact.toolchain.runtimeSha256,planFingerprint:graph.artifact.planFingerprint,hostSourceSha256:hash(await readFile(new URL('../../services/web/project-views.js',import.meta.url)))}));
 return {...f,initialFrame,workers,record,counts:()=>({claimDeliveries,submissions}),async assertOneActualRun(frame){
  await frame.locator('#run-status').filter({hasText:'succeeded'}).waitFor({timeout:7000});assert.equal(await frame.locator('#draft').evaluate(node=>node.readOnly),true);
  assert.deepEqual({claimDeliveries,submissions},{claimDeliveries:1,submissions:1});assert.equal(workers.length,1);assert.equal(record.status,'succeeded');
  assert.equal(await frame.locator('#events tr').count(),record.events.length);assert.ok(record.events.length>7);await Promise.all(workerCloses);assert.equal(p.workers().length,0,'the actual finished Worker was terminated');
 },assertClean(){assert.deepEqual(f.errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(httpFailures,[]);noRemote(f);assert.equal(operations.some(op=>['project_ir_run','project_ir_compile','project_ir_check'].includes(op)),false);t.diagnostic(JSON.stringify({crossPollCompleted:{initial,nodeVersion:process.version,browserVersion:p.context().browser().version(),claimDeliveries,submissions,workerConstructions:workers.length,liveWorkers:p.workers().length,runStatus:record.status,eventCount:record.events?.length??0,fixtureOnly:true,providerOrCloudExecutions:0}}));}};
}

async function choose(f,name){
 const navigation=f.page.waitForEvent('framenavigated',{predicate:frame=>frame.url()===f.frameUrl});navigation.catch(()=>{});
 await f.page.getByRole('tab',{name,exact:true}).click();const frame=await navigation;await ready(f.page);return frame;
}
async function assertClosed(p,index){assert.deepEqual(await p.evaluate(index=>({closed:crossPoll.channels[index].port.onmessage===null,closes:crossPoll.channels[index].closes}),index),{closed:true,closes:1});}
async function finish(f){
 await f.page.evaluate(()=>panel.leave());assert.equal(await f.page.locator('iframe').count(),0);assert.equal(await f.page.evaluate(()=>crossPoll.timers.size),0);
 assert.equal(await f.page.evaluate(()=>crossPoll.channels.every(entry=>entry.port.onmessage===null)),true);f.assertClean();
}

test('late subscribed Report publish rejection cannot remove its real IR successor or repeat the B1 claim',{timeout:20000},async t=>{
 const f=await sharedFixture(t,'report'),p=f.page;await f.initialFrame.waitForFunction(()=>Boolean(window.reportSnapshot));
 await p.evaluate(()=>{crossPoll.armed='publish';crossPoll.firePoll();});await p.waitForFunction(()=>crossPoll.pending?.kind==='publish');
 const ir=await choose(f,'IR Model');await p.waitForFunction(()=>crossPoll.pending.aborted);await assertClosed(p,0);
 const oldPosts=await p.evaluate(()=>crossPoll.channels[0].posts);
 await p.evaluate(()=>crossPoll.release('reject'));await p.waitForFunction(()=>crossPoll.settled===1&&crossPoll.timers.size===1);
 assert.equal(await p.locator('iframe').count(),1);assert.equal(await p.getByRole('tab',{name:'IR Model',exact:true}).getAttribute('aria-selected'),'true');
 assert.equal(await p.getByRole('button',{name:'Retry page',exact:true}).isVisible(),false);await f.assertOneActualRun(ir);
 assert.equal(await p.evaluate(()=>crossPoll.channels[0].posts),oldPosts,'closed Report broker cannot publish a late reply');
 const reads=await p.evaluate(()=>crossPoll.packageReads);await p.evaluate(()=>crossPoll.firePoll());
 await p.waitForFunction(reads=>crossPoll.packageReads===reads+1&&crossPoll.timers.size===1,reads);
 assert.equal(await p.locator('iframe').count(),1);assert.deepEqual(f.counts(),{claimDeliveries:1,submissions:1});assert.equal(f.workers.length,1);await finish(f);
});

test('a real IR result delivery settling after Report selection is aborted on the old port and cannot replay its Worker',{timeout:20000},async t=>{
 const f=await sharedFixture(t,'ir'),p=f.page;await f.assertOneActualRun(f.initialFrame);
 await p.evaluate(()=>{crossPoll.armed='ir-result';});await projectFrame(f).locator('#refresh').click();await p.waitForFunction(()=>crossPoll.pending?.kind==='ir-result');
 const report=await choose(f,'Report');await report.waitForFunction(()=>Boolean(window.reportSnapshot));await p.waitForFunction(()=>crossPoll.pending.aborted);await assertClosed(p,0);
 const oldPosts=await p.evaluate(()=>crossPoll.channels[0].posts);
 await p.evaluate(()=>crossPoll.release('resolve'));await p.waitForFunction(()=>crossPoll.settled===1&&crossPoll.timers.size===1);
 assert.equal(await p.locator('iframe').count(),1);assert.equal(await p.getByRole('tab',{name:'Report',exact:true}).getAttribute('aria-selected'),'true');
 assert.equal(await report.getByText('Saved poll-fence Report',{exact:true}).count(),1);assert.equal(await report.locator('#run-status').count(),0);
 assert.equal(await p.getByRole('button',{name:'Retry page',exact:true}).isVisible(),false);assert.equal(await p.evaluate(()=>crossPoll.channels[0].posts),oldPosts);
 const reads=await p.evaluate(()=>crossPoll.packageReads);await p.evaluate(()=>crossPoll.firePoll());
 await p.waitForFunction(reads=>crossPoll.packageReads===reads+1&&crossPoll.timers.size===1,reads);
 assert.equal(await p.locator('iframe').count(),1);assert.deepEqual(f.counts(),{claimDeliveries:1,submissions:1});assert.equal(f.workers.length,1);await finish(f);
});
