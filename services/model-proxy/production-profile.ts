import { turnDigest } from '../turn/protocol.ts';

/** Server configuration only. No model or price is selected by this module. */
export type ProductionProfile = {
  schemaVersion: 1; profileVersion: string; inferenceProvider: 'openai'; model: string;
  protocol: 'openai-responses'; billing: 'platform-byok';
  gateway: { kind: 'cloudflare'; accountId: string; gatewayId: string };
  secrets: { provider: 'PRODUCTION_OPENAI_API_KEY'; gateway: 'PRODUCTION_AI_GATEWAY_TOKEN' };
  acceptance: { evidenceSha256: string; privacyReviewSha256: string };
  rates: { version: string; currency: 'USD'; inputNanodollarsPerToken: number; outputNanodollarsPerToken: number };
  limits: { maxInputTokens: number; maxOutputTokens: number };
};
export function moneyInteger(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw Error('invalid-production-money-integer');
  return value as number;
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw Error('invalid-production-profile');
  return value as Record<string, unknown>;
}
function id(value: unknown, pattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw Error('invalid-production-profile');
  return value;
}
export function productionProfile(raw: unknown): ProductionProfile {
  const p = object(raw, ['schemaVersion','profileVersion','inferenceProvider','model','protocol','billing','gateway','secrets','acceptance','rates','limits']);
  const g = object(p.gateway, ['kind','accountId','gatewayId']), s = object(p.secrets, ['provider','gateway']);
  const a = object(p.acceptance, ['evidenceSha256','privacyReviewSha256']), r = object(p.rates, ['version','currency','inputNanodollarsPerToken','outputNanodollarsPerToken']), l = object(p.limits, ['maxInputTokens','maxOutputTokens']);
  if (p.schemaVersion !== 1 || p.inferenceProvider !== 'openai' || p.protocol !== 'openai-responses' || p.billing !== 'platform-byok' || g.kind !== 'cloudflare' || s.provider !== 'PRODUCTION_OPENAI_API_KEY' || s.gateway !== 'PRODUCTION_AI_GATEWAY_TOKEN' || r.currency !== 'USD') throw Error('invalid-production-profile');
  const input = moneyInteger(l.maxInputTokens, 1), output = moneyInteger(l.maxOutputTokens, 16);
  if (input > 1_048_576 || output > 131_072) throw Error('invalid-production-profile');
  const result: ProductionProfile = { schemaVersion: 1, profileVersion: id(p.profileVersion), inferenceProvider: 'openai', model: id(p.model, /^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$/), protocol: 'openai-responses', billing: 'platform-byok', gateway: {kind:'cloudflare',accountId:id(g.accountId,/^[a-f0-9]{32}$/),gatewayId:id(g.gatewayId,/^[a-z0-9][a-z0-9-]{0,63}$/)}, secrets:{provider:'PRODUCTION_OPENAI_API_KEY',gateway:'PRODUCTION_AI_GATEWAY_TOKEN'}, acceptance:{evidenceSha256:id(a.evidenceSha256,/^[a-f0-9]{64}$/),privacyReviewSha256:id(a.privacyReviewSha256,/^[a-f0-9]{64}$/)}, rates:{version:id(r.version),currency:'USD',inputNanodollarsPerToken:moneyInteger(r.inputNanodollarsPerToken,1),outputNanodollarsPerToken:moneyInteger(r.outputNanodollarsPerToken,1)}, limits:{maxInputTokens:input,maxOutputTokens:output}};
  conservativeCost(result,input,output);
  return result;
}
/** Uncached input price and full output (including reasoning) are upper rates.
 * Fractional nanodollar rates must be rounded upward by configuration authors. */
export function conservativeCost(profile: ProductionProfile, input: number, output: number): number {
  moneyInteger(input); moneyInteger(output);
  if (input > profile.limits.maxInputTokens || output > profile.limits.maxOutputTokens) throw Error('production-token-bound-exceeded');
  const amount = BigInt(input)*BigInt(profile.rates.inputNanodollarsPerToken)+BigInt(output)*BigInt(profile.rates.outputNanodollarsPerToken);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('production-money-overflow');
  return Number(amount);
}
export const productionEndpoint = (profile: ProductionProfile) => `https://gateway.ai.cloudflare.com/v1/${profile.gateway.accountId}/${profile.gateway.gatewayId}/openai/responses`;
export const profileDigest = (profile: ProductionProfile) => turnDigest({purpose:'production-model-profile',profile:productionProfile(profile)});
