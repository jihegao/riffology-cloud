import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { externalPath, repositoryRoot, testPaths, preserveModel } from '../scripts/test-workspace.mjs';
import { exportAcceptance } from '../scripts/export-acceptance.mjs';

test('browser acceptance defaults outside the repository and rejects source-tree and symlink targets', async () => {
  const home = await realpath(await mkdtemp('/tmp/riffoid-test-home-'));
  const paths = await testPaths({ RIFFOID_IR_TEST_HOME: home });
  assert.equal(paths.workspace, join(home, 'workspaces/pi-web-acceptance'));
  assert.ok(paths.output.startsWith(join(home, 'results/riff-pi/')));
  await assert.rejects(testPaths({ RIFFOID_IR_TEST_WORKSPACE: repositoryRoot }), /outside/);
  await assert.rejects(testPaths({ RIFFOID_IR_TEST_OUTPUT: join(repositoryRoot, 'acceptance/results/raw') }), /outside/);
  await symlink(repositoryRoot, join(home, 'source-alias'));
  await assert.rejects(externalPath(join(home, 'source-alias/model')), /outside/);
});

test('acceptance restores current model bytes and removes only files absent before the test', async () => {
  const root = await mkdtemp('/tmp/riffoid-model-preserve-'), workspace = join(root, 'workspace'), output = join(root, 'raw');
  await mkdir(join(workspace, 'model'), { recursive: true }); await mkdir(output);
  const original = Buffer.from([0, 255, 13, 10, 42]);
  await writeFile(join(workspace, 'model/model.simpack'), original);
  await writeFile(join(workspace, 'model/business-ir.draft.json'), '{"user-model":"three days"}\n');
  await writeFile(join(workspace, 'model/notes.txt'), 'user notes');
  const saved = await preserveModel(workspace, output);
  await writeFile(join(workspace, 'model/model.simpack'), 'temporary B1');
  await writeFile(join(workspace, 'model/business-ir.draft.json'), '{"test-model":"B1"}');
  await writeFile(join(workspace, 'model/model-spec.json'), '{}');
  const restored = await saved.restore();
  assert.equal(restored.restored, true);
  assert.deepEqual(await readFile(join(workspace, 'model/model.simpack')), original);
  assert.equal(await readFile(join(workspace, 'model/business-ir.draft.json'), 'utf8'), '{"user-model":"three days"}\n');
  assert.equal(await readFile(join(workspace, 'model/notes.txt'), 'utf8'), 'user notes');
  assert.equal(await lstat(join(workspace, 'model/model-spec.json')).catch(() => undefined), undefined);
  const other = join(root, 'elsewhere'); await mkdir(other);
  const escaped = join(root, 'escaped-workspace'); await mkdir(escaped); await symlink(other, join(escaped, 'model'));
  await assert.rejects(preserveModel(escaped, output), /escapes/);
});

test('evidence export selects accepted files, records hashes, and excludes credentials, raw logs and model backups', async () => {
  const base = await mkdtemp('/tmp/riffoid-evidence-export-'), root = join(base, 'repo'), source = join(base, 'raw'), target = join(root, 'acceptance/results/pi-web/run');
  await mkdir(root); await mkdir(source);
  await writeFile(join(source, 'summary.json'), '{"status":"passed"}\n');
  await writeFile(join(source, 'baseline-record.json'), '{"runId":"saved-run","status":"succeeded"}\n');
  await writeFile(join(source, 'connection.json'), '{"token":"private-test-token"}');
  await writeFile(join(source, 'debug.log'), 'raw diagnostics');
  await mkdir(join(source, 'model-before'));
  const result = await exportAcceptance(source, target, { root });
  assert.equal(result.files, 2);
  assert.deepEqual((await readdir(target)).sort(), ['baseline-record.json', 'evidence-manifest.json', 'summary.json']);
  const manifest = JSON.parse(await readFile(join(target, 'evidence-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.skipped, ['connection.json', 'debug.log', 'model-before']);
  assert.equal(manifest.files.find(f => f.name === 'baseline-record.json').sha256.length, 64);
  assert.equal((await readFile(join(source, 'connection.json'), 'utf8')).includes('private-test-token'), true);
  await assert.rejects(exportAcceptance(source, target, { root }), /Preserving/);
  await assert.rejects(exportAcceptance(source, join(root, 'src/unsafe'), { root }), /below acceptance/);
  await writeFile(join(source, 'summary.json'), '{"status":"failed"}');
  await assert.rejects(exportAcceptance(source, join(root, 'acceptance/results/failed'), { root }), /completed acceptance/);
});
