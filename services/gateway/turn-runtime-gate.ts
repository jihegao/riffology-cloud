import { HttpError } from './http.ts';

/**
 * Turn admission stays closed until the product runtime and its alarm owner are
 * wired. The check runs before WorkspaceAgent can persist a queued turn.
 */
export function requireTurnRuntime(value: unknown): void {
  if (value !== 'true') throw new HttpError('turn_runtime_not_ready', 503);
}
