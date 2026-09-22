import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { JSON_REQUEST_MAX_BYTES } from '../../services/gateway/http.ts';
import { renderWorkspace } from '../../ui/workspace.js';

const files = Object.fromEntries(await Promise.all(['index.html', 'app.js', 'i18n.js', 'i18n-bindings.js', 'locale-preference.js','project-status.js', 'browser-preview.js', 'verify-handoff.js', 'layout.js', 'export.js', 'publication.js', 'evidence.js', 'evidence.css', 'services.js', 'previews.js', 'simulation.js', 'comparison.js', 'styles.css', 'workspace.css'].map(async name => [name, await readFile(new URL(`../../services/web/${name}`, import.meta.url), 'utf8')])));
const workspaceUiSource = await readFile(new URL('../../ui/workspace.js', import.meta.url), 'utf8');
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.M1_BROWSER_CHANNEL || 'chrome' }); });
after(async () => { await browser?.close(); });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function pageFixture(t, handle, options = {}) {
  const context = await browser.newContext({locale:'zh-CN', viewport: options.mobile ? { width: 390, height: 844 } : { width: 1200, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, 'https://ui.test');
    if (url.pathname.startsWith('/api/')) {
      if (await handle(route, url.pathname)) return;
      if (url.pathname === '/api/auth/get-session') return json(route, { user: { id: 'fixture-user' } });
if (url.pathname === '/api/me') return json(route, { execution:{service:true,preview:true,simulation:true},tenants: [{ id: 'tenant-a' }] });
      if (url.pathname === '/api/models') return json(route, { models: [] });
      if (url.pathname === '/api/tenants/tenant-a/projects') return json(route, { projects: [] });
      if (/^\/api\/workspaces\/[^/]+\/browser-preview$/.test(url.pathname) && route.request().method()==='GET') return json(route,{currentRevisionId:null,revisionId:null,build:null,stale:false,modelSpec:null,reasonCode:'preview-no-saved-revision',delivery:null});
      if (/^\/api\/workspaces\/[^/]+\/model$/.test(url.pathname)) return json(route, { version: null, spec: null, reasonCode: 'model_not_saved', canRun: false });
      if (/^\/api\/workspaces\/[^/]+\/evidence$/.test(url.pathname)) return json(route,{items:[],nextCursor:null});
      if (/^\/api\/workspaces\/[^/]+\/experiment-groups$/.test(url.pathname) && route.request().method() === 'GET') return json(route, { items: [], nextCursor: null });
      if (/^\/api\/workspaces\/[^/]+\/experiments$/.test(url.pathname)) return json(route, { items: [], nextCursor: null });
      if (/^\/api\/workspaces\/[^/]+\/previews$/.test(url.pathname)) return route.request().method() === 'GET' ? json(route, {current:null,available:null}) : json(route,{error:'preview_unavailable'},503);
      if (/^\/api\/workspaces\/[^/]+\/files$/.test(url.pathname)) return json(route, { schemaVersion: 1, revision: null, files: [] });
      if (/^\/api\/workspaces\/[^/]+\/diff$/.test(url.pathname)) return json(route, { schemaVersion: 1, revision: null, summary: { added: 0, modified: 0, deleted: 0 }, changes: [] });
      if (/^\/api\/workspaces\/[^/]+\/services$/.test(url.pathname) && route.request().method()==='GET') return json(route, { items: [], nextCursor: null });
      if (/^\/api\/workspaces\/[^/]+\/sessions\/[^/]+\/turns\/receipt$/.test(url.pathname) && route.request().method()==='GET') return json(route,{error:'not_found'},404);
      throw Error(`unexpected request ${url.pathname}`);
    }
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return route.fulfill({ contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: files[name] || '', status: files[name] ? 200 : 404 });
  });
  return page;
}

test('research entry points do not fabricate an unpublished Queue case or start computation', async t => {
  const calls = [];
  const page = await pageFixture(t, async route => { calls.push(route.request().method()); });
  await page.goto('https://ui.test/');
  await page.getByText('Queue 官方案例尚未发布。你可以先描述自己的研究问题。').waitFor();
  assert.equal(await page.locator('#start-queue').isDisabled(), true);
  await page.locator('#start-question').click();
  await page.locator('#project-dialog[open]').waitFor();
  assert.equal(await page.locator('#project-model').inputValue(), '');
  assert.ok(calls.every(method => method === 'GET'));
});

test('Queue entry uses only published catalog versions and normal independent-copy creation', async t => {
  const calls = [], versions = [
    {model_id:'queue-research',version:'v1',title:'Queue',status:'published'},
    {model_id:'queue-research',version:'draft',title:'Draft Queue',status:'draft'},
  ];
  const page = await pageFixture(t, async (route, path) => {
    calls.push({method:route.request().method(),path});
    if (path === '/api/models') { await json(route, {models:versions}); return true; }
  }, {mobile:true});
  await page.goto('https://ui.test/');
  await page.waitForFunction(() => !document.querySelector('#start-queue').disabled);
  await page.locator('#start-queue').click();
  assert.equal(await page.locator('#models .model-card').count(), 1);
  assert.equal(await page.locator('#models .model-card').evaluate(node => node === document.activeElement), true);
  await page.getByRole('button', {name:'使用此版本',exact:true}).click();
  assert.equal(await page.locator('#project-model').inputValue(), 'queue-research@v1');
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#project-cancel').click();
  versions.splice(0);
  await page.locator('#models-refresh').click();
  await page.getByText('Queue 官方案例尚未发布。你可以先描述自己的研究问题。').waitFor();
  assert.equal(await page.locator('#start-queue').isDisabled(), true);
});
async function waitFor(check) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); } assert.ok(check(), 'condition timed out'); }

test('project filters use saved-model and preview metadata without executing or deleting projects',async t=>{
 const calls=[];const page=await pageFixture(t,async(route,path)=>{
  calls.push({path,method:route.request().method()});
  if(path==='/api/tenants/tenant-a/projects'){await json(route,{projects:[{id:'queue',workspace_id:'wq',title:'G4 synthetic Queue',status:'ready'},{id:'normal',workspace_id:'wn',title:'我的研究',status:'ready'}]});return true;}
  if(path==='/api/workspaces/wq/model'){await json(route,{version:{revisionId:'rev-q'}});return true;}
  if(path==='/api/workspaces/wq/browser-preview'){await json(route,{build:{status:'ready'},currentRevisionId:'rev-q'});return true;}
 });
 await page.goto('https://ui.test/');await page.waitForFunction(()=>document.querySelector('[data-preview-ready="true"]'));
 await page.locator('#project-filter').selectOption('preview');assert.equal(await page.locator('.project:visible').count(),1);assert.match(await page.locator('.project:visible').innerText(),/本地预览可用/);
 await page.locator('#project-filter').selectOption('ordinary');assert.equal(await page.locator('.project:visible h2').innerText(),'我的研究');
 await page.locator('#project-filter').selectOption('all');assert.equal(await page.locator('.project:visible').count(),2);
 await page.locator('#project-search').fill('Queue');assert.equal(await page.locator('.project:visible').count(),1);
 assert.ok(calls.every(c=>c.method==='GET'));assert.equal(calls.some(c=>/packages|services|turns|simulations/.test(c.path)),false);
});

