import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('Trusted Pi and project effects use distinct locked Sandbox images', async () => {
  const config = await readFile(new URL('infra/wrangler.m2-project-sandbox-local.jsonc', root), 'utf8');
  assert.match(config, /"class_name": "ProjectToolSandbox",\s*"image": "\.\.\/services\/project-tools\/Dockerfile\.cloud"/s);
  assert.match(config, /"class_name": "TrustedPiSandbox",\s*"image": "\.\.\/Dockerfile\.trusted-pi\.cloud"/s);
  const dockerfile = await readFile(new URL('Dockerfile.trusted-pi.cloud', root), 'utf8');
  assert.match(dockerfile, /^FROM docker\.io\/cloudflare\/sandbox:0\.12\.9-python@sha256:[a-f0-9]{64}$/m);
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.match(dockerfile, /trusted-pi-turn-host\.mjs \/opt\/riffology\/trusted-pi\/trusted-pi-turn-host\.mjs/);
  assert.match(dockerfile, /release-unconfigured\.mjs \/opt\/riffology\/trusted-pi\/trusted-pi-release\.mjs/);
  assert.doesNotMatch(dockerfile, /ln -s|\/opt\/riffology\/trusted-pi-turn-host\.mjs/);
  assert.doesNotMatch(dockerfile, /proxy-pi|go-pi-probe|M0_|\.local/);
});

test('Trusted Pi image dependency and fail-closed release are fixed', async () => {
  const manifest = JSON.parse(await readFile(new URL('services/trusted-pi/package.json', root), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('services/trusted-pi/package-lock.json', root), 'utf8'));
  assert.deepEqual(manifest.dependencies, {
    '@earendil-works/pi-coding-agent': '0.85.0',
    '@earendil-works/pi-server': '0.85.0',
  });
  assert.equal(lock.packages[''].dependencies['@earendil-works/pi-coding-agent'], '0.85.0');
  assert.equal(lock.packages[''].dependencies['@earendil-works/pi-server'], '0.85.0');
  assert.equal(lock.packages['node_modules/@earendil-works/pi-coding-agent'].version, '0.85.0');
  assert.equal(lock.packages['node_modules/@earendil-works/pi-server'].version, '0.85.0');
  const release = await import('../../services/trusted-pi/release-unconfigured.mjs');
  await assert.rejects(release.resolveOptions(), /release-not-configured/);
});
