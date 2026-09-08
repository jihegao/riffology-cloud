import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCheckpoint, restoreCheckpoint, type Blobs, type Authority, type Receipt, type Entry } from '../../spikes/m0-storage/checkpoint.ts';

class MemoryBlobs implements Blobs {
  values = new Map<string, Uint8Array>();
  failOnPut = 0;
  puts = 0;
  async putIfAbsent(key: string, value: Uint8Array) {
    if (++this.puts === this.failOnPut) throw new Error('injected upload failure');
    if (!this.values.has(key)) this.values.set(key, Uint8Array.from(value));
  }
  async get(key: string) { return this.values.has(key) ? Uint8Array.from(this.values.get(key)!) : null; }
}
class MemoryAuthority implements Authority {
  generation = 1;
  receipt: Receipt | null = null;
  events: Receipt[] = [];
  interruptBeforeCommit = false;
  loseResponse = false;
  async current() { return this.receipt; }
  async commit(input: { revision: string; parent: string | null; generation: number }) {
    if (this.interruptBeforeCommit) throw new Error('injected crash before commit');
    if (input.generation !== this.generation) throw new Error('stale generation');
    if (this.receipt?.revision === input.revision) return this.receipt;
    if ((this.receipt?.revision ?? null) !== input.parent) throw new Error('parent conflict');
    this.receipt = { revision: input.revision, generation: input.generation, sequence: this.events.length + 1 };
    this.events.push(this.receipt);
    if (this.loseResponse) throw new Error('injected lost response after commit');
    return this.receipt;
  }
}
const utf8 = (s: string) => new TextEncoder().encode(s);
function fixture() {
  const entries: Entry[] = [{ path: 'model', kind: 'directory', mode: 0o755 }, { path: 'model/a.py', kind: 'file', mode: 0o644, bytes: utf8('print(1)') }];
  return { blobs: new MemoryBlobs(), authority: new MemoryAuthority(), entries, session: utf8('trusted session'), generation: 1, parent: null as string | null };
}
test('20 sequential CRUD-like tree changes preserve content, permissions and removals after restore', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) {
    f.entries = [{ path: 'model', kind: 'directory', mode: 0o755 }, { path: `model/renamed-${i}.py`, kind: 'file', mode: i % 2 ? 0o755 : 0o644, bytes: utf8(`print(${i})`) }];
    const receipt = await saveCheckpoint(f);
    const restored = await restoreCheckpoint(f.blobs, receipt.revision);
    assert.deepEqual(restored.entries, f.entries);
    assert.deepEqual(restored.session, f.session);
    f.parent = receipt.revision;
  }
  assert.equal(f.authority.events.length, 20);
});
test('upload interruption and precommit crash leave last confirmed revision unchanged', async () => {
  const f = fixture();
  const first = await saveCheckpoint(f);
  f.parent = first.revision;
  f.entries[1] = { path: 'model/new.py', kind: 'file', mode: 0o600, bytes: utf8('changed') };
  f.blobs.failOnPut = f.blobs.puts + 2;
  await assert.rejects(saveCheckpoint(f), /upload failure/);
  assert.deepEqual(await f.authority.current(), first);
  f.blobs.failOnPut = 0;
  f.authority.interruptBeforeCommit = true;
  await assert.rejects(saveCheckpoint(f), /before commit/);
  assert.deepEqual(await f.authority.current(), first);
  assert.equal(f.authority.events.length, 1);
  assert.equal((await restoreCheckpoint(f.blobs, first.revision)).entries[1].path, 'model/a.py');
});
test('lost response replays one durable receipt, never a second saved event', async () => {
  const f = fixture();
  f.authority.loseResponse = true;
  await assert.rejects(saveCheckpoint(f), /lost response/);
  f.authority.loseResponse = false;
  const recovered = await saveCheckpoint(f);
  assert.equal(recovered.sequence, 1);
  assert.equal(f.authority.events.length, 1);
});
test('stale runtime and stale parent cannot replace confirmed state', async () => {
  const f = fixture();
  await saveCheckpoint(f);
  f.entries = [{ path: 'other', kind: 'file', mode: 0o644, bytes: utf8('x') }];
  await assert.rejects(saveCheckpoint(f), /parent conflict/);
  f.authority.generation = 2;
  await assert.rejects(saveCheckpoint(f), /stale generation/);
  assert.equal(f.authority.events.length, 1);
});
test('two actual concurrent saves with one parent yield one commit and one conflict', async () => {
  const f = fixture();
  const first = await saveCheckpoint(f);
  const next = { ...f, parent: first.revision };
  const competing = { ...next, entries: [{ path: 'different.py', kind: 'file', mode: 0o644, bytes: utf8('different writer') }] as Entry[] };
  const results = await Promise.allSettled([saveCheckpoint(next), saveCheckpoint(competing)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find(r => r.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && /parent conflict/.test(rejected.reason.message));
  assert.equal(f.authority.events.length, 2);
});
test('restore rejects corrupted or missing objects', async () => {
  const f = fixture();
  const receipt = await saveCheckpoint(f);
  const key = [...f.blobs.values.keys()].find(k => k.startsWith('blobs/'))!;
  f.blobs.values.set(key, utf8('corrupt'));
  await assert.rejects(restoreCheckpoint(f.blobs, receipt.revision), /corrupt/);
  f.blobs.values.delete(key);
  await assert.rejects(restoreCheckpoint(f.blobs, receipt.revision), /missing/);
});
test('reject traversal, links, duplicate paths, special mode, and file ancestors before upload', async () => {
  for (const entry of [
    { path: '../escape', kind: 'file', mode: 0o644, bytes: utf8('x') },
    { path: 'link', kind: 'symlink', mode: 0o644, bytes: utf8('x') },
    { path: 'model', kind: 'file', mode: 0o644, bytes: utf8('x') },
    { path: 'suid', kind: 'file', mode: 0o4755, bytes: utf8('x') },
    { path: 'model/a.py/child', kind: 'file', mode: 0o644, bytes: utf8('x') },
  ]) {
    const f = fixture();
    f.entries.push(entry as Entry);
    await assert.rejects(saveCheckpoint(f));
    assert.equal(f.blobs.puts, 0);
  }
});
