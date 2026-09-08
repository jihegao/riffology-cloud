/** Serializes operations until the underlying promise settles. */
export class SerialLifecycle {
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private bootstrapped = false;
  markBootstrapped(): void { if (this.bootstrapped || this.closed) throw new Error('run-already-bootstrapped-or-closed'); this.bootstrapped = true; }
  close(): void { this.closed = true; }
  isClosed(): boolean { return this.closed; }
  wasBootstrapped(): boolean { return this.bootstrapped; }
  enqueue<T>(operation: () => Promise<T>, options: { allowClosed?: boolean } = {}): Promise<T> {
    const task = this.tail.then(async () => { if (this.closed && !options.allowClosed) throw new Error('run-closed'); return operation(); });
    this.tail = task.then(() => undefined, () => undefined);
    return task;
  }
}
export async function responseWithin<T>(task: Promise<T>, timeoutMs: number): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<{ timedOut: true }>(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs); });
    return await Promise.race([task.then(value => ({ timedOut: false as const, value })), timeout]);
  } finally { clearTimeout(timer); }
}
