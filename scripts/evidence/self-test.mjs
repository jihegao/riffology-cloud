import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const cli = join(process.cwd(), 'scripts/evidence/recorder.mjs');
const root = await mkdtemp(join(tmpdir(), 'riffology-evidence-'));
const input = join(root, 'input.json');
const base = { gate_id: 'G0-T01', case_id: 'smoke', status: 'passed', observed_at: '2026-09-05T00:00:00Z', environment: 'staging', git_sha: '0123456789abcdef0123456789abcdef01234567', versions: { node: '22.x', image: 'sha256:redacted' }, command: 'node probe.mjs --redacted', evidence_paths: ['receipts/g0-t01.json'], conclusion: 'synthetic self-test' };

try {
  await writeFile(input, JSON.stringify(base));
  await mkdir(join(root, 'receipts'));
  await writeFile(join(root, 'receipts/g0-t01.json'), 'redacted evidence\n');
  const first = await run(process.execPath, [cli, 'record', '--input', input, '--root', root, '--run', 'self-test']);
  assert.match(first.stdout, /self-test/);
  await assert.rejects(run(process.execPath, [cli, 'record', '--input', input, '--root', root, '--run', 'self-test']), /refusing to overwrite/);
  const traversal = { ...base, case_id: 'traversal', evidence_paths: ['../outside.json'] };
  await writeFile(input, JSON.stringify(traversal));
  await assert.rejects(run(process.execPath, [cli, 'record', '--input', input, '--root', root, '--run', 'other']), /traversal-free/);
  await writeFile(input, JSON.stringify(base));
  const summary = await run(process.execPath, [cli, 'summarize', '--root', root, '--run', 'self-test']).catch(error => error);
  assert.equal(summary.code, 2);
  const saved = JSON.parse(await readFile(join(root, 'self-test', 'G0-T01-smoke.json'), 'utf8'));
  assert.equal(saved.status, 'passed');

  const summaryRecord = { ...base, case_id: 'gate-summary' };
  await writeFile(input, JSON.stringify(summaryRecord));
  await run(process.execPath, [cli, 'record', '--input', input, '--root', root, '--run', 'hash-test']);
  await writeFile(join(root, 'receipts/g0-t01.json'), 'tampered\n');
  const tampered = await run(process.execPath, [cli, 'summarize', '--root', root, '--run', 'hash-test']).catch(error => error);
  assert.match(tampered.stderr, /evidence hash mismatch/);

  await writeFile(join(root, 'receipts/g0-t01.json'), 'redacted evidence\n');
  await symlink(join(root, 'receipts/g0-t01.json'), join(root, 'receipts/link.json'));
  const symlinkInput = { ...base, case_id: 'symlink', evidence_paths: ['receipts/link.json'] };
  await writeFile(input, JSON.stringify(symlinkInput));
  await assert.rejects(run(process.execPath, [cli, 'record', '--input', input, '--root', root, '--run', 'symlink-test']), /regular file, not a symlink/);

  const mixed = { ...base, case_id: 'gate-summary', git_sha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd' };
  await writeFile(input, JSON.stringify(mixed));
  await run(process.execPath, [cli, 'record', '--input', input, '--root', root, '--run', 'mixed-test']);
  const mixedDetail = { ...base, case_id: 'detail', git_sha: '0123456789abcdef0123456789abcdef01234567' };
  await writeFile(input, JSON.stringify(mixedDetail));
  await run(process.execPath, [cli, 'record', '--input', input, '--root', root, '--run', 'mixed-test']);
  const mixedSummary = await run(process.execPath, [cli, 'summarize', '--root', root, '--run', 'mixed-test']).catch(error => error);
  assert.match(mixedSummary.stderr, /inconsistent git_sha/);

  const failRecord = { ...base, case_id: 'failed-detail', status: 'failed' };
  await writeFile(input, JSON.stringify(failRecord));
  await run(process.execPath, [cli, 'record', '--input', input, '--root', root, '--run', 'fail-test']);
  const passSummary = { ...base, case_id: 'gate-summary' };
  await writeFile(input, JSON.stringify(passSummary));
  await run(process.execPath, [cli, 'record', '--input', input, '--root', root, '--run', 'fail-test']);
  const blocked = await run(process.execPath, [cli, 'summarize', '--root', root, '--run', 'fail-test']).catch(error => error);
  assert.match(blocked.stdout, /"accepted": false/);

  const overwriteAttempt = { ...base, case_id: 'gate-summary', git_sha: '0123456789abcdef0123456789abcdef01234567' };
  await writeFile(input, JSON.stringify(overwriteAttempt));
  await assert.rejects(run(process.execPath, [cli, 'record', '--input', input, '--root', root, '--run', 'mixed-test']), /refusing to overwrite/);
  console.log('evidence self-test: passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
