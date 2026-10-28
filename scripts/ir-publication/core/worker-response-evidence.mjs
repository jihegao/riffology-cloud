/** Gateway response evidence only. No network, credential reader or logger. */
import {open, lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {GuardError, guard} from './a2/reviewed-wire-primitives.mjs';
import {LIMITS} from './fixed-target.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Re-open the actual file, not the writer's claimed receipt. Private body data
// never enters the safe projection, console, thrown errors or ACK summaries.
export async function verifyPrivateBody(store, name, reference, expected) {
  guard(reference?.file === join(store.directory, name), 'response-evidence-path');
  const file = await open(reference.file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await file.stat();
    guard(st.isFile() && st.nlink === 1 && st.uid === process.getuid() &&
      (st.mode & 0o777) === 0o600 && st.size === expected.length, 'response-evidence-file');
    const actual = await file.readFile();
    guard(actual.equals(expected) && reference.bytes === actual.length &&
      reference.sha256 === sha(actual), 'response-evidence-readback');
  } finally { await file.close(); }
}

export async function captureWorkerResponse(response, {
  store, key, requestId, intentSha256, signal, maxBytes = LIMITS.maxJsonBytes,
}) {
  guard(/^[a-z0-9][a-z0-9_.-]{0,120}$/.test(key), 'response-evidence-key');
  guard(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= LIMITS.maxJsonBytes,
    'response-evidence-limit');
  const dir = await lstat(store.directory);
  guard(dir.isDirectory() && !dir.isSymbolicLink() && dir.uid === process.getuid() &&
    (dir.mode & 0o777) === 0o700, 'response-evidence-directory');
  let reader, aborted, failure = null, complete = false, bytes = 0;
  const chunks = [];
  const observedAt = new Date().toISOString();
  const validResponse = response instanceof Response;
  const status = validResponse ? response.status : null;
  let declaredBytes = null;
  try {
    guard(validResponse && !response.redirected, 'response-object-or-redirect');
    const length = response.headers.get('content-length');
    if (length !== null) {
      guard(/^\d+$/.test(length) && Number.isSafeInteger(Number(length)), 'response-length-invalid');
      declaredBytes = Number(length);
      guard(declaredBytes <= maxBytes, 'response-declared-limit');
    }
    guard(!signal?.aborted, 'response-aborted');
    reader = response.body?.getReader();
    guard(reader, 'response-body-missing');
    aborted = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', aborted, {once: true});
    for (;;) {
      guard(!signal?.aborted, 'response-aborted');
      const {done, value} = await reader.read();
      guard(!signal?.aborted, 'response-aborted');
      if (done) break;
      const chunk = Buffer.from(value);
      const accepted = chunk.subarray(0, maxBytes - bytes);
      chunks.push(Buffer.from(accepted)); bytes += accepted.length;
      guard(accepted.length === chunk.length, 'response-body-limit');
    }
    guard(declaredBytes === null || declaredBytes === bytes, 'response-length-incomplete');
    complete = true;
  } catch (error) {
    failure = error instanceof GuardError ? error.code : 'response-read-failed';
    try { await (reader ? reader.cancel() : response?.body?.cancel()); } catch {}
  } finally {
    if (aborted) signal?.removeEventListener('abort', aborted);
    reader?.releaseLock();
  }

  const body = Buffer.concat(chunks), name = key + '-response.private.bin';
  let reference;
  try {
    reference = await store.write(name, body);
    await verifyPrivateBody(store, name, reference, body);
    // Keep correlation headers private too; never retain cookies/auth headers.
    const headers = {};
    for (const name of ['content-type', 'content-length', 'cf-ray', 'cf-request-id', 'date']) {
      const value = validResponse ? response.headers.get(name) : null;
      if (value !== null) headers[name] = value;
    }
    const contextName = key + '-response-context.private.json';
    const contextBytes = Buffer.from(JSON.stringify({status, observedAt, headers}) + '\n');
    const context = await store.write(contextName, contextBytes);
    await verifyPrivateBody(store, contextName, context, contextBytes);
    await store.write(key + '-capture.safe.json', {
      schema: 'riffoid-ir-worker-response-capture/v1', requestId,
      originalIntentSha256: intentSha256, observedAt, status,
      complete, failure, declaredBytes, retainedBytes: body.length,
      bodySha256: sha(body), privateBodyFile: name, privateReadbackVerified: true,
      privateContextFile: contextName, contextSha256: context.sha256,
      // No arbitrary response headers or error messages enter this safe record.
      retainedBytesUnmodified: true, retention: complete ? 'full-body' : 'available-prefix',
      retryAllowedByThisReceipt: false,
    });
  } catch {
    throw new GuardError('response-evidence-persistence-failed');
  }
  if (!complete) throw new GuardError(failure);
  return {body, status, contentType: response.headers.get('content-type'), observedAt, sha256: sha(body)};
}
