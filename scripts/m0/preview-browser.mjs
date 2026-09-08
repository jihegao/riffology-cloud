#!/usr/bin/env node
// Shared local/cloud fixture assertions. The caller owns deployment and service lifecycle.
import assert from 'node:assert/strict';
import https from 'node:https';
import { getCACertificates } from 'node:tls';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createHash, X509Certificate, randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { permittedPreviewRequest, previewSources } from './preview-manifest.mjs';
import { BUSINESS_LIMITS, CLEANUP_LIMITS, PreviewBudget, MutationAttempts } from './preview-budget.mjs';
import { fixtureCookiesForUrl } from './preview-cookies.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
async function localInputs(tlsPath) {
const tlsDirectory = await realpath(tlsPath);
assert.ok(tlsDirectory.startsWith(path.join(root, '.local', 'm0-browser-tls-')), 'TLS directory must be the dedicated project-local fixture');
const metadata = JSON.parse(await readFile(path.join(tlsDirectory, 'metadata.json'), 'utf8'));
const ca = await readFile(path.join(tlsDirectory, 'cert.pem'));
const vars = Object.fromEntries((await readFile(path.join(tlsDirectory, 'vars.env'), 'utf8')).split('\n').filter(line => /^[A-Z0-9_]+=/.test(line)).map(line => {
  const i = line.indexOf('=');
  let value = line.slice(i + 1).trim();
  if (value.startsWith('"')) value = JSON.parse(value);
  else if (value.startsWith("'")) value = value.slice(1, -1);
  return [line.slice(0, i), value];
}));
const token = vars.M0_PROBE_TOKEN;
assert.ok(token?.length >= 32 && vars.M0_PREVIEW_SIGNING_KEY?.length >= 32);
const control = 'https://control.m0.test:8791', base = 'https://preview.m0.test:8791';
assert.equal(metadata.controlOrigin, control);
assert.equal(metadata.previewBase, base);
const spki = createHash('sha256').update(new X509Certificate(ca).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
assert.equal(spki, metadata.spkiSha256);
return { mode: 'local', token, control, base, registrableSite: 'm0.test', ingressOrigins: [], httpsOptions: { ca, family: 4, lookup: (_hostname, _options, callback) => callback(null, '127.0.0.1', 4) }, chromeArgs: ['--no-proxy-server', '--host-resolver-rules=MAP *.m0.test 127.0.0.1', `--ignore-certificate-errors-spki-list=${spki}`], tlsEvidence: { dedicated_ca: true, spki_allowlist_only: true, global_tls_verification_disabled: false, system_trust_modified: false } };
}

export async function runPreviewProbe(inputs) {
const { mode, control, base, token, registrableSite } = inputs;
const cloud = mode === 'cloud';
const controlURL = new URL(control);
// Normal public roots plus OS trust. No fixture certificate or caller CA input
// enters cloud mode. Node and Chrome continue to validate the real hostname.
const cloudRoots = cloud ? [...getCACertificates('bundled'), ...getCACertificates('system')] : undefined;
const evidenceName = cloud ? 'preview-cloud.json' : 'preview-browser.json';
const run = `preview-${cloud ? 'cloud' : 'browser'}-${Date.now()}`;
const run2 = `${run}-two`;
const output = path.join(root, 'docs/evidence/runs', run, 'artifacts');
await mkdir(output, { recursive: true });
const sources = () => previewSources(root);
const before = sources();
const cases = {};
const cleanup = [];
const owned = new Map();
let browser, launchPromise, browserClosePromise, currentCase = 'setup';
const business = new PreviewBudget(BUSINESS_LIMITS);
const mutations = new MutationAttempts();
const allowedScopes = new Set([`${run}/alpha`, `${run}/bravo`, `${run2}/alpha`]);
const pendingAccounting = new Set();
const browserAccounting = { completed_responses: 0, failed_requests: 0, received_websocket_frames: 0, mode: 'passive-completed-response-wire-size-and-websocket-payload; aborted-response-bytes-may-be-unavailable' };
const closeBrowser = () => browserClosePromise ??= (async () => {
  const instance = browser ?? await launchPromise?.catch(() => undefined);
  await instance?.close();
})();
business.signal.addEventListener('abort', () => { void closeBrowser().catch(() => {}); }, { once: true });
const receipt = {
  schema_version: 2, operation: cloud ? 'G0-T07-cloud-browser' : 'G0-T07-local-browser', run_id: run,
  observed_at: new Date().toISOString(), execution_environment: cloud ? 'staging-cloud-workerd-container-chrome-https' : 'local-workerd-docker-chrome-https',
  identity_provider: 'server-owned-synthetic-principals-not-product-login',
  origin_model: 'same-site-different-origin', gate_decision: 'not_evaluated',
  cloud_browser_matrix: 'not_run', cross_site_third_party_cookie_matrix: 'not_run', product_login: 'not_run',
  tls: inputs.tlsEvidence,
  ...(cloud ? { deployment_manifest: inputs.deploymentManifest, deployment_manifest_sha256: inputs.manifestSha256, deployment_binding: 'operator-verified-manifest; runner does not query account deployment APIs', sdk_exception_investigation: { status: 'not_run', runtime_error_free: 'unknown', known_local_symptom: 'Network connection lost during close; SDK attribution unconfirmed', raw_tail_persisted: false }, ingress_matrix: [], credential_matrix: [], sdk_port_exposure: 'not_run', missing_matrix: { cross_site_third_party_cookies: 'not_run', product_login_and_production_logout: 'not_run', cloud_instance_stop_and_billing: 'not_run', cloud_error_tail_phase_attribution: 'not_run', SDK_capability_URL_live_replay: 'not_run-no-port-will-be-exposed', worker_version_preview_URLs: 'not_applicable-to-this-DO-container-worker', alternate_ingress: inputs.ingressOrigins.length ? 'scheduled' : 'not_run-not-in-manifest' } } : {}),
  cases, cleanup, sourcesBefore: before,
  budgets: { business: null, cleanup: null, browser_accounting: browserAccounting, mutations: null, hard_process_deadline_ms: BUSINESS_LIMITS.milliseconds + CLEANUP_LIMITS.milliseconds + 15000 },
};
const hardDeadline = setTimeout(() => {
  // Last-resort CLI bound if a browser/transport shutdown never settles. This
  // separate failure receipt never overwrites a completed or failed run file.
  try { writeFileSync(path.join(output, 'preview-budget-abort.json'), JSON.stringify({ status: 'failed', run_id: run, case: currentCase, reason: 'hard-process-deadline', cleanup: 'not_confirmed', owned_scopes: [...owned.keys()], gate_decision: 'not_evaluated' }) + '\n', { flag: 'wx' }); } catch {}
  process.exit(1);
}, BUSINESS_LIMITS.milliseconds + CLEANUP_LIMITS.milliseconds + 15000);
hardDeadline.unref();
const permitted = value => permittedPreviewRequest(inputs, value);
// Cloud: system CA and real DNS. Local: dedicated CA and fixed loopback DNS.
function localRequest(value, { method = 'GET', headers = {}, websocket = false, anonymousIngress = false, budget = business } = {}) {
  const url = permittedPreviewRequest(inputs, value, { headers, anonymousIngress });
  budget.takeRequest();
  const timeoutMs = budget.remaining(budget === business ? 65000 : 15000);
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) reject(error); else resolve(result);
    };
    const req = https.request(url, {
      // Cloud uses Node's default agent, including --use-env-proxy when set.
      // Keep the local fixture on its dedicated direct TLS connection.
      ...(cloud ? { ca: cloudRoots } : inputs.httpsOptions), method, headers, agent: cloud ? undefined : false, rejectUnauthorized: true, signal: budget.signal,
    });
    // Total wall-clock deadline, including DNS, TLS, headers and streamed body.
    // A peer sending occasional bytes cannot indefinitely reset this timeout.
    deadline = setTimeout(() => {
      const error = new Error('preview-request-deadline');
      finish(error);
      req.destroy(error);
    }, timeoutMs);
    req.once('response', res => {
      let body = '', bodyBytes = 0;
      const fail = error => { finish(error); req.destroy(error); };
      res.once('error', fail);
      res.once('aborted', () => fail(new Error('local-response-aborted')));
      res.once('close', () => { if (!res.complete) fail(new Error('local-response-incomplete')); });
      res.setEncoding('utf8');
      res.on('data', chunk => {
        if (settled) return;
        try {
          const bytes = Buffer.byteLength(chunk);
          budget.addResponseBytes(bytes); bodyBytes += bytes;
          if (bodyBytes > 1024 * 1024) throw new Error('response-too-large');
          body += chunk;
        } catch (error) { fail(error); }
      });
      res.once('end', () => finish(null, { status: res.statusCode, headers: res.headers, body }));
    });
    req.once('upgrade', (res, socket) => {
      finish(websocket ? null : new Error('unexpected-upgrade'), { status: res.statusCode, headers: res.headers, body: '' });
      socket.destroy();
    });
    req.once('error', error => finish(error));
    req.end();
  });
}
async function management(action, tenant = 'alpha', runId = run, budget = business) {
  budget.check();
  assert.ok(allowedScopes.has(`${runId}/${tenant}`), 'management-scope-not-owned-by-this-run');
  assert.ok(budget === business || action === 'cleanup', 'cleanup-budget-cannot-run-business-mutation');
  // A timeout can hide a successful remote start. Register before dispatch;
  // no unknown acknowledgment triggers a new start or automatic write replay.
  if (action === 'start') owned.set(`${runId}/${tenant}`, { runId, tenant });
  const operation = async () => {
    const response = await localRequest(`${control}/m0/preview/${runId}/${tenant}/${action}`, { method: ['status', 'diagnostics'].includes(action) ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}` }, budget });
    budget.check();
    assert.equal(response.status, 200, `management-${action}-status-${response.status}`);
    return JSON.parse(response.body);
  };
  const result = ['start', 'enroll', 'revoke'].includes(action)
    ? await mutations.once(`${action}:${runId}/${tenant}`, budget, operation)
    : await budget.run(operation);
  budget.check();
  if (action === 'cleanup' || action === 'revoke') {
    cleanup.push({ run_id: runId, tenant, action, acknowledgment: result.cleanup, semantics: cloud ? 'Sandbox destroy RPC acknowledgment; cloud instance stop/billing reconciliation requires caller inspection' : 'Sandbox-only; development proxy helpers require separate caller inspection' });
    if (result.cleanup === 'destroy_acknowledged' || result.cleanup === 'no-instance') owned.delete(`${runId}/${tenant}`);
  }
  return result;
}
async function drainAccounting() {
  while (pendingAccounting.size) await business.run(() => Promise.all([...pendingAccounting]));
}
async function budgetedContext() {
  const context = await business.run(() => browser.newContext({ ignoreHTTPSErrors: false, serviceWorkers: 'block' }));
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  const records = new WeakMap();
  const observe = operation => {
    if (business.signal.aborted) return;
    try { operation(); }
    catch { if (!business.signal.aborted) business.fail('browser-budget-accounting-failed'); }
  };
  context.on('request', request => observe(() => { business.takeRequest(); records.set(request, { charged: 0 }); }));
  const charge = (request, bytes) => {
    const record = records.get(request);
    if (!record || !Number.isSafeInteger(bytes) || bytes < 0) throw new Error('browser-response-size-unavailable');
    if (bytes > 1024 * 1024) { business.fail('browser-single-response-byte-limit'); business.check(); }
    if (bytes > record.charged) { business.addResponseBytes(bytes - record.charged); record.charged = bytes; }
  };
  context.on('response', response => observe(() => {
    const length = response.headers()['content-length'];
    if (length && /^\d+$/.test(length)) charge(response.request(), Number(length));
  }));
  context.on('requestfinished', request => {
    if (business.signal.aborted) return;
    const pending = business.run(async () => {
      const sizes = await request.sizes();
      business.check(); charge(request, sizes.responseBodySize);
      browserAccounting.completed_responses++;
    }).catch(() => { if (!business.signal.aborted) business.fail('browser-response-byte-accounting-failed'); });
    pendingAccounting.add(pending);
    void pending.finally(() => pendingAccounting.delete(pending));
  });
  context.on('requestfailed', () => { if (!business.signal.aborted) browserAccounting.failed_requests++; });
  context.on('page', page => page.on('websocket', socket => {
    observe(() => business.takeRequest());
    socket.on('framereceived', event => observe(() => {
      business.addResponseBytes(Buffer.byteLength(event.payload));
      browserAccounting.received_websocket_frames++;
    }));
  }));
  return context;
}
async function check(name, callback) {
  business.check();
  currentCase = name;
  const start = Date.now();
  try { const details = await business.run(callback); await drainAccounting(); business.check(); cases[name] = { status: 'passed', elapsed_ms: Date.now() - start, ...(details ?? {}) }; }
  catch (error) { cases[name] = { status: 'failed', elapsed_ms: Date.now() - start, error_type: error?.name ?? 'Error' }; throw error; }
}
const cookiesAt = async (context, url) => fixtureCookiesForUrl(await context.cookies(), url).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
const firstCookie = response => response.headers['set-cookie'][0].split(';')[0];
async function enroll(context, tenant) {
  const enrollment = await management('enroll', tenant);
  const page = await context.newPage();
  const response = await page.goto(permitted(enrollment.url).href);
  assert.equal(response.status(), 200);
  assert.equal(new URL(page.url()).pathname, '/m0/browser/session');
  return page;
}
async function ticket(page, runId = run, tenant = 'alpha') {
  assert.equal(new URL(page.url()).origin, control);
  const result = await page.evaluate(async ({ runId, tenant }) => {
    const response = await fetch(`/m0/browser/${runId}/${tenant}/ticket`, { method: 'POST' });
    if (!response.ok) throw new Error(`ticket-status-${response.status}`);
    return (await response.json()).url;
  }, { runId, tenant });
  return permitted(result).href;
}
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#state')?.textContent?.includes('m0-fixed-state') && document.querySelector('#socket')?.textContent?.includes('m0-fixed-state'), null, { timeout: 15000 });
  const actual = new URL(page.url());
  assert.equal(actual.search, '');
  const observed = await page.evaluate(() => ({ state: JSON.parse(document.querySelector('#state').textContent), stream: JSON.parse(document.querySelector('#socket').textContent) }));
  const generation = actual.hostname.match(/^p-([a-f0-9]{32})\./)?.[1];
  assert.equal(observed.state.fixture_instance_marker, generation);
  assert.equal(observed.stream.fixture_instance_marker, generation);
}
async function openPreview(context, controlPage, runId = run, tenant = 'alpha') {
  const page = await context.newPage();
  const response = await page.goto(await ticket(controlPage, runId, tenant));
  assert.equal(response.status(), 200); await ready(page); return page;
}
async function framePreview(controlPage, runId = run) {
  const diagnostics = { phase: 'control-navigation', checks: {} };
  receipt.iframe_diagnostics = diagnostics;
  const response = await controlPage.goto(`${control}/m0/browser/frame/${runId}/alpha`);
  diagnostics.control_http_status = response.status();
  assert.equal(response.status(), 200);
  diagnostics.phase = 'frame-element';
  await controlPage.waitForFunction(() => document.querySelector('#preview') !== null);
  const frame = await (await controlPage.locator('#preview').elementHandle()).contentFrame();
  diagnostics.phase = 'frame-ready';
  await ready(frame);
  diagnostics.phase = 'ready';
  return frame;
}
async function browserCookieWire(page, frame, pathname, expectedMarker) {
  const url = new URL(pathname, frame.url()).href;
  const requestPromise = page.waitForRequest(request => request.url() === url && request.method() === 'GET' && request.frame() === frame, { timeout: business.remaining(15000) });
  const [request, result] = await business.run(() => Promise.all([requestPromise, frame.evaluate(async ({ url, expectedMarker }) => {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    return { status: response.status, marker: (await response.text()).includes(expectedMarker) };
  }, { url, expectedMarker })]));
  const headers = await business.run(() => request.allHeaders());
  const cookie = headers.cookie ?? '';
  return {
    http_status: result.status, expected_marker: result.marker,
    no_redirect: !request.redirectedFrom() && !request.redirectedTo(),
    principal_cookie_sent: /(?:^|;\s*)__Host-m0_principal=/.test(cookie),
    preview_cookie_sent: /(?:^|;\s*)__Host-m0_preview=/.test(cookie),
  };
}
async function wsClosed(frame) {
  await frame.waitForFunction(() => document.querySelector('#socket')?.textContent?.includes('[closed 1008]'), null, { timeout: 6000 });
}
async function fetchStatus(page, value, init = {}) { return page.evaluate(async ({ value, init }) => (await fetch(value, init)).status, { value, init }); }
async function deniedCredentials(phase, pageURL, cookie) {
  if (!cloud) return;
  // Captured issuer credentials stay in memory. This tests post-revocation and
  // scope validation, never claims copying cookies proves browser login binding.
  for (const resource of ['', 'app.js', 'api/state', 'ws']) {
    const row = { phase, resource: resource || 'document', status: 'incomplete', credential: cookie ? 'previously-issued-preview-cookie' : 'none' };
    receipt.credential_matrix.push(row);
    const ws = resource === 'ws';
    const response = await localRequest(pageURL + resource, { websocket: ws, headers: {
      ...(cookie ? { cookie } : {}),
      ...(ws ? { origin: new URL(pageURL).origin, upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64') } : {}),
    } });
    row.http_status = response.status;
    assert.equal(response.status, 403);
    assert.equal(response.headers['set-cookie'], undefined);
    row.status = 'passed';
  }
}
async function deniedIngress(label, target, paths, alternate = false) {
  for (const pathname of paths) {
    for (const websocket of pathname.endsWith('/ws') || pathname.includes('/proxy/') ? [false, true] : [false]) {
      const row = { ingress: label, path: pathname, transport: websocket ? 'websocket-handshake' : 'https', credential: 'none', status: 'incomplete' };
      receipt.ingress_matrix.push(row);
      const response = await localRequest(target + pathname, { anonymousIngress: alternate, websocket, headers: websocket ? {
        origin: target, upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64'),
      } : {} });
      row.http_status = response.status;
      assert.ok([401, 403, 404].includes(response.status), 'raw-ingress-must-deny-without-redirect');
      assert.equal(response.headers.location, undefined);
      assert.equal(response.headers['set-cookie'], undefined);
      row.status = 'passed';
    }
  }
}
try {
  await business.run(async () => {
  if (cloud) assert.equal(before.sha256, inputs.deploymentManifest.deploymentSourceSha256, 'deployment-source-mismatch');
  if (cloud) await check('cloud_declared_ingresses_use_real_DNS_TLS_and_reject_raw_paths', async () => {
    const rawPaths = ['/', '/api/state', '/proxy/8080/', '/__sandbox/8080/', '/ws', `/m0/preview/${run}/alpha/status`];
    await deniedIngress('control', control, rawPaths);
    await deniedIngress('preview-base', base, rawPaths);
    for (const ingress of inputs.ingressOrigins) await deniedIngress('known-staging-workers-dev', ingress, rawPaths, true);
    receipt.missing_matrix.alternate_ingress = inputs.ingressOrigins.length ? 'executed-anonymously-see-ingress-matrix' : 'not_run-not-in-manifest';
    return { port: 443, DNS_override: false, TLS_override: false, anonymous_only: true };
  });
  launchPromise = chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, timeout: business.remaining(30000),
    args: cloud ? ['--no-proxy-server'] : inputs.chromeArgs,
  });
  browser = await launchPromise;
  business.check();
  // launch() creates an isolated temporary profile, never a user's running profile.
  const alice = await budgetedContext();
  const bob = await budgetedContext();
  const anotherAlice = await budgetedContext();
  const grantA = await management('start');
  let aliceControl = await enroll(alice, 'alpha');
  const bobControl = await enroll(bob, 'bravo');
  const otherControl = await enroll(anotherAlice, 'alpha');
  await check('secure_context_and_server_owned_fixture_sessions', async () => {
    assert.ok(await aliceControl.evaluate(() => isSecureContext));
    const principals = await Promise.all([aliceControl, bobControl, otherControl].map(page => page.evaluate(() => JSON.parse(document.body.textContent).principal)));
    assert.deepEqual(principals, ['fixture-alpha', 'fixture-bravo', 'fixture-alpha']);
    const controlCookies = await alice.cookies(control);
    assert.ok(controlCookies.some(cookie => cookie.name === '__Host-m0_principal' && cookie.httpOnly && cookie.secure && cookie.domain === controlURL.hostname));
    assert.equal(await aliceControl.evaluate(() => document.cookie), '');
    return { browser_version: browser.version(), independent_contexts: 3 };
  });
  await check('copied_full_ticket_denies_other_tenant_and_independent_same_tenant_session', async () => {
    const url = await ticket(aliceControl);
    for (const context of [bob, anotherAlice]) {
      const page = await context.newPage();
      const response = await page.goto(url); assert.equal(response.status(), 403); await page.close();
    }
    // Same original URL still works for its owner: wrong subjects did not burn it.
    const page = await alice.newPage();
    const response = await page.goto(url); assert.equal(response.status(), 200); await ready(page); await page.close();
    return { copied_context_cookies: false, owner_ticket_preserved: true };
  });
  await check('real_DO_one_use_concurrent_authorization_and_redemption', async () => {
    for (const key of ['__proto__', 'constructor', 'toString']) {
      const denied = await localRequest(`${control}/m0/browser/enroll?code=${key}`);
      assert.equal(denied.status, 403); assert.equal(denied.headers['set-cookie'], undefined);
    }
    const url = await ticket(aliceControl);
    const begun = await localRequest(url); assert.equal(begun.status, 303);
    const sid = await cookiesAt(alice, control), challenge = firstCookie(begun);
    const authorized = await Promise.all([localRequest(begun.headers.location, { headers: { cookie: sid } }), localRequest(begun.headers.location, { headers: { cookie: sid } })]);
    assert.deepEqual(authorized.map(result => result.status).sort(), [303, 403]);
    const code = authorized.find(result => result.status === 303).headers.location;
    const copied = await bob.newPage(); assert.equal((await copied.goto(code)).status(), 403); await copied.close();
    const redeemed = await Promise.all([localRequest(code, { headers: { cookie: challenge } }), localRequest(code, { headers: { cookie: challenge } })]);
    assert.deepEqual(redeemed.map(result => result.status).sort(), [303, 403]);
    assert.equal((await localRequest(code, { headers: { cookie: challenge } })).status, 403);
    return { authorization_statuses: [303, 403], redemption_statuses: [303, 403], code_without_challenge_denied: true, transport: 'Node HTTPS against real DO; browser-copy check uses independent context' };
  });
  await check('borrowed_owner_authorize_navigation_without_original_nonce_does_not_burn_ticket', async () => {
    const url = await ticket(aliceControl);
    // A different client starts the challenge; its nonce stays outside Alice.
    const foreign = await localRequest(url); assert.equal(foreign.status, 303);
    const owner = await alice.newPage();
    assert.equal((await owner.goto(foreign.headers.location)).status(), 403);
    assert.equal((await owner.goto(url)).status(), 200);
    await ready(owner); await owner.close();
    return { failed_nonce_did_not_consume_ticket: true };
  });
  await check('document_JS_API_WS_and_iframe_load_with_isolated_httponly_credentials', async () => {
    const frame = await framePreview(aliceControl);
    const observed = await frame.evaluate(() => ({ secure: isSecureContext, cookie: document.cookie, state: document.querySelector('#state').textContent, stream: document.querySelector('#socket').textContent }));
    const cookie = (await alice.cookies(frame.url())).find(value => value.name === '__Host-m0_preview');
    // Persist fixed booleans only, never cookie values or authorization URLs.
    receipt.iframe_diagnostics.phase = 'cookie-and-context-assertions';
    receipt.iframe_diagnostics.checks = {
      secure_context: observed.secure,
      state_marker_present: observed.state.includes('m0-fixed-state'),
      stream_marker_present: observed.stream.includes('m0-fixed-state'),
      document_cookie_empty: observed.cookie === '',
      preview_cookie_present: Boolean(cookie),
      preview_cookie_http_only: cookie?.httpOnly === true,
      preview_cookie_secure: cookie?.secure === true,
      preview_cookie_host_matches: cookie?.domain === new URL(frame.url()).hostname,
      preview_cookie_path_root: cookie?.path === '/',
      control_has_no_preview_cookie: !(await alice.cookies(control)).some(value => value.name === '__Host-m0_preview'),
      preview_has_no_principal_cookie: !(await alice.cookies(frame.url())).some(value => value.name === '__Host-m0_principal'),
    };
    assert.ok(observed.secure && observed.state.includes('m0-fixed-state') && observed.stream.includes('m0-fixed-state'));
    assert.equal(observed.cookie, '');
    assert.ok(cookie?.httpOnly && cookie.secure && cookie.domain === new URL(frame.url()).hostname && cookie.path === '/');
    assert.equal((await alice.cookies(control)).some(value => value.name === '__Host-m0_preview'), false);
    // Storage enumeration is not wire evidence for ancestor host-only cookies.
    const wire = receipt.iframe_diagnostics.network = {
      preview: await browserCookieWire(aliceControl, frame, './api/state', 'm0-fixed-state'),
      control: await browserCookieWire(aliceControl, aliceControl.mainFrame(), '/m0/browser/session', 'fixture-alpha'),
    };
    assert.deepEqual(wire.preview, { http_status: 200, expected_marker: true, no_redirect: true, principal_cookie_sent: false, preview_cookie_sent: true });
    assert.deepEqual(wire.control, { http_status: 200, expected_marker: true, no_redirect: true, principal_cookie_sent: true, preview_cookie_sent: false });
    await aliceControl.screenshot({ path: path.join(output, 'same-site-isolated-preview.png') });
    return { preview_origin: new URL(frame.url()).origin, document_cookie_empty: true, request_cookie_evidence: wire, iframe_sandbox: await aliceControl.locator('#preview').getAttribute('sandbox') };
  });
  await check('same_instance_two_independent_observers_report_identical_routing_marker_and_state', async () => {
    const first = await framePreview(aliceControl);
    const other = await openPreview(anotherAlice, otherControl);
    const states = await Promise.all([first, other].map(page => page.evaluate(() => JSON.parse(document.querySelector('#state').textContent))));
    assert.deepEqual(states[0], states[1]);
    assert.equal(states[0].fixture_instance_marker, grantA.grant.generation);
    await other.close();
    return { observers: 2, matching_state_sequence: states[0].state_sequence, routing_marker_matches_expected_generation: true };
  });
  await check('iframe_cannot_read_parent_or_navigate_top_and_cannot_inject_domain_host_cookie', async () => {
    const frame = await framePreview(aliceControl);
    const before = aliceControl.url();
    const observed = await frame.evaluate(({ site, control }) => {
      let parentDenied = false, domainDenied = false, topDenied = false;
      try { void parent.document.body; } catch { parentDenied = true; }
      try { document.domain = site; domainDenied = document.domain !== site; } catch { domainDenied = true; }
      try { top.location.href = `${control}/m0/browser/session`; } catch { topDenied = true; }
      document.cookie = `__Host-m0_principal=forged; Domain=${site}; Path=/; Secure`;
      document.cookie = `__Host-m0_preview=forged; Domain=${site}; Path=/; Secure`;
      return { parentDenied, domainDenied, topDenied, credentialReadable: /__Host-m0_/.test(document.cookie) };
    }, { site: registrableSite, control });
    assert.deepEqual(observed, { parentDenied: true, domainDenied: true, topDenied: true, credentialReadable: false });
    assert.equal(aliceControl.url(), before);
    assert.equal(await fetchStatus(frame, './api/state'), 200);
    assert.equal(await fetchStatus(aliceControl, '/m0/browser/session'), 200);
  });
  await check('same_site_project_control_write_CSRF_denied_even_with_control_cookie', async () => {
    const frame = await framePreview(aliceControl);
    const endpoint = `${control}/m0/browser/logout`;
    const previewOrigin = new URL(frame.url()).origin;
    const deadlineAt = Date.now() + 12000;
    const diagnostics = {
      cdp_attached: false, target_mode: 'not_attached', expected_frame_identified: false,
      matching_post_requests: 0, request_extra_info_observed: false,
      cookie_header_observed: false, origin_header_matched: false, sec_fetch_site: null,
      response_extra_info_observed: false, network_status: null,
      cors_failure_observed: false, browser_fetch_rejected: false,
      session_still_valid: false, deadline_elapsed: false, cdp_detached: false,
      event_counts: { request: 0, request_extra: 0, response_extra: 0, loading_failed: 0 },
    };
    // Only these booleans/statuses/counts enter the artifact. Raw CDP headers,
    // request IDs and authentication URLs never leave this closure.
    receipt.csrfNetworkEvidence = diagnostics;
    const bounded = async (promise, limit = deadlineAt) => {
      let timer;
      try {
        return await Promise.race([promise, new Promise((_, reject) => {
          timer = setTimeout(() => { diagnostics.deadline_elapsed = true; reject(new Error('csrf-network-evidence-deadline')); }, Math.max(1, limit - Date.now()));
        })]);
      } finally { clearTimeout(timer); }
    };
    let cdp, disposed = false;
    const listeners = [];
    const attach = target => {
      const pending = alice.newCDPSession(target);
      pending.then(session => { if (disposed) void session.detach().catch(() => {}); }, () => {});
      return bounded(pending);
    };
    try {
      try {
        // Playwright attaches to the actual iframe target when this is an OOPIF.
        cdp = await attach(frame);
        diagnostics.target_mode = 'iframe';
      } catch (error) {
        // Installed Playwright explicitly reports this for a same-process frame.
        // Its requests then belong to the parent target; still filter its frameId.
        if (!String(error?.message).includes('does not have a separate CDP session')) throw error;
        cdp = await attach(aliceControl);
        diagnostics.target_mode = 'parent-target-with-exact-frame-id';
      }
      diagnostics.cdp_attached = true;
      const tree = await bounded(cdp.send('Page.getFrameTree'));
      const frames = [];
      const visit = node => { frames.push(node.frame); for (const child of node.childFrames ?? []) visit(child); };
      visit(tree.frameTree);
      const expected = frames.filter(value => value.url === frame.url());
      assert.equal(expected.length, 1, 'exact-iframe-target-required');
      const expectedFrameId = expected[0].id;
      diagnostics.expected_frame_identified = true;
      const records = new Map();
      const record = id => {
        if (!records.has(id)) records.set(id, {});
        return records.get(id);
      };
      let finishNetwork;
      const networkReady = new Promise(resolve => { finishNetwork = resolve; });
      const update = () => {
        const matches = [...records.values()].filter(value => value.matches);
        diagnostics.matching_post_requests = matches.length;
        if (matches.length !== 1) return;
        const value = matches[0];
        diagnostics.request_extra_info_observed = value.requestExtra === true;
        diagnostics.cookie_header_observed = value.cookieSent === true;
        diagnostics.origin_header_matched = value.originMatches === true;
        diagnostics.sec_fetch_site = value.fetchSite ?? null;
        diagnostics.response_extra_info_observed = value.responseExtra === true;
        diagnostics.network_status = value.status ?? null;
        diagnostics.cors_failure_observed = value.corsFailure === true;
        // ExtraInfo can arrive before requestWillBeSent, and CORS failures may
        // have no responseReceived event. Correlate all by the same requestId.
        if (value.requestExtra && value.responseExtra && value.loadingFailed) finishNetwork();
      };
      const listen = (event, callback) => { listeners.push([event, callback]); cdp.on(event, callback); };
      listen('Network.requestWillBeSent', event => {
        diagnostics.event_counts.request++;
        if (event.request.url !== endpoint || event.request.method !== 'POST' || event.frameId !== expectedFrameId) return;
        record(event.requestId).matches = true;
        update();
      });
      listen('Network.requestWillBeSentExtraInfo', event => {
        diagnostics.event_counts.request_extra++;
        const value = record(event.requestId);
        const header = name => Object.entries(event.headers).find(([key]) => key.toLowerCase() === name)?.[1];
        value.requestExtra = true;
        value.cookieSent = /(?:^|;\s*)__Host-m0_principal=/.test(String(header('cookie') ?? ''));
        value.originMatches = header('origin') === previewOrigin;
        const fetchSite = header('sec-fetch-site');
        value.fetchSite = ['same-site', 'same-origin', 'cross-site', 'none'].includes(fetchSite) ? fetchSite : 'unknown';
        update();
      });
      listen('Network.responseReceivedExtraInfo', event => {
        diagnostics.event_counts.response_extra++;
        const value = record(event.requestId);
        value.responseExtra = true; value.status = event.statusCode;
        update();
      });
      listen('Network.loadingFailed', event => {
        diagnostics.event_counts.loading_failed++;
        const value = record(event.requestId);
        value.loadingFailed = true;
        value.corsFailure = !!event.corsErrorStatus || event.blockedReason === 'cors';
        update();
      });
      await bounded(cdp.send('Network.enable'));
      const attempted = frame.evaluate(async target => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try { await fetch(target, { method: 'POST', credentials: 'include', signal: controller.signal }); return 'response-readable'; }
        catch (error) { return error.name === 'TypeError' ? 'fetch-rejected' : 'fetch-aborted-or-other-error'; }
        finally { clearTimeout(timer); }
      }, endpoint).then(outcome => {
        diagnostics.browser_fetch_rejected = outcome === 'fetch-rejected';
        return outcome;
      });
      const [, outcome] = await bounded(Promise.all([networkReady, attempted]));
      diagnostics.browser_fetch_rejected = outcome === 'fetch-rejected';
      assert.equal(diagnostics.matching_post_requests, 1);
      assert.ok(diagnostics.request_extra_info_observed && diagnostics.cookie_header_observed && diagnostics.origin_header_matched);
      assert.ok(diagnostics.response_extra_info_observed);
      if (cloud) assert.equal(diagnostics.sec_fetch_site, 'same-site', 'real-browser-must-confirm-declared-site');
      assert.equal(diagnostics.network_status, 403);
      assert.ok(diagnostics.cors_failure_observed && diagnostics.browser_fetch_rejected);
      diagnostics.session_still_valid = await bounded(fetchStatus(aliceControl, '/m0/browser/session')) === 200;
      assert.ok(diagnostics.session_still_valid);
      return { HTTP_status: diagnostics.network_status, authenticated_cookie_was_sent: diagnostics.cookie_header_observed, evidence_transport: 'Chrome-CDP-correlated-frame-network-events' };
    } finally {
      disposed = true;
      if (cdp) {
        for (const [event, callback] of listeners) cdp.off(event, callback);
        await bounded(cdp.detach(), Date.now() + 2000);
        diagnostics.cdp_detached = true;
      }
    }
  });
  await check('real_HTTP_header_redirect_raw_route_SSRF_and_WS_Origin_regression', async () => {
    const page = await openPreview(alice, aliceControl);
    const pageURL = page.url(), cookie = await cookiesAt(alice, pageURL);
    for (const route of ['', 'app.js', 'api/state']) assert.equal((await localRequest(pageURL + route)).status, 403);
    const headers = await localRequest(`${pageURL}api/headers`, { headers: { cookie: `platform_session=synthetic; ${cookie}`, referer: control, origin: new URL(pageURL).origin, 'x-sandbox-port': '3000', 'x-forwarded-host': 'evil.invalid' } });
    assert.equal(headers.status, 200);
    assert.ok(Object.values(JSON.parse(headers.body).observed_header_presence).every(value => !value));
    const forged = await localRequest(`${pageURL}set-cookie`, { headers: { cookie } });
    assert.equal(forged.status, 200); assert.equal(forged.headers['set-cookie'], undefined); assert.equal(forged.headers['access-control-allow-origin'], undefined);
    for (const route of ['redirect-external', 'redirect-control']) assert.equal((await localRequest(pageURL + route, { headers: { cookie } })).status, 502);
    const safe = await localRequest(`${pageURL}redirect-safe`, { headers: { cookie } }); assert.equal(safe.status, 302); assert.equal(safe.headers.location, `${pageURL}api/state`);
    assert.equal((await localRequest(`${new URL(pageURL).origin}/proxy/8080/`, { headers: { cookie } })).status, 404);
    assert.equal((await localRequest(`${pageURL}api/state?url=http://169.254.169.254/`, { headers: { cookie } })).status, 404);
    for (const origin of [undefined, 'https://evil.invalid', control]) {
      const result = await localRequest(`${pageURL}ws`, { websocket: true, headers: { cookie, ...(origin ? { origin } : {}), upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64') } });
      assert.equal(result.status, 403);
    }
    if (cloud) {
      await deniedCredentials('no-browser-credential', pageURL);
      const pathname = new URL(pageURL).pathname;
      await deniedIngress('active-generation', new URL(pageURL).origin, ['/api/state', '/proxy/8080/', '/__sandbox/8080/', '/ws']);
      const unknown = new URL(base); unknown.hostname = `p-${randomBytes(16).toString('hex')}.${unknown.hostname}`;
      await deniedIngress('unknown-generation', unknown.origin, [pathname, pathname + 'api/state', pathname + 'ws']);
      for (const ingress of [control, base, ...inputs.ingressOrigins]) await deniedIngress('scope-path-on-wrong-ingress', ingress, [pathname, pathname + 'api/state', pathname + 'ws'], inputs.ingressOrigins.includes(ingress));
      const diagnostics = await management('diagnostics');
      assert.equal(diagnostics.generation, grantA.grant.generation);
      assert.equal(diagnostics.sdk_exposed_port_count, 0);
      assert.deepEqual(diagnostics.sdk_exposed_ports, []);
      assert.equal(diagnostics.urls_redacted, true);
      assert.equal(diagnostics.raw_preview_url, null);
      assert.equal(diagnostics.control_redirect_origin, control);
      receipt.sdk_port_exposure = { status: 'passed', count: 0, method: 'SDK-getExposedPorts-read-only', urls_persisted: false, generation_matches: true };
    }
    await page.close();
  });
  await check('logout_revokes_issued_preview_access_and_active_websocket', async () => {
    const frame = await framePreview(aliceControl);
    const oldCookie = cloud ? await cookiesAt(alice, frame.url()) : undefined;
    const pendingTicket = cloud ? await ticket(aliceControl) : undefined;
    const principalCookie = cloud ? await cookiesAt(alice, control) : undefined;
    const started = Date.now();
    assert.equal(await fetchStatus(aliceControl, '/m0/browser/logout', { method: 'POST' }), 204);
    await wsClosed(frame);
    assert.equal(await fetchStatus(frame, './api/state'), 403);
    assert.equal(await fetchStatus(aliceControl, '/m0/browser/session'), 403);
    const revocationLatency = Date.now() - started;
    if (cloud) {
      await deniedCredentials('platform-session-logout', frame.url(), oldCookie);
      assert.equal((await localRequest(pendingTicket)).status, 403);
      assert.equal((await localRequest(`${control}/m0/browser/session`, { headers: { cookie: principalCookie } })).status, 403);
      receipt.credential_matrix.push({ phase: 'platform-session-logout', resource: 'pending-ticket-and-principal-cookie-replay', http_status: 403, status: 'passed' });
    }
    return { websocket_closed_code: 1008, revocation_latency_ms: revocationLatency };
  });
  // Logout removed the original platform cookie. New enrollment is a new sid.
  await aliceControl.close(); aliceControl = await enroll(alice, 'alpha');
  await check('real_wall_clock_access_expiry_closes_websocket_and_denies_HTTP', async () => {
    const frame = await framePreview(aliceControl);
    const expiringCookie = cloud ? await cookiesAt(alice, frame.url()) : undefined;
    const started = Date.now();
    await frame.waitForFunction(() => document.querySelector('#socket')?.textContent?.includes('[closed 1008]'), null, { timeout: 25000 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 15000 && elapsed <= 25000, 'expiry must use wall-clock short TTL');
    assert.equal(await fetchStatus(frame, './api/state'), 403);
    await deniedCredentials('access-wall-clock-expiry', frame.url(), expiringCookie);
    return { configured_access_seconds: 20, observed_wait_ms: elapsed, websocket_closed_code: 1008 };
  });
  let replacement;
  await check('preview_revocation_and_generation_replacement_reject_old_access_and_change_origin', async () => {
    const frame = await framePreview(aliceControl);
    const old = frame.url(), oldCookie = await cookiesAt(alice, old);
    const revoked = await management('revoke'); assert.equal(revoked.cleanup, 'destroy_acknowledged');
    await wsClosed(frame); assert.equal((await localRequest(old, { headers: { cookie: oldCookie } })).status, 403);
    await deniedCredentials('preview-revocation', old, oldCookie);
    replacement = await management('start'); assert.notEqual(replacement.origin, grantA.origin);
    const fresh = await framePreview(aliceControl);
    assert.equal(new URL(fresh.url()).origin, replacement.origin);
    assert.equal((await localRequest(old, { headers: { cookie: oldCookie } })).status, 403);
    await deniedCredentials('old-generation-after-replacement', old, oldCookie);
    return { previous_origin: grantA.origin, replacement_origin: replacement.origin };
  });
  await check('alpha_bravo_have_distinct_actual_origins_and_host_only_cookie_jars', async () => {
    const bravo = await management('start', 'bravo');
    const page = await openPreview(bob, bobControl, run, 'bravo');
    assert.notEqual(new URL(page.url()).origin, replacement.origin);
    assert.equal(new URL(page.url()).origin, bravo.origin);
    assert.equal((await alice.cookies(page.url())).some(cookie => cookie.name === '__Host-m0_preview'), false);
    assert.equal((await bob.cookies(replacement.origin)).some(cookie => cookie.name === '__Host-m0_preview'), false);
    if (cloud) {
      const alphaFrame = await framePreview(aliceControl);
      const alphaCookie = await cookiesAt(alice, alphaFrame.url());
      assert.equal((await localRequest(alphaFrame.url() + 'api/state', { headers: { cookie: alphaCookie } })).status, 200);
      await deniedCredentials('other-tenant-scope-with-live-alpha-credential', page.url(), alphaCookie);
      assert.equal((await localRequest(alphaFrame.url() + 'api/state', { headers: { cookie: alphaCookie } })).status, 200);
    }
    await page.close();
    assert.equal((await management('cleanup', 'bravo')).cleanup, 'destroy_acknowledged');
    return { alpha_origin: replacement.origin, bravo_origin: bravo.origin, routing_markers_match_expected_generations: true };
  });
  await check('two_same_tenant_previews_isolate_origin_DOM_CSP_and_cookies', async () => {
    const second = await management('start', 'alpha', run2);
    const first = await framePreview(aliceControl);
    const secondURL = await ticket(aliceControl, run2);
    await aliceControl.evaluate(url => {
      const frame = document.createElement('iframe'); frame.id = 'preview-two'; frame.title = 'Second synthetic Preview';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin'); frame.src = url; document.body.append(frame);
    }, secondURL);
    const other = await (await aliceControl.locator('#preview-two').elementHandle()).contentFrame();
    await ready(other);
    assert.notEqual(new URL(first.url()).origin, new URL(other.url()).origin);
    assert.equal(new URL(other.url()).origin, second.origin);
    const accessA = (await alice.cookies(first.url())).find(cookie => cookie.name === '__Host-m0_preview');
    const accessB = (await alice.cookies(other.url())).find(cookie => cookie.name === '__Host-m0_preview');
    assert.ok(accessA && accessB && accessA.domain !== accessB.domain && accessA.value !== accessB.value);
    const observed = await first.evaluate(async target => {
      let parentDenied = false, siblingDenied = false, fetchDenied = false;
      try { void parent.document.body; } catch { parentDenied = true; }
      try { void parent.frames[1].document.body; } catch { siblingDenied = true; }
      try { await fetch(target, { credentials: 'include' }); } catch { fetchDenied = true; }
      return { parentDenied, siblingDenied, fetchDenied, credentialReadable: /__Host-m0_/.test(document.cookie) };
    }, `${other.url()}api/state`);
    assert.deepEqual(observed, { parentDenied: true, siblingDenied: true, fetchDenied: true, credentialReadable: false });
    assert.equal(await fetchStatus(first, './api/state'), 200);
    assert.equal(await fetchStatus(other, './api/state'), 200);
    if (cloud) {
      const firstCookie = await cookiesAt(alice, first.url());
      await deniedCredentials('same-tenant-other-preview-scope-with-live-credential', other.url(), firstCookie);
      assert.equal((await localRequest(first.url() + 'api/state', { headers: { cookie: firstCookie } })).status, 200);
    }
    return { first_origin: new URL(first.url()).origin, second_origin: new URL(other.url()).origin, same_tenant: true, routing_markers_match_expected_generations: true, cross_preview_fetch_denied_by_CSP: true };
  });
  await drainAccounting(); business.check();
  receipt.status = cloud ? 'cloud_checks_passed_gate_not_evaluated' : 'local_checks_passed';
  if (cloud) receipt.cloud_browser_matrix = 'executed-see-cases-and-explicit-missing-matrix';
  });
} catch (error) {
  receipt.status = 'failed';
  receipt.failure = { case: currentCase, error_type: error?.name ?? 'Error' };
  process.exitCode = 1;
} finally {
  business.finish();
  const cleanupBudget = new PreviewBudget(CLEANUP_LIMITS);
  try {
    // Cleanup is idempotent and has its own fresh deadline/counters. Exactly one
    // final attempt per owned scope; a lost start response never gets replayed.
    await cleanupBudget.run(() => Promise.allSettled([
      ...[...owned.values()].map(async ({ runId, tenant }) => {
        try { await management('cleanup', tenant, runId, cleanupBudget); }
        catch { cleanup.push({ run_id: runId, tenant, acknowledgment: 'cleanup_not_confirmed' }); process.exitCode = 1; }
      }),
      (async () => {
        try { await cleanupBudget.run(closeBrowser); receipt.browser_closed = true; }
        catch { receipt.browser_closed = false; receipt.status = 'failed'; process.exitCode = 1; }
      })(),
    ]));
  } catch {
    receipt.status = 'failed'; receipt.cleanup_budget_exhausted = true; process.exitCode = 1;
  } finally {
    cleanupBudget.finish();
    receipt.browser_closed ??= false;
    receipt.budgets.business = business.snapshot();
    receipt.budgets.cleanup = cleanupBudget.snapshot();
    receipt.budgets.mutations = mutations.snapshot();
  }
  try {
    receipt.sourcesAfter = sources();
    receipt.probeSourceStableDuringRun = receipt.sourcesAfter.sha256 === before.sha256;
  } catch {
    receipt.probeSourceStableDuringRun = false;
    receipt.sourceInventoryError = 'post-run-source-inventory-failed';
  }
  if (!receipt.probeSourceStableDuringRun) {
    receipt.status = 'failed';
    receipt.failure ??= { case: 'scoped-source-stability', error_type: 'SourceChangedDuringRun' };
    process.exitCode = 1;
  }
  receipt.completed_at = new Date().toISOString();
  if (owned.size) { receipt.status = 'failed'; process.exitCode = 1; }
  await writeFile(path.join(output, evidenceName), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  if (receipt.browser_closed) clearTimeout(hardDeadline);
  // Paths and case names only: no cookies, bearer, enrollment, ticket or code URLs.
  console.log(JSON.stringify({ status: receipt.status, run_id: run, evidence: path.join(output, evidenceName), failed_case: receipt.failure?.case, cleanup_confirmed: owned.size === 0, probeSourceStableDuringRun: receipt.probeSourceStableDuringRun }));
}

}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3, 'local-driver-usage');
    await runPreviewProbe(await localInputs(process.argv[2]));
  } catch {
    console.error('Preview local preflight failed. Usage: node scripts/m0/preview-browser.mjs <TLS-directory>.');
    process.exitCode = 1;
  }
}
