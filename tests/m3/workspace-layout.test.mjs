import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const origin='https://workspace.test',previewOrigin='https://p-'+ 'a'.repeat(40)+'.preview.test';
const names=['index.html','app.js','project-status.js','browser-preview.js','layout.js','export.js','publication.js','evidence.js','evidence.css','services.js','previews.js','simulation.js','comparison.js','styles.css','workspace.css'];
const files=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(new URL('../../services/web/'+name,import.meta.url),'utf8')])));
test('closed project admission explains the restriction instead of asking for a refresh',async t=>{
 const f=await fixture(t,{projectFlow:true}),p=f.page;
 await p.route('**/api/tenants/t/projects',route=>route.request().method()==='POST'
  ?route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'g5_admission_disabled'})})
  :route.fallback());
 await p.locator('#new-project').click();await p.locator('#project-title').fill('Admission diagnostic');await p.locator('#project-submit').click();
 await p.waitForFunction(()=>document.querySelector('#project-error').textContent.includes('当前环境已暂停创建项目'));
 assert.doesNotMatch(await p.locator('#project-error').innerText(),/状态已变化|刷新后重试/);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
const screenshotDir=process.env.WORKSPACE_LAYOUT_EVIDENCE_DIR?pathToFileURL(resolve(process.env.WORKSPACE_LAYOUT_EVIDENCE_DIR)+'/'):new URL('../../.local/workspace-layout-screenshots/',import.meta.url);
async function fixture(t,{mismatched=false,unavailableLayoutStorage=false,activePolling=false,pagedServices=false,projectFlow=false,longTitle=false,legacyLayout=null,deferAuthentication=false,authenticationStatus=200,messageRecovery=null}={}){
 const browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||'chrome'});t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:1600,height:900}});t.after(()=>context.close());if(unavailableLayoutStorage)await context.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage disabled','SecurityError');}}));if(legacyLayout)await context.addInitScript(value=>localStorage.setItem('riffology:workspace-layout:t:w',JSON.stringify(value)),legacyLayout);const page=await context.newPage(),errors=[],calls=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 if(messageRecovery)await context.addInitScript(value=>sessionStorage.setItem('riffology:conversation:t:w',JSON.stringify({schemaVersion:1,selectedSessionId:'s',draft:value.message,messageIntent:{key:value.key,sessionId:'s',message:value.message},sessionIntent:null})),messageRecovery);
 let projectStatus=projectFlow?'absent':'ready',projectListError=false,releaseAuthentication,createdConversation=false;const authenticationGate=deferAuthentication?new Promise(resolve=>{releaseAuthentication=resolve;}):null;await page.addInitScript(()=>{const now=Date.now;window.layoutClockOffset=0;Date.now=()=>now()+window.layoutClockOffset;});let revision='revision-a',failedPreview=false,holdFilter=null,held=[];
 let releaseReceipt;const receiptGate=messageRecovery?.defer?new Promise(resolve=>{releaseReceipt=resolve;}):null;
 const delayed=async(route,path,value)=>{const frozen=structuredClone(value);if(holdFilter?.(path,route.request().method()))await new Promise(resolve=>held.push(resolve));return json(route,frozen);};const sha=()=>revision==='revision-a'?'a'.repeat(64):'b'.repeat(64),version=()=>({revisionId:revision,filesSha256:sha(),specSha256:'c'.repeat(64)});
 const service=(id,rev)=>({runId:id,deliveryStatus:'delivered',runStatus:'running',stopRequestedAt:null,updatedAt:1,version:{revisionId:rev,filesSha256:rev==='revision-a'?'a'.repeat(64):'b'.repeat(64)}});
 let services=mismatched?[service('run-b','revision-b'),service('run-a','revision-a')]:[service('run-a','revision-a')];
 let current={previewId:'preview-a',runId:'run-a',expiresAt:Date.now()+3600000,revokedAt:null},available={...current,bootstrapUrl:previewOrigin+'/__riff/bootstrap'};
 let experiments=[{experimentId:'single-a',runId:'single-a',status:'completed',createdAt:1,updatedAt:1,version:version(),parameters:{servers:1},seed:42,result:{metrics:{wait:4.2},artifactSha256:'d'.repeat(64)},stale:false}];
 let group={groupId:'group-a',status:'running',version:version(),seeds:[1],configurations:[{configurationId:'base',role:'baseline',label:'Base',parameters:{servers:1}}],metrics:{wait:{unit:'min'}},progress:{total:1,pending:0,active:1,completed:0,failed:0,cancelled:0},runs:[{runId:'group-run-a',configurationId:'base',seed:1,status:'running'}],summary:[{configurationId:'base',metrics:{wait:{count:1,missing:0,mean:99,baselineMean:99,delta:0}}}]};
 if(activePolling)experiments[0].status='running';
 const model=()=>({version:version(),canRun:true,reasonCode:null,spec:{schemaVersion:1,researchQuestion:'增加服务台能否缩短顾客等待？',scope:'有限时段内的排队教学模型',entities:['顾客','服务台'],mechanisms:['先到先服务'],assumptions:['顾客到达相互独立'],limitations:['不包含放弃排队'],parameters:{servers:{type:'integer',default:revision==='revision-a'?1:3,minimum:1,maximum:4}},metrics:{wait:{unit:'分钟',description:'平均等待时间'}},execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}}});
 const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;if(url.origin===previewOrigin)return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh"><meta charset="utf-8"><body style="font:16px sans-serif;background:#f0f8f4;color:#254e3f;padding:28px"><small>LOCAL UI FIXTURE · ${current.runId}</small><h1>排队模型</h1><p>这是浏览器验收使用的受控页面，不是云端仿真证据。</p><div style="display:flex;gap:12px;margin-top:35px"><div style="height:100px;width:24%;background:#89b99e"></div><div style="height:70px;width:24%;background:#bedacb"></div><div style="height:40px;width:24%;background:#dcebe2"></div></div><script>parent.postMessage({type:'riffology-preview-ready',nonce:'${'a'.repeat(64)}'},'${origin}')</script></body></html>`});
  assert.equal(url.origin,origin);if(!path.startsWith('/api/')){const name=path==='/'?'index.html':path.slice(1);return route.fulfill({status:files[name]?200:404,contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html',body:files[name]||''});}
  calls.push({path,method:req.method(),body:req.postData(),key:req.headers()['idempotency-key']});
if(path==='/api/me'){if(authenticationGate)await authenticationGate;if(authenticationStatus!==200)return json(route,{error:'authentication_required'},authenticationStatus);return json(route,{execution:{service:true,preview:true,simulation:true},tenants:[{id:'t'}]});}if(path==='/api/models')return json(route,{models:[]});if(path==='/api/tenants/t/projects'){const project={id:'p',title:longTitle?'很长的项目标题'.repeat(17):'排队与服务能力研究',status:projectStatus,workspace_id:'w'};if(req.method()==='POST'){projectStatus='provisioning';return json(route,{project:{...project,status:projectStatus}},202);}if(projectListError)return json(route,{error:'unrelated-list-error'},503);return json(route,{projects:projectStatus==='absent'?[]:[project]});}
  if(path==='/api/workspaces/w')return json(route,{schemaVersion:3,activeTurnId:null,resourceWait:null,releaseHold:null,recoveryHold:null,sessions:{s:{id:'s',title:'排队研究',createdAt:1,...(messageRecovery?.stale?{canContinue:false}:{})},...(createdConversation?{s2:{id:'s2',title:'Session 2',createdAt:2,canContinue:true}}:{})},turns:{t:{id:'t',sessionId:'s',message:'建立一个排队模型，比较增加服务台后的等待时间。',status:'completed',saveStatus:'saved',createdAt:1}}});
  if(path==='/api/workspaces/w/sessions'&&req.method()==='POST'){createdConversation=true;return json(route,{session:{id:'s2',title:'Session 2',createdAt:2,canContinue:true}},201);}
  if(path==='/api/workspaces/w/sessions/s/turns/receipt'){if(receiptGate)await receiptGate;if(messageRecovery?.receipt==='accepted')return json(route,{accepted:true,turn:{id:'recovered-turn',sessionId:'s',message:messageRecovery.message,status:'completed',persistenceOutcome:'saved',createdAt:2}});if(messageRecovery?.receipt==='error')return json(route,{error:'temporarily_unavailable'},503);return json(route,{error:'not_found'},404);}
  if(path==='/api/workspaces/w/browser-preview'&&req.method()==='GET')return json(route,{currentRevisionId:null,revisionId:null,build:null,stale:false,modelSpec:null,reasonCode:'preview-no-saved-revision',delivery:null});
  if(path==='/api/workspaces/w/events')return json(route,{events:[{sequence:1,turnId:'t',type:'assistant.message',payload:{text:'模型已经保存。可以先查看假设，再修改服务台数量，比较不同种子下的结果。'}}],nextSequence:2,hasMore:false,snapshotRequired:false});
  if(path==='/api/workspaces/w/model')return delayed(route,path,model());if(path==='/api/workspaces/w/files')return delayed(route,path,{revision:{...version(),committedAt:1},files:[{path:'model/run.py',kind:'file',size:1024},{path:'model/model-spec.json',kind:'file',size:512}]});if(path==='/api/workspaces/w/diff')return delayed(route,path,{revision:version(),summary:{added:0,modified:1,deleted:0},changes:[{path:revision+'-changed.py',change:'modified',type:'file',size:1}]});
  if(path==='/api/workspaces/w/evidence')return json(route,{items:[],nextCursor:null});
  if(path==='/api/workspaces/w/experiment-groups/group-a')return delayed(route,path,group);
  if(path==='/api/workspaces/w/experiment-groups')return json(route,{items:activePolling?[group]:[],nextCursor:null});
  if(path==='/api/workspaces/w/experiments'){if(req.method()==='POST'){const body=JSON.parse(req.postData());experiments=[{...experiments[0],experimentId:'single-new',runId:'single-new',parameters:body.parameters,seed:body.seed,version:version(),result:{metrics:{wait:2.1},artifactSha256:'e'.repeat(64)}}];return json(route,experiments[0],202);}return delayed(route,path,{items:experiments,nextCursor:null});}
  if(path==='/api/workspaces/w/services'){if(req.method()==='POST'){const next=service('run-b',revision);services=[next,...services.filter(s=>s.runId!=='run-b')];return json(route,next,202);}return json(route,{items:pagedServices&&url.searchParams.has('before_run_id')?[service('run-c','revision-a')]:services,nextCursor:pagedServices&&!url.searchParams.has('before_run_id')?{createdAt:1,runId:'older'}:null});}
  const sr=/\/services\/(run-[ab])(\/stop)?$/.exec(path);if(sr){const target=services.find(s=>s.runId===sr[1]);if(sr[2]){target.runStatus='stopped';target.stopRequestedAt=Date.now();if(current?.runId===target.runId){current.revokedAt=Date.now();available=null;}}return json(route,target);}
  if(path==='/api/workspaces/w/previews'){if(failedPreview){failedPreview=false;return json(route,{error:'preview-unavailable'},503);}if(req.method()==='POST'){const body=JSON.parse(req.postData());current={previewId:'preview-'+body.runId,runId:body.runId,expiresAt:Date.now()+3600000,revokedAt:null};available={...current,bootstrapUrl:previewOrigin+'/__riff/bootstrap'};return delayed(route,path,available);}return delayed(route,path,{current,available});}
  if(path.endsWith('/tickets'))return json(route,{ticket:'f'.repeat(64),expiresAt:Date.now()+10000});throw Error('unexpected API '+path);
 });
 await page.goto(origin+(projectFlow?'/':'/#/workspace/p'));if(deferAuthentication||authenticationStatus!==200)return {page,calls,releaseAuthentication(){releaseAuthentication?.();}};if(projectFlow){await page.locator('#new-project').waitFor();return {page,calls,setStatus(value){projectStatus=value;},failList(value){projectListError=value;},async refresh(){await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));},async expire(){await page.evaluate(()=>window.layoutClockOffset=310000);}};}await page.locator('#message-input:not([disabled])').waitFor();await page.locator('#workspace-preview iframe').waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('#workspace-comparison button')?.disabled===false&&document.querySelector('.simulation-form button[type=submit]')?.disabled===false);
 return {page,calls,releaseReceipt(){releaseReceipt?.();},dropPreview(){current=null;available=null;},holdReads(filter){holdFilter=filter;return {count:()=>held.length,allowNew(){holdFilter=null;},release(){holdFilter=null;for(const resolve of held)resolve();held=[];}};},rejectResults(){experiments[0]={...experiments[0],status:'completed',evidenceRejection:{reason:'Rejected newest result'}};group={...group,status:'completed',progress:{...group.progress,active:0,completed:1,rejected:1},runs:[{...group.runs[0],status:'completed',evidenceRejection:{reason:'Rejected newest result'}}],summary:[{configurationId:'base',metrics:{wait:{count:0,missing:1,mean:null,baselineMean:null,delta:null}}}]};},setRevision(value){revision=value;},failPreview(){failedPreview=true;},services:()=>services,async shot(name){await mkdir(screenshotDir,{recursive:true});await page.screenshot({path:new URL(name+'.png',screenshotDir).pathname,fullPage:true});}};
}

