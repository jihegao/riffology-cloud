import { trustedPiCapacityClient, type TrustedPiCapacityNamespace, type TrustedPiCapacityPort } from './client.ts';
import type { TrustedPiCapacityIdentity, TrustedPiCapacityTicket } from './core.ts';
import type { TurnCapacityPort, TurnCapacityReceipt } from '../turn/dispatcher.ts';
import { positive, scope as turnScope, turnId, type TurnScope } from '../turn/protocol.ts';

const RETRY_MS = 5_000;

type AcquireInput = {
  scope: TurnScope;
  sessionId: string;
  turnId: string;
  generation: number;
  ticketId: string | null;
  operationId: string | null;
};

type NeverStartedInput = {
  scope: TurnScope;
  sessionId: string;
  turnId: string;
  generation: number;
  ticketId: string | null;
  operationId: string;
  leaseId: string | null;
  reasonCode: string;
  observedAt: number;
};

function identity(input: AcquireInput | NeverStartedInput): TrustedPiCapacityIdentity {
  const scope = turnScope(input.scope), generation = positive(input.generation);
  if (scope.workspaceGeneration !== generation) throw Error('turn-capacity-generation-conflict');
  return {
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    sessionId: turnId(input.sessionId),
    operationId: turnId(input.operationId),
    turnId: turnId(input.turnId),
    generation,
  };
}

function matches(ticket: TrustedPiCapacityTicket, expected: TrustedPiCapacityIdentity): boolean {
  return ticket.tenantId === expected.tenantId
    && ticket.projectId === expected.projectId
    && ticket.workspaceId === expected.workspaceId
    && ticket.sessionId === expected.sessionId
    && ticket.operationId === expected.operationId
    && ticket.turnId === expected.turnId
    && ticket.generation === expected.generation;
}

async function neverStartedProofId(operationId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(operationId));
  return `never-started-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Adapts the application-wide capacity ledger to TurnDispatcher admission.
 * The ledger actor is fixed by trustedPiCapacityClient; no Workspace-derived
 * actor name can accidentally create another capacity domain. */
export class TrustedPiTurnCapacity implements TurnCapacityPort {
  readonly #capacity: TrustedPiCapacityPort;
  readonly #retryMs: number;
  readonly #clock: () => number;

  constructor(namespace: TrustedPiCapacityNamespace, retryMs = RETRY_MS, clock: () => number = Date.now) {
    this.#capacity = trustedPiCapacityClient(namespace);
    this.#retryMs = positive(retryMs);
    this.#clock = clock;
  }

  async acquire(input: AcquireInput): Promise<TurnCapacityReceipt> {
    const expected = identity(input), priorTicketId = input.ticketId === null ? null : turnId(input.ticketId);
    const result = await this.#capacity.request(expected), ticket = result.ticket;
    if (!matches(ticket, expected) || (priorTicketId !== null && ticket.ticketId !== priorTicketId)) throw Error('turn-capacity-receipt-scope-denied');
    if (ticket.status === 'held') {
      if (ticket.leaseId === null || ticket.acquiredAt === null || ticket.dispatchId !== null) throw Error('invalid-turn-capacity-receipt');
      return { status: 'acquired', turnId: expected.turnId, generation: expected.generation, ticketId: turnId(ticket.ticketId), operationId: expected.operationId, leaseId: turnId(ticket.leaseId) };
    }
    if (ticket.status === 'queued') {
      if (ticket.leaseId !== null || ticket.acquiredAt !== null || ticket.dispatchId !== null) throw Error('invalid-turn-capacity-receipt');
      const since = positive(ticket.requestedAt);
      const observedAt = positive(this.#clock());
      return { status: 'waiting', turnId: expected.turnId, generation: expected.generation, ticketId: turnId(ticket.ticketId), operationId: expected.operationId, reasonCode: 'trusted-pi-capacity-exhausted', since, nextAttemptAt: Math.max(since, observedAt) + this.#retryMs };
    }
    throw Error('turn-capacity-ticket-not-admissible');
  }

  async releaseNeverStarted(input: NeverStartedInput): Promise<{proofId:string;releasedAt:number}> {
    const expected = identity(input), expectedTicketId = input.ticketId===null?null:turnId(input.ticketId), expectedLeaseId=input.leaseId===null?null:turnId(input.leaseId);
    turnId(input.reasonCode); const requestedObservation = positive(input.observedAt);
    // Reissuing the exact request closes the race where Workspace persisted its
    // cancellation tombstone while the original capacity RPC was still in flight.
    const found = await this.#capacity.request(expected), ticket = found.ticket;
    if (!matches(ticket, expected) || (expectedTicketId!==null&&ticket.ticketId!==expectedTicketId) || (expectedLeaseId!==null&&ticket.leaseId!==expectedLeaseId) || ticket.dispatchId !== null) throw Error('turn-capacity-reference-denied');
    if (!['queued','held','cancelled'].includes(ticket.status)) throw Error('turn-capacity-never-started-not-confirmed');
    const observedAt=Math.max(requestedObservation,positive(ticket.requestedAt)),proofId=await neverStartedProofId(expected.operationId);
    const result = await this.#capacity.cancelNeverStarted(
      ticket.leaseId===null?{ ...expected, ticketId:turnId(ticket.ticketId) }:{ ...expected, ticketId:turnId(ticket.ticketId), leaseId:turnId(ticket.leaseId) },
      { kind: 'never-started', proofId, observedAt },
    );
    if (!matches(result.ticket, expected) || result.ticket.ticketId !== ticket.ticketId || result.ticket.leaseId !== ticket.leaseId || result.ticket.status !== 'cancelled'||result.ticket.finishedAt===null) throw Error('invalid-turn-capacity-release-receipt');
    return {proofId,releasedAt:positive(result.ticket.finishedAt)};
  }
}
