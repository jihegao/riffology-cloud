import assert from 'node:assert/strict';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runEgressProbe } from '../../../services/runtime/egress-probe.mjs';

const deny = () => Response.json({ error: 'egress-policy-denied' }, { status: 403, headers: { 'x-riffology-m0-egress': 'fixed-v1' } });
const DNS_RESOLVERS = { 'external-dns': '8.8.8.8', 'dns-redirect-control': '203.0.113.53', 'platform-resolver': 'platform-default' };
const successExec = input => Promise.resolve({ exitCode: 0, signal: null, timedOut: false, errorSeen: false,
  stdout: JSON.stringify({ ...(input.probeId === 'platform-resolver' ? { status: 'resolved', category: 'platform-resolver-exception' }
    : { status: 'unconfirmed', category: 'os-permission-denied' }), ...(DNS_RESOLVERS[input.probeId]
      ? { requestedResolver: DNS_RESOLVERS[input.probeId], receivedAnswer: input.probeId === 'platform-resolver', actualDestinationVerified: false } : {}) }) });
const dnsAnswer = (id, receivedAnswer = true) => ({ exitCode: 0, timedOut: false, stdout: JSON.stringify({
  requestedResolver: DNS_RESOLVERS[id], receivedAnswer, actualDestinationVerified: false,
  status: receivedAnswer ? 'answered' : 'unconfirmed', category: receivedAnswer ? 'dns-answer-unattributed' : 'timeout-unconfirmed',
}) });
async function fixture(t) {
  const outputDirectory = await realpath(await mkdtemp(join(tmpdir(), 'fixed-egress-test-')));
  t.mock.method(globalThis, 'fetch', () => { throw new Error('real network forbidden'); });
  t.after(async () => { await rm(outputDirectory, { recursive: true, force: true }); });
  return { role: 'trusted', outputDirectory };
}

test('fixed trusted matrix is bounded, uses only a synthetic capability, and separates platform resolver exception', async t => {
  const input = await fixture(t), requests = [], commands = [];
  let active = 0, peak = 0;
  const output = await runEgressProbe(input, { transport: async request => {
    active++; peak = Math.max(peak, active);
    assert.equal(request.redirect, 'manual');
    requests.push({ url: request.url, method: request.method, authorization: request.headers.get('authorization'), routingHeader: request.headers.has('x-upstream-url'), body: await request.clone().text() });
    await new Promise(resolve => setTimeout(resolve, 2)); active--; return deny();
  }, exec: async request => { commands.push(request); return successExec(request); } });
  assert.equal(output.passed, true); assert.equal(output.evidenceMode, 'offline-injected'); assert.equal(output.realProviderCalls, 0);
  assert.ok(peak <= 4); assert.ok(output.peakConcurrency <= 4); assert.equal(output.perItemTimeoutMs, 4000); assert.equal(output.totalTimeoutMs, 35000);
  assert.equal(output.rows.length, 16); assert.ok(output.rows.some(row => row.id === 'platform-resolver' && row.category === 'platform-resolver-exception'));
  assert.deepEqual(commands.map(row => row.probeId).sort(), ['dns-redirect-control', 'external-dns', 'non-http-port', 'platform-resolver']);
  for (const command of commands) { assert.equal(command.command, process.execPath); assert.equal(command.timeoutMs, 4000); }
  assert.ok(!requests.some(request => request.url.endsWith('/v1/chat/completions') && request.body === '{}' && !request.routingHeader));
  for (const request of requests.filter(request => request.authorization)) assert.match(request.authorization, /^Bearer m0p\.go-live-g0-20260906\.0{64}\.0{64}$/);
  assert.equal(JSON.stringify(output).includes('Bearer'), false); assert.equal(JSON.stringify(output).includes('m0p.'), false);
  assert.deepEqual(await readdir(input.outputDirectory), []); assert.equal(output.cleanupConfirmed, true);
});

test('bare 403, tagged 502, wrong tag, TLS and mixed transport errors never become policy denial', async t => {
  const input = await fixture(t), secret = 'synthetic-secret-must-not-be-output';
  const modes = ['bare-403', 'tagged-502', 'wrong-tag', 'tls', 'mixed', 'unreachable', 'redirect'];
  for (const mode of modes) {
    const output = await runEgressProbe(input, { transport: async () => {
      if (mode === 'tls') throw Object.assign(new Error(secret), { cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } });
      if (mode === 'mixed') throw Object.assign(new AggregateError([{ code: 'EACCES' }, { cause: { code: 'CERT_HAS_EXPIRED' } }], secret), { code: 'EPERM' });
      if (mode === 'unreachable') throw Object.assign(new Error(secret), { code: 'ENETUNREACH' });
      if (mode === 'redirect') return new Response(secret, { status: 307, headers: { location: 'https://evil.invalid/' } });
      return Response.json({ error: 'egress-policy-denied', secret }, { status: mode === 'tagged-502' ? 502 : 403,
        headers: mode === 'bare-403' ? {} : { 'x-riffology-m0-egress': mode === 'wrong-tag' ? 'other' : 'fixed-v1' } });
    }, exec: successExec });
    assert.equal(output.passed, false, mode);
    assert.ok(output.rows.filter(row => row.expect === 'handler-denial').every(row => row.category !== 'policy-denied'));
    if (['tls', 'mixed'].includes(mode)) assert.equal(output.rows.find(row => row.id === 'trusted-management').category, 'tls-unconfirmed');
    assert.ok(!JSON.stringify(output).includes(secret)); assert.ok(!JSON.stringify(output).includes('evil.invalid'));
  }
});

