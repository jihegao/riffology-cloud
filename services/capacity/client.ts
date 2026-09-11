import type {
  TrustedPiCapacityDispatchResult,
  TrustedPiCapacityDispatchReference,
  TrustedPiCapacityFinishResult,
  TrustedPiCapacityIdentity,
  TrustedPiCapacityLeaseReference,
  TrustedPiCapacityRequestResult,
  TrustedPiCapacitySnapshot,
  TrustedPiCapacityStopProof,
  TrustedPiCapacityTicketReference,
} from './core.ts';

export const TRUSTED_PI_CAPACITY_ACTOR = 'trusted-pi-capacity:application';
export function trustedPiCapacityActorName(): typeof TRUSTED_PI_CAPACITY_ACTOR { return TRUSTED_PI_CAPACITY_ACTOR; }

export interface TrustedPiCapacityPort {
  request(identity: TrustedPiCapacityIdentity): Promise<TrustedPiCapacityRequestResult>;
  lookup(identity: TrustedPiCapacityIdentity): Promise<TrustedPiCapacityRequestResult | null>;
  dispatch(reference: TrustedPiCapacityDispatchReference): Promise<TrustedPiCapacityDispatchResult>;
  cancelNeverStarted(reference: TrustedPiCapacityTicketReference | TrustedPiCapacityLeaseReference, proof: TrustedPiCapacityStopProof): Promise<TrustedPiCapacityFinishResult>;
  confirmReleased(reference: TrustedPiCapacityDispatchReference, proof: TrustedPiCapacityStopProof): Promise<TrustedPiCapacityFinishResult>;
  snapshot(): Promise<TrustedPiCapacitySnapshot>;
}

export interface TrustedPiCapacityNamespace {
  getByName(name: string): TrustedPiCapacityPort;
}

export function trustedPiCapacityClient(namespace: TrustedPiCapacityNamespace): TrustedPiCapacityPort {
  if (!namespace || typeof namespace.getByName !== 'function') throw Error('trusted-pi-capacity-binding-required');
  return namespace.getByName(trustedPiCapacityActorName());
}
