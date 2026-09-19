import {privateBetaCandidate} from '../model-budget/private-beta-policy.ts';
import {piDeveloperOwner} from '../model-budget/pi-developer-policy.ts';
import type {PiDeveloperBudget} from '../model-budget/pi-developer-durable.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
import {G5_GLOBAL_ACTOR} from '../model-budget/g5-window.ts';
import {profileDigest} from './production-profile.ts';
import {authorizeWarmOutbound,type WarmAuthorityNamespace} from '../sandbox/warm-authority.ts';
import { PRODUCTION_MONEY_ACTOR, moneyReference, type ProductionMoneyLedger, type MoneyReference } from '../model-budget/production-money.ts';
import type { ProductionProfile } from './production-profile.ts';
import { productionFailure, productionHttpFailure, safeProviderErrorHint } from './openai-gateway-responses.ts';
import { modelBudgetTenantName, modelCallReference, type ModelCallRecord, type ModelCallRequest, type ModelCallTerminal, type ModelReleaseProof } from '../model-budget/core.ts';
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
  dispatch(tenantId: string, reference: ReturnType<typeof modelCallReference>): Promise<{ authorized: boolean; observeOnly: boolean; record: ModelCallRecord;controlledWindowDeadlineAt?:number }>;
  markUnknown(tenantId: string, reference: ReturnType<typeof modelCallReference>): Promise<ModelCallRecord>;
  releaseUndispatched?(tenantId:string,reference:ReturnType<typeof modelCallReference>,proof:ModelReleaseProof):Promise<ModelCallRecord>;
  finish(tenantId: string, reference: ReturnType<typeof modelCallReference>, terminal: ModelCallTerminal): Promise<ModelCallRecord>;
};
type BudgetNamespace = { getByName(name: string): BudgetStub };

