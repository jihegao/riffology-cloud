import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, safePath, sourceSnapshot } from './source-inventory.mjs';

export const LIMITS = Object.freeze({ requests: 60, elapsedMs: 180000, requestMs: 25000, responseBytes: 262144, streamBytes: 65536, totalBytes: 4 * 1024 * 1024, readRetries: 3 });
export const VERIFIED_ORIGIN = 'https://riffology-m0-storage-staging.jihe-gao.workers.dev';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runPattern = /^[a-z0-9][a-z0-9-]{7,47}$/;

export function parseArguments(argv) {
  const allowed = new Set(['origin', 'run-id', 'deployment-version', 'bundle-sha256', 'output', 'secrets-file']); const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    if (!argv[index]?.startsWith('--') || !allowed.has(key) || args[key] !== undefined || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('invalid-or-duplicate-cli-option');
    args[key] = argv[index + 1];
  }
  let url;
  try { url = new URL(args.origin); } catch { throw new Error('staging-origin-required'); }
  if (url.origin !== VERIFIED_ORIGIN || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error('origin-must-be-the-verified-staging-worker');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(args['deployment-version'] ?? '') || !/^[a-f0-9]{64}$/.test(args['bundle-sha256'] ?? '')) throw new Error('observed-deployment-version-and-bundle-digest-required');
  if (args['run-id'] && !runPattern.test(args['run-id'])) throw new Error('invalid-run-id');
  if (!args['secrets-file']) throw new Error('explicit-local-secrets-json-required');
  return { origin: url.origin, runId: args['run-id'], deploymentVersion: args['deployment-version'], bundleSha256: args['bundle-sha256'], output: args.output, secretsFile: args['secrets-file'] };
}

export function readProbeSecret(repository, input) {
  if (typeof input !== 'string') throw new Error('explicit-local-secrets-json-required');
  const path = safePath(repository, resolve(repository, input), 'probe secret');
  if (!relative(repository, path).startsWith(`.local${sep}`)) throw new Error('probe-secret-must-be-under-repository-local');
  const stat = lstatSync(path);
  if ((stat.mode & 0o777) !== 0o600 || typeof process.getuid === 'function' && stat.uid !== process.getuid() || stat.size > 16384) throw new Error('probe-secret-must-be-owned-0600-file');
  let values; const raw = readFileSync(path, 'utf8');
  try { values = JSON.parse(raw); } catch { throw new Error('invalid-secrets-json'); }
  if ([...raw.matchAll(/"M0_PROBE_TOKEN"\s*:/g)].length !== 1) throw new Error('one-local-probe-token-required');
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length !== 1 || !Object.hasOwn(values, 'M0_PROBE_TOKEN')) throw new Error('one-local-probe-token-required');
  const token = values.M0_PROBE_TOKEN;
  if (typeof token !== 'string' || token.length < 32 || token.length > 1024 || /[\r\n\s]/.test(token)) throw new Error('invalid-local-probe-token');
  return token;
}

export function storageSources(repository = root) {
  const snapshot = sourceSnapshot(repository);
  const selected = new Set(['spikes/m0-storage/index.ts', 'spikes/m0-storage/checkpoint.ts', 'spikes/m0-storage/adapters.ts', 'spikes/m0-storage/faults.ts', 'spikes/m0-storage/env.d.ts', 'spikes/m0-cloud/auth.ts', 'scripts/m0/storage-cloud.mjs', 'scripts/m0/source-inventory.mjs', 'tests/m0/storage-faults.test.ts', 'tests/m0/checkpoint.test.ts', 'tests/m0/checkpoint-adapter.test.ts', 'infra/wrangler.m0-storage.jsonc', 'package.json', 'package-lock.json', 'tsconfig.json']);
  const files = snapshot.files.filter(file => selected.has(file.path));
  assert.equal(files.length, selected.size, 'storage scoped source inventory incomplete');
  return { sha256: hash(JSON.stringify(files)), files, repositorySourceSha256: snapshot.sha256 };
}

