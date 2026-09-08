import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, safePath, sourceSnapshot } from './source-inventory.mjs';
import { readProbeSecret } from './storage-cloud.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const ORIGIN = 'https://riffology-m0-tenancy-staging.jihe-gao.workers.dev';
export const LIMITS = Object.freeze({ requests: 100, businessMs: 90000, requestMs: 15000,
  responseBytes: 16384, totalBytes: 1048576, concurrency: 2, readRetries: 3, cleanupMs: 30000, cleanupMutations: 2 });
const secretPath = '.local/cloud-staging/tenancy.secrets.json';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const scopes = ['workspace', 'artifact'].flatMap(kind => ['alpha', 'bravo'].map(tenant => ({ tenant, kind,
  object_id: `fixture-${tenant}-${kind}`, label: `${tenant}-${kind}` })));
const resourcePath = (run, scope) => `/resource/${run}/${scope.tenant}/${scope.kind}/${scope.object_id}`;
const content = (run, scope, revision) => `m0-tenancy synthetic ${run} ${scope.tenant} ${scope.kind} revision-${revision}\n`;

export function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--deployment' || !argv[1] || argv[1].startsWith('--')) throw new Error('one-deployment-file-required');
  return argv[1];
}

export function tenancySources(repository = root) {
  const snapshot = sourceSnapshot(repository);
  const selected = new Set(['spikes/m0-tenancy/index.ts', 'spikes/m0-tenancy/worker.ts', 'spikes/m0-tenancy/auth.ts',
    'spikes/m0-tenancy/core.ts', 'spikes/m0-tenancy/env.d.ts', 'infra/wrangler.m0-tenancy.jsonc',
    'scripts/m0/tenancy-cloud.mjs', 'scripts/m0/storage-cloud.mjs', 'scripts/m0/source-inventory.mjs',
    'package.json', 'package-lock.json', 'tsconfig.json']);
  const files = snapshot.files.filter(file => selected.has(file.path));
  assert.equal(files.length, selected.size, 'tenancy-source-inventory-incomplete');
  return { sha256: hash(JSON.stringify(files)), files, repositorySourceSha256: snapshot.sha256 };
}

export function validateDeployment(value, snapshot = tenancySources(), now = Date.now()) {
  if (!value || value.verified !== true || value.mode !== 'fixture-only' || value.origin !== ORIGIN
    || value.accountId !== '8b0d70250211aa10d89e20605a1c7e5e' || value.scriptName !== 'riffology-m0-tenancy-staging'
    || !uuid.test(value.versionId ?? '') || !/^[a-f0-9]{64}$/.test(value.bundleSha256 ?? '')
    || !Number.isSafeInteger(value.verifiedAtMs) || value.verifiedAtMs > now || now - value.verifiedAtMs > 900000
    || value.sourceSha256 !== snapshot.sha256 || JSON.stringify(value.sourceFiles) !== JSON.stringify(snapshot.files)) {
    throw new Error('fresh-verified-tenancy-deployment-and-source-required');
  }
  return { verified: true, mode: value.mode, origin: value.origin, accountId: value.accountId, scriptName: value.scriptName,
    versionId: value.versionId, bundleSha256: value.bundleSha256, verifiedAtMs: value.verifiedAtMs,
    sourceSha256: value.sourceSha256, sourceFiles: value.sourceFiles };
}