test('workspace UI keeps ordinary and airport projects in the real unconnected empty state', () => {
  assert.match(workspaceUiSource, /runtimeConnected=false/);
  assert.match(workspaceUiSource, /平台产品功能 \/ 项目内 Pi Agent/);
  assert.match(workspaceUiSource, /平台功能尚未接通/);
  for (const panel of ['Files 尚未接通', 'Diff 尚未接通', 'Runs 尚未接通', 'Browser 尚未接通']) assert.match(workspaceUiSource, new RegExp(panel));
  assert.match(workspaceUiSource, /data-action="attach".*disabled/);
  assert.match(workspaceUiSource, /data-action="budget".*disabled/);
  assert.match(workspaceUiSource, /type="submit" class="send-button".*disabled/);
  assert.match(workspaceUiSource, /document\.querySelectorAll\('\[data-action="attach"\]/);
  for (const project of [{ id: 'ordinary', name: '普通项目' }, { id: 'airport', name: '机场项目', model: 'airport-starter' }]) {
    const ctx = { state: { activeProject: project.id, projects: [project], workspaces: {}, browserEnabled: true, budget: 100 }, save() {}, render() {} };
    const html = renderWorkspace(ctx);
    assert.match(html, /平台功能尚未接通/);
    assert.match(html, /disabled/);
    assert.doesNotMatch(html, /state_demo|12\.4|24架次|r_018|示例观察/);
  }
});

test('real browser renders authentication, authorization, quota and availability errors and exposes invitation acceptance', async t => {
  for (const status of [401, 403, 404, 429, 503]) {
    const page = await pageFixture(t, async (route, path) => {
      if (path === '/api/me') { await json(route, { error: 'fixture' }, status); return true; }
    });
    await page.goto('https://ui.test/');
    await page.locator('#notice:not([hidden])').waitFor();
    const expected = { 401: /请先登录/, 403: /权限已变化/, 404: /邀请码/, 429: /请求过于频繁/, 503: /服务暂不可用/ };
    assert.match(await page.locator('#notice').innerText(), expected[status]);
    if (status === 404) assert.equal(await page.locator('#invitation').isVisible(), true);
    await page.close();
  }
});

test('real form cancel does not POST; two network failures retry same payload/key; duplicate submit cannot create twice', async t => {
  const attempts = [];
  let created = false;
  let release;
  const first = new Promise(resolve => { release = resolve; });
  const page = await pageFixture(t, async (route, path) => {
    if (path.endsWith('/projects') && route.request().method() === 'POST') {
      attempts.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
      if (attempts.length === 1) await first;
      if (attempts.length <= 2) await route.abort('failed');
      else { created = true; await json(route, { project: { status: 'provisioning' }, replayed: true }); }
      return true;
    }
    if (path.endsWith('/projects')) { await json(route, { projects: created ? [{ title: '<img src=x onerror=alert(1)>', status: 'provisioning' }] : [] }); return true; }
  }, { mobile: true });
  await page.goto('https://ui.test/');
  await page.locator('#new-project').click();
  await page.locator('#project-title').fill('Cancelled');
  await page.locator('#project-cancel').click();
  assert.equal(attempts.length, 0);
  await page.locator('#new-project').click();
  await page.locator('#project-title').fill('Original title');
  await page.locator('#project-submit').click();
  await waitFor(() => attempts.length === 1);
  await page.locator('#project-form').evaluate(form => form.dispatchEvent(new Event('submit', { cancelable: true })));
  assert.equal(attempts.length, 1);
  release();
  await page.locator('#project-submit:not([disabled])').waitFor();
  assert.equal(await page.locator('#project-submit').innerText(), '重试');
  await page.locator('#project-submit').click();
  await waitFor(() => attempts.length === 2);
  await page.locator('#project-submit:not([disabled])').waitFor();
  await page.locator('#project-submit').click();
  await page.locator('#project-dialog').waitFor({ state: 'hidden' });
  await page.locator('.project h2').waitFor();
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts[0], attempts[1]); assert.deepEqual(attempts[1], attempts[2]);
  assert.deepEqual(JSON.parse(attempts[0].body), { title: 'Original title', starterVersion: 'blank-v1' });
  assert.match(await page.locator('#notice').innerText(), /准备中/);
  assert.equal(await page.locator('.project img').count(), 0);
  assert.equal(await page.locator('.project h2').innerText(), '<img src=x onerror=alert(1)>');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('published model catalog selection uses exact project payload and retry intent', async t => {
  const attempts = []; let created = false, catalogReads = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/models') { catalogReads++; await json(route, { models: catalogReads === 1 ? [
      { model_id: 'queue', version: '2.1.0', title: '<b>排队模型</b>', description: '<img src=x onerror=alert(1)>', status: 'published' },
      { model_id: 'draft', version: '1.0.0', title: '草稿', description: '不应显示', status: 'draft' },
      { model_id: 'withdrawn', version: '1.0.0', title: '撤回', description: '不应显示', status: 'withdrawn' },
    ] : [] }); return true; }
    if (path === '/api/tenants/tenant-a/projects' && route.request().method() === 'POST') {
      attempts.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
      if (attempts.length === 1) { await route.abort('failed'); return true; }
      created = true; await json(route, { project: { id: 'project-model', title: '模型项目', status: 'provisioning' } }, 202); return true;
    }
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: created ? [{ id: 'project-model', title: '模型项目', status: 'provisioning' }] : [] }); return true; }
  }, { mobile: true });
  await page.goto('https://ui.test/');
  await page.locator('#models-status').filter({ hasText: '选择固定版本' }).waitFor();
  assert.equal(await page.locator('.model-card').count(), 1);
  assert.equal(await page.locator('.model-card img').count(), 0);
  assert.equal(await page.locator('.model-card h3').innerText(), '<b>排队模型</b>');
  await page.locator('.model-card button').click();
  await page.locator('#project-title').fill('模型项目');
  assert.equal(await page.locator('#project-model').inputValue(), 'queue@2.1.0');
  await page.locator('#project-model').selectOption('queue@2.1.0');
  await page.locator('#project-submit').click();
  await page.locator('#project-submit:not([disabled])').waitFor();
  assert.equal(await page.locator('#project-submit').innerText(), '重试');
  await page.evaluate(() => document.querySelector('#models-refresh').click());
  await page.locator('#models-status').filter({ hasText: '暂无可用' }).waitFor();
  assert.equal(await page.locator('#project-model').inputValue(), 'queue@2.1.0');
  assert.equal(await page.locator('#project-model').isDisabled(), true);
  await page.locator('#project-submit').click();
  await page.locator('#project-dialog').waitFor({ state: 'hidden' });
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1]);
  assert.deepEqual(JSON.parse(attempts[0].body), { title: '模型项目', modelId: 'queue', modelVersion: '2.1.0' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('model catalog failure and empty catalog preserve blank project creation', async t => {
  for (const response of ['failure', 'empty']) {
    const page = await pageFixture(t, async (route, path) => {
      if (path === '/api/models') { if (response === 'failure') await route.abort('failed'); else await json(route, { models: [] }); return true; }
      if (path === '/api/tenants/tenant-a/projects' && route.request().method() === 'POST') { assert.deepEqual(JSON.parse(route.request().postData()), { title: '空白项目', starterVersion: 'blank-v1' }); await json(route, { project: { id: 'blank', title: '空白项目', status: 'provisioning' } }, 202); return true; }
      if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [] }); return true; }
    });
    await page.goto('https://ui.test/');
    await page.locator('#models-status').filter({ hasText: response === 'failure' ? '暂时不可用' : '暂无可用' }).waitFor();
    await page.locator('#new-project').click();
    await page.locator('#project-title').fill('空白项目');
    assert.equal(await page.locator('#project-model').inputValue(), '');
    await page.locator('#project-submit').click();
    await page.locator('#project-dialog').waitFor({ state: 'hidden' });
    await page.close();
  }
});

test('successful mutation responses remain visible while the first list read is stale', async t => {
  let accepted = false, created = false, projectReads = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/me') {
      if (!accepted) { await json(route, { error: 'not admitted' }, 404); return true; }
      await json(route, { tenants: [{ id: 'tenant-new' }] }); return true;
    }
    if (path === '/api/invitations/accept') {
      accepted = true; await json(route, { tenantId: 'tenant-new' }); return true;
    }
    if (path === '/api/tenants/tenant-new/projects' && route.request().method() === 'POST') {
      created = true;
      await json(route, { project: { id: 'project-new', title: 'Immediately visible', status: 'provisioning' }, replayed: false }, 202);
      return true;
    }
    if (path === '/api/tenants/tenant-new/projects') {
      projectReads++;
      await json(route, { projects: created && projectReads > 2 ? [{ id: 'project-new', title: 'Immediately visible', status: 'ready' }] : [] });
      return true;
    }
  });
  await page.clock.install();
  await page.goto('https://ui.test/');
  await page.locator('#invitation').waitFor();
  await page.locator('#invite-token').fill('a'.repeat(64));
  await page.locator('#invite-form button[type=submit]').click();
  await page.locator('#app').waitFor();
  assert.equal(await page.locator('#invitation').isVisible(), false);
  await page.locator('#new-project').click();
  await page.locator('#project-title').fill('Immediately visible');
  await page.locator('#project-submit').click();
  await page.locator('#project-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.project h2').innerText(), 'Immediately visible');
  assert.equal(await page.locator('.project .status').innerText(), '工作区准备中');
  await page.clock.fastForward(3000);
  await page.locator('.project .status').filter({ hasText: '工作区已创建' }).waitFor();
  assert.ok(projectReads >= 3);
});

test('ready project opens the real workspace APIs and keeps platform and Pi responsibilities visible', async t => {
  const workspaceId = 'workspace-a', sessionId = 'session-a', turnId = 'turn-a';
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') {
      await json(route, { projects: [{ id: 'project-a', workspace_id: workspaceId, title: '排队模型', status: 'ready', source_model_id: 'queue', source_model_version: '1.0.0' }] }); return true;
    }
    if (path === `/api/workspaces/${workspaceId}`) {
      await json(route, { schemaVersion: 1, nextSequence: 4, activeTurnId: null, sessions: { [sessionId]: { id: sessionId, title: '主对话', createdAt: 1 } }, turns: { [turnId]: { id: turnId, sessionId, message: '<img src=x onerror=alert(1)>', status: 'failed', errorCode: 'pi-turn-failed', persistenceOutcome: 'saved', createdAt: 2 } } }); return true;
    }
    if (path === `/api/workspaces/${workspaceId}/events`) {
      await json(route, { events: [{ sequence: 1, eventId: 'event-a', turnId, type: 'assistant.message', payload: { text: '<script>alert(1)</script>', stopReason: 'error' } }, { sequence: 2, eventId: 'event-b', turnId, type: 'provider.status', payload: { state: 'error', status: 503 } }], nextSequence: 2, hasMore: false, oldestSequence: 1, snapshotRequired: false }); return true;
    }
  });
  await page.goto('https://ui.test/');
  await page.locator('.project .meta').filter({ hasText: '官方版本 · 独立副本' }).waitFor();
  await page.locator('.project-open').click();
  await page.locator('#workspace:not([hidden])').waitFor();
  await page.getByRole('tab',{name:'Inspect',exact:true}).click();await page.locator('.boundary-note summary').click();
  assert.match(await page.locator('.boundary-note').innerText(), /平台负责身份、预算、保存和恢复/);
  assert.match(await page.locator('.boundary-note').innerText(), /模型代码在隔离环境运行/);
  assert.equal(await page.locator('.turn-card.user p').innerText(), '<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('.turn-card.assistant p').innerText(), '<script>alert(1)</script>');
  assert.equal(await page.locator('#workspace img, #workspace script').count(), 0);
  await page.locator('#workspace-back').click();
  await page.locator('#app:not([hidden])').waitFor();
});

test('trusted project hash restores a ready project after refresh and clears on back', async t => {
  const workspaceId = 'workspace-hash'; let projectReads = 0, workspaceReads = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { projectReads++; await json(route, { projects: [{ id: 'project-hash', workspace_id: workspaceId, title: 'Hash 项目', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { workspaceReads++; await json(route, { schemaVersion: 1, nextSequence: 1, activeTurnId: null, sessions: {}, turns: {} }); return true; }
    if (path === `/api/workspaces/${workspaceId}/events`) { await json(route, { events: [], nextSequence: 0, hasMore: false, oldestSequence: 1, snapshotRequired: false }); return true; }
  });
  await page.goto('https://ui.test/#/workspace/project-hash');
  await page.locator('#workspace:not([hidden])').waitFor();
  assert.equal(await page.locator('#workspace-title').innerText(), 'Hash 项目');
  assert.equal(page.url(), 'https://ui.test/#/workspace/project-hash');
  await page.reload();
  await page.locator('#workspace:not([hidden])').waitFor();
  assert.ok(projectReads >= 2); assert.ok(workspaceReads >= 2);
  await page.locator('#workspace-back').click();
  await page.locator('#app:not([hidden])').waitFor();
  assert.equal(new URL(page.url()).hash, '');
});

test('direct workspace hash does not flash the project list while ownership is being checked', async t => {
  let release; const blocked = new Promise(resolve => { release = resolve; });
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await blocked; await json(route, { projects: [{ id: 'project-direct', workspace_id: 'workspace-direct', title: '直达项目', status: 'ready' }] }); return true; }
    if (path === '/api/workspaces/workspace-direct') { await json(route, { schemaVersion: 1, nextSequence: 1, activeTurnId: null, sessions: {}, turns: {} }); return true; }
    if (path === '/api/workspaces/workspace-direct/events') { await json(route, { events: [], nextSequence: 0, hasMore: false, oldestSequence: 1, snapshotRequired: false }); return true; }
  });
  await page.goto('https://ui.test/#/workspace/project-direct');
  await page.locator('#login[hidden]').waitFor({state:'attached'});
  assert.equal(await page.locator('#app').isVisible(), false);
  release();
  await page.locator('#workspace:not([hidden])').waitFor();
  assert.equal(await page.locator('#workspace-title').innerText(), '直达项目');
});

