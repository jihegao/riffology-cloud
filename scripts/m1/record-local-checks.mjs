import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, sourceSnapshot } from '../m0/source-inventory.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runId = `m1-local-${new Date().toISOString().replaceAll(/[^0-9]/g, '')}`;
const runDir = resolve(root, 'docs/evidence/runs', runId);
mkdirSync(runDir, { recursive: true, mode: 0o700 });
const before = sourceSnapshot(root);
const startedAt = new Date().toISOString();
// M0 includes real local process/browser probes and the growing M2 suite now
// makes the full deterministic check exceed 90 seconds on this host.
const check = spawnSync('npm', ['run', 'check'], { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
const after = sourceSnapshot(root);
const output = `${check.stdout ?? ''}\n${check.stderr ?? ''}`;
writeFileSync(resolve(runDir, 'local-checks.log'), output, { flag: 'wx' });
const manifest = {
  schemaVersion: 1, runId, environment: 'local', startedAt, finishedAt: new Date().toISOString(),
  command: 'npm run check', exitCode: check.status, timedOut: check.error?.code === 'ETIMEDOUT',
  sourceStableDuringCheck: before.sha256 === after.sha256,
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  gitDirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
  sources: before,
  logSha256: hash(output),
  passed: check.status === 0 && before.sha256 === after.sha256,
  cloudGatePassed: false,
};
writeFileSync(resolve(runDir, 'local-checks.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ runId, runDir, passed: manifest.passed, exitCode: check.status, sourceStableDuringCheck: manifest.sourceStableDuringCheck, cloudGatePassed: false }, null, 2));
if (!manifest.passed) process.exitCode = 1;
