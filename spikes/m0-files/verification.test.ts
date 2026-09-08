import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedEntries, restoreDocument, treeFor, verifyExport, verifyMutation, verifyRecreatedFilesystem } from './verification.ts';
import { fileSandboxId, handleFilesRequest, type FileProbeOperations } from './worker.ts';

async function exportedFixture() {
  const entries = expectedEntries();
  return { root_mode: 0o755, ...JSON.parse(restoreDocument(entries)), tree: await treeFor(entries), entry_count: entries.length,
    total_bytes: entries.reduce((sum, entry) => sum + (entry.kind === 'file' ? entry.bytes.byteLength : 0), 0),
  };
}
test('server-derived Sandbox IDs satisfy the actual SDK length and character constraints', () => {
  const id = fileSandboxId('a'.repeat(64));
  assert.equal(id.length, 57);
  assert.match(id, /^[a-z0-9-]{1,63}$/);
  assert.notEqual(fileSandboxId('b'.repeat(64)), id);
  assert.throws(() => fileSandboxId('caller-chosen-project'), /invalid-coordinator-id/);
});
test('controller rejects altered bytes even when the runtime keeps the expected digest report', async () => {
  const fixture = await exportedFixture();
  assert.equal((await verifyExport(fixture)).length, 12);
  fixture.entries.find((entry: { kind: string }) => entry.kind === 'file').bytes_base64 = Buffer.from('tampered').toString('base64');
  await assert.rejects(verifyExport(fixture), /fixture-content-mismatch/);
});
test('filesystem recreation requires an independently changed boot identity as well as empty paths', () => {
  const fresh = { root_absent: true, staging_absent: true, marker_absent: true, boot_id_sha256: 'a'.repeat(64) };
  const recreated = { ...fresh, boot_id_sha256: 'b'.repeat(64) };
  verifyRecreatedFilesystem(fresh, recreated);
  assert.throws(() => verifyRecreatedFilesystem(fresh, fresh), /runtime-boot-unchanged/);
  assert.throws(() => verifyRecreatedFilesystem(fresh, { ...recreated, marker_absent: false }), /invalid-boot-observation/);
  assert.throws(() => verifyRecreatedFilesystem(fresh, { ...recreated, boot_id_sha256: null }), /invalid-boot-observation/);
});

test('file probe rejects a stalled body even if stream cancellation never settles', { timeout: 3000 }, async () => {
  let calls = 0;
  const invoke = async () => { calls++; return { status: 200, body: {} }; };
  const token = 'm0-file-body-test-at-least-thirty-two-characters';
  const body = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } });
  const input = new Request('https://probe.invalid/probe/files-body-deadline/run', {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body, duplex: 'half',
  } as RequestInit);
  const started = Date.now();
  const response = await handleFilesRequest(input, { M0_PROBE_TOKEN: token, ENVIRONMENT: 'staging', PROTOCOL_VERSION: 'm0-v1' }, { run: invoke, report: invoke, cleanup: invoke });
  assert.equal(response.status, 400);
  assert.ok(Date.now() - started < 2000);
  assert.equal(calls, 0);
  assert.equal(body.locked, false);
});
test('controller rejects duplicate paths, missing directories, mode changes, invalid base64 and false counts', async () => {
  for (const mutate of [
    (value: Awaited<ReturnType<typeof exportedFixture>>) => { value.entries[1].path = value.entries[0].path; },
    (value: Awaited<ReturnType<typeof exportedFixture>>) => { value.entries.splice(1, 1); },
    (value: Awaited<ReturnType<typeof exportedFixture>>) => { value.entries[0].mode = 0o777; },
    (value: Awaited<ReturnType<typeof exportedFixture>>) => { value.entries[0].bytes_base64 = '!!!!'; },
    (value: Awaited<ReturnType<typeof exportedFixture>>) => { value.total_bytes++; },
  ]) {
    const fixture = await exportedFixture(); mutate(fixture);
    await assert.rejects(verifyExport(fixture));
  }
  await assert.rejects(verifyMutation({ operation_count: 20, receipts: [], root_mode: 0o755 }), /operation-count/);
});

test('file probe authorizes before allocating a run and accepts no caller commands or restore payload', async () => {
  let called = 0;
  const invoke = async () => { called++; return { status: 200, body: { synthetic: true } }; };
  const operations: FileProbeOperations = { run: invoke, report: invoke, cleanup: invoke };
  const token = 'm0-test-bearer-with-at-least-thirty-two-characters';
  const env = { M0_PROBE_TOKEN: token, ENVIRONMENT: 'staging', PROTOCOL_VERSION: 'm0-v1' };
  const request = (path: string, method = 'POST', body?: string, authorized = true) => new Request(`https://probe.invalid${path}`, {
    method, headers: authorized ? { authorization: `Bearer ${token}` } : {}, ...(body === undefined ? {} : { body }),
  });
  const path = '/probe/files-fixture-0001/run';
  assert.equal((await handleFilesRequest(request(path, 'POST', undefined, false), env, operations)).status, 401);
  assert.equal((await handleFilesRequest(request(path), { ...env, ENVIRONMENT: 'production' }, operations)).status, 503);
  assert.equal((await handleFilesRequest(request(path + '?command=rm'), env, operations)).status, 404);
  assert.equal((await handleFilesRequest(request(path, 'POST', '{"command":"uname"}'), env, operations)).status, 400);
  assert.equal((await handleFilesRequest(request(path, 'GET'), env, operations)).status, 405);
  assert.equal((await handleFilesRequest(request('/probe/short/run'), env, operations)).status, 404);
  assert.equal(called, 0);
  assert.equal((await handleFilesRequest(request(path), env, operations)).status, 200);
  assert.equal((await handleFilesRequest(request('/probe/files-fixture-0001/report', 'GET'), env, operations)).status, 200);
  assert.equal(called, 2);
});
