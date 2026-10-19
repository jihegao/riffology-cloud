import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createProjectViewBroker} from '../../services/web/project-views.js';
import {packaged,scope} from './project-views-fixture.mjs';
import {projectIrFixture} from './project-ir-fixture.ts';
import {localBrowserFixture,projectFrame} from './project-view-local-fixture.mjs';

// Synthetic project and RPC authority, committed compiler B1 simpack, actual
// shared package page/Worker/runtime in a native opaque frame. Not online ACC.
test('opaque native IR page executes the actual shared frozen B1 Worker and persists that result',{timeout:25000},async t=>{
 const packageRoot=process.env.RIFFOID_IR_TEST_PACKAGE_ROOT?pathToFileURL(resolve(process.env.RIFFOID_IR_TEST_PACKAGE_ROOT)+'/'):new URL('../../vendor/riffoid-ir-plugin/',import.meta.url);
 const [runtimeSource,workerSource,appSource,appHtml,appCss,pkgSource]=await Promise.all(['browser/runtime.js','browser/worker.js','browser/app.js','browser/app.html','browser/app.css','package.json'].map(path=>readFile(new URL(path,packageRoot),'utf8')));
 const {summarize}=await import(new URL('src/project.mjs',packageRoot));
 const expected=JSON.parse(await readFile(new URL('acceptance/b1/expected.json',packageRoot),'utf8')).baseline;
 const version=JSON.parse(pkgSource).version,graph=await projectIrFixture({runtimeSource,workerSource,pluginVersion:version}),workerSha256=createHash('sha256').update(workerSource).digest('hex');
 t.diagnostic(JSON.stringify({packageRoot:packageRoot.href,pluginVersion:version,workerSha256,runtimeSha256:graph.artifact.toolchain.runtimeSha256}));
 const files={'app/views.json':JSON.stringify({schema:'project.views/v1',files:['app/ir/app.html','app/ir/app.js','app/ir/app.css'],views:[{id:'ir',title:'IR Model',entrypoint:'app/ir/app.html'}]}),'app/ir/app.html':appHtml.replace('src="http://127.0.0.1:8514/v1/bridge.js"','type="application/json"').replaceAll('/assets/','./'),'app/ir/app.js':appSource,'app/ir/app.css':appCss};
 const {pkg}=await packaged(files),requests=[],consoleErrors=[],httpFailures=[],runId='run-00000000-0000-4000-8000-000000000001';
 const record={runId,status:'pending',createdAt:new Date().toISOString(),modelRef:graph.artifact.modelRef,bundleRef:graph.artifact.bundleRef,browserArtifactRef:graph.browserArtifactRef,runtimeRef:graph.artifact.runtimeRef,workerSha256,toolchain:graph.artifact.toolchain,inputs:{seed:0},businessFingerprint:graph.artifact.businessFingerprint,planFingerprint:graph.artifact.planFingerprint,execution:{location:'user-browser',host:'riffoid',runtimeVersion:graph.artifact.toolchain.browserRuntime,verification:'local-unverified'},recordRef:`.riffoid-ir/runs/${runId}/record.json`,diagnostics:[]};
 let f,claims=0,submissions=0,ownedClient;
 f=await localBrowserFixture(t,{handler:async(req,res,url)=>{
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return true;}
  if(url.pathname.endsWith('/project-views')){res.setHeader('content-type','application/json');res.end(JSON.stringify(url.searchParams.has('identity')?{current:url.searchParams.get('identity')===pkg.packageIdentity}:{package:pkg,delivery:f.delivery}));return true;}
  if(!url.pathname.endsWith('/project-ir'))return false;
  let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push(body);
  assert.equal(req.method,'POST');assert.equal(body.packageIdentity,pkg.packageIdentity);assert.deepEqual(Object.keys(body).sort(),['input','operation','packageIdentity']);
  res.setHeader('content-type','application/json');let response;
  if(body.operation==='heartbeat'){
   if(claims++)response={connected:true};else{
    // Proves actual app module installation does not await remote calls and IR
    // request deadline is distinct from the old five-second read budget.
    ownedClient=body.input.clientId;record.status='running';await new Promise(resolve=>setTimeout(resolve,6000));
    response={connected:true,run:record,artifact:graph.artifact,runtimeSource,workerSource};
   }
  }else if(body.operation==='submit'){
   submissions++;assert.equal(body.input.runId,runId);assert.equal(body.input.clientId,ownedClient);assert.equal(body.input.error,undefined);
   const result=body.input.result;assert.equal(result.planFingerprint,graph.artifact.planFingerprint);assert.equal(result.runtimeVersion,graph.artifact.toolchain.browserRuntime);assert.equal(result.seed,0);assert.equal(result.stopReason,expected.stop_reason);
   for(const observations of [expected.selected_events,expected.same_minute_order]){let cursor=0;for(const wanted of observations){const index=result.events.findIndex((event,i)=>i>=cursor&&Object.entries(wanted).every(([key,value])=>event[key]===value));assert.ok(index>=cursor,JSON.stringify(wanted));cursor=index+1;}}
   assert.deepEqual(Object.fromEntries(['planned_sorties','launched_sorties','completed_sorties','successful_mission_waves','cancelled_sorties','delayed_sorties','elapsed_minutes'].map(key=>[key,result.metrics[key]])),{planned_sorties:2,launched_sorties:2,completed_sorties:2,successful_mission_waves:2,cancelled_sorties:0,delayed_sorties:0,elapsed_minutes:60});
   Object.assign(record,result,{status:'succeeded',finishedAt:new Date().toISOString()});response=record;
  }else if(body.operation==='draft')response={draft:JSON.stringify(graph.business,null,2)};
  else if(body.operation==='show')response={currentModel:{type:'ir',summary:summarize(graph.business)}};
  else if(body.operation==='records')response={records:[{runId:record.runId,status:record.status,createdAt:record.createdAt}]};
  else if(body.operation==='project_ir_result'){assert.equal(body.input.runId,runId);response=record;}
  else if(body.operation==='detach')response={disconnected:true};
  else{res.writeHead(400);response={error:'unexpected-operation'};}
  res.end(JSON.stringify(response));return true;
 }});
 f.page.on('console',message=>{if(message.type()==='error')consoleErrors.push({text:message.text(),location:message.location()});});
 f.page.on('response',response=>{if(response.status()>=400)httpFailures.push({url:response.url(),status:response.status(),resourceType:response.request().resourceType()});});
 // A real browser may request this before listeners attach; exercise the fixture route deterministically.
 assert.equal(await f.page.evaluate(()=>fetch('/favicon.ico').then(response=>response.status)),204);
 await f.page.evaluate(async scope=>{
  (await import('/i18n.js')).setLocale('en',{persist:false});const {createProjectViewsPanel}=await import('/project-views.js');
  const api=async(path,options)=>{const r=await fetch(path,options);if(!r.ok)throw Error('denied');return r.json();};window.panel=createProjectViewsPanel({root:document.querySelector('#root'),api,pollMs:10000});await panel.enter(scope);
 },scope);
 await f.page.getByText('Saved page · browser local / unverified',{exact:true}).waitFor({timeout:4000});
 const frame=projectFrame(f);assert.equal(await frame.locator('#draft').evaluate(node=>node.readOnly),true);
 try{await frame.locator('#run-status').filter({hasText:'succeeded'}).waitFor({timeout:12000});}catch{assert.fail(JSON.stringify({status:await frame.locator('#run-status').textContent(),diagnostics:await frame.locator('#diagnostics').textContent(),operations:requests.map(r=>r.operation),errors:f.errors,consoleErrors}));}
 t.diagnostic(JSON.stringify({runtimeStatus:record.status,submittedRunId:record.runId,httpFailures,consoleErrors}));
 assert.equal(submissions,1);assert.equal(record.status,'succeeded');assert.deepEqual(f.errors,[]);assert.deepEqual(httpFailures,[]);assert.deepEqual(consoleErrors,[]);
 assert.equal(await frame.locator('#events tr').count(),record.events.length);assert.ok(record.events.length>7);
 assert.equal(await f.page.locator('iframe').getAttribute('sandbox'),'allow-scripts');assert.equal(f.requests.some(r=>r.path.includes('project-view-sessions')),false);
 await frame.getByRole('button',{name:'2 · 编译 Plan',exact:true}).click();assert.match(await frame.locator('#diagnostics').textContent(),/请在对话中让 Pi 编译/);assert.equal(requests.some(r=>r.operation==='project_ir_compile'),false);
 const count=requests.length;assert.match(await frame.evaluate(()=>riffoid.irRequest('project_ir_run',{browserArtifactRef:'forged'}).then(()=>'',e=>e.message)),/request-denied/);assert.equal(requests.length,count);
 const tampered=await frame.evaluate(async({workerSource,runtimeSource,run,artifact})=>{
  const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),worker=new Worker(url,{type:'classic'});
  try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('tamper probe timeout')),3000);worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message||'Worker failed'));};worker.postMessage({runtimeSource:runtimeSource+'\n// changed',run,artifact});});}
  finally{worker.terminate();URL.revokeObjectURL(url);}
 },{workerSource,runtimeSource,run:record,artifact:graph.artifact});
 assert.deepEqual(tampered,{error:'Saved browser runtime checksum mismatch'});
 // Binary capture is explicit local evidence, never a default CI side effect.
 if(process.env.RIFFOID_IR_BROWSER_EVIDENCE_DIR){
  const directory=resolve(process.env.RIFFOID_IR_BROWSER_EVIDENCE_DIR);await mkdir(directory,{recursive:true});
  await frame.locator('#run-status').scrollIntoViewIfNeeded();await f.page.screenshot({path:resolve(directory,'native-shared-worker.png')});
 }
 await f.page.evaluate(()=>panel.leave());
});

