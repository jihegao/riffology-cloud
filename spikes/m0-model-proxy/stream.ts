import { correlationId, ProxyRejected, type ModelProxyPolicy } from './policy.ts';

export type TokenObservation = { input: number | null; output: number | null; total: number | null; cacheRead: number | null; cacheWrite: number | null; reasoning: number | null };
export type UsageEvidence = { status: 'known' | 'unknown'; reason: string; observedTokens: TokenObservation; billingAmount: null; billingStatus: 'held-for-review' };
const emptyTokens = (): TokenObservation => ({ input: null, output: null, total: null, cacheRead: null, cacheWrite: null, reasoning: null });
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const encoder = new TextEncoder();

/** Observation is incremental and bounded. The proxy forwards original bytes, never reconstructed SSE. */
export class CompletionStreamObserver {
  readonly policy: Readonly<ModelProxyPolicy>;
  readonly outputCeiling: number;
  readonly inputCeiling: number;
  readonly decoder = new TextDecoder('utf-8', { fatal: true });
  pending = ''; data: string[] = []; frameBytes = 0; totalBytes = 0; frames = 0;
  done = false; finishReason: string | null = null; upstreamResponseId: string | null = null;
  tokens = emptyTokens(); usageSeen = false; usageValid = false; usageProblem = 'missing-usage'; usageTainted = false; terminalUsageSeen = false;
  constructor(policy: Readonly<ModelProxyPolicy>, outputCeiling: number, inputCeiling = policy.maxInputTokens) { this.policy = policy; this.outputCeiling = outputCeiling; this.inputCeiling = inputCeiling; }
  push(bytes: Uint8Array) {
    this.totalBytes += bytes.byteLength;
    if (this.totalBytes > this.policy.maxResponseBytes) throw new ProxyRejected('upstream-response-too-large', 502);
    let text: string; try { text = this.decoder.decode(bytes, { stream: true }); } catch { throw new ProxyRejected('invalid-upstream-utf8', 502); }
    this.pending += text; this.lines(false);
  }
  end() {
    try { this.pending += this.decoder.decode(); } catch { throw new ProxyRejected('invalid-upstream-utf8', 502); }
    this.lines(true);
    if (this.pending || this.data.length || !this.done) throw new ProxyRejected('incomplete-upstream-sse', 502);
  }
  private lines(eof: boolean) {
    while (true) {
      const end = /\r\n|\r|\n/.exec(this.pending);
      if (!end || !eof && end[0] === '\r' && end.index === this.pending.length - 1) break;
      const line = this.pending.slice(0, end.index); this.pending = this.pending.slice(end.index + end[0].length);
      this.frameBytes += encoder.encode(line).byteLength + end[0].length;
      if (this.frameBytes > this.policy.maxFrameBytes) throw new ProxyRejected('upstream-frame-too-large', 502);
      if (line === '') { this.frame(); this.data = []; this.frameBytes = 0; }
      else if (line.startsWith('data:')) this.data.push(line.slice(5).replace(/^ /, ''));
      else if (line === 'data') this.data.push('');
      else if (!line.startsWith(':') && !/^(event|id|retry):/.test(line)) throw new ProxyRejected('unsupported-upstream-sse-field', 502);
    }
    if (this.frameBytes + encoder.encode(this.pending).byteLength > this.policy.maxFrameBytes) throw new ProxyRejected('upstream-frame-too-large', 502);
  }
  private frame() {
    if (!this.data.length) return;
    if (++this.frames > 4096 || this.done) throw new ProxyRejected('unexpected-frame-after-terminal', 502);
    const data = this.data.join('\n');
    if (data === '[DONE]') { this.done = true; return; }
    let chunk: unknown; try { chunk = JSON.parse(data); } catch { throw new ProxyRejected('invalid-upstream-sse-json', 502); }
    if (!record(chunk) || chunk.error || chunk.object !== 'chat.completion.chunk' || chunk.model !== this.policy.model || !Array.isArray(chunk.choices) || chunk.choices.length > 1) throw new ProxyRejected('upstream-protocol-or-model-drift', 502);
    const id = correlationId(chunk.id);
    if (chunk.id !== undefined && chunk.id !== null && !id) throw new ProxyRejected('invalid-upstream-response-id', 502);
    if (id) { if (this.upstreamResponseId && this.upstreamResponseId !== id) throw new ProxyRejected('upstream-response-id-changed', 502); this.upstreamResponseId = id; }
    for (const choice of chunk.choices) {
      if (!record(choice) || choice.index !== 0 || !record(choice.delta)) throw new ProxyRejected('upstream-choice-protocol-drift', 502);
      if (this.finishReason && Object.values(choice.delta).some(value => value !== null && value !== '')) throw new ProxyRejected('content-after-terminal-finish', 502);
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        if (!['stop', 'length'].includes(String(choice.finish_reason))) throw new ProxyRejected('unexpected-probe-finish-reason', 502);
        if (this.finishReason && this.finishReason !== choice.finish_reason) throw new ProxyRejected('conflicting-terminal-finish', 502);
        this.terminalUsageSeen = false;
        this.finishReason = choice.finish_reason as string;
      }
    }
    if (chunk.usage !== undefined && chunk.usage !== null) this.captureUsage(chunk.usage);
  }
  private captureUsage(value: unknown) {
    const seenBefore = this.usageSeen; this.usageSeen = true;
    if (this.finishReason) this.terminalUsageSeen = true;
    if (!record(value)) { this.usageTainted = true; this.usageValid = false; this.usageProblem = 'invalid-usage'; return; }
    const promptDetails = record(value.prompt_tokens_details) ? value.prompt_tokens_details : {};
    const completionDetails = record(value.completion_tokens_details) ? value.completion_tokens_details : {};
    const next = {
      input: integer(value.prompt_tokens), output: integer(value.completion_tokens), total: integer(value.total_tokens),
      cacheRead: integer(promptDetails.cached_tokens ?? value.prompt_cache_hit_tokens),
      cacheWrite: integer(value.cache_creation_input_tokens), reasoning: integer(completionDetails.reasoning_tokens),
    };
    const consistent = next.input !== null && next.output !== null && next.total !== null && next.input + next.output === next.total
      && (next.cacheRead === null || next.cacheRead <= next.input) && (next.cacheWrite === null || next.cacheWrite <= next.input) && (next.reasoning === null || next.reasoning <= next.output);
    if (seenBefore && JSON.stringify(next) !== JSON.stringify(this.tokens)) { this.usageTainted = true; this.usageProblem = 'conflicting-usage-observations'; }
    if (!consistent) { this.usageTainted = true; this.usageProblem = 'invalid-or-inconsistent-usage'; }
    this.tokens = next; this.usageValid = consistent && !this.usageTainted;
    if (this.usageValid) this.usageProblem = 'provider-terminal-usage';
    if (next.output !== null && next.output > this.outputCeiling) throw new ProxyRejected('provider-output-ceiling-exceeded', 502);
    if (next.input !== null && next.input > this.inputCeiling) throw new ProxyRejected('provider-input-ceiling-exceeded', 502);
  }
  evidence(terminal: 'completed' | 'cancelled' | 'timeout' | 'failed'): UsageEvidence {
    const known = terminal === 'completed' && this.done && this.finishReason !== null && this.terminalUsageSeen && this.usageSeen && this.usageValid;
    const reason = terminal !== 'completed' ? `non-final-${terminal}` : !this.done || !this.finishReason ? 'missing-terminal-confirmation' : this.usageSeen && !this.terminalUsageSeen ? 'usage-not-confirmed-after-final-finish' : this.usageProblem;
    return { status: known ? 'known' : 'unknown', reason, observedTokens: { ...this.tokens }, billingAmount: null, billingStatus: 'held-for-review' };
  }
}
