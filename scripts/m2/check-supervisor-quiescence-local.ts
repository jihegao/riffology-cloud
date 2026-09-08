import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqlProjectEffectSupervisor, type ProjectEffectSupervisorStorage } from '../../services/project-tools/supervisor.ts';
import { SandboxNativeProjectEffectPort, type ProjectSandboxProcessApi, type SandboxProcessView } from '../../services/project-tools/native.ts';
import type { ProjectEffectStart } from '../../services/project-tools/effect.ts';

// Docker implements the SDK-shaped transport only. Supervisor, native adapter,
// effect wrapper, UID stop domain and archive program are production sources.
// Uses only an existing local image, no model, network, pull, or deployment.
const image = process.env.RIFFOLOGY_PROJECT_TEST_IMAGE ?? 'riffology-project-bash-local:current';
const directory = mkdtempSync(join(tmpdir(), 'm2-supervisor-quiescence-'));
const container = `riff-supervisor-${crypto.randomUUID()}`;
let created = false;
let db: DatabaseSync | undefined;
const processes = new Map<string, { view: SandboxProcessView; child: ChildProcess; stdout: string; stderr: string; done: Promise<void> }>();
function docker(args: string[], input?: string) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 20_000, maxBuffer: 5 * 1024 * 1024 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function python(source: string) { return docker(['exec', '-i', container, 'python3', '-'], source); }
async function until(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) { assert.ok(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 25)); }
}
let effectStarts = 0, sealStarts = 0, loseStart = true, loseProof = true;
const api: ProjectSandboxProcessApi = {
  async writeFile(path, content) {
    python(`from pathlib import Path\np=Path(${JSON.stringify(path)})\np.write_text(${JSON.stringify(content)})\np.chmod(0o600)\n`);
    return { success: true, path, bytesWritten: Buffer.byteLength(content) };
  },
  async readFile(path) { return { success: true, path, content: python(`from pathlib import Path\nimport sys\nsys.stdout.write(Path(${JSON.stringify(path)}).read_text())\n`) }; },
  async startProcess(command, options) {
    const id = options?.processId;
    assert.ok(id); assert.ok(!processes.has(id), 'SDK process id must be unique');
    const effect = command.startsWith('python3 /opt/riffology/effect_wrapper.py ');
    assert.ok(effect || command === 'python3 /opt/riffology/process_quiescence.py seal');
    if (effect) effectStarts++; else sealStarts++;
    const args = ['exec', '--workdir', options?.cwd ?? '/'];
    for (const [key, value] of Object.entries(options?.env ?? {})) if (value !== undefined) args.push('--env', `${key}=${value}`);
    args.push(container, '/bin/sh', '-c', command);
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let status: SandboxProcessView['status'] = 'running', exitCode: number | undefined;
    const view: SandboxProcessView = { id, get status() { return status; }, get exitCode() { return exitCode; }, async getStatus() { return status; } };
    const record = { view, child, stdout: '', stderr: '', done: Promise.resolve() };
    child.stdout.on('data', value => { record.stdout += value.toString(); });
    child.stderr.on('data', value => { record.stderr += value.toString(); });
    record.done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => { exitCode = code ?? undefined; status = code === 0 ? 'completed' : 'failed'; resolve(); });
    });
    processes.set(id, record);
    if (effect && loseStart) {
      loseStart = false;
      await until(() => python("from pathlib import Path\nprint(Path('/workspace/model/ready').exists())\n").trim() === 'True', 'real effect must run before losing start response');
      throw Error('injected-native-start-response-lost');
    }
    return view;
  },
  async getProcess(id) { return processes.get(id)?.view ?? null; },
  async getProcessLogs(id) {
    const record = processes.get(id); assert.ok(record);
    if (id.startsWith('project-seal-') && loseProof) { loseProof = false; throw Error('injected-stop-proof-response-lost'); }
    return { stdout: record.stdout, stderr: record.stderr, processId: id };
  },
};
function reopen() {
  db?.close(); db = new DatabaseSync(join(directory, 'supervisor.db'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  const connection = db;
  const storage = {
    sql: { exec(query: string, ...bindings: (string | number | null)[]) {
      if (query.includes('CREATE TABLE')) { connection.exec(query); return { toArray: () => [] }; }
      const statement = connection.prepare(query);
      const rows = statement.columns().length ? statement.all(...bindings) : (statement.run(...bindings), []);
      return { toArray: () => structuredClone(rows) };
    } },
    transactionSync<T>(fn: () => T) { connection.exec('BEGIN IMMEDIATE'); try { const value = fn(); connection.exec('COMMIT'); return value; } catch (error) { connection.exec('ROLLBACK'); throw error; } },
    async sync() { connection.exec('PRAGMA wal_checkpoint(FULL)'); },
  } as unknown as ProjectEffectSupervisorStorage;
  return new SqlProjectEffectSupervisor(storage, new SandboxNativeProjectEffectPort(api));
}
try {
  docker(['run', '-d', '--pull=never', '--network=none', '--name', container, '--entrypoint', '/bin/sh', '--mount', `type=bind,source=${resolve('services/project-tools')},target=/opt/riffology,readonly`, image, '-c', 'sleep 120']);
  created = true;
  python("from pathlib import Path\nPath('/var/lib/riffology/archives/'+('b'*52)+'.input.tar').write_bytes(bytes(10240))\n");
  const restored = JSON.parse(docker(['exec', container, 'python3', '/opt/riffology/platform_workspace_archive.py', 'restore', 'b'.repeat(52)]));
  assert.equal(restored.ok, true);
  python("import os\nos.makedirs('/workspace/model',exist_ok=True)\nos.chown('/workspace/model',10001,10001)\n");
  const request: ProjectEffectStart = {
    effectId: 'lost-start', program: '/opt/riffology/file_service.py', argv: [], cwd: '/workspace',
    env: { LANG: 'C.UTF-8', PATH: '/usr/bin:/bin', RIFFOLOGY_WORKSPACE_ROOT: '/workspace' }, timeoutMs: 60_000,
    stdin: JSON.stringify({ deadlineAt: Date.now() + 60_000, operation: 'bash', arguments: { script: "printf once >> model/executions; printf ready > model/ready; while :; do printf tick >> model/writes; sleep 0.05; done", timeoutMs: 30_000 } }),
  };
  let supervisor = reopen();
  await assert.rejects(supervisor.start(request), /injected-native-start-response-lost/);
  assert.equal((await supervisor.start(request)).phase, 'unknown');
  await assert.rejects(supervisor.sealForCheckpoint(), /injected-stop-proof-response-lost/);
  assert.equal(sealStarts, 1);
  assert.equal(python("import sys\nsys.path.insert(0,'/opt/riffology')\nimport process_quiescence as q\nprint(q.live_project_pids())\n").trim(), '[]');
  supervisor = reopen();
  await assert.rejects(supervisor.start({ ...request, effectId: 'after-restart' }), /project-effects-sealed/);
  assert.equal((await supervisor.start(request)).phase, 'unknown');
  assert.equal(effectStarts, 1);
  assert.equal(python("from pathlib import Path\nprint(Path('/workspace/model/executions').read_text())\n").trim(), 'once');
  await supervisor.sealForCheckpoint();
  assert.equal(sealStarts, 2, 'restart must freshly recheck native quiescence');
  assert.equal((await supervisor.start(request)).phase, 'unknown', 'stop proof is not an effect completion receipt');
  const report = JSON.parse(docker(['exec', container, 'python3', '/opt/riffology/platform_workspace_archive.py', 'freeze', 'b'.repeat(52)]));
  assert.equal(report.ok, true); assert.equal(report.operation, 'freeze'); assert.ok(report.bytes > 0);
  const frozenWrites = python("from pathlib import Path\nprint(Path('/workspace/model/writes').stat().st_size)\n");
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(python("from pathlib import Path\nprint(Path('/workspace/model/writes').stat().st_size)\n"), frozenWrites);
  await Promise.all([...processes.values()].map(record => record.done));
  console.log(JSON.stringify({ passed: true, transport: 'Docker SDK-shaped adapter; not Cloudflare Sandbox SDK', effectStarts, sealStarts, archiveBytes: report.bytes, checks: ['real-effect-running-before-start-response-loss', 'stop-proof-response-loss', 'sqlite-close-reopen', 'persistent-admission-fence', 'no-second-effect-execution', 'unknown-outcome-preserved', 'fresh-quiescence-proof', 'real-archive-freeze', 'writes-stopped'] }));
} finally {
  db?.close();
  if (created) docker(['rm', '-f', container]);
  rmSync(directory, { recursive: true, force: true });
}
