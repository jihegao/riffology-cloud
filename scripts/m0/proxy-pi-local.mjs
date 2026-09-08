import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN, readOperatorToken } from './model-proxy-local.mjs';
import { hash, sourceSnapshot } from './source-inventory.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--secrets-file' || !argv[1] || argv[1].startsWith('--')) throw new Error('local-secret-file-required');
  return argv[1];
}

export async function runChild(input, timeoutMs = 20000) {
  // Parent owns cleanup even if the child cannot execute a finally block.
  const trustedCwd = await mkdtemp(resolve(tmpdir(), 'riffology-pi-do-'));
  let result, failure;
  try { result = await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'scripts/m0/proxy-pi-child.mjs'), '--local-fixture'], {
      cwd: root, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks = []; let bytes = 0, stderrBytes = 0, exceeded = false, timedOut = false, startFailed = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 131072) { exceeded = true; child.kill('SIGKILL'); } else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > 16384) { exceeded = true; child.kill('SIGKILL'); } });
    child.on('error', () => { startFailed = true; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const facts = { pid: child.pid ?? null, exitCode: code, signal, timedOut, startFailed,
        outputLimitExceeded: exceeded, stderrBytes, closed: true };
      const fail = message => { const error = new Error(message); error.process = facts; reject(error); };
      if (code !== 0 || timedOut || exceeded || startFailed) { fail('child-diagnostic-failed'); return; }
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (result.pid !== child.pid) throw new Error('child-pid-mismatch');
        resolvePromise({ ...result, process: facts });
      } catch { fail('child-output-invalid'); }
    });
    child.stdin.end(JSON.stringify({ ...input, trustedCwd }));
  }); } catch (error) { failure = error; }
  const cleanup = { trustedDirectoryRemoved: false };
  try { await rm(trustedCwd, { recursive: true, force: true }); cleanup.trustedDirectoryRemoved = true; }
  catch {
    cleanup.retainedDirectory = trustedCwd;
    failure ??= Object.assign(new Error('child-directory-cleanup-failed'), { process: result?.process ?? null });
  }
  if (failure) {
    failure.cleanup = cleanup;
    throw failure;
  }
  return { ...result, trustedDirectoryRemoved: true };
}

