import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { recoveryRuntimeScript } from '../../spikes/m0-recovery/runtime.ts';
import { hash, safePath, sourceSnapshot } from './source-inventory.mjs';
import { readProbeSecret } from './storage-cloud.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const ORIGIN = 'https://riffology-m0-recovery-staging.jihe-gao.workers.dev';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SECRET = '.local/cloud-staging/recovery.secrets.json';
const SCENARIOS = ['disconnect', 'process', 'container'];
const ACTIVE = ['queued', 'preparing', 'launching', 'ready-wait', 'go-intent', 'streaming', 'finishing'];
const TERMINAL = ['completed', 'interrupted'];
export const LIMITS = Object.freeze({ scenarios: 3, activeBusinessInstances: 1, runtimeLifecycles: 5,
  scenarioRequests: 330, cleanupRequests: 50, totalRequests: 990, businessMs: 420000,
  cleanupMs: 90000, totalMs: 1530000, requestMs: 15000, browserCloseMs: 15000,
  responseBytes: 65536, frameBytes: 16384, totalBytes: 33554432, reportRetries: 3, pollMs: 1500 });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--deployment' || !argv[1] || argv[1].startsWith('--')) throw new Error('one-deployment-file-required');
  return argv[1];
}
export function recoverySources(repository = root) {
  const snapshot = sourceSnapshot(repository);
  const selected = new Set(['spikes/m0-recovery/index.ts', 'spikes/m0-recovery/worker.ts', 'spikes/m0-recovery/runtime.ts',
    'spikes/m0-recovery/env.d.ts', 'spikes/m0-recovery/bounded-effect.ts', 'spikes/m0-cloud/auth.ts', 'spikes/m0-storage/adapters.ts', 'spikes/m0-storage/checkpoint.ts',
    'services/runtime/controlled-pi.mjs', 'infra/wrangler.m0-recovery.jsonc', 'infra/m0-trusted.Dockerfile', '.dockerignore',
    'scripts/m0/recovery-cloud.mjs', 'scripts/m0/storage-cloud.mjs', 'scripts/m0/source-inventory.mjs',
    'tests/m0/recovery-cloud.test.mjs', 'package.json', 'package-lock.json', 'tsconfig.json']);
  const files = snapshot.files.filter(file => selected.has(file.path));
  assert.equal(files.length, selected.size, 'recovery-scoped-source-inventory-incomplete');
  return { sha256: hash(JSON.stringify(files)), files, repositorySourceSha256: snapshot.sha256 };
}
export function configuredImage(repository = root) {
  const config = JSON.parse(readFileSync(resolve(repository, 'infra/wrangler.m0-recovery.jsonc'), 'utf8'));
  const image = config.env?.staging?.containers?.[0]?.image;
  if (config.env?.staging?.vars?.M0_EXECUTION_ENVIRONMENT !== 'cloudflare-vm'
    || !/^docker\.io\/jihegao\/riffology-m0-trusted-proxy@sha256:[a-f0-9]{64}$/.test(image ?? '')) throw new Error('pinned-cloud-recovery-configuration-required');
  return image;
}
export function validateDeployment(value, sources, imageRef, now = Date.now()) {
  if (!value || value.verified !== true || value.mode !== 'fixture-only' || value.origin !== ORIGIN
    || value.accountId !== '8b0d70250211aa10d89e20605a1c7e5e' || value.scriptName !== 'riffology-m0-recovery-staging'
    || !uuid.test(value.versionId ?? '') || !/^[a-f0-9]{64}$/.test(value.bundleSha256 ?? '')
    || value.imageRef !== imageRef || value.executionEnvironment !== 'cloudflare-vm'
    || !Number.isSafeInteger(value.verifiedAtMs) || value.verifiedAtMs > now || now - value.verifiedAtMs > 900000
    || value.sourceSha256 !== sources.sha256 || JSON.stringify(value.sourceFiles) !== JSON.stringify(sources.files)) throw new Error('fresh-verified-recovery-deployment-required');
  return { verified: true, mode: value.mode, origin: value.origin, accountId: value.accountId, scriptName: value.scriptName,
    versionId: value.versionId, bundleSha256: value.bundleSha256, imageRef, executionEnvironment: value.executionEnvironment,
    verifiedAtMs: value.verifiedAtMs, sourceSha256: value.sourceSha256, sourceFiles: value.sourceFiles };
}
function readDeployment(input, sources) {
  const path = safePath(root, resolve(root, input), 'deployment evidence');
  if (basename(path) !== 'deployment-verified.json' || !relative(root, path).startsWith(`docs${sep}evidence${sep}runs${sep}`)
    || lstatSync(path).size > 262144) throw new Error('bounded-deployment-evidence-required');
  const raw = readFileSync(path, 'utf8');
  return { ...validateDeployment(JSON.parse(raw), sources, configuredImage()), evidenceFile: relative(root, path), evidenceSha256: hash(raw) };
}
export function assertOrdered(events) {
  assert.ok(Array.isArray(events) && events.length <= 64);
  for (const [index, event] of events.entries()) {
    assert.equal(event.sequence, index + 1);
    assert.ok(Number.isSafeInteger(event.generation) && event.generation >= 1 && event.generation <= 2);
    assert.ok(['phase', 'cleanup'].includes(event.kind));
    assert.ok([...ACTIVE, 'interrupting', ...TERMINAL].includes(event.phase));
    assert.ok(event.reason === null || typeof event.reason === 'string' && event.reason.length <= 120);
    assert.ok(typeof event.at === 'string' && Number.isFinite(Date.parse(event.at)));
  }
}
export class EventDecoder {
  constructor(cursor = 0) { this.cursor = cursor; this.events = []; this.buffer = ''; this.bytes = 0; this.decoder = new TextDecoder('utf-8', { fatal: true }); }
  push(chunk, done = false) {
    this.bytes += chunk.byteLength;
    if (this.bytes > LIMITS.responseBytes) throw new Error('event-byte-limit');
    this.buffer += this.decoder.decode(chunk, { stream: !done });
    this.buffer = this.buffer.replaceAll('\r\n', '\n');
    while (this.buffer.includes('\n\n')) {
      const at = this.buffer.indexOf('\n\n'), frame = this.buffer.slice(0, at); this.buffer = this.buffer.slice(at + 2);
      if (Buffer.byteLength(frame) > LIMITS.frameBytes) throw new Error('event-frame-limit');
      const lines = frame.split('\n'); if (lines.every(line => !line || line.startsWith(':'))) continue;
      const ids = lines.filter(line => line.startsWith('id: ')), data = lines.filter(line => line.startsWith('data: '));
      if (ids.length !== 1 || data.length !== 1 || lines.filter(line => line === 'event: turn').length !== 1
        || lines.some(line => !line.startsWith('id: ') && !line.startsWith('data: ') && line !== 'event: turn')) throw new Error('invalid-event-frame');
      const event = JSON.parse(data[0].slice(6));
      if (!/^[1-9][0-9]{0,5}$/.test(ids[0].slice(4)) || Number(ids[0].slice(4)) !== this.cursor + 1
        || event.sequence !== this.cursor + 1 || this.events.length >= 64) throw new Error('event-sequence-mismatch');
      this.cursor = event.sequence; this.events.push(event);
    }
    if (Buffer.byteLength(this.buffer) > LIMITS.frameBytes || done && this.buffer.trim()) throw new Error('incomplete-or-oversize-event-frame');
  }
}
function bounded(promise, ms) {
  let timer; const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('operation-deadline')), Math.max(1, ms)); });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}
