import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { parseArguments, runChild } from '../../../scripts/m0/proxy-pi-local.mjs';

test('Pi diagnostic CLI refuses arbitrary destinations and unknown child modes before reading input', () => {
  for (const args of [[], ['--origin', 'https://opencode.ai'], ['--secrets-file', 'x', '--origin', 'https://opencode.ai']]) {
    assert.throws(() => parseArguments(args));
  }
  const secret = 'fixture-secret-must-not-appear-in-errors';
  const child = spawnSync(process.execPath, ['scripts/m0/proxy-pi-child.mjs', '--live'], {
    input: secret, encoding: 'utf8', timeout: 3000,
  });
  assert.equal(child.status, 1); assert.equal(child.stdout, ''); assert.ok(!child.stderr.includes(secret));
});

test('Pi diagnostic child rejects oversized input without reflecting credentials', () => {
  const secret = 'fixture-secret-must-not-appear-in-errors';
  const child = spawnSync(process.execPath, ['scripts/m0/proxy-pi-child.mjs', '--local-fixture'], {
    input: JSON.stringify({ secret, padding: 'x'.repeat(70000) }), encoding: 'utf8', timeout: 3000,
  });
  assert.equal(child.status, 1); assert.equal(child.stdout, ''); assert.ok(!child.stderr.includes(secret));
});

test('supervisor timeout waits for actual child close and reports forced termination', async () => {
  await assert.rejects(runChild({}, 1), (error) => {
    assert.equal(error.message, 'child-diagnostic-failed');
    assert.equal(error.process.closed, true); assert.equal(error.process.timedOut, true);
    assert.equal(error.cleanup.trustedDirectoryRemoved, true);
    assert.equal(error.process.signal, 'SIGKILL'); return true;
  });
});
