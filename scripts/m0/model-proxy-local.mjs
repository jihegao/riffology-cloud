import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, sourceSnapshot } from './source-inventory.mjs';

// This driver only talks to an operator-started local Worker. It never starts
// Wrangler, Docker, a model provider, or any other process.
export const ORIGIN = 'http://127.0.0.1:8794';
export const STAGING_ORIGIN = 'https://riffology-m0-model-proxy-staging.jihe-gao.workers.dev';
export const LIMITS = Object.freeze({ totalMs: 120_000, requestMs: 10_000, bodyBytes: 1024 * 1024, cleanupBodyBytes: 256 * 1024, businessRequests: 60, cleanupMs: 15_000, cleanupRequests: 4 });
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const runPattern = /^[a-z0-9][a-z0-9-]{7,47}$/;

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--secrets-file' || !argv[1] || argv[1].startsWith('--')) throw new Error('usage: --secrets-file <repository-.local-json>');
  return { secretsFile: argv[1] };
}

function safeLocalSecretPath(input) {
  if (typeof input !== 'string' || input.includes('\0')) throw new Error('invalid-secret-path');
  const path = resolve(root, input);
  const rel = relative(root, path);
  if (!rel || !rel.startsWith(`.local${sep}`)) throw new Error('secret-must-be-under-repository-local');
  let current = root;
  for (const part of rel.split(sep)) {
    current = resolve(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('secret-symlink-forbidden');
  }
  const stat = lstatSync(path);
  if (stat.uid !== process.getuid() || !stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 16_384) throw new Error('secret-must-be-0600-regular-file');
  return path;
}

export function readOperatorToken(input) {
  const path = safeLocalSecretPath(input);
  const raw = readFileSync(path, 'utf8');
  let values;
  try { values = JSON.parse(raw); } catch { throw new Error('invalid-secret-json'); }
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length !== 1 || !Object.hasOwn(values, 'M0_PROBE_TOKEN')) throw new Error('one-operator-token-required');
  const token = values.M0_PROBE_TOKEN;
  if (typeof token !== 'string' || token.length < 32 || token.length > 1024 || /[\s\r\n]/.test(token)) throw new Error('invalid-operator-token');
  return token;
}

export function modelProxySources() {
  const snapshot = sourceSnapshot(root);
  const files = snapshot.files.filter(file => file.path.startsWith('spikes/m0-model-proxy/') || file.path === 'spikes/m0-cloud/auth.ts' || file.path === 'scripts/m0/model-proxy-local.mjs' || file.path === 'scripts/m0/model-proxy-cloud.mjs' || file.path === 'scripts/m0/source-inventory.mjs' || file.path === 'infra/wrangler.m0-model-proxy.jsonc' || file.path === 'package.json' || file.path === 'package-lock.json' || file.path === 'tsconfig.json');
  return { sha256: hash(JSON.stringify(files)), files, repositorySourceSha256: snapshot.sha256 };
}

function runId(stamp, tenant, suffix = '') {
  const value = `mp-${stamp}-${tenant}${suffix ? `-${suffix}` : ''}`;
  assert.match(value, runPattern);
  return value;
}

function fixedBody(message = 'fixture request') {
  return { model: 'm0-text-fixture', messages: [{ role: 'user', content: message }], stream: true, max_tokens: 32 };
}

function noSecret(value, token) {
  const text = JSON.stringify(value);
  if (text.includes(token)) throw new Error('secret-output-refused');
  return value;
}

function summarizeBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { kind: typeof body };
  const result = {};
  for (const key of ['runId', 'tenantId', 'workspaceId', 'revoked', 'instanceNonce', 'fixtureDispatches', 'activeRequests', 'realProviderCalls', 'mode', 'liveEnabled', 'error', 'status']) {
    if (Object.hasOwn(body, key) && (typeof body[key] === 'string' || typeof body[key] === 'number' || typeof body[key] === 'boolean' || body[key] === null)) result[key] = body[key];
  }
  if (Array.isArray(body.cancelledCalls)) result.cancelledCalls = body.cancelledCalls;
  if (body.ledger && typeof body.ledger === 'object') {
    result.ledger = {
      dispatchCount: body.ledger.dispatchCount,
      heldMicrousd: body.ledger.heldMicrousd,
      calls: body.ledger.calls && typeof body.ledger.calls === 'object'
        ? Object.fromEntries(Object.entries(body.ledger.calls).map(([callId, call]) => [callId, {
          state: call?.state ?? null,
          dispatchOrdinal: call?.dispatchOrdinal ?? null,
          billingAmount: call?.billingAmount ?? null,
          outcome: call?.facts?.outcome ?? null,
          errorCode: call?.facts?.errorCode ?? null,
          usage: call?.facts?.usage ? { status: call.facts.usage.status ?? null, input: call.facts.usage.observedTokens?.input ?? null, output: call.facts.usage.observedTokens?.output ?? null } : null,
        }])) : null,
    };
  }
  return result;
}

function assertSseFixture(text, expectedUsage = true) {
  assert.match(text, /fixture-ok/);
  if (expectedUsage) {
    assert.match(text, /"prompt_tokens"\s*:\s*10/);
    assert.match(text, /"completion_tokens"\s*:\s*1/);
  }
}

function isBudgetOrValidationError(error) {
  return /budget|body|json|secret|operator|invalid|usage|ended-before|terminal-status|deadline|timeout|aborted|call3/i.test(String(error?.message ?? ''));
}

