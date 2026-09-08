import type { AtomicRunStore, RunLedger } from './authority.ts';

function ledger(value: unknown): asserts value is RunLedger {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-persisted-run-ledger');
  const row = value as Partial<RunLedger>;
  if (typeof row.approval !== 'string' || !Number.isSafeInteger(row.heldMicrousd) || row.heldMicrousd! < 0
      || !Number.isSafeInteger(row.dispatchCount) || row.dispatchCount! < 0 || row.dispatchCount! > 3
      || !row.calls || typeof row.calls !== 'object' || Array.isArray(row.calls)) throw new Error('invalid-persisted-run-ledger');
}

/**
 * SQLite-backed DO adapter. The caller must route a run to one stable DO/key.
 * No memory cache, retry, or fallback: a failed sync leaves the commit uncertain.
 * API contract: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync
 * Durability barrier: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#sync
 */
export class DurableRunStore implements AtomicRunStore {
  readonly storage: DurableObjectStorage;
  readonly storageKey: string;

  constructor(storage: DurableObjectStorage, storageKey = 'm0:model:ledger') {
    if (typeof storageKey !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(storageKey)) throw new Error('invalid-run-ledger-key');
    // These SQLite-only APIs must be present; a legacy or unavailable backend is not substituted.
    if (!storage || typeof storage.transactionSync !== 'function' || typeof storage.sync !== 'function'
        || !storage.kv || typeof storage.kv.get !== 'function' || typeof storage.kv.put !== 'function') throw new Error('sqlite-durable-storage-required');
    this.storage = storage; this.storageKey = storageKey;
  }

  async transact<T>(operation: (current: RunLedger | null) => { state: RunLedger; value: T }): Promise<T> {
    const value = this.storage.transactionSync(() => {
      const stored = this.storage.kv.get<unknown>(this.storageKey);
      if (stored !== undefined) ledger(stored);
      // The operation cannot mutate a cached storage object, even if it later throws.
      const current = stored === undefined ? null : structuredClone(stored);
      const result = operation(current);
      if (result instanceof Promise) { void result.catch(() => {}); throw new Error('run-ledger-operation-must-be-synchronous'); }
      if (!result || typeof result !== 'object' || typeof (result as { then?: unknown }).then === 'function') throw new Error('run-ledger-operation-must-be-synchronous');
      ledger(result.state);
      // Clone BOTH outputs before put: value serialization failure must roll back as well.
      const nextState = structuredClone(result.state); const nextValue = structuredClone(result.value);
      this.storage.kv.put(this.storageKey, nextState);
      return nextValue;
    });
    // transactionSync establishes atomicity, not an acknowledged disk flush by itself.
    await this.storage.sync();
    return value;
  }
}