test('authentication bootstrap stays neutral until authoritative /api/me resolves and restores a deep link',async t=>{
 const f=await fixture(t,{deferAuthentication:true}),p=f.page;
 assert.equal(await p.locator('#login').isVisible(),false);
 assert.deepEqual(f.calls.map(call=>call.path),['/api/me']);
 f.releaseAuthentication();
 await p.locator('#message-input:not([disabled])').waitFor();
 assert.equal(await p.locator('#workspace').isVisible(),true);
 assert.equal(await p.locator('#login').isVisible(),false);
 assert.equal(f.calls.some(call=>call.path==='/api/auth/get-session'),false);
});

test('an authoritative 401 exposes the login entry instead of a Workspace deep link',async t=>{
 const f=await fixture(t,{authenticationStatus:401}),p=f.page;
 await p.locator('#login').waitFor({state:'visible'});
 assert.equal(await p.locator('#workspace').isVisible(),false);
 assert.equal(await p.locator('#google').isVisible(),true);
 assert.deepEqual(f.calls.map(call=>call.path),['/api/me']);
});

test('authenticated invitation state and transient bootstrap failures do not impersonate sign-out',async t=>{
 const invited=await fixture(t,{authenticationStatus:404}),invitedPage=invited.page;
 await invitedPage.locator('#invitation').waitFor({state:'visible'});
 assert.equal(await invitedPage.locator('#login').isVisible(),false);
 const unavailable=await fixture(t,{authenticationStatus:503}),unavailablePage=unavailable.page;
 await unavailablePage.locator('#notice').waitFor({state:'visible'});
 assert.equal(await unavailablePage.locator('#login').isVisible(),false);
 assert.equal(await unavailablePage.locator('#app').isVisible(),false);
 assert.equal(await unavailablePage.locator('#workspace').isVisible(),false);
 assert.match(await unavailablePage.locator('#notice').innerText(),/服务暂不可用/);
});