test('invalid or foreign project hash never opens a workspace', async t => {
  let workspaceReads = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'other-project', workspace_id: 'other-workspace', title: '其他租户项目', status: 'ready' }] }); return true; }
    if(['/api/workspaces/other-workspace/model','/api/workspaces/other-workspace/browser-preview'].includes(path)){assert.equal(route.request().method(),'GET');await json(route,{});return true;}
    if (path.startsWith('/api/workspaces/')) { workspaceReads++; await json(route, { schemaVersion: 1, sessions: {}, turns: {} }); return true; }
  });
  await page.goto('https://ui.test/#/workspace/foreign-project');
  await page.locator('#app:not([hidden])').waitFor();
  assert.equal(await page.locator('#workspace').isVisible(), false);
  assert.equal(workspaceReads, 0);
  assert.equal(new URL(page.url()).hash, '');
});

test('changing an open workspace to a foreign hash closes stale project state', async t => {
  let workspaceReads = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'owned-project', workspace_id: 'owned-workspace', title: '我的项目', status: 'ready' }] }); return true; }
    if (path === '/api/workspaces/owned-workspace') { workspaceReads++; await json(route, { schemaVersion: 1, nextSequence: 1, activeTurnId: null, sessions: {}, turns: {} }); return true; }
    if (path === '/api/workspaces/owned-workspace/events') { await json(route, { events: [], nextSequence: 0, hasMore: false, oldestSequence: 1, snapshotRequired: false }); return true; }
  });
  await page.goto('https://ui.test/#/workspace/owned-project');
  await page.locator('#workspace:not([hidden])').waitFor();
  await page.evaluate(() => { location.hash = '#/workspace/foreign-project'; });
  await page.locator('#app:not([hidden])').waitFor();
  assert.equal(await page.locator('#workspace').isVisible(), false);
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(workspaceReads, 1);
});

test('switching sessions keeps the active Turn and does not call cancel', async t => {
  const workspaceId = 'workspace-sessions', cancelCalls = [];
  const sessions = { one: { id: 'one', title: '主对话', createdAt: 2 }, two: { id: 'two', title: '方案二', createdAt: 1 } };
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-sessions', workspace_id: workspaceId, title: '多 Session', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { await json(route, { schemaVersion: 1, nextSequence: 1, activeTurnId: 'turn-one', sessions, turns: { 'turn-one': { id: 'turn-one', sessionId: 'one', message: '正在运行', status: 'running', createdAt: 3 } } }); return true; }
    if (path === `/api/workspaces/${workspaceId}/events`) { await json(route, { events: [], nextSequence: 0, hasMore: false, oldestSequence: 1, snapshotRequired: false }); return true; }
    if (path.includes('/cancel')) { cancelCalls.push(path); await json(route, { id: 'turn-one', status: 'cancelled' }); return true; }
  });
  await page.goto('https://ui.test/#/workspace/project-sessions');
  await page.locator('#session-select').waitFor();
  await page.locator('#session-select').selectOption('two');
  assert.equal(await page.locator('#session-select').inputValue(), 'two');
  assert.equal(await page.locator('#cancel-turn').isVisible(), true);
  assert.equal(cancelCalls.length, 0);
});

test('authenticated workspace renders Files and lazily reads parent Revision Diff safely', async t => {
  const workspaceId = 'workspace-files'; let fileReads = 0, diffReads = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-files', workspace_id: workspaceId, title: '文件项目', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}/files`) { fileReads++; await json(route, { schemaVersion: 1, revision: { revisionId: 'revision-one', filesSha256: 'a'.repeat(64), committedAt: 1000 }, files: [{ path: 'model', type: 'directory', size: 0, mode: 493 }, { path: '<img src=x onerror=alert(1)>.py', type: 'file', size: 1536, mode: 420 }] }); return true; }
    if(path===`/api/workspaces/${workspaceId}/diff`){diffReads++;await json(route,{schemaVersion:1,revision:{revisionId:'revision-one',filesSha256:'a'.repeat(64),committedAt:1000},summary:{added:1,modified:1,deleted:1},changes:[{path:'<script>alert(1)</script>.py',change:'added',type:'file',size:9,mode:420},{path:'model/main.py',change:'modified',type:'file',size:1536,mode:420},{path:'old.py',change:'deleted',type:'file',size:8,mode:420}]});return true;}
    if (path === `/api/workspaces/${workspaceId}`) { await json(route, { schemaVersion: 1, nextSequence: 1, activeTurnId: null, sessions: {}, turns: {} }); return true; }
    if (path === `/api/workspaces/${workspaceId}/events`) { await json(route, { events: [], nextSequence: 0, hasMore: false, oldestSequence: 1, snapshotRequired: false }); return true; }
  });
  await page.goto('https://ui.test/#/workspace/project-files');
  await page.getByRole('tab',{name:'Inspect',exact:true}).click();
  await page.locator('.file-entry').nth(1).waitFor();
  assert.equal(fileReads, 1);assert.equal(await page.locator('.file-entry').count(), 2);assert.equal(await page.locator('.file-entry img').count(), 0);
  assert.match(await page.locator('.file-entry').nth(1).innerText(), /<img src=x onerror=alert\(1\)>\.py.*1\.5 KB/s);
  assert.equal(diffReads,0);await page.locator('#diff-tab').click();await page.locator('#workspace-diff .file-entry').nth(2).waitFor();assert.equal(diffReads,1);assert.equal(await page.locator('#workspace-diff script').count(),0);assert.match(await page.locator('#workspace-diff').innerText(),/<script>alert\(1\)<\/script>\.py/);
  await page.locator('#files-refresh').click();await waitFor(()=>diffReads===2);assert.equal(fileReads,1);
});

test('new Session retries with the same idempotency key and selects the recovered Session', async t => {
  const workspaceId = 'workspace-new-session', attempts = [];
  let created = false;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-new-session', workspace_id: workspaceId, title: 'Session 恢复', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { await json(route, { schemaVersion: 1, nextSequence: 1, activeTurnId: null, sessions: created ? { recovered: { id: 'recovered', title: 'Session 1', createdAt: 2, updatedAt: 2 } } : {}, turns: {} }); return true; }
    if (path === `/api/workspaces/${workspaceId}/events`) { await json(route, { events: [], nextSequence: 0, hasMore: false, oldestSequence: 1, snapshotRequired: false }); return true; }
    if (path === `/api/workspaces/${workspaceId}/sessions`) {
      attempts.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
      if (attempts.length === 1) await route.abort('failed');
      else { created = true; await json(route, { session: { id: 'recovered' }, replayed: true }, 201); }
      return true;
    }
  });
  await page.goto('https://ui.test/#/workspace/project-new-session');
  await page.locator('#new-session').click();
  await page.locator('#new-session:not([disabled])').waitFor();
  assert.equal(await page.locator('#new-session').innerText(), '重试新建 Session');
  await page.locator('#new-session').click();
  await page.locator('#session-select option[value="recovered"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#session-select').inputValue(), 'recovered');
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.deepEqual(JSON.parse(attempts[0].body), { title: 'Session 1' });
});

test('message retry reuses one session and the exact Turn idempotency intent', async t => {
  const workspaceId = 'workspace-b', sessionId = 'session-b', attempts = [];
  let sessionCreated = false, turnCreated = false;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') {
      await json(route, { projects: [{ id: 'project-b', workspace_id: workspaceId, title: '恢复测试', status: 'ready' }] }); return true;
    }
    if (path === `/api/workspaces/${workspaceId}`) {
      await json(route, { schemaVersion: 1, nextSequence: turnCreated ? 2 : 1, activeTurnId: null, sessions: sessionCreated ? { [sessionId]: { id: sessionId, title: '主对话', createdAt: 1 } } : {}, turns: turnCreated ? { 'turn-b': { id: 'turn-b', sessionId, message: '构建模型', status: 'queued', errorCode: null, persistenceOutcome: null, createdAt: 2 } } : {} }); return true;
    }
    if (path === `/api/workspaces/${workspaceId}/events`) {
      await json(route, { events: [], nextSequence: 0, hasMore: false, oldestSequence: 1, snapshotRequired: false }); return true;
    }
    if (path === `/api/workspaces/${workspaceId}/sessions` && route.request().method() === 'POST') {
      sessionCreated = true; await json(route, { session: { id: sessionId }, replayed: false }, 201); return true;
    }
    if (path === `/api/workspaces/${workspaceId}/sessions/${sessionId}/turns`) {
      attempts.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
      if (attempts.length === 1) await route.abort('failed');
      else { turnCreated = true; await json(route, { turn: { id: 'turn-b', status: 'queued' }, replayed: false }, 202); }
      return true;
    }
  });
  await page.goto('https://ui.test/');
  await page.locator('.project-open').click();
  await page.locator('#message-input').fill('构建模型');
  await page.locator('#message-submit').click();
  await page.locator('#message-submit:not([disabled])').waitFor();
  assert.equal(await page.locator('#message-submit').innerText(), '重试上次请求');
  await page.locator('#message-submit').click();
  await page.locator('.turn-card.user').waitFor();
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.deepEqual(JSON.parse(attempts[0].body), { message: '构建模型' });
  assert.equal(await page.locator('.turn-card.user p').innerText(), '构建模型');
});

test('a committed Turn with a lost response is reconciled before retry is offered', async t => {
  const workspaceId = 'workspace-lost-reply', sessionId = 'session-lost-reply', message = '研究假设也是可以改的页面吗';
  let accepted = false, posts = 0, receipts = 0, requestKey = null, releaseReceipt;
  const receiptGate=new Promise(resolve=>{releaseReceipt=resolve;});
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') {
      await json(route, { projects: [{ id: 'project-lost-reply', workspace_id: workspaceId, title: '回执恢复', status: 'ready' }] }); return true;
    }
    if (path === `/api/workspaces/${workspaceId}`) {
      await json(route, { schemaVersion: 1, nextSequence: 1, activeTurnId: null, sessions: { [sessionId]: { id: sessionId, title: '主对话', createdAt: 1 } }, turns: {} }); return true;
    }
    if (path === `/api/workspaces/${workspaceId}/events`) {
      await json(route, { events: [], nextSequence: 0, hasMore: false, oldestSequence: 1, snapshotRequired: false }); return true;
    }
    if (path === `/api/workspaces/${workspaceId}/sessions/${sessionId}/turns/receipt`) {
      receipts++; assert.equal(route.request().headers()['idempotency-key'], requestKey);await receiptGate;
      await json(route, accepted ? { accepted: true, turn: { id: 'turn-lost-reply', sessionId, message, status: 'queued' } } : { error: 'not_found' }, accepted ? 200 : 404); return true;
    }
    if (path === `/api/workspaces/${workspaceId}/sessions/${sessionId}/turns` && route.request().method() === 'POST') {
      posts++; requestKey = route.request().headers()['idempotency-key']; assert.match(requestKey, /^[A-Za-z0-9_-]{1,128}$/); assert.equal(JSON.parse(route.request().postData()).message, message); accepted = true; await route.abort('failed'); return true;
    }
  });
  await page.goto('https://ui.test/'); await page.locator('.project-open').click();
  await page.locator('#message-input').fill(message); await page.locator('#message-submit').click();
  await waitFor(()=>receipts===1);assert.equal(await page.locator('#message-submit').isDisabled(),true);await page.locator('#message-form').evaluate(form=>form.requestSubmit());await page.keyboard.press('Enter');assert.equal(posts,1);
  releaseReceipt();
  await page.getByText('上次请求已由服务端接收，编辑框已恢复。', { exact: true }).waitFor();
  assert.equal(posts, 1); assert.equal(receipts, 1); assert.equal(await page.locator('#message-input').isEditable(), true); assert.equal(await page.locator('#message-input').inputValue(), ''); assert.equal(await page.locator('#message-submit').innerText(), '发送');
  assert.equal(await page.locator('[data-turn-id="turn-lost-reply"]').count(),1);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('[data-turn-id="turn-lost-reply"]').waitFor();
  assert.equal(await page.locator('[data-turn-id="turn-lost-reply"]').count(),1);
});