test('project refuses wrong wheel length/digest/redirect and never executes pip on unverified bytes', async t => {
  const input = { ...await fixture(t), role: 'project' };
  for (const mode of ['length', 'digest', 'redirect']) {
    const commands = [], methods = [];
    const output = await runEgressProbe(input, { transport: async request => {
      methods.push([request.url, request.method]);
      if (request.url.endsWith('/simpy-4.1.1-py3-none-any.whl') && request.method === 'GET' && !request.headers.has('x-upstream-url')) {
        if (mode === 'redirect') return new Response('', { status: 302, headers: { location: 'https://elsewhere.invalid' } });
        return new Response(new Uint8Array(mode === 'length' ? 27223 : 27224), { status: 200, headers: { 'x-riffology-m0-egress': 'fixed-v1' } });
      }
      return deny();
    }, exec: request => { commands.push(request); return successExec(request); } });
    assert.equal(output.passed, false);
    assert.equal(output.rows.find(row => row.id === 'project-install-import').category, 'verified-wheel-required');
    assert.ok(commands.every(command => !command.probeId.startsWith('project-')));
    assert.ok(methods.some(([url, method]) => url.includes('/billing/top-up') && method === 'POST'));
    assert.deepEqual(await readdir(input.outputDirectory), []);
  }
});

test('DNS answers record receipt without claiming the configured server is reachable, with an independent TEST-NET control', async t => {
  const input = await fixture(t);
  for (const controlAnswered of [true, false]) {
    const output = await runEgressProbe(input, { transport: async () => deny(), exec: request => ['external-dns', 'dns-redirect-control'].includes(request.probeId)
      ? dnsAnswer(request.probeId, request.probeId === 'external-dns' || controlAnswered) : successExec(request) });
    assert.equal(output.requiredHttpBoundaryPassed, true); assert.equal(output.passed, true);
    assert.equal(output.supplementaryNetworkReachable, false); assert.equal(output.supplementaryNetworkConfirmed, false);
    assert.equal(output.dnsRedirectControlObserved, controlAnswered);
    const external = output.rows.find(row => row.id === 'external-dns'), control = output.rows.find(row => row.id === 'dns-redirect-control');
    assert.deepEqual({ requestedResolver: external.requestedResolver, receivedAnswer: external.receivedAnswer, actualDestinationVerified: external.actualDestinationVerified },
      { requestedResolver: '8.8.8.8', receivedAnswer: true, actualDestinationVerified: false });
    assert.equal(external.status, 'answered'); assert.equal(external.category, 'dns-answer-unattributed');
    assert.equal(control.requestedResolver, '203.0.113.53'); assert.equal(control.receivedAnswer, controlAnswered); assert.equal(control.actualDestinationVerified, false);
  }
});

test('a non-HTTP TCP connection still fails the boundary even when DNS answers have unverified destination attribution', async t => {
  const input = await fixture(t);
  const output = await runEgressProbe(input, { transport: async () => deny(), exec: async request => {
    if (request.probeId === 'platform-resolver') return successExec(request);
    if (DNS_RESOLVERS[request.probeId]) return dnsAnswer(request.probeId);
    return { exitCode: 0, timedOut: false, stdout: JSON.stringify({ status: 'reachable', category: 'tcp-connected' }) };
  } });
  assert.equal(output.passed, false); assert.equal(output.rows.find(row => row.id === 'external-dns').status, 'answered');
  assert.equal(output.supplementaryNetworkReachable, true);
  assert.equal(output.rows.find(row => row.id === 'non-http-port').category, 'tcp-connected');
});

test('a missing or fabricated DNS result cannot confirm either an answer or its actual destination', async t => {
  const input = await fixture(t);
  for (const patch of [{ actualDestinationVerified: true }, { requestedResolver: '9.9.9.9' }, { receivedAnswer: undefined }]) {
    const output = await runEgressProbe(input, { transport: async () => deny(), exec: async request => {
      if (request.probeId !== 'dns-redirect-control') return successExec(request);
      const value = dnsAnswer(request.probeId); value.stdout = JSON.stringify({ ...JSON.parse(value.stdout), ...patch }); return value;
    } });
    const control = output.rows.find(row => row.id === 'dns-redirect-control');
    assert.equal(control.category, 'execution-unconfirmed'); assert.equal(control.actualDestinationVerified, false); assert.equal(control.receivedAnswer, null);
    assert.equal(output.dnsRedirectControlObserved, false); assert.equal(output.supplementaryNetworkReachable, false);
  }
});

