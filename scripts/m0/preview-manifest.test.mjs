import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCloudInputs, permittedPreviewRequest, PREVIEW_ACCOUNT, PREVIEW_WORKER, WORKERS_DEV_ORIGIN, validateCloudManifest } from './preview-manifest.mjs';

const manifest = () => ({
  schemaVersion: 1, environment: 'staging', accountId: PREVIEW_ACCOUNT,
  controlOrigin: 'https://control.fixture-domain.com', previewBaseOrigin: 'https://preview.fixture-domain.com', registrableSite: 'fixture-domain.com',
  managementOrigins: ['https://control.fixture-domain.com'], ingressOrigins: [WORKERS_DEV_ORIGIN],
  worker: { name: PREVIEW_WORKER, versionId: '11111111-1111-4111-8111-111111111111', deploymentId: '22222222-2222-4222-8222-222222222222' },
  container: { applicationName: PREVIEW_WORKER, imageDigest: `sha256:${'3'.repeat(64)}` }, deploymentSourceSha256: '4'.repeat(64),
});

test('cloud manifest pins staging release and exact management/anonymous ingress boundaries', () => {
  assert.deepEqual(validateCloudManifest(manifest()), manifest());
  for (const mutate of [
    value => { value.accountId = '0'.repeat(32); },
    value => { value.environment = 'production'; },
    value => { value.worker.name = 'another-worker'; },
    value => { value.worker.versionId = 'latest'; },
    value => { value.container.imageDigest = 'latest'; },
    value => { value.M0_PROBE_TOKEN = 'unexpected-secret'; },
    value => { value.managementOrigins.push(WORKERS_DEV_ORIGIN); },
    value => { value.ingressOrigins = ['https://unrelated.jihe-gao.workers.dev']; },
    value => { value.controlOrigin = 'https://control.fixture-domain.com:8791'; },
    value => { value.controlOrigin = 'https://user:password@control.fixture-domain.com'; },
    value => { value.controlOrigin += '/path'; },
    value => { value.controlOrigin = 'https://p-live.preview.fixture-domain.com'; value.managementOrigins = [value.controlOrigin]; },
    value => { value.previewBaseOrigin = 'https://preview.other-site.com'; },
    value => { value.registrableSite = 'workers.dev'; },
    value => { value.registrableSite = 'm0.test'; },
    value => { value.registrableSite = '127.0.0.1'; },
  ]) {
    const value = manifest(); mutate(value); assert.throws(() => validateCloudManifest(value));
  }
});

test('cloud request allowlist rejects credential forwarding and URL authority confusion', () => {
  const value = manifest();
  const inputs = { control: value.controlOrigin, base: value.previewBaseOrigin, ingressOrigins: value.ingressOrigins };
  const preview = `https://p-${'a'.repeat(32)}.preview.fixture-domain.com`;
  assert.equal(permittedPreviewRequest(inputs, preview + '/p/test/api/state').origin, preview);
  assert.equal(permittedPreviewRequest(inputs, WORKERS_DEV_ORIGIN, { anonymousIngress: true }).origin, WORKERS_DEV_ORIGIN);
  assert.equal(permittedPreviewRequest(inputs, value.controlOrigin, { headers: { authorization: 'Bearer synthetic' } }).origin, value.controlOrigin);
  for (const [url, options] of [
    [preview, { headers: { Authorization: 'Bearer synthetic' } }],
    [WORKERS_DEV_ORIGIN, { anonymousIngress: true, headers: { Cookie: 'synthetic' } }],
    [WORKERS_DEV_ORIGIN, { anonymousIngress: true, headers: { authorization: 'Bearer synthetic' } }],
    [WORKERS_DEV_ORIGIN, {}],
    [preview + '.evil.invalid', {}],
    [preview.replace('https:', 'http:'), {}],
    [preview + ':8791', {}],
    [preview.replace('https://', 'https://user:password@'), {}],
    [preview + '/#secret', {}],
    ['https://p-constructor.preview.fixture-domain.com', {}],
    ['https://127.0.0.1', {}],
  ]) assert.throws(() => permittedPreviewRequest(inputs, url, options));
});

test('cloud inputs accept only an owned 0600 single-token file and never load local TLS/signing data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-manifest-test-'));
  try {
    await mkdir(path.join(root, '.local'));
    const deployment = path.join(root, 'deployment.json'), secret = path.join(root, '.local', 'token.json');
    const token = 'synthetic-cloud-token-'.repeat(3);
    await writeFile(deployment, JSON.stringify(manifest()));
    await writeFile(secret, JSON.stringify({ M0_PROBE_TOKEN: token }), { mode: 0o600 });
    const inputs = await loadCloudInputs(root, deployment, secret);
    assert.equal(inputs.token, token);
    assert.equal(inputs.mode, 'cloud');
    assert.deepEqual(inputs.httpsOptions, {});
    assert.deepEqual(inputs.chromeArgs, ['--no-proxy-server']);
    assert.equal(inputs.tlsEvidence.real_dns, true);
    assert.equal('M0_PREVIEW_SIGNING_KEY' in inputs, false);
    await chmod(secret, 0o644);
    await assert.rejects(loadCloudInputs(root, deployment, secret));
    await chmod(secret, 0o600);
    for (const body of [JSON.stringify({ M0_PROBE_TOKEN: token, M0_PREVIEW_SIGNING_KEY: 'forbidden' }), `{"M0_PROBE_TOKEN":"${token}","M0_PROBE_TOKEN":"${token}"}`, `M0_PROBE_TOKEN=${token}\nM0_PREVIEW_SIGNING_KEY=forbidden\n`]) {
      await writeFile(secret, body); await assert.rejects(loadCloudInputs(root, deployment, secret));
    }
    await writeFile(secret, `M0_PROBE_TOKEN=${token}\n`);
    assert.equal((await loadCloudInputs(root, deployment, secret)).token, token);
    const link = path.join(root, '.local', 'link.json');
    await symlink(secret, link);
    await assert.rejects(loadCloudInputs(root, deployment, link));
  } finally { await rm(root, { recursive: true, force: true }); }
});