test('a first-session submission stays busy through delayed requests, a stale snapshot, refresh failure, and locale changes', async t => {
  const workspaceId='workspace-visible-turn',message='等待回合显示';
  let releaseSession,releaseTurn,sessionPosts=0,turnPosts=0,sessionCreated=false,accepted=false,visible=false,failRefresh=false;
  const sessionGate=new Promise(resolve=>{releaseSession=resolve;}),turnGate=new Promise(resolve=>{releaseTurn=resolve;});
  const page=await pageFixture(t,async(route,path)=>{
    if(path==='/api/me'){await json(route,{userId:'fixture-user',execution:{service:true,preview:true,simulation:true},tenants:[{id:'tenant-a'}]});return true;}
    if(path==='/api/me/locale'){await json(route,{locale:route.request().method()==='PUT'?JSON.parse(route.request().postData()).locale:null});return true;}
    if(path==='/api/tenants/tenant-a/projects'){await json(route,{projects:[{id:'project-visible-turn',workspace_id:workspaceId,title:'可见性',status:'ready'}]});return true;}
    if(path===`/api/workspaces/${workspaceId}`){if(accepted&&failRefresh){failRefresh=false;await route.abort('failed');return true;}await json(route,{schemaVersion:1,activeTurnId:null,sessions:sessionCreated?{s:{id:'s',title:'主对话',createdAt:1}}:{},turns:visible?{'turn-visible':{id:'turn-visible',sessionId:'s',message,status:'queued',createdAt:2}}:{}});return true;}
    if(path===`/api/workspaces/${workspaceId}/events`){await json(route,{events:[],nextSequence:0,hasMore:false,snapshotRequired:false});return true;}
    if(path===`/api/workspaces/${workspaceId}/sessions`){sessionPosts++;await sessionGate;sessionCreated=true;await json(route,{session:{id:'s',title:'主对话'}},201);return true;}
    if(path===`/api/workspaces/${workspaceId}/sessions/s/turns`){turnPosts++;await turnGate;accepted=true;failRefresh=true;await json(route,{turn:{id:'turn-visible',sessionId:'s',message,status:'queued'}},202);return true;}
  });
  await page.goto('https://ui.test/');await page.locator('.project-open').click();await page.locator('#message-input').fill(message);
  const turns=await page.locator('#turns').elementHandle();await page.locator('#message-submit').click();
  await page.getByRole('button',{name:'正在处理…',exact:true}).waitFor();assert.equal(await page.locator('#message-form').getAttribute('aria-busy'),'true');assert.equal(await page.locator('#new-session').isDisabled(),true);
  await waitFor(()=>sessionPosts===1);await page.locator('#new-session').evaluate(button=>button.click());await page.locator('#message-form').evaluate(form=>form.requestSubmit());await page.keyboard.press('Enter');assert.equal(sessionPosts,1);
  await page.locator('[data-locale-select]').selectOption('en');await page.waitForFunction(()=>document.documentElement.lang==='en');await page.getByRole('button',{name:'Processing…',exact:true}).waitFor();assert.equal(await page.locator('#message-status').innerText(),'Submitting request.');assert.equal(await page.evaluate(node=>node===document.querySelector('#turns'),turns),true);
  releaseSession();await waitFor(()=>turnPosts===1);await page.locator('#message-form').evaluate(form=>form.requestSubmit());assert.equal(turnPosts,1);
  releaseTurn();await page.getByText('The request was accepted and is waiting to appear in the conversation.',{exact:true}).waitFor();
  assert.equal(await page.locator('#message-submit').isDisabled(),true);await page.locator('#message-form').evaluate(form=>form.requestSubmit());assert.equal(turnPosts,1);
  await page.reload();await page.getByRole('button',{name:'Processing…',exact:true}).waitFor();assert.equal(await page.locator('#message-submit').isDisabled(),true);await page.locator('#message-form').evaluate(form=>form.requestSubmit());assert.equal(turnPosts,1);
  visible=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.locator('[data-turn-id="turn-visible"]').waitFor();await page.locator('#message-submit:not([disabled])').waitFor();
  assert.equal(turnPosts,1);assert.equal(await page.locator('[data-turn-id="turn-visible"]').count(),1);assert.equal(await page.locator('#message-input').inputValue(),'');
});

test('active Turn consumes named SSE events and stop acts on the persisted Turn id', async t => {
  const workspaceId = 'workspace-live', sessionId = 'session-live', turnId = 'turn-live';
  let cancelled = false, cancelCalls = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') {
      await json(route, { projects: [{ id: 'project-live', workspace_id: workspaceId, title: '流式回合', status: 'ready' }] }); return true;
    }
    if (path === `/api/workspaces/${workspaceId}`) {
      await json(route, { schemaVersion: 1, nextSequence: 2, activeTurnId: cancelled ? null : turnId, sessions: { [sessionId]: { id: sessionId, title: '主对话', createdAt: 1 } }, turns: { [turnId]: { id: turnId, sessionId, message: '继续执行', status: cancelled ? 'cancelled' : 'running', errorCode: null, persistenceOutcome: cancelled ? 'saved' : null, createdAt: 2 } } }); return true;
    }
    if (path === `/api/workspaces/${workspaceId}/events`) {
      if (route.request().headers().accept?.includes('text/event-stream')) {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `id: 1\nevent: provider.status\ndata: ${JSON.stringify({ sequence: 1, eventId: 'event-live', turnId, type: 'provider.status', payload: { state: 'error', status: 503 } })}\n\n` });
      } else await json(route, { events: [], nextSequence: 0, hasMore: false, oldestSequence: 1, snapshotRequired: false });
      return true;
    }
    if (path === `/api/workspaces/${workspaceId}/turns/${turnId}/cancel`) {
      cancelCalls++; cancelled = true; await json(route, { id: turnId, status: 'cancelled', persistenceOutcome: 'saved' }); return true;
    }
  });
  await page.goto('https://ui.test/');
  await page.locator('.project-open').click();
  await page.locator('#cancel-turn:not([hidden])').waitFor();
  await page.locator('.turn-card.system').filter({ hasText: '503' }).waitFor();
  await page.locator('#cancel-turn').click();
  await page.locator('#cancel-turn').waitFor({ state: 'hidden' });
  assert.equal(cancelCalls, 1);
  assert.match(await page.locator('.turn-card.user small').innerText(), /已停止.*已保存/);
});

test('tool events render one safe collapsible card per tool call with lifecycle and failure states', async t => {
  const workspaceId = 'workspace-tools', turnId = 'turn-tools';
  const artifactId = `artifact-${'a'.repeat(60)}`;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-tools', workspace_id: workspaceId, title: '工具卡', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { await json(route, { schemaVersion: 1, nextSequence: 8, activeTurnId: null, sessions: { session: { id: 'session', title: '主对话', createdAt: 1 } }, turns: { [turnId]: { id: turnId, sessionId: 'session', message: '查看项目', status: 'completed', persistenceOutcome: 'saved', createdAt: 2 } } }); return true; }
    if (path === `/api/workspaces/${workspaceId}/events`) {
      const events = [
        { sequence: 1, eventId: 'started-a', turnId, type: 'tool.started', payload: { toolCallId: 'call-a', name: 'project_list' } },
        { sequence: 2, eventId: 'updated-a', turnId, type: 'tool.updated', payload: { toolCallId: 'call-a', name: 'project_list', summary: '读取完成' } },
        { sequence: 3, eventId: 'completed-a', turnId, type: 'tool.completed', payload: { toolCallId: 'call-a', name: 'project_list', isError: false, artifact: { schemaVersion: 1, artifactId, operation: 'list', mediaType: 'application/json', bytes: 20000, sha256: 'b'.repeat(64), createdAt: 1000 } } },
        { sequence: 4, eventId: 'completed-b', turnId, type: 'tool.completed', payload: { toolCallId: 'call-b', name: '<img src=x onerror=alert(1)>', isError: true, artifact: { schemaVersion: 1, artifactId: '../escape', operation: 'list', mediaType: 'text/html', bytes: 20000, sha256: 'b'.repeat(64), createdAt: 1000 } } },
        { sequence: 5, eventId: 'updated-b', turnId, type: 'tool.updated', payload: { toolCallId: 'call-b', name: '<img src=x onerror=alert(1)>', summary: '<script>alert(1)</script>' } },
        { sequence: 6, eventId: 'started-b', turnId, type: 'tool.started', payload: { toolCallId: 'call-b', name: '<img src=x onerror=alert(1)>' } },
        { sequence: 7, eventId: 'duplicate-a', turnId, type: 'tool.updated', payload: { toolCallId: 'call-a', name: 'project_list', summary: '读取完成' } },
      ];
      await json(route, { events, nextSequence: 7, hasMore: false, oldestSequence: 1, snapshotRequired: false }); return true;
    }
  });
  await page.goto('https://ui.test/#/workspace/project-tools');
  await page.locator('.tool-card').nth(1).waitFor();
  assert.equal(await page.locator('.tool-card').count(), 2);
  await page.locator('.tool-card').nth(0).locator('summary').click();
  await page.locator('.tool-card').nth(1).locator('summary').click();
  assert.match(await page.locator('.tool-card').nth(0).innerText(), /project_list.*已完成.*读取完成/s);
  const artifactLink = page.locator('.tool-card').nth(0).locator('.tool-artifact-link');
  assert.equal(await artifactLink.innerText(), '查看完整结果 · 20 KB');
  assert.equal(await artifactLink.getAttribute('href'), `/api/workspaces/${workspaceId}/artifacts/${artifactId}`);
  assert.equal(await artifactLink.getAttribute('target'), '_blank');
  assert.equal(await artifactLink.getAttribute('rel'), 'noopener');
  assert.match(await page.locator('.tool-card').nth(1).innerText(), /失败/);
  assert.equal(await page.locator('.tool-artifact-link').count(), 1);
  assert.equal(await page.locator('.tool-card img, .tool-card script').count(), 0);
  assert.match(await page.locator('.tool-card').nth(1).innerText(), /<img src=x onerror=alert\(1\)>/);
  assert.match(await page.locator('.tool-card').nth(1).innerText(), /<script>alert\(1\)<\/script>/);
});

