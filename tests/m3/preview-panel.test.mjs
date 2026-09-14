import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const control = 'https://app.example.test';
const preview = 'https://p-' + 'a'.repeat(40) + '.preview.example.test';
const base = '/api/workspaces/work-a/previews';
const ticket = 'c'.repeat(64), nonce = 'b'.repeat(64);

async function fixture(t, setup = {}) {
  const browser = await chromium.launch({ headless: true, channel: process.env.M1_BROWSER_CHANNEL || 'chrome' });
  t.after(() => browser.close());
  const context = await browser.newContext(); t.after(() => context.close());
  const page = await context.newPage();
  const calls = [], pending = [];
  let postFailure = setup.postFailure || false;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/previews.js') return route.fulfill({ contentType: 'application/javascript', body: readFileSync(new URL('../../services/web/previews.js', import.meta.url), 'utf8') });
    if (url.origin === control) return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    if (url.origin === preview) return route.fulfill({ contentType: 'text/html', body: '<script>window.received=null;addEventListener("message",e=>window.received=e.data);</script>' });
    if (url.origin === 'https://evil.example.test') return route.fulfill({ contentType: 'text/html', body: '<p>evil sibling</p>' });
    return route.abort();
  });
  await page.goto(control + '/');
  await page.evaluate(async () => { const module = await import('/previews.js'); window.calls = []; window.mode = 'normal'; window.panel = module.createPreviewPanel({ root: document.querySelector('#root'), requestTimeoutMs: 100, api: async (path, options = {}) => { window.calls.push({ path, method: options.method || 'GET', headers: options.headers || {}, body: options.body || null }); if (window.mode === 'delay') return new Promise(resolve => { window.release = () => resolve({ current: null, available: null }); }); if (!options.method && window.mode === 'read-unavailable') throw Object.assign(Error('服务暂不可用，请稍后再试'), { status: 503 }); if (path.endsWith('/tickets') && window.mode === 'ticket-delay') return new Promise(resolve => { window.releaseTicket = () => resolve({ ticket: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', expiresAt: Date.now() + 10000 }); }); if (options.method === 'POST' && window.mode === 'unknown') throw Error('network-lost'); if (options.method === 'POST' && window.mode === 'conflict') throw Object.assign(Error('conflict'), { status: 409 }); if (path.endsWith('/tickets')) return { ticket: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', expiresAt: Date.now() + 10000 }; if (options.method === 'POST') return { previewId: 'preview-new', runId: 'run-a', bootstrapUrl: 'https://p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.preview.example.test/__riff/bootstrap', expiresAt: Date.now() + (window.mode === 'short' ? 3000 : 60000) }; return { current: { previewId: 'preview-old', runId: 'run-a', expiresAt: Date.now() - 1, revokedAt: 1 }, available: { previewId: 'preview-old', runId: 'run-a', bootstrapUrl: 'https://p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.preview.example.test/__riff/bootstrap', expiresAt: Date.now() + 60000 } }; } }); });
  return { page, calls };
}

async function readyPreviewFrame(page) {
  const iframe = page.getByTitle('项目预览');
  await iframe.waitFor();
  const handle = await iframe.elementHandle();
  const frame = await handle.contentFrame();
  assert.ok(frame);
  await frame.waitForURL(url => url.origin === preview);
  await frame.waitForFunction(() => Object.hasOwn(window, 'received'));
  return frame;
}

test('normal preview protocol uses CAS body, idempotency key, exact source/origin, and ticket postMessage', async t => {
  const f = await fixture(t); await f.page.evaluate(() => window.panel.enter({ tenantId: 'tenant-a', workspaceId: 'work-a', canOpen: true }));
  await f.page.evaluate(() => window.panel.selectRun('run-a')); await f.page.getByRole('button', { name: '打开预览' }).click();
  await f.page.getByTitle('项目预览').waitFor();
  const frame = await readyPreviewFrame(f.page); assert.ok(frame);
  await frame.evaluate(({ n, control }) => parent.postMessage({ type: 'riffology-preview-ready', nonce: n }, control), { n: nonce, control });
  await f.page.waitForFunction(() => window.calls.some(call => call.path.endsWith('/tickets')));
  const calls = await f.page.evaluate(() => window.calls); const post = calls.find(call => call.method === 'POST' && call.path === base); assert.ok(post);
  assert.match(post.headers['Idempotency-Key'], /^[A-Za-z0-9_-]{1,128}$/); assert.deepEqual(JSON.parse(post.body), { runId: 'run-a', expectedPreviewId: 'preview-old' });
  assert.deepEqual(JSON.parse(calls.find(call => call.path.endsWith('/tickets')).body), { nonce });
  await frame.waitForFunction(() => window.received?.type === 'riffology-preview-ticket'); assert.deepEqual(await frame.evaluate(() => window.received), { type: 'riffology-preview-ticket', ticket });
  await frame.evaluate(() => window.sentinel = 'kept'); const frameUrl = await f.page.locator('iframe').getAttribute('src'); await f.page.evaluate(() => window.panel.selectRun('run-b')); assert.equal(await f.page.locator('iframe').getAttribute('src'), frameUrl); assert.equal(await f.page.locator('iframe').count(), 1); assert.equal(await frame.evaluate(() => window.sentinel), 'kept'); assert.equal((await frame.evaluate(() => window.received)).ticket, ticket);
  assert.equal(await f.page.evaluate(() => sessionStorage.length), 0);
});

test('forged source or origin messages never redeem a ticket', async t => {
  const f = await fixture(t); await f.page.evaluate(() => window.panel.enter({ tenantId: 'tenant-a', workspaceId: 'work-a', canOpen: true })); await f.page.evaluate(() => window.panel.selectRun('run-a')); await f.page.getByRole('button', { name: '打开预览' }).click();
  await f.page.getByTitle('项目预览').waitFor();
  await f.page.evaluate(({ nonce, preview }) => {
    window.dispatchEvent(new MessageEvent('message', { origin: preview, source: window, data: { type: 'riffology-preview-ready', nonce } }));
    const sibling = document.createElement('iframe'); sibling.src = location.origin + '/sibling'; document.body.append(sibling); sibling.onload = () => window.dispatchEvent(new MessageEvent('message', { origin: preview, source: sibling.contentWindow, data: { type: 'riffology-preview-ready', nonce } }));
    const target = document.querySelector('iframe[title="项目预览"]'); window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example.test', source: target.contentWindow, data: { type: 'riffology-preview-ready', nonce } }));
  }, { nonce, preview });
  await f.page.waitForTimeout(30); assert.equal((await f.page.evaluate(() => window.calls)).some(call => call.path.endsWith('/tickets')), false);
});

test('unknown POST outcome preserves the original request for retry, while 409 clears it', async t => {
  const f = await fixture(t); await f.page.evaluate(() => window.mode = 'unknown'); await f.page.evaluate(() => window.panel.enter({ tenantId: 'tenant-a', workspaceId: 'work-a', canOpen: true })); await f.page.evaluate(() => window.panel.selectRun('run-a')); await f.page.getByRole('button', { name: '打开预览' }).click(); await f.page.getByText('启动结果尚未确认，可使用同一请求重试。').waitFor();
  const first = await f.page.evaluate(() => JSON.parse(sessionStorage.getItem('riffology:preview-intent:tenant-a:work-a'))); assert.ok(first);
  await f.page.evaluate(() => { window.mode = 'normal'; return window.panel.enter({ tenantId: 'tenant-a', workspaceId: 'work-a', canOpen: true }); }); await f.page.evaluate(() => window.panel.selectRun('run-a')); await f.page.getByRole('button', { name: '打开预览' }).click();
  await f.page.waitForFunction(() => window.calls.filter(call => call.method === 'POST' && call.path === '/api/workspaces/work-a/previews').length >= 2);
  const posts = await f.page.evaluate(() => window.calls.filter(call => call.method === 'POST' && call.path === '/api/workspaces/work-a/previews')); assert.equal(posts[0].headers['Idempotency-Key'], posts[1].headers['Idempotency-Key']); assert.equal(posts[0].body, posts[1].body); assert.equal(await f.page.evaluate(() => sessionStorage.length), 0);
  const conflict = await fixture(t); await conflict.page.evaluate(() => window.mode = 'conflict'); await conflict.page.evaluate(() => window.panel.enter({ tenantId: 'tenant-a', workspaceId: 'work-a', canOpen: true })); await conflict.page.evaluate(() => window.panel.selectRun('run-a')); await conflict.page.getByRole('button', { name: '打开预览' }).click(); await conflict.page.getByText('状态已变化，请刷新后重试。').waitFor(); assert.equal(await conflict.page.evaluate(() => sessionStorage.length), 0);
});

test('failed refresh before Preview POST is a safe read failure', async t => {
  const f = await fixture(t); await f.page.evaluate(() => window.panel.enter({ tenantId: 'tenant-a', workspaceId: 'work-a', canOpen: true })); await f.page.evaluate(() => { window.panel.selectRun('run-a'); window.mode = 'read-unavailable'; });
  await f.page.getByRole('button', { name: '打开预览' }).click();
  await f.page.getByText('读取预览失败：服务暂不可用，请稍后重试。', { exact: true }).waitFor();
  const calls = await f.page.evaluate(() => window.calls);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(await f.page.evaluate(() => sessionStorage.length), 0);
});

test('context switch ignores a late GET and leave removes the local iframe', async t => {
  const f = await fixture(t); await f.page.evaluate(() => window.mode = 'delay'); const old = f.page.evaluate(() => window.panel.enter({ tenantId: 'tenant-a', workspaceId: 'work-a', canOpen: true })); await f.page.waitForTimeout(5); await f.page.evaluate(() => window.panel.enter({ tenantId: 'tenant-b', workspaceId: 'work-b', canOpen: false })); await f.page.evaluate(() => window.release()); await old; assert.equal(await f.page.locator('iframe').count(), 0); await f.page.evaluate(() => window.panel.leave()); assert.equal(await f.page.locator('#root').textContent(), '');
});

test('one-click service action waits for the initial Preview read before opening', async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => { window.mode = 'delay'; window.entering = window.panel.enter({ tenantId: 'tenant-a', workspaceId: 'work-a', canOpen: true }); window.opening = window.panel.openRun('run-a'); });
  assert.equal((await f.page.evaluate(() => window.calls)).filter(call => call.method === 'POST').length, 0);
  await f.page.evaluate(() => { window.mode = 'normal'; window.release(); });
  await f.page.waitForFunction(() => window.calls.some(call => call.method === 'POST' && call.path === '/api/workspaces/work-a/previews'));
  await f.page.evaluate(() => Promise.all([window.entering, window.opening]));
  await f.page.getByTitle('项目预览').waitFor();
});