test('same shared page keeps local PiWeb editing and module-Worker execution paths',{timeout:15000},async t=>{
 const packageRoot=process.env.RIFFOID_IR_TEST_PACKAGE_ROOT?pathToFileURL(resolve(process.env.RIFFOID_IR_TEST_PACKAGE_ROOT)+'/'):new URL('../../vendor/riffoid-ir-plugin/',import.meta.url);
 const [runtimeSource,workerSource,appSource,appHtml,appCss]=await Promise.all(['browser/runtime.js','browser/worker.js','browser/app.js','browser/app.html','browser/app.css'].map(path=>readFile(new URL(path,packageRoot),'utf8')));
 const {summarize}=await import(new URL('src/project.mjs',packageRoot)),graph=await projectIrFixture({runtimeSource,workerSource}),runId='run-00000000-0000-4000-8000-000000000002',operations=[];
 let record,pending=false,submissions=0;
 const f=await localBrowserFixture(t,{handler:async(req,res,url)=>{
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return true;}
  if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end(appHtml.replace('<head>','<head><script>sessionStorage.setItem("riffoid-ir-token","synthetic-local-only")</script>').replace('src="http://127.0.0.1:8514/v1/bridge.js"','type="application/json"'));return true;}
  const assets={'/assets/app.js':appSource,'/assets/app.css':appCss,'/assets/worker.js':workerSource};
  if(Object.hasOwn(assets,url.pathname)){res.setHeader('content-type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(assets[url.pathname]);return true;}
  if(url.pathname==='/runtime'){assert.equal(req.headers.authorization,'Bearer synthetic-local-only');res.setHeader('content-type','text/javascript');res.end(runtimeSource);return true;}
  if(url.pathname!=='/v1')return false;
  assert.equal(req.headers.authorization,'Bearer synthetic-local-only');let raw='';for await(const chunk of req)raw+=chunk;const {operation,input}=JSON.parse(raw);operations.push(operation);let value;
  if(operation==='draft')value={draft:JSON.stringify(graph.business,null,2)};
  else if(operation==='show')value={currentModel:{type:'ir',summary:summarize(graph.business)}};
  else if(operation==='records')value={records:record?[record]:[]};
  else if(operation==='project_ir_check')value={status:'passed',diagnostics:[],sealedRef:graph.artifact.modelRef};
  else if(operation==='project_ir_compile')value={status:'succeeded',diagnostics:[],browserArtifactRef:graph.browserArtifactRef};
  else if(operation==='project_ir_run'){
   assert.equal(input.browserArtifactRef,graph.browserArtifactRef);pending=true;
   record={runId,status:'pending',createdAt:new Date().toISOString(),modelRef:graph.artifact.modelRef,bundleRef:graph.artifact.bundleRef,browserArtifactRef:graph.browserArtifactRef,runtimeRef:graph.artifact.runtimeRef,toolchain:graph.artifact.toolchain,inputs:{seed:0},planFingerprint:graph.artifact.planFingerprint,diagnostics:[],execution:{location:'user-browser',host:'pi-web'},recordRef:'synthetic-local/record.json'};value={accepted:true,runId,status:'pending',diagnostics:[]};
  }else if(operation==='heartbeat'){
   if(pending){pending=false;record.status='running';record.clientId=input.clientId;value={connected:true,run:record,artifact:graph.artifact};}else value={connected:true};
  }else if(operation==='submit'){
   submissions++;assert.equal(input.runId,runId);assert.equal(input.clientId,record.clientId);assert.equal(input.error,undefined);assert.equal(input.result.metrics.launched_sorties,2);assert.equal(input.result.planFingerprint,graph.artifact.planFingerprint);Object.assign(record,input.result,{status:'succeeded'});value=record;
  }else if(operation==='detach')value={disconnected:true};else{res.writeHead(400);value={error:'unexpected-operation'};}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(value));return true;
 }});
 await f.page.getByText('● 浏览器执行器已连接',{exact:true}).waitFor();assert.equal(await f.page.locator('#draft').evaluate(node=>node.readOnly),false);
 await f.page.getByRole('button',{name:'1 · 封存并检查',exact:true}).click();await f.page.getByRole('button',{name:'2 · 编译 Plan',exact:true}).click();await f.page.getByRole('button',{name:'3 · 浏览器运行',exact:true}).click();
 await f.page.locator('#run-status').filter({hasText:'succeeded'}).waitFor({timeout:7000});
 assert.equal(submissions,1);assert.deepEqual(f.errors,[]);assert.ok(operations.includes('project_ir_check'));assert.ok(operations.includes('project_ir_compile'));assert.ok(operations.includes('project_ir_run'));assert.equal(operations.includes('project_ir_result'),false,'local records remain the complete original projection');
});

