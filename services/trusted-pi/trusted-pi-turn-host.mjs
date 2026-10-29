import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createControlledPiSession } from '../runtime/controlled-pi.mjs';
import { validateResourceProvenance } from '../project-resources/text.mjs';

export const CONTROL_ROOT = '/var/lib/riffology/turns';
export const RELEASE_MODULE = '/opt/riffology/trusted-pi/trusted-pi-release.mjs';
const TOKEN = /^[a-f0-9]{52}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const TOOL_CALL_ID = /^[A-Za-z0-9_-]{1,128}(?:\|[A-Za-z0-9_-]{1,128})?$/;
const SHA = /^[a-f0-9]{64}$/;
const ARTIFACT_ID = /^artifact-[a-f0-9]{60}$/;
const ARTIFACT_OPERATIONS = new Set(['read', 'list', 'search']);
const MAX_CONTROL_BYTES = 64 * 1024;
const MAX_SESSION_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS = 2048;
const MAX_TEXT_BYTES = 15_000;
const TERMINATION_GRACE_MS = 31_000;
const encoder = new TextEncoder();

function fail(code) { throw new Error(code); }
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) fail(code);
}
function id(value) { if (typeof value !== 'string' || !ID.test(value)) fail('invalid-trusted-pi-control'); return value; }
function toolCallId(value) { if (typeof value !== 'string' || !TOOL_CALL_ID.test(value)) fail('invalid-trusted-pi-tool-call-id'); return value; }
function positive(value) { if (!Number.isSafeInteger(value) || value < 1) fail('invalid-trusted-pi-control'); return value; }
function boundedText(value, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.length)
    || encoder.encode(value).byteLength > MAX_TEXT_BYTES
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('trusted-pi-host-event-limit');
  return value;
}
function toolName(value) { if (typeof value !== 'string' || !/^project_[a-z0-9_]{1,64}$/.test(value)) fail('trusted-pi-host-event-limit'); return value; }
function artifactReceipt(value) {
  exact(value, ['schemaVersion', 'artifactId', 'operation', 'mediaType', 'bytes', 'sha256', 'createdAt'], 'invalid-trusted-pi-artifact-event');
  if (value.schemaVersion !== 1 || typeof value.artifactId !== 'string' || !ARTIFACT_ID.test(value.artifactId)
    || typeof value.operation !== 'string' || !ARTIFACT_OPERATIONS.has(value.operation)
    || value.mediaType !== 'application/json' || !Number.isSafeInteger(value.bytes) || value.bytes <= 16384 || value.bytes > 1024 * 1024 + 64 * 1024
    || typeof value.sha256 !== 'string' || !SHA.test(value.sha256) || !Number.isSafeInteger(value.createdAt) || value.createdAt < 1) {
    fail('invalid-trusted-pi-artifact-event');
  }
  return { schemaVersion: 1, artifactId: value.artifactId, operation: value.operation, mediaType: 'application/json', bytes: value.bytes, sha256: value.sha256, createdAt: value.createdAt };
}
function artifactFromToolResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  if (!Array.isArray(value.content) || value.content.length !== 1) return null;
  const part = value.content[0];
  if (!part || typeof part !== 'object' || Array.isArray(part) || Object.getPrototypeOf(part) !== Object.prototype
    || Object.keys(part).length !== 2 || part.type !== 'text' || typeof part.text !== 'string'
    || encoder.encode(part.text).byteLength > 64 * 1024) return null;
  let parsed;
  try { parsed = JSON.parse(part.text); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.kind !== 'artifact') return null;
  exact(parsed, ['kind', 'artifact'], 'invalid-trusted-pi-artifact-event');
  return artifactReceipt(parsed.artifact);
}
function identity(value) {
  exact(value, ['scope', 'sessionId', 'turnId', 'dispatchId', 'generation'], 'invalid-trusted-pi-control');
  exact(value.scope, ['tenantId', 'projectId', 'workspaceId', 'workspaceGeneration'], 'invalid-trusted-pi-control');
  const scope = {
    tenantId: id(value.scope.tenantId), projectId: id(value.scope.projectId),
    workspaceId: id(value.scope.workspaceId), workspaceGeneration: positive(value.scope.workspaceGeneration),
  };
  const generation = positive(value.generation);
  if (generation !== scope.workspaceGeneration) fail('invalid-trusted-pi-control');
  return { scope, sessionId: id(value.sessionId), turnId: id(value.turnId), dispatchId: id(value.dispatchId), generation };
}
function actor(value) {
  exact(value, ['userId', 'authVersion'], 'invalid-trusted-pi-control');
  return { userId: id(value.userId), authVersion: positive(value.authVersion) };
}
function control(value) {
  const version=value?.schemaVersion;
  exact(value, ['schemaVersion', 'identity', 'actor', 'message', 'inputSessionSha256',...(version===2?['executionDeadlineAt']:[])], 'invalid-trusted-pi-control');
  if (![1,2].includes(version) || typeof value.message !== 'string' || value.message.length < 1
    || value.message.length > 16000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.message)
    || (value.inputSessionSha256 !== null && (typeof value.inputSessionSha256 !== 'string' || !SHA.test(value.inputSessionSha256)))) {
    fail('invalid-trusted-pi-control');
  }
  return { schemaVersion: version, identity: identity(value.identity), actor: actor(value.actor), message: value.message, inputSessionSha256: value.inputSessionSha256,...(version===2?{executionDeadlineAt:positive(value.executionDeadlineAt)}:{}) };
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function nativeToken(value) {
  return sha(Buffer.from(JSON.stringify({ schemaVersion: 1, purpose: 'trusted-pi-native', identity: value }))).slice(0, 52);
}
function paths(token, root = CONTROL_ROOT) {
  const prefix = `${root}/${token}`;
  return { control: `${prefix}.control.json`, input: `${prefix}.input-session.json`, result: `${prefix}.result.json`, output: `${prefix}.output-session.json` };
}
async function readBounded(path, maxBytes, optional = false) {
  let bytes;
  try { bytes = await readFile(path); }
  catch (error) { if (optional && error?.code === 'ENOENT') return null; throw error; }
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) fail('invalid-trusted-pi-host-file');
  return bytes;
}
async function atomicWrite(path, content) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}
function parseSnapshot(bytes, expected) {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('invalid-trusted-pi-session-file'); }
  const hasResources = value !== null && typeof value === 'object' && Object.hasOwn(value, 'resources');
  exact(value, ['format', 'scope', 'createdAt', 'entries', 'leafId', ...(hasResources ? ['resources'] : [])], 'invalid-trusted-pi-session-file');
  exact(value.scope, ['tenantId', 'projectId', 'sessionId'], 'invalid-trusted-pi-session-file');
  if (value.format !== 'riffology-pi-session-v1' || typeof value.createdAt !== 'string'
    || !Array.isArray(value.entries) || (value.leafId !== null && typeof value.leafId !== 'string')
    || value.scope.tenantId !== expected.scope.tenantId || value.scope.projectId !== expected.scope.projectId
    || value.scope.sessionId !== expected.sessionId) fail('trusted-pi-native-scope-denied');
  if (hasResources) validateResourceProvenance(value.resources, expected.scope);
  return value;
}
function assistantText(message) {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return '';
  return boundedText(message.content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join(''), true);
}
function requestId(headers) {
  const value = new Headers(headers).get('x-request-id');
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}

