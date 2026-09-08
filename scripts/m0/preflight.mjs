#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = process.cwd();
const TIMEOUT = 30_000;
const SECRET = /(token|secret|password|credential|private.?key|authorization)\s*[:=]?\s*[^\s,;]+/gi;

export function redactSummary(value) {
  return String(value ?? '').replace(SECRET, '$1=[redacted]').replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted]').slice(0, 240);
}

export function classifyCloudError(text, code = 1) {
  const s = String(text ?? '').toLowerCase();
  if (/r2.*(?:disabled|not enabled|enable r2)|enable r2.*dashboard|code\s*:\s*10042/.test(s)) return 'r2-disabled';
  if (/(?:paid[- ]plan|workers paid|paid.*plan|plan.*paid)/.test(s)) return 'paid-plan-required';
  if (/unauth|not logged|login|api token|authentication/.test(s)) return 'auth-required';
  return code === 0 ? null : 'unknown';
}

export function checkVersion(actual, expected) {
  return actual === expected ? 'passed' : 'failed';
}

function command(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 1024 * 1024, ...options });
  const timedOut = result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM';
  return { code: result.status ?? 1, timedOut, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.code ?? null };
}

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return { name: 'node', status: major > 22 || (major === 22 && minor >= 19) ? 'passed' : 'failed', version: process.versions.node, requirement: '>=22.19' };
}

function checkDependencies() {
  const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(resolve(cwd, 'package-lock.json'), 'utf8'));
  const wanted = { ...pkg.dependencies, ...pkg.devDependencies };
  const names = ['@earendil-works/pi-coding-agent', '@earendil-works/pi-server', '@cloudflare/sandbox', 'wrangler', 'typescript'];
  const versions = {};
  const mismatches = [];
  for (const name of names) {
    const expected = wanted[name];
    const lockVersion = lock.packages?.[`node_modules/${name}`]?.version;
    let installed;
    try { installed = JSON.parse(readFileSync(resolve(cwd, 'node_modules', name, 'package.json'), 'utf8')).version; } catch { installed = null; }
    versions[name] = { expected, lock: lockVersion ?? null, installed };
    if (!expected || lockVersion !== expected || installed !== expected) mismatches.push(name);
  }
  return { name: 'dependencies', status: mismatches.length ? 'failed' : 'passed', versions, mismatches };
}

function checkDocker() {
  const cli = command('which', ['docker']);
  if (cli.code !== 0 || cli.timedOut) return { name: 'docker', status: 'blocked', reason: 'cli-missing' };
  const result = command('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (result.code !== 0 || result.timedOut) return { name: 'docker', status: 'blocked', reason: result.timedOut ? 'timeout' : 'daemon-unavailable' };
  return { name: 'docker', status: 'passed', serverVersion: result.stdout.trim().split(/\r?\n/)[0].slice(0, 80) };
}

function gitCheck() {
  let sha = null;
  try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', timeout: TIMEOUT }).trim(); } catch { /* reported below */ }
  const dirty = command('git', ['status', '--porcelain']).stdout.trim().length > 0;
  const lock = resolve(cwd, 'package-lock.json');
  const lockSha256 = existsSync(lock) ? createHash('sha256').update(readFileSync(lock)).digest('hex') : null;
  return { name: 'git', status: sha ? 'passed' : 'blocked', head: sha, dirty, packageLockSha256: lockSha256 };
}

function cloudCheck() {
  const checks = [];
  for (const [name, args] of [['whoami', ['whoami', '--json']], ['containers', ['containers', 'list', '--json']], ['r2', ['r2', 'bucket', 'list']]]) {
    const result = command('npx', ['wrangler', ...args]);
    const combined = `${result.stdout}\n${result.stderr}`;
    let parsed = null;
    try { parsed = JSON.parse(result.stdout); } catch { /* output is summarized below */ }
    const success = typeof parsed?.success === 'boolean' ? parsed.success : result.code === 0;
    let accountId = null;
    const match = combined.match(/(?:account(?:Id|_id)|id)\s*[:=]\s*["']?([a-f0-9]{32})/i);
    if (match) accountId = match[1];
    const errorType = classifyCloudError(combined, result.code);
    checks.push({ name, success, status: success ? 'passed' : (errorType === 'unknown' ? 'failed' : 'blocked'), exitCode: result.code, accountId, errorType, stderr: success ? undefined : redactSummary(result.stderr) });
  }
  return { enabled: true, checks };
}

export function runPreflight({ cloud = false } = {}) {
  const result = { schemaVersion: 1, observedAt: new Date().toISOString(), cwd, mode: cloud ? 'cloud' : 'local', checks: [checkNode(), checkDependencies(), checkDocker(), gitCheck()] };
  if (cloud) result.cloud = cloudCheck();
  const all = [...result.checks, ...(result.cloud?.checks ?? [])];
  result.overallStatus = all.some(check => check.status === 'failed') ? 'failed' : all.some(check => check.status === 'blocked') ? 'blocked' : 'pass';
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const cloud = args.includes('--cloud');
  const outputArg = args.find(arg => arg.startsWith('--output='));
  const result = runPreflight({ cloud });
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (outputArg) {
    const target = resolve(cwd, outputArg.slice('--output='.length));
    if (isAbsolute(outputArg.slice('--output='.length)) && target !== resolve(outputArg.slice('--output='.length))) throw new Error('invalid output path');
    writeFileSync(target, text, { flag: 'wx', mode: 0o600 });
  } else process.stdout.write(text);
  if (result.overallStatus === 'failed' || result.overallStatus === 'blocked') process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`m0 preflight: ${redactSummary(error.message)}`); process.exitCode = 1; }
}
