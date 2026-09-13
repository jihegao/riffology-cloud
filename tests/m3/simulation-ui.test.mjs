import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

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
  const context = await browser.newContext(); t.after(() => context.close());
  const page = await context.newPage(); const files = {};
  for (const name of ['index.html', 'app.js', 'services.js', 'previews.js', 'simulation.js', 'styles.css', 'workspace.css']) files[name] = await readFile(new URL(`../../services/web/${name}`, import.meta.url), 'utf8');
  let experiments = [], posts = 0, failOnce = true;const attempts=[];
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.startsWith('/api/')) {
      if (path === '/api/auth/get-session') return json(route, { user: { id: 'u' } });
      if (path === '/api/me') return json(route, { tenants: [{ id: 't' }] });
      if (path === '/api/models') return json(route, { models: [] });
      if (path === '/api/tenants/t/projects') return json(route, { projects: [{ id: 'p', title: 'P', status: 'ready', workspace_id: 'w' }] });
      if (path === '/api/workspaces/w/model') return json(route, { version: { revisionId: 'r', filesSha256: 'f', specSha256: 's' }, spec: { parameters: { servers: { type: 'integer', default: 1, minimum: 1, maximum: 4 }, mode: { type: 'enum', values: ['fast', 'safe'], default: 'fast' }, warm: { type: 'boolean', default: true } } }, reasonCode: null, canRun: true });
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
  await page.goto('https://ui.test/'); await page.locator('.project-open').click(); await page.locator('#workspace-simulation input[name="servers"]').waitFor();
  assert.equal(await page.locator('#workspace-simulation input[name="servers"]').getAttribute('type'), 'number'); assert.equal(await page.locator('#workspace-simulation input[name="warm"]').getAttribute('type'), 'checkbox'); assert.equal(await page.locator('#workspace-simulation select[name="mode"]').count(), 1); assert.equal(posts, 0);
  await page.locator('#workspace-simulation input[name="servers"]').fill('2');
  await page.locator('#workspace-simulation button[type="submit"]').click();
  await page.getByText('重试实验',{exact:true}).waitFor();assert.equal(posts,1);
  assert.equal(await page.locator('#workspace-simulation input[name="servers"]').inputValue(),'2');
  assert.equal(await page.locator('#workspace-simulation input[name="servers"]').isDisabled(),true);
  assert.match(await page.locator('#workspace-simulation').innerText(),/revision r.*files f.*spec s.*seed 42/);
  await page.reload();
  await page.getByText('重试实验',{exact:true}).waitFor();
  assert.equal(await page.locator('#workspace-simulation input[name="servers"]').inputValue(),'2');
  assert.equal(await page.locator('#workspace-simulation input[name="servers"]').isDisabled(),true);
  await page.getByText('重试实验',{exact:true}).click();
  await page.locator('#workspace-simulation').getByText(/completed/).waitFor();assert.equal(posts,2);assert.deepEqual(attempts[0],attempts[1]);
  await page.getByText('刷新模型与实验',{exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#workspace-simulation input[name="servers"]')?.value==='2');assert.equal(posts,2);
  assert.match(await page.locator('#workspace-simulation').innerText(),/版本 r/);
});
