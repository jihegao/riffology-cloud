import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const modules=Object.fromEntries(await Promise.all(['project-views.js','project-view-remote.js','manual-save.js','artifact-views.js','i18n.js','i18n-bindings.js'].map(async name=>[name,await readFile(new URL('../../services/web/'+name,import.meta.url),'utf8')])));
const source = await readFile(new URL('../../services/web/simulation.js', import.meta.url), 'utf8');

test('simulation panel uses saved model/version and never invokes Pi turns', () => {
  for (const path of ['/model', '/experiments', '/simulation-runs/', 'Idempotency-Key', 'sessionStorage']) assert.match(source, new RegExp(path.replace(/[\\W]/g, '\\\\$&')));
  assert.doesNotMatch(source, /sessions\/|turns\/|prompt|Pi/);
});

test('simulation panel has bounded active polling, cancellation and terminal states', () => {
  for (const value of ['waiting_for_capacity', 'preparing', 'running', 'finalizing', 'stopping', 'unknown', 'completed', 'failed', 'cancelled']) assert.match(source, new RegExp(value));
  assert.match(source, /setTimeout/);
  assert.match(source, /simulation-runs.*cancel/);
});

test('simulation panel renders typed parameters, retries one pending request and shows saved results', async t => {
  const browser = await chromium.launch({ headless: true, channel: process.env.M1_BROWSER_CHANNEL || 'chrome' });
  t.after(() => browser.close());
  const context = await browser.newContext({locale:'zh-CN'}); t.after(() => context.close());
  const page = await context.newPage(); const files = {};
  for (const name of ['artifact-views.js','index.html', 'app.js', 'i18n.js', 'i18n-bindings.js', 'locale-preference.js','project-status.js', 'browser-preview.js', 'verify-handoff.js', 'layout.js', 'export.js', 'publication.js', 'evidence.js', 'evidence.css', 'services.js', 'previews.js', 'simulation.js','project-views.js','project-view-remote.js','manual-save.js', 'local-runs.js', 'comparison.js', 'styles.css', 'workspace.css']) files[name] = await readFile(new URL(`../../services/web/${name}`, import.meta.url), 'utf8');
  let experiments = [], posts = 0, failOnce = true, changedSpec = false;const attempts=[];
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.startsWith('/api/')) {
      if (path.endsWith('/manual-saves')&&url.search==='?capability=1') return json(route,{canRead:false,canWrite:false,canRecover:false});
      if (path === '/api/auth/get-session') return json(route, { user: { id: 'u' } });
if (path === '/api/me') return json(route, { execution:{service:true,preview:true,simulation:true},tenants: [{ id: 't' }] });
      if (path === '/api/models') return json(route, { models: [] });
      if (path === '/api/tenants/t/projects') return json(route, { projects: [{ id: 'p', title: 'P', status: 'ready', workspace_id: 'w' }] });
      if (path === '/api/workspaces/w/browser-preview' && route.request().method()==='GET') return json(route,{currentRevisionId:null,revisionId:null,build:null,stale:false,modelSpec:null,reasonCode:'preview-no-saved-revision',delivery:null});
      if (path === '/api/workspaces/w/evidence') return json(route, {items:[],nextCursor:null});
      if (path === '/api/workspaces/w/experiment-groups') return json(route, {items:[],nextCursor:null});
      if (path === '/api/workspaces/w/model') return json(route, { version: { revisionId: 'r', filesSha256: 'f', specSha256: 's' }, spec: { parameters: { servers: { type: 'integer', default: 1, minimum: 1, maximum: 4 }, mode: { type: 'enum', values: ['fast', 'safe'], default: 'fast' }, ...(changedSpec ? {added:{type:'integer',default:8}} : {warm: { type: 'boolean', default: true }}) } }, reasonCode: null, canRun: true });
      if (path === '/api/workspaces/w/experiments' && route.request().method() === 'GET') return json(route, { items: experiments, nextCursor: null });
      if (path === '/api/workspaces/w/experiments' && route.request().method() === 'POST') { posts++;attempts.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()}); if (failOnce) { failOnce = false; return route.abort('failed'); } const body = JSON.parse(route.request().postData()); assert.equal(body.parameters.servers, 2); assert.equal(body.parameters.warm, true); experiments = [{ experimentId: 'e', runId: 'run', status: 'completed', stale: true, createdAt: 1, updatedAt: 2, version: {revisionId:body.revisionId,filesSha256:body.filesSha256,specSha256:body.specSha256}, parameters: body.parameters, seed: body.seed, result: { metrics: { wait: 0 }, artifactSha256: 'a'.repeat(64) } }]; return json(route, experiments[0], 202); }
      if (path === '/api/workspaces/w') return json(route, { schemaVersion: 3, activeTurnId: null, resourceWait: null, releaseHold: null, recoveryHold: null, sessions: {}, turns: {} });
      if (path === '/api/workspaces/w/events') return json(route, { events: [], nextSequence: 1, hasMore: false, snapshotRequired: false });
      if (path === '/api/workspaces/w/files') return json(route, { schemaVersion: 1, revision: null, files: [] });
      if (path === '/api/workspaces/w/diff') return json(route, { schemaVersion: 1, revision: null, summary: { added: 0, modified: 0, deleted: 0 }, changes: [] });
      if (path === '/api/workspaces/w/services') return json(route, { items: [], nextCursor: null });
      if (path === '/api/workspaces/w/previews') return json(route, { current: null, available: null });
      throw Error(`unexpected API ${path}`);
    }
    const name = path === '/' ? 'index.html' : path.slice(1); return route.fulfill({ status: files[name] ? 200 : 404, contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: files[name] || '' });
  });
  await page.goto('https://ui.test/'); await page.locator('.project-open').click(); await page.locator('[data-workspace-tab=runs]').click(); await page.locator('#workspace-simulation input[name="servers"]').waitFor();
  assert.equal(await page.locator('#workspace-simulation input[name="servers"]').getAttribute('type'), 'number'); assert.equal(await page.locator('#workspace-simulation input[name="warm"]').getAttribute('type'), 'checkbox'); assert.equal(await page.locator('#workspace-simulation select[name="mode"]').count(), 1); assert.equal(posts, 0);
  await page.locator('#workspace-simulation input[name="servers"]').fill('2');
  await page.locator('#workspace-simulation input[name="seed"]').fill('99');
  await page.locator('#workspace-simulation select[name="execution"]').selectOption('cloud');
  await page.locator('#workspace-simulation button[type="submit"]').click();
  await page.getByText('重试实验',{exact:true}).waitFor();assert.equal(posts,1);
  assert.equal(await page.locator('#workspace-simulation input[name="servers"]').inputValue(),'2');
  assert.equal(await page.locator('#workspace-simulation input[name="servers"]').isDisabled(),true);
  assert.match(await page.locator('#workspace-simulation').innerText(),/revision r.*files f.*spec s.*seed 99/);
  changedSpec = true;
  await page.reload();
  await page.getByText('重试实验',{exact:true}).waitFor();
  assert.equal(await page.locator('#workspace-simulation input[name="servers"]').inputValue(),'2');
  assert.equal(await page.locator('#workspace-simulation input[name="servers"]').isDisabled(),true);
  assert.equal(await page.locator('#workspace-simulation input[name="seed"]').inputValue(),'99');
  assert.equal(await page.locator('#workspace-simulation input[name="seed"]').isDisabled(),true);
  assert.equal(await page.locator('#workspace-simulation input[name="added"]').count(),0);
  assert.equal(await page.locator('#workspace-simulation input[name="warm"]').count(),0);
  assert.match(await page.locator('.simulation-pending').innerText(),/"warm":true/);
  await page.getByText('重试实验',{exact:true}).click();
  await page.locator('#workspace-simulation').getByText(/已完成/).waitFor();assert.equal(posts,2);assert.deepEqual(attempts[0],attempts[1]);
  await page.getByText('刷新模型与实验',{exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#workspace-simulation input[name="servers"]')?.value==='2');assert.equal(posts,2);
  assert.match(await page.locator('#workspace-simulation').innerText(),/版本 r/);
});