export function readDeployment(input, snapshot = tenancySources()) {
  const path = safePath(root, resolve(root, input), 'deployment evidence');
  if (basename(path) !== 'deployment-verified.json' || !relative(root, path).startsWith(`docs${sep}evidence${sep}runs${sep}`)
    || lstatSync(path).size > 262144) throw new Error('bounded-deployment-evidence-file-required');
  const raw = readFileSync(path, 'utf8');
  return { ...validateDeployment(JSON.parse(raw), snapshot), evidenceFile: relative(root, path), evidenceSha256: hash(raw) };
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

function capabilityScope(token, runId, expected, expired = false) {
  assert.equal(typeof token, 'string'); assert.ok(token.length >= 32 && token.length <= 2048);
  const parts = token.split('.'); assert.equal(parts.length, 2);
  assert.match(parts[0], /^[A-Za-z0-9_-]+$/); assert.match(parts[1], /^[A-Za-z0-9_-]+$/);
  const bytes = Buffer.from(parts[0], 'base64url'); assert.equal(bytes.toString('base64url'), parts[0]);
  assert.equal(Buffer.from(parts[1], 'base64url').toString('base64url'), parts[1]);
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const { expires_at: expiresAt, ...binding } = value;
  assert.deepEqual(binding, { version: 1, audience: 'm0-tenancy', run_id: runId, tenant: expected.tenant,
    kind: expected.kind, object_id: expected.object_id, service_path: resourcePath(runId, expected) });
  const now = Math.floor(Date.now() / 1000);
  assert.ok(Number.isSafeInteger(expiresAt));
  assert.ok(expired ? expiresAt <= now && expiresAt >= now - 60 : expiresAt > now + 90 && expiresAt <= now + 300);
  // Decoding is an evidence consistency check. Positive server calls verify authorization.
  return { ...value, capabilitySha256: hash(token), signatureVerifiedByDriver: false };
}

export async function runTenancyCloud(deploymentFile) {
  const before = tenancySources(); const deployment = readDeployment(deploymentFile, before);
  const token = readProbeSecret(root, secretPath);
  const started = Date.now(), deadline = started + LIMITS.businessMs;
  const stamp = `${started}-${randomBytes(4).toString('hex')}`, runId = `tc-${stamp}`;
  const directory = resolve(root, 'docs/evidence/runs', `m0-tenancy-cloud-${stamp}`);
  mkdirSync(directory, { mode: 0o700 });
  const journal = resolve(directory, 'actions.ndjson');
  writeFileSync(journal, '', { flag: 'wx', mode: 0o600 });
  const secrets = new Set([token]); const capabilities = new Map();
  let expiredCapability, attemptedBootstrap = false, requestCount = 0, responseBytes = 0, active = 0, maxActive = 0;
  let cleanupDeadline = null, cleanupMutations = 0, businessRequests = 0, cleanupRequests = 0, readRetriesUsed = 0;
  const evidence = { schemaVersion: 1, operation: 'G0-T04-tenancy-cloud-primitive', runId, origin: ORIGIN,
    environment: 'staging-cloud-r2-sqlite-synthetic-resources', startedAt: new Date(started).toISOString(),
    deployment, sourceBefore: before, limits: LIMITS, actions: [], cases: [], passed: false,
    cloudGatePassed: false, gate_decision: 'needs-review', vmCalls: 0, realProviderCalls: 0, modelCalls: 0,
    bootstrap: null, cleanup: { attempted: false, confirmed: false },
    limitsOfEvidence: ['Synthetic deterministic content; no product Session or real model.',
      'Deployment identity is independently operator verified; this driver does not call the account API.',
      'Owner readback follows each complete negative-test group to retain the 100-request bound.'] };
  const safe = value => {
    const encoded = JSON.stringify(value);
    for (const secret of secrets) {
      if (encoded.includes(secret) || encoded.includes(JSON.stringify(secret).slice(1, -1))) throw new Error('credential-in-evidence-refused');
    }
    return encoded;
  };
  const record = value => { appendFileSync(journal, safe(value) + '\n'); };
  const check = (name, operation) => { operation(); evidence.cases.push({ name, passed: true }); };
  async function batches(tasks) {
    for (let start = 0; start < tasks.length; start += LIMITS.concurrency) {
      const results = await Promise.allSettled(tasks.slice(start, start + LIMITS.concurrency).map(task => task()));
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    }
  }
  async function attempt(action, path, method, { capability, operator = false, cleanup = false, bootstrap = false } = {}) {
    const end = cleanup ? cleanupDeadline : deadline;
    if (!end || Date.now() >= end || requestCount >= LIMITS.requests || active >= LIMITS.concurrency) throw new Error('request-budget-exhausted');
    if (cleanup && path.startsWith('/cleanup/') && ++cleanupMutations > LIMITS.cleanupMutations) throw new Error('cleanup-budget-exhausted');
    assert.ok(path.startsWith('/') && !path.startsWith('//') && !path.includes('?') && !path.includes('#'));
    const url = new URL(path, ORIGIN); assert.equal(url.origin, ORIGIN);
    const row = { ordinal: ++requestCount, action, path, method, phase: cleanup ? 'cleanup' : 'business',
      authorization: operator ? 'operator' : capability ? 'resource-capability' : 'none',
      capabilitySha256: capability ? hash(capability) : null, mutationReplayAllowed: false,
      startedAt: new Date().toISOString() };
    if (cleanup) cleanupRequests++; else businessRequests++;
    record({ event: 'request-started', ...row });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(LIMITS.requestMs, end - Date.now())));
    let reader; active++; maxActive = Math.max(maxActive, active);
    try {
      const headers = { accept: 'application/json' };
      if (operator) headers.authorization = `Bearer ${token}`;
      if (capability) headers['x-m0-capability'] = capability;
      const body = method === 'POST' ? path.startsWith('/resource/') ? '{"action":"write"}' : '{}' : undefined;
      if (body !== undefined) { headers['content-type'] = 'application/json'; headers['content-length'] = String(Buffer.byteLength(body)); }
      const pending = fetch(url, { method, headers, body, redirect: 'manual', signal: controller.signal });
      void pending.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
      const response = await untilAbort(pending, controller.signal);
      row.httpStatus = response.status;
      if (response.url !== url.href || response.redirected || response.status >= 300 && response.status < 400
        || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new Error('response-protocol-denied');
      reader = response.body.getReader(); const chunks = []; let bytes = 0;
      for (let reads = 0; ; reads++) {
        if (reads > 1024) throw new Error('response-read-limit');
        const part = await untilAbort(reader.read(), controller.signal); if (part.done) break;
        bytes += part.value.byteLength; responseBytes += part.value.byteLength;
        if (bytes > LIMITS.responseBytes || responseBytes > LIMITS.totalBytes) throw new Error('response-byte-limit');
        chunks.push(part.value);
      }
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      const parsed = JSON.parse(raw);
      // Bootstrap is never persisted verbatim. Capture all returned credential values
      // before projecting the body, including malformed credentials on failure paths.
      if (bootstrap) {
        if (parsed?.capabilities && typeof parsed.capabilities === 'object') {
          for (const value of Object.values(parsed.capabilities)) if (typeof value === 'string' && value) secrets.add(value);
        }
        if (typeof parsed?.expired_capability === 'string' && parsed.expired_capability) secrets.add(parsed.expired_capability);
      } else for (const secret of secrets) if (raw.includes(secret)) throw new Error('credential-in-response-refused');
      if (raw.includes(token)) throw new Error('operator-secret-in-response-refused');
      row.body = bootstrap ? { run_id: parsed?.run_id, resources: parsed?.resources, error: parsed?.error } : parsed;
      safe(row.body); row.bodySha256 = hash(raw); row.responseBytes = bytes;
      row.finishedAt = new Date().toISOString();
      row.outcome = method === 'POST' && response.status >= 500 ? 'unknown-do-not-replay' : 'response-observed';
      record({ event: 'request-finished', ...row }); evidence.actions.push(row);
      return { row, body: parsed };
    } catch (error) {
      row.finishedAt = new Date().toISOString(); row.outcome = method === 'POST' ? 'unknown-do-not-replay' : 'read-failed';
      row.error = controller.signal.aborted ? 'request-deadline' : 'request-or-response-failed';
      delete row.body; record({ event: 'request-finished', ...row }); evidence.actions.push(row);
      const failure = new Error('request-failed-see-action-journal');
      // Only GET transport failures before response headers can be retried.
      // Protocol mismatches and every POST keep their original failure outcome.
      failure.readRetryAllowed = method === 'GET' && row.httpStatus === undefined
        && (controller.signal.aborted || error?.name === 'TypeError' && error?.message === 'fetch failed');
      throw failure;
    } finally {
      clearTimeout(timer); controller.abort(); active--;
      if (reader) { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
    }
  }
  async function once(action, path, method, options = {}) {
    for (;;) {
      try { return await attempt(action, path, method, options); }
      catch (error) {
        const end = options.cleanup ? cleanupDeadline : deadline;
        if (!error.readRetryAllowed || readRetriesUsed >= LIMITS.readRetries || Date.now() + 250 >= end) throw error;
        readRetriesUsed++;
        record({ event: 'bounded-read-retry', action, path, method, retryNumber: readRetriesUsed });
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }
  function verifyResource(body, scope, revision, operation) {
    const bytes = content(runId, scope, revision);
    assert.deepEqual(body, { run_id: runId, tenant: scope.tenant, kind: scope.kind, object_id: scope.object_id,
      operation, revision, digest: hash(bytes), content_bytes: Buffer.byteLength(bytes) });
  }
  async function ownRead(scope, revision, label) {
    const result = await once(label, resourcePath(runId, scope), 'GET', { capability: capabilities.get(scope.label) });
    assert.equal(result.row.httpStatus, 200); verifyResource(result.body, scope, revision, 'read');
  }
  async function denied(action, scope, path, method, status, error, options = {}) {
    const result = await once(action, path, method, { capability: capabilities.get(scope.label), ...options });
    assert.equal(result.row.httpStatus, status); assert.deepEqual(result.body, { error });
    evidence.cases.push({ name: action, method, owner: scope.label, expectedStatus: status, reason: error, passed: true });
  }
  function verifyCleanup(result) {
    assert.equal(result.row.httpStatus, 200);
    assert.deepEqual(result.body, { run_id: runId, deleted_keys: scopes.slice().sort((a, b) => a.tenant.localeCompare(b.tenant) || (a.kind === 'workspace' ? -1 : 1)).map(scope => `m0-tenancy/${runId}/${scope.tenant}/${scope.kind}/${scope.object_id}`),
      r2_remaining: 0, cleanup: 'r2-prefix-and-sqlite-state-deleted' });
  }
  try {
    attemptedBootstrap = true; // Own this run before the first potentially ambiguous mutation.
    const initialized = await once('bootstrap', `/bootstrap/${runId}`, 'POST', { operator: true, bootstrap: true });
    assert.equal(initialized.row.httpStatus, 200); assert.equal(initialized.body.run_id, runId);
    assert.deepEqual(Object.keys(initialized.body).sort(), ['capabilities', 'expired_capability', 'resources', 'run_id']);
    assert.deepEqual(Object.keys(initialized.body.capabilities).sort(), scopes.map(scope => scope.label).sort());
    const summaries = scopes.map(scope => {
      const capability = initialized.body.capabilities[scope.label];
      const summary = capabilityScope(capability, runId, scope); capabilities.set(scope.label, capability); return summary;
    });
    expiredCapability = initialized.body.expired_capability;
    const expiredScope = scopes.find(scope => scope.label === 'alpha-artifact');
    const expiredSummary = capabilityScope(expiredCapability, runId, expiredScope, true);
    assert.deepEqual(initialized.body.resources.slice().sort((a, b) => `${a.tenant}-${a.kind}`.localeCompare(`${b.tenant}-${b.kind}`)),
      scopes.map(scope => ({ tenant: scope.tenant, kind: scope.kind, object_id: scope.object_id, revision: 1,
        digest: hash(content(runId, scope, 1)) })).sort((a, b) => `${a.tenant}-${a.kind}`.localeCompare(`${b.tenant}-${b.kind}`)));
    evidence.bootstrap = { resources: initialized.body.resources, capabilities: summaries, expiredCapability: expiredSummary };
    await batches(scopes.map(scope => () => ownRead(scope, 1, 'initial-owner-read')));
    for (const revision of [2, 3]) {
      await batches(scopes.map(scope => async () => {
        const result = await once(`concurrent-write-revision-${revision}`, resourcePath(runId, scope), 'POST', { capability: capabilities.get(scope.label) });
        assert.equal(result.row.httpStatus, 200); verifyResource(result.body, scope, revision, 'write');
      }));
      await batches(scopes.map(scope => () => ownRead(scope, revision, `owner-read-revision-${revision}`)));
      evidence.cases.push({ name: `four-resources-concurrent-round-${revision - 1}`, passed: true, revision });
    }
    const ownership = [];
    for (const scope of scopes) {
      const otherTenant = scope.tenant === 'alpha' ? 'bravo' : 'alpha';
      const otherKind = scope.kind === 'workspace' ? 'artifact' : 'workspace';
      const variants = [
        ['tenant-swap', resourcePath(runId, { tenant: otherTenant, kind: scope.kind, object_id: `fixture-${otherTenant}-${scope.kind}` }), 403, 'scope-denied'],
        ['run-swap', resourcePath(`${runId}-other`, scope), 403, 'scope-denied'],
        ['kind-swap', resourcePath(runId, { tenant: scope.tenant, kind: otherKind, object_id: `fixture-${scope.tenant}-${otherKind}` }), 403, 'scope-denied'],
        ['object-id-swap', resourcePath(runId, { ...scope, object_id: `fixture-${otherTenant}-${scope.kind}` }), 401, 'unauthorized'],
        ['service-path-swap', resourcePath(runId, { tenant: otherTenant, kind: otherKind, object_id: `fixture-${otherTenant}-${otherKind}` }), 403, 'scope-denied'],
      ];
      for (const [name, path, status, error] of variants) for (const method of ['GET', 'POST']) {
        ownership.push(() => denied(`${name}-${scope.label}`, scope, path, method, status, error));
      }
    }
    for (const scope of scopes.filter(scope => scope.kind === 'artifact')) {
      const other = scopes.find(candidate => candidate.kind === 'artifact' && candidate.tenant !== scope.tenant);
      for (const method of ['GET', 'POST']) ownership.push(() => denied(`artifact-exchange-${scope.tenant}`, scope, resourcePath(runId, other), method, 403, 'scope-denied'));
    }
    await batches(ownership);
    await batches(scopes.map(scope => () => ownRead(scope, 3, 'owner-read-after-ownership-attacks')));
    evidence.cases.push({ name: 'ownership-rejections-have-no-revision-or-digest-effect', passed: true });
    const credentials = [];
    for (const scope of scopes) for (const method of ['GET', 'POST']) credentials.push(() => denied(`appended-signature-${scope.label}`, scope,
      resourcePath(runId, scope), method, 403, 'scope-denied', { capability: capabilities.get(scope.label) + '.extra' }));
    for (const method of ['GET', 'POST']) {
      credentials.push(() => denied('expired-capability', expiredScope, resourcePath(runId, expiredScope), method, 403, 'scope-denied', { capability: expiredCapability }));
      credentials.push(() => denied('missing-capability', scopes[0], resourcePath(runId, scopes[0]), method, 403, 'scope-denied', { capability: undefined }));
      credentials.push(() => denied('operator-only-is-not-resource-capability', scopes[0], resourcePath(runId, scopes[0]), method, 403, 'scope-denied', { capability: undefined, operator: true }));
    }
    await batches(credentials);
    await batches(scopes.map(scope => () => ownRead(scope, 3, 'owner-read-after-credential-attacks')));
    check('credential-rejections-have-no-revision-or-digest-effect', () => assert.equal(requestCount, 87 + readRetriesUsed));
    evidence.passed = true;
  } catch (error) {
    evidence.error = { code: 'tenancy-probe-failed', assertion: error?.code === 'ERR_ASSERTION', lastAction: evidence.actions.at(-1)?.action ?? null };
  } finally {
    evidence.businessElapsedMs = Date.now() - started;
    cleanupDeadline = Date.now() + LIMITS.cleanupMs;
    if (attemptedBootstrap) {
      evidence.cleanup.attempted = true;
      let first, second, firstConfirmed = false, secondConfirmed = false, closedReads = false;
      try {
        first = await once('cleanup-first', `/cleanup/${runId}`, 'POST', { operator: true, cleanup: true }); verifyCleanup(first); firstConfirmed = true;
        if (capabilities.size === 4) {
          await batches(scopes.flatMap(scope => ['GET', 'POST'].map(method => () => denied(`cleaned-run-${scope.label}`, scope,
            resourcePath(runId, scope), method, 403, 'run-closed', { cleanup: true }))));
          closedReads = true;
        }
      } catch { evidence.passed = false; }
      // Cleanup is explicitly idempotent; this second bounded check is never a
      // bootstrap/write replay. An unknown first result still makes the run fail.
      try {
        second = await once('cleanup-idempotence-check', `/cleanup/${runId}`, 'POST', { operator: true, cleanup: true }); verifyCleanup(second); secondConfirmed = true;
        if (first) assert.deepEqual(second.body, first.body);
      } catch { evidence.passed = false; }
      evidence.cleanup = { attempted: true, confirmed: secondConfirmed, firstConfirmed,
        idempotenceConfirmed: firstConfirmed && secondConfirmed && JSON.stringify(first.body) === JSON.stringify(second.body),
        ownerCapabilitiesRejectedAfterCleanup: closedReads, mutationAttempts: cleanupMutations };
      evidence.passed &&= evidence.cleanup.confirmed && evidence.cleanup.firstConfirmed && evidence.cleanup.idempotenceConfirmed && closedReads;
    }
    try {
      const after = tenancySources(); evidence.sourceAfter = after;
      evidence.sourceStableDuringProbe = after.sha256 === before.sha256;
      evidence.passed &&= evidence.sourceStableDuringProbe;
    } catch { evidence.sourceStableDuringProbe = false; evidence.passed = false; }
    evidence.requests = requestCount; evidence.businessRequests = businessRequests; evidence.cleanupRequests = cleanupRequests;
    evidence.responseBytes = responseBytes; evidence.maxConcurrentRequests = maxActive; evidence.readRetriesUsed = readRetriesUsed;
    evidence.finishedAt = new Date().toISOString(); evidence.elapsedMs = Date.now() - started;
    evidence.actions.sort((a, b) => a.ordinal - b.ordinal);
    writeFileSync(resolve(directory, 'tenancy-cloud.json'), safe(evidence) + '\n', { flag: 'wx', mode: 0o600 });
  }
  return { directory, runId, passed: evidence.passed, requests: requestCount, cleanup: evidence.cleanup, cloudGatePassed: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await runTenancyCloud(parseArguments(process.argv.slice(2))); console.log(JSON.stringify(result)); if (!result.passed) process.exitCode = 1; }
  catch { console.error('tenancy-cloud failed; no credentials or raw errors emitted'); process.exitCode = 1; }
}
