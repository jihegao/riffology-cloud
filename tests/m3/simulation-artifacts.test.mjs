import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const invoke = (root, result) => new Promise((resolve, reject) => {
  const child = spawn('python3', ['-c', 'import json,sys; from services.run.simulation_artifacts import collect_outputs; print(json.dumps(collect_outputs(json.loads(sys.argv[1]), sys.argv[2]), separators=(",",":")))', JSON.stringify(result), root], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
  child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err || `python-exit-${code}`)));
});

const rejected = (root, result) => assert.rejects(invoke(root, result));

test('collects bounded outputs with digest, base64 and media type', async () => {
  const root = await mkdtemp(join(tmpdir(), 'simulation-artifacts-'));
  await writeFile(join(root, 'metrics.csv'), 'a,b\n1,2\n');
  const result = await invoke(root, { schemaVersion: 1, metrics: { score: 2 }, outputs: ['metrics.csv'] });
  assert.deepEqual(result.metrics, { score: 2 });
  assert.equal(result.outputs[0].path, 'metrics.csv');
  assert.equal(result.outputs[0].mediaType, 'text/csv');
  assert.equal(result.outputs[0].size, 8);
  assert.equal(Buffer.from(result.outputs[0].data, 'base64').toString(), 'a,b\n1,2\n');
});

test('leaves results without outputs unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'simulation-artifacts-'));
  const result = { schemaVersion: 1, metrics: { score: 2 } };
  assert.deepEqual(await invoke(root, result), result);
});

test('rejects result.json, symlinks, hardlinks and oversized declarations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'simulation-artifacts-'));
  await writeFile(join(root, 'safe.txt'), 'safe');
  await symlink('safe.txt', join(root, 'link.txt'));
  await rejected(root, { schemaVersion: 1, metrics: {}, outputs: ['result.json'] });
  await rejected(root, { schemaVersion: 1, metrics: {}, outputs: ['link.txt'] });
  await link(join(root, 'safe.txt'), join(root, 'copy.txt'));
  await rejected(root, { schemaVersion: 1, metrics: {}, outputs: ['copy.txt'] });
  await rejected(root, { schemaVersion: 1, metrics: {}, outputs: ['missing.txt'] });
  await rejected(root, { schemaVersion: 1, metrics: {}, outputs: ['bad.json/'] });
  await rejected(root, { schemaVersion: 1, metrics: {}, outputs: Array.from({ length: 5 }, (_, i) => `x${i}.txt`) });
});

test('rejects per-file and aggregate byte limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'simulation-artifacts-'));
  await writeFile(join(root, 'large.txt'), Buffer.alloc(16_385, 65));
  await rejected(root, { schemaVersion: 1, metrics: {}, outputs: ['large.txt'] });
  for (let i = 0; i < 3; i++) await writeFile(join(root, `part${i}.txt`), Buffer.alloc(12_000, 65));
  await rejected(root, { schemaVersion: 1, metrics: {}, outputs: ['part0.txt', 'part1.txt', 'part2.txt'] });
});
