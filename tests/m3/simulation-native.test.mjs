import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('simulation native wrapper compiles and keeps the finite-run protocol', async () => {
  const path = 'services/run/simulation_process.py';
  const source = await readFile(path, 'utf8');
  const check = spawnSync('python3', ['-m', 'py_compile', path], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  for (const text of ['model/model-spec.json', '--input', '--output', 'entrypointSha256', 'dependencyLockSha256', 'businessSha256', 'bundleSha256', 'sim-engine-compiler-0.1.0/v1', '/opt/riffology/python-compiler/bin/python3', 'compiler_model_adapter.py', 'simulation-archive-mismatch', 'fence.seal()', 'child_setup']) assert.ok(source.includes(text), text);
  assert.match(await readFile('services/run/Dockerfile.simulation', 'utf8'), /cloudflare\/sandbox:0\.12\.9-python@sha256:/);
  const dockerfile=await readFile('services/run/Dockerfile.simulation','utf8');
  assert.match(dockerfile,/python-compiler\/bin\/python3 -m pip install/);
  assert.doesNotMatch(dockerfile,/python-mesa\/bin\/python3 -m pip install[^\n]*sim_engine_compiler/);
  assert.match(dockerfile,/python-mesa\/bin\/python3 -c "[^\n]*sim-engine-compiler/);
});

test('trusted preexec report channel is closed before model exec and rejects wrong identity',()=>{const check=spawnSync('python3',['tests/m3/simulation_observation_unit.py'],{encoding:'utf8',timeout:10000});assert.equal(check.status,0,check.stderr);});

test('compiler adapter binds frozen sources and enforces the v2 result contract',()=>{const check=spawnSync('python3',['tests/m3/compiler_model_adapter_unit.py'],{encoding:'utf8',timeout:10000});assert.equal(check.status,0,check.stderr);});
