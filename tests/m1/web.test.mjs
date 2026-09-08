import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { renderWorkspace } from '../../ui/workspace.js';

const files = Object.fromEntries(await Promise.all(['index.html', 'app.js', 'styles.css', 'workspace.css'].map(async name => [name, await readFile(new URL(`../../services/web/${name}`, import.meta.url), 'utf8')])));
const workspaceUiSource = await readFile(new URL('../../ui/workspace.js', import.meta.url), 'utf8');
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.M1_BROWSER_CHANNEL || 'chrome' }); });
after(async () => { await browser?.close(); });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function pageFixture(t, handle, options = {}) {
  const context = await browser.newContext({ viewport: options.mobile ? { width: 390, height: 844 } : { width: 1200, height: 800 } });
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
      if (url.pathname === '/api/me') return json(route, { tenants: [{ id: 'tenant-a' }] });
      if (url.pathname === '/api/models') return json(route, { models: [] });
      if (url.pathname === '/api/tenants/tenant-a/projects') return json(route, { projects: [] });
      if (/^\/api\/workspaces\/[^/]+\/files$/.test(url.pathname)) return json(route, { schemaVersion: 1, revision: null, files: [] });
      if (/^\/api\/workspaces\/[^/]+\/diff$/.test(url.pathname)) return json(route, { schemaVersion: 1, revision: null, summary: { added: 0, modified: 0, deleted: 0 }, changes: [] });
      throw Error(`unexpected request ${url.pathname}`);
    }
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return route.fulfill({ contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: files[name] || '', status: files[name] ? 200 : 404 });
  });
  return page;
}
async function waitFor(check) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); } assert.ok(check(), 'condition timed out'); }

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

test('real browser renders 401/503 errors and exposes invitation acceptance for an authenticated unadmitted user', async t => {
  for (const status of [401, 404, 503]) {
    const page = await pageFixture(t, async (route, path) => {
      if (path === '/api/me') { await json(route, { error: 'fixture' }, status); return true; }
    });
    await page.goto('https://ui.test/');
    await page.locator('#notice:not([hidden])').waitFor();
    assert.match(await page.locator('#notice').innerText(), status === 404 ? /邀请码/ : status === 503 ? /服务暂不可用/ : /请先登录/);
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
  assert.equal(await page.locator('.project .status').innerText(), '准备中');
  await page.clock.fastForward(3000);
  await page.locator('.project .status').filter({ hasText: '就绪' }).waitFor();
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
  assert.match(await page.locator('.boundary-note').innerText(), /平台负责身份、Session、Turn、预算、保存与恢复/);
  assert.match(await page.locator('.boundary-note').innerText(), /项目内 Pi 只通过受控工具/);
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
  await waitFor(() => page.locator('#login').evaluate(element => element.hidden));
  assert.equal(await page.locator('#app').isVisible(), false);
  release();
  await page.locator('#workspace:not([hidden])').waitFor();
  assert.equal(await page.locator('#workspace-title').innerText(), '直达项目');
});

test('invalid or foreign project hash never opens a workspace', async t => {
  let workspaceReads = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'other-project', workspace_id: 'other-workspace', title: '其他租户项目', status: 'ready' }] }); return true; }
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
  assert.equal(await page.locator('#message-submit').innerText(), '重试');
  await page.locator('#message-submit').click();
  await page.locator('.turn-card.user').waitFor();
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.deepEqual(JSON.parse(attempts[0].body), { message: '构建模型' });
  assert.equal(await page.locator('.turn-card.user p').innerText(), '构建模型');
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

test('snapshot.required closes the stale stream and restores from a fresh snapshot cursor once', async t => {
  const workspaceId = 'workspace-snapshot', turnId = 'turn-snapshot'; let workspaceReads = 0, streamReads = 0;
  const page = await pageFixture(t, async (route, path) => {
    if (path === '/api/tenants/tenant-a/projects') { await json(route, { projects: [{ id: 'project-snapshot', workspace_id: workspaceId, title: '恢复游标', status: 'ready' }] }); return true; }
    if (path === `/api/workspaces/${workspaceId}`) { workspaceReads++; await json(route, { schemaVersion: 1, nextSequence: 3, activeTurnId: workspaceReads < 3 ? turnId : null, sessions: { session: { id: 'session', title: '主对话', createdAt: 1 } }, turns: { [turnId]: { id: turnId, sessionId: 'session', message: '继续', status: workspaceReads < 3 ? 'running' : 'completed', persistenceOutcome: workspaceReads < 3 ? null : 'saved', createdAt: 2 } } }); return true; }
    if (path === `/api/workspaces/${workspaceId}/events`) {
      if (route.request().headers().accept?.includes('text/event-stream')) { streamReads++; const body = streamReads === 1 ? 'event: snapshot.required\ndata: {"oldestSequence":2,"nextSequence":3}\n\n' : `id: 2\nevent: turn.completed\ndata: ${JSON.stringify({ sequence: 2, eventId: 'terminal', turnId, type: 'turn.completed', payload: { saved: true } })}\n\n`; await route.fulfill({ status: 200, contentType: 'text/event-stream', body }); }
      else await json(route, { events: [], nextSequence: 2, hasMore: false, oldestSequence: 2, snapshotRequired: streamReads === 0 });
      return true;
    }
  });
  await page.goto('https://ui.test/#/workspace/project-snapshot');
  await page.locator('#workspace:not([hidden])').waitFor();
  await waitFor(() => streamReads === 2);
  assert.equal(streamReads, 2); assert.ok(workspaceReads >= 2); assert.equal(await page.locator('#message-error').innerText(), '');
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
    if (path.endsWith('/projects')) { requests++; await json(route, { projects: [{ title: 'Initializing', status: 'provisioning' }] }); return true; }
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
