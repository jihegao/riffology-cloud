import assert from 'node:assert/strict';
import test from 'node:test';
import { commitCheckpoint } from '../../spikes/m0-storage/adapters.ts';

test('durable commit replay cannot change its parent or cross runtime generations', async () => {
  const data = new Map<string, unknown>();
  const storage = {
    kv: { get: (key: string) => data.get(key), put: (key: string, value: unknown) => data.set(key, structuredClone(value)) },
    transactionSync: <T>(closure: () => T) => closure(), sync: async () => {},
  } as unknown as DurableObjectStorage;
  const first = { revision: 'a'.repeat(64), parent: null, generation: 1 };
  assert.equal((await commitCheckpoint(storage, first)).sequence, 1);
  assert.equal((await commitCheckpoint(storage, first)).sequence, 1);
  await assert.rejects(commitCheckpoint(storage, { ...first, parent: 'b'.repeat(64) }), /parent-conflict/);
  data.set('generation', 2);
  await assert.rejects(commitCheckpoint(storage, first), /stale-generation/);
  await assert.rejects(commitCheckpoint(storage, { ...first, generation: 2 }), /revision-generation-conflict/);
  assert.equal((await commitCheckpoint(storage, { revision: 'c'.repeat(64), parent: first.revision, generation: 2 })).sequence, 2);
  assert.equal([...data.keys()].filter(key => key.startsWith('events/')).length, 2);
});

test('control metadata shares the receipt transaction and failure cannot partially publish', async () => {
  let data = new Map<string, unknown>();
  const storage = {
    kv: { get: (key: string) => data.get(key), put: (key: string, value: unknown) => data.set(key, structuredClone(value)) },
    transactionSync: <T>(closure: () => T) => { const before = structuredClone(data); try { return closure(); } catch (error) { data = before; throw error; } },
    sync: async () => {},
  } as unknown as DurableObjectStorage;
  const input = { revision: 'a'.repeat(64), parent: null, generation: 1 };
  await assert.rejects(commitCheckpoint(storage, input, receipt => {
    data.set('turn', { phase: 'completed', revision: receipt.revision });
    throw new Error('metadata-failed');
  }), /metadata-failed/);
  assert.equal(data.size, 0);
  const receipt = await commitCheckpoint(storage, input, receipt => {
    data.set('turn', { phase: 'completed', revision: receipt.revision }); return undefined;
  });
  assert.deepEqual(data.get('turn'), { phase: 'completed', revision: receipt.revision });
  assert.deepEqual(data.get('current'), receipt);
  assert.equal([...data.keys()].filter(key => key.startsWith('events/')).length, 1);
});
