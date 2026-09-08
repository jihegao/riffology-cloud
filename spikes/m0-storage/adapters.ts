import type { Blobs, Receipt } from './checkpoint.ts';

/** R2 objects are immutable; the coordinator alone owns their reference pointer. */
export class R2Blobs implements Blobs {
  bucket: R2Bucket;
  prefix: string;
  putCount = 0;
  failOnPut = 0;
  constructor(bucket: R2Bucket, prefix: string) { this.bucket = bucket; this.prefix = prefix; }
  async putIfAbsent(key: string, bytes: Uint8Array) {
    if (++this.putCount === this.failOnPut) throw new Error('injected-upload-interruption');
    await this.bucket.put(`${this.prefix}/${key}`, bytes, { onlyIf: { etagDoesNotMatch: '*' } });
  }
  async get(key: string) {
    const value = await this.bucket.get(`${this.prefix}/${key}`);
    if (value && value.size > 32 * 1024 * 1024) throw new Error('checkpoint-object-too-large');
    return value ? new Uint8Array(await value.arrayBuffer()) : null;
  }
}

export function currentCheckpoint(storage: DurableObjectStorage): Receipt | null {
  return storage.kv.get<Receipt>('current') ?? null;
}

export async function commitCheckpoint(storage: DurableObjectStorage, input: {
  revision: string; parent: string | null; generation: number;
}, commitMetadata?: (receipt: Receipt) => undefined): Promise<Receipt> {
  const receipt = storage.transactionSync(() => {
    const generation = storage.kv.get<number>('generation') ?? 1;
    if (generation !== input.generation) throw new Error('stale-generation');
    const current = currentCheckpoint(storage);
    if (current?.revision === input.revision) {
      if (current.generation !== input.generation) throw new Error('revision-generation-conflict');
      if (storage.kv.get<string | null>('current-parent') !== input.parent) throw new Error('parent-conflict');
      commitMetadata?.(current);
      return current;
    }
    if ((current?.revision ?? null) !== input.parent) throw new Error('parent-conflict');
    const sequence = (current?.sequence ?? 0) + 1;
    const value = { revision: input.revision, generation, sequence };
    storage.kv.put('current', value);
    storage.kv.put('current-parent', input.parent);
    storage.kv.put(`events/${sequence.toString().padStart(8, '0')}`, value);
    // Only trusted synchronous control metadata belongs here. It commits or
    // rolls back with the authoritative receipt, before any external await.
    commitMetadata?.(value);
    return value;
  });
  await storage.sync();
  return receipt;
}
