import { GO_LIVE_BUDGET, HISTORICAL_PROFILE, ProxyRejected } from './policy.ts';
import type { UsageEvidence } from './stream.ts';

export type TrustedInvocation = {
  kind: 'trusted-pi'; principal: string; tenantId: string; workspaceId: string; runId: string; callId: string; expiresAtMs: number;
};
export type ApprovedRate = {
  provider: string; model: string; version: string; source: string; verifiedAtMs: number; expiresAtMs: number;
  inputMicrousdPerMillion: number; outputMicrousdPerMillion: number;
  // These rates must bound ALL billable input/output for this fixed mapper, including uncached input.
  boundsAllBillableTokens: true;
};
export type RunApproval = Omit<TrustedInvocation, 'callId' | 'expiresAtMs'> & {
  expiresAtMs: number; provider: string; model: string; maxRunMicrousd: number; rate: ApprovedRate | null;
  budgetProfile?: typeof GO_LIVE_BUDGET.id;
};
export type ReservationInput = {
  invocation: TrustedInvocation; platformRequestId: string; payloadHash: string;
  provider: string; model: string; inputTokenUpperBound: number; maxOutputTokens: number; inputBoundVersion: string;
};
export type TerminalFacts = {
  outcome: 'completed' | 'cancelled' | 'timeout' | 'failed'; errorCode: string | null;
  upstreamHttpStatus: number | null; upstreamRequestId: string | null; upstreamRequestIdHeader: string | null;
  upstreamResponseId: string | null; responseBytes: number; usage: UsageEvidence;
};
export type ReservationReceipt = ReservationInput & {
  reservationMicrousd: number; rateVersion: string; state: 'reserved' | 'dispatched' | 'terminal';
  dispatchOrdinal: number | null; facts: TerminalFacts | null;
  billingStatus: 'held-for-review'; billingAmount: null;
};
export type ReservationAuthority = {
  reserve(input: ReservationInput): Promise<{ created: boolean; receipt: ReservationReceipt }>;
  markDispatched(callId: string, platformRequestId: string): Promise<ReservationReceipt>;
  finish(callId: string, platformRequestId: string, facts: TerminalFacts): Promise<ReservationReceipt>;
};
export type RunLedger = { approval: string; heldMicrousd: number; dispatchCount: number; calls: Record<string, ReservationReceipt> };
/** Adapter MUST serialize this transaction across instances and durably commit before resolving it. */
export type AtomicRunStore = { transact<T>(operation: (current: RunLedger | null) => { state: RunLedger; value: T }): Promise<T> };

