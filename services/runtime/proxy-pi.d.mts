import type { ControlledPiOptions, ControlledPiSession, SessionScope, PiCheckpoint } from './controlled-pi.mjs';

export interface ProxyInvocation {
  runId: string;
  callId: string;
  token: string;
  expiresAtMs: number;
  scope: SessionScope;
}
export interface ProxyCancellation {
  local: 'pending' | 'settled' | 'unconfirmed';
  remote: 'pending' | 'acknowledged' | 'unconfirmed' | 'not-requested';
  /** Read the coordinator's durable receipt separately. */
  serverTerminalConfirmed: false;
}
export interface ProxyPiOptions {
  trustedCwd: string;
  scope: SessionScope;
  snapshot?: PiCheckpoint;
  systemPrompt: string;
  fixedSkills?: ControlledPiOptions['fixedSkills'];
  /** A release-controlled HTTPS origin, never taken from project input. */
  proxyOrigin: string;
  modelId: string;
  /** Issued and bound to this scope by the trusted coordinator. */
  invocation: ProxyInvocation;
  maxOutputTokens?: number;
  maxBodyBytes?: number;
  callTimeoutMs?: number;
  cancelTimeoutMs?: number;
  transport?: typeof globalThis.fetch;
}
export interface ProxyPiSession extends Omit<ControlledPiSession, 'cancel' | 'inspect'> {
  cancel(): Promise<ProxyCancellation>;
  inspect(): ReturnType<ControlledPiSession['inspect']> & {
    invocation: { runId: string; callId: string };
    modelTransportAttempts: number;
    consumed: boolean;
    cancellation: ProxyCancellation | null;
    billingAmount: null;
  };
}
export declare function createProxyPiSession(options: ProxyPiOptions): Promise<ProxyPiSession>;