function untilAbort(promise, signal) {
  return new Promise((resolvePromise, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('request-deadline')); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolvePromise(value); }, error => {
      signal.removeEventListener('abort', abort); reject(error);
    });
    if (signal.aborted) abort();
  });
}

// Browser page lifetime is independent of the durable producer. Credentials are
// passed only to a same-origin fetch with redirects disabled, never navigation.
async function prepareBrowser(runId, token, meter) {
  if (['DEBUG', 'DEBUG_FILE', 'PWDEBUG', 'PWDEBUGIMPL', 'PW_TEST_DEBUG_CONTROLLER'].some(key => process.env[key])) throw new Error('browser-debug-output-must-be-disabled');
  const { chromium } = await import('playwright');
  // Match the operator's existing Node transport when a credential-free local
  // HTTPS proxy is configured. Never pass arbitrary authenticated proxy URLs.
  let proxy;
  if (process.env.HTTPS_PROXY) {
    const configured = new URL(process.env.HTTPS_PROXY);
    if (configured.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(configured.hostname)
      || configured.username || configured.password || configured.pathname !== '/' || configured.search || configured.hash) throw new Error('unsupported-browser-proxy');
    proxy = { server: configured.origin };
  }
  let browser, page, closed = false;
  const reportUrl = ORIGIN + '/probe/' + runId + '/report';
  const eventsUrl = ORIGIN + '/probe/' + runId + '/events';
  const rows = [];
  async function close() {
    if (closed) return { pageClosed: true, browserDisconnected: true };
    try { if (page && !page.isClosed()) await bounded(page.close(), LIMITS.browserCloseMs); }
    finally { if (browser) await bounded(browser.close(), LIMITS.browserCloseMs); }
    if (page && !page.isClosed() || browser && browser.isConnected()) throw new Error('browser-close-unconfirmed');
    closed = true;
    for (const row of rows) if (!row.finishedAt) {
      row.finishedAt = new Date().toISOString(); row.outcome = row.httpStatus === undefined ? 'browser-request-unconfirmed' : 'browser-observation-closed'; meter.finish(row);
    }
    return { pageClosed: true, browserDisconnected: true, completedAt: new Date().toISOString() };
  }
  try {
    browser = await chromium.launch({ executablePath: CHROME, headless: true, timeout: LIMITS.requestMs,
      ...(proxy ? { proxy } : {}),
      args: [...(proxy ? [] : ['--no-proxy-server']), '--disable-background-networking', '--no-first-run'],
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', TMPDIR: process.env.TMPDIR ?? '/tmp' } });
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.url() === reportUrl || request.url() === eventsUrl) return route.continue();
      const row = meter.start('browser-unrequested-resource-blocked', request.method(), 'browser');
      row.outcome = 'blocked-before-dispatch'; row.finishedAt = new Date().toISOString(); meter.finish(row);
      await route.abort();
    });
    page = await context.newPage();
    const navigation = meter.start('browser-navigation', 'GET', 'browser'); rows.push(navigation);
    const response = await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: LIMITS.requestMs });
    assert.equal(response?.status(), 401); assert.equal(page.url(), reportUrl);
    assert.match(response.headers()['content-type'] ?? '', /^application\/json/);
    const bytes = await response.body(); assert.ok(bytes.length <= LIMITS.responseBytes); meter.receive(bytes.length);
    Object.assign(navigation, { httpStatus: 401, responseBytes: bytes.length, path: new URL(reportUrl).pathname,
      outcome: 'response-observed', finishedAt: new Date().toISOString() }); meter.finish(navigation);
    return {
      close, validate() { if (!closed) throw new Error('browser-still-open'); },
      async connect() {
        const row = meter.start('browser-events', 'GET', 'browser'); rows.push(row);
        const observation = await bounded(page.evaluate(async ({ token, url, limit }) => {
          const controller = new AbortController();
          const response = await fetch(url, { headers: { authorization: 'Bearer ' + token }, redirect: 'error', cache: 'no-store', signal: controller.signal });
          if (response.status !== 200 || response.url !== url || !response.body || !/^text\/event-stream/.test(response.headers.get('content-type') ?? '')) throw new Error('event-stream-unavailable');
          const reader = response.body.getReader();
          window.__m0RecoveryObservation = { reader, controller, remoteClosed: false };
          void reader.closed.then(() => { window.__m0RecoveryObservation.remoteClosed = true; }, () => { window.__m0RecoveryObservation.remoteClosed = true; });
          const decoder = new TextDecoder('utf-8', { fatal: true }); let received = 0, buffer = '';
          for (;;) {
            const part = await reader.read(); if (part.done) throw new Error('stream-ended-before-close');
            received += part.value.byteLength; if (received > limit) throw new Error('event-byte-limit');
            buffer += decoder.decode(part.value, { stream: true });
            const id = /^id: ([1-9][0-9]*)$/m.exec(buffer), data = /^data: (.+)$/m.exec(buffer);
            if (buffer.includes('\n\n') && id && data && /^event: turn$/m.test(buffer)) {
              const event = JSON.parse(data[1]); if (event.sequence !== Number(id[1])) throw new Error('invalid-cursor');
              return { cursor: event.sequence, firstEvent: event, pageReadBytes: received, readerDone: false, callerAborted: controller.signal.aborted };
            }
          }
        }, { token, url: eventsUrl, limit: LIMITS.responseBytes }), LIMITS.requestMs);
        meter.receive(observation.pageReadBytes); Object.assign(row, { httpStatus: 200, responseBytes: observation.pageReadBytes, path: new URL(eventsUrl).pathname });
        assert.equal(observation.cursor, 1); assert.equal(observation.callerAborted, false);
        return observation;
      },
      async assertOpen() {
        const result = await bounded(page.evaluate(() => ({ remoteClosed: window.__m0RecoveryObservation?.remoteClosed, callerAborted: window.__m0RecoveryObservation?.controller.signal.aborted })), LIMITS.requestMs);
        assert.deepEqual(result, { remoteClosed: false, callerAborted: false });
      },
    };
  } catch (error) { try { await close(); } catch {} throw error; }
}

