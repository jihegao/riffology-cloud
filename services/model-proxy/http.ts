import { modelBudgetTenantName, modelCallReference, type ModelCallRecord, type ModelCallRequest, type ModelCallTerminal } from '../model-budget/core.ts';
import { positive, turnDigest, turnId } from '../turn/protocol.ts';
import { verifyModelTurnCapability, type ModelTurnCapabilityClaims } from './capability.ts';
import { verifyTrustedModelRequest } from './internal-auth.ts';

const MAX_BODY = 1_100_000;
const MAX_AGE_MS = 30_000;
const FORBIDDEN_PROVIDER_KEYS = new Set(['apiKey', 'api_key', 'authorization', 'baseURL', 'base_url', 'max_output_tokens', 'model', 'provider']);

type Id = { toString(): string };
type IdentityNamespace = { idFromName(name: string): Id };
type BudgetStub = {
  reserve(tenantId: string, request: ModelCallRequest): Promise<{ record: ModelCallRecord; replayed: boolean }>;
  dispatch(tenantId: string, reference: ReturnType<typeof modelCallReference>): Promise<{ authorized: boolean; observeOnly: boolean; record: ModelCallRecord }>;
  markUnknown(tenantId: string, reference: ReturnType<typeof modelCallReference>): Promise<ModelCallRecord>;
  finish(tenantId: string, reference: ReturnType<typeof modelCallReference>, terminal: ModelCallTerminal): Promise<ModelCallRecord>;
};
type BudgetNamespace = { getByName(name: string): BudgetStub };

export interface ModelProxyHttpEnv {
  TRUSTED_PI_SANDBOX: IdentityNamespace;
  TENANT_MODEL_BUDGET: BudgetNamespace;
  M2_MODEL_PROXY_REQUEST_KEY: string;
  M2_MODEL_TURN_CAPABILITY_KEY: string;
}
export type ProductModelProviderInput = {
  provider: string;
  model: string;
  providerSessionId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  inputTokenUpperBound:number;
  maxOutputTokens: number;
  deadlineAt: number;
  signal?: AbortSignal;
};
export type ProductModelProviderResult = {
  status: number;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  responseContentType: 'text/event-stream' | 'application/json';
  responseBody: Uint8Array;
};
export interface ProductModelProvider { dispatch(input: ProductModelProviderInput): Promise<ProductModelProviderResult> }
export type ProductModelTelemetry = (event: Record<string, unknown>) => void;

type Envelope = {
  schemaVersion: 1;
  callId: string;
  requestId: string;
  deadlineAt: number;
  inputTokenUpperBound: number;
  inputBoundVersion: string;
  maxOutputTokens: number;
  payload: Record<string, unknown>;
};