test('snapshot.required restores retained assistant history and reconnects from its cursor', async t => {
  const workspaceId = 'workspace-snapshot', turnId = 'turn-snapshot'; let workspaceReads = 0, streamReads = 0; const streamCursors = [];
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-snapshot', workspace_id: workspaceId, title: '恢复游标', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { workspaceReads++; await json(route, { schemaVersion: 1, nextSequence: 3, activeTurnId: workspaceReads < 3 ? turnId : null, sessions: { session: { id: 'session', title: '主对话', createdAt: 1 } }, turns: { [turnId]: { id: turnId, sessionId: 'session', message: '继续', status: workspaceReads < 3 ? 'running' : 'completed', persistenceOutcome: workspaceReads < 3 ? null : 'saved', createdAt: 2 } } }); return true; }
    if (path === `/api/workspaces/${workspaceId}/events`) {
      if (route.request().headers().accept?.includes('text/event-stream')) { streamReads++; streamCursors.push(Number(new URL(route.request().url()).searchParams.get('after_sequence') || 0)); const body = streamReads === 1 ? 'event: snapshot.required\ndata: {"oldestSequence":2,"nextSequence":4}\n\n' : `id: 3\nevent: turn.completed\ndata: ${JSON.stringify({ sequence: 3, eventId: 'terminal', turnId, type: 'turn.completed', payload: { saved: true } })}\n\n`; await route.fulfill({ status: 200, contentType: 'text/event-stream', body }); }
      else {
        const after = Number(new URL(route.request().url()).searchParams.get('after_sequence') || 0);
        const retained = { sequence: 2, eventId: 'assistant-retained', turnId, type: 'assistant.message', payload: { text: '保留窗口中的恢复结果', stopReason: 'stop' } };
        await json(route, { events: after === 1 ? [retained] : [], nextSequence: 2, hasMore: false, oldestSequence: 2, snapshotRequired: after === 0 });
      }
      return true;
    }
  });
  await page.goto('https://ui.test/#/workspace/project-snapshot');
  await page.locator('#workspace:not([hidden])').waitFor();
  await waitFor(() => streamReads === 2);
  assert.equal(streamReads, 2); assert.ok(workspaceReads >= 2); assert.equal(await page.locator('#message-error').innerText(), '');
  assert.deepEqual(streamCursors, [2, 2]); assert.match(await page.locator('#turns').innerText(), /保留窗口中的恢复结果/); assert.match(await page.locator('#turns').innerText(), /这里只显示近期对话回复/);
});

test('history truncation reads the full 2048-event retained window within the page bound', async t => {
  const workspaceId = 'workspace-retained-boundary', turnId = 'turn-retained-boundary'; let reads = 0, mutations = 0;
  const retained = Array.from({ length: 2048 }, (_, index) => ({ sequence: index + 2, eventId: `delta-${index + 2}`, turnId, type: 'assistant.delta', payload: { text: index === 2047 ? '边界回复' : '.' } }));
  const page = await pageFixture(t, async (route, path) => {
    if (route.request().method() !== 'GET') { mutations++; await route.fulfill({ status: 500, body: 'unexpected mutation' }); return true; }
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-retained-boundary', workspace_id: workspaceId, title: '保留边界', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { await json(route, { schemaVersion: 1, nextSequence: 2050, activeTurnId: null, sessions: { session: { id: 'session', title: '主对话', createdAt: 1 } }, turns: { [turnId]: { id: turnId, sessionId: 'session', message: '读取保留窗口', status: 'completed', persistenceOutcome: 'saved', createdAt: 2 } } }); return true; }
    if (path === `/api/workspaces/${workspaceId}/events`) {
      if (route.request().headers().accept?.includes('text/event-stream')) { await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }); return true; }
      reads++; const after = Number(new URL(route.request().url()).searchParams.get('after_sequence') || 0);
      if (after === 0) await json(route, { events: [], nextSequence: 2049, hasMore: false, oldestSequence: 2, snapshotRequired: true });
      else { const events = retained.filter(event => event.sequence > after).slice(0, 200); await json(route, { events, nextSequence: events.at(-1)?.sequence ?? after, hasMore: events.at(-1)?.sequence < 2049, oldestSequence: 2, snapshotRequired: false }); }
      return true;
    }
  });
  await page.goto('https://ui.test/#/workspace/project-retained-boundary'); await page.locator('#workspace:not([hidden])').waitFor();
  await waitFor(() => reads === 12);
  // Receiving the last request precedes applying its response to the DOM.
  await page.waitForFunction(() => document.querySelector('#turns').textContent.includes('边界回复'));
  assert.equal(reads, 12); assert.equal(mutations, 0); assert.match(await page.locator('#turns').innerText(), /边界回复/); assert.match(await page.locator('#turns').innerText(), /这里只显示近期对话回复/);
  await page.reload(); await page.locator('#workspace:not([hidden])').waitFor(); await waitFor(() => reads === 24); await page.waitForFunction(() => document.querySelector('#turns').textContent.includes('边界回复')); assert.equal(mutations, 0);
});

test('history window advances by rereading a retained suffix and rejects no progress', async t => {
  const workspaceId = 'workspace-retained-progress', turnId = 'turn-retained-progress'; let reads = 0, noProgressReads = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-retained-progress', workspace_id: workspaceId, title: '窗口前移', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { await json(route, { schemaVersion: 1, nextSequence: 5, activeTurnId: null, sessions: { session: { id: 'session', title: '主对话', createdAt: 1 } }, turns: { [turnId]: { id: turnId, sessionId: 'session', message: '窗口前移', status: 'completed', persistenceOutcome: 'saved', createdAt: 2 } } }); return true; }
    if (path === `/api/workspaces/${workspaceId}/events`) {
      const after = Number(new URL(route.request().url()).searchParams.get('after_sequence') || 0); reads++;
      if (after === 0) await json(route, { events: [], nextSequence: 4, hasMore: false, oldestSequence: 2, snapshotRequired: true });
      else if (after === 1) await json(route, { events: [{ sequence: 2, eventId: 'old', turnId, type: 'assistant.delta', payload: { text: '旧片段' } }], nextSequence: 2, hasMore: true, oldestSequence: 2, snapshotRequired: false });
      else if (after === 2) await json(route, { events: [], nextSequence: 5, hasMore: false, oldestSequence: 4, snapshotRequired: true });
      else await json(route, { events: [{ sequence: 4, eventId: 'new', turnId, type: 'assistant.message', payload: { text: '新片段', stopReason: 'stop' } }], nextSequence: 4, hasMore: false, oldestSequence: 4, snapshotRequired: false });
      return true;
    }
  });
  await page.goto('https://ui.test/#/workspace/project-retained-progress'); await page.locator('#workspace:not([hidden])').waitFor(); await waitFor(() => reads >= 4); await page.waitForFunction(() => document.querySelector('#turns').textContent.includes('新片段')); assert.match(await page.locator('#turns').innerText(), /新片段/); assert.equal(await page.locator('#message-error').innerText(), '');
  noProgressReads = 0;
  const stalled = await pageFixture(t, async (route, path) => { if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-stalled', workspace_id: 'workspace-stalled', title: '无进展', status: 'ready' }] }); return true; } if (path === '/api/workspaces/workspace-stalled') { await json(route, { schemaVersion: 1, nextSequence: 3, activeTurnId: null, sessions: {}, turns: {} }); return true; } if (path === '/api/workspaces/workspace-stalled/events') { noProgressReads++; await json(route, { events: [], nextSequence: 3, hasMore: false, oldestSequence: 2, snapshotRequired: true }); return true; } });
  await stalled.goto('https://ui.test/#/workspace/project-stalled'); await stalled.locator('#workspace:not([hidden])').waitFor(); await waitFor(() => noProgressReads === 2); await stalled.waitForFunction(() => document.querySelector('#message-error').textContent.includes('无法推进')); assert.equal(noProgressReads, 2); assert.match(await stalled.locator('#message-error').innerText(), /无法推进/);
});

test('assistant deltas merge once per Turn and prefer the final message safely', async t => {
  const workspaceId = 'workspace-assistant', turnId = 'turn-assistant';
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-assistant', workspace_id: workspaceId, title: '流式消息', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { await json(route, { schemaVersion: 1, nextSequence: 7, activeTurnId: null, sessions: { session: { id: 'session', title: '主对话', createdAt: 1 } }, turns: { [turnId]: { id: turnId, sessionId: 'session', message: '解释结果', status: 'completed', persistenceOutcome: 'saved', createdAt: 2 } } }); return true; }
    if (path === `/api/workspaces/${workspaceId}/events`) {
      await json(route, { events: [
        { sequence: 3, eventId: 'message', turnId, type: 'assistant.message', payload: { text: '完整答案', stopReason: 'stop' } },
        { sequence: 1, eventId: 'delta-1', turnId, type: 'assistant.delta', payload: { text: '完整' } },
        { sequence: 2, eventId: 'delta-2', turnId, type: 'assistant.delta', payload: { text: '答案' } },
        { sequence: 2, eventId: 'delta-2-replay', turnId, type: 'assistant.delta', payload: { text: '答案' } },
        { sequence: 4, eventId: 'malformed', turnId, type: 'assistant.delta', payload: null },
      ], nextSequence: 4, hasMore: false, oldestSequence: 1, snapshotRequired: false }); return true;
    }
  });
  await page.goto('https://ui.test/#/workspace/project-assistant');
  await page.locator('.turn-card.assistant').waitFor();
  assert.equal(await page.locator('.turn-card.assistant').count(), 1);
  assert.equal(await page.locator('.turn-card.assistant p').innerText(), '完整答案');
  assert.equal(await page.locator('.turn-card.assistant script, .turn-card.assistant img').count(), 0);
});

test('delta-only output is deterministic and malformed-only output stays empty', async t => {
  const workspaceId = 'workspace-delta-only';
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-delta-only', workspace_id: workspaceId, title: '增量消息', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { await json(route, { schemaVersion: 1, nextSequence: 8, activeTurnId: null, sessions: { session: { id: 'session', title: '主对话', createdAt: 1 } }, turns: {
      delta: { id: 'delta', sessionId: 'session', message: '增量', status: 'completed', persistenceOutcome: 'saved', createdAt: 2 }, malformed: { id: 'malformed', sessionId: 'session', message: '损坏', status: 'completed', persistenceOutcome: 'saved', createdAt: 3 },
    } }); return true; }
    if (path === `/api/workspaces/${workspaceId}/events`) { await json(route, { events: [
      { sequence: 3, eventId: 'delta-3', turnId: 'delta', type: 'assistant.delta', payload: { text: 'B' } },
      { sequence: 1, eventId: 'delta-1', turnId: 'delta', type: 'assistant.delta', payload: { text: 'A' } },
      { sequence: 2, eventId: 'delta-2', turnId: 'delta', type: 'assistant.delta', payload: { text: 'first' } },
      { sequence: 2, eventId: 'delta-2-replay', turnId: 'delta', type: 'assistant.delta', payload: { text: 'second' } },
      { sequence: 0, eventId: 'delta-0', turnId: 'delta', type: 'assistant.delta', payload: { text: 'ignored' } },
      { sequence: 4, eventId: 'malformed-1', turnId: 'malformed', type: 'assistant.delta', payload: null },
      { sequence: -1, eventId: 'malformed-2', turnId: 'malformed', type: 'assistant.delta', payload: { text: 'ignored' } },
    ], nextSequence: 7, hasMore: false, oldestSequence: 1, snapshotRequired: false }); return true; }
  });
  await page.goto('https://ui.test/#/workspace/project-delta-only');
  await page.locator('.turn-card.assistant').waitFor();
  assert.equal(await page.locator('.turn-card.assistant').count(), 1);
  assert.equal(await page.locator('.turn-card.assistant p').innerText(), 'AfirstB');
});

