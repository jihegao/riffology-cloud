#!/usr/bin/env node
import { mkdir, readFile, readdir, realpath, lstat, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const GATES = Array.from({ length: 10 }, (_, i) => `G0-T${String(i + 1).padStart(2, '0')}`);
const STATUSES = new Set(['passed', 'failed', 'blocked', 'not_run']);
const ENVIRONMENTS = new Set(['local', 'staging']);
const DEFAULT_ROOT = resolve('docs/evidence/runs');

function fail(message) {
  throw new Error(message);
}

function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) out._.push(arg);
    else {
      const [key, inline] = arg.slice(2).split('=', 2);
      out[key] = inline ?? args[++i];
    }
  }
  return out;
}

function stringField(value, name) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${name} must be a non-empty string`);
  return value.trim();
}

function safeRelativePath(value, name = 'evidence_path') {
  const p = stringField(value, name);
  if (isAbsolute(p) || p.includes('\\') || p.split('/').some(part => part === '..' || part === '')) {
    fail(`${name} must be a non-absolute, traversal-free relative path`);
  }
  if (p.startsWith('.') || /(^|\/)(?:\.env|.*(?:secret|token|password|credential|private[_-]?key).*)/i.test(p)) {
    fail(`${name} must identify a redacted evidence path and must not name secrets`);
  }
  return p;
}

function validateRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('record must be a JSON object');
  const gate_id = stringField(input.gate_id, 'gate_id');
  if (!GATES.includes(gate_id)) fail(`gate_id must be one of ${GATES.join(', ')}`);
  const case_id = stringField(input.case_id, 'case_id');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(case_id)) fail('case_id contains unsupported characters');
  const status = stringField(input.status, 'status');
  if (!STATUSES.has(status)) fail('status must be passed, failed, blocked, or not_run');
  const observed_at = stringField(input.observed_at, 'observed_at');
  if (Number.isNaN(Date.parse(observed_at)) || !/[zZ]|[+-]\d\d:\d\d$/.test(observed_at)) fail('observed_at must be an ISO timestamp with timezone');
  const environment = stringField(input.environment, 'environment');
  if (!ENVIRONMENTS.has(environment)) fail('environment must be local or staging');
  const git_sha = stringField(input.git_sha, 'git_sha');
  if (!/^[0-9a-f]{7,64}$/i.test(git_sha)) fail('git_sha must be a hexadecimal commit SHA');
  const command = stringField(input.command, 'command');
  const conclusion = stringField(input.conclusion, 'conclusion');
  if (/(?:AKIA|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|password\s*=|token\s*=|secret\s*=)/i.test(`${command} ${conclusion}`)) fail('command/conclusion appear to contain a secret; record a redacted description');
  if (!Array.isArray(input.evidence_paths) || input.evidence_paths.length === 0) fail('evidence_paths must be a non-empty array of redacted relative paths');
  const evidence_paths = input.evidence_paths.map(path => safeRelativePath(path));
  if (input.evidence_sha256 !== undefined) {
    if (!Array.isArray(input.evidence_sha256) || input.evidence_sha256.length !== evidence_paths.length || input.evidence_sha256.some(hash => typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash))) fail('evidence_sha256 must contain one SHA-256 per evidence path');
  }
  const versions = input.versions ?? input.dependencies;
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) fail('versions (dependency/image versions) must be an object');
  for (const [key, value] of Object.entries(versions)) {
    stringField(key, 'version name');
    stringField(value, `versions.${key}`);
    if (/(?:secret|token|password|private.?key)/i.test(key)) fail('versions contains a secret-like field name');
  }
  return { gate_id, case_id, status, observed_at, environment, git_sha: git_sha.toLowerCase(), versions, command, evidence_paths, evidence_sha256: input.evidence_sha256?.map(hash => hash.toLowerCase()), conclusion };
}

function runId() {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(6).toString('hex')}`;
}