test('definite authorization refusal is shown instead of an uncertain Preview result', async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => { window.mode = 'normal'; return window.panel.enter({ tenantId: 'tenant-a', workspaceId: 'work-a', canOpen: true }); });
  await f.page.evaluate(() => { window.panel.selectRun('run-a'); window.panel.leave(); window.panel = null; });
  await f.page.evaluate(async () => { const module = await import('/previews.js'); window.panel = module.createPreviewPanel({ root: document.querySelector('#root'), requestTimeoutMs: 100, api: async (path, options = {}) => { if (options.method === 'POST') throw Object.assign(Error('登录或项目权限已变化，请刷新后重试'), { status: 403 }); return { current: null, available: null }; } }); await window.panel.enter({ tenantId: 'tenant-a', workspaceId: 'work-a', canOpen: true }); window.panel.selectRun('run-a'); });
  await f.page.getByRole('button', { name: '打开预览' }).click();
  await f.page.getByText('无法打开预览：登录或项目权限已变化，请刷新后重试', { exact: true }).waitFor();
});

test('disabled context performs no GET, and close or expiry only removes the local iframe', async t => {
  const disabled = await fixture(t); await disabled.page.evaluate(() => window.panel.enter({ tenantId: 'tenant-a', workspaceId: 'work-a', canOpen: false })); await disabled.page.waitForTimeout(20); assert.equal((await disabled.page.evaluate(() => window.calls)).length, 0);
  const f = await fixture(t); await f.page.evaluate(() => window.mode = 'short'); await f.page.evaluate(() => window.panel.enter({ tenantId: 'tenant-a', workspaceId: 'work-a', canOpen: true })); await f.page.evaluate(() => window.panel.selectRun('run-a')); await f.page.getByRole('button', { name: '打开预览' }).click(); await f.page.getByTitle('项目预览').waitFor(); const before = await f.page.evaluate(() => window.calls.length); await f.page.getByRole('button', { name: '关闭预览' }).click(); assert.equal(await f.page.locator('iframe').count(), 0); assert.equal(await f.page.evaluate(() => window.calls.length), before); await f.page.getByRole('button', { name: '打开预览' }).click(); await f.page.getByTitle('项目预览').waitFor(); await f.page.waitForTimeout(3200); assert.equal(await f.page.locator('iframe').count(), 0); assert.equal(await f.page.evaluate(() => window.calls.length), before + 2);
});