test('real browser pauses polling when hidden, resumes one chain and stops after five elapsed minutes', async t => {
  let requests = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path.endsWith('/projects')) { requests++; await json(route, { projects: [{ id: 'initializing', title: 'Initializing', status: 'provisioning' }] }); return true; }
  });
  await page.clock.install({ time: new Date('2026-09-06T00:00:00Z') });
  await page.goto('https://ui.test/');
  await page.locator('.project').waitFor();
  assert.equal(requests, 1);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.fastForward(60000);
  assert.equal(requests, 1);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => requests === 2);
  await page.locator('#projects[aria-busy=false]').waitFor();
  await page.clock.fastForward(3000);
  await waitFor(() => requests === 3);
  await page.locator('#projects[aria-busy=false]').waitFor();
  await page.clock.fastForward(300000);
  await page.locator('#notice').filter({ hasText: '已停止自动刷新' }).waitFor();
  const count = requests;
  await page.clock.fastForward(60000);
  assert.equal(requests, count);
});

test('a delayed project response cannot reveal projects or restart polling after logout', async t => {
  let release, calls = 0;
  const blocked = new Promise(resolve => { release = resolve; });
  const page = await pageFixture(t, async (route, path) => {
    if (path.endsWith('/projects')) { calls++; await blocked; await json(route, { projects: [{ title: 'Private delayed project', status: 'provisioning' }] }); return true; }
    if (path === '/api/auth/sign-out') { await json(route, { success: true }); return true; }
  });
  await page.clock.install();
  await page.goto('https://ui.test/');
  await waitFor(() => calls === 1);
  await page.locator('#sign-out').click();
  await page.locator('#login').waitFor();
  release();
  await page.clock.fastForward(10000);
  assert.equal(await page.locator('.project').count(), 0);
  assert.equal(calls, 1);
});

test('workspace service controls use server detail and survive a real page reload', async t => {
  for(const mobile of [false,true]){
    const runId='36fd497f-e7dc-40b1-9db1-c87a550a1779',workspaceId='workspace-service-ui';
    let state='running',stopCalls=0;
    const record=()=>({runId,kind:'service',deliveryStatus:'delivered',runStatus:null,createdAt:1000,updatedAt:Date.now(),stopRequestedAt:state==='stopped'?Date.now():null,errorCode:null});
    const page=await pageFixture(t,async(route,path)=>{
      if(path==='/api/tenants/tenant-a/projects'){await json(route,{projects:[{id:'service-project',workspace_id:workspaceId,title:'排队模型',status:'ready'}]});return true;}
      if(path===`/api/workspaces/${workspaceId}`){await json(route,{sessions:{},turns:{},activeTurnId:null});return true;}
      if(path.endsWith('/events')){await json(route,{events:[],nextSequence:0,hasMore:false});return true;}
      if(path===`/api/workspaces/${workspaceId}/services`){await json(route,{items:[record()],nextCursor:null});return true;}
      if(path.endsWith(`/${runId}/stop`)){stopCalls++;assert.equal(route.request().postData(),'{}');state='stopped';await json(route,record(),202);return true;}
      if(path.endsWith(`/${runId}`)){await json(route,{...record(),runStatus:state});return true;}
    },{mobile});
    await page.goto('https://ui.test/#/workspace/service-project');if(mobile)await page.locator('[data-mobile-pane=preview]').click();
    await page.waitForFunction(()=>document.querySelector('[data-service-action=stop]')?.disabled===false);
    await page.waitForFunction(()=>document.querySelector('#workspace-services')?.textContent.includes('运行中'));
    assert.match(await page.locator('#workspace-services').innerText(),/运行中/);
    assert.equal(await page.locator('#workspace-services a,#workspace-services iframe').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.M3_UI_SCREENSHOT_DIR){
      const {mkdir}=await import('node:fs/promises'),{join}=await import('node:path');await mkdir(process.env.M3_UI_SCREENSHOT_DIR,{recursive:true});
      await page.screenshot({path:join(process.env.M3_UI_SCREENSHOT_DIR,mobile?'service-mobile.png':'service-desktop.png'),fullPage:true});
    }
    await page.reload();await page.waitForFunction(()=>document.querySelector('[data-service-action=stop]')?.disabled===false);
    await page.locator('[data-service-action=stop]').click();
    await page.locator('[data-service-action=refresh]').click();
    await page.waitForFunction(()=>document.querySelector('#workspace-services')?.textContent.includes('已停止'));
    assert.equal(stopCalls,1);
    await page.locator('#workspace-back').click();assert.equal(await page.locator('#workspace-services').innerText(),'');
    await page.close();
  }
});

test('failed project retains service maintenance without making Turn or file requests', async t=>{
  let stopCalls=0;const forbidden=[];
  const row={runId:'maintenance-run',kind:'service',deliveryStatus:'delivered',runStatus:null,createdAt:1000,updatedAt:2000,stopRequestedAt:null,errorCode:null};
  const page=await pageFixture(t,async(route,path)=>{
    if(path==='/api/tenants/tenant-a/projects'){await json(route,{projects:[{id:'failed-project',workspace_id:'failed-workspace',title:'故障项目',status:'failed'}]});return true;}
    if(['/api/workspaces/failed-workspace/evidence','/api/workspaces/failed-workspace/experiments','/api/workspaces/failed-workspace/experiment-groups'].includes(path)){await json(route,{items:[],nextCursor:null});return true;}
    if(path==='/api/workspaces/failed-workspace/services'){await json(route,{items:[row],nextCursor:null});return true;}
    if(path.endsWith('/maintenance-run/stop')){stopCalls++;await json(route,{...row,stopRequestedAt:3000},202);return true;}
    if(path.endsWith('/maintenance-run')){await json(route,{...row,runStatus:stopCalls?'stopping':'running',stopRequestedAt:stopCalls?3000:null});return true;}
    if(path.startsWith('/api/workspaces/')){forbidden.push(path);await json(route,{error:'not_ready'},409);return true;}
  });
  await page.goto('https://ui.test/');await page.getByRole('button',{name:'管理项目 故障项目'}).click();
  await page.waitForFunction(()=>document.querySelector('[data-service-action=stop]')?.disabled===false);
  assert.equal(await page.locator('[data-service-action=start]').isDisabled(),true);
  assert.equal(await page.locator('#message-submit').isDisabled(),true);
  await page.locator('[data-service-action=stop]').click();await waitFor(()=>stopCalls===1);
  assert.deepEqual(forbidden,[]);
  await page.reload();await page.locator('[data-service-action=start]').waitFor();
  assert.equal(await page.locator('[data-service-action=start]').isDisabled(),true);assert.deepEqual(forbidden,[]);
  await page.close();
});

test('ready running service selects the Preview panel while maintenance project cannot launch Preview',async t=>{
 for(const mobile of [false,true]){
 let previewPosts=0;const workspace='preview-ui-workspace',row={runId:'preview-ui-run',kind:'service',deliveryStatus:'delivered',runStatus:null,createdAt:1000,updatedAt:2000,stopRequestedAt:null,errorCode:null};
 const page=await pageFixture(t,async(route,path)=>{
  if(path==='/api/tenants/tenant-a/projects'){await json(route,{projects:[{id:'preview-ui-project',workspace_id:workspace,title:'预览项目',status:'ready'},{id:'preview-failed-project',workspace_id:'preview-failed-workspace',title:'预览故障项目',status:'failed'}]});return true;}
  if(path===`/api/workspaces/${workspace}`){await json(route,{sessions:{},turns:{},activeTurnId:null});return true;}
  if(path.endsWith('/events')){await json(route,{events:[],nextSequence:0,hasMore:false});return true;}
  if(path.endsWith('/services')){await json(route,{items:[row],nextCursor:null});return true;}
  if(path.endsWith('/preview-ui-run')){await json(route,{...row,runStatus:'running'});return true;}
  if(path.endsWith('/previews')){if(route.request().method()==='POST'){previewPosts++;assert.deepEqual(JSON.parse(route.request().postData()),{runId:row.runId,expectedPreviewId:null});await json(route,{error:'preview_unavailable'},503);}else await json(route,{current:null,available:null});return true;}
 },{mobile});
 await page.goto('https://ui.test/#/workspace/preview-ui-project');if(mobile)await page.locator('[data-mobile-pane=preview]').click();await waitFor(()=>previewPosts===1);await page.locator('[data-preview-action=open]').waitFor();assert.equal(await page.locator('[data-preview-action=open]').innerText(),'重试原预览请求');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#workspace-back').click();await page.getByRole('button',{name:'管理项目 预览故障项目'}).click();if(mobile)await page.locator('[data-mobile-pane=preview]').click();await page.waitForFunction(()=>document.querySelector('#workspace-services')?.textContent.includes('运行中'));assert.equal(await page.locator('[data-service-action=start]').isDisabled(),true);const disabledOpen=page.locator('[data-preview-action=open]');if(await disabledOpen.count())assert.equal(await disabledOpen.isDisabled(),true);assert.equal(previewPosts,1);await page.close();
 }
});

test('workspace controls stay closed until the first authoritative snapshot resolves', async t => {
  const workspaceId = 'workspace-slow'; let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let sessionPosts = 0, turnPosts = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-slow', workspace_id: workspaceId, title: '慢快照', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { await blocked; await json(route, { schemaVersion: 1, sessions: {}, turns: {}, activeTurnId: null }); return true; }
    if (path === `/api/workspaces/${workspaceId}/events`) { await json(route, { events: [], nextSequence: 0, hasMore: false, snapshotRequired: false }); return true; }
    if (path === `/api/workspaces/${workspaceId}/sessions`) { sessionPosts++; await json(route, { session: { id: 'unexpected' } }, 201); return true; }
    if (path.includes('/turns')) { turnPosts++; await json(route, {}); return true; }
  });
  await page.goto('https://ui.test/#/workspace/project-slow');
  await page.locator('#workspace:not([hidden])').waitFor();
  await page.locator('#message-input').fill('草稿');
  assert.equal(await page.locator('#message-submit').isDisabled(), true);
  assert.equal(await page.locator('#new-session').isDisabled(), true);
  await page.locator('#message-form').evaluate(form => form.requestSubmit());
  assert.equal(sessionPosts, 0); assert.equal(turnPosts, 0);
  release();
  await page.locator('#message-submit:not([disabled])').waitFor();
  assert.equal(await page.locator('#message-input').inputValue(), '草稿');
});

