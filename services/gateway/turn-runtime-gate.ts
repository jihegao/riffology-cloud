import { HttpError } from './http.ts';

export type TurnAdmissionStatus = 'enabled' | 'maintenance' | 'unavailable';

export type TurnAdmissionView = {
  state: TurnAdmissionStatus;
  reasonCode: string | null;
  retryable: boolean;
};

export function turnAdmissionStatus(value: unknown, runtimeConfigured = true): TurnAdmissionView {
  if (value === 'true' && !runtimeConfigured) return { state: 'unavailable', reasonCode: 'turn_runtime_unavailable', retryable: true };
  if (value === 'true') return { state: 'enabled', reasonCode: null, retryable: true };
  return { state: 'maintenance', reasonCode: 'turn_runtime_not_ready', retryable: false };
}

/**
 * Turn admission stays closed until the product runtime and its alarm owner are
 * wired. The check runs before WorkspaceAgent can persist a queued turn.
 */
export function requireTurnRuntime(value: unknown, runtimeConfigured=true): void {
  if(value==='true'&&!runtimeConfigured)throw new HttpError('turn_runtime_unavailable',503);
  if (value !== 'true') throw new HttpError('turn_runtime_not_ready', 503);
}
