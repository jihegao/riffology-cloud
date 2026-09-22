import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';

const rootUrl = new URL('../../services/web/', import.meta.url);
const assets = ['verify-handoff.js', 'browser-preview.js', 'i18n.js'];
const originalKey = scope => `riffology:browser-preview:verify:${scope.tenantId}:${scope.projectId}:${scope.workspaceId}`;
const handoffKey = scope => `${originalKey(scope)}:handoff`;
const scopeA = {tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'work-a', canVerify: true};
const scopeB = {...scopeA, workspaceId: 'work-b'};
const draft = () => ({revisionId: 'revision-a', packageIdentity: 'a'.repeat(64), parameters: {customers: 12, enabled: true}, seed: 7, intent: 'experiment'});

async function fixture(t, {mode = 'absent'} = {}) {
  const files = Object.fromEntries(await Promise.all(assets.map(async name => [name, await readFile(new URL(name, rootUrl), 'utf8')])));
  const browser = await chromium.launch({headless: true, channel: process.env.M1_BROWSER_CHANNEL || 'chrome'});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/*', route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (Object.hasOwn(files, name)) return route.fulfill({contentType: 'text/javascript', body: files[name]});
    return route.fulfill({contentType: 'text/html', body: '<main id="root"></main>'});
  });
  await page.goto('https://app.example.test/');
  await page.evaluate(async initialMode => {
    const {createVerifyHandoffPanel} = await import('/verify-handoff.js');
    window.calls = [];
    window.mode = initialMode;
    window.verified = [];
    window.api = (path, options = {}) => {
      window.calls.push({path, method: options.method || 'GET', body: options.body});
      if (options.method === 'POST') {
        if (window.mode === 'unknown' || window.mode === 'hanging') return new Promise(() => {});
        const submitted = JSON.parse(options.body);
        const {idempotencyKey, ...captured} = submitted;
        return Promise.resolve({verificationId: idempotencyKey, captured, experiment: {id: 'experiment-a'}});
      }
      const key = path.split('/').at(-1);
      const stored = JSON.parse(sessionStorage.getItem(window.pendingKey) || 'null');
      if (window.mode === 'accepted' && stored?.idempotencyKey === key) {
        const {idempotencyKey, ...captured} = stored;
        return Promise.resolve({status: 'accepted', verificationId: key, captured, experiment: {id: 'experiment-a'}});
      }
      if (window.mode === 'wrong-captured' && stored?.idempotencyKey === key) {
        return Promise.resolve({status: 'accepted', verificationId: key, captured: {...stored, seed: 8}, experiment: {id: 'experiment-a'}});
      }
      return Promise.resolve({status: 'absent', verificationId: key, captured: null, experiment: null});
    };
    window.panel = createVerifyHandoffPanel({root: document.querySelector('#root'), api: window.api, onVerified: value => window.verified.push(value), requestTimeoutMs: 25});
  }, mode);
  return page;
}

async function enter(page, scope = scopeA) {
  await page.evaluate(value => { window.pendingKey = `riffology:browser-preview:verify:${value.tenantId}:${value.projectId}:${value.workspaceId}`; window.panel.enter(value); }, scope);
  await page.evaluate(() => window.panel.setCanVerify(true));
}

const posts = page => page.evaluate(() => calls.filter(call => call.method === 'POST'));

test('closed Verify gate rejects handoff without a server POST', async t => {
  const page = await fixture(t);
  await page.evaluate(value => { window.pendingKey = `riffology:browser-preview:verify:${value.tenantId}:${value.projectId}:${value.workspaceId}`; window.panel.enter({...value, canVerify: false}); }, scopeA);
  assert.equal(await page.evaluate(value => window.panel.handoff(value), draft()), false);
  assert.deepEqual(await posts(page), []);
});

test('handoff freezes a deep copy and does not mint an idempotency key before confirmation', async t => {
  const page = await fixture(t);
  await enter(page);
  const input = draft();
  assert.equal(await page.evaluate(value => window.panel.handoff(value), input), true);
  input.parameters.customers = 99;
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem(window.pendingKey + ':handoff')).parameters.customers), 12);
  assert.equal(await page.evaluate(() => sessionStorage.getItem(window.pendingKey)), null);
  assert.deepEqual(await posts(page), []);
});

test('an original pending Verify key wins over a newer draft and confirmation reuses its exact body', async t => {
  const page = await fixture(t);
  const pending = {...draft(), idempotencyKey: 'verify-original'};
  const newer = {...draft(), revisionId: 'revision-new', seed: 42};
  await page.evaluate(({key, pendingValue, newerValue}) => {
    sessionStorage.setItem(key, JSON.stringify(pendingValue));
    sessionStorage.setItem(key + ':handoff', JSON.stringify(newerValue));
  }, {key: originalKey(scopeA), pendingValue: pending, newerValue: newer});
  await enter(page);
  assert.equal(await page.evaluate(value => window.panel.handoff(value), draft()), true);
  await page.getByRole('button', {name: 'Confirm server experiment'}).click();
  await page.waitForFunction(() => calls.some(call => call.method === 'POST'));
  assert.deepEqual(JSON.parse((await posts(page))[0].body), pending);
});

test('unknown receipt recovery uses only the exact GET key, preserves wrong or absent receipts, and does not consume another scope', async t => {
  const page = await fixture(t, {mode: 'unknown'});
  await enter(page);
  assert.equal(await page.evaluate(value => window.panel.handoff(value), draft()), true);
  await page.getByRole('button', {name: 'Confirm server experiment'}).click();
  await page.waitForFunction(() => calls.some(call => call.method === 'POST'));
  const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem(window.pendingKey)));
  await page.evaluate(() => { window.panel.leave(); window.mode = 'wrong-captured'; window.panel.enter({tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'work-a', canVerify: true}); window.panel.setCanVerify(true); });
  await page.waitForFunction(key => calls.some(call => call.method === 'GET' && call.path.endsWith(`/verify/${key}`)), pending.idempotencyKey);
  assert.equal(await page.evaluate(() => sessionStorage.getItem(window.pendingKey) !== null), true);
  assert.equal((await posts(page)).length, 1);
  await page.evaluate(() => { window.panel.leave(); window.mode = 'absent'; window.panel.enter({tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'work-a', canVerify: true}); window.panel.setCanVerify(true); });
  await page.waitForFunction(key => calls.filter(call => call.method === 'GET' && call.path.endsWith(`/verify/${key}`)).length >= 2, pending.idempotencyKey);
  assert.equal(await page.evaluate(() => sessionStorage.getItem(window.pendingKey) !== null), true);
  await page.evaluate(() => { window.panel.leave(); window.panel.enter({tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'work-b', canVerify: true}); window.panel.setCanVerify(true); });
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key) !== null, originalKey(scopeA)), true);
  assert.equal(await page.evaluate(key => calls.some(call => call.path.endsWith(`/verify/${key}`)), pending.idempotencyKey), true);
  assert.equal(await page.evaluate(() => calls.filter(call => call.method === 'POST').length), 1);
});

test('a storage read failure blocks a new handoff instead of treating it as an empty pending request', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.storageWrites = 0;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...args) { window.storageWrites++; return originalSet.apply(this, args); };
    Storage.prototype.getItem = () => { throw Error('storage-denied'); };
  });
  await enter(page);
  assert.equal(await page.evaluate(value => window.panel.handoff(value), draft()), false);
  assert.equal(await page.evaluate(() => storageWrites), 0);
  assert.deepEqual(await posts(page), []);
});

test('a timed-out POST retains its key and recovery confirms it through the exact receipt GET', async t => {
  const page = await fixture(t, {mode: 'hanging'});
  await enter(page);
  assert.equal(await page.evaluate(() => typeof window.panel.recover), 'function');
  assert.equal(await page.evaluate(value => window.panel.handoff(value), draft()), true);
  await page.getByRole('button', {name: 'Confirm server experiment'}).click();
  await page.waitForFunction(() => calls.some(call => call.method === 'POST'));
  await page.getByText('The original verification receipt is unconfirmed; retry the same request here.').waitFor({timeout: 500});
  const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem(window.pendingKey)));
  await page.evaluate(() => { window.mode = 'accepted'; return window.panel.recover(); });
  await page.waitForFunction(() => verified.length === 1);
  assert.equal(await page.evaluate(() => sessionStorage.getItem(window.pendingKey)), null);
  assert.equal((await posts(page)).length, 1);
  assert.equal(await page.evaluate(key => calls.filter(call => call.method === 'GET' && call.path.endsWith(`/verify/${key}`)).length >= 1, pending.idempotencyKey), true);
});