test('selected session survives reload and remains user controlled', async t => {
  const workspaceId = 'workspace-select';
  const sessions = { a: { id: 'a', title: 'A', createdAt: 1 }, b: { id: 'b', title: 'B', createdAt: 2 } };
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-select', workspace_id: workspaceId, title: '选择', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { await json(route, { schemaVersion: 1, sessions, turns: {}, activeTurnId: null }); return true; }
    if (path === `/api/workspaces/${workspaceId}/events`) { await json(route, { events: [], nextSequence: 0, hasMore: false, snapshotRequired: false }); return true; }
  });
  await page.goto('https://ui.test/#/workspace/project-select');
  await page.locator('#session-select').waitFor();
  await page.locator('#session-select').selectOption('a');
  await page.reload();
  await page.locator('#session-select option[value="a"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#session-select').inputValue(), 'a');
});

test('response loss survives reload and explicit retry reuses session, key and body', async t => {
  const workspaceId = 'workspace-loss', sessionId = 'session-loss';
  let sessionPosts = [], turnPosts = [], abortOnce = true, sessionCreated = false;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-loss', workspace_id: workspaceId, title: '响应恢复', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) {
      await json(route, { schemaVersion: 1, sessions: sessionCreated ? { [sessionId]: { id: sessionId, title: '主对话', createdAt: 1 } } : {}, turns: {}, activeTurnId: null }); return true;
    }
    if (path === `/api/workspaces/${workspaceId}/events`) { await json(route, { events: [], nextSequence: 0, hasMore: false, snapshotRequired: false }); return true; }
    if (path === `/api/workspaces/${workspaceId}/sessions` && route.request().method() === 'POST') {
      sessionPosts.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() }); sessionCreated = true;
      await json(route, { session: { id: sessionId, title: '主对话' } }, 201); return true;
    }
    if (path === `/api/workspaces/${workspaceId}/sessions/${sessionId}/turns`) {
      const request = { key: route.request().headers()['idempotency-key'], body: route.request().postData() }; turnPosts.push(request);
      if (abortOnce) { abortOnce = false; await route.abort('failed'); } else await json(route, { turn: { id: 'turn-loss', status: 'queued' } }, 202);
      return true;
    }
  });
  await page.goto('https://ui.test/#/workspace/project-loss');
  await page.locator('#message-input').fill('保留这条消息');
  await page.locator('#message-submit').click();
  await page.locator('#message-submit:not([disabled])').waitFor();
  assert.equal(sessionPosts.length, 1); assert.equal(turnPosts.length, 1);
  const first = turnPosts[0];
  await page.reload();
  await page.locator('#message-submit').waitFor();
  assert.equal(await page.locator('#message-input').inputValue(), '保留这条消息');
  assert.equal(turnPosts.length, 1, 'reload must not replay the request');
  await page.locator('#message-submit').click();
  await waitFor(() => turnPosts.length === 2);
  assert.deepEqual(turnPosts[1], first);
  assert.equal(sessionPosts.length, 1, 'retry must keep the original Session');
});

test('lost Session creation response recovers its original key after reload', async t => {
  let created=false, lose=true;const sessionPosts=[],turnPosts=[];
  const page=await pageFixture(t,async(route,path)=>{
    if(path==='/api/tenants/tenant-a/projects'){await json(route,{projects:[{id:'session-ack-project',workspace_id:'session-ack-workspace',title:'Session ack',status:'ready'}]});return true;}
    if(path==='/api/workspaces/session-ack-workspace'){await json(route,{sessions:created?{known:{id:'known',title:'主对话',createdAt:1}}:{},turns:{},activeTurnId:null});return true;}
    if(path.endsWith('/events')){await json(route,{events:[],nextSequence:0,hasMore:false});return true;}
    if(path==='/api/workspaces/session-ack-workspace/sessions'){sessionPosts.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()});created=true;if(lose){lose=false;await route.abort('failed');}else await json(route,{session:{id:'known',title:'主对话'}},201);return true;}
    if(path==='/api/workspaces/session-ack-workspace/sessions/known/turns'){turnPosts.push(route.request().postData());await json(route,{turn:{id:'turn-known',status:'queued'}},202);return true;}
  });
  await page.goto('https://ui.test/#/workspace/session-ack-project');await page.locator('#message-input').fill('恢复 Session 接收收据');await page.locator('#message-submit').click();await waitFor(()=>sessionPosts.length===1);await page.locator('#message-submit:not([disabled])').waitFor();assert.equal(turnPosts.length,0);
  await page.reload();await page.locator('#message-submit:not([disabled])').waitFor();assert.equal(await page.locator('#message-input').inputValue(),'恢复 Session 接收收据');assert.equal(sessionPosts.length,1);await page.locator('#message-submit').click();await waitFor(()=>turnPosts.length===1);assert.equal(sessionPosts.length,2);assert.deepEqual(sessionPosts[0],sessionPosts[1]);
});

test('preacceptance turn errors release the frozen intent while preserving an editable draft', async t => {
  for (const status of [400, 413]) {
    const workspaceId = `workspace-preaccept-${status}`, sessionId = `session-preaccept-${status}`;
    const attempts = [];
    const page = await pageFixture(t, async (route, path) => {
      if (path === `/api/tenants/tenant-a/projects`) { await json(route, { projects: [{ id: `project-preaccept-${status}`, workspace_id: workspaceId, title: '请求校验', status: 'ready' }] }); return true; }
      if (path === `/api/workspaces/${workspaceId}`) { await json(route, { schemaVersion: 1, sessions: { [sessionId]: { id: sessionId, title: '主对话', createdAt: 1 } }, turns: {}, activeTurnId: null }); return true; }
      if (path.endsWith('/events')) { await json(route, { events: [], nextSequence: 0, hasMore: false, snapshotRequired: false }); return true; }
      if (path === `/api/workspaces/${workspaceId}/sessions/${sessionId}/turns`) { attempts.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() }); await json(route, { error: status === 400 ? 'invalid_input' : 'body_too_large' }, attempts.length === 1 ? status : 202); return true; }
    });
    await page.goto(`https://ui.test/#/workspace/project-preaccept-${status}`);
    await page.locator('#message-input').fill('原始草稿'); await page.locator('#message-submit').click();
    await page.locator('#message-submit:not([disabled])').waitFor();
    assert.equal(await page.locator('#message-input').isEditable(), true);
    assert.equal(await page.locator('#message-input').inputValue(), '原始草稿');
    await page.reload(); await page.locator('#message-submit:not([disabled])').waitFor();
    assert.equal(await page.locator('#message-input').inputValue(), '原始草稿');
    await page.locator('#message-input').fill('修改后的草稿'); await page.locator('#message-submit').click();
    await waitFor(() => attempts.length === 2);
    assert.equal(JSON.parse(attempts[1].body).message, '修改后的草稿');
    await page.close();
  }
});

test('unknown turn errors and conflicts retain the original frozen request across reload', async t => {
  for (const status of [409, 500]) {
    const workspaceId = `workspace-frozen-${status}`, sessionId = `session-frozen-${status}`, attempts = [];
    const page = await pageFixture(t, async (route, path) => {
      if (path === `/api/tenants/tenant-a/projects`) { await json(route, { projects: [{ id: `project-frozen-${status}`, workspace_id: workspaceId, title: '请求恢复', status: 'ready' }] }); return true; }
      if (path === `/api/workspaces/${workspaceId}`) { await json(route, { schemaVersion: 1, sessions: { [sessionId]: { id: sessionId, title: '主对话', createdAt: 1 } }, turns: {}, activeTurnId: null }); return true; }
      if (path.endsWith('/events')) { await json(route, { events: [], nextSequence: 0, hasMore: false, snapshotRequired: false }); return true; }
      if (path === `/api/workspaces/${workspaceId}/sessions/${sessionId}/turns`) { attempts.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() }); await json(route, { error: 'fixture' }, status); return true; }
    });
    await page.goto(`https://ui.test/#/workspace/project-frozen-${status}`);
    await page.locator('#message-input').fill('不可替换的请求'); await page.locator('#message-submit').click();
    await page.locator('#message-submit:not([disabled])').waitFor();
    assert.equal(await page.locator('#message-input').isEditable(), false);
    await page.reload(); await page.locator('#message-submit:not([disabled])').waitFor();
    assert.equal(await page.locator('#message-input').isEditable(), false);
    await page.locator('#message-submit').click(); await waitFor(() => attempts.length === 2);
    assert.deepEqual(attempts[1], attempts[0]);
    await page.close();
  }
});