test('pending experiments unlock only confirmed rejection and preserve ambiguous conflicts',async t=>{
 const browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||'chrome'});t.after(()=>browser.close());const page=await browser.newPage();
 await page.route('https://panel.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('.js')?'application/javascript':'text/html',body:route.request().url().endsWith('.js')?(modules[new URL(route.request().url()).pathname.slice(1)]??source):'<div id="panel"></div>'}));await page.goto('https://panel.test/');
 for(const [status,code,unlocked] of [[400,'simulation-input-invalid',true],[409,'simulation-model-stale',true],[409,'simulation-idempotency-conflict',false],[400,'unexpected',false]]){
  const expected=await page.evaluate(async({status,code})=>{
   window.simPanel?.leave();window.attempts=[];const pending={key:'same-key',body:{revisionId:'old',filesSha256:'f',specSha256:'s',parameters:{servers:2},seed:99}};sessionStorage.setItem('riffology:simulation-intent:t:w',JSON.stringify(pending));
   (await import('/i18n.js')).setLocale('zh-CN',{persist:false});const {createSimulationPanel}=await import('/simulation.js');window.simPanel=createSimulationPanel({root:document.querySelector('#panel'),api:async(path,options)=>{if(options?.method==='POST'){window.attempts.push({key:options.headers['Idempotency-Key'],body:options.body});throw Object.assign(Error('rejected'),{status,code});}return path.endsWith('/model')?{canRun:true,version:{revisionId:'new',filesSha256:'n',specSha256:'s'},spec:{parameters:{servers:{type:'integer',default:1}}}}:{items:[]};}});await window.simPanel.enter({tenantId:'t',workspaceId:'w'});return {key:pending.key,body:JSON.stringify(pending.body)};
  },{status,code});
  await page.getByText('重试实验',{exact:true}).click();await page.waitForFunction(()=>window.attempts.length===1);await page.locator('button[type="submit"]:not([disabled])').waitFor();assert.equal(await page.locator('input[name="servers"]').isEnabled(),unlocked);assert.equal(await page.locator('input[name="servers"]').inputValue(),'2');assert.equal(await page.locator('input[name="seed"]').inputValue(),'99');assert.deepEqual(await page.evaluate(()=>window.attempts[0]),expected);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('riffology:simulation-intent:t:w')===null),unlocked);
 }
});

