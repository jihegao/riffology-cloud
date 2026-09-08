import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Build-time check of the actual child executable; never uses a provider credential.
// The Dockerfile runs this step with --network=none in addition to the fake fetch below.
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const directory = mkdtempSync(resolve(tmpdir(), 'riffology-image-check-'));
const token = 'synthetic-image-check-capability-aaaaaaaaaaaaaaaaaaaa';
const scope = { tenantId: 'image-tenant', projectId: 'image-project', sessionId: '11111111-1111-4111-8111-111111111111' };
const preload = resolve(directory, 'fixture.mjs');
const fixture = `
import assert from 'node:assert/strict';
let calls = 0;
globalThis.fetch = async request => {
  calls++;
  assert.equal(calls, 1);
  assert.equal(request.url, 'https://riffology-m0-model-proxy-staging.jihe-gao.workers.dev/v1/chat/completions');
  assert.equal(request.method, 'POST'); assert.equal(request.redirect, 'manual');
  assert.equal(request.headers.get('authorization'), 'Bearer ${token}');
  const body = await request.clone().json();
  assert.equal(body.model, 'm0-text-fixture'); assert.equal(body.max_tokens, 32);
  assert.deepEqual(body.thinking, {type:'disabled'});
  const frame = (delta, finish, usage) => 'data: ' + JSON.stringify({id:'image-fixture',object:'chat.completion.chunk',model:'m0-text-fixture',choices:[{index:0,delta,finish_reason:finish}],...(usage?{usage}: {})}) + '\\n\\n';
  const response = new Response(frame({content:'image-fixture-ok'},null) + frame({},'stop',{prompt_tokens:10,completion_tokens:1,total_tokens:11}) + 'data: [DONE]\\n\\n', {headers:{'content-type':'text/event-stream','x-riffology-m0-mode':'fixture-only','x-riffology-request-id':'image-platform-id'}});
  Object.defineProperty(response,'url',{value:request.url});
  return response;
};
`;
const run = (snapshot, prompt) => {
  const child = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href,
    resolve(root, 'scripts/m0/proxy-pi-child.mjs'), '--staging-fixture'], {
    cwd: root, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, input: JSON.stringify({
      scope, snapshot, prompt, trustedCwd: directory, cancelOnDelta: false,
      invocation: { runId: 'image-check-run', callId: snapshot ? 'call-2' : 'call-1', token, scope, expiresAtMs: Date.now() + 30000 },
    }), encoding: 'utf8', timeout: 20000, maxBuffer: 131072, killSignal: 'SIGKILL',
  });
  assert.equal(child.status, 0, 'image diagnostic child must complete');
  assert.equal(child.stderr, ''); assert.ok(!child.stdout.includes(token));
  const result = JSON.parse(child.stdout);
  assert.equal(result.outcome, 'completed'); assert.equal(result.defaultFetchCalls, 0);
  assert.equal(result.modelTransportAttempts, 1); assert.equal(result.requests.length, 1);
  assert.equal(result.duplicatePromptRejected, true);
  return result;
};
try {
  writeFileSync(preload, fixture, { mode: 0o600, flag: 'wx' });
  const first = run(undefined, 'Remember image-marker.');
  const restored = run(first.snapshot, 'Continue.');
  assert.notEqual(first.pid, restored.pid);
  const history = restored.requests[0].body.messages;
  assert.equal(history.find(m => m.role === 'user').content, 'Remember image-marker.');
  assert.equal(history.find(m => m.role === 'assistant').content, 'image-fixture-ok');
  assert.equal(history.at(-1).content, 'Continue.');
  assert.ok(history[0].content.includes('Fixed simulation diagnostic skill.'));
  const sdkVersion = JSON.parse(readFileSync(resolve(root, 'node_modules/@earendil-works/pi-coding-agent/package.json'))).version;
  assert.equal(sdkVersion, '0.85.0');
  console.log(JSON.stringify({ passed: true, scope: 'image-offline-sdk-and-staging-fixture-entrypoint',
    platform: process.platform, architecture: process.arch, sdkVersion, childCalls: 2,
    transport: 'in-process-synthetic-fetch', realProviderCalls: 0, cloudGatePassed: false }));
} finally { rmSync(directory, { recursive: true, force: true }); }