test('lost submit reply is reconciled by an exact read-only receipt without a duplicate Turn POST',async t=>{
 const message='研究假设也是可以改的页面吗',f=await fixture(t,{messageRecovery:{key:'lost-reply-key',message,receipt:'accepted'}}),p=f.page;
 await p.getByText('上次请求已由服务端接收，编辑框已恢复。',{exact:true}).waitFor();assert.equal(await p.locator('#message-input').isEditable(),true);assert.equal(await p.locator('#message-input').inputValue(),'');assert.equal(await p.locator('#message-submit').innerText(),'发送');
 assert.equal(f.calls.filter(call=>call.path.endsWith('/turns/receipt')&&call.method==='GET'&&call.key==='lost-reply-key').length,1);assert.equal(f.calls.filter(call=>call.path.endsWith('/turns')&&call.method==='POST').length,0);assert.equal(await p.evaluate(()=>JSON.parse(sessionStorage.getItem('riffology:conversation:t:w')).messageIntent),null);
});

test('receipt loading never flashes Send, and an absent receipt keeps the frozen explicit retry',async t=>{
 const message='保留未确认请求',accepted=await fixture(t,{messageRecovery:{key:'pending-key',message,receipt:'accepted',defer:true}}),acceptedPage=accepted.page;
 await acceptedPage.getByRole('button',{name:'正在确认上次请求…',exact:true}).waitFor();assert.equal(await acceptedPage.locator('#message-input').isEditable(),false);accepted.releaseReceipt();await acceptedPage.getByRole('button',{name:'发送',exact:true}).waitFor();assert.equal(accepted.calls.filter(call=>call.path.endsWith('/turns')&&call.method==='POST').length,0);
 const missing=await fixture(t,{messageRecovery:{key:'missing-key',message,receipt:'missing'}}),missingPage=missing.page;await missingPage.getByRole('button',{name:'重试上次请求',exact:true}).waitFor();assert.equal(await missingPage.locator('#message-input').isEditable(),false);await missingPage.locator('#message-input').focus();await missingPage.keyboard.press('Backspace');assert.equal(await missingPage.locator('#message-input').inputValue(),message);assert.equal(missing.calls.filter(call=>call.path.endsWith('/turns')&&call.method==='POST').length,0);
});