/**
 * Run one immutable Pi turn. Release-controlled model policy, credentials,
 * fixed skills and bridge definitions are resolved by the injected release
 * module; the control file supplies only product identity and the user message.
 */
export async function runTrustedPiTurnHost(token, release, options = {}) {
  if (typeof token !== 'string' || !TOKEN.test(token) || typeof release?.resolveOptions !== 'function') fail('invalid-trusted-pi-host-start');
  const clock = options.clock ?? Date.now;
  const createSession = options.createSession ?? createControlledPiSession;
  const location = paths(token, options.controlRoot);
  const rawControl = await readBounded(location.control, MAX_CONTROL_BYTES);
  let parsed;
  try { parsed = control(JSON.parse(rawControl.toString('utf8'))); } catch (error) { if (error instanceof SyntaxError) fail('invalid-trusted-pi-control'); throw error; }
  if (nativeToken(parsed.identity) !== token) fail('trusted-pi-native-token-mismatch');
  const executionDeadlineAt=parsed.executionDeadlineAt;
  const deadlinePassed=()=>executionDeadlineAt!==undefined&&executionDeadlineAt<=clock();
  if(deadlinePassed()||(executionDeadlineAt!==undefined&&executionDeadlineAt>clock()+600000))fail('trusted-pi-execution-expired');
  let snapshot;
  if (parsed.inputSessionSha256 !== null) {
    const bytes = await readBounded(location.input, MAX_SESSION_BYTES);
    if (sha(bytes) !== parsed.inputSessionSha256) fail('invalid-trusted-pi-session-file');
    snapshot = parseSnapshot(bytes, parsed.identity);
  } else if (await readBounded(location.input, MAX_SESSION_BYTES, true)) fail('unexpected-trusted-pi-session-file');

  const events = [];
  let sequence = 0;
  let host;
  let cancelRequested = false;
  let cancelling;
  let terminationTimer;
  let deadlineTimer;
  let deadlineExceeded=false;
  const persist = async (terminal = null) => {
    const value = terminal ?? { schemaVersion: 1, identity: parsed.identity, phase: 'running', outcome: null, executionErrorCode: null, events, outputSessionSha256: null };
    const encoded = JSON.stringify(value);
    if (encoder.encode(encoded).byteLength > MAX_RESULT_BYTES) fail('trusted-pi-host-result-limit');
    await atomicWrite(location.result, encoded);
  };
  let writeTail = Promise.resolve();
  const emit = (event) => {
    if (events.length >= MAX_EVENTS) fail('trusted-pi-host-event-limit');
    events.push(Object.freeze({ sequence: ++sequence, at: positive(clock()), ...event }));
    writeTail = writeTail.then(() => persist());
    return writeTail;
  };
  const cancel = () => {
    cancelRequested = true;
    terminationTimer ??= setTimeout(() => process.exit(2), TERMINATION_GRACE_MS);
    if (host) cancelling ??= Promise.resolve().then(() => host.cancel());
    return cancelling;
  };
  const signal = () => { void cancel(); };
  process.once('SIGTERM', signal);
  process.once('SIGINT', signal);
  try {
    if(executionDeadlineAt!==undefined)deadlineTimer=setTimeout(()=>{deadlineExceeded=true;void cancel();},Math.max(1,executionDeadlineAt-clock()));
    if(deadlinePassed())fail('trusted-pi-execution-expired');
    await persist();
    const fixed = await release.resolveOptions({ identity: structuredClone(parsed.identity), actor: structuredClone(parsed.actor), message: parsed.message, snapshot: snapshot ? structuredClone(snapshot) : null,...(executionDeadlineAt===undefined?{}:{executionDeadlineAt}) });
    if (!fixed || typeof fixed !== 'object' || Array.isArray(fixed)) fail('invalid-trusted-pi-release');
    if(deadlinePassed()||deadlineExceeded)fail('trusted-pi-execution-expired');
    const releaseResponse = fixed.onProviderResponse;
    const releasePayload = fixed.onProviderPayload;
    host = await createSession({
      ...fixed,
      trustedCwd: '/var/lib/riffology/pi',
      scope: { tenantId: parsed.identity.scope.tenantId, projectId: parsed.identity.scope.projectId, sessionId: parsed.identity.sessionId },
      snapshot,
      onProviderPayload: async (request) => {
        if(deadlinePassed()||deadlineExceeded)fail('trusted-pi-execution-expired');
        await emit({ kind: 'provider.status', state: 'requesting', status: null, requestId: null });
        const payload=releasePayload?await releasePayload(request):request.payload;
        if(deadlinePassed()||deadlineExceeded)fail('trusted-pi-execution-expired');
        return payload;
      },
      onProviderResponse: async (response) => {
        await emit({ kind: 'provider.status', state: response.status >= 400 ? 'error' : 'responding', status: response.status, requestId: requestId(response.headers) });
        await releaseResponse?.(response);
      },
    });
    if(deadlinePassed()) {deadlineExceeded=true;cancel();}
    if (cancelRequested) cancelling ??= Promise.resolve().then(() => host.cancel());
    const unsubscribe = host.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        void emit({ kind: 'assistant.delta', text: boundedText(event.assistantMessageEvent.delta) });
      } else if (event.type === 'message_end' && event.message?.role === 'assistant') {
        void emit({ kind: 'assistant.message', text: assistantText(event.message), stopReason: event.message.stopReason ? id(event.message.stopReason) : null });
      } else if (event.type === 'tool_execution_start') {
        void emit({ kind: 'tool.started', toolCallId: toolCallId(event.toolCallId), name: toolName(event.toolName) });
      } else if (event.type === 'tool_execution_update') {
        void emit({ kind: 'tool.updated', toolCallId: toolCallId(event.toolCallId), name: toolName(event.toolName), summary: 'Tool is running.' });
      } else if (event.type === 'tool_execution_end') {
        const isError = event.isError === true;
        void emit({ kind: 'tool.completed', toolCallId: toolCallId(event.toolCallId), name: toolName(event.toolName), isError, artifact: isError ? null : artifactFromToolResult(event.result) });
      }
    });
    let promptResult;
    try { promptResult = cancelRequested?{outcome:'aborted',stopReason:'aborted'}:await host.prompt(parsed.message); }
    catch { promptResult = { outcome: cancelRequested ? 'aborted' : 'failed', stopReason: cancelRequested ? 'aborted' : 'error' }; }
    finally { unsubscribe(); }
    await cancelling;
    await writeTail;
    const frozen = host.snapshot();
    const frozenBytes = Buffer.from(JSON.stringify(frozen));
    if (frozenBytes.byteLength < 1 || frozenBytes.byteLength > MAX_SESSION_BYTES) fail('invalid-trusted-pi-session-file');
    parseSnapshot(frozenBytes, parsed.identity);
    await atomicWrite(location.output, frozenBytes.toString('base64'));
    const outcome = deadlineExceeded||deadlinePassed() ? 'cancelled' : promptResult.outcome === 'completed' ? 'completed'
      : promptResult.outcome === 'failed' ? 'failed'
        : cancelRequested ? 'cancelled' : 'interrupted';
    const terminal = {
      schemaVersion: 1, identity: parsed.identity, phase: 'terminal', outcome,
      executionErrorCode: deadlineExceeded||deadlinePassed()?'pi-turn-deadline-exceeded':outcome === 'completed' ? null : outcome === 'failed' ? 'pi-turn-failed' : outcome === 'cancelled' ? 'pi-turn-cancelled' : 'pi-turn-interrupted',
      events, outputSessionSha256: sha(frozenBytes),
    };
    await persist(terminal);
    return terminal;
  } finally {
    process.off('SIGTERM', signal);
    process.off('SIGINT', signal);
    try{if (host) await host.dispose();}finally{clearTimeout(deadlineTimer);clearTimeout(terminationTimer);}
  }
}

async function main() {
  const token = process.argv[2];
  const release = await import(RELEASE_MODULE);
  await runTrustedPiTurnHost(token, release);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.exitCode = 1; });
}

export const trustedPiHostLimits = { maxControlBytes: MAX_CONTROL_BYTES, maxSessionBytes: MAX_SESSION_BYTES, maxResultBytes: MAX_RESULT_BYTES, maxEvents: MAX_EVENTS, maxTextBytes: MAX_TEXT_BYTES, terminationGraceMs: TERMINATION_GRACE_MS };