function contained(root, child) {
  const rel = relative(root, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function record(args) {
  const inputPath = args.input;
  if (!inputPath) fail('record requires --input FILE');
  const root = resolve(args.root ?? DEFAULT_ROOT);
  const recordData = validateRecord(JSON.parse(await readFile(resolve(inputPath), 'utf8')));
  const id = args.run ?? runId();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) fail('run id contains unsupported path characters');
  const runDir = resolve(root, id);
  if (!contained(root, runDir)) fail('run directory escapes evidence root');
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  const realRoot = await realpath(root);
  const realRunDir = await realpath(runDir);
  if (!contained(realRoot, realRunDir)) fail('run directory resolves outside evidence root');
  const resolvedEvidence = [];
  for (const evidencePath of recordData.evidence_paths) {
    const candidate = resolve(realRoot, evidencePath);
    if (!contained(realRoot, candidate)) fail(`evidence path escapes evidence root: ${evidencePath}`);
    const info = await lstat(candidate).catch(() => null);
    if (!info || !info.isFile() || info.isSymbolicLink()) fail(`evidence path must be an existing regular file, not a symlink: ${evidencePath}`);
    const actual = await realpath(candidate);
    if (!contained(realRoot, actual)) fail(`evidence path resolves outside evidence root: ${evidencePath}`);
    resolvedEvidence.push({ path: evidencePath, sha256: createHash('sha256').update(await readFile(candidate)).digest('hex') });
  }
  if (recordData.evidence_sha256 && recordData.evidence_sha256.some((hash, i) => hash !== resolvedEvidence[i].sha256)) fail('evidence_sha256 does not match evidence file');
  recordData.evidence_sha256 = resolvedEvidence.map(item => item.sha256);
  const output = resolve(runDir, `${recordData.gate_id}-${recordData.case_id}.json`);
  if (!contained(runDir, output)) fail('record path escapes run directory');
  const payload = { schema_version: 1, run_id: id, recorded_at: new Date().toISOString(), ...recordData };
  try { await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') fail(`refusing to overwrite existing run record: ${output}`); throw error; }
  console.log(JSON.stringify({ run_id: id, path: output, record: payload }, null, 2));
}

async function summarize(args) {
  if (!args.run) fail('summarize requires --run RUN_ID');
  const root = resolve(args.root ?? DEFAULT_ROOT);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(args.run)) fail('run id contains unsupported path characters');
  const runDir = resolve(root, args.run);
  if (!contained(root, runDir)) fail('run directory escapes evidence root');
  const names = (await readdir(runDir)).filter(name => name.endsWith('.json'));
  const records = [];
  let baseline;
  for (const name of names) {
    const path = resolve(runDir, name);
    if (!contained(runDir, path) || (await stat(path)).isDirectory()) continue;
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (parsed.run_id !== args.run || parsed.schema_version !== 1) fail(`invalid run_id or schema_version in ${name}`);
    const record = validateRecord(parsed);
    const realRoot = await realpath(root);
    for (const [i, evidencePath] of record.evidence_paths.entries()) {
      const candidate = resolve(realRoot, evidencePath);
      const info = await lstat(candidate).catch(() => null);
      if (!info || !info.isFile() || info.isSymbolicLink() || !contained(realRoot, await realpath(candidate))) fail(`invalid evidence file: ${evidencePath}`);
      const digest = createHash('sha256').update(await readFile(candidate)).digest('hex');
      if (digest !== record.evidence_sha256?.[i]) fail(`evidence hash mismatch: ${evidencePath}`);
    }
    if (!baseline) baseline = { git_sha: record.git_sha, versions: JSON.stringify(record.versions) };
    if (record.git_sha !== baseline.git_sha || JSON.stringify(record.versions) !== baseline.versions) fail(`inconsistent git_sha or versions in ${name}`);
    records.push(record);
  }
  const byGate = Object.fromEntries(GATES.map(gate => [gate, records.filter(r => r.gate_id === gate)]));
  const stagingPassed = GATES.filter(gate => byGate[gate].some(r => r.environment === 'staging' && r.case_id === 'gate-summary' && r.status === 'passed') && byGate[gate].every(r => r.environment !== 'staging' || r.status === 'passed'));
  const missing = GATES.filter(gate => !stagingPassed.includes(gate));
  const result = { schema_version: 1, run_id: args.run, gate_count: GATES.length, staging_passed: stagingPassed, missing_staging_passed: missing, accepted: missing.length === 0, local_is_supplementary: true };
  console.log(JSON.stringify(result, null, 2));
  if (!result.accepted) process.exitCode = 2;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args._[0] === 'record') await record(args);
  else if (args._[0] === 'summarize') await summarize(args);
  else fail('usage: recorder.mjs record --input FILE [--root DIR] [--run ID] | summarize --run ID [--root DIR]');
} catch (error) {
  console.error(`evidence recorder: ${error.message}`);
  process.exitCode = 1;
}