function brokerFixture(pkg,{request=async()=>({ready:true}),authorize=async()=>{}}={}){
 const messages=[],states=[];let current=true,broker;
 const port={onmessage:null,postMessage:value=>messages.push(value),close(){},start(){}};
 broker=createProjectViewBroker({port,pkg,isCurrent:()=>current,irRequest:request,authorize,onState:state=>{states.push(state);if(state==='failed')broker.close();}});
 return {broker,messages,states,send:data=>port.onmessage({data}),leave(){current=false;broker.close();}};
}
test('IR broker rejects forged envelope fields and writes, and enforces separate finite input/output budgets',async()=>{
 const {pkg}=await packaged(),calls=[],f=brokerFixture(pkg,{request:async(operation,input)=>{calls.push({operation,input});return operation==='records'?{records:[],padding:'r'.repeat(70*1024)}:{padding:'r'.repeat(513*1024)};}});
 try{
  let id=0;
  for(const extra of [{operation:'project_ir_compile',input:{}},{operation:'show',input:[]},{operation:'show',input:{},scope:{tenantId:'foreign'}}]){
   await f.send({id:++id,type:'ir.request',...extra});assert.equal(f.messages.at(-1).error,'request-denied');
  }
  assert.equal(calls.length,0);
  await f.send({id:++id,type:'ir.request',operation:'submit',input:{result:{data:'s'.repeat(257*1024)}}});assert.equal(f.messages.at(-1).error,'request-too-large');assert.equal(calls.length,0);
  await f.send({id:++id,type:'ir.request',operation:'records',input:{}});assert.equal(f.messages.at(-1).value.padding.length,70*1024,'IR allows its bounded larger response');
  await f.send({id:++id,type:'ir.request',operation:'show',input:{}});assert.equal(f.messages.at(-1).error,'response-too-large');
  await f.send({id:++id,type:'artifacts.list',cursor:null});assert.deepEqual(f.messages.at(-1).value,{items:[],nextCursor:null,version:null});
 }finally{f.broker.close();}
});

