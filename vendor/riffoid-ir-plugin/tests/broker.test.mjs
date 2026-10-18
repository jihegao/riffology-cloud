import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { startBroker, request, acquireProject } from '../src/broker.mjs';

test('loopback broker enforces token, origin and workspace boundaries and serves the real browser assets', async () => {
  const workspace = await mkdtemp('/tmp/riffoid-broker-'), broker = await startBroker(workspace);
  try {
    assert.equal((await fetch(`${broker.connection.origin}/health`)).status, 401);
    assert.equal((await fetch(`${broker.connection.origin}/v1`, { method: 'POST', headers: { origin: 'https://untrusted.invalid', authorization: `Bearer ${broker.connection.token}` } })).status, 403);
    assert.equal((await fetch(`${broker.connection.origin}/assets/app.js`)).status, 200);
    const state = await request(broker.connection, 'show'); assert.equal(state.defaultMode, 'code');
    await request(broker.connection, 'example');
    assert.equal(JSON.parse(await readFile(`${workspace}/model/business-ir.draft.json`)).version, 'aircraft-business-ir/v1');
    const invalid = await request(broker.connection, 'project_ir_check', { draftRef: '../outside.json' });
    assert.equal(invalid.status, 'failed'); assert.equal(invalid.diagnostics[0].code, 'invalid_reference');
  } finally { await broker.close(); }
});

test('session-owned broker is shared and closes only after the last session releases it', async () => {
  const workspace = await mkdtemp('/tmp/riffoid-lifecycle-');
  const a = await acquireProject(workspace), b = await acquireProject(workspace);
  assert.equal(a.connection.origin, b.connection.origin);
  await a.release(); assert.equal((await b.call('show')).defaultMode, 'code');
  await b.release();
  await assert.rejects(request(b.connection, 'show'), /fetch failed/);
});
