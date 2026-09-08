import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { hash, safePath, sourceSnapshot } from './source-inventory.mjs';

export const PREVIEW_ACCOUNT = '8b0d70250211aa10d89e20605a1c7e5e';
export const PREVIEW_WORKER = 'riffology-m0-preview-staging';
export const WORKERS_DEV_ORIGIN = `https://${PREVIEW_WORKER}.jihe-gao.workers.dev`;
const fail = message => { throw new Error(message); };
const check = (condition, message) => { if (!condition) fail(message); };
const keys = (value, expected) => check(value && Object.getPrototypeOf(value) === Object.prototype && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), 'invalid-manifest-fields');
const hostname = value => typeof value === 'string' && value.length <= 253 && value.split('.').length >= 2 && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) && !isIP(value);
const origin = value => {
  check(typeof value === 'string', 'invalid-https-origin');
  let url;
  try { url = new URL(value); } catch { fail('invalid-https-origin'); }
  check(url.protocol === 'https:' && url.origin === value && !url.port && hostname(url.hostname), 'invalid-https-origin');
  return url;
};
const within = (host, site) => host === site || host.endsWith(`.${site}`);

/** Operator-supplied deployment evidence, not a self-attestation by project code.
 * This validates syntax and this account's exact staging identity. DNS, TLS and
 * browser Sec-Fetch-Site still require real execution; no PSL claim is inferred.
 */
export function validateCloudManifest(value) {
  keys(value, ['schemaVersion', 'environment', 'accountId', 'controlOrigin', 'previewBaseOrigin', 'registrableSite', 'managementOrigins', 'ingressOrigins', 'worker', 'container', 'deploymentSourceSha256']);
  check(value.schemaVersion === 1 && value.environment === 'staging' && value.accountId === PREVIEW_ACCOUNT, 'wrong-staging-deployment');
  keys(value.worker, ['name', 'versionId', 'deploymentId']);
  keys(value.container, ['applicationName', 'imageDigest']);
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  check(value.worker.name === PREVIEW_WORKER && uuid.test(value.worker.versionId) && uuid.test(value.worker.deploymentId), 'invalid-worker-release');
  check(value.container.applicationName === PREVIEW_WORKER && /^sha256:[a-f0-9]{64}$/.test(value.container.imageDigest), 'invalid-container-release');
  check(/^[a-f0-9]{64}$/.test(value.deploymentSourceSha256), 'invalid-deployment-source-hash');
  const control = origin(value.controlOrigin), preview = origin(value.previewBaseOrigin);
  check(hostname(value.registrableSite) && !/(?:^|\.)(?:test|invalid|localhost|local|example|workers\.dev)$/.test(value.registrableSite) && !['example.com', 'example.net', 'example.org'].includes(value.registrableSite), 'real-operator-site-required');
  check(within(control.hostname, value.registrableSite) && within(preview.hostname, value.registrableSite), 'origins-outside-declared-site');
  check(control.hostname !== preview.hostname && !control.hostname.endsWith(`.${preview.hostname}`), 'control-preview-origin-collision');
  check(preview.hostname.length + 35 <= 253, 'preview-hostname-too-long');
  check(Array.isArray(value.managementOrigins) && value.managementOrigins.length === 1 && value.managementOrigins[0] === control.origin, 'management-origin-must-be-exact-control');
  // This fixture knows one alternate ingress. Never let an arbitrary manifest
  // URL become a credential destination or an unrelated-host scanning list.
  check(Array.isArray(value.ingressOrigins) && value.ingressOrigins.length <= 1 && value.ingressOrigins.every(item => item === WORKERS_DEV_ORIGIN), 'unknown-staging-ingress');
  return structuredClone(value);
}

