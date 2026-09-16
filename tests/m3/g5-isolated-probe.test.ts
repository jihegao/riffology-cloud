import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { G5_PROBE_CONTRACT, createG5ProbeHandler } from '../../services/g5-probe/index.ts';

const env = {
  PRODUCTION_OPENAI_API_KEY: 'provider-secret-value-for-tests',
  PRODUCTION_AI_GATEWAY_TOKEN: 'gateway-secret-value-for-tests',
  G5_PROBE_OPERATOR_CAPABILITY: 'operator-secret-value-for-tests',
};

function request(path = '/probe', init: RequestInit = {}): Request {
  const value = new Request(`${G5_PROBE_CONTRACT.origin}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.G5_PROBE_OPERATOR_CAPABILITY}`, ...init.headers },
    ...init,
  });
  Object.defineProperty(value, 'cf', { value: { colo: 'SJC' } });
  return value;
}

async function output(response: Response): Promise<Record<string, unknown>> {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json() as Promise<Record<string, unknown>>;
}

test('only the exact authorized empty POST /probe route is observable', async () => {
  let calls = 0;
  const handler = createG5ProbeHandler({ fetchImpl: async () => { calls += 1; return Response.json({ data: [] }); } });
  const cases = [
    request('/missing'),
    request('/probe?debug=1'),
    request('/probe', { method: 'GET' }),
    request('/probe', { body: 'x' }),
    request('/probe', { headers: { authorization: 'Bearer wrong-value-with-safe-length' } }),
    new Request('https://other.example/probe', { method: 'POST', headers: { authorization: `Bearer ${env.G5_PROBE_OPERATOR_CAPABILITY}` } }),
  ];
  for (const candidate of cases) {
    const response = await handler(candidate, env);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'not found');
  }
  assert.equal(calls, 0);
});

test('model success uses the fixed Gateway GET contract and returns only whitelisted evidence', async () => {
  let sentUrl = '';
  let sentInit: RequestInit | undefined;
  const handler = createG5ProbeHandler({ fetchImpl: async (url, init) => {
    sentUrl = String(url);
    sentInit = init;
    return Response.json({ object: 'list', data: [{ id: 'gpt-5.6-luna' }, { id: 'other' }], secret: 'raw-upstream-secret' });
  } });
  const result = await output(await handler(request(), env));
  assert.equal(sentUrl, 'https://gateway.ai.cloudflare.com/v1/8b0d70250211aa10d89e20605a1c7e5e/riffology-g5-region-probe-20260916/openai/models');
  assert.equal(sentInit?.method, 'GET');
  assert.equal(sentInit?.redirect, 'manual');
  assert.equal(sentInit?.body, undefined);
  assert.ok(sentInit?.signal instanceof AbortSignal);
  const headers = Object.fromEntries(new Headers(sentInit?.headers).entries());
  assert.deepEqual(headers, {
    accept: 'application/json',
    authorization: `Bearer ${env.PRODUCTION_OPENAI_API_KEY}`,
    'cf-aig-authorization': `Bearer ${env.PRODUCTION_AI_GATEWAY_TOKEN}`,
    'cf-aig-cache-ttl': '0',
    'cf-aig-collect-log': 'false',
    'cf-aig-collect-log-payload': 'false',
    'cf-aig-max-attempts': '1',
    'cf-aig-skip-cache': 'true',
  });
  assert.deepEqual(result, {
    version: 'g5-region-probe-us-east-v1', gateway: 'riffology-g5-region-probe-20260916', model: 'gpt-5.6-luna', colo: 'SJC', executionPlacement:null,
    status: 200, state: 'model-available', errorCode: null, modelAvailable: true, inferenceCalls: 0,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('8b0d70250211aa10d89e20605a1c7e5e'), false);
  assert.equal(serialized.includes('raw-upstream-secret'), false);
  assert.equal(serialized.includes(env.PRODUCTION_OPENAI_API_KEY), false);
  assert.equal(serialized.includes(env.PRODUCTION_AI_GATEWAY_TOKEN), false);
});

test('region rejection is classified without returning raw provider details', async () => {
  const handler = createG5ProbeHandler({ fetchImpl: async () => Response.json({
    error: { code: 'unsupported_country_region_territory', message: 'raw location and credential detail' },
  }, { status: 403, headers: { 'x-sensitive': 'do-not-copy' } }) });
  const result = await output(await handler(request(), env));
  assert.deepEqual(result, {
    version: 'g5-region-probe-us-east-v1', gateway: 'riffology-g5-region-probe-20260916', model: 'gpt-5.6-luna', colo: 'SJC', executionPlacement:null,
    status: 403, state: 'region-blocked', errorCode: 'unsupported-country-region-territory', modelAvailable: false, inferenceCalls: 0,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('raw location'), false);
  assert.equal(serialized.includes('do-not-copy'), false);
});

test('redirects are observed but never followed', async () => {
  let calls = 0;
  const handler = createG5ProbeHandler({ fetchImpl: async (_url, init) => {
    calls += 1;
    assert.equal(init?.redirect, 'manual');
    return new Response('redirect-secret', { status: 307, headers: { location: 'https://sensitive.example/path' } });
  } });
  const result = await output(await handler(request(), env));
  assert.equal(calls, 1);
  assert.equal(result.state, 'redirect-rejected');
  assert.equal(result.status, 307);
  assert.equal(JSON.stringify(result).includes('sensitive.example'), false);
});

test('responses above 64 KiB are cancelled and reduced to a safe result', async () => {
  let cancelled = false;
  const oversized = new Uint8Array(G5_PROBE_CONTRACT.maxResponseBytes + 1).fill(65);
  const handler = createG5ProbeHandler({ fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(oversized); },
    cancel() { cancelled = true; },
  }), { status: 200 }) });
  const result = await output(await handler(request(), env));
  assert.equal(cancelled, true);
  assert.equal(result.state, 'body-limit-exceeded');
  assert.equal(result.errorCode, 'upstream-body-limit-exceeded');
  assert.equal(JSON.stringify(result).includes('AAAA'), false);
});

test('Wrangler package declares only three secret names and no resource bindings', async () => {
  const config = JSON.parse(await readFile(new URL('../../infra/wrangler.g5-probe.jsonc', import.meta.url), 'utf8')) as Record<string, unknown>;
  assert.equal(config.name, 'riffology-g5-region-probe-us-east-20260916');
  assert.deepEqual(config.placement, {region:'aws:us-east-1'});
  assert.equal(config.workers_dev, true);
  assert.deepEqual(config.compatibility_flags, ['global_fetch_strictly_public']);
  assert.deepEqual(config.secrets, { required: ['PRODUCTION_OPENAI_API_KEY', 'PRODUCTION_AI_GATEWAY_TOKEN', 'G5_PROBE_OPERATOR_CAPABILITY'] });
  assert.deepEqual(Object.keys(config).sort(), ['$schema', 'account_id', 'compatibility_date', 'compatibility_flags', 'main', 'name', 'placement', 'preview_urls', 'secrets', 'workers_dev']);
  assert.equal(G5_PROBE_CONTRACT.timeoutMs, 10_000);
});
