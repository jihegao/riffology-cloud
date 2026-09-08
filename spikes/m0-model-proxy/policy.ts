export type ModelProxyPolicy = {
  proxyOrigin: string; upstreamOrigin: string; upstreamPath: string;
  provider: string; model: string; callerPrincipal: string;
  mapper: 'deepseek-thinking-disabled';
  maxBodyBytes: number; maxInputTokens: number; maxOutputTokens: number; maxResponseBytes: number; maxFrameBytes: number; timeoutMs: number;
  budgetProfile?: 'go-flash-context-20260906';
};
export const HISTORICAL_PROFILE = Object.freeze({ provider: 'opencode-go', model: 'deepseek-v4-flash', upstreamOrigin: 'https://opencode.ai', upstreamPath: '/zen/go/v1/chat/completions' });
/** Public-contract planning reserve, not a guarantee about Go internal retries,
 * normalized subscription quota, or cash settlement. No tokenizer claim.
 * https://opencode.ai/docs/go/#usage-limits (verified 2026-09-06)
 * https://api-docs.deepseek.com/quick_start/pricing/
 * https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731/blob/main/config.json
 */
export const GO_LIVE_BUDGET = Object.freeze({ id: 'go-flash-context-20260906' as const,
  origin: 'https://riffology-m0-model-proxy-go-live-staging.jihe-gao.workers.dev', runId: 'go-live-g0-20260906',
  inputTokens: 1048576, outputTokens: 256, maxDispatches: 2, reservationMicrousd: 461712, maxRunMicrousd: 923424,
  inputMicrousdPerMillion: 440000, outputMicrousdPerMillion: 1320000,
  verifiedAtMs: Date.parse('2026-09-06T00:00:00Z'), expiresAtMs: Date.parse('2026-09-07T00:00:00Z'),
});
export const PROXY_PATH = '/v1/chat/completions';
export class ProxyRejected extends Error {
  readonly status: number;
  constructor(code: string, status = 400) { super(code); this.status = status; }
}
const encoder = new TextEncoder();
export async function digest(bytes: Uint8Array | string) {
  const data = typeof bytes === 'string' ? encoder.encode(bytes) : Uint8Array.from(bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), value => value.toString(16).padStart(2, '0')).join('');
}
export function fixedPolicy(input: ModelProxyPolicy): Readonly<ModelProxyPolicy> {
  for (const value of [input.proxyOrigin, input.upstreamOrigin]) {
    let url: URL; try { url = new URL(value); } catch { throw new ProxyRejected('invalid-server-origin', 503); }
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') throw new ProxyRejected('invalid-server-origin', 503);
  }
  if (!/^\/(?:[a-z0-9_-]+\/)*chat\/completions$/.test(input.upstreamPath) || !/^[a-zA-Z0-9._-]{1,100}$/.test(input.provider) || !/^[a-zA-Z0-9._/-]{1,150}$/.test(input.model) || !/^[a-zA-Z0-9._-]{1,100}$/.test(input.callerPrincipal)) throw new ProxyRejected('invalid-server-policy', 503);
  if (input.mapper !== 'deepseek-thinking-disabled') throw new ProxyRejected('unsupported-server-mapper', 503);
  const wholeContext = input.budgetProfile === GO_LIVE_BUDGET.id;
  if (input.budgetProfile !== undefined && (!wholeContext || input.proxyOrigin !== GO_LIVE_BUDGET.origin
    || input.provider !== HISTORICAL_PROFILE.provider || input.model !== HISTORICAL_PROFILE.model
    || input.upstreamOrigin !== HISTORICAL_PROFILE.upstreamOrigin || input.upstreamPath !== HISTORICAL_PROFILE.upstreamPath
    || input.maxBodyBytes > 8192 || input.maxInputTokens !== GO_LIVE_BUDGET.inputTokens || input.maxOutputTokens !== 256)) throw new ProxyRejected('invalid-live-profile', 503);
  for (const [value, max] of [[input.maxBodyBytes, 65536], [input.maxInputTokens, wholeContext ? GO_LIVE_BUDGET.inputTokens : 8192], [input.maxOutputTokens, 256], [input.maxResponseBytes, 1048576], [input.maxFrameBytes, 65536], [input.timeoutMs, 30000]]) if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new ProxyRejected('invalid-server-limit', 503);
  if (input.maxFrameBytes > input.maxResponseBytes) throw new ProxyRejected('invalid-server-limit', 503);
  return Object.freeze({ ...input });
}
export function validateRequestRoute(request: Request, policy: Readonly<ModelProxyPolicy>) {
  const url = new URL(request.url);
  if (url.origin !== policy.proxyOrigin || url.pathname !== PROXY_PATH || url.search || url.hash || url.username || url.password) throw new ProxyRejected('route-not-allowed', 404);
  if (request.method !== 'POST') throw new ProxyRejected('method-not-allowed', 405);
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new ProxyRejected('json-content-type-required', 415);
  // These headers may not override the authenticated scope, server route, credentials or reservation.
  for (const header of ['x-upstream-url', 'x-provider', 'x-model', 'x-api-key', 'x-endpoint', 'x-budget', 'x-role', 'x-run-id', 'x-reservation-id', 'x-tenant-id', 'x-workspace-id', 'x-call-id']) if (request.headers.has(header)) throw new ProxyRejected('caller-override-header-rejected', 403);
}
export function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(new ProxyRejected('request-aborted', 499)); }
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new ProxyRejected('request-aborted', 499)); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
export async function readJsonBody(request: Request, maxBytes: number, signal: AbortSignal) {
  if (!request.body) throw new ProxyRejected('request-body-required');
  const reader = request.body.getReader(); const parts: Uint8Array[] = []; let size = 0; let reads = 0;
  try {
    while (true) {
      const next = await untilAbort(reader.read(), signal); if (next.done) break;
      if (++reads > 65536) throw new ProxyRejected('request-body-chunk-limit', 413);
      size += next.value.byteLength; if (size > maxBytes) throw new ProxyRejected('request-body-too-large', 413);
      parts.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    let value: unknown; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ProxyRejected('invalid-json-body'); }
    return { value, rawBytes: size };
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) throw new ProxyRejected('unknown-body-field'); }
export function boundedCompletionBody(value: unknown, policy: Readonly<ModelProxyPolicy>): { encoded: string; maxOutputTokens: number } {
  if (!object(value)) throw new ProxyRejected('invalid-completion-body');
  exactKeys(value, ['model', 'messages', 'stream', 'stream_options', 'max_tokens', 'temperature', 'thinking']);
  if (value.model !== policy.model || value.stream !== true) throw new ProxyRejected('model-or-stream-protocol-mismatch');
  if (!Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 32) throw new ProxyRejected('invalid-message-count');
  for (const message of value.messages) {
    if (!object(message)) throw new ProxyRejected('invalid-message');
    exactKeys(message, ['role', 'content', 'reasoning_content']);
    if (!['system', 'user', 'assistant'].includes(String(message.role)) || typeof message.content !== 'string' || message.reasoning_content !== undefined && (message.role !== 'assistant' || typeof message.reasoning_content !== 'string')) throw new ProxyRejected('text-probe-messages-required');
  }
  const maxOutputTokens = value.max_tokens ?? policy.maxOutputTokens;
  if (!Number.isSafeInteger(maxOutputTokens) || (maxOutputTokens as number) < 1 || (maxOutputTokens as number) > policy.maxOutputTokens) throw new ProxyRejected('output-token-limit');
  if (policy.budgetProfile === GO_LIVE_BUDGET.id && (maxOutputTokens !== 256 || value.messages.length > 8)) throw new ProxyRejected('fixed-live-diagnostic-required');
  if (value.stream_options !== undefined && (!object(value.stream_options) || Object.keys(value.stream_options).length !== 1 || value.stream_options.include_usage !== true)) throw new ProxyRejected('stream-usage-required');
  if (value.temperature !== undefined && (typeof value.temperature !== 'number' || !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2)) throw new ProxyRejected('invalid-temperature');
  if (value.thinking !== undefined && (!object(value.thinking) || Object.keys(value.thinking).length !== 1 || value.thinking.type !== 'disabled')) throw new ProxyRejected('reasoning-expansion-disabled');
  const encoded = JSON.stringify({ ...value, max_tokens: maxOutputTokens, stream_options: { include_usage: true }, thinking: { type: 'disabled' } });
  if (encoder.encode(encoded).byteLength > policy.maxBodyBytes) throw new ProxyRejected('normalized-body-too-large', 413);
  return { encoded, maxOutputTokens: maxOutputTokens as number };
}
export function upstreamHeaders(secret: string): Headers {
  if (typeof secret !== 'string' || secret.length < 1 || secret.length > 2048 || /\s/.test(secret)) throw new ProxyRejected('provider-secret-unavailable', 503);
  return new Headers({ authorization: `Bearer ${secret}`, 'content-type': 'application/json', accept: 'text/event-stream' });
}
export function correlationId(value: unknown): string | null { return typeof value === 'string' && /^[a-zA-Z0-9._:/-]{1,256}$/.test(value) ? value : null; }