export function previewSources(root) {
  const snapshot = sourceSnapshot(root);
  const files = snapshot.files.filter(file => file.path.startsWith('spikes/m0-preview/') || /^scripts\/m0\/preview-[^/]+\.mjs$/.test(file.path) || [
    'spikes/m0-cloud/auth.ts', 'scripts/m0/source-inventory.mjs', 'tests/m0/preview-driver.test.ts',
    'infra/wrangler.m0-preview.jsonc', 'infra/m0-project.Dockerfile',
    'package.json', 'package-lock.json', 'tsconfig.json', '.dockerignore', '.gitignore',
  ].includes(file.path));
  return { sha256: hash(JSON.stringify(files)), files, repositorySourceSha256: snapshot.sha256 };
}

export function permittedPreviewRequest(inputs, value, { headers = {}, anonymousIngress = false } = {}) {
  let url;
  try { url = new URL(value); } catch { fail('request-url-invalid'); }
  const base = new URL(inputs.base);
  const dynamic = url.hostname.endsWith(`.${base.hostname}`) && /^p-[a-f0-9]{32}$/.test(url.hostname.slice(0, -(base.hostname.length + 1)));
  check(url.protocol === 'https:' && url.port === base.port && !url.username && !url.password && !url.hash, 'request-transport-denied');
  check(url.origin === inputs.control || url.origin === inputs.base || dynamic || (anonymousIngress && inputs.ingressOrigins.includes(url.origin)), 'request-origin-outside-manifest');
  const names = Object.keys(headers).map(name => name.toLowerCase());
  check(!anonymousIngress || !names.some(name => name === 'authorization' || name === 'cookie'), 'alternate-ingress-must-be-anonymous');
  check(!names.includes('authorization') || url.origin === inputs.control, 'management-credential-origin-denied');
  return url;
}

export async function loadCloudInputs(root, manifestPath, secretPath) {
  // All path components must be ordinary files/directories, not symlinks.
  const deploymentPath = safePath(root, manifestPath, 'deployment-manifest');
  const secret = safePath(root, secretPath, 'probe-secret');
  const relative = path.relative(path.join(root, '.local'), secret);
  check(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), 'probe-secret-must-be-under-local');
  const stat = await lstat(secret);
  check((stat.mode & 0o777) === 0o600 && (process.getuid === undefined || stat.uid === process.getuid()), 'probe-secret-must-be-owned-0600');
  check(stat.size > 0 && stat.size <= 4096 && (await lstat(deploymentPath)).size <= 16384, 'input-file-size-invalid');
  let manifest;
  try { manifest = validateCloudManifest(JSON.parse(await readFile(deploymentPath, 'utf8'))); } catch { fail('invalid-cloud-deployment-manifest'); }
  const raw = await readFile(secret, 'utf8');
  let token;
  if (raw.trimStart().startsWith('{')) {
    // Restricted JSON grammar also rejects duplicate or escaped property names.
    const match = /^\s*\{\s*"M0_PROBE_TOKEN"\s*:\s*"([A-Za-z0-9._~-]{32,1024})"\s*\}\s*$/.exec(raw);
    check(match, 'probe-secret-json-must-contain-only-token');
    token = match[1];
  } else {
    const match = /^M0_PROBE_TOKEN=([A-Za-z0-9._~-]{32,1024})\r?\n?$/.exec(raw);
    check(match, 'probe-secret-env-must-contain-only-token');
    token = match[1];
  }
  check(typeof token === 'string' && /^[A-Za-z0-9._~-]{32,1024}$/.test(token), 'invalid-probe-token');
  check(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && !process.env.NODE_EXTRA_CA_CERTS && !process.env.SSL_CERT_FILE && !process.env.SSL_CERT_DIR && !process.env.NODE_OPTIONS, 'cloud-tls-environment-overrides-forbidden');
  return {
    mode: 'cloud', control: manifest.controlOrigin, base: manifest.previewBaseOrigin,
    registrableSite: manifest.registrableSite, token, deploymentManifest: manifest,
    manifestSha256: hash(JSON.stringify(manifest)), ingressOrigins: manifest.ingressOrigins,
    httpsOptions: {}, chromeArgs: ['--no-proxy-server'],
    tlsEvidence: { system_ca: true, bundled_public_ca: true, real_dns: true, port: 443, dedicated_ca: false, spki_allowlist_only: false, global_tls_verification_disabled: false, system_trust_modified: false },
  };
}