test('compiler model and completed Run show their frozen identities without rendering source HTML',async t=>{
 const browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||'chrome'});t.after(()=>browser.close());const page=await browser.newPage();
 await page.route('https://compiler-panel.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('.js')?'application/javascript':'text/html',body:route.request().url().endsWith('.js')?(modules[new URL(route.request().url()).pathname.slice(1)]??source):'<div id="panel"></div>'}));await page.goto('https://compiler-panel.test/');
 await page.evaluate(async()=>{
  (await import('/i18n.js')).setLocale('zh-CN',{persist:false});const {createSimulationPanel}=await import('/simulation.js');const compiler={compilerVersion:'0.1.0',bundleId:'a'.repeat(64),planFingerprint:'b'.repeat(64),bundleSha256:'c'.repeat(64)};const spec={researchQuestion:'<img src=x onerror=alert(1)>',scope:'B1',entities:[],mechanisms:[],assumptions:[],limitations:[],parameters:{},metrics:{completed_sorties:{}},execution:{kind:'compiler-v01',businessIr:'model/business-ir.json',bundle:'model/model.simpack'}};
  const model={version:{revisionId:'revision',filesSha256:'f'.repeat(64),specSha256:'s'.repeat(64)},spec,compiler,reasonCode:null,canRun:true};const run={experimentId:'run-b1',runId:'run-b1',version:model.version,status:'completed',parameters:{},seed:7,result:{metrics:{completed_sorties:2},compiler:{...compiler,resultSha256:'d'.repeat(64),stopReason:'duration'}}};
  window.panel=createSimulationPanel({root:document.querySelector('#panel'),api:async path=>path.endsWith('/model')?model:{items:[run]}});await window.panel.enter({tenantId:'t',workspaceId:'w'});
 });
 assert.match(await page.locator('.model-view').innerText(),/编译器 0\.1\.0.*包 a{12}.*Plan b{12}/);
 assert.equal(await page.locator('img').count(),0);
 await page.getByText('查看编译包与结果标识').click();
 assert.match(await page.locator('.simulation-experiment pre').innerText(),/"resultSha256": "d{64}"/);
});