export type G5ProxyGuard={
 lookupTrustedTurnRoute(identity:ModelCallRequest['identity']):Promise<{kind:'g5';taskKey:string;windowId:string;profileSha256:string}|null>;
 reserveTrustedCall(input:{request:ModelCallRequest;tokenReference:ReturnType<typeof modelCallReference>;profile:ProductionProfile}):Promise<{callKey:string;windowId:string;deadlineAt:number;replayed:boolean;mayDispatch:false}>;
 bindTrustedMoney(callKey:string,reference:MoneyReference):Promise<unknown>;
 claimTrustedDispatch(callKey:string):Promise<{authorized:boolean;deadlineAt:number}>;
 settleTrustedCall(callKey:string):Promise<unknown>;
 markUnknown(callKey:string,failure?:G5ProviderFailureEvidence):Promise<unknown>;
};
export type G5ProviderFailureEvidence={schemaVersion:1;stage:'admission'|'provider-dispatch'|'budget-finish';errorCode:string;observedAt:number};
export interface ModelProxyHttpEnv {
 PRIVATE_BETA_POLICY_JSON?:string;
 PI_DEVELOPER_POLICY_JSON?:string;
 PI_DEVELOPER_BUDGET?:{getByName(name:string):PiDeveloperBudget};
 G5_CONTROLLED_WINDOW_JSON?:string;
 G5_TOKEN_BUDGET?:BudgetNamespace;
 G5_WINDOW_GUARD?:{getByName(name:string):G5ProxyGuard};
  G4_CONTROLLED_WINDOW_JSON?:string;
  WORKSPACE_AGENT?:{getByName(name:string):ReturnType<WarmAuthorityNamespace['getByName']>&{piDeveloperTurnAuthorization?(input:{identity:ModelCallRequest['identity'];actor:ModelCallRequest['actor']}):Promise<boolean>}};
  TRUSTED_PI_SANDBOX: IdentityNamespace;
  TENANT_MODEL_BUDGET: BudgetNamespace;
  PRODUCTION_MODEL_BUDGET?:{getByName(name:string):Pick<ProductionMoneyLedger,'admit'|'reserve'|'dispatch'|'finish'|'markUnknown'|'releaseUndispatched'|'lookup'>};
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
  dispatchAdmissionDeadlineAt?:number;
  billingMode?:'observe';
  signal?: AbortSignal;
};
export type ProductModelProviderResult = {
  executionTerminal?:boolean;
  providerErrorHint?: string;
  status: number;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  responseContentType: 'text/event-stream' | 'application/json';
  responseBody: Uint8Array;
};
export interface ProductModelProvider { readonly productionProfile?:ProductionProfile; dispatch(input: ProductModelProviderInput): Promise<ProductModelProviderResult> }
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
function failureCode(error:unknown):string{const message=error instanceof Error?error.message:'';if(/^(?:opencode-go|invalid-opencode-go|model-call|invalid-model|g5-|production-|provider-fetch-)[a-z0-9-]{0,96}$/.test(message)||['rejected-auth','rate-limited','provider-failure','deadline','cancelled','malformed-stream','missing-usage','outcome-unknown'].includes(message))return message;if(error instanceof DOMException&&['AbortError','TimeoutError'].includes(error.name))return `provider-${error.name.toLowerCase()}`;if(error instanceof TypeError)return 'runtime-typeerror';return 'unclassified';}
function failureEvidence(stage:G5ProviderFailureEvidence['stage'],error:unknown,now:()=>number,upstreamStatus?:number,hint?:string):G5ProviderFailureEvidence{
 const code=failureCode(error);
 // Keep the existing strict receipt schema. Only a validated provider result
 // may supply this prefix; request data and raw upstream bodies never enter it.
 const safeHint=safeProviderErrorHint(hint);
 const errorCode=upstreamStatus===undefined?code:`upstream-http-${upstreamStatus}:${safeHint?safeHint+':':''}${code}`.slice(0,150);
 return {schemaVersion:1,stage,errorCode,observedAt:positive(now())};
}
function conflict(error: string, status?: string): Response {
  return Response.json({ error, ...(status ? { status } : {}) }, { status: 409, headers: { 'cache-control': 'no-store' } });
}
function normalizedProviderResult(value: unknown, claims: ModelTurnCapabilityClaims, envelopeValue: Envelope,developer=false): ProductModelProviderResult {
  exact(value, ['status', 'providerRequestId', 'inputTokens', 'outputTokens', 'responseContentType', 'responseBody', ...(value&&typeof value==='object'&&Object.hasOwn(value,'providerErrorHint')?['providerErrorHint']:[]), ...(value&&typeof value==='object'&&Object.hasOwn(value,'executionTerminal')?['executionTerminal']:[])], 'invalid-model-provider-result');
  if(value.executionTerminal!==undefined&&value.executionTerminal!==true)reject('invalid-model-provider-result');
  const status = bounded(value.status, 599, 100);
  const providerRequestId = value.providerRequestId === null ? null : typeof value.providerRequestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.providerRequestId) ? value.providerRequestId : reject('invalid-model-provider-result');
  const inputTokens = value.inputTokens === null ? null : bounded(value.inputTokens, envelopeValue.inputTokenUpperBound);
  const outputTokens = value.outputTokens === null ? null : bounded(value.outputTokens, Math.min(claims.maxOutputTokensPerCall, envelopeValue.maxOutputTokens));
  if ((inputTokens===null)!==(outputTokens===null)) reject('invalid-model-provider-result');
  if (value.responseContentType!=='text/event-stream'&&value.responseContentType!=='application/json') reject('invalid-model-provider-result');
  if (!(value.responseBody instanceof Uint8Array)||value.responseBody.byteLength<1||value.responseBody.byteLength>MAX_BODY) reject('invalid-model-provider-result');
  if(status>=200&&status<300&&(providerRequestId===null||((inputTokens===null||outputTokens===null)&&!(developer&&value.executionTerminal===true))||value.responseContentType!=='text/event-stream'))reject('invalid-model-provider-result');
  return {status,providerRequestId,inputTokens,outputTokens,providerErrorHint:safeProviderErrorHint(value.providerErrorHint),responseContentType:value.responseContentType,responseBody:Uint8Array.from(value.responseBody)};
}

/** Private service-binding gate. Provider/model authority comes only from the
 * signed Turn capability; the caller payload cannot select credentials or a model. */
