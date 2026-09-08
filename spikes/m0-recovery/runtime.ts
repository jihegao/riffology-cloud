/** Fixed, local-only process fixture for the M0 crash/recovery probe. */
export function recoveryRuntimeScript(
  hostModuleUrl = 'file:///opt/riffology/services/runtime/controlled-pi.mjs',
): string {
  const moduleUrl = new URL(hostModuleUrl);
  if (moduleUrl.protocol !== 'file:' || moduleUrl.host || moduleUrl.search || moduleUrl.hash) {
    throw new Error('Recovery host must be a local file module');
  }
  return String.raw`
import { lstatSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { isAbsolute, join, parse } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const HOST_MODULE_URL = ${JSON.stringify(moduleUrl.href)};
const SEED_PROMPT = 'M0_RECOVERY_SEED_PROMPT: record the fixed seed context.';
const SEED_REPLY = 'M0_RECOVERY_SEED_ASSISTANT_CONTEXT';
const LONG_PROMPT = 'M0_RECOVERY_INTERRUPTED_LONG_PROMPT: emit one token then wait for the local fixture.';
const RECOVERY_PROMPT = 'M0_RECOVERY_NEW_PROMPT: continue from the confirmed seed checkpoint only.';
const RECOVERY_REPLY = 'M0_RECOVERY_RECOVERED_REPLY';
const model = { provider: 'riffology-m0-recovery', id: 'local-recovery-fixture' };
const credential = 'm0-local-recovery-non-secret-credential';
const failureCodes = new Set(['invalid_directory', 'invalid_config', 'invalid_snapshot', 'invalid_go',
  'fixture_request_rejected', 'pi_startup_failed', 'pi_turn_failed', 'runtime_deadline', 'runtime_io_failed', 'runtime_failed']);
let directory;
let config;
let host;
let server;
let requestCount = 0;
let phase = 'startup';
let providerRequestId;
let contextRestored = false;
let contextSeenOnRecovery = false;
let terminal = false;
let streamingWritten = false;
let streamStartedAt = null;
const events = new Set();
const delays = new Set();
const lifetime = new AbortController();
const reject = (code) => { const error = new Error(code); error.code = code; throw error; };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, required, optional = [], code = 'invalid_config') {
  if (!object(value) || required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) reject(code);
}
function scope(value, code = 'invalid_config') {
  keys(value, ['tenantId', 'projectId', 'sessionId'], [], code);
  for (const part of Object.values(value)) {
    if (typeof part !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(part)) reject(code);
  }
}
const sameScope = (left, right) => ['tenantId', 'projectId', 'sessionId'].every((key) => left[key] === right[key]);
const isoDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
function textContent(value, expected, code = 'invalid_snapshot') {
  if (typeof value === 'string') { if (value !== expected) reject(code); return; }
  if (!Array.isArray(value) || value.length !== 1) reject(code);
  keys(value[0], ['type', 'text'], [], code);
  if (value[0].type !== 'text' || value[0].text !== expected) reject(code);
}
function validateSnapshot(snapshot, binding) {
  const code = 'invalid_snapshot';
  keys(snapshot, ['format', 'scope', 'createdAt', 'entries', 'leafId'], [], code);
  scope(snapshot.scope, code);
  if (snapshot.format !== 'riffology-pi-session-v1' || !sameScope(snapshot.scope, binding)
    || !isoDate(snapshot.createdAt) || !Array.isArray(snapshot.entries) || snapshot.entries.length !== 4) reject(code);
  const expectedTypes = ['model_change', 'thinking_level_change', 'message', 'message'];
  const seen = new Set();
  let parentId = null;
  for (const [index, entry] of snapshot.entries.entries()) {
    const fields = index === 0 ? ['provider', 'modelId'] : index === 1 ? ['thinkingLevel'] : ['message'];
    keys(entry, ['type', 'id', 'parentId', 'timestamp', ...fields], [], code);
    if (entry.type !== expectedTypes[index] || typeof entry.id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(entry.id)
      || seen.has(entry.id) || entry.parentId !== parentId || !isoDate(entry.timestamp)) reject(code);
    seen.add(entry.id);
    parentId = entry.id;
    if (index === 0 && (entry.provider !== model.provider || entry.modelId !== model.id)) reject(code);
    if (index === 1 && entry.thinkingLevel !== 'off') reject(code);
    if (index < 2) continue;
    const message = entry.message;
    if (index === 2) {
      keys(message, ['role', 'content', 'timestamp'], [], code);
      if (message.role !== 'user') reject(code);
      textContent(message.content, SEED_PROMPT);
    } else {
      keys(message, ['role', 'content', 'api', 'provider', 'model', 'usage', 'stopReason', 'timestamp'],
        ['responseId', 'responseModel', 'rawStopReason'], code);
      if (message.role !== 'assistant' || message.api !== 'openai-completions' || message.provider !== model.provider
        || message.model !== model.id || message.stopReason !== 'stop'
        || (message.responseId !== undefined && message.responseId !== 'chatcmpl-m0-recovery-seed')
        || (message.responseModel !== undefined && message.responseModel !== model.id)
        || (message.rawStopReason !== undefined && message.rawStopReason !== 'stop')) reject(code);
      textContent(message.content, SEED_REPLY);
      keys(message.usage, ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens', 'cost'], ['reasoning'], code);
      const { cost, ...tokens } = message.usage;
      if (Object.values(tokens).some((value) => !Number.isSafeInteger(value) || value < 0)) reject(code);
      keys(cost, ['input', 'output', 'cacheRead', 'cacheWrite', 'total'], [], code);
      if (Object.values(cost).some((value) => value !== 0)) reject(code);
    }
    if (!Number.isSafeInteger(message.timestamp) || message.timestamp <= 0) reject(code);
  }
  if (snapshot.leafId !== parentId || JSON.stringify(snapshot).includes(credential)) reject(code);
}
function atomic(name, value) {
  if (!directory) return;
  const target = join(directory, name);
  const temporary = join(directory, '.' + name + '.' + randomUUID() + '.tmp');
  try {
    writeFileSync(temporary, JSON.stringify(value) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, target);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function status(stage, errorCode) {
  atomic('status.json', {
    schemaVersion: 1, generation: config?.generation ?? 0, stage, requestCount,
    contextRestored, contextSeenOnRecovery, streamStartedAt,
    ...(providerRequestId ? { providerRequestId } : {}), eventTypes: [...events].sort(),
    ...(errorCode ? { errorCode } : {}),
  });
}
function inputFile(name, maxBytes, code) {
  const path = join(directory, name);
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maxBytes) reject(code);
  return readFileSync(path, 'utf8');
}
function readConfig() {
  const candidate = process.env.M0_RECOVERY_DIR;
  if (!candidate || !isAbsolute(candidate) || candidate === parse(candidate).root) reject('invalid_directory');
  const metadata = lstatSync(candidate);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) reject('invalid_directory');
  directory = candidate;
  let value;
  try { value = JSON.parse(inputFile('config.json', 1024 * 1024, 'invalid_config')); }
  catch { reject('invalid_config'); }
  keys(value, ['generation', 'scope', 'mode'], ['snapshot']);
  if (!Number.isSafeInteger(value.generation) || value.generation < 1
    || !['initial', 'recovery'].includes(value.mode)) reject('invalid_config');
  scope(value.scope);
  if (value.mode === 'initial' ? Object.hasOwn(value, 'snapshot') : !Object.hasOwn(value, 'snapshot')) reject('invalid_config');
  config = { ...value, scope: { tenantId: value.scope.tenantId, projectId: value.scope.projectId, sessionId: value.scope.sessionId } };
  if (config.mode === 'recovery') validateSnapshot(config.snapshot, config.scope);
  for (const name of ['seed.json', 'status.json', 'final.json']) {
    try { lstatSync(join(directory, name)); reject('invalid_directory'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
async function waitForGo() {
  for (;;) {
    lifetime.signal.throwIfAborted();
    try {
      if (inputFile('go', 2, 'invalid_go') !== 'ok') reject('invalid_go');
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') reject(error.code === 'invalid_go' ? 'invalid_go' : 'runtime_io_failed');
    }
    await sleep(25, undefined, { signal: lifetime.signal });
  }
}
function requestText(message) {
  return typeof message?.content === 'string' ? message.content
    : Array.isArray(message?.content) ? message.content.map((part) => part.text ?? '').join('') : '';
}
async function serve(req, res) {
  try {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions'
      || req.headers.authorization !== 'Bearer ' + credential) reject('fixture_request_rejected');
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 256 * 1024) reject('fixture_request_rejected');
    }
    const request = JSON.parse(body);
    if (request.model !== model.id || request.stream !== true || !Array.isArray(request.messages)
      || (request.tools && request.tools.length !== 0)) reject('fixture_request_rejected');
    const messages = request.messages.filter((message) => message.role !== 'system' && message.role !== 'developer');
    const expectedPrompt = phase === 'seed' ? SEED_PROMPT : phase === 'long' ? LONG_PROMPT : phase === 'recovery' ? RECOVERY_PROMPT : null;
    if (!expectedPrompt || messages.at(-1)?.role !== 'user' || requestText(messages.at(-1)) !== expectedPrompt
      || requestCount !== (phase === 'long' ? 1 : 0)) reject('fixture_request_rejected');
    if (phase === 'seed') {
      if (messages.length !== 1) reject('fixture_request_rejected');
    } else {
      if (messages.length !== 3 || messages[0].role !== 'user' || requestText(messages[0]) !== SEED_PROMPT
        || messages[1].role !== 'assistant' || requestText(messages[1]) !== SEED_REPLY) reject('fixture_request_rejected');
      if (phase === 'recovery') {
        if (body.includes(LONG_PROMPT)) reject('fixture_request_rejected');
        contextSeenOnRecovery = true;
      }
    }
    requestCount += 1;
    providerRequestId = 'm0-recovery-fixture-g' + config.generation + '-r' + requestCount;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': providerRequestId });
    const chunk = (delta, finish_reason = null, usage) => res.write('data: ' + JSON.stringify({
      id: 'chatcmpl-m0-recovery-' + phase, object: 'chat.completion.chunk', created: 1, model: model.id,
      choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
    }) + '\n\n');
    chunk({ role: 'assistant' });
    chunk({ content: phase === 'seed' ? SEED_REPLY : phase === 'recovery' ? RECOVERY_REPLY : 'M0_RECOVERY_LONG_FIRST_TOKEN' });
    if (phase === 'long') {
      await new Promise((resolve) => {
        const timer = setTimeout(() => { delays.delete(timer); resolve(); }, 12000);
        delays.add(timer);
        res.once('close', () => { clearTimeout(timer); delays.delete(timer); resolve(); });
      });
      if (res.destroyed || terminal) return;
      if (streamStartedAt === null) reject('pi_turn_failed');
      // The observable window starts when Pi receives its first text delta,
      // which can be slightly later than this server writing the SSE chunk.
      const remaining = streamStartedAt + 12000 - Date.now();
      if (remaining > 0) await sleep(remaining, undefined, { signal: lifetime.signal });
      if (res.destroyed || terminal) return;
      chunk({ content: ' M0_RECOVERY_LONG_COMPLETED' });
    }
    chunk({}, 'stop', { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 });
    res.end('data: [DONE]\n\n');
  } catch {
    if (!res.headersSent) res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'fixture_request_rejected' } }));
    stopNow('fixture_request_rejected');
  }
}
function stopNow(code) {
  if (terminal) return;
  terminal = true;
  lifetime.abort();
  try { status('failed', failureCodes.has(code) ? code : 'runtime_failed'); } catch {}
  for (const timer of delays) clearTimeout(timer);
  server?.closeAllConnections();
  server?.close();
  process.stderr.write('m0_recovery_runtime_failed\n');
  // Give a cooperative Pi session time to dispose; the outer deadline still
  // terminates the entire process at 60 s, including during cleanup.
  setTimeout(() => process.exit(1), 1000);
  void Promise.resolve(host?.dispose()).catch(() => {}).finally(() => process.exit(1));
}
const deadline = setTimeout(() => { stopNow('runtime_deadline'); process.exit(1); }, 60000);
try {
  readConfig();
  const { createControlledPiSession } = await import(HOST_MODULE_URL);
  server = createServer((req, res) => { void serve(req, res); });
  await new Promise((resolve, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.on('error', () => stopNow('runtime_failed'));
  try {
    host = await createControlledPiSession({
      trustedCwd: directory, scope: config.scope, selectedModel: model, allowedModels: [model],
      providerDefinitions: [{ provider: model.provider, config: {
        api: 'openai-completions', baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1',
        models: [{ id: model.id, name: 'M0 local recovery fixture', reasoning: false, input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16384, maxTokens: 128 }],
      } }],
      resolveCredential: async () => credential,
      systemPrompt: 'You are the fixed M0 local recovery fixture. No tools are available.',
      cancellationGraceMs: 1000,
      ...(config.mode === 'recovery' ? { snapshot: config.snapshot } : {}),
    });
  } catch { reject(config.mode === 'recovery' ? 'invalid_snapshot' : 'pi_startup_failed'); }
  host.subscribe((event) => {
    events.add(event.type);
    if (!terminal && phase === 'long' && event.type === 'message_update'
      && event.assistantMessageEvent?.type === 'text_delta' && !streamingWritten) {
      streamingWritten = true;
      streamStartedAt = Date.now();
      try { status('streaming'); } catch { stopNow('runtime_io_failed'); }
    }
  });
  if (host.inspect().tools.length !== 0 || host.inspect().extensions !== 0) reject('pi_startup_failed');
  if (config.mode === 'initial') {
    phase = 'seed';
    if ((await host.prompt(SEED_PROMPT)).outcome !== 'completed' || requestCount !== 1) reject('pi_turn_failed');
  } else {
    const history = host.inspect().messages;
    if (history.length !== 2 || history[0].role !== 'user' || history[1].role !== 'assistant') reject('invalid_snapshot');
    textContent(history[0].content, SEED_PROMPT);
    textContent(history[1].content, SEED_REPLY);
    if (requestCount !== 0) reject('fixture_request_rejected');
  }
  // Preserve the injected checkpoint's serialization as well as its history.
  const seed = config.mode === 'recovery' ? config.snapshot : host.snapshot();
  validateSnapshot(seed, config.scope);
  contextRestored = config.mode === 'recovery';
  atomic('seed.json', seed);
  status('ready');
  await waitForGo();
  phase = config.mode === 'initial' ? 'long' : 'recovery';
  if ((await host.prompt(phase === 'long' ? LONG_PROMPT : RECOVERY_PROMPT)).outcome !== 'completed'
    || requestCount !== (config.mode === 'initial' ? 2 : 1)
    || (config.mode === 'initial' ? !streamingWritten : !contextSeenOnRecovery)) reject('pi_turn_failed');
  atomic('final.json', host.snapshot());
  status('completed');
  await host.dispose();
  for (const timer of delays) clearTimeout(timer);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  terminal = true;
  clearTimeout(deadline);
} catch (error) {
  stopNow(error?.code);
}
`;
}
