export type ReleaseId = 'runtime-v1' | 'runtime-v2';
export type Fault = 'none' | 'protocol' | 'format' | 'release' | 'startup' | 'after-effect';
export type FixedCommand = 'increment' | 'read-state';
export const CONTROLLER_RELEASE = 'controller-v2';
export const RUNTIME_SHA256 = '35fa68d86a6cb085dbccde8206f49c297ea1c235817aefdf7776b7294584dc6d';
export const ALLOWED_RELEASES: readonly ReleaseId[] = Object.freeze(['runtime-v1', 'runtime-v2']);
export const ALLOWED_PROTOCOLS = Object.freeze(['m0-v1']);
export const CHECKPOINT_FORMAT = 1;
export function releaseAllowed(value: unknown): value is ReleaseId { return ALLOWED_RELEASES.some(item => item === value); }
export function faultAllowed(value: unknown): value is Fault { return ['none', 'protocol', 'format', 'release', 'startup', 'after-effect'].some(item => item === value); }
export function requestIdAllowed(value: string): boolean { return /^[a-z0-9-]{8,64}$/.test(value); }
/** Admission requires the trusted launcher record AND matching negotiation. */
export function assertHandshake(launch: { release: ReleaseId; artifact_sha256: string }, hello: unknown): void {
  if (!releaseAllowed(launch.release) || launch.artifact_sha256 !== RUNTIME_SHA256) throw new Error('runtime-artifact-not-approved');
  if (!hello || typeof hello !== 'object') throw new Error('runtime-handshake-invalid');
  const value = hello as Record<string, unknown>;
  if (value.kind !== 'hello' || value.release !== launch.release) throw new Error('runtime-release-mismatch');
  if (!ALLOWED_PROTOCOLS.some(protocol => protocol === value.protocol)) throw new Error('runtime-protocol-denied');
  if (value.checkpoint_format !== CHECKPOINT_FORMAT) throw new Error('runtime-checkpoint-format-denied');
}