test('IR in-flight result cannot cross a replaced frame generation or revoked package authority',async()=>{
 const {pkg}=await packaged();
 for(const mode of ['generation','authority']){
  let release,entered,checks=0;const started=new Promise(resolve=>{entered=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
  const f=brokerFixture(pkg,{request:async()=>{entered();await blocked;return {marker:'OLD_SCOPE_ONLY'};},authorize:async()=>{if(mode==='authority'&&++checks>1)throw Error('revoked');}});
  const pending=f.send({id:1,type:'ir.request',operation:'heartbeat',input:{clientId:'00000000-0000-4000-8000-000000000001'}});await started;
  if(mode==='generation')f.leave();release();await pending;
  assert.equal(f.messages.some(m=>m.value?.marker==='OLD_SCOPE_ONLY'),false);assert.equal(f.broker.closed,true);
  if(mode==='authority')assert.deepEqual(f.states,['failed']);
 }
});

test('IR broker preserves explicit host input and output limit failures without exposing other backend errors',async()=>{
 const {pkg}=await packaged();let code='project-ir-response-too-large';
 const f=brokerFixture(pkg,{request:async()=>{throw Object.assign(Error('private backend detail'),{code});}});
 try{
  for(const [id,nextCode,expected]of [[1,'project-ir-response-too-large','response-too-large'],[2,'project-ir-request-too-large','request-too-large'],[3,'body_too_large','request-too-large'],[4,'private-storage-key','request-denied']]){
   code=nextCode;await f.send({id,type:'ir.request',operation:'records',input:{}});assert.deepEqual(f.messages.at(-1),{id,error:expected});
  }
 }finally{f.broker.close();}
});