test('a revoked-version pending intent migrates explicitly to a new conversation without a Turn retry',async t=>{
 const message='按 SysML 输出可视化图',f=await fixture(t,{messageRecovery:{key:'stale-key',message,receipt:'missing',stale:true}}),p=f.page;
 const migrate=p.getByRole('button',{name:'转到新对话',exact:true});await migrate.waitFor();assert.equal(await migrate.isEnabled(),true);assert.equal(await p.locator('#message-input').isEditable(),false);assert.equal(f.calls.filter(call=>call.path.endsWith('/turns/receipt')).length,0);assert.equal(f.calls.filter(call=>call.path.endsWith('/turns')&&call.method==='POST').length,0);
 await migrate.click();await p.waitForFunction(()=>document.querySelector('#session-select').value==='s2');assert.equal(await p.locator('#message-input').inputValue(),message);assert.equal(await p.locator('#message-input').isEditable(),true);assert.equal(f.calls.filter(call=>call.path==='/api/workspaces/w/sessions'&&call.method==='POST').length,1);assert.equal(f.calls.filter(call=>call.path.endsWith('/turns')&&call.method==='POST').length,0);assert.equal(await p.evaluate(()=>JSON.parse(sessionStorage.getItem('riffology:conversation:t:w')).messageIntent),null);
});

