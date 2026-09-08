import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RELEASE_MODULE, runTrustedPiTurnHost } from '../../services/trusted-pi/trusted-pi-turn-host.mjs';

const identity = { scope: { tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'workspace-a', workspaceGeneration: 2 }, sessionId: 'session-a', turnId: 'turn-a', dispatchId: 'dispatch-a', generation: 2 };
const actor = { userId: 'user-a', authVersion: 1 };
const snapshot = { format: 'riffology-pi-session-v1', scope: { tenantId: 'tenant-a', projectId: 'project-a', sessionId: 'session-a' }, createdAt: '2026-09-07T00:00:00.000Z', entries: [], leafId: null };
const artifact = { schemaVersion: 1, artifactId: `artifact-${'a'.repeat(60)}`, operation: 'list', mediaType: 'application/json', bytes: 20000, sha256: 'b'.repeat(64), createdAt: 1000 };
const sha = (value) => createHash('sha256').update(value).digest('hex');
const token = () => sha(Buffer.from(JSON.stringify({ schemaVersion: 1, purpose: 'trusted-pi-native', identity }))).slice(0, 52);
async function fixture(t, restored = false, toolResult = { content: [{ type: 'text', text: JSON.stringify({ kind: 'artifact', artifact }) }], details: { operation: 'list', status: 'completed' } }) {
  const root = await mkdtemp(join(tmpdir(), 'riffology-trusted-pi-host-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = token(), prefix = join(root, id), session = Buffer.from(JSON.stringify(snapshot));
  await writeFile(`${prefix}.control.json`, JSON.stringify({ schemaVersion: 1, identity, actor, message: 'Build model', inputSessionSha256: restored ? sha(session) : null }));
  if (restored) await writeFile(`${prefix}.input-session.json`, session);
  const calls = [], listeners = new Set();
  const host = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async prompt(message) {
      calls.push(message);
      for (const listener of listeners) listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'done' } });
      for (const listener of listeners) listener({ type: 'tool_execution_start', toolCallId: 'call-a', toolName: 'project_list' });
      for (const listener of listeners) listener({ type: 'tool_execution_update', toolCallId: 'call-a', toolName: 'project_list' });
      for (const listener of listeners) listener({ type: 'tool_execution_end', toolCallId: 'call-a', toolName: 'project_list', isError: false, result: toolResult });
      for (const listener of listeners) listener({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' } });
      return { outcome: 'completed', stopReason: 'stop' };
    },
    snapshot() { return structuredClone(snapshot); },
    async cancel() {}, async dispose() {},
  };
  const created = [];
  const release = { async resolveOptions(input) { assert.deepEqual(input, { identity, actor }); return { selectedModel: { provider: 'release', id: 'fixed' }, allowedModels: [{ provider: 'release', id: 'fixed' }], resolveCredential: async () => 'injected', systemPrompt: 'fixed' }; } };
  const createSession = async (options) => { created.push(options); return host; };
  return { root, id, prefix, calls, created, release, createSession };
}

test('runs one controlled facade turn and writes terminal result after frozen session', async (t) => {
  const f = await fixture(t, true); let now = 1000;
  const terminal = await runTrustedPiTurnHost(f.id, f.release, { controlRoot: f.root, createSession: f.createSession, clock: () => ++now });
  assert.equal(terminal.outcome, 'completed'); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.created[0].scope, snapshot.scope); assert.deepEqual(f.created[0].snapshot, snapshot);
  const result = JSON.parse(await readFile(`${f.prefix}.result.json`, 'utf8'));
  assert.deepEqual(result.events.map((event) => event.kind), ['assistant.delta', 'tool.started', 'tool.updated', 'tool.completed', 'assistant.message']);
  assert.deepEqual(result.events.map((event) => event.sequence), [1, 2, 3, 4, 5]);
  assert.deepEqual(result.events[3].artifact, artifact);
  const output = Buffer.from(await readFile(`${f.prefix}.output-session.json`, 'utf8'), 'base64');
  assert.equal(sha(output), result.outputSessionSha256); assert.deepEqual(JSON.parse(output), snapshot);
});

test('omits ordinary inline results and fails the turn closed on a forged artifact receipt', async (t) => {
  const inline = await fixture(t, false, { content: [{ type: 'text', text: JSON.stringify({ kind: 'list', entries: [] }) }], details: { operation: 'list', status: 'completed' } });
  const inlineResult = await runTrustedPiTurnHost(inline.id, inline.release, { controlRoot: inline.root, createSession: inline.createSession, clock: () => 1001 });
  assert.equal(inlineResult.outcome, 'completed');
  assert.equal(inlineResult.events.find(event => event.kind === 'tool.completed').artifact, null);

  const forged = await fixture(t, false, { content: [{ type: 'text', text: JSON.stringify({ kind: 'artifact', artifact: { ...artifact, artifactId: '../object-key' } }) }], details: { operation: 'list', status: 'completed' } });
  const forgedResult = await runTrustedPiTurnHost(forged.id, forged.release, { controlRoot: forged.root, createSession: forged.createSession, clock: () => 1001 });
  assert.equal(forgedResult.outcome, 'failed');
  assert.equal(forgedResult.events.some(event => event.kind === 'tool.completed'), false);
  assert.doesNotMatch(JSON.stringify(forgedResult), /object-key/);
});

