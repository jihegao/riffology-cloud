// Focused UI lifecycle regression tests. The Worker is a fixture; this is not
// the real Pyodide/Mesa browser acceptance documented in README.md.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
let server, browser, origin;

before(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    try {
      const bytes = await readFile(new URL(`.${path === '/' ? '/index.html' : path}`, import.meta.url));
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openFixturePage(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.addInitScript(() => {
    window.Worker = class extends EventTarget {
      constructor(url, options) {
        super(); window.__worker = this; window.__workerOptions = options;
      }
      postMessage(message) { window.__workerRequest = message; }
      terminate() { window.__workerTerminated = true; }
    };
  });
  await page.goto(origin);
  await page.locator('#model').selectOption('queue');
  return page;
}

async function request(page, previousId = null) {
  await page.waitForFunction(id => window.__workerRequest && window.__workerRequest.requestId !== id, previousId);
  return page.evaluate(() => window.__workerRequest);
}

async function reply(page, requestId) {
  await page.evaluate(id => window.__worker.dispatchEvent(new MessageEvent('message', {
    data: {
      type: 'result', requestId: id, runtime: { elapsedMs: 1 },
      trace: { model: 'fixture-queue', snapshots: [{
        schemaVersion: 'riffology.visual/v0.1', frame: 0, time: 0,
        space: { type: 'lane', lanes: ['queue', 'server-1'] },
        agents: [], metrics: { completed: 1 },
      }] },
    },
  })), requestId);
}

test('pending source locks the form, captures config, and rejects stale results', async t => {
  const page = await openFixturePage(t);
  let release, sourceReached;
  const blocked = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { sourceReached = resolve; });
  await page.route('**/models/queue_trace.py', async route => {
    const response = await route.fetch(); sourceReached();
    await blocked; await route.fulfill({ response });
  });
  await page.locator('#run').click();
  await reached;
  try {
    assert.equal(await page.locator('#model').isDisabled(), true);
    assert.equal(await page.locator('#seed').isDisabled(), true);
    assert.equal(await page.locator('input[name=servers]').isDisabled(), true);
    assert.equal(await page.locator('#run').isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.__workerOptions), { type: 'module' });
    // Even a script changing form values cannot change an already captured run.
    await page.evaluate(() => { document.querySelector('#seed').value = '8'; });
  } finally { release(); }
  const pending = await request(page);
  assert.equal(pending.needsMesa, false);
  assert.equal(pending.config.seed, 7);
  assert.equal(pending.config.parameters.servers, 2);
  assert.equal(pending.config.parameters.width, undefined);
  await reply(page, 'unrelated-request');
  assert.equal(await page.locator('#run').isDisabled(), true);
  assert.equal(await page.locator('.lane').count(), 0);
  await reply(page, pending.requestId);
  assert.equal(await page.locator('#model').isDisabled(), false);
  assert.equal(await page.locator('.lane').count(), 2);
  await page.locator('#model').selectOption('schelling');
  for (const control of ['play', 'step', 'restart']) {
    assert.equal(await page.locator(`#${control}`).isDisabled(), true);
  }
  assert.equal(await page.locator('#status').textContent(), 'Ready.');
  await reply(page, pending.requestId);
  assert.equal(await page.locator('#stage').textContent(), '');
  assert.equal(await page.locator('#status').textContent(), 'Ready.');
});

test('source failure restores the form and permits a fresh run', async t => {
  const page = await openFixturePage(t);
  await page.route('**/models/queue_trace.py', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.locator('#run').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Run failed:'));
  assert.match(await page.locator('#status').textContent(), /HTTP 503/);
  assert.equal(await page.locator('#model').isDisabled(), false);
  assert.equal(await page.locator('#seed').isDisabled(), false);
  assert.equal(await page.locator('#play').isDisabled(), true);
  await page.unroute('**/models/queue_trace.py');
  await page.locator('#run').click();
  const pending = await request(page);
  await reply(page, pending.requestId);
  assert.equal(await page.locator('#run').isDisabled(), false);
  assert.equal(await page.locator('#play').isDisabled(), false);
});

test('Worker failure rejects late results and creates a fresh Worker on retry', async t => {
  const page = await openFixturePage(t);
  await page.locator('#run').click();
  const pending = await request(page);
  await page.evaluate(() => window.__worker.dispatchEvent(new ErrorEvent('error', { message: 'Runtime load failed' })));
  assert.match(await page.locator('#status').textContent(), /Runtime load failed/);
  assert.equal(await page.locator('#model').isDisabled(), false);
  assert.equal(await page.locator('#run').isDisabled(), false);
  await reply(page, pending.requestId);
  assert.equal(await page.locator('#stage').textContent(), '');
  assert.equal(await page.locator('#play').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__workerTerminated), true);
  await page.locator('#run').click();
  const fresh = await request(page, pending.requestId);
  assert.notEqual(fresh.requestId, pending.requestId);
  await reply(page, fresh.requestId);
  assert.equal(await page.locator('#run').isDisabled(), false);
  assert.equal(await page.locator('#play').isDisabled(), false);
});