export function validateInvocation(value: TrustedInvocation | null, principal: string, now: number): asserts value is TrustedInvocation {
  if (!value || value.kind !== 'trusted-pi' || value.principal !== principal || !Number.isSafeInteger(value.expiresAtMs) || value.expiresAtMs <= now) throw new ProxyRejected('trusted-caller-required', 403);
  for (const field of ['tenantId', 'workspaceId', 'runId', 'callId'] as const) if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value[field]) || ['__proto__', 'constructor', 'prototype'].includes(value[field])) throw new ProxyRejected('invalid-trusted-scope', 403);
}
function safePositive(value: number) { return Number.isSafeInteger(value) && value > 0; }
function rateFor(approval: RunApproval, now: number): ApprovedRate {
  const rate = approval.rate;
  let source: URL | undefined; try { if (rate) source = new URL(rate.source); } catch { /* invalid configured evidence */ }
  if (!rate || rate.provider !== approval.provider || rate.model !== approval.model || !/^[a-zA-Z0-9._/-]{1,100}$/.test(rate.version) || !source || source.protocol !== 'https:' || source.username || source.password || source.hash
      || !Number.isSafeInteger(rate.verifiedAtMs) || rate.verifiedAtMs > now || !Number.isSafeInteger(rate.expiresAtMs) || rate.expiresAtMs <= now
      || !safePositive(rate.inputMicrousdPerMillion) || !safePositive(rate.outputMicrousdPerMillion) || rate.boundsAllBillableTokens !== true) throw new ProxyRejected('verified-rate-required', 503);
  return rate;
}
/** Testable transaction policy. No in-memory fallback, recharge endpoint, settlement, or automatic release. */
export class RunReservationAuthority implements ReservationAuthority {
  readonly approval: Readonly<RunApproval>;
  readonly store: AtomicRunStore;
  readonly now: () => number;
  readonly approvalKey: string;
  constructor(approval: RunApproval, store: AtomicRunStore, now = Date.now) {
    this.approval = Object.freeze({ ...approval, rate: approval.rate ? Object.freeze({ ...approval.rate }) : null });
    this.store = store; this.now = now; this.approvalKey = JSON.stringify(this.approval);
  }
  private authorized(invocation: TrustedInvocation) {
    validateInvocation(invocation, this.approval.principal, this.now());
    for (const field of ['kind', 'principal', 'tenantId', 'workspaceId', 'runId'] as const) if (invocation[field] !== this.approval[field]) throw new ProxyRejected('run-scope-denied', 403);
    if (!safePositive(this.approval.maxRunMicrousd) || this.approval.maxRunMicrousd > 1_000_000 || !Number.isSafeInteger(this.approval.expiresAtMs) || this.approval.expiresAtMs <= this.now() || invocation.expiresAtMs > this.approval.expiresAtMs) throw new ProxyRejected('approved-run-budget-required', 403);
    if (this.approval.budgetProfile !== undefined) {
      const rate = this.approval.rate;
      if (this.approval.budgetProfile !== GO_LIVE_BUDGET.id || this.approval.runId !== GO_LIVE_BUDGET.runId
        || !['call-1', 'call-2'].includes(invocation.callId) || this.approval.provider !== HISTORICAL_PROFILE.provider || this.approval.model !== HISTORICAL_PROFILE.model
        || this.approval.maxRunMicrousd !== GO_LIVE_BUDGET.maxRunMicrousd || !rate
        || rate.inputMicrousdPerMillion !== GO_LIVE_BUDGET.inputMicrousdPerMillion || rate.outputMicrousdPerMillion !== GO_LIVE_BUDGET.outputMicrousdPerMillion
        || rate.verifiedAtMs !== GO_LIVE_BUDGET.verifiedAtMs || rate.expiresAtMs > GO_LIVE_BUDGET.expiresAtMs) throw new ProxyRejected('fixed-live-approval-required', 403);
    }
  }
  private dispatchLimit() { return this.approval.budgetProfile === GO_LIVE_BUDGET.id ? 2 : 3; }
  private ledger(current: RunLedger | null) {
    if (current && current.approval !== this.approvalKey) throw new ProxyRejected('durable-approval-conflict', 409);
    return current ?? { approval: this.approvalKey, heldMicrousd: 0, dispatchCount: 0, calls: {} };
  }
  async reserve(input: ReservationInput) {
    // Clone before any asynchronous boundary: caller mutation cannot change reserved identity or payload.
    input = structuredClone(input); this.authorized(input.invocation);
    if (input.provider !== this.approval.provider || input.model !== this.approval.model || !/^[a-f0-9]{64}$/.test(input.payloadHash) || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.platformRequestId)
        || !/^[a-zA-Z0-9._/-]{1,100}$/.test(input.inputBoundVersion) || !safePositive(input.inputTokenUpperBound) || input.inputTokenUpperBound > (this.approval.budgetProfile === GO_LIVE_BUDGET.id ? GO_LIVE_BUDGET.inputTokens : 8192) || !safePositive(input.maxOutputTokens) || input.maxOutputTokens > 256) throw new ProxyRejected('invalid-reservation', 403);
    if (this.approval.budgetProfile === GO_LIVE_BUDGET.id && (input.inputTokenUpperBound !== GO_LIVE_BUDGET.inputTokens || input.maxOutputTokens !== 256 || input.inputBoundVersion !== GO_LIVE_BUDGET.id)) throw new ProxyRejected('full-live-reservation-required', 403);
    return this.store.transact(current => {
      const state = this.ledger(current); this.authorized(input.invocation);
      const previous = Object.hasOwn(state.calls, input.invocation.callId) ? state.calls[input.invocation.callId] : undefined;
      if (previous) {
        if (previous.payloadHash !== input.payloadHash) throw new ProxyRejected('call-payload-conflict', 409);
        return { state, value: { created: false, receipt: structuredClone(previous) } };
      }
      const rate = rateFor(this.approval, this.now());
      if (Object.keys(state.calls).length >= this.dispatchLimit() || state.dispatchCount >= this.dispatchLimit()) throw new ProxyRejected('run-dispatch-limit', 429);
      const numerator = BigInt(input.inputTokenUpperBound) * BigInt(rate.inputMicrousdPerMillion) + BigInt(input.maxOutputTokens) * BigInt(rate.outputMicrousdPerMillion);
      const reservation = (numerator + 999_999n) / 1_000_000n;
      if (reservation > BigInt(this.approval.maxRunMicrousd - state.heldMicrousd)) throw new ProxyRejected('run-budget-exhausted', 402);
      const receipt: ReservationReceipt = { ...input, reservationMicrousd: Number(reservation), rateVersion: rate.version, state: 'reserved', dispatchOrdinal: null, facts: null, billingStatus: 'held-for-review', billingAmount: null };
      state.heldMicrousd += receipt.reservationMicrousd; state.calls[input.invocation.callId] = receipt;
      return { state, value: { created: true, receipt: structuredClone(receipt) } };
    });
  }
  async markDispatched(callId: string, platformRequestId: string) {
    return this.store.transact(current => {
      const state = this.ledger(current); const receipt = Object.hasOwn(state.calls, callId) ? state.calls[callId] : undefined;
      if (!receipt || receipt.platformRequestId !== platformRequestId || receipt.state !== 'reserved') throw new ProxyRejected('dispatch-state-conflict', 409);
      this.authorized(receipt.invocation); rateFor(this.approval, this.now());
      if (state.dispatchCount >= this.dispatchLimit()) throw new ProxyRejected('run-dispatch-limit', 429);
      receipt.state = 'dispatched'; receipt.dispatchOrdinal = ++state.dispatchCount;
      return { state, value: structuredClone(receipt) };
    });
  }
  async finish(callId: string, platformRequestId: string, facts: TerminalFacts) {
    facts = structuredClone(facts);
    return this.store.transact(current => {
      const state = this.ledger(current); const receipt = Object.hasOwn(state.calls, callId) ? state.calls[callId] : undefined;
      if (!receipt || receipt.platformRequestId !== platformRequestId) throw new ProxyRejected('receipt-scope-conflict', 409);
      if (receipt.state === 'terminal') {
        if (JSON.stringify(receipt.facts) !== JSON.stringify(facts)) throw new ProxyRejected('terminal-receipt-conflict', 409);
        return { state, value: structuredClone(receipt) };
      }
      receipt.state = 'terminal'; receipt.facts = facts;
      // Cancellation, provider error and even observed usage do not authorize settlement/release.
      return { state, value: structuredClone(receipt) };
    });
  }
}