test('Model view restores persisted semantics, bounds and warnings safely on desktop and mobile',async t=>{
 const browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||'chrome'});t.after(()=>browser.close());const page=await browser.newPage();
 const css=await readFile(new URL('../../services/web/workspace.css',import.meta.url),'utf8');
 await page.route('https://model.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('.js')?'application/javascript':'text/html',body:route.request().url().endsWith('.js')?(modules[new URL(route.request().url()).pathname.slice(1)]??source):`<style>body{font-family:system-ui;margin:16px;--line:#d8e8de;--muted:#52655b}button,input{padding:8px}.simulation-form{display:grid;gap:12px}${css}</style><div id="panel"></div>`}));
 await page.goto('https://model.test/');
 await page.evaluate(async()=>{
  window.fixture={version:{revisionId:'saved-revision-'+ 'r'.repeat(64),filesSha256:'f'.repeat(64),specSha256:'s'.repeat(64)},canRun:false,reasonCode:null,spec:{schemaVersion:1,researchQuestion:'How does capacity affect waiting?',scope:'Airport check-in, 4 hours',entities:['Passenger','Counter'],mechanisms:['Arrival','Queue','Service'],assumptions:['FCFS','<img src=x onerror=alert(1)>'],limitations:['No abandonment'],parameters:{capacity:{type:'integer',default:2,minimum:1,maximum:8,unit:'counters'},mode:{type:'enum',default:'normal',values:['normal','priority']},priority:{type:'boolean',default:false}},metrics:{wait:{unit:'minutes',description:'Mean waiting time'}},execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}}};
  (await import('/i18n.js')).setLocale('zh-CN',{persist:false});const {createSimulationPanel}=await import('/simulation.js');window.reads=0;window.panel=createSimulationPanel({root:document.querySelector('#panel'),api:async(path,options)=>{if(options)throw Error('read must not execute');window.reads++;return path.endsWith('/model')?structuredClone(window.fixture):{items:[{experimentId:'e',runId:'invalid-current-'+ 'x'.repeat(64),version:window.fixture.version,status:'failed',parameters:{capacity:2},seed:42,errorCode:'simulation-result-invalid'},{experimentId:'old',runId:'invalid-old',version:{filesSha256:'old',specSha256:'old'},status:'failed',parameters:{capacity:2},seed:42,errorCode:'simulation-result-invalid'}]};}});await window.panel.enter({tenantId:'t',workspaceId:'w'});
 });
 const view=page.locator('.model-view');
 for(const text of ['研究问题','范围与边界','实体与资源','机制与规则','假设','限制与未包含的机制','参数定义','输出指标','最小 1','最大 8','单位 counters','Mean waiting time']){assert.ok((await view.innerText()).includes(text),text);}
 assert.equal(await view.locator('img').count(),0);assert.equal(await view.locator('details').getAttribute('open'),null);assert.equal(await page.locator('button[type=submit]').isDisabled(),true);
 assert.match(await view.innerText(),/invalid-current.*未通过契约校验/);assert.doesNotMatch(await view.innerText(),/invalid-old/);
 await view.locator('summary').click();assert.match(await view.locator('pre').innerText(),/saved-revision/);
 await page.getByText('刷新模型与实验',{exact:true}).click();await page.waitForFunction(()=>window.reads===4);assert.equal(await view.locator('details').getAttribute('open'),'');
 await view.locator('summary').click();
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'/tmp/riffology-issue29-model-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.simulation-experiment')].every(row=>{const text=row.querySelector('span').getBoundingClientRect(),warning=row.querySelector('small').getBoundingClientRect();return warning.top>=text.bottom&&warning.bottom<=row.getBoundingClientRect().bottom;})),true);await page.screenshot({path:'/tmp/riffology-issue29-model-mobile.png',fullPage:true});
 await page.evaluate(async()=>{window.fixture.reasonCode='model-contract-mismatch';await window.panel.reload();});assert.match(await view.innerText(),/执行文件不完整/);assert.match(await view.innerText(),/FCFS/);
 await page.evaluate(async()=>{window.fixture={spec:null,version:null,reasonCode:'model-spec-missing',canRun:false};await window.panel.reload();});assert.match(await view.innerText(),/尚未保存模型说明/);assert.equal(await view.locator('pre').count(),0);
});
