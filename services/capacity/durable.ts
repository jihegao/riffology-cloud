import { DurableObject } from 'cloudflare:workers';
import { SqlTrustedPiCapacity, type TrustedPiCapacityDispatchReference, type TrustedPiCapacityIdentity, type TrustedPiCapacityLeaseReference, type TrustedPiCapacityStopProof, type TrustedPiCapacityTicketReference } from './core.ts';
import { trustedPiCapacityActorName } from './client.ts';

export interface TrustedPiCapacityEnv {
  TRUSTED_PI_CAPACITY: DurableObjectNamespace<TrustedPiCapacity>;
  TRUSTED_PI_CAPACITY_POLICY_VERSION: string;
  TRUSTED_PI_CAPACITY_LIMIT: string;
}

/** Private application singleton. Only WorkspaceAgent and ProductTurnRuntime
 * receive this binding; public handlers and project containers must not. */
export class TrustedPiCapacity extends DurableObject<TrustedPiCapacityEnv> {
  #core: SqlTrustedPiCapacity | null = null;
  #ledger(): SqlTrustedPiCapacity {
    const expected = this.env.TRUSTED_PI_CAPACITY.idFromName(trustedPiCapacityActorName());
    if (!expected.equals(this.ctx.id)) throw Error('trusted-pi-capacity-actor-scope-denied');
    if (this.env.TRUSTED_PI_CAPACITY_LIMIT !== '1') throw Error('invalid-trusted-pi-capacity-limit');
    if (!this.#core) this.#core = new SqlTrustedPiCapacity(this.ctx.storage, this.env.TRUSTED_PI_CAPACITY_POLICY_VERSION);
    return this.#core;
  }
  async request(identity: TrustedPiCapacityIdentity) { return this.#ledger().request(identity); }
  async lookup(identity: TrustedPiCapacityIdentity) { return this.#ledger().lookup(identity); }
  async dispatch(reference: TrustedPiCapacityDispatchReference) { return this.#ledger().dispatch(reference); }
  async cancelNeverStarted(reference: TrustedPiCapacityTicketReference | TrustedPiCapacityLeaseReference, proof: TrustedPiCapacityStopProof) { return this.#ledger().cancelNeverStarted(reference, proof); }
  async confirmReleased(reference: TrustedPiCapacityDispatchReference, proof: TrustedPiCapacityStopProof) { return this.#ledger().confirmReleased(reference, proof); }
  async snapshot() { return this.#ledger().snapshot(); }
}