export async function runRecoveryCloud(deploymentFile) {
  const sourceBefore = recoverySources(), deployment = readDeployment(deploymentFile, sourceBefore);
  const token = readProbeSecret(root, SECRET), expectedScript = hash(recoveryRuntimeScript());
  const began = Date.now(), globalDeadline = began + LIMITS.totalMs;
  const stamp = `${began}-${randomBytes(3).toString('hex')}`;
  const directory = resolve(root, 'docs/evidence/runs', `m0-recovery-cloud-${stamp}`);
  mkdirSync(directory, { mode: 0o700 });
  const journal = resolve(directory, 'actions.ndjson'); writeFileSync(journal, '', { flag: 'wx', mode: 0o600 });
  let requests = 0, receivedBytes = 0;
  const runtimeIds = new Set(), results = [];
  const safe = value => {
    const text = JSON.stringify(value);
    if (text.includes(token) || text.includes(JSON.stringify(token).slice(1, -1))) throw new Error('credential-in-evidence-refused');
    return text;
  };
  const record = row => appendFileSync(journal, safe(row) + '\n');
  for (const scenario of SCENARIOS) {
    const scenarioStarted = Date.now(), businessDeadline = Math.min(globalDeadline, scenarioStarted + LIMITS.businessMs);
    const runId = `rc-${stamp}-${scenario}`;
    let cleanupDeadline = null, sceneRequests = 0, cleanRequests = 0, owned = false, browserObserver;
    const artifact = { schemaVersion: 1, runId, scenario, startedAt: new Date(scenarioStarted).toISOString(),
      environment: 'cloudflare-vm-pi-local-sse-fixture', provider: 'local-SSE-fixture', realProviderCalls: 0,
      passed: false, gate_decision: 'needs-review', cloudGatePassed: false, browserDisconnectVerified: false,
      actions: [], cleanupConfirmed: false, unknownMutations: [], deploymentVersion: deployment.versionId,
      limits: ['Synthetic local provider IDs and usage are not supplier or billing evidence.',
        'SSE cancellation is observation-only; a browser close is checked separately.',
        'Cleanup destroys owned runtime generations; R2 checkpoints and DO audit records are retained.'] };
    const finish = row => { record({ event: 'request-finished', ...row }); artifact.actions.push(row); };
    const meter = {
      start(action, method, transport = 'node') {
        const end = cleanupDeadline ?? businessDeadline;
        if (Date.now() >= end || ++requests > LIMITS.totalRequests || ++sceneRequests > LIMITS.scenarioRequests
          || cleanupDeadline && ++cleanRequests > LIMITS.cleanupRequests) throw new Error('recovery-request-budget-exhausted');
        const row = { ordinal: requests, action, method, transport, runId, phase: cleanupDeadline ? 'cleanup' : 'business',
          startedAt: new Date().toISOString(), responseBytes: 0, replayAllowed: method === 'GET' };
        record({ event: 'request-started', ...row }); return row;
      },
      receive(bytes) { receivedBytes += bytes; if (receivedBytes > LIMITS.totalBytes) throw new Error('recovery-total-byte-limit'); },
      finish,
    };
    async function request(action, cursor) {
      const method = ['report', 'events'].includes(action) ? 'GET' : 'POST';
      const row = meter.start(action, method), end = cleanupDeadline ?? businessDeadline;
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(LIMITS.requestMs, end - Date.now())));
      let reader;
      try {
        const headers = { authorization: `Bearer ${token}` }; if (cursor !== undefined) headers['last-event-id'] = String(cursor);
        const url = `${ORIGIN}/probe/${runId}/${action}`;
        const pending = fetch(url, { method, headers, redirect: 'manual', signal: controller.signal });
        void pending.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
        const response = await untilAbort(pending, controller.signal); row.httpStatus = response.status;
        if (response.url !== url || response.redirected || response.status >= 300 && response.status < 400 || !response.body) throw new Error('invalid-response-route');
        assert.match(response.headers.get('content-type') ?? '', action === 'events' ? /^text\/event-stream/ : /^application\/json/);
        reader = response.body.getReader(); const chunks = []; const decoder = action === 'events' ? new EventDecoder(cursor ?? 0) : null;
        for (let reads = 0; ; reads++) {
          if (reads > 2048) throw new Error('response-read-limit');
          const part = await untilAbort(reader.read(), controller.signal);
          if (part.done) { decoder?.push(new Uint8Array(), true); break; }
          row.responseBytes += part.value.byteLength; meter.receive(part.value.byteLength);
          if (row.responseBytes > LIMITS.responseBytes) throw new Error('response-byte-limit');
          chunks.push(part.value); decoder?.push(part.value);
          if (action === 'events' && cursor === undefined && decoder.events.length) {
            row.disconnectedWhileStreamOpen = true; break;
          }
        }
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); safe(raw);
        row.bodySha256 = hash(raw); row.body = decoder ? { events: decoder.events, cursor: decoder.cursor } : JSON.parse(raw); safe(row.body);
        row.outcome = method === 'POST' && response.status >= 500 ? 'unknown-do-not-replay' : 'response-observed';
      } catch {
        row.outcome = method === 'POST' ? 'unknown-do-not-replay' : 'read-failed';
        row.error = controller.signal.aborted ? 'request-deadline' : 'request-or-response-failed'; delete row.body;
      } finally {
        clearTimeout(timer); controller.abort();
        if (reader) { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
        row.finishedAt = new Date().toISOString(); finish(row);
      }
      if (row.outcome === 'unknown-do-not-replay') artifact.unknownMutations.push({ action, ordinal: row.ordinal });
      return row;
    }
    function validateReport(row) {
      assert.ok([200, 202, 404].includes(row.httpStatus));
      const body = row.body;
      assert.equal(body?.schema_version, 1); assert.equal(body.operation, 'G0-T08-recovery');
      assert.equal(body.protocol, 'm0-v1'); assert.equal(body.execution_environment, 'cloudflare-vm');
      assert.equal(body.script_sha256, expectedScript); assertOrdered(body.events);
      if (body.state) {
        assert.ok(Number.isSafeInteger(body.state.generation) && [1, 2, 3].includes(body.state.generation));
        assert.match(body.runtime_sandbox_id, /^m0-recovery-[a-f0-9]{32}-g[12]$/);
        runtimeIds.add(body.runtime_sandbox_id); assert.ok(runtimeIds.size <= LIMITS.runtimeLifecycles);
      }
      return body;
    }
    async function report() {
      for (let attempt = 0; attempt < LIMITS.reportRetries; attempt++) {
        const row = await request('report');
        if (row.body && [200, 202, 404].includes(row.httpStatus)) { validateReport(row); return row; }
        if (row.httpStatus && ![408, 429, 500, 502, 503, 504].includes(row.httpStatus)) throw new Error('report-http-rejected');
        if (attempt + 1 < LIMITS.reportRetries) await sleep(250 * (attempt + 1));
      }
      throw new Error('report-unavailable-after-bounded-retries');
    }
    async function poll(predicate, maxMs = 195000) {
      const end = Math.min(cleanupDeadline ?? businessDeadline, Date.now() + maxMs);
      while (Date.now() < end) {
        const row = await report(); if (predicate(row)) return row;
        if (row.body.state?.cleanup === 'cleanup_not_confirmed') throw new Error('runtime-cleanup-not-confirmed');
        await sleep(Math.max(1, Math.min(LIMITS.pollMs, end - Date.now())));
      }
      throw new Error('durable-state-observation-deadline');
    }
    async function mutate(action, validateAck, reconcile) {
      const row = await request(action);
      if (row.outcome !== 'unknown-do-not-replay') { assert.equal(row.httpStatus, 202); validateAck(row.body); }
      const durable = await poll(reconcile, 195000);
      return { request: row, durable, reconciledUnknown: row.outcome === 'unknown-do-not-replay' };
    }
    const settled = row => row.httpStatus === 200 && TERMINAL.includes(row.body.state?.phase) && row.body.state.cleanup === 'destroy_acknowledged';
    async function lateEvent(reference, name) {
      const row = await request('late-event'); assert.equal(row.httpStatus, 409);
      assert.equal(row.body?.suppliedGeneration, 1); assert.equal(row.body.currentGeneration, 2);
      assert.equal(row.body.accepted, false); assert.equal(row.body.stateUnchanged, true); assert.equal(row.body.eventCountUnchanged, true);
      assert.equal(row.body.phaseWasCurrent, true); assert.equal(row.body.attemptedPhase, reference.body.state.phase);
      assert.equal(row.body.writeAccepted, false); assert.equal(row.body.writeRejection, 'stale-generation');
      assert.equal(row.body.currentUnchanged, true); assert.equal(row.body.receiptEventsUnchanged, true);
      const after = await report();
      for (const key of ['state', 'events', 'current', 'seed_sha256', 'final_sha256', 'runtime_status']) assert.deepEqual(after.body[key], reference.body[key]);
      artifact[name] = { request: row, independentReadback: after };
    }
    try {
      if (scenario === 'disconnect') browserObserver = await prepareBrowser(runId, token, meter);
      owned = true;
      const acceptAction = scenario === 'disconnect' ? 'accept' : 'accept-' + scenario;
      artifact.accepted = await mutate(acceptAction, body => { assert.equal(body.accepted, true); assert.equal(body.executionOwner, 'durable-alarm'); },
        row => row.body.state?.mode === 'initial' && row.body.state.runtimeGeneration === 1
          && row.body.events?.[0]?.phase === 'queued' && row.body.events[0].generation === 1
          && (scenario === 'disconnect' ? row.body.fault_plan === null : row.body.fault_plan?.kind === scenario));
      let cursor;
      if (scenario === 'disconnect') {
        artifact.browserObservation = await browserObserver.connect(); cursor = artifact.browserObservation.cursor;
        artifact.beforeBrowserClose = await report(); assert.ok(ACTIVE.includes(artifact.beforeBrowserClose.body.state?.phase));
        await browserObserver.assertOpen(); artifact.browserClose = await browserObserver.close(); browserObserver.validate();
        artifact.afterBrowserClose = await report();
        assert.equal(artifact.afterBrowserClose.body.state.generation, 1);
      } else {
        cursor = artifact.accepted.durable.body.events[0].sequence; assert.equal(cursor, 1);
        artifact.injectionTrigger = 'durable-prearmed';
        artifact.interrupted = await poll(row => {
          if (row.body.state?.phase === 'completed') throw new Error('prearmed-fault-missed-stream-window');
          return settled(row);
        });
        const plan = artifact.interrupted.body.fault_plan;
        assert.equal(plan?.kind, scenario); assert.equal(plan.trigger, 'durable-prearmed');
        assert.equal(plan.status, 'triggered'); assert.equal(plan.runtimeGeneration, 1);
        assert.ok(Number.isFinite(plan.triggeredAt) && plan.triggeredAt >= plan.armedAt);
        artifact.fault = { trigger: 'durable-prearmed', plan };
        const interrupted = artifact.interrupted.body;
        assert.equal(interrupted.state.phase, 'interrupted'); assert.equal(interrupted.state.final, null);
        assert.deepEqual(interrupted.current, interrupted.state.seed); assert.equal(interrupted.current.sequence, 1);
        const fault = interrupted.fault_receipt;
        assert.equal(fault?.kind, scenario); assert.equal(fault.windowHit, true); assert.equal(fault.before?.finalAbsent, true);
        assert.equal(fault.before.processStatus, 'running'); assert.equal(fault.before.runtimeStage, 'streaming');
        assert.ok(Number.isFinite(fault.before.streamStartedAt) && fault.before.observedAt >= fault.before.streamStartedAt
          && fault.confirmedAt < fault.before.streamStartedAt + 11500);
        assert.equal(fault.cleanup, 'destroy_acknowledged');
        if (scenario === 'process') { assert.equal(fault.killed, true); assert.equal(fault.signal, 'SIGKILL'); }
        await lateEvent(artifact.interrupted, 'staleBeforeRecovery');
        artifact.recoveryAccepted = await mutate('recover', body => { assert.equal(body.recoveryAccepted, true); assert.equal(body.replayInterruptedRequest, false); },
          row => row.body.state?.generation === 2 && row.body.state.runtimeGeneration === 2 && row.body.state.mode === 'recovery');
      }
      artifact.final = await poll(settled);
      const final = artifact.final.body;
      assert.equal(final.state.phase, 'completed'); assert.deepEqual(final.current, final.state.final); assert.equal(final.current.sequence, 2);
      assert.match(final.seed_sha256, /^[a-f0-9]{64}$/); assert.match(final.final_sha256, /^[a-f0-9]{64}$/);
      assert.notEqual(final.seed_sha256, final.final_sha256);
      assert.equal(final.runtime_status.stage, 'completed'); assert.equal(final.runtime_status.requestCount, scenario === 'disconnect' ? 2 : 1);
      assert.equal(final.events.filter(event => event.kind === 'phase' && event.phase === 'completed').length, 1);
      if (scenario !== 'disconnect') {
        assert.equal(final.runtime_status.contextRestored, true); assert.equal(final.runtime_status.contextSeenOnRecovery, true);
        assert.equal(final.seed_sha256, artifact.interrupted.body.seed_sha256); assert.deepEqual(final.state.seed, artifact.interrupted.body.state.seed);
        assert.notEqual(final.runtime_sandbox_id, artifact.interrupted.body.runtime_sandbox_id);
        await lateEvent(artifact.final, 'staleAfterRecovery');
      } else {
        assert.ok(Date.parse(final.events.find(event => event.kind === 'phase' && event.phase === 'completed').at) > Date.parse(artifact.browserClose.completedAt));
        artifact.browserDisconnectVerified = true;
      }
      const replay = await request('events', cursor); assert.equal(replay.httpStatus, 200);
      assert.deepEqual(replay.body?.events, final.events.filter(event => event.sequence > cursor));
      artifact.reconnect = { afterSequence: cursor, replayedSequences: replay.body.events.map(event => event.sequence), exactReplay: true };
      const unchanged = await report(); assert.deepEqual(unchanged.body.events, final.events); assert.deepEqual(unchanged.body.current, final.current);
      artifact.passed = true;
    } catch (error) {
      artifact.error = { code: 'recovery-scenario-failed', assertion: error?.code === 'ERR_ASSERTION', lastAction: artifact.actions.at(-1)?.action ?? null };
      try { artifact.failureReport = await report(); } catch { artifact.failureReport = { error: 'bounded-report-unavailable' }; }
    } finally {
      artifact.businessElapsedMs = Date.now() - scenarioStarted;
      cleanupDeadline = Math.min(globalDeadline, Date.now() + LIMITS.cleanupMs);
      if (browserObserver) {
        try { artifact.browserCleanup = await browserObserver.close(); browserObserver.validate(); }
        catch { artifact.browserCleanup = { confirmed: false }; artifact.passed = false; }
      }
      if (owned) {
        try {
          artifact.cleanup = await request('cleanup');
          if (artifact.cleanup.outcome !== 'unknown-do-not-replay') assert.ok([200, 202].includes(artifact.cleanup.httpStatus));
          artifact.cleanupFinal = await poll(row => settled(row) || row.httpStatus === 404 && row.body.state === null, LIMITS.cleanupMs);
          artifact.cleanupConfirmed = settled(artifact.cleanupFinal) || artifact.cleanupFinal.httpStatus === 404
            && artifact.cleanup.body?.cleanup === 'no-runtime-created';
        } catch { artifact.cleanupConfirmed = false; }
      } else artifact.cleanupConfirmed = true; // No accept was dispatched, so no VM was allocated by this driver.
      if (!artifact.cleanupConfirmed) artifact.passed = false;
      artifact.finishedAt = new Date().toISOString(); artifact.requests = sceneRequests; artifact.cleanupRequests = cleanRequests;
      artifact.actions.sort((left, right) => left.ordinal - right.ordinal);
      writeFileSync(resolve(directory, `${scenario}.json`), safe(artifact) + '\n', { flag: 'wx', mode: 0o600 });
    }
    results.push({ scenario, runId, passed: artifact.passed, cleanupConfirmed: artifact.cleanupConfirmed,
      browserDisconnectVerified: artifact.browserDisconnectVerified, artifact: `${scenario}.json` });
    console.log(JSON.stringify(results.at(-1)));
    if (!artifact.passed || !artifact.cleanupConfirmed) break;
  }
  const sourceAfter = recoverySources();
  const summary = { schemaVersion: 1, startedAt: new Date(began).toISOString(), finishedAt: new Date().toISOString(),
    environment: 'cloudflare-vm-pi-local-sse-fixture', deployment, sourceBefore, sourceAfter,
    sourceStableDuringProbe: sourceBefore.sha256 === sourceAfter.sha256, results, requests, receivedBytes,
    observedRuntimeIds: [...runtimeIds], maxConcurrentBusinessInstances: 1, limits: LIMITS,
    realProviderCalls: 0, billingAmount: null, cloudGatePassed: false, gate_decision: 'needs-review',
    passed: results.length === 3 && results.every(result => result.passed) && sourceBefore.sha256 === sourceAfter.sha256 };
  writeFileSync(resolve(directory, 'summary.json'), safe(summary) + '\n', { flag: 'wx', mode: 0o600 });
  return { directory, passed: summary.passed, results, requests, cloudGatePassed: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await runRecoveryCloud(parseArguments(process.argv.slice(2))); console.log(JSON.stringify(result)); if (!result.passed) process.exitCode = 1; }
  catch { console.error('recovery-cloud failed; no credentials or raw errors emitted'); process.exitCode = 1; }
}
