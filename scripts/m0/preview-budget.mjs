export const BUSINESS_LIMITS = Object.freeze({ milliseconds: 300_000, requests: 600, responseBytes: 8 * 1024 * 1024 });
export const CLEANUP_LIMITS = Object.freeze({ milliseconds: 45_000, requests: 3, responseBytes: 256 * 1024 });

export class PreviewBudgetError extends Error {
  constructor(code) { super(code); this.name = 'PreviewBudgetError'; this.code = code; }
}

/** One phase, one non-renewable wall-clock deadline. Cleanup gets a new instance.
 * Passing a thunk to run() ensures expired phases cannot dispatch new work.
 */
export class PreviewBudget {
  constructor(limits) {
    for (const key of ['milliseconds', 'requests', 'responseBytes']) {
      if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) throw new Error('invalid-preview-budget');
    }
    this.limits = { ...limits };
    this.started = Date.now();
    this.deadline = this.started + limits.milliseconds;
    this.requests = 0;
    this.responseBytes = 0;
    this.failure = null;
    this.finished = false;
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.timer = setTimeout(() => this.fail('total-wall-clock-budget-exhausted'), limits.milliseconds);
  }
  fail(code) {
    if (this.signal.aborted) return;
    this.failure = code;
    clearTimeout(this.timer);
    this.controller.abort(new PreviewBudgetError(code));
  }
  check() {
    if (!this.signal.aborted && Date.now() >= this.deadline) this.fail('total-wall-clock-budget-exhausted');
    if (this.signal.aborted) throw this.signal.reason;
  }
  remaining(maximum = this.limits.milliseconds) { this.check(); return Math.max(1, Math.min(maximum, this.deadline - Date.now())); }
  takeRequest() {
    this.check();
    if (this.requests >= this.limits.requests) this.fail('request-count-budget-exhausted');
    this.check();
    this.requests++;
  }
  addResponseBytes(bytes) {
    this.check();
    if (!Number.isSafeInteger(bytes) || bytes < 0) this.fail('response-byte-accounting-invalid');
    this.check();
    this.responseBytes += bytes;
    if (this.responseBytes > this.limits.responseBytes) this.fail('response-byte-budget-exhausted');
    this.check();
  }
  async run(operation) {
    this.check();
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => { this.check(); return operation(); }), aborted]);
      this.check();
      return result;
    } finally { this.signal.removeEventListener('abort', onAbort); }
  }
  finish() {
    this.finished = true;
    this.ended ??= Date.now();
    clearTimeout(this.timer);
    if (!this.signal.aborted) this.controller.abort(new PreviewBudgetError('phase-finished'));
  }
  snapshot() {
    return { limits: this.limits, elapsed_ms: (this.ended ?? Date.now()) - this.started, requests: this.requests, response_bytes: this.responseBytes, failure: this.failure, finished: this.finished };
  }
}

/** A lost/late acknowledgment is unknown, never permission to replay a write.
 * Deliberate later mutations are allowed only after a previous acknowledgment.
 */
export class MutationAttempts {
  constructor() { this.states = new Map(); this.attempts = 0; this.unknown = 0; }
  async once(key, budget, operation) {
    budget.check();
    if (['in-flight', 'unknown'].includes(this.states.get(key))) throw new PreviewBudgetError('unknown-mutation-must-not-replay');
    this.states.set(key, 'in-flight');
    this.attempts++;
    try {
      const result = await budget.run(operation);
      this.states.set(key, 'acknowledged');
      return result;
    } catch (error) {
      this.states.set(key, 'unknown');
      this.unknown++;
      throw error;
    }
  }
  snapshot() { return { attempts: this.attempts, unknown_acknowledgments: this.unknown, automatic_replays: 0 }; }
}