test('actual Workspace keeps resizable accessible split, presentation preferences and same saved state across responsive reopen',async t=>{
 const f=await fixture(t,{longTitle:true}),p=f.page;await p.locator('.simulation-form input[name=servers]').waitFor();let bounds=await p.locator('.workspace-grid').boundingBox(),agent=await p.locator('#workspace-agent').boundingBox();assert.ok(Math.abs(agent.width/bounds.width-.35)<.03);assert.equal(await p.locator('#canvas-preview').isVisible(),true);assert.equal(await p.locator('.files-panel').isVisible(),false);assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.path.endsWith('/tickets')).length,0);assert.equal(await p.locator('[data-workspace-depth]').count(),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await f.shot('desktop-explore');
 const divider=p.locator('[data-workspace-divider]');await divider.focus();await p.keyboard.press('ArrowRight');assert.equal(await divider.getAttribute('aria-valuenow'),'37');const d=await divider.boundingBox();await p.mouse.move(d.x+5,d.y+30);await p.mouse.down();await p.mouse.move(bounds.x+bounds.width*.43,d.y+30);await p.mouse.up();assert.equal(await divider.getAttribute('aria-valuenow'),'43');
 await p.getByRole('tab',{name:'Model',exact:true}).click();await p.locator('#workspace-model h2').waitFor();assert.match(await p.locator('#workspace-model').innerText(),/先到先服务/);assert.equal(await p.locator('#workspace-export').isVisible(),true);assert.equal(await p.locator('#canvas-model #workspace-publication').isVisible(),true);assert.match(await p.locator('#workspace-publication').innerText(),/完整研究历史供管理员审核/);await f.shot('desktop-model');await p.reload();await p.locator('#workspace-model h2').waitFor();assert.equal(await divider.getAttribute('aria-valuenow'),'43');assert.equal(await p.locator('#canvas-model').isVisible(),true);
 await p.getByRole('tab',{name:'Runs',exact:true}).click();await p.locator('.comparison-form').waitFor();assert.equal(await p.locator('#canvas-runs').isVisible(),true);assert.equal(await p.locator('#workspace-evidence').isVisible(),true);assert.match(await p.locator('#workspace-run-history').innerText(),/single-a/);await f.shot('desktop-experiment');
 await p.getByRole('tab',{name:'Inspect',exact:true}).click();await p.locator('#files-tab').waitFor();await p.locator('#diff-tab').click();await p.waitForFunction(()=>document.querySelector('#diff-meta').textContent.includes('修改 1'));await p.locator('#workspace-runtime-details summary').first().click();assert.match(await p.locator('#workspace-runtime-details').innerText(),/revision-a/);await f.shot('desktop-inspect');
 await p.setViewportSize({width:1000,height:850});await p.getByRole('tab',{name:'Preview',exact:true}).click();agent=await p.locator('#workspace-agent').boundingBox();const canvas=await p.locator('#workspace-canvas').boundingBox();assert.ok(agent.width>=239&&canvas.width>=320);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await f.shot('tablet-split');
 await p.setViewportSize({width:390,height:844});await p.getByRole('button',{name:'Chat · 对话',exact:true}).click();assert.equal(await p.locator('#workspace-agent').isVisible(),true);assert.equal(await p.locator('#workspace-canvas').isVisible(),false);await f.shot('mobile-chat');await p.getByRole('button',{name:'Preview · 模型',exact:true}).click();assert.equal(await p.locator('#workspace-agent').isVisible(),false);await f.shot('mobile-preview');for(const view of ['model','runs','inspect']){await p.locator(`[data-workspace-tab=${view}]`).click();assert.equal(await p.locator(`#canvas-${view}`).isVisible(),true);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await f.shot('mobile-'+view);}assert.equal(await p.locator('#workspace-runtime-details').isVisible(),true);await p.getByRole('tab',{name:'Preview',exact:true}).click();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.reload();await p.locator('#workspace-canvas').waitFor();assert.equal(await p.locator('#workspace-agent').isVisible(),false);
 assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.path.endsWith('/tickets')).length,0);assert.equal(f.calls.filter(c=>c.path.endsWith('/research-export')).length,0);
});