test('rejects forged token, input digest and cross-session snapshots before creating Pi', async (t) => {
  const forged = await fixture(t, true);
  await assert.rejects(runTrustedPiTurnHost('0'.repeat(52), forged.release, { controlRoot: forged.root, createSession: forged.createSession }), /ENOENT/);
  await writeFile(`${forged.prefix}.input-session.json`, '{}');
  await assert.rejects(runTrustedPiTurnHost(forged.id, forged.release, { controlRoot: forged.root, createSession: forged.createSession }), /session-file/);
  assert.equal(forged.created.length, 0);
  const scoped = await fixture(t, true), changed = { ...snapshot, scope: { ...snapshot.scope, sessionId: 'session-b' } }, bytes = Buffer.from(JSON.stringify(changed));
  await writeFile(`${scoped.prefix}.input-session.json`, bytes);
  const control = JSON.parse(await readFile(`${scoped.prefix}.control.json`, 'utf8')); control.inputSessionSha256 = sha(bytes); await writeFile(`${scoped.prefix}.control.json`, JSON.stringify(control));
  await assert.rejects(runTrustedPiTurnHost(scoped.id, scoped.release, { controlRoot: scoped.root, createSession: scoped.createSession }), /scope-denied/);
  assert.equal(scoped.created.length, 0);
});

test('project control cannot supply model, system prompt, tools or release callbacks', async (t) => {
  const f = await fixture(t);
  const control = JSON.parse(await readFile(`${f.prefix}.control.json`, 'utf8')); control.selectedModel = { provider: 'evil', id: 'evil' };
  await writeFile(`${f.prefix}.control.json`, JSON.stringify(control));
  await assert.rejects(runTrustedPiTurnHost(f.id, f.release, { controlRoot: f.root, createSession: f.createSession }), /control/);
  assert.equal(f.created.length, 0);
});

test('provider hooks stay platform-controlled and a prompt exception freezes a failed terminal', async (t) => {
  const f = await fixture(t), responses = [];
  f.release.resolveOptions = async () => ({
    selectedModel: { provider: 'release', id: 'fixed' }, allowedModels: [{ provider: 'release', id: 'fixed' }],
    resolveCredential: async () => 'injected', systemPrompt: 'fixed',
    snapshot: { ...snapshot, scope: { ...snapshot.scope, sessionId: 'release-supplied' } },
    onProviderPayload: async ({ payload }) => ({ ...payload, approved: true }),
    onProviderResponse: async ({ status }) => responses.push(status),
  });
  f.createSession = async (options) => {
    f.created.push(options);
    return {
      subscribe() { return () => {}; },
      async prompt() {
        assert.deepEqual(await options.onProviderPayload({ payload: { request: 1 } }), { request: 1, approved: true });
        await options.onProviderResponse({ status: 503, headers: { 'x-request-id': 'request-a' } });
        throw new Error('credential or provider detail must not be persisted');
      },
      snapshot() { return structuredClone(snapshot); }, async cancel() {}, async dispose() {},
    };
  };
  const terminal = await runTrustedPiTurnHost(f.id, f.release, { controlRoot: f.root, createSession: f.createSession, clock: () => 1001 });
  assert.equal(f.created[0].snapshot, undefined);
  assert.equal(terminal.outcome, 'failed'); assert.equal(terminal.executionErrorCode, 'pi-turn-failed'); assert.deepEqual(responses, [503]);
  assert.deepEqual(terminal.events.map((event) => [event.kind, event.state, event.status, event.requestId]), [
    ['provider.status', 'requesting', null, null], ['provider.status', 'error', 503, 'request-a'],
  ]);
  assert.doesNotMatch(JSON.stringify(terminal), /credential or provider detail/);
});

test('module uses only the controlled Pi facade and no M0 probe or proxy implementation', async () => {
  assert.equal(RELEASE_MODULE, '/opt/riffology/trusted-pi/trusted-pi-release.mjs');
  const source = await readFile(new URL('../../services/trusted-pi/trusted-pi-turn-host.mjs', import.meta.url), 'utf8');
  assert.match(source, /createControlledPiSession/);
  assert.doesNotMatch(source, /proxy-pi|go-pi-probe|M0_|OPENCODE_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY/);
});