export async function readLimitedBody(response, maxBytes, receive = () => {}) {
  if (!response.body) throw new Error('missing-response-body');
  const reader = response.body.getReader(); let bytes = 0; const chunks = [];
  try {
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; receive(part.value.byteLength); if (bytes > maxBytes) throw new Error('response-byte-limit'); chunks.push(part.value); }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function applySavedEvents(state, events) {
  for (const event of events) {
    if (!event || !/^[a-f0-9]{64}$/.test(event.revision) || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || event.generation !== 1) throw new Error('invalid-saved-event');
    const old = state.seen.get(event.sequence);
    if (old) { assert.deepEqual(event, old, 'duplicate sequence changed receipt'); state.duplicates++; continue; }
    assert.equal(event.sequence, state.applied.length + 1, 'consumer must apply a contiguous durable sequence');
    state.seen.set(event.sequence, event); state.applied.push(event.sequence);
  }
}

export async function runStorageCloud(options, hooks = {}) {
  if (options.origin !== VERIFIED_ORIGIN) throw new Error('origin-must-be-the-verified-staging-worker');
  const fetcher = hooks.fetch ?? fetch; const token = hooks.token ?? readProbeSecret(root, options.secretsFile);
  const began = Date.now(); let requestCount = 0; let receivedBytes = 0;
  const stamp = new Date().toISOString().replaceAll(/[^0-9]/g, '');
  const runId = options.runId ?? `storage-cloud-${stamp}`;
  assert.match(runId, runPattern);
  const output = options.output ? safePath(root, resolve(options.output), 'cloud evidence', true) : undefined;
  if (output) {
    const evidencePath = relative(resolve(root, 'docs/evidence/runs'), output);
    if (evidencePath.startsWith(`..${sep}`) || !evidencePath.includes(sep)) throw new Error('output-must-be-in-a-docs-evidence-run-directory');
  }
  const directory = output ? dirname(output) : resolve(root, 'docs/evidence/runs', `m0-storage-cloud-${stamp}`);
  if (!output) mkdirSync(directory, { mode: 0o700 });
  const target = output ?? resolve(directory, 'storage-cloud.json');
  const journal = safePath(root, resolve(directory, `${runId}-actions.ndjson`), 'action journal', true);
  writeFileSync(journal, '', { flag: 'wx', mode: 0o600 });
  const before = storageSources(root);
  const artifact = { schemaVersion: 1, runId, environment: 'staging-cloud-r2-do', accountId: '8b0d70250211aa10d89e20605a1c7e5e', startedAt: new Date(began).toISOString(), origin: options.origin, deploymentVersion: options.deploymentVersion, deployedBundleSha256: options.bundleSha256, deploymentProvenance: 'operator-supplied; reviewer must match deployment record', limits: LIMITS, sourceBefore: before, actions: [], checksPassed: false, cloudGatePassed: false, gate_decision: 'needs-review' };
  const sanitize = value => { const text = JSON.stringify(value); if (text.includes(token)) throw new Error('response-contained-probe-secret-output-refused'); return text; };
  function record(item) { const text = sanitize(item); appendFileSync(journal, `${text}\n`); artifact.actions.push(item); }
  function capacity() { if (++requestCount > LIMITS.requests || Date.now() - began >= LIMITS.elapsedMs) throw new Error('request-or-runtime-budget-exhausted'); }
  function receive(length) { receivedBytes += length; if (receivedBytes > LIMITS.totalBytes) throw new Error('total-response-byte-budget-exhausted'); }
  function timeout() { return AbortSignal.timeout(Math.max(1, Math.min(LIMITS.requestMs, LIMITS.elapsedMs - (Date.now() - began)))); }
  async function once(action, method = 'GET') {
    capacity(); const startedAt = new Date().toISOString();
    const row = { ordinal: requestCount, action, method, startedAt };
    try {
      const response = await fetcher(`${options.origin}/probe/${runId}/faults/${action}`, { method, headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: timeout() });
      if (response.status >= 300 && response.status < 400) throw new Error('redirect-refused');
      const raw = await readLimitedBody(response, LIMITS.responseBytes, receive);
      const body = JSON.parse(raw);
      if (raw.includes(token)) throw new Error('response-contained-probe-secret-output-refused');
      Object.assign(row, { httpStatus: response.status, cfRay: response.headers.get('cf-ray'), bodySha256: hash(raw), body, finishedAt: new Date().toISOString() });
      record(row); return row;
    } catch (error) {
      // Fetch/SDK errors may include arbitrary upstream data. Journal only controlled categories.
      const errorKind = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'request-timeout' : 'request-failed';
      Object.assign(row, { error: errorKind, outcome: method === 'POST' ? 'unknown-do-not-replay' : 'read-failed', finishedAt: new Date().toISOString() }); record(row); return row;
    }
  }
  async function status() {
    for (let attempt = 0; attempt < LIMITS.readRetries; attempt++) {
      const row = await once('status');
      if (row.httpStatus === 200) return row.body;
      if (row.httpStatus && ![408, 429, 500, 502, 503, 504].includes(row.httpStatus)) throw new Error(`status-http-${row.httpStatus}`);
      if (attempt + 1 < LIMITS.readRetries) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
    throw new Error('status-unavailable-after-bounded-read-retries');
  }
  async function mutation(action, expected, shouldAbort = false) {
    const result = await once(action, 'POST'); // Exactly one request. Unknown mutations are reconciled, never re-sent.
    let current;
    for (let observation = 0; observation < 5; observation++) {
      current = await status(); if (current.state?.stage === expected) break;
      if (current.state?.stage === 'failed') throw new Error(`${action}-reported-failure`);
      if (observation < 4) await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(current.state?.stage, expected, `${action} did not reach its durable phase; no mutation replayed`);
    if (shouldAbort) assert.ok(result.error || result.httpStatus >= 500, `${action} must interrupt its original request`);
    else assert.ok(result.httpStatus === 200 || result.error || result.httpStatus >= 500, `${action} unexpected HTTP outcome`);
    return current;
  }
  async function observe(cursor) {
    capacity(); const abort = new AbortController(); const row = { ordinal: requestCount, action: 'events', method: 'GET', cursor, startedAt: new Date().toISOString() };
    let reader; let received = ''; let buffer = ''; const events = []; let caughtUp = false; let hadNotEnded = false;
    try {
      const response = await fetcher(`${options.origin}/probe/${runId}/faults/events`, { headers: { authorization: `Bearer ${token}`, 'last-event-id': String(cursor) }, redirect: 'error', signal: AbortSignal.any([abort.signal, timeout()]) });
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
      reader = response.body.getReader(); const decoder = new TextDecoder();
      while (!caughtUp) {
        const part = await reader.read(); if (part.done) throw new Error('stream-ended-before-caught-up');
        receive(part.value.byteLength); hadNotEnded = true;
        const text = decoder.decode(part.value, { stream: true }); received += text; buffer += text;
        if (Buffer.byteLength(received) > LIMITS.streamBytes) throw new Error('event-byte-limit');
        while (buffer.includes('\n\n')) {
          const boundary = buffer.indexOf('\n\n'); const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const kind = /^event: (.+)$/m.exec(frame)?.[1]; const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (!data) throw new Error('missing-event-data');
          const body = JSON.parse(data);
          if (kind === 'saved') { assert.equal(Number(/^id: (\d+)$/m.exec(frame)?.[1]), body.sequence); events.push(body); }
          else if (kind === 'caught-up') { assert.equal(body.highWatermark, events.at(-1)?.sequence ?? cursor); caughtUp = true; }
          else throw new Error('unexpected-event-kind');
        }
      }
      assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => cursor + index + 1));
      await reader.cancel(); abort.abort(); reader.releaseLock(); reader = undefined;
      Object.assign(row, { httpStatus: response.status, events, streamSha256: hash(received), streamHadNotEnded: hadNotEnded, readerCancellationAcknowledged: true, requestAborted: abort.signal.aborted, finishedAt: new Date().toISOString() }); record(row);
      return events;
    } catch (error) {
      abort.abort(); if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      Object.assign(row, { error: 'event-observation-failed', finishedAt: new Date().toISOString() }); record(row); throw new Error('event-observation-failed');
    }
  }
  try {
    const empty = await status(); assert.equal(empty.state, null); assert.equal(empty.current, null); assert.deepEqual(empty.objects, []);
    const initialized = await mutation('init', 'initialized'); assert.equal(initialized.events.length, 1);
    assert.deepEqual(initialized.restored[0].files, [{ path: 'baseline.txt', mode: 0o644, sha256: hash('committed A') }]);
    assert.equal(initialized.restored[0].sessionSha256, hash('fixed trusted synthetic T06 session; no user data'));
    const consumer = { seen: new Map(), applied: [], duplicates: 0 };
    applySavedEvents(consumer, await observe(0)); assert.deepEqual(consumer.applied, [1]);
    artifact.observerDisconnectedBeforeFaults = true;
    const upload = await mutation('upload-interrupt', 'upload-interrupted');
    assert.deepEqual(upload.current, initialized.current); assert.deepEqual(upload.events, initialized.events);
    assert.deepEqual(upload.state.upload, { putInvoked: true, declaredBytes: 262144, consumedBytes: 65536, putRejected: true, objectAbsent: true });
    const precommit = await mutation('precommit-crash', 'precommit-aborted', true);
    assert.notEqual(precommit.instanceNonce, precommit.state.precommit.instanceNonce);
    assert.deepEqual(precommit.current, initialized.current); assert.deepEqual(precommit.events, initialized.events);
    assert.ok(precommit.objects.some(object => object.key.endsWith(`manifests/${precommit.state.precommit.candidate}`)));
    assert.deepEqual(precommit.restored, initialized.restored);
    const postcommit = await mutation('postcommit-crash', 'postcommit-aborted', true);
    assert.notEqual(postcommit.instanceNonce, postcommit.state.postcommit.instanceNonce);
    assert.equal(postcommit.current.sequence, 2); assert.equal(postcommit.current.revision, postcommit.state.postcommit.candidate);
    assert.deepEqual(postcommit.events.map(event => event.sequence), [1, 2]);
    assert.equal(postcommit.events.some(event => event.revision === precommit.state.precommit.candidate), false);
    assert.deepEqual(postcommit.restored.map(row => row.files[0].path), ['baseline.txt', 'committed-after-crash.txt']);
    assert.deepEqual(postcommit.restored[1].files, [{ path: 'committed-after-crash.txt', mode: 0o644, sha256: hash('committed C') }]);
    assert.equal(postcommit.restored[1].sessionSha256, initialized.restored[0].sessionSha256);
    const replay = await observe(1); assert.deepEqual(replay, [postcommit.events[1]]); applySavedEvents(consumer, replay);
    const repeated = await observe(1); assert.deepEqual(repeated, replay); applySavedEvents(consumer, repeated);
    assert.deepEqual(await observe(2), []); assert.deepEqual(consumer.applied, [1, 2]); assert.equal(consumer.duplicates, 1);
    artifact.consumer = { appliedSequences: consumer.applied, duplicateDeliveriesIgnored: consumer.duplicates, transportExactlyOnceClaimed: false };
    // Deliberate duplicate-command test, distinct from an automatic retry of an unknown mutation.
    const duplicateCommand = await once('postcommit-crash', 'POST');
    assert.equal(duplicateCommand.httpStatus, 409);
    const duplicateStatus = await status(); assert.deepEqual(duplicateStatus.current, postcommit.current); assert.deepEqual(duplicateStatus.events, postcommit.events);
    assert.equal(duplicateStatus.instanceNonce, postcommit.instanceNonce);
    artifact.duplicateFaultCommand = { rejected: true, instanceUnchanged: true, receiptUnchanged: true, eventCountUnchanged: true };
    const marked = await mutation('gc-mark', 'gc-marked');
    assert.ok(marked.state.gc.candidates.length >= 3);
    // Use the server's recorded grace duration, not assumed client/server clock agreement.
    const grace = marked.state.gc.eligibleAt - marked.state.gc.markedAt;
    assert.equal(grace, 3000); await new Promise(resolve => setTimeout(resolve, grace + 100));
    const swept = await mutation('gc-sweep', 'gc-swept');
    assert.deepEqual(swept.events, postcommit.events); assert.deepEqual(swept.restored, postcommit.restored);
    assert.deepEqual(swept.state.gc.deleted.slice().sort(), marked.state.gc.candidates.map(object => object.key).sort());
    assert.deepEqual(swept.objects.map(object => object.key).sort(), marked.state.gc.retained);
    const secondSweep = await once('gc-sweep', 'POST'); assert.equal(secondSweep.httpStatus, 200); assert.deepEqual(secondSweep.body.deletedNow, []);
    artifact.final = await status(); assert.deepEqual(artifact.final.current, postcommit.current); assert.deepEqual(artifact.final.events, postcommit.events);
    artifact.checksPassed = true;
  } catch (error) {
    artifact.failure = error instanceof Error ? error.message.replaceAll(token, '[REDACTED]') : 'cloud-fault-probe-failed';
    try { artifact.failureStatus = await status(); } catch { artifact.failureStatus = { unavailable: true }; }
  } finally {
    artifact.sourceAfter = storageSources(root); artifact.sourceStableDuringProbe = before.sha256 === artifact.sourceAfter.sha256;
    if (!artifact.sourceStableDuringProbe) artifact.checksPassed = false;
    artifact.requestCount = requestCount; artifact.receivedBytes = receivedBytes; artifact.finishedAt = new Date().toISOString();
    artifact.residue = 'Committed checkpoint objects and DO evidence deliberately retained; GC removes only run-scoped orphan objects. No product or G0 promotion.';
    artifact.actionJournalSha256 = hash(readFileSync(journal));
    writeFileSync(target, `${sanitize(artifact)}\n`, { flag: 'wx', mode: 0o600 });
  }
  return { output: target, runId, checksPassed: artifact.checksPassed, sourceStableDuringProbe: artifact.sourceStableDuringProbe, gate_decision: artifact.gate_decision, requestCount, receivedBytes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await runStorageCloud(options); console.log(JSON.stringify(result, null, 2));
    if (!result.checksPassed) process.exitCode = 1;
  } catch { console.error('storage-cloud failed before evidence completion; verify CLI, owned 0600 secret, and output path. No credentials printed.'); process.exitCode = 1; }
}