test('current frame binds labels and Stop to its actual service, explicit new model run rebinds, stopped results survive reopen',async t=>{
 const f=await fixture(t,{mismatched:true}),p=f.page;await p.waitForFunction(()=>document.querySelector('#workspace-services').textContent.includes('revision-a'));assert.doesNotMatch(await p.locator('#workspace-services').innerText(),/模型版本：revision-b/);
 f.setRevision('revision-b');await p.getByRole('button',{name:'刷新模型与实验',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#workspace-model-status').dataset.state==='old');assert.match(await p.locator('#workspace-model-status').innerText(),/revision-a.*revision-b/);await f.shot('old-preview-new-model');
 await p.locator('.simulation-form input[name=servers]').fill('2');await p.locator('.simulation-form button[type=submit]').click();await p.waitForFunction(()=>document.querySelector('.latest-result').textContent.includes('2.1'));assert.equal(f.calls.filter(c=>/\/turns/.test(c.path)&&c.method==='POST').length,0);
 await p.getByRole('button',{name:'运行已保存模型',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#workspace-preview iframe')&&document.querySelector('#workspace-services').textContent.includes('revision-b'));assert.equal(f.calls.filter(c=>c.path.endsWith('/services')&&c.method==='POST').length,1);const bind=f.calls.filter(c=>c.path.endsWith('/previews')&&c.method==='POST').at(-1);assert.equal(JSON.parse(bind.body).runId,'run-b');await f.shot('new-model-preview');
 await p.locator('#workspace-services [data-service-action=stop]').click();await p.waitForFunction(()=>!document.querySelector('#workspace-preview iframe'));assert.equal(f.calls.filter(c=>c.path.endsWith('/services/run-b/stop')).length,1);assert.equal(f.calls.filter(c=>c.path.endsWith('/services/run-a/stop')).length,0);await p.reload();await p.locator('.latest-result').waitFor();assert.match(await p.locator('.latest-result').innerText(),/2.1/);assert.equal(await p.locator('#workspace-preview iframe').count(),0);await p.waitForFunction(()=>document.querySelector('#workspace-model-status').dataset.state==='stopped');assert.equal(f.calls.filter(c=>c.path.endsWith('/services')&&c.method==='POST').length,1);
});

test('closing Preview remains closed on refresh and recover remains an explicit working action',async t=>{
 const f=await fixture(t),p=f.page;await p.getByRole('button',{name:'关闭预览',exact:true}).click();assert.equal(await p.locator('#workspace-preview iframe').count(),0);await p.getByRole('button',{name:'刷新预览状态',exact:true}).click();assert.equal(await p.locator('#workspace-preview iframe').count(),0);await p.reload();await p.locator('#workspace-preview [data-preview-action=recover]').waitFor();assert.equal(await p.locator('#workspace-preview iframe').count(),0);await p.getByRole('button',{name:'恢复预览',exact:true}).click();await p.locator('#workspace-preview iframe').waitFor();await p.waitForFunction(()=>document.querySelector('#workspace-preview').textContent.includes('模型预览已连接'));assert.equal(f.calls.filter(c=>c.path.endsWith('/services')&&c.method==='POST').length,0);
 f.failPreview();await p.locator('#workspace-preview summary').click();await p.getByRole('button',{name:'刷新预览状态',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#workspace-preview').textContent.includes('读取预览失败'));await p.getByRole('button',{name:'刷新预览状态',exact:true}).click();await p.locator('#workspace-preview iframe').waitFor();assert.equal(f.calls.filter(c=>c.path.endsWith('/services')&&c.method==='POST').length,0);
});

test('blocked localStorage getter keeps Workspace and layout interactions usable without persistence',async t=>{
 const f=await fixture(t,{unavailableLayoutStorage:true}),p=f.page;await p.locator('#workspace-agent').waitFor();await p.getByRole('tab',{name:'Model',exact:true}).click();assert.equal(await p.locator('#workspace-model').isVisible(),true);const divider=p.locator('[data-workspace-divider]');await divider.focus();await p.keyboard.press('ArrowRight');assert.equal(await divider.getAttribute('aria-valuenow'),'37');await p.reload();await p.locator('#workspace-preview iframe').waitFor();assert.equal(await divider.getAttribute('aria-valuenow'),'35');assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.path.endsWith('/tickets')).length,0);
});

test('late same-workspace model reads cannot overwrite a newer saved version or swallow its reload',{timeout:15000},async t=>{
 const f=await fixture(t),p=f.page,hold=f.holdReads(path=>path.endsWith('/model'));
 await p.getByRole('button',{name:'刷新模型与实验',exact:true}).click();await p.getByRole('tab',{name:'Runs',exact:true}).click();await p.getByRole('button',{name:'刷新比较与模型',exact:true}).click();await waitHeld(hold,2);
 hold.allowNew();f.setRevision('revision-b');await p.getByRole('tab',{name:'Inspect',exact:true}).click();await p.locator('#files-refresh').click();await p.waitForFunction(()=>document.querySelector('#workspace-model-status').textContent.includes('新版本 revision-b'));
 hold.release();await p.getByRole('tab',{name:'Preview',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.simulation-form input[name=servers]').value==='3');assert.match(await p.locator('#workspace-model-status').innerText(),/revision-a.*revision-b/);await p.getByRole('tab',{name:'Runs',exact:true}).click();assert.equal(await p.locator('[data-configuration=baseline] input[type=number]').first().inputValue(),'3');assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.path.endsWith('/tickets')).length,0);
});
test('late simulation and comparison polls cannot undo a newer rejection-aware reload',{timeout:15000},async t=>{
 const f=await fixture(t,{activePolling:true}),p=f.page,hold=f.holdReads(path=>path.endsWith('/experiments')||path.endsWith('/experiment-groups/group-a'));await waitHeld(hold,2);
 hold.allowNew();f.rejectResults();await p.getByRole('button',{name:'刷新模型与实验',exact:true}).click();await p.getByRole('tab',{name:'Runs',exact:true}).click();await p.getByRole('button',{name:'刷新比较与模型',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#workspace-run-history').textContent.includes('Rejected newest result')&&document.querySelector('#workspace-comparison').textContent.includes('已否定'));
 hold.release();await p.waitForTimeout(100);assert.match(await p.locator('#workspace-run-history').innerText(),/Rejected newest result/);assert.doesNotMatch(await p.locator('#workspace-comparison').innerText(),/99/);assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.path.endsWith('/tickets')).length,0);
});

test('a Preview read started before Stop cannot reopen the stopped iframe', {timeout:15000},async t=>{
 const f=await fixture(t),p=f.page,hold=f.holdReads(path=>path.endsWith('/previews'));
 await p.locator('#workspace-preview summary').click();await p.getByRole('button',{name:'刷新预览状态',exact:true}).click();await waitHeld(hold,1);
 await p.locator('#workspace-services [data-service-action=stop]').click();await p.waitForFunction(()=>!document.querySelector('#workspace-preview iframe'));hold.release();await p.waitForTimeout(100);assert.equal(await p.locator('#workspace-preview iframe').count(),0);assert.match(await p.locator('#workspace-model-status').innerText(),/已结束|正在停止/);await p.getByRole('button',{name:'刷新预览状态',exact:true}).click();assert.equal(await p.locator('#workspace-preview iframe').count(),0);
});
test('a poll started before submission cannot remove the newly accepted Run', {timeout:15000},async t=>{
 const f=await fixture(t,{activePolling:true}),p=f.page,hold=f.holdReads(path=>path.endsWith('/experiments'));await waitHeld(hold,1);hold.allowNew();
 await p.locator('.simulation-form input[name=servers]').fill('2');await p.locator('.simulation-form button[type=submit]').click();await p.waitForFunction(()=>document.querySelector('#workspace-run-history').textContent.includes('single-new'));hold.release();await p.waitForTimeout(100);assert.match(await p.locator('#workspace-run-history').textContent(),/single-new/);assert.equal(f.calls.filter(c=>c.path.endsWith('/experiments')&&c.method==='POST').length,1);
});

test('new Files and Diff reads keep their head after older responses arrive', {timeout:15000},async t=>{
 const f=await fixture(t),p=f.page;await p.getByRole('tab',{name:'Inspect',exact:true}).click();const hold=f.holdReads(path=>path.endsWith('/files')||path.endsWith('/diff'));
 await p.locator('#files-refresh').click();await p.locator('#diff-tab').click();await waitHeld(hold,2);hold.allowNew();f.setRevision('revision-b');await p.locator('#files-tab').click();await p.locator('#files-refresh').click();await p.waitForFunction(()=>document.querySelector('#files-meta').textContent.includes('revision-b'));await p.locator('#diff-tab').click();await p.waitForFunction(()=>document.querySelector('#workspace-diff').textContent.includes('revision-b-changed.py'));
 hold.release();await p.waitForTimeout(100);assert.match(await p.locator('#files-meta').textContent(),/revision-b/);assert.match(await p.locator('#workspace-diff').textContent(),/revision-b-changed.py/);assert.doesNotMatch(await p.locator('#workspace-diff').textContent(),/revision-a-changed.py/);assert.match(await p.locator('#workspace-model-status').textContent(),/新版本 revision-b/);
});
test('Inspect history selection and pagination cannot change the displayed Preview Stop identity', {timeout:15000},async t=>{
 const f=await fixture(t,{mismatched:true,pagedServices:true}),p=f.page;await p.getByRole('tab',{name:'Inspect',exact:true}).click();await p.locator('#workspace-runtime-details summary').first().click();await p.locator('#workspace-runtime-details [data-run-id=run-b]').click();await p.waitForFunction(()=>document.querySelector('#workspace-runtime-details pre').textContent.includes('run-b'));await p.locator('#workspace-runtime-details [data-service-action=more]').click();await p.locator('#workspace-runtime-details [data-run-id=run-c]').waitFor();
 await p.getByRole('tab',{name:'Preview',exact:true}).click();assert.match(await p.locator('#workspace-services').innerText(),/revision-a/);assert.doesNotMatch(await p.locator('#workspace-services').innerText(),/revision-b/);await p.locator('#workspace-services [data-service-action=stop]').click();await p.waitForFunction(()=>!document.querySelector('#workspace-preview iframe'));assert.equal(f.calls.filter(c=>c.path.endsWith('/services/run-a/stop')).length,1);assert.equal(f.calls.filter(c=>c.path.endsWith('/services/run-b/stop')).length,0);
});

test('an older Preview POST finishing after a new model start cannot rebind the old iframe', {timeout:15000},async t=>{
 const f=await fixture(t),p=f.page;f.dropPreview();await p.locator('#workspace-preview summary').click();await p.getByRole('button',{name:'刷新预览状态',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('#workspace-preview iframe'));
 const hold=f.holdReads((path,method)=>path.endsWith('/previews')&&method==='POST');await p.getByRole('button',{name:'连接运行中的模型',exact:true}).click();await waitHeld(hold,1);f.setRevision('revision-b');await p.getByRole('button',{name:'运行已保存模型',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#workspace-services').textContent.includes('revision-b'));
 assert.equal(await p.locator('#workspace-preview iframe').count(),0);await p.evaluate(()=>{window.addedPreviewFrames=0;new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeName==='IFRAME')window.addedPreviewFrames++;}).observe(document.querySelector('#workspace-preview'),{childList:true,subtree:true});});hold.release();await p.locator('#workspace-preview iframe').waitFor();await p.frameLocator('#workspace-preview iframe').getByText('LOCAL UI FIXTURE · run-b').waitFor();assert.equal(await p.evaluate(()=>window.addedPreviewFrames),1);assert.deepEqual(f.calls.filter(c=>c.path.endsWith('/previews')&&c.method==='POST').map(c=>JSON.parse(c.body).runId),['run-a','run-b']);assert.equal(f.calls.filter(c=>c.path.endsWith('/services')&&c.method==='POST').length,1);
});

async function waitHeld(hold,count){for(let attempt=0;attempt<300&&hold.count()<count;attempt++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(hold.count()>=count,'expected pending reads were observed');}

async function createPreparing(f){const p=f.page;await p.locator('#new-project').click();await p.locator('#project-title').fill('准备状态回归');await p.locator('#project-submit').click();await p.waitForFunction(()=>document.querySelector('#notice').textContent.includes('项目正在准备中'));}
test('project notice follows authoritative ready in list and Workspace, while unrelated errors survive',async t=>{
 const f=await fixture(t,{projectFlow:true}),p=f.page;await createPreparing(f);f.setStatus('ready');await f.refresh();await p.waitForFunction(()=>document.querySelector('#notice').hidden);assert.match(await p.locator('#projects').innerText(),/工作区已创建/);
 await p.locator('.project-open').click();await p.locator('#message-input:not([disabled])').waitFor();assert.equal(await p.locator('#notice').isVisible(),false);
});
test('a preparing Workspace polls to ready without retaining its preparation notice',async t=>{
 const f=await fixture(t,{projectFlow:true}),p=f.page;await createPreparing(f);await p.locator('.project-open').click();assert.match(await p.locator('#notice').innerText(),/项目正在准备中/);f.setStatus('ready');await f.refresh();await p.locator('#message-input:not([disabled])').waitFor();assert.equal(await p.locator('#notice').isVisible(),false);
});
test('project failures and timeouts stay actionable, unrelated list errors are not cleared by ready',async t=>{
 const f=await fixture(t,{projectFlow:true}),p=f.page;await createPreparing(f);await f.expire();await f.refresh();await p.waitForFunction(()=>document.querySelector('#notice').textContent.includes('停止自动刷新'));assert.equal(await p.locator('#notice button').isVisible(),true);f.setStatus('ready');await f.refresh();await p.locator('#projects .status.ready').waitFor();assert.equal(await p.locator('#projects .status.ready').innerText(),'工作区已创建');assert.match(await p.locator('#notice').innerText(),/停止自动刷新/);f.setStatus('provisioning');await f.refresh();await p.locator('#notice button').click();f.setStatus('failed');await f.refresh();await p.waitForFunction(()=>document.querySelector('#notice').textContent.includes('项目准备失败'));assert.equal(await p.locator('#notice button').isVisible(),true);f.setStatus('ready');await f.refresh();assert.match(await p.locator('#notice').innerText(),/项目准备失败/);
 f.failList(true);await f.refresh();await p.waitForFunction(()=>document.querySelector('#notice').textContent.includes('服务暂不可用'));f.failList(false);await f.refresh();await p.waitForTimeout(100);assert.match(await p.locator('#notice').innerText(),/服务暂不可用/);
});
test('legacy depth restores a view and four tabs support keyboard navigation without execution',async t=>{
 const f=await fixture(t,{legacyLayout:{depth:'inspect',mobile:'preview'}}),p=f.page;assert.equal(await p.locator('#canvas-inspect').isVisible(),true);await p.getByRole('tab',{name:'Inspect',exact:true}).focus();await p.keyboard.press('Home');assert.equal(await p.locator('#canvas-preview').isVisible(),true);await p.keyboard.press('ArrowRight');assert.equal(await p.locator('#canvas-model').isVisible(),true);await p.keyboard.press('ArrowRight');assert.equal(await p.locator('#canvas-runs').isVisible(),true);await p.keyboard.press('End');assert.equal(await p.locator('#canvas-inspect').isVisible(),true);assert.equal(await p.locator('#workspace-runtime-details').isVisible(),true);assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.path.endsWith('/tickets')).length,0);
});

test('Managed retry explains the durable block and cancelled saves do not claim model completion',async t=>{
 const f=await fixture(t),p=f.page;
 await p.route('**/api/workspaces/w',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:3,activeTurnId:null,releaseHold:null,managedState:{stopped:'managed-execution-unknown',unresolved:1,cleanupPending:false},sessions:{s:{id:'s',title:'Main',createdAt:1}},turns:{t:{id:'t',sessionId:'s',message:'Build traffic model',status:'cancelled',persistenceOutcome:'saved',createdAt:1}}})}));
 await p.route('**/api/workspaces/w/sessions/s/turns',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'managed-execution-unknown'})}));
 await p.reload();await p.getByText('已停止 · 恢复状态已保存（不代表建模完成）',{exact:true}).waitFor();
 await p.getByText('上一轮曾出现执行状态未确认，项目已暂停接收新请求；需要核对原任务后恢复，重复发送不会解除暂停。',{exact:true}).waitFor();
 await p.locator('#message-input').fill('Retry');await p.locator('#message-submit').click();
 await p.waitForFunction(()=>document.querySelector('#message-error').textContent.includes('执行状态未确认'));
 assert.doesNotMatch(await p.locator('#message-error').innerText(),/服务暂不可用/);
});
