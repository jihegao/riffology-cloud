import { turnBaseCheckpoints, type TurnBaseCheckpoints } from '../turn/protocol.ts';
import { turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import type { TrustedPiSessionFreezePort } from './pi-native.ts';
import type { FrozenTurnSnapshot, FrozenTurnSnapshotPort } from './revision.ts';

export interface WorkspaceFilesFreezePort {
  frozenFiles(identity: TurnRuntimeIdentity, base: TurnBaseCheckpoints): Promise<Uint8Array>;
}

/** Combines the independently frozen project filesystem and trusted Pi Session
 * only after ProductTurnRuntime has observed a terminal, fenced execution. */
export class ProductTurnSnapshotPort implements FrozenTurnSnapshotPort {
  readonly #files: WorkspaceFilesFreezePort;
  readonly #session: TrustedPiSessionFreezePort;
  constructor(files: WorkspaceFilesFreezePort, session: TrustedPiSessionFreezePort) {
    if (!files?.frozenFiles || !session?.frozenSession) throw Error('product-turn-snapshot-ports-required');
    this.#files = files; this.#session = session;
  }
  async freeze(raw: TurnRuntimeIdentity, rawBase: TurnBaseCheckpoints): Promise<FrozenTurnSnapshot> {
    const identity = turnRuntimeIdentity(raw), base = turnBaseCheckpoints(rawBase);
    const filesArchive = await this.#files.frozenFiles(identity, base);
    const piSession = await this.#session.frozenSession(identity);
    return { identity, filesArchive: Uint8Array.from(filesArchive), piSession: Uint8Array.from(piSession) };
  }
}