test('an OS permission error cannot replace the required tagged same-host handler denial', async t => {
  const input = await fixture(t);
  const output = await runEgressProbe(input, { transport: async () => { throw Object.assign(new Error('synthetic'), { code: 'EPERM' }); }, exec: successExec });
  assert.equal(output.passed, false);
  assert.equal(output.rows.find(row => row.id === 'trusted-management').category, 'os-permission-denied');
});

test('null exit or timedOut cannot become a successful command, and stdout is never exported', async t => {
  const input = await fixture(t);
  for (const patch of [{ exitCode: null }, { timedOut: true }, { signal: 'SIGKILL' }, { stdout: 'raw-synthetic-secret' }]) {
    const output = await runEgressProbe(input, { transport: async () => deny(), exec: async request => ({ ...await successExec(request), ...patch }) });
    assert.equal(output.supplementaryNetworkConfirmed, false);
    assert.equal(output.requiredHttpBoundaryPassed, true);
    assert.equal(output.passed, true, 'supplementary unknown does not replace or undo the proven HTTP boundary');
    assert.ok(output.rows.filter(row => ['external-dns', 'non-http-port'].includes(row.id)).every(row => row.category.endsWith('unconfirmed')));
    assert.ok(!JSON.stringify(output).includes('raw-synthetic-secret'));
  }
});

test('exact SDK 520 host denial is distinct from same-host handler denial and rejects altered bodies', async t => {
  const input = await fixture(t);
  for (const mode of ['exact', 'extra-byte', 'wrong-status', 'same-host']) {
    const output = await runEgressProbe(input, { transport: async request => {
      const offHost = new URL(request.url).hostname !== 'riffology-m0-model-proxy-go-live-staging.jihe-gao.workers.dev';
      if (!offHost && mode !== 'same-host') return deny();
      return new Response(mode === 'extra-byte' ? 'Origin is disallowed\n' : 'Origin is disallowed', { status: mode === 'wrong-status' ? 403 : 520 });
    }, exec: successExec });
    assert.equal(output.passed, mode === 'exact');
    if (mode === 'exact') {
      assert.equal(output.rows.find(row => row.id === 'arbitrary-domain').category, 'sdk-host-policy-denied');
      assert.equal(output.rows.find(row => row.id === 'trusted-management').category, 'policy-denied');
    }
  }
});

test('fixed supplementary targets use non-Cloudflare DNS and a non-DNS TCP port', async t => {
  const input = await fixture(t), commands = [];
  await runEgressProbe(input, { transport: async () => deny(), exec: request => { commands.push(request); return successExec(request); } });
  const program = commands.find(command => command.probeId === 'external-dns').args[1];
  assert.ok(program.includes("id==='external-dns'?'8.8.8.8'")); assert.ok(program.includes("id==='dns-redirect-control'?'203.0.113.53'"));
  assert.ok(program.includes("resolver.setServers([requestedResolver]);resolver.resolve4('example.com'"));
  assert.ok(program.includes("host:'1.1.1.1',port:8443"));
  assert.ok(!program.includes("setServers(['1.1.1.1'])"));
});

test('an uncooperative HTTP transport is cancelled at the fixed item deadline and retained as unknown', { timeout: 6500 }, async t => {
  const input = await fixture(t); let aborted = false, attempts = 0;
  const start = Date.now();
  const output = await runEgressProbe(input, { transport: request => {
    if (request.url.endsWith('/probe/go-live-g0-20260906/status')) {
      attempts++; request.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      return new Promise(() => {});
    }
    return Promise.resolve(deny());
  }, exec: successExec });
  assert.ok(Date.now() - start < 5500); assert.equal(aborted, true); assert.equal(attempts, 1);
  assert.equal(output.rows.find(row => row.id === 'trusted-management').category, 'timeout-unconfirmed');
  assert.equal(output.requiredHttpBoundaryPassed, false); assert.equal(output.passed, false); assert.equal(output.cleanupConfirmed, true);
});

test('unknown input, partial injection, and disabling TLS validation are rejected before any request', async t => {
  const input = await fixture(t); let called = 0;
  const options = { transport: () => { called++; }, exec: () => { called++; } };
  for (const patch of [{ role: 'other' }, { url: 'https://evil.invalid/' }, { command: 'arbitrary' }, { outputDirectory: '/' }]) await assert.rejects(runEgressProbe({ ...input, ...patch }, options));
  await assert.rejects(runEgressProbe(input, { transport: options.transport }));
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try { process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; await assert.rejects(runEgressProbe(input, options), /tls-verification-required/); }
  finally { if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous; }
  assert.equal(called, 0);
});