export async function handleModelProxyRequest(request: Request, env: ModelProxyHttpEnv, provider: ProductModelProvider | null, now = Date.now, telemetry?:ProductModelTelemetry): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.protocol !== 'https:' || url.hostname !== 'model-proxy.riffology.internal'
    || url.pathname !== '/v1/responses' || url.search || url.hash) return new Response('not found', { status: 404 });
  if (request.headers.get('content-type') !== 'application/json' || request.headers.get('x-riffology-sandbox-role') !== 'trusted-pi') return denied();

  let body: ArrayBuffer, parsed: Envelope, claims: ModelTurnCapabilityClaims, observed: number, containerId:string;
  let checkWarm=async()=>{};
  try {
    body = await readBody(request);
    containerId = request.headers.get('x-riffology-sandbox-id') ?? '';
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
    if(claims.schemaVersion===2){const warm=claims;checkWarm=async()=>{const current=await authorizeWarmOutbound(env,{purpose:'model',scope:warm.identity.scope,turnId:warm.identity.turnId,dispatchId:warm.identity.dispatchId,sessionId:warm.identity.sessionId,actor:warm.actor,containerId,deadlineAt:warm.expiresAt},now);if(JSON.stringify(current.lease)!==JSON.stringify(warm.runtimeLease)||JSON.stringify(current.binding)!==JSON.stringify(warm.runtimeBinding)||current.actorId!==warm.trustedPiActorId)reject('model-capability-binding-denied');};await checkWarm();}
  } catch { return denied(); }
  if (!provider) return unavailable();

  const tenantId = claims.identity.scope.tenantId;
  let guard:G5ProxyGuard|null=null,route:Awaited<ReturnType<G5ProxyGuard['lookupTrustedTurnRoute']>>=null;
  let developer=false;
  if(env.PRIVATE_BETA_POLICY_JSON!==undefined?privateBetaCandidate(env.PRIVATE_BETA_POLICY_JSON):piDeveloperOwner(env.PI_DEVELOPER_POLICY_JSON,tenantId,claims.actor.userId,claims.identity.scope.projectId)){
    try{developer=await env.WORKSPACE_AGENT?.getByName(workspaceAgentName(tenantId,claims.identity.scope.workspaceId)).piDeveloperTurnAuthorization?.({identity:claims.identity,actor:claims.actor})===true;}catch{return denied();}
  }
  if(developer&&!env.PI_DEVELOPER_BUDGET)return denied();
  if(!developer&&env.G5_CONTROLLED_WINDOW_JSON!==undefined){
    if(!env.G5_WINDOW_GUARD)return denied();
    try{guard=env.G5_WINDOW_GUARD.getByName(G5_GLOBAL_ACTOR);route=await guard.lookupTrustedTurnRoute(claims.identity);}catch{return denied();}
  }
  const isG5=route!==null;
  if(isG5&&!env.G5_TOKEN_BUDGET)return denied();
  const budget = (developer?env.PI_DEVELOPER_BUDGET!:isG5?env.G5_TOKEN_BUDGET!:env.TENANT_MODEL_BUDGET).getByName(modelBudgetTenantName(tenantId));
  const production=provider.productionProfile;
  if(isG5){try{if(!production||claims.provider!=='openai'||route!.profileSha256!==await profileDigest(production))return denied();}catch{return denied();}}
  if(env.G5_CONTROLLED_WINDOW_JSON!==undefined&&!isG5&&!developer&&claims.provider==='openai')return denied();
  if(claims.provider==='openai'&&!production)return unavailable();
  if(production&&(claims.provider!==production.inferenceProvider||claims.model!==production.model||!env.PRODUCTION_MODEL_BUDGET))return denied();
  if((production||env.G4_CONTROLLED_WINDOW_JSON!==undefined)&&(parsed.inputBoundVersion!=='utf8-provider-payload-plus-4096-v1'||parsed.inputTokenUpperBound<new TextEncoder().encode(JSON.stringify(parsed.payload)).byteLength+4096))return denied();
  const money=production&&!developer?env.PRODUCTION_MODEL_BUDGET!.getByName(PRODUCTION_MONEY_ACTOR):null;
  let moneyRef:MoneyReference|undefined;
  let g5CallKey:string|undefined;
  let providerDeadlineAt=parsed.deadlineAt;
  let controlledWindowDeadlineAt:number|undefined;
  let reference: ReturnType<typeof modelCallReference>;
  try {
    const payloadSha256 = await turnDigest({ schemaVersion: 1, purpose: 'product-model-provider-payload', payload: parsed.payload });
    const reservationRequest:ModelCallRequest = {
      schemaVersion: 1, identity: claims.identity, actor: claims.actor,
      callId: parsed.callId, requestId: parsed.requestId, deadlineAt: parsed.deadlineAt,
      provider: claims.provider, model: claims.model, payloadSha256,
      inputTokenUpperBound: parsed.inputTokenUpperBound, maxOutputTokens: parsed.maxOutputTokens,
      inputBoundVersion: parsed.inputBoundVersion, budgetPolicyVersion: claims.budgetPolicyVersion,
    };
    // Token admission first: an explicit policy rejection creates no money hold.
    // Its durable dispatch fence remains untouched until money is authorized.
    const reservation=await budget.reserve(tenantId,reservationRequest);
    reference = modelCallReference(reservation.record);
    if(isG5){
      const global=await guard!.reserveTrustedCall({request:reservationRequest,tokenReference:reference,profile:production!});
      g5CallKey=global.callKey;
      if(global.windowId!==route!.windowId)throw Error('g5-route-window-conflict');
      controlledWindowDeadlineAt=positive(global.deadlineAt);
      providerDeadlineAt=Math.min(providerDeadlineAt,controlledWindowDeadlineAt);
      if(global.replayed)return conflict('model_call_observe_only');
    }
    if(money&&production){
      const admission=await money.admit({request:reservationRequest,profile:production});
      if(!admission.accepted){
        if(reservation.record.dispatchedAt===null)await budget.releaseUndispatched?.(tenantId,reference,{confirmationId:parsed.requestId,reason:'proxy-pre-dispatch-failed',observedAt:positive(now())});
        return conflict('model_money_admission_denied');
      }
      moneyRef=moneyReference(admission.record);
      if(!(await money.dispatch(moneyRef)).authorized){if(isG5)throw Error('g5-money-observe-only');return conflict('model_call_observe_only');}
      if(isG5){await guard!.bindTrustedMoney(g5CallKey!,moneyRef);const globalDispatch=await guard!.claimTrustedDispatch(g5CallKey!);if(!globalDispatch.authorized)throw Error('g5-global-dispatch-denied');providerDeadlineAt=Math.min(providerDeadlineAt,positive(globalDispatch.deadlineAt));}
    }
    const dispatch = await budget.dispatch(tenantId, reference);
    if(!isG5)controlledWindowDeadlineAt=dispatch.controlledWindowDeadlineAt;
    if(controlledWindowDeadlineAt!==undefined)providerDeadlineAt=Math.min(providerDeadlineAt,controlledWindowDeadlineAt);
    if(!isG5&&!developer&&env.G4_CONTROLLED_WINDOW_JSON!==undefined&&dispatch.controlledWindowDeadlineAt===undefined)throw Error('g4-window-fence-missing');
    if (!dispatch.authorized) {
      if(isG5)throw Error('g5-token-dispatch-denied');
      // A previously dispatched token call may have been sent by an older
      // release: only the explicit no-dispatch state proves there is no charge.
      if(money&&moneyRef&&!dispatch.observeOnly&&dispatch.record.dispatchedAt===null)await money.releaseUndispatched(moneyRef,{kind:'token-fence-denied-before-provider',confirmationId:parsed.requestId,tokenReservationId:reference.reservationId,observedAt:positive(now())});
      return conflict(dispatch.observeOnly ? 'model_call_observe_only' : 'model_call_not_dispatched', dispatch.record.status);
    }
  } catch(error) { if(isG5){if(g5CallKey)await guard!.markUnknown(g5CallKey,failureEvidence('admission',error,now)).catch(()=>{});if(reference!)await budget.markUnknown(tenantId,reference).catch(()=>{});}if(money&&moneyRef)await money.markUnknown(moneyRef,productionFailure(error)).catch(()=>{});return conflict('model_call_rejected'); }

  let result: ProductModelProviderResult;
  let upstreamFailureStatus:number|undefined;
  let upstreamErrorHint:string|undefined;
  let stage='provider-dispatch',started=now();
  try {
    const providerSessionId=`ses_${(await turnDigest({schemaVersion:1,purpose:'opencode-go-provider-session',scope:claims.identity.scope,sessionId:claims.identity.sessionId})).slice(0,26)}`;
    await checkWarm();
    if(developer&&await env.WORKSPACE_AGENT?.getByName(workspaceAgentName(tenantId,claims.identity.scope.workspaceId)).piDeveloperTurnAuthorization?.({identity:claims.identity,actor:claims.actor})!==true)throw Error('pi-developer-turn-denied');
    if(providerDeadlineAt<=now())throw Error('g4-window-deadline');
    result = normalizedProviderResult(await provider.dispatch({
      provider: claims.provider, model: claims.model, providerSessionId, idempotencyKey: parsed.requestId,
      ...(developer?{billingMode:'observe' as const}:{}),payload: parsed.payload,inputTokenUpperBound:parsed.inputTokenUpperBound,maxOutputTokens:parsed.maxOutputTokens,deadlineAt:parsed.deadlineAt,...(controlledWindowDeadlineAt===undefined?{}:{dispatchAdmissionDeadlineAt:providerDeadlineAt}),signal:request.signal,
    }), claims, parsed,developer);
    if(production&&(result.status<200||result.status>=300)){upstreamFailureStatus=result.status;upstreamErrorHint=safeProviderErrorHint(result.providerErrorHint);}
    emit(telemetry,{event:'provider-dispatch-result',status:result.status,contentType:result.responseContentType,requestIdPresent:result.providerRequestId!==null,usagePresent:result.inputTokens!==null&&result.outputTokens!==null,durationMs:now()-started});
    const usage=result.inputTokens===null||result.outputTokens===null
      ? {kind:'unknown' as const,observedAt:positive(now())}
      : {kind:'verified' as const,inputTokens:result.inputTokens,outputTokens:result.outputTokens,source:'provider-usage',observedAt:positive(now())};
    const terminal: ModelCallTerminal = {
      outcome: result.status >= 200 && result.status < 300 ? 'completed' : 'failed',
      errorCode: result.status >= 200 && result.status < 300 ? null : production?productionHttpFailure(result.status):'provider-rejected',
      providerRequestId: result.providerRequestId,
      usage,
    };
    stage='budget-finish';started=now();
    if(money&&moneyRef){
      if(result.inputTokens!==null&&result.outputTokens!==null&&result.providerRequestId!==null)await money.finish(moneyRef,{inputTokens:result.inputTokens,outputTokens:result.outputTokens,providerRequestId:result.providerRequestId,evidence:'provider-usage-conservative-price'});
      else await money.markUnknown(moneyRef,productionHttpFailure(result.status));
    }
    await budget.finish(tenantId, reference, terminal);
    if(isG5)await guard!.settleTrustedCall(g5CallKey!);
    emit(telemetry,{event:'budget-finish-result',outcome:'committed',durationMs:now()-started});
  } catch(error) {
    emit(telemetry,{event:'model-call-failure',stage,errorCode:failureCode(error),durationMs:now()-started});
    if(isG5&&g5CallKey)await guard!.markUnknown(g5CallKey,failureEvidence(stage as G5ProviderFailureEvidence['stage'],error,now,upstreamFailureStatus,upstreamErrorHint)).catch(()=>{});
    if(money&&moneyRef)await money.markUnknown(moneyRef,productionFailure(error)).catch(()=>{});
    await budget.markUnknown(tenantId, reference).catch(() => {});
    return unavailable();
  }
  const headers=new Headers({'content-type':result.responseContentType,'cache-control':'no-store'});if(result.providerRequestId)headers.set('x-request-id',result.providerRequestId);
  return new Response(Uint8Array.from(result.responseBody).buffer as ArrayBuffer, { status: result.status, headers });
}