export async function runModelProxyProbe({ token, origin = ORIGIN, deployment = null, outputDirectory = undefined, now = () => Date.now(), fetcher = fetch }) {
  if (origin !== ORIGIN && origin !== STAGING_ORIGIN) throw new Error('model-proxy-origin-denied');
  const cloud = origin === STAGING_ORIGIN;
  if (cloud && (!deployment || deployment.mode !== 'fixture-only' || deployment.origin !== origin || deployment.accountId !== '8b0d70250211aa10d89e20605a1c7e5e' || !/^[a-f0-9-]{36}$/.test(deployment.versionId ?? '') || !/^[a-f0-9]{64}$/.test(deployment.bundleSha256 ?? '') || deployment.verified !== true)) throw new Error('verified-fixture-deployment-required');
  if (!token || token.length < 32) throw new Error('missing-operator-token');
  const stamp = `${now()}-${randomBytes(4).toString('hex')}`;
  const directory = outputDirectory ? resolve(outputDirectory) : resolve(root, 'docs/evidence/runs', `m0-model-proxy-${cloud ? 'cloud' : 'local'}-${stamp}`);
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const target = resolve(directory, cloud ? 'model-proxy-cloud.json' : 'model-proxy-local.json');
  const before = modelProxySources();
  const began = now();
  const businessDeadline = began + LIMITS.totalMs;
  const result = {
    schemaVersion: 1,
    operation: 'G0-T01-model-proxy-fixture',
    environment: cloud ? 'staging-cloud-do-fixture-only' : 'local-worker-fixture-only',
    origin,
    deployment,
    startedAt: new Date(began).toISOString(),
    gate_decision: 'not_evaluated',
    cloudGatePassed: false,
    passed: false,
    cases: [],
    cleanup: [],
    sourcesBefore: before,
  };
  const owned = new Map();
  let businessBodyBytes = 0;
  let cleanupBodyBytes = 0;
  let cleanupDeadline = 0;
  let businessRequests = 0;
  let cleanupRequests = 0;

  function budget(kind) {
    const deadline = kind === 'cleanup' ? cleanupDeadline : businessDeadline;
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error(`${kind}-budget-exhausted`);
    if (kind === 'business' && ++businessRequests > LIMITS.businessRequests) throw new Error('business-request-budget-exhausted');
    if (kind === 'cleanup' && ++cleanupRequests > LIMITS.cleanupRequests) throw new Error('cleanup-request-budget-exhausted');
    return Math.min(LIMITS.requestMs, remaining);
  }

  async function fetchBounded(input, init, deadline, controller, timeoutLabel) {
    let timer;
    try {
      return await Promise.race([
        fetcher(input, init),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error(timeoutLabel)); }, Math.max(1, deadline - now())); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  async function request(path, { method = 'GET', credential = token, body, kind = 'business', headers = {}, stream = false } = {}) {
    const controller = new AbortController();
    const timeoutMs = budget(kind);
    const deadline = now() + timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let reader;
    const counter = kind === 'cleanup' ? 'cleanup' : 'business';
    try {
      const response = await fetchBounded(`${origin}${path}`, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...headers },
        ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
        redirect: 'error', signal: controller.signal,
      }, deadline, controller, 'request-fetch-deadline');
      if (!response.body) return { status: response.status, text: '', headers: response.headers };
      reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      try {
        try {
          while (true) {
            let readTimer;
            const part = await Promise.race([
              reader.read(),
              new Promise((_, reject) => { readTimer = setTimeout(() => reject(new Error('response-read-deadline')), Math.max(1, deadline - now())); }),
            ]).finally(() => clearTimeout(readTimer));
            if (part.done) break;
            length += part.value.byteLength;
            if (counter === 'cleanup') cleanupBodyBytes += part.value.byteLength;
            else businessBodyBytes += part.value.byteLength;
            if (length > (counter === 'cleanup' ? LIMITS.cleanupBodyBytes : LIMITS.bodyBytes) || (counter === 'cleanup' ? cleanupBodyBytes : businessBodyBytes) > (counter === 'cleanup' ? LIMITS.cleanupBodyBytes : LIMITS.bodyBytes)) throw new Error('response-body-budget-exhausted');
            chunks.push(part.value);
          }
        } catch (error) {
          controller.abort();
          throw error;
        }
      } finally {
        if (reader) await Promise.race([reader.cancel().catch(() => {}), new Promise(resolvePromise => setTimeout(resolvePromise, 250))]);
        reader.releaseLock();
      }
      return { status: response.status, text: Buffer.concat(chunks).toString('utf8'), headers: response.headers };
    } catch (error) {
      controller.abort();
      throw error;
    } finally { clearTimeout(timer); }
  }

  function addCase(name, expectedStatus, response, passed, extra = {}) {
    result.cases.push({ name, expectedStatus, observedStatus: response?.status ?? null, passed, ...extra });
  }

  async function jsonRequest(path, options = {}) {
    const response = await request(path, options);
    let body = null;
    try { body = response.text ? JSON.parse(response.text) : null; } catch { throw new Error('invalid-json-response'); }
    return { ...response, body };
  }

  async function status(run, kind = 'business') {
    const response = await jsonRequest(`/probe/${run}/status`, { kind });
    assert.equal(response.status, 200);
    return response.body;
  }

  async function init(run, tenant) {
    const response = await jsonRequest(`/probe/${run}/init/${tenant}`, { method: 'POST', body: '' });
    assert.equal(response.status, 200);
    assert.equal(response.body.runId, run);
    assert.ok(Array.isArray(response.body.capabilities) && response.body.capabilities.length === 3);
    for (const capability of response.body.capabilities) {
      assert.match(capability.callId, /^call-[123]$/);
      assert.equal(typeof capability.token, 'string');
      assert.match(capability.token, /^m0p\.[a-z0-9][a-z0-9-]{7,47}\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
    }
    return response.body.capabilities;
  }

  async function model(capability, body = fixedBody(), extra = {}) {
    const response = await request('/v1/chat/completions', { method: 'POST', credential: capability.token, body, headers: extra.headers, stream: true });
    return response;
  }

  async function completedCall(capability, body = fixedBody(), expectedStatus = 200, extra = {}) {
    const response = await model(capability, body, extra);
    assert.equal(response.status, expectedStatus);
    if (expectedStatus === 200) assertSseFixture(response.text);
    return response;
  }

  async function readBefore(reader, deadline, label) {
    let timer;
    try { return await Promise.race([reader.read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), Math.max(1, deadline - now())); })]); }
    finally { clearTimeout(timer); }
  }

  async function cancelReader(reader) {
    if (!reader) return;
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  async function firstFrame(reader, deadline) {
    let content = '';
    const decoder = new TextDecoder();
    while (!content.includes('\n\n')) {
      const part = await readBefore(reader, deadline, 'first-frame-deadline');
      assert.equal(part.done, false);
      businessBodyBytes += part.value.byteLength;
      if (businessBodyBytes > LIMITS.bodyBytes) throw new Error('response-body-budget-exhausted');
      content += decoder.decode(part.value, { stream: true });
      if (content.length > 8192) throw new Error('first-frame-body-limit');
    }
    assert.match(content, /fixture-begin/);
  }

  async function cancelledCall(capability) {
    const controller = new AbortController();
    const deadline = now() + budget('business');
    let reader;
    try {
      const response = await fetchBounded(`${origin}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${capability.token}` }, body: JSON.stringify(fixedBody()), redirect: 'error', signal: controller.signal }, deadline, controller, 'call3-fetch-deadline');
      assert.equal(response.status, 200);
      reader = response.body?.getReader(); assert.ok(reader, 'call3-response-body-required');
      await firstFrame(reader, deadline);
      const cancellation = await jsonRequest('/v1/cancel', { method: 'POST', credential: capability.token, body: '' });
      assert.equal(cancellation.status, 200); assert.equal(cancellation.body.cancelled, true); assert.equal(cancellation.body.callId, capability.callId);
      let streamEnd;
      try { const part = await readBefore(reader, deadline, 'call3-cancel-deadline'); if (!part.done) throw new Error('cancel-unexpected-content'); streamEnd = 'server-eof'; }
      catch (error) { if (error.message === 'call3-cancel-deadline' || error.message === 'cancel-unexpected-content' || controller.signal.aborted) throw error; streamEnd = 'server-stream-error'; }
      return { cancelled: true, streamEnd };
    } finally { controller.abort(); await cancelReader(reader); }
  }

  async function activeRevokeCall(capability, run) {
    const controller = new AbortController();
    const timeoutMs = budget('business');
    const deadline = now() + timeoutMs;
    let reader;
    try {
      const response = await fetchBounded(`${origin}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${capability.token}` }, body: JSON.stringify(fixedBody()), redirect: 'error', signal: controller.signal }, deadline, controller, 'active-revoke-fetch-deadline');
      assert.equal(response.status, 200);
      reader = response.body?.getReader(); assert.ok(reader, 'active-revoke-response-body-required');
      await firstFrame(reader, deadline);
      let revokeResponse;
      try { revokeResponse = await jsonRequest(`/probe/${run}/revoke`, { method: 'POST', body: '' }); }
      catch (error) { if (isBudgetOrValidationError(error)) throw error; revokeResponse = { status: null, unknown: true }; }
      if (revokeResponse.status !== null) { assert.equal(revokeResponse.status, 200); assert.equal(revokeResponse.body.revoked, true); }
      const revoked = await status(run);
      assert.equal(revoked.revoked, true);
      let streamEnd;
      try {
        const next = await readBefore(reader, deadline, 'active-revoke-read-deadline');
        if (!next.done) { businessBodyBytes += next.value.byteLength; throw new Error('active-revoke-unexpected-content'); }
        streamEnd = 'server-eof';
      } catch (error) {
        if (error.message === 'active-revoke-read-deadline' || error.message === 'active-revoke-unexpected-content' || controller.signal.aborted) throw error;
        streamEnd = 'server-stream-error';
      }
      return { revokeResponse, revoked, streamEnd };
    } finally { controller.abort(); await cancelReader(reader); }
  }

  async function waitTerminal(run, predicate) {
    for (let attempt = 0; attempt < 13; attempt++) {
      const current = await status(run);
      result.lastStatusObservation = summarizeBody(current);
      if (predicate(current)) return current;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 500));
    }
    throw new Error('terminal-status-timeout');
  }

  async function faultMutation(path, run) {
    let response;
    try { response = await jsonRequest(path, { method: 'POST', body: '' }); }
    catch (error) { if (isBudgetOrValidationError(error)) throw error; response = { status: null, unknown: true }; }
    assert.ok(response.status === 500 || response.status === null, 'fault mutation must be 500 or unknown');
    // A 500 may be a genuine interruption and an unknown response may mean
    // the mutation committed before transport loss. Reconcile with GET before
    // making any claim; a 404 is never accepted as evidence.
    const observed = await status(run);
    return { response, observed };
  }

  async function interruptedModel(capability, run) {
    let response;
    try { response = await model(capability); }
    catch (error) { if (isBudgetOrValidationError(error)) throw error; response = { status: null, unknown: true }; }
    assert.ok(response.status === 500 || response.status === null, 'interrupted model call must be 500 or unknown');
    const observed = await status(run);
    return { response, observed };
  }

  async function revoke(run, tenant, kind = 'business') {
    let response;
    try { response = await jsonRequest(`/probe/${run}/revoke`, { method: 'POST', body: '', kind }); }
    catch (error) { if (isBudgetOrValidationError(error)) throw error; response = { status: null, unknown: true }; }
    let confirmed = false;
    if (response.status !== null) { assert.equal(response.status, 200); assert.equal(response.body.revoked, true); confirmed = true; }
    else { const observed = await status(run, kind); confirmed = observed.revoked === true; }
    if (!confirmed) throw new Error('revoke-not-confirmed');
    owned.delete(run);
    result.cleanup.push({ runId: run, tenant, status: response.status, revoked: true, responseUnknown: response.unknown === true });
  }

  const stampOnly = `${began}-${randomBytes(3).toString('hex')}`;
  const plans = [
    { runId: runId(stampOnly, 'alpha'), tenant: 'alpha' },
    { runId: runId(stampOnly, 'bravo'), tenant: 'bravo' },
    { runId: runId(stampOnly, 'alpha', 'abort'), tenant: 'alpha' },
    { runId: runId(stampOnly, 'alpha', 'restart'), tenant: 'alpha' },
  ];
  result.plannedScopes = plans.map(({ runId: id, tenant }) => ({ runId: id, tenant }));

  try {
    const unauthHealth = await jsonRequest('/health', { credential: '' });
    assert.equal(unauthHealth.status, 401); addCase('operator-auth-required', 401, unauthHealth, true);
    const health = await jsonRequest('/health');
    assert.equal(health.status, 200); assert.equal(health.body.mode, 'fixture-only'); assert.equal(health.body.liveEnabled, false);
    addCase('fixture-only-health', 200, health, true, { summary: summarizeBody(health.body) });

    const capabilities = new Map();
    for (const plan of plans) {
      // Register ownership immediately before the first mutation for this run;
      // an uncertain init is fenced by the same owned run's revoke tombstone.
      owned.set(plan.runId, plan);
      capabilities.set(plan.runId, await init(plan.runId, plan.tenant));
    }
    result.cases.push({ name: 'four-owned-runs-initialized', expectedStatus: 200, observedStatus: 200, passed: true, capabilityCountPerRun: 3 });

    const alpha = capabilities.get(plans[0].runId);
    const bravo = capabilities.get(plans[1].runId);
    const abortRun = capabilities.get(plans[2].runId);
    const restartRun = capabilities.get(plans[3].runId);
    const operatorModel = await model({ token }, fixedBody());
    const operatorCancel = await jsonRequest('/v1/cancel', { method: 'POST', credential: token, body: '' }); assert.equal(operatorCancel.status, 401);
    assert.equal(operatorModel.status, 401); addCase('operator-token-cannot-model', 401, operatorModel, true);
    const operatorStatus = await jsonRequest(`/probe/${plans[0].runId}/status`, { credential: alpha[0].token });
    assert.ok([401, 403].includes(operatorStatus.status)); addCase('model-cap-cannot-status', operatorStatus.status, operatorStatus, true);

    const [sameA, sameB] = await Promise.all([model(alpha[0]), model(alpha[0])]);
    assert.deepEqual([sameA.status, sameB.status].sort((a, b) => a - b), [200, 409]);
    const accepted = sameA.status === 200 ? sameA : sameB;
    assertSseFixture(accepted.text); addCase('same-cap-concurrency-one-accepted', '200+409', { status: `${sameA.status}+${sameB.status}` }, true);
    const conflict = await model(alpha[0], fixedBody('fixture request changed'));
    assert.equal(conflict.status, 409); addCase('same-cap-different-payload-conflict', 409, conflict, true);

    const bravoBefore = await status(plans[1].runId);
    const substitutedParts = alpha[1].token.split('.');
    assert.equal(substitutedParts.length, 4);
    substitutedParts[1] = plans[1].runId;
    const substituted = await model({ token: substitutedParts.join('.') });
    assert.equal(substituted.status, 401); addCase('alpha-cap-cannot-address-bravo', 401, substituted, true);
    const bravoAfter = await status(plans[1].runId);
    assert.equal(bravoAfter.fixtureDispatches, bravoBefore.fixtureDispatches ?? 0); addCase('bravo-no-dispatch-from-substitution', 200, { status: 200 }, true, { fixtureDispatches: bravoAfter.fixtureDispatches ?? 0 });

    const activeRevoke = await activeRevokeCall(bravo[2], plans[1].runId);
    const bravoRevoked = await waitTerminal(plans[1].runId, current => current?.revoked === true && current?.activeRequests === 0 && current?.ledger?.calls?.['call-3']?.state === 'terminal' && current?.ledger?.calls?.['call-3']?.facts?.outcome === 'cancelled');
    assert.ok(activeRevoke.revokeResponse.status === 200 || activeRevoke.revokeResponse.status === null);
    assert.equal(bravoRevoked.ledger.calls['call-3'].facts.usage.status, 'unknown'); assert.ok(bravoRevoked.ledger.heldMicrousd > 0); assert.equal(bravoRevoked.ledger.calls['call-3'].billingAmount, null);
    owned.delete(plans[1].runId); result.cleanup.push({runId: plans[1].runId, tenant: plans[1].tenant, revoked: true, status: activeRevoke.revokeResponse.status}); addCase('active-revoke-aborts-stream-and-persists-unknown', '200/unknown', activeRevoke.revokeResponse, true, { streamEnd: activeRevoke.streamEnd, summary: summarizeBody(bravoRevoked) });

    const call2 = await completedCall(alpha[1]); addCase('alpha-call2-completes', 200, call2, true);
    const cancelled = await cancelledCall(alpha[2]); assert.equal(cancelled.cancelled, true); addCase('alpha-call3-explicitly-cancelled', 200, { status: 200 }, true, { streamEnd: cancelled.streamEnd });
    const alphaTerminal = await waitTerminal(plans[0].runId, current => current?.ledger?.dispatchCount === 3 && Object.keys(current.ledger.calls ?? {}).length === 3 && current.ledger.calls['call-3']?.state === 'terminal' && current.ledger.calls['call-3']?.facts?.outcome === 'cancelled' && current.activeRequests === 0);
    assert.equal(alphaTerminal.ledger.dispatchCount, 3); assert.equal(alphaTerminal.fixtureDispatches, 3); assert.ok(alphaTerminal.ledger.heldMicrousd > 0);
    assert.deepEqual(Object.keys(alphaTerminal.ledger.calls).sort(), ['call-1', 'call-2', 'call-3']);
    for (const call of Object.values(alphaTerminal.ledger.calls)) assert.equal(call.billingAmount, null);
    assert.equal(alphaTerminal.ledger.calls['call-3'].facts.usage.status, 'unknown'); assert.deepEqual(alphaTerminal.cancelledCalls, ['call-3']);
    for (const id of ['call-1','call-2']) { assert.equal(alphaTerminal.ledger.calls[id].facts.outcome, 'completed'); assert.equal(alphaTerminal.ledger.calls[id].facts.usage.status, 'known'); }
    const cancelledReplay = await model(alpha[2]); assert.equal(cancelledReplay.status, 403); const afterCancelledReplay = await status(plans[0].runId); assert.deepEqual(afterCancelledReplay.ledger, alphaTerminal.ledger); assert.equal(afterCancelledReplay.fixtureDispatches, 3);
    addCase('alpha-ledger-three-dispatches-and-held-budget', 200, { status: 200 }, true, { summary: summarizeBody(alphaTerminal) });

    await revoke(plans[0].runId, plans[0].tenant);
    const oldCapability = await model(alpha[1]); assert.equal(oldCapability.status, 403); addCase('revoked-capability-rejected', 403, oldCapability, true);

    const preCancel = await jsonRequest('/v1/cancel', { method: 'POST', credential: abortRun[1].token, body: '' }); assert.equal(preCancel.status, 200);
    const preCancelledCall = await model(abortRun[1]); assert.equal(preCancelledCall.status, 403); const preCancelledStatus = await status(plans[2].runId); assert.equal(preCancelledStatus.ledger, null); assert.equal(preCancelledStatus.fixtureDispatches, 0); assert.deepEqual(preCancelledStatus.cancelledCalls, ['call-2']); addCase('pre-cancel-fence-prevents-reservation-and-fixture', 403, preCancelledCall, true, { summary: summarizeBody(preCancelledStatus) });
    const arm = await jsonRequest(`/probe/${plans[2].runId}/arm-abort`, { method: 'POST', body: '' });
    assert.equal(arm.status, 200); addCase('arm-abort-armed', 200, arm, true);
    const abortBefore = (await status(plans[2].runId)).instanceNonce;
    const abortResult = await interruptedModel(abortRun[0], plans[2].runId);
    addCase('arm-abort-call-returns-interruption', '500/unknown', abortResult.response, true, { reconciled: true, summary: summarizeBody(abortResult.observed) });
    const abortTerminal = await waitTerminal(plans[2].runId, current => current?.ledger?.dispatchCount === 1 && current.fixtureDispatches === 0 && current?.ledger?.calls?.['call-1']?.state === 'dispatched');
    assert.notEqual(abortTerminal.instanceNonce, abortBefore); assert.equal(abortTerminal.fixtureDispatches, 0); assert.equal(abortTerminal.ledger.dispatchCount, 1); assert.ok(abortTerminal.ledger.heldMicrousd > 0); assert.equal(abortTerminal.ledger.calls['call-1'].billingAmount, null); assert.equal(abortTerminal.ledger.calls['call-1'].facts, null); addCase('abort-intent-preserved-without-fixture-dispatch', 200, { status: 200 }, true, { summary: summarizeBody(abortTerminal) });
    const abortReplay = await model(abortRun[0]); assert.equal(abortReplay.status, 409); const abortAfterReplay = await status(plans[2].runId); assert.deepEqual(abortAfterReplay.ledger, abortTerminal.ledger); assert.equal(abortAfterReplay.fixtureDispatches, abortTerminal.fixtureDispatches); addCase('aborted-call-not-replayed', 409, abortReplay, true);

    const restartCall = await completedCall(restartRun[0]); addCase('restart-run-call1-completes', 200, restartCall, true);
    const restartBefore = (await status(plans[3].runId)).instanceNonce;
    const restartResult = await faultMutation(`/probe/${plans[3].runId}/restart`, plans[3].runId);
    addCase('restart-returns-interruption', '500/unknown', restartResult.response, true, { reconciled: true, summary: summarizeBody(restartResult.observed) });
    const restarted = await waitTerminal(plans[3].runId, current => current?.ledger?.dispatchCount === 1 && current?.ledger?.calls?.['call-1']?.state === 'terminal' && current.instanceNonce);
    assert.notEqual(restarted.instanceNonce, restartBefore); assert.equal(restarted.ledger.dispatchCount, 1); assert.deepEqual(Object.keys(restarted.ledger.calls), ['call-1']); assert.equal(restarted.ledger.calls['call-1'].billingAmount, null); const restartReplay = await model(restartRun[0]); assert.equal(restartReplay.status, 409); const restartAfterReplay = await status(plans[3].runId); assert.deepEqual(restartAfterReplay.ledger, restarted.ledger); assert.equal(restartAfterReplay.fixtureDispatches, restarted.fixtureDispatches); assert.equal(restarted.fixtureDispatches, 1); addCase('restart-call-not-replayed', 409, restartReplay, true, { summary: summarizeBody(restarted) });
    for (const [id, plan] of [...owned]) await revoke(id, plan.tenant, 'business');
    result.finalScopes = [];
    for (const [index, plan] of plans.entries()) {
      const final = await status(plan.runId);
      assert.equal(final.revoked, true); assert.equal(final.activeRequests, 0);
      assert.equal(final.ledger.dispatchCount, [3, 1, 1, 1][index]);
      assert.equal(final.fixtureDispatches, [3, 1, 0, 1][index]);
      assert.equal(final.ledger.heldMicrousd, [576, 192, 192, 192][index]);
      result.finalScopes.push(summarizeBody(final));
    }
    addCase('all-four-scopes-revoked-idle-and-ledgers-preserved', 200, { status: 200 }, true);
    result.passed = true;
  } catch (error) {
    result.failure = { kind: error instanceof assert.AssertionError ? 'assertion-failed' : 'probe-or-transport-failed', afterCase: result.cases.at(-1)?.name ?? null, code: /^[a-z0-9-]{1,80}$/.test(error?.message ?? '') ? error.message : null };
  } finally {
    cleanupDeadline = now() + LIMITS.cleanupMs;
    for (const [id, plan] of [...owned]) {
      try { await revoke(id, plan.tenant, 'cleanup'); }
      catch { result.passed = false; result.cleanup.push({ runId: id, tenant: plan.tenant, revoked: false, outcome: 'not-confirmed' }); }
    }
    result.sourcesAfter = modelProxySources();
    result.sourceStableDuringRun = result.sourcesBefore.sha256 === result.sourcesAfter.sha256;
    if (!result.sourceStableDuringRun) result.passed = false;
    result.finishedAt = new Date(now()).toISOString();
    result.bodyBytes = { business: businessBodyBytes, cleanup: cleanupBodyBytes };
    result.limits = { ...LIMITS, noLiveProvider: true, noCloudGate: true, businessRequestsUsed: businessRequests, cleanupRequestsUsed: cleanupRequests };
    noSecret(result, token);
    writeFileSync(target, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  return { output: target, passed: result.passed, sourceStableDuringRun: result.sourceStableDuringRun };
}

export function runModelProxyLocal(options) { return runModelProxyProbe({ ...options, origin: ORIGIN, deployment: null }); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const outcome = await runModelProxyLocal({ token: readOperatorToken(options.secretsFile) });
    console.log(JSON.stringify({ output: outcome.output, passed: outcome.passed, sourceStableDuringRun: outcome.sourceStableDuringRun }));
    if (!outcome.passed) process.exitCode = 1;
  } catch {
    console.error('model-proxy-local failed before evidence completion; verify the local Worker and owned 0600 secret. No credentials printed.');
    process.exitCode = 1;
  }
}
