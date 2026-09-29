import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('Project Tools images install the same pinned compiler authoring toolchain', async () => {
  const names=['services/project-tools/Dockerfile.cloud','services/project-tools/Dockerfile.vertical'];
  const sources=await Promise.all(names.map(name=>readFile(new URL(name,root),'utf8')));
  const wheel=await readFile(new URL('services/project-tools/vendor/sim_engine_compiler-0.1.0-cp312-abi3-manylinux_2_28_x86_64.whl',root));
  assert.equal(createHash('sha256').update(wheel).digest('hex'),'e7bcd9271dd42106b78e87176e3485b290536f5291c0440872b814fc549858f7');
  for(const source of sources){
    assert.match(source,/cpython-3\.14\.2%2B20251217-x86_64-unknown-linux-gnu-install_only_stripped\.tar\.gz/);
    assert.match(source,/sha256:4eb8731e2dbc9644dca24e71a9e7615f7fb04720342ea65f3c30ea3a6a00b792/);
    assert.match(source,/simpy-4\.1\.1-py3-none-any\.whl/);
    assert.match(source,/sha256:7c5ae380240fd2238671160e4830956f8055830a8317edf5c05e495b3823cd88/);
    assert.match(source,/vendor\/sim_engine_compiler-0\.1\.0-cp312-abi3-manylinux_2_28_x86_64\.whl/);
    assert.match(source,/e7bcd9271dd42106b78e87176e3485b290536f5291c0440872b814fc549858f7  \/tmp\/sim_engine_compiler/);
    assert.match(source,/pip install --no-cache-dir --no-deps --no-index/);
    assert.match(source,/ln -s \/opt\/riffology\/python-compiler\/bin\/sim-engine \/usr\/bin\/sim-engine/);
    assert.match(source,/sim-engine --version/);
  }
  assert.equal(sources[0].match(/python-compiler/g)?.length,sources[1].match(/python-compiler/g)?.length);
});
