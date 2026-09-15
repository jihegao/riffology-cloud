// Real browser acceptance: execute the checked-in Worker and Python models.
// No model, Worker, CDN, or package responses are mocked or rewritten.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.env.SPIKE_URL ?? 'http://127.0.0.1:8080/';
const outputDir = resolve(process.env.OUTPUT_DIR ?? '.local/mesa-browser-runtime-acceptance');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  ...(process.env.BROWSER_PROXY ? { proxy: { server: process.env.BROWSER_PROXY, bypass: '127.0.0.1,localhost' } } : {}),
});
const requests = [], pageErrors = [], runs = {};
await mkdir(outputDir, { recursive: true });

async function openPage() {
  // Separate contexts prove Queue can start without a preinstalled Mesa.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  context.on('request', r => requests.push({ url: r.url(), method: r.method() }));
  await context.addInitScript(() => {
    const RealWorker = window.Worker;
    window.Worker = class extends RealWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => { window.__lastRunMessage = event.data; });
      }
    };
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.goto(url);
  return page;
}

async function run(page, name, { model, seed, parameters = {} }) {
  if (await page.locator('#model').inputValue() !== model) await page.locator('#model').selectOption(model);
  await page.locator('#seed').fill(String(seed));
  for (const [key, value] of Object.entries(parameters)) await page.locator(`input[name=${key}]`).fill(String(value));
  await page.evaluate(() => { window.__lastRunMessage = null; });
  console.log(`${name}: starting real browser run`);
  await page.locator('#run').click();
  await page.waitForFunction(() => !document.querySelector('#run').disabled, null, { timeout: 240_000 });
  assert.match(await page.locator('#status').textContent(), /^Local run ready /);
  const result = await page.evaluate(() => window.__lastRunMessage);
  assert.equal(result?.type, 'result');
  assert.equal(result.runtime.pyodideVersion, '314.0.6');
  assert.equal(result.runtime.mesaVersion, model === 'schelling' ? '3.5.1' : null);
  runs[name] = result;
  console.log(`${name}: ${result.trace.snapshots.length} frames; ${result.runtime.elapsedMs.toFixed(0)} ms`);
  return result.trace;
}

async function playback(page, name, selector) {
  assert.ok(await page.locator(selector).count() > 0);
  await page.locator('#step').click();
  assert.match(await page.locator('#status').textContent(), /^Frame 1 /);
  await page.locator('#speed').selectOption('250');
  await page.locator('#play').click();
  await page.waitForFunction(() => /^Frame [3-9] /.test(document.querySelector('#status').textContent));
  await page.locator('#play').click();
  const pausedAt = await page.locator('#status').textContent();
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(await page.locator('#status').textContent(), pausedAt);
  await page.screenshot({ path: resolve(outputDir, `${name}-paused.png`), fullPage: true, scale: 'css' });
  await page.locator('#restart').click();
  assert.match(await page.locator('#status').textContent(), /^Frame 0 /);
  const bounds = await page.evaluate(() => {
    const required = ['#run', '#model', '#status', '#stage', '#metrics'];
    return required.map(selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { selector, fits: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
    });
  });
  assert.ok(bounds.every(region => region.fits), JSON.stringify(bounds));
  assert.match(await page.locator('body').innerText(), /local-only.*Research Evidence/s);
}

try {
  const mesa = await openPage();
  const defaultMesa = await run(mesa, 'mesa-default', { model: 'schelling', seed: 7 });
  assert.equal(await mesa.locator('.cell').count(), 280);
  assert.equal(await mesa.locator('.agent-a, .agent-b').count(), defaultMesa.snapshots[0].metrics.population);
  await mesa.screenshot({ path: resolve(outputDir, 'mesa-frame0.png'), fullPage: true, scale: 'css' });
  await playback(mesa, 'mesa', '.agent-a, .agent-b');
  assert.deepEqual(await run(mesa, 'mesa-repeat', { model: 'schelling', seed: 7 }), defaultMesa);
  assert.notDeepEqual(await run(mesa, 'mesa-seed8', { model: 'schelling', seed: 8 }), defaultMesa);
  assert.notDeepEqual(await run(mesa, 'mesa-homophily08', { model: 'schelling', seed: 7, parameters: { homophily: 0.8 } }), defaultMesa);

  const queueStart = requests.length;
  const queue = await openPage();
  const defaultQueue = await run(queue, 'queue-default', { model: 'queue', seed: 7 });
  assert.equal(await queue.locator('.lane').count(), 3);
  assert.equal(defaultQueue.snapshots.at(-1).metrics.completed, 30);
  assert.ok(!requests.slice(queueStart).some(r => /micropip|networkx|\/simple\/mesa\/|mesa-.*\.whl/.test(r.url)));
  await playback(queue, 'queue', '.lane');
  await queue.locator('#step').click();
  assert.ok(await queue.locator('.customer').count() > 0);
  await queue.screenshot({ path: resolve(outputDir, 'queue-serving.png'), fullPage: true, scale: 'css' });
  assert.deepEqual(await run(queue, 'queue-repeat', { model: 'queue', seed: 7 }), defaultQueue);
  const oneServer = await run(queue, 'queue-servers1', { model: 'queue', seed: 7, parameters: { servers: 1 } });
  assert.ok(oneServer.snapshots.at(-1).metrics.mean_wait > defaultQueue.snapshots.at(-1).metrics.mean_wait);
  assert.notDeepEqual(await run(queue, 'queue-seed8', { model: 'queue', seed: 8 }), oneServer);

  // Validate rejection of bad input after a completed run and subsequent recovery.
  await queue.locator('#seed').fill('1.5');
  await queue.locator('#run').click();
  assert.match(await queue.locator('#status').textContent(), /seed must be an integer/);
  assert.equal(await queue.locator('#model').isDisabled(), false);
  assert.equal(await queue.locator('#play').isDisabled(), true);
  await run(queue, 'queue-recovered', { model: 'queue', seed: 7 });
  await queue.locator('#model').selectOption('schelling');
  assert.equal(await queue.locator('#stage').textContent(), '');
  for (const control of ['play', 'step', 'restart']) assert.equal(await queue.locator(`#${control}`).isDisabled(), true);
  assert.equal(await queue.locator('#status').textContent(), 'Ready.');

  assert.deepEqual(pageErrors, []);
  const allowedHosts = new Set([new URL(url).hostname, 'cdn.jsdelivr.net', 'pypi.org', 'files.pythonhosted.org']);
  assert.ok(requests.every(r => r.method === 'GET' && allowedHosts.has(new URL(r.url).hostname)), 'Unexpected simulation/network request');
  const summary = Object.fromEntries(Object.entries(runs).map(([name, result]) => [name, {
    frames: result.trace.snapshots.length, runtime: result.runtime, finalMetrics: result.trace.snapshots.at(-1).metrics,
  }]));
  await writeFile(resolve(outputDir, 'acceptance.json'), JSON.stringify({ passed: true, url, viewport: { width: 1440, height: 1080 }, summary, requests, runs }, null, 2));
  console.log(`PASS: both real browser model paths; evidence at ${outputDir}`);
} finally {
  await browser.close();
}