async function main(token) {
  const stamp = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const runId = `pi-do-${stamp}`;
  const directory = resolve(root, 'docs/evidence/runs', `m0-proxy-pi-local-${stamp}`);
  mkdirSync(directory, { mode: 0o700 });
  const sources = sourceSnapshot(root), started = Date.now(), deadline = started + 90000;
  const evidence = { schemaVersion: 1, operation: 'Pi-Worker-SQLite-diagnostic', runId,
    environment: 'local-pi-processes-workerd-sqlite-fixture', origin: ORIGIN,
    startedAt: new Date(started).toISOString(), gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sources, cases: [], children: [], cleanup: {}, passed: false, cloudGatePassed: false,
    gate_decision: 'not_evaluated', realProviderCalls: 0, billingAmount: null, semanticMemoryVerified: false };
  const secrets = [token];
  let requests = 0, responseBytes = 0, cleanupRequests = 0, cleanupBytes = 0, initializationAttempted = false, currentCheck = null;
  const safe = value => {
    const encoded = JSON.stringify(value);
    if (secrets.some(secret => encoded.includes(secret))) throw new Error('credential-in-evidence');
    return encoded;
  };
  const check = (name, operation) => { currentCheck = name; operation(); evidence.cases.push({ name, passed: true }); currentCheck = null; };
  async function control(path, method = 'GET', cleanup = false) {
    if (cleanup ? ++cleanupRequests > 2 : ++requests > 38 || Date.now() >= deadline) throw new Error('control-budget-exhausted');
    const signal = AbortSignal.timeout(cleanup ? 5000 : Math.max(1, Math.min(5000, deadline - Date.now())));
    const response = await fetch(ORIGIN + path, { method, headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal });
    assert.equal(response.headers.get('x-riffology-m0-mode'), 'fixture-only');
    const reader = response.body.getReader(); const chunks = []; let bytes = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (cleanup) cleanupBytes += part.value.length; else responseBytes += part.value.length;
        if (bytes > 65536 || (cleanup ? cleanupBytes > 131072 : responseBytes > 524288)) throw new Error('control-body-limit');
        chunks.push(part.value);
      }
    } finally { void reader.cancel().catch(() => {}); }
    return { status: response.status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  }
  async function status(cleanup = false) {
    const response = await control(`/probe/${runId}/status`, 'GET', cleanup);
    assert.equal(response.status, 200);
    assert.equal(response.body.runId, runId);
    assert.equal(response.body.realProviderCalls, 0);
    assert.equal(response.body.liveEnabled, false);
    return response.body;
  }
  async function terminal(callId) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const value = await status();
      if (value.activeRequests === 0 && value.ledger?.calls[callId]?.state === 'terminal') return value;
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error('durable-terminal-not-confirmed');
  }
  try {
    const health = await control('/health');
    check('worker-is-fixture-only', () => {
      assert.equal(health.status, 200); assert.equal(health.body.liveEnabled, false);
      assert.equal(health.body.realProviderCalls, 0); assert.equal(health.body.protocolVersion, 'm0-model-proxy-v1');
    });
    initializationAttempted = true;
    const initialized = await control(`/probe/${runId}/init/alpha`, 'POST');
    assert.equal(initialized.status, 200);
    const init = initialized.body;
    assert.equal(init.runId, runId); assert.equal(init.liveEnabled, false); assert.equal(init.mode, 'fixture-only');
    assert.deepEqual(init.capabilities.map(item => item.callId), ['call-1', 'call-2', 'call-3']);
    secrets.push(...init.capabilities.map(item => item.token));
    const scope = { tenantId: 'm0-alpha', projectId: `m0-alpha-${runId}`, sessionId: randomUUID() };
    const marker = `marker-${randomBytes(12).toString('hex')}`;
    const invoke = async (index, prompt, snapshot, cancelOnDelta = false) => {
      if (Date.now() + 20000 > deadline) throw new Error('child-budget-exhausted');
      const invocation = { ...init.capabilities[index], runId, expiresAtMs: init.expiresAtMs, scope };
      const result = await runChild({ scope, invocation, snapshot, prompt, cancelOnDelta });
      safe(result);
      const { snapshot: saved, ...receipt } = result;
      evidence.children.push(receipt);
      check(`call-${index + 1}-one-process-one-attempt`, () => {
        assert.equal(result.defaultFetchCalls, 0); assert.equal(result.modelTransportAttempts, 1);
        assert.equal(result.duplicatePromptRejected, true); assert.equal(result.trustedDirectoryRemoved, true);
        assert.equal(result.requests.filter(item => item.path === '/v1/chat/completions').length, 1);
        assert.ok(result.events.some(item => item.deltaType === 'text_delta'));
      });
      return { ...receipt, snapshot: saved };
    };
    const first = await invoke(0, `Remember ${marker}.`);
    check('first-pi-completed', () => assert.equal(first.outcome, 'completed'));
    const firstStatus = await terminal('call-1');
    evidence.afterFirst = firstStatus;
    const savedText = safe(first.snapshot) + '\n';
    const checkpointPath = resolve(directory, 'session-checkpoint.json');
    writeFileSync(checkpointPath, savedText, { flag: 'wx', mode: 0o600, flush: true });
    const diskText = readFileSync(checkpointPath, 'utf8');
    evidence.checkpoint = { file: 'session-checkpoint.json', sha256: hash(diskText), bytes: Buffer.byteLength(diskText) };
    check('checkpoint-roundtrip-after-process-close', () => {
      assert.equal(diskText, savedText); assert.equal(first.process.closed, true);
    });
    // Restart the actual local DO after the first Pi process has exited.
    const restart = await control(`/probe/${runId}/restart`, 'POST');
    assert.equal(restart.status, 500);
    evidence.afterDoRestart = await status();
    check('do-restart-preserves-first-pi-receipt', () => {
      assert.notEqual(evidence.afterDoRestart.instanceNonce, firstStatus.instanceNonce);
      assert.deepEqual(evidence.afterDoRestart.ledger, firstStatus.ledger);
      assert.equal(evidence.afterDoRestart.fixtureDispatches, 1);
      assert.equal(evidence.afterDoRestart.activeRequests, 0);
    });
    const restored = await invoke(1, 'Continue the previous discussion.', JSON.parse(diskText));
    const secondStatus = await terminal('call-2'); evidence.afterRestore = secondStatus;
    check('restored-process-sends-full-history', () => {
      assert.notEqual(restored.pid, first.pid); assert.equal(restored.outcome, 'completed');
      const messages = restored.requests[0].body.messages;
      assert.ok(messages[0].content.includes('Fixed simulation diagnostic skill.'));
      assert.equal(messages.find(item => item.role === 'user').content, `Remember ${marker}.`);
      assert.equal(messages.find(item => item.role === 'assistant').content, 'fixture-ok');
      assert.equal(messages.at(-1).content, 'Continue the previous discussion.');
      assert.ok(!messages.at(-1).content.includes(marker));
    });
    const cancelled = await invoke(2, 'Stream a cancellation diagnostic.', restored.snapshot, true);
    const final = await terminal('call-3'); evidence.afterCancel = final;
    check('same-call-cancel-confirmed-by-durable-ledger', () => {
      assert.equal(cancelled.outcome, 'aborted'); assert.equal(cancelled.cancellation.remote, 'acknowledged');
      assert.equal(cancelled.cancellation.serverTerminalConfirmed, false);
      assert.equal(cancelled.requests.filter(item => item.path === '/v1/cancel').length, 1);
      assert.deepEqual(final.cancelledCalls, ['call-3']);
      assert.equal(final.ledger.calls['call-3'].facts.outcome, 'cancelled');
      assert.equal(final.ledger.calls['call-3'].facts.usage.status, 'unknown');
    });
    check('wire-and-durable-receipts-correlate', () => {
      assert.equal(final.tenantId, scope.tenantId); assert.equal(final.workspaceId, scope.projectId);
      assert.equal(final.fixtureDispatches, 3); assert.equal(final.ledger.dispatchCount, 3);
      assert.equal(final.ledger.heldMicrousd, 576);
      for (const child of evidence.children) {
        const request = child.requests.find(item => item.path === '/v1/chat/completions');
        const receipt = final.ledger.calls[request.callId];
        assert.equal(receipt.platformRequestId, request.platformRequestId);
        assert.equal(receipt.payloadHash, request.bodySha256);
        assert.equal(receipt.invocation.runId, runId); assert.equal(receipt.invocation.tenantId, scope.tenantId);
        assert.equal(receipt.invocation.workspaceId, scope.projectId);
        assert.equal(receipt.billingAmount, null); assert.equal(receipt.state, 'terminal');
        assert.equal(request.body.max_tokens, 32); assert.deepEqual(request.body.thinking, { type: 'disabled' });
        if (request.callId !== 'call-3') {
          assert.equal(receipt.facts.outcome, 'completed'); assert.equal(receipt.facts.usage.status, 'known');
          assert.ok(child.events.some(event => event.responseId === `fixture-${runId}-${request.callId}`));
        }
      }
    });
    evidence.passed = true;
  } catch (error) {
    evidence.error = { code: 'diagnostic-failed', assertion: error?.code === 'ERR_ASSERTION', check: currentCheck,
      childProcess: error?.process ?? null, childCleanup: error?.cleanup ?? null, completedCases: evidence.cases.length };
  } finally {
    if (initializationAttempted) {
      try {
        const revoked = await control(`/probe/${runId}/revoke`, 'POST', true);
        assert.equal(revoked.status, 200); assert.equal(revoked.body.revoked, true);
        const final = await status(true);
        evidence.cleanup = { revoked: final.revoked, activeRequests: final.activeRequests, realProviderCalls: final.realProviderCalls };
        if (!final.revoked || final.activeRequests !== 0) evidence.passed = false;
      } catch { evidence.cleanup = { confirmed: false }; evidence.passed = false; }
    }
    const after = sourceSnapshot(root);
    evidence.sourceStableDuringProbe = after.sha256 === sources.sha256;
    evidence.passed &&= evidence.sourceStableDuringProbe;
    evidence.controlRequests = requests; evidence.controlResponseBytes = responseBytes;
    evidence.cleanupRequests = cleanupRequests; evidence.cleanupResponseBytes = cleanupBytes;
    evidence.finishedAt = new Date().toISOString(); evidence.elapsedMs = Date.now() - started;
    writeFileSync(resolve(directory, 'proxy-pi-local.json'), safe(evidence) + '\n', { flag: 'wx', mode: 0o600 });
  }
  return { directory, passed: evidence.passed, cases: evidence.cases.length, cleanup: evidence.cleanup, cloudGatePassed: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main(readOperatorToken(parseArguments(process.argv.slice(2))));
    console.log(JSON.stringify(result)); if (!result.passed) process.exitCode = 1;
  } catch { console.error('proxy-pi-local failed; no credentials or raw errors emitted'); process.exitCode = 1; }
}