function reject(code: string): never { throw Error(code); }
function exact(value: unknown, keys: string[], code: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) reject(code);
}
function bounded(value: unknown, maximum: number, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) reject('invalid-model-proxy-request');
  return value as number;
}
function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) reject('invalid-model-proxy-request');
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some(key => FORBIDDEN_PROVIDER_KEYS.has(key))) reject('model-provider-authority-field-denied');
  let encoded: string;
  try { encoded = JSON.stringify(object); } catch { reject('invalid-model-proxy-request'); }
  if (encoded === undefined || encoded.includes('"__proto__"')) reject('invalid-model-proxy-request');
  return JSON.parse(encoded) as Record<string, unknown>;
}
function envelope(value: unknown): Envelope {
  exact(value, ['schemaVersion', 'callId', 'requestId', 'deadlineAt', 'inputTokenUpperBound', 'inputBoundVersion', 'maxOutputTokens', 'payload'], 'invalid-model-proxy-request');
  if (value.schemaVersion !== 1) reject('invalid-model-proxy-request');
  return {
    schemaVersion: 1,
    callId: turnId(value.callId),
    requestId: turnId(value.requestId),
    deadlineAt: positive(value.deadlineAt),
    inputTokenUpperBound: bounded(value.inputTokenUpperBound, 1_048_576, 1),
    inputBoundVersion: turnId(value.inputBoundVersion),
    maxOutputTokens: bounded(value.maxOutputTokens, 131_072, 1),
    payload: jsonObject(value.payload),
  };
}
async function readBody(request: Request): Promise<ArrayBuffer> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY)) reject('model-proxy-body-too-large');
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; if (size > MAX_BODY) reject('model-proxy-body-too-large');
      chunks.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const joined = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return joined.buffer as ArrayBuffer;
}
function denied(): Response { return Response.json({ error: 'model_request_denied' }, { status: 403, headers: { 'cache-control': 'no-store' } }); }
function unavailable(): Response { return Response.json({ error: 'model_provider_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } }); }
function emit(telemetry:ProductModelTelemetry|undefined,event:Record<string,unknown>){try{telemetry?.(event);}catch{}}
function failureCode(error:unknown):string{const message=error instanceof Error?error.message:'';if(/^(?:opencode-go|invalid-opencode-go|model-call|invalid-model)[a-z0-9-]{0,96}$/.test(message))return message;if(error instanceof DOMException&&['AbortError','TimeoutError'].includes(error.name))return `provider-${error.name.toLowerCase()}`;return 'unclassified';}
function conflict(error: string, status?: string): Response {
  return Response.json({ error, ...(status ? { status } : {}) }, { status: 409, headers: { 'cache-control': 'no-store' } });
}
function normalizedProviderResult(value: unknown, claims: ModelTurnCapabilityClaims, envelopeValue: Envelope): ProductModelProviderResult {
  exact(value, ['status', 'providerRequestId', 'inputTokens', 'outputTokens', 'responseContentType', 'responseBody'], 'invalid-model-provider-result');
  const status = bounded(value.status, 599, 100);
  const providerRequestId = value.providerRequestId === null ? null : typeof value.providerRequestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.providerRequestId) ? value.providerRequestId : reject('invalid-model-provider-result');
  const inputTokens = value.inputTokens === null ? null : bounded(value.inputTokens, envelopeValue.inputTokenUpperBound);
  const outputTokens = value.outputTokens === null ? null : bounded(value.outputTokens, Math.min(claims.maxOutputTokensPerCall, envelopeValue.maxOutputTokens));
  if ((inputTokens===null)!==(outputTokens===null)) reject('invalid-model-provider-result');
  if (value.responseContentType!=='text/event-stream'&&value.responseContentType!=='application/json') reject('invalid-model-provider-result');
  if (!(value.responseBody instanceof Uint8Array)||value.responseBody.byteLength<1||value.responseBody.byteLength>MAX_BODY) reject('invalid-model-provider-result');
  if(status>=200&&status<300&&(providerRequestId===null||inputTokens===null||outputTokens===null||value.responseContentType!=='text/event-stream'))reject('invalid-model-provider-result');
  return {status,providerRequestId,inputTokens,outputTokens,responseContentType:value.responseContentType,responseBody:Uint8Array.from(value.responseBody)};
}

/** Private service-binding gate. Provider/model authority comes only from the
 * signed Turn capability; the caller payload cannot select credentials or a model. */
export async function handleModelProxyRequest(request: Request, env: ModelProxyHttpEnv, provider: ProductModelProvider | null, now = Date.now, telemetry?:ProductModelTelemetry): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.protocol !== 'https:' || url.hostname !== 'model-proxy.riffology.internal'
    || url.pathname !== '/v1/responses' || url.search || url.hash) return new Response('not found', { status: 404 });
  if (request.headers.get('content-type') !== 'application/json' || request.headers.get('x-riffology-sandbox-role') !== 'trusted-pi') return denied();

  let body: ArrayBuffer, parsed: Envelope, claims: ModelTurnCapabilityClaims, observed: number;
  try {
    body = await readBody(request);
    const containerId = request.headers.get('x-riffology-sandbox-id') ?? '';
    const rawAt = request.headers.get('x-riffology-request-at') ?? '';
    if (!/^\d+$/.test(rawAt)) reject('invalid-model-proxy-request-time');
    const requestAt = Number(rawAt); observed = positive(now());
    if (!Number.isSafeInteger(requestAt) || Math.abs(observed - requestAt) > MAX_AGE_MS) reject('expired-model-proxy-request');
    const capability = request.headers.get('x-riffology-model-capability') ?? '';
    await verifyTrustedModelRequest(env.M2_MODEL_PROXY_REQUEST_KEY, containerId, requestAt, capability, body, request.headers.get('x-riffology-request-mac') ?? '');
    claims = await verifyModelTurnCapability(env.M2_MODEL_TURN_CAPABILITY_KEY, capability, undefined, observed);
    if (env.TRUSTED_PI_SANDBOX.idFromName(claims.trustedPiActorId).toString() !== containerId) reject('model-capability-container-denied');
    parsed = envelope(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)));
    if (parsed.deadlineAt <= observed || parsed.deadlineAt > claims.expiresAt
      || parsed.inputTokenUpperBound > claims.maxInputTokensPerCall || parsed.maxOutputTokens > claims.maxOutputTokensPerCall) reject('model-capability-limit-denied');
  } catch { return denied(); }
  if (!provider) return unavailable();

  const tenantId = claims.identity.scope.tenantId;
  const budget = env.TENANT_MODEL_BUDGET.getByName(modelBudgetTenantName(tenantId));
  let reference: ReturnType<typeof modelCallReference>;
  try {
    const payloadSha256 = await turnDigest({ schemaVersion: 1, purpose: 'product-model-provider-payload', payload: parsed.payload });
    const reservation = await budget.reserve(tenantId, {
      schemaVersion: 1, identity: claims.identity, actor: claims.actor,
      callId: parsed.callId, requestId: parsed.requestId, deadlineAt: parsed.deadlineAt,
      provider: claims.provider, model: claims.model, payloadSha256,
      inputTokenUpperBound: parsed.inputTokenUpperBound, maxOutputTokens: parsed.maxOutputTokens,
      inputBoundVersion: parsed.inputBoundVersion, budgetPolicyVersion: claims.budgetPolicyVersion,
    });
    reference = modelCallReference(reservation.record);
    const dispatch = await budget.dispatch(tenantId, reference);
    if (!dispatch.authorized) return conflict(dispatch.observeOnly ? 'model_call_observe_only' : 'model_call_not_dispatched', dispatch.record.status);
  } catch { return conflict('model_call_rejected'); }

  let result: ProductModelProviderResult;
  let stage='provider-dispatch',started=now();
  try {
    const providerSessionId=`ses_${(await turnDigest({schemaVersion:1,purpose:'opencode-go-provider-session',scope:claims.identity.scope,sessionId:claims.identity.sessionId})).slice(0,26)}`;
    result = normalizedProviderResult(await provider.dispatch({
      provider: claims.provider, model: claims.model, providerSessionId, idempotencyKey: parsed.requestId,
      payload: parsed.payload,inputTokenUpperBound:parsed.inputTokenUpperBound,maxOutputTokens:parsed.maxOutputTokens,deadlineAt:parsed.deadlineAt,signal:request.signal,
    }), claims, parsed);
    emit(telemetry,{event:'provider-dispatch-result',status:result.status,contentType:result.responseContentType,requestIdPresent:result.providerRequestId!==null,usagePresent:result.inputTokens!==null&&result.outputTokens!==null,durationMs:now()-started});
    const usage=result.inputTokens===null||result.outputTokens===null
      ? {kind:'unknown' as const,observedAt:positive(now())}
      : {kind:'verified' as const,inputTokens:result.inputTokens,outputTokens:result.outputTokens,source:'provider-usage',observedAt:positive(now())};
    const terminal: ModelCallTerminal = {
      outcome: result.status >= 200 && result.status < 300 ? 'completed' : 'failed',
      errorCode: result.status >= 200 && result.status < 300 ? null : 'provider-rejected',
      providerRequestId: result.providerRequestId,
      usage,
    };
    stage='budget-finish';started=now();
    await budget.finish(tenantId, reference, terminal);
    emit(telemetry,{event:'budget-finish-result',outcome:'committed',durationMs:now()-started});
  } catch(error) {
    emit(telemetry,{event:'model-call-failure',stage,errorCode:failureCode(error),durationMs:now()-started});
    await budget.markUnknown(tenantId, reference).catch(() => {});
    return unavailable();
  }
  const headers=new Headers({'content-type':result.responseContentType,'cache-control':'no-store'});if(result.providerRequestId)headers.set('x-request-id',result.providerRequestId);
  return new Response(Uint8Array.from(result.responseBody).buffer as ArrayBuffer, { status: result.status, headers });
}
