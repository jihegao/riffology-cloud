#!/usr/bin/env node
// Create an isolated local HTTPS fixture for the Preview browser driver.
// This helper never changes system trust, hosts, browsers, services or network state.
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localRoot = path.join(root, '.local');

if (process.argv.length !== 2) {
  throw new Error('Usage: node scripts/m0/preview-tls.mjs');
}

await mkdir(localRoot, { recursive: true, mode: 0o700 });
const directory = path.join(localRoot, `m0-browser-tls-${Date.now()}-${randomBytes(6).toString('hex')}`);
await mkdir(directory, { mode: 0o700 });
const keyPath = path.join(directory, 'key.pem');
const certPath = path.join(directory, 'cert.pem');
const varsPath = path.join(directory, 'vars.env');
const metadataPath = path.join(directory, 'metadata.json');

try {
  await execFile('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2',
    '-subj', '/CN=control.m0.test',
    '-addext', 'subjectAltName=DNS:control.m0.test,DNS:preview.m0.test,DNS:*.preview.m0.test',
    '-keyout', keyPath, '-out', certPath,
  ], { cwd: root, timeout: 15000, maxBuffer: 16 * 1024 });
  await chmod(keyPath, 0o600);

  const vars = [
    `M0_PROBE_TOKEN=${randomBytes(32).toString('hex')}`,
    `M0_PREVIEW_SIGNING_KEY=${randomBytes(32).toString('hex')}`,
    '',
  ].join('\n');
  await writeFile(varsPath, vars, { flag: 'wx', mode: 0o600 });
  await chmod(varsPath, 0o600);

  const certificate = await readFile(certPath);
  const spkiSha256 = createHash('sha256')
    .update(new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');
  const metadata = {
    controlOrigin: 'https://control.m0.test:8791',
    previewBase: 'https://preview.m0.test:8791',
    spkiSha256,
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  console.log(`TLS directory: ${directory}`);
  console.log(`metadata: ${metadataPath}`);
} catch (error) {
  // Keep the exclusive directory for inspection; never reuse another run's fixture.
  throw new Error(`could not create Preview TLS fixture: ${error instanceof Error ? error.message : String(error)}`);
}