test('turn request limit counts UTF-8 JSON bytes before creating a request', async t => {
  const workspaceId = 'workspace-byte-limit', sessionId = 'session-byte-limit'; let posts = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path === `/api/tenants/tenant-a/projects`) { await json(route, { projects: [{ id: 'project-byte-limit', workspace_id: workspaceId, title: '字节限制', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { await json(route, { schemaVersion: 1, sessions: { [sessionId]: { id: sessionId, title: '主对话', createdAt: 1 } }, turns: {}, activeTurnId: null }); return true; }
    if (path.endsWith('/events')) { await json(route, { events: [], nextSequence: 0, hasMore: false, snapshotRequired: false }); return true; }
    if (path === `/api/workspaces/${workspaceId}/sessions/${sessionId}/turns`) { posts++; await json(route, {}); return true; }
  });
  await page.goto('https://ui.test/#/workspace/project-byte-limit');
  for (const message of ['a'.repeat(9000), '界'.repeat(3000), '"'.repeat(5000)]) {
    await page.locator('#message-input').fill(message); await page.locator('#message-submit').click();
    assert.equal(posts, 0); assert.match(await page.locator('#message-error').innerText(), new RegExp(String(JSON_REQUEST_MAX_BYTES)));
    assert.equal(await page.locator('#message-input').isEditable(), true);
  }
  const exact = 'a'.repeat(JSON_REQUEST_MAX_BYTES - Buffer.byteLength(JSON.stringify({message:''})));
  await page.locator('#message-input').fill(exact); await page.locator('#message-submit').click();
  await waitFor(() => posts === 1);
});

test('a persisted oversized message intent is released before retry preflight', async t => {
  const workspaceId = 'workspace-old-oversized-intent', sessionId = 'session-old-oversized-intent'; let posts = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path === `/api/tenants/tenant-a/projects`) { await json(route, { projects: [{ id: 'project-old-oversized-intent', workspace_id: workspaceId, title: '旧请求', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { await json(route, { schemaVersion: 1, sessions: { [sessionId]: { id: sessionId, title: '主对话', createdAt: 1 } }, turns: {}, activeTurnId: null }); return true; }
    if (path.endsWith('/events')) { await json(route, { events: [], nextSequence: 0, hasMore: false, snapshotRequired: false }); return true; }
    if (path === `/api/workspaces/${workspaceId}/sessions/${sessionId}/turns` && route.request().method()==='POST') { posts++; await json(route, {}); return true; }
  });
  const message = '界'.repeat(3000);
  await page.addInitScript(({ key, message: value, sessionId: sid }) => sessionStorage.setItem(key, JSON.stringify({ schemaVersion: 1, draft: value, messageIntent: { key: 'old-key', sessionId: sid, message: value } })), { key: `riffology:conversation:tenant-a:${workspaceId}`, message, sessionId });
  await page.goto('https://ui.test/#/workspace/project-old-oversized-intent');
  await page.locator('#message-submit:not([disabled])').waitFor(); await page.locator('#message-submit').click();
  assert.equal(posts, 0); assert.equal(await page.locator('#message-input').isEditable(), true);
  await page.locator('#message-input').fill('缩短后的请求'); await page.locator('#message-submit').click();
  await waitFor(() => posts === 1);
});

test('another preparing project keeps polling to ready while the first project owns the notice', {timeout:15000}, async t => {
  const a={id:'prepare-a',title:'准备项目 A',status:'provisioning',workspace_id:'workspace-a'};
  let b={id:'prepare-b',title:'准备项目 B',status:'provisioning',workspace_id:'workspace-b'},created=false,listReads=0;
  const posts=[];
  const page=await pageFixture(t,async(route,path)=>{
    if(route.request().method()==='POST')posts.push(path);
    if(path==='/api/tenants/tenant-a/projects'){
      if(route.request().method()==='POST'){created=true;await json(route,{project:a},202);}
      else{listReads++;await json(route,{projects:created?[a,b]:[b]});}return true;
    }
    if(path==='/api/workspaces/workspace-b'){await json(route,{schemaVersion:3,activeTurnId:null,sessions:{s:{id:'s',title:'B 对话',createdAt:1}},turns:{}});return true;}
    if(path==='/api/workspaces/workspace-b/events'){await json(route,{events:[],nextSequence:0,hasMore:false});return true;}
  });
  page.setDefaultTimeout(8000);await page.goto('https://ui.test/');await page.locator('#new-project').click();await page.locator('#project-title').fill(a.title);await page.locator('#project-submit').click();await page.locator('#notice').filter({hasText:'项目正在准备中'}).waitFor();
  await page.getByRole('button',{name:'管理项目 '+b.title,exact:true}).click();await page.locator('#workspace-title').filter({hasText:b.title}).waitFor();assert.equal(await page.locator('#message-input').isDisabled(),true);const before=listReads;b={...b,status:'ready'};
  // No visibility event or manual refresh: the actual scheduled project poll must recover B.
  await page.locator('#message-input:not([disabled])').waitFor();assert.ok(listReads>before);assert.equal(await page.locator('#workspace-title').innerText(),b.title);assert.match(await page.locator('#notice').innerText(),/项目正在准备中/);assert.deepEqual(posts,['/api/tenants/tenant-a/projects']);
});

test('authorization reload into another tenant drops the old tenant pending project fallback', {timeout:15000}, async t => {
  const pending={id:'private-pending-a',title:'旧租户未同步的私有项目',status:'provisioning',workspace_id:'private-workspace-a'};
  const ready={id:'ready-a',title:'旧租户活动项目',status:'ready',workspace_id:'active-workspace-a'};
  let tenantId='tenant-a',created=false,streamConnected=false,newTenantReads=0,releaseStream;
  const streamGate=new Promise(resolve=>releaseStream=resolve);
  t.after(()=>releaseStream());
  const page=await pageFixture(t,async(route,path)=>{
    if(path==='/api/me'){await json(route,{tenants:[{id:tenantId}]});return true;}
    if(path==='/api/tenants/tenant-a/projects'){
      if(route.request().method()==='POST'){created=true;await json(route,{project:pending},202);}
      else await json(route,{projects:[ready]});return true;
    }
    if(path==='/api/tenants/tenant-b/projects'){newTenantReads++;await json(route,{projects:[]});return true;}
    if(path==='/api/workspaces/active-workspace-a'){await json(route,{schemaVersion:3,activeTurnId:'active',sessions:{s:{id:'s',title:'旧会话',createdAt:1}},turns:{active:{id:'active',sessionId:'s',message:'已有任务',status:'running',createdAt:1}}});return true;}
    if(path==='/api/workspaces/active-workspace-a/events'){
      if(route.request().headers().accept?.includes('text/event-stream')){streamConnected=true;await streamGate;await route.fulfill({contentType:'text/event-stream',body:'event: stream.closed\ndata: {"reason":"authorization_changed"}\n\n'});}
      else await json(route,{events:[],nextSequence:0,hasMore:false});return true;
    }
  });
  page.setDefaultTimeout(8000);await page.goto('https://ui.test/');await page.locator('#new-project').click();await page.locator('#project-title').fill(pending.title);await page.locator('#project-submit').click();await page.getByRole('button',{name:'管理项目 '+pending.title,exact:true}).waitFor();assert.equal(created,true);
  // Old list still omits the newly created project, so its fallback remains pending when opening another Workspace.
  await page.getByRole('button',{name:'打开项目 '+ready.title,exact:true}).click();await waitFor(()=>streamConnected);tenantId='tenant-b';releaseStream();
  await waitFor(()=>newTenantReads>0);await page.locator('#app:not([hidden])').waitFor();await page.locator('#projects[aria-busy=false]').waitFor();assert.equal(await page.locator('#projects .project').count(),0);assert.doesNotMatch(await page.locator('#projects').innerText(),/旧租户|private-pending-a/);assert.equal(await page.locator('#workspace').isVisible(),false);
});

for(const usage of [{status:'observed',inputTokens:100,outputTokens:20,totalTokens:120,settlement:'pending'},{status:'unknown',reason:'missing'},{status:'observed',inputTokens:100,outputTokens:-1,totalTokens:99}])test(`Managed UI distinguishes ${usage.status} usage from settlement and resource cleanup (${usage.outputTokens??'missing'})`,async t=>{
 const workspaceId='managed-workspace',sessionId='managed-session',turnId='managed-turn';
 const page=await pageFixture(t,async(route,path)=>{
  if(path==='/api/tenants/tenant-a/projects'){await json(route,{projects:[{id:'managed-project',workspace_id:workspaceId,title:'Managed synthetic',status:'ready'}]});return true;}
  if(path===`/api/workspaces/${workspaceId}`){await json(route,{schemaVersion:3,nextSequence:2,activeTurnId:null,sessions:{[sessionId]:{id:sessionId,title:'Managed',createdAt:1}},turns:{[turnId]:{id:turnId,sessionId,message:'Synthetic model',status:'completed',executionOutcome:'completed',persistenceOutcome:'failed',persistenceErrorCode:'managed-candidate-schema',createdAt:2}}});return true;}
  if(path===`/api/workspaces/${workspaceId}/events`){await json(route,{events:[{sequence:1,eventId:'managed-usage',turnId,workspaceId,runtimeGeneration:1,type:'provider.status',at:3,payload:{backend:'managed-agents',usage,billing:'pending',resources:'session-retained',remoteSessionId:'PRIVATE_PROVIDER_SESSION',apiKey:'SECRET_PROVIDER_KEY'}}],nextSequence:1,hasMore:false,oldestSequence:1,snapshotRequired:false});return true;}
 });
 await page.goto('https://ui.test/#/workspace/managed-project');await page.locator('#turns').getByText(/Managed 用量/).waitFor();const text=await page.locator('#turns').innerText();
 assert.match(text,/已完成 · 保存失败/);assert.match(text,/费用尚未结算/);assert.match(text,/不代表正式实验通过/);assert.match(text,/回合结束时远端会话仍保留/);
 if(usage.status==='observed'&&usage.outputTokens>=0)assert.match(text,/输入 100 Token，输出 20 Token/);else assert.match(text,/用量尚未确认/);
 assert.doesNotMatch(text,/PRIVATE_PROVIDER_SESSION|SECRET_PROVIDER_KEY|费用已结算/);
});

test('Pi historical execution block disables sends after reload while retaining local draft and readable workspace',async t=>{
 let posts=0,blocked=false;
 const page=await pageFixture(t,async(route,path)=>{
  if(path==='/api/tenants/tenant-a/projects'){await json(route,{projects:[{id:'pi-project',workspace_id:'pi-workspace',title:'Pi 开发者测试',status:'ready'}]});return true;}
  if(path==='/api/workspaces/pi-workspace'){await json(route,{schemaVersion:1,sessions:{session:{id:'session',title:'主对话',createdAt:1}},turns:{},activeTurnId:null,admission:{state:'enabled'},piDeveloperState:{billingMode:'observe',blocked:blocked?'pi-developer-execution-unconfirmed':null}});return true;}
  if(path.endsWith('/events')){await json(route,{events:[],nextSequence:0,hasMore:false,snapshotRequired:false});return true;}
  if(route.request().method()==='POST'){posts++;await json(route,{error:'unexpected'},500);return true;}
 });
 await page.goto('https://ui.test/#/workspace/pi-project');
 await page.locator('#message-input:enabled').waitFor();
 await page.locator('#message-input').fill('保留的草稿');blocked=true;await page.reload();
 await page.getByText('账号存在执行结果尚未确认的模型调用。请停止重试并核对原任务；新建项目不能绕过此状态。').waitFor();
 assert.equal(await page.locator('#message-submit').isDisabled(),true);assert.equal(await page.locator('#message-input').inputValue(),'保留的草稿');assert.equal(posts,0);
});

test('stored HTTP notices switch language without a refresh or another product request',async t=>{
 const calls=[];const page=await pageFixture(t,async(route,path)=>{
  calls.push({path,method:route.request().method()});
  if(path==='/api/tenants/tenant-a/projects'){await json(route,{error:'temporarily_unavailable'},503);return true;}
 });
 await page.goto('https://ui.test/');await page.locator('#notice').filter({hasText:'服务暂不可用'}).waitFor();
 const before=calls.length;await page.evaluate(()=>window.noticeNode=document.querySelector('#notice span'));
 await page.locator('[data-locale-select]').selectOption('en');
 assert.equal(await page.locator('#notice').innerText(),'The service is unavailable. Try again later.');
 assert.equal(await page.evaluate(()=>window.noticeNode===document.querySelector('#notice span')),true);
 assert.deepEqual(calls.slice(before),[]);assert.equal(new URL(page.url()).hash,'');
});
