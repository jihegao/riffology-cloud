import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('simulation native wrapper compiles and keeps the finite-run protocol', async () => {
  const path = 'services/run/simulation_process.py';
  const source = await readFile(path, 'utf8');
  const check = spawnSync('python3', ['-m', 'py_compile', path], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  for (const text of ['model/model-spec.json', '--input', '--output', 'entrypointSha256', 'dependencyLockSha256', 'simulation-archive-mismatch', 'fence.seal()', 'child_setup']) assert.ok(source.includes(text), text);
  assert.match(await readFile('services/run/Dockerfile.simulation', 'utf8'), /cloudflare\/sandbox:0\.12\.9-python@sha256:/);
});

test('trusted preexec report channel is closed before model exec and rejects wrong identity',()=>{const check=spawnSync('python3',['tests/m3/simulation_observation_unit.py'],{encoding:'utf8',timeout:10000});assert.equal(check.status,0,check.stderr);});
