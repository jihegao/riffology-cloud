import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type { PiCheckpoint } from '../../services/runtime/controlled-pi.mjs';
import { recoveryRuntimeScript } from './runtime.ts';

const scope = { tenantId: 'tenant-m0', projectId: 'project-m0', sessionId: '11111111-1111-4111-8111-111111111111' };
const hostModuleUrl = new URL('../../services/runtime/controlled-pi.mjs', import.meta.url).href;
const seedMarker = 'M0_RECOVERY_SEED_ASSISTANT_CONTEXT';
const longMarker = 'M0_RECOVERY_INTERRUPTED_LONG_PROMPT';
const credential = 'm0-local-recovery-non-secret-credential';
interface Status {
  schemaVersion: 1;
  generation: number;
  stage: 'ready' | 'streaming' | 'completed' | 'failed';
  requestCount: number;
  contextRestored: boolean;
  contextSeenOnRecovery: boolean;
  streamStartedAt: number | null;
  eventTypes: string[];
  errorCode?: string;
}
interface ProcessResult { code: number | null; signal: NodeJS.Signals | null }
interface Fixture {
  directory: string;
  child: ChildProcess;
  exited: Promise<ProcessResult>;
  stderr(): string;
}

async function bounded<T>(promise: Promise<T>, duration: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Child process wait exceeded its test deadline')), duration);
    })]);
  } finally { clearTimeout(timer); }
}
async function json<T>(fixture: Fixture, name: string): Promise<T> {
  return JSON.parse(await readFile(join(fixture.directory, name), 'utf8')) as T;
}
async function launch(t: TestContext, config: unknown): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'riffology-m0-recovery-'));
  await writeFile(join(directory, 'runtime.mjs'), recoveryRuntimeScript(hostModuleUrl), { mode: 0o600 });
  await writeFile(join(directory, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  const child = spawn(process.execPath, [join(directory, 'runtime.mjs')], {
    cwd: directory,
    env: {
      PATH: process.env.PATH ?? '', HOME: join(directory, 'empty-home'), M0_RECOVERY_DIR: directory,
      NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { errors = (errors + chunk).slice(-8192); });
  child.stdout?.resume();
  const exited = new Promise<ProcessResult>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const fixture = { directory, child, exited, stderr: () => errors };
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await bounded(exited, 5000);
    await rm(directory, { recursive: true, force: true });
  });
  return fixture;
}
async function stage(fixture: Fixture, wanted: Status['stage'], duration = 15000): Promise<Status> {
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) {
    let value: Status | undefined;
    try { value = await json<Status>(fixture, 'status.json'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (value?.stage === wanted) return value;
    assert.notEqual(value?.stage, 'failed', JSON.stringify(value));
    assert.equal(fixture.child.exitCode, null, fixture.stderr());
    assert.equal(fixture.child.signalCode, null, fixture.stderr());
    await sleep(25);
  }
  assert.fail('Expected process stage ' + wanted + ' before bounded polling deadline: ' + fixture.stderr());
}
async function go(fixture: Fixture, content = 'ok'): Promise<void> {
  await writeFile(join(fixture.directory, 'go.tmp'), content, { mode: 0o600 });
  await rename(join(fixture.directory, 'go.tmp'), join(fixture.directory, 'go'));
}
async function kill(fixture: Fixture): Promise<void> {
  assert.equal(fixture.child.kill('SIGKILL'), true);
  assert.deepEqual(await bounded(fixture.exited, 5000), { code: null, signal: 'SIGKILL' });
}
async function assertPrivateArtifacts(fixture: Fixture): Promise<void> {
  for (const name of (await readdir(fixture.directory)).filter((entry) => /^(seed|status|final)\.json$/.test(entry))) {
    const source = await readFile(join(fixture.directory, name), 'utf8');
    assert.doesNotMatch(source, /authorization/i);
    assert.equal(source.includes(credential), false);
    assert.equal((await stat(join(fixture.directory, name))).mode & 0o077, 0);
    JSON.parse(source);
  }
  assert.equal((await readdir(fixture.directory)).some((entry) => entry.endsWith('.tmp')), false);
}

test('fixed recovery module accepts only a local host file URL', () => {
  assert.match(recoveryRuntimeScript(), /file:\/\/\/opt\/riffology\/services\/runtime\/controlled-pi\.mjs/);
  assert.throws(() => recoveryRuntimeScript('https://example.invalid/host.mjs'), /local file/);
  assert.throws(() => recoveryRuntimeScript('file://remote/host.mjs'), /local file/);
  assert.throws(() => recoveryRuntimeScript(hostModuleUrl + '?alternate=1'), /local file/);
});

test('independent real Pi process completes its gated SSE stream and writes atomic checkpoints', { timeout: 35000 }, async (t) => {
  const fixture = await launch(t, { generation: 1, scope, mode: 'initial' });
  const ready = await stage(fixture, 'ready');
  assert.equal(ready.schemaVersion, 1);
  assert.equal(ready.generation, 1);
  assert.equal(ready.requestCount, 1);
  assert.equal(ready.contextRestored, false);
  assert.equal(ready.streamStartedAt, null);
  const seed = await json<PiCheckpoint>(fixture, 'seed.json');
  assert.ok(JSON.stringify(seed).includes(seedMarker));
  assert.equal(JSON.stringify(seed).includes(longMarker), false);
  await go(fixture);
  const streaming = await stage(fixture, 'streaming');
  const streamingObservedAt = Date.now();
  assert.equal(streaming.requestCount, 2);
  assert.equal(typeof streaming.streamStartedAt, 'number');
  assert.ok(Number.isSafeInteger(streaming.streamStartedAt));
  assert.ok(streaming.streamStartedAt! <= streamingObservedAt);
  assert.ok(streamingObservedAt - streaming.streamStartedAt! < 2000);
  assert.ok(streaming.eventTypes.includes('message_update'));
  await assert.rejects(access(join(fixture.directory, 'final.json')), { code: 'ENOENT' });
  const completed = await stage(fixture, 'completed', 18000);
  assert.equal(completed.streamStartedAt, streaming.streamStartedAt);
  assert.ok(Date.now() - streaming.streamStartedAt! >= 12000);
  assert.equal(completed.requestCount, 2);
  assert.ok(completed.eventTypes.includes('agent_end'));
  assert.deepEqual(await bounded(fixture.exited, 5000), { code: 0, signal: null });
  assert.equal(fixture.stderr(), '');
  const final = await json<PiCheckpoint>(fixture, 'final.json');
  assert.ok(JSON.stringify(final).includes('M0_RECOVERY_LONG_COMPLETED'));
  assert.deepEqual(final.entries.slice(0, seed.entries.length), seed.entries);
  assert.deepEqual(await json(fixture, 'seed.json'), seed);
  await assertPrivateArtifacts(fixture);
});

test('SIGKILL loses the in-flight turn; a new real Pi process restores only the last confirmed seed', { timeout: 35000 }, async (t) => {
  const first = await launch(t, { generation: 10, scope, mode: 'initial' });
  await stage(first, 'ready');
  const seed = await json<PiCheckpoint>(first, 'seed.json');
  const seedBytes = await readFile(join(first.directory, 'seed.json'), 'utf8');
  await go(first);
  await stage(first, 'streaming');
  await kill(first);
  assert.equal(await readFile(join(first.directory, 'seed.json'), 'utf8'), seedBytes);
  assert.equal((await json<Status>(first, 'status.json')).stage, 'streaming');
  await assert.rejects(access(join(first.directory, 'final.json')), { code: 'ENOENT' });

  const recovered = await launch(t, { generation: 11, scope, mode: 'recovery', snapshot: seed });
  assert.notEqual(recovered.child.pid, first.child.pid);
  assert.notEqual(recovered.directory, first.directory);
  const ready = await stage(recovered, 'ready');
  assert.equal(ready.generation, 11);
  assert.equal(ready.requestCount, 0);
  assert.equal(ready.contextRestored, true);
  assert.equal(ready.contextSeenOnRecovery, false);
  assert.equal(ready.streamStartedAt, null);
  assert.deepEqual(await json(recovered, 'seed.json'), seed);
  assert.equal(await readFile(join(recovered.directory, 'seed.json'), 'utf8'), seedBytes);
  await go(recovered);
  const completed = await stage(recovered, 'completed');
  assert.equal(completed.requestCount, 1);
  assert.equal(completed.contextSeenOnRecovery, true, 'the actual HTTP fixture verified old assistant context');
  assert.deepEqual(await bounded(recovered.exited, 5000), { code: 0, signal: null });
  const final = await json<PiCheckpoint>(recovered, 'final.json');
  const finalSource = JSON.stringify(final);
  assert.ok(finalSource.includes(seedMarker));
  assert.ok(finalSource.includes('M0_RECOVERY_NEW_PROMPT'));
  assert.ok(finalSource.includes('M0_RECOVERY_RECOVERED_REPLY'));
  assert.equal(finalSource.includes(longMarker), false);
  assert.equal(final.entries.filter((entry) => entry.type === 'message' && entry.message.role === 'user').length, 2);
  assert.deepEqual(final.entries.slice(0, seed.entries.length), seed.entries);
  await assertPrivateArtifacts(first);
  await assertPrivateArtifacts(recovered);
});

test('without go the child dispatches no long prompt; malformed go fails closed', { timeout: 20000 }, async (t) => {
  const fixture = await launch(t, { generation: 20, scope, mode: 'initial' });
  await stage(fixture, 'ready');
  await sleep(400);
  const waiting = await json<Status>(fixture, 'status.json');
  assert.equal(waiting.stage, 'ready');
  assert.equal(waiting.requestCount, 1);
  assert.equal(fixture.child.exitCode, null);
  assert.equal(JSON.stringify(await json(fixture, 'seed.json')).includes(longMarker), false);
  await assert.rejects(access(join(fixture.directory, 'final.json')), { code: 'ENOENT' });
  await go(fixture, 'ok\n');
  const failed = await stage(fixture, 'failed');
  assert.equal(failed.errorCode, 'invalid_go');
  assert.equal(failed.requestCount, 1);
  assert.deepEqual(await bounded(fixture.exited, 5000), { code: 1, signal: null });
  await assertPrivateArtifacts(fixture);
});

test('cross-scope, damaged snapshots and invalid configuration fail before any provider request', { timeout: 35000 }, async (t) => {
  const source = await launch(t, { generation: 30, scope, mode: 'initial' });
  await stage(source, 'ready');
  const seed = await json<PiCheckpoint>(source, 'seed.json');
  await kill(source);
  const cycle = structuredClone(seed);
  cycle.entries[0]!.parentId = cycle.entries[0]!.id;
  const truncated = structuredClone(seed);
  truncated.entries.pop();
  const missingSeed = structuredClone(seed);
  const assistant = missingSeed.entries.find((entry) => entry.type === 'message' && entry.message.role === 'assistant');
  assert.ok(assistant?.type === 'message' && assistant.message.role === 'assistant');
  assistant.message.content = [{ type: 'text', text: 'corrupt-seed' }];
  const cases: Array<{ name: string; config: unknown; code: string }> = [
    { name: 'tenant mismatch', config: { generation: 31, scope: { ...scope, tenantId: 'tenant-other' }, mode: 'recovery', snapshot: seed }, code: 'invalid_snapshot' },
    { name: 'project mismatch', config: { generation: 32, scope: { ...scope, projectId: 'project-other' }, mode: 'recovery', snapshot: seed }, code: 'invalid_snapshot' },
    { name: 'session mismatch', config: { generation: 33, scope: { ...scope, sessionId: '22222222-2222-4222-8222-222222222222' }, mode: 'recovery', snapshot: seed }, code: 'invalid_snapshot' },
    { name: 'entry cycle', config: { generation: 34, scope, mode: 'recovery', snapshot: cycle }, code: 'invalid_snapshot' },
    { name: 'truncated graph', config: { generation: 35, scope, mode: 'recovery', snapshot: truncated }, code: 'invalid_snapshot' },
    { name: 'damaged seed', config: { generation: 36, scope, mode: 'recovery', snapshot: missingSeed }, code: 'invalid_snapshot' },
    { name: 'missing snapshot', config: { generation: 37, scope, mode: 'recovery' }, code: 'invalid_config' },
    { name: 'snapshot in initial', config: { generation: 38, scope, mode: 'initial', snapshot: seed }, code: 'invalid_config' },
    { name: 'zero generation', config: { generation: 0, scope, mode: 'initial' }, code: 'invalid_config' },
    { name: 'unknown config field', config: { generation: 39, scope, mode: 'initial', providerUrl: 'https://example.invalid' }, code: 'invalid_config' },
  ];
  for (const item of cases) {
    await t.test(item.name, async (subtest) => {
      const fixture = await launch(subtest, item.config);
      const failed = await stage(fixture, 'failed');
      assert.equal(failed.errorCode, item.code);
      assert.equal(failed.requestCount, 0);
      assert.deepEqual(await bounded(fixture.exited, 5000), { code: 1, signal: null });
      await assert.rejects(access(join(fixture.directory, 'seed.json')), { code: 'ENOENT' });
      await assert.rejects(access(join(fixture.directory, 'final.json')), { code: 'ENOENT' });
      await assertPrivateArtifacts(fixture);
    });
  }
});