test('a late ticket response from an old iframe cannot be posted to a replacement iframe', async t => {
  const f = await fixture(t); await f.page.evaluate(() => window.mode = 'ticket-delay'); await f.page.evaluate(() => window.panel.enter({ tenantId: 'tenant-a', workspaceId: 'work-a', canOpen: true })); await f.page.evaluate(() => window.panel.selectRun('run-a')); await f.page.getByRole('button', { name: '打开预览' }).click(); await f.page.getByTitle('项目预览').waitFor();
  const oldFrame = await readyPreviewFrame(f.page); assert.ok(oldFrame); await oldFrame.evaluate(({ n, control }) => parent.postMessage({ type: 'riffology-preview-ready', nonce: n }, control), { n: nonce, control }); await f.page.waitForFunction(() => window.calls.some(call => call.path.endsWith('/tickets')));
  await f.page.getByRole('button', { name: '关闭预览' }).click(); assert.equal(await f.page.locator('iframe').count(), 0); await f.page.getByRole('button', { name: '恢复预览' }).click(); await f.page.getByTitle('项目预览').waitFor(); const newFrame = await readyPreviewFrame(f.page); assert.ok(newFrame); assert.notEqual(newFrame, oldFrame);
  await f.page.evaluate(() => window.releaseTicket()); await f.page.waitForTimeout(30); assert.equal(await newFrame.evaluate(() => window.received), null); assert.equal(await f.page.locator('iframe').count(), 1);
});
