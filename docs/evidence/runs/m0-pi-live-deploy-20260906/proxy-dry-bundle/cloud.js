var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../spikes/m0-model-proxy/cloud.ts
import { DurableObject } from "cloudflare:workers";

// ../spikes/m0-cloud/auth.ts
var TENANTS = ["alpha", "bravo"];
var RUN_ID = /^[a-z0-9][a-z0-9-]{7,47}$/;
var encoder = new TextEncoder();
function isRunId(value) {
  return typeof value === "string" && RUN_ID.test(value);
}
__name(isRunId, "isRunId");
function isTenant(value) {
  return TENANTS.some((tenant) => tenant === value);
}
__name(isTenant, "isTenant");

// ../spikes/m0-model-proxy/policy.ts
var HISTORICAL_PROFILE = Object.freeze({ provider: "opencode-go", model: "deepseek-v4-flash", upstreamOrigin: "https://opencode.ai", upstreamPath: "/zen/go/v1/chat/completions" });
var GO_LIVE_BUDGET = Object.freeze({
  id: "go-flash-context-20260906",
  origin: "https://riffology-m0-model-proxy-go-live-staging.jihe-gao.workers.dev",
  runId: "go-live-g0-20260906",
  inputTokens: 1048576,
  outputTokens: 256,
  maxDispatches: 2,
  reservationMicrousd: 461712,
  maxRunMicrousd: 923424,
  inputMicrousdPerMillion: 44e4,
  outputMicrousdPerMillion: 132e4,
  verifiedAtMs: Date.parse("2026-09-06T00:00:00Z"),
  expiresAtMs: Date.parse("2026-09-07T00:00:00Z")
});
var PROXY_PATH = "/v1/chat/completions";
var ProxyRejected = class extends Error {
  static {
    __name(this, "ProxyRejected");
  }
  status;
  constructor(code, status = 400) {
    super(code);
    this.status = status;
  }
};
var encoder2 = new TextEncoder();
async function digest(bytes) {
  const data = typeof bytes === "string" ? encoder2.encode(bytes) : Uint8Array.from(bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (value) => value.toString(16).padStart(2, "0")).join("");
}
__name(digest, "digest");
function fixedPolicy(input) {
  for (const value of [input.proxyOrigin, input.upstreamOrigin]) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new ProxyRejected("invalid-server-origin", 503);
    }
    if (url.protocol !== "https:" || url.origin !== value || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") throw new ProxyRejected("invalid-server-origin", 503);
  }
  if (!/^\/(?:[a-z0-9_-]+\/)*chat\/completions$/.test(input.upstreamPath) || !/^[a-zA-Z0-9._-]{1,100}$/.test(input.provider) || !/^[a-zA-Z0-9._/-]{1,150}$/.test(input.model) || !/^[a-zA-Z0-9._-]{1,100}$/.test(input.callerPrincipal)) throw new ProxyRejected("invalid-server-policy", 503);
  if (input.mapper !== "deepseek-thinking-disabled") throw new ProxyRejected("unsupported-server-mapper", 503);
  const wholeContext = input.budgetProfile === GO_LIVE_BUDGET.id;
  if (input.budgetProfile !== void 0 && (!wholeContext || input.proxyOrigin !== GO_LIVE_BUDGET.origin || input.provider !== HISTORICAL_PROFILE.provider || input.model !== HISTORICAL_PROFILE.model || input.upstreamOrigin !== HISTORICAL_PROFILE.upstreamOrigin || input.upstreamPath !== HISTORICAL_PROFILE.upstreamPath || input.maxBodyBytes > 8192 || input.maxInputTokens !== GO_LIVE_BUDGET.inputTokens || input.maxOutputTokens !== 256)) throw new ProxyRejected("invalid-live-profile", 503);
  for (const [value, max] of [[input.maxBodyBytes, 65536], [input.maxInputTokens, wholeContext ? GO_LIVE_BUDGET.inputTokens : 8192], [input.maxOutputTokens, 256], [input.maxResponseBytes, 1048576], [input.maxFrameBytes, 65536], [input.timeoutMs, 3e4]]) if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new ProxyRejected("invalid-server-limit", 503);
  if (input.maxFrameBytes > input.maxResponseBytes) throw new ProxyRejected("invalid-server-limit", 503);
  return Object.freeze({ ...input });
}
__name(fixedPolicy, "fixedPolicy");
function validateRequestRoute(request, policy) {
  const url = new URL(request.url);
  if (url.origin !== policy.proxyOrigin || url.pathname !== PROXY_PATH || url.search || url.hash || url.username || url.password) throw new ProxyRejected("route-not-allowed", 404);
  if (request.method !== "POST") throw new ProxyRejected("method-not-allowed", 405);
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) throw new ProxyRejected("json-content-type-required", 415);
  for (const header of ["x-upstream-url", "x-provider", "x-model", "x-api-key", "x-endpoint", "x-budget", "x-role", "x-run-id", "x-reservation-id", "x-tenant-id", "x-workspace-id", "x-call-id"]) if (request.headers.has(header)) throw new ProxyRejected("caller-override-header-rejected", 403);
}
__name(validateRequestRoute, "validateRequestRoute");
function untilAbort(promise, signal) {
  if (signal.aborted) {
    void promise.catch(() => {
    });
    return Promise.reject(new ProxyRejected("request-aborted", 499));
  }
  return new Promise((resolve, reject) => {
    const abort = /* @__PURE__ */ __name(() => {
      signal.removeEventListener("abort", abort);
      reject(new ProxyRejected("request-aborted", 499));
    }, "abort");
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}
__name(untilAbort, "untilAbort");
async function readJsonBody(request, maxBytes, signal) {
  if (!request.body) throw new ProxyRejected("request-body-required");
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  let reads = 0;
  try {
    while (true) {
      const next = await untilAbort(reader.read(), signal);
      if (next.done) break;
      if (++reads > 65536) throw new ProxyRejected("request-body-chunk-limit", 413);
      size += next.value.byteLength;
      if (size > maxBytes) throw new ProxyRejected("request-body-too-large", 413);
      parts.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    let value;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new ProxyRejected("invalid-json-body");
    }
    return { value, rawBytes: size };
  } finally {
    void reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
}
__name(readJsonBody, "readJsonBody");
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
__name(object, "object");
function exactKeys(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new ProxyRejected("unknown-body-field");
}
__name(exactKeys, "exactKeys");
function boundedCompletionBody(value, policy) {
  if (!object(value)) throw new ProxyRejected("invalid-completion-body");
  exactKeys(value, ["model", "messages", "stream", "stream_options", "max_tokens", "temperature", "thinking"]);
  if (value.model !== policy.model || value.stream !== true) throw new ProxyRejected("model-or-stream-protocol-mismatch");
  if (!Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 32) throw new ProxyRejected("invalid-message-count");
  for (const message of value.messages) {
    if (!object(message)) throw new ProxyRejected("invalid-message");
    exactKeys(message, ["role", "content", "reasoning_content"]);
    if (!["system", "user", "assistant"].includes(String(message.role)) || typeof message.content !== "string" || message.reasoning_content !== void 0 && (message.role !== "assistant" || typeof message.reasoning_content !== "string")) throw new ProxyRejected("text-probe-messages-required");
  }
  const maxOutputTokens = value.max_tokens ?? policy.maxOutputTokens;
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > policy.maxOutputTokens) throw new ProxyRejected("output-token-limit");
  if (policy.budgetProfile === GO_LIVE_BUDGET.id && (maxOutputTokens !== 256 || value.messages.length > 8)) throw new ProxyRejected("fixed-live-diagnostic-required");
  if (value.stream_options !== void 0 && (!object(value.stream_options) || Object.keys(value.stream_options).length !== 1 || value.stream_options.include_usage !== true)) throw new ProxyRejected("stream-usage-required");
  if (value.temperature !== void 0 && (typeof value.temperature !== "number" || !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2)) throw new ProxyRejected("invalid-temperature");
  if (value.thinking !== void 0 && (!object(value.thinking) || Object.keys(value.thinking).length !== 1 || value.thinking.type !== "disabled")) throw new ProxyRejected("reasoning-expansion-disabled");
  const encoded = JSON.stringify({ ...value, max_tokens: maxOutputTokens, stream_options: { include_usage: true }, thinking: { type: "disabled" } });
  if (encoder2.encode(encoded).byteLength > policy.maxBodyBytes) throw new ProxyRejected("normalized-body-too-large", 413);
  return { encoded, maxOutputTokens };
}
__name(boundedCompletionBody, "boundedCompletionBody");
function upstreamHeaders(secret) {
  if (typeof secret !== "string" || secret.length < 1 || secret.length > 2048 || /\s/.test(secret)) throw new ProxyRejected("provider-secret-unavailable", 503);
  return new Headers({ authorization: `Bearer ${secret}`, "content-type": "application/json", accept: "text/event-stream" });
}
__name(upstreamHeaders, "upstreamHeaders");
function correlationId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._:/-]{1,256}$/.test(value) ? value : null;
}
__name(correlationId, "correlationId");

// ../spikes/m0-model-proxy/authority.ts
function validateInvocation(value, principal, now) {
  if (!value || value.kind !== "trusted-pi" || value.principal !== principal || !Number.isSafeInteger(value.expiresAtMs) || value.expiresAtMs <= now) throw new ProxyRejected("trusted-caller-required", 403);
  for (const field of ["tenantId", "workspaceId", "runId", "callId"]) if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value[field]) || ["__proto__", "constructor", "prototype"].includes(value[field])) throw new ProxyRejected("invalid-trusted-scope", 403);
}
__name(validateInvocation, "validateInvocation");
function safePositive(value) {
  return Number.isSafeInteger(value) && value > 0;
}
__name(safePositive, "safePositive");
function rateFor(approval, now) {
  const rate = approval.rate;
  let source;
  try {
    if (rate) source = new URL(rate.source);
  } catch {
  }
  if (!rate || rate.provider !== approval.provider || rate.model !== approval.model || !/^[a-zA-Z0-9._/-]{1,100}$/.test(rate.version) || !source || source.protocol !== "https:" || source.username || source.password || source.hash || !Number.isSafeInteger(rate.verifiedAtMs) || rate.verifiedAtMs > now || !Number.isSafeInteger(rate.expiresAtMs) || rate.expiresAtMs <= now || !safePositive(rate.inputMicrousdPerMillion) || !safePositive(rate.outputMicrousdPerMillion) || rate.boundsAllBillableTokens !== true) throw new ProxyRejected("verified-rate-required", 503);
  return rate;
}
__name(rateFor, "rateFor");
var RunReservationAuthority = class {
  static {
    __name(this, "RunReservationAuthority");
  }
  approval;
  store;
  now;
  approvalKey;
  constructor(approval, store, now = Date.now) {
    this.approval = Object.freeze({ ...approval, rate: approval.rate ? Object.freeze({ ...approval.rate }) : null });
    this.store = store;
    this.now = now;
    this.approvalKey = JSON.stringify(this.approval);
  }
  authorized(invocation) {
    validateInvocation(invocation, this.approval.principal, this.now());
    for (const field of ["kind", "principal", "tenantId", "workspaceId", "runId"]) if (invocation[field] !== this.approval[field]) throw new ProxyRejected("run-scope-denied", 403);
    if (!safePositive(this.approval.maxRunMicrousd) || this.approval.maxRunMicrousd > 1e6 || !Number.isSafeInteger(this.approval.expiresAtMs) || this.approval.expiresAtMs <= this.now() || invocation.expiresAtMs > this.approval.expiresAtMs) throw new ProxyRejected("approved-run-budget-required", 403);
    if (this.approval.budgetProfile !== void 0) {
      const rate = this.approval.rate;
      if (this.approval.budgetProfile !== GO_LIVE_BUDGET.id || this.approval.runId !== GO_LIVE_BUDGET.runId || !["call-1", "call-2"].includes(invocation.callId) || this.approval.provider !== HISTORICAL_PROFILE.provider || this.approval.model !== HISTORICAL_PROFILE.model || this.approval.maxRunMicrousd !== GO_LIVE_BUDGET.maxRunMicrousd || !rate || rate.inputMicrousdPerMillion !== GO_LIVE_BUDGET.inputMicrousdPerMillion || rate.outputMicrousdPerMillion !== GO_LIVE_BUDGET.outputMicrousdPerMillion || rate.verifiedAtMs !== GO_LIVE_BUDGET.verifiedAtMs || rate.expiresAtMs > GO_LIVE_BUDGET.expiresAtMs) throw new ProxyRejected("fixed-live-approval-required", 403);
    }
  }
  dispatchLimit() {
    return this.approval.budgetProfile === GO_LIVE_BUDGET.id ? 2 : 3;
  }
  ledger(current) {
    if (current && current.approval !== this.approvalKey) throw new ProxyRejected("durable-approval-conflict", 409);
    return current ?? { approval: this.approvalKey, heldMicrousd: 0, dispatchCount: 0, calls: {} };
  }
  async reserve(input) {
    input = structuredClone(input);
    this.authorized(input.invocation);
    if (input.provider !== this.approval.provider || input.model !== this.approval.model || !/^[a-f0-9]{64}$/.test(input.payloadHash) || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.platformRequestId) || !/^[a-zA-Z0-9._/-]{1,100}$/.test(input.inputBoundVersion) || !safePositive(input.inputTokenUpperBound) || input.inputTokenUpperBound > (this.approval.budgetProfile === GO_LIVE_BUDGET.id ? GO_LIVE_BUDGET.inputTokens : 8192) || !safePositive(input.maxOutputTokens) || input.maxOutputTokens > 256) throw new ProxyRejected("invalid-reservation", 403);
    if (this.approval.budgetProfile === GO_LIVE_BUDGET.id && (input.inputTokenUpperBound !== GO_LIVE_BUDGET.inputTokens || input.maxOutputTokens !== 256 || input.inputBoundVersion !== GO_LIVE_BUDGET.id)) throw new ProxyRejected("full-live-reservation-required", 403);
    return this.store.transact((current) => {
      const state = this.ledger(current);
      this.authorized(input.invocation);
      const previous = Object.hasOwn(state.calls, input.invocation.callId) ? state.calls[input.invocation.callId] : void 0;
      if (previous) {
        if (previous.payloadHash !== input.payloadHash) throw new ProxyRejected("call-payload-conflict", 409);
        return { state, value: { created: false, receipt: structuredClone(previous) } };
      }
      const rate = rateFor(this.approval, this.now());
      if (Object.keys(state.calls).length >= this.dispatchLimit() || state.dispatchCount >= this.dispatchLimit()) throw new ProxyRejected("run-dispatch-limit", 429);
      const numerator = BigInt(input.inputTokenUpperBound) * BigInt(rate.inputMicrousdPerMillion) + BigInt(input.maxOutputTokens) * BigInt(rate.outputMicrousdPerMillion);
      const reservation = (numerator + 999999n) / 1000000n;
      if (reservation > BigInt(this.approval.maxRunMicrousd - state.heldMicrousd)) throw new ProxyRejected("run-budget-exhausted", 402);
      const receipt = { ...input, reservationMicrousd: Number(reservation), rateVersion: rate.version, state: "reserved", dispatchOrdinal: null, facts: null, billingStatus: "held-for-review", billingAmount: null };
      state.heldMicrousd += receipt.reservationMicrousd;
      state.calls[input.invocation.callId] = receipt;
      return { state, value: { created: true, receipt: structuredClone(receipt) } };
    });
  }
  async markDispatched(callId, platformRequestId) {
    return this.store.transact((current) => {
      const state = this.ledger(current);
      const receipt = Object.hasOwn(state.calls, callId) ? state.calls[callId] : void 0;
      if (!receipt || receipt.platformRequestId !== platformRequestId || receipt.state !== "reserved") throw new ProxyRejected("dispatch-state-conflict", 409);
      this.authorized(receipt.invocation);
      rateFor(this.approval, this.now());
      if (state.dispatchCount >= this.dispatchLimit()) throw new ProxyRejected("run-dispatch-limit", 429);
      receipt.state = "dispatched";
      receipt.dispatchOrdinal = ++state.dispatchCount;
      return { state, value: structuredClone(receipt) };
    });
  }
  async finish(callId, platformRequestId, facts) {
    facts = structuredClone(facts);
    return this.store.transact((current) => {
      const state = this.ledger(current);
      const receipt = Object.hasOwn(state.calls, callId) ? state.calls[callId] : void 0;
      if (!receipt || receipt.platformRequestId !== platformRequestId) throw new ProxyRejected("receipt-scope-conflict", 409);
      if (receipt.state === "terminal") {
        if (JSON.stringify(receipt.facts) !== JSON.stringify(facts)) throw new ProxyRejected("terminal-receipt-conflict", 409);
        return { state, value: structuredClone(receipt) };
      }
      receipt.state = "terminal";
      receipt.facts = facts;
      return { state, value: structuredClone(receipt) };
    });
  }
};

// ../spikes/m0-model-proxy/capability.ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
var TRUSTED_PI_PRINCIPAL = "m0-trusted-pi";
var CAPABILITY_MAX_TTL_MS = 10 * 60 * 1e3;
var VERSION = "m0-model-capability-v1";
var INVOCATION_KEYS = ["kind", "principal", "tenantId", "workspaceId", "runId", "callId", "expiresAtMs"];
var RECORD_KEYS = ["version", "issuedAtMs", "invocation", "digestSha256"];
var RESERVED_IDS = /* @__PURE__ */ new Set([
  "__proto__",
  "prototype",
  "constructor",
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable"
]);
var MAX_TOKEN_LENGTH = 4 + 100 + 1 + 64;
var MAX_AUTHORIZATION_LENGTH = 7 + MAX_TOKEN_LENGTH;
function fields(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
  const result = {};
  for (const key of keys) {
    if (!Object.hasOwn(descriptors, key)) return null;
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return null;
    result[key] = descriptor.value;
  }
  return result;
}
__name(fields, "fields");
function identifier(value) {
  return typeof value === "string" && value.length <= 100 && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}(?![\s\S])/.test(value) && !RESERVED_IDS.has(value);
}
__name(identifier, "identifier");
function timestamp(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
__name(timestamp, "timestamp");
function invocationFrom(value) {
  const data = fields(value, INVOCATION_KEYS);
  if (!data || data.kind !== "trusted-pi" || data.principal !== TRUSTED_PI_PRINCIPAL || !identifier(data.tenantId) || !identifier(data.workspaceId) || !identifier(data.runId) || !identifier(data.callId) || !timestamp(data.expiresAtMs)) return null;
  return {
    kind: "trusted-pi",
    principal: TRUSTED_PI_PRINCIPAL,
    tenantId: data.tenantId,
    workspaceId: data.workspaceId,
    runId: data.runId,
    callId: data.callId,
    expiresAtMs: data.expiresAtMs
  };
}
__name(invocationFrom, "invocationFrom");
function parseToken(value) {
  if (typeof value !== "string" || value.length > MAX_TOKEN_LENGTH) return null;
  const match = /^m0p\.([a-zA-Z0-9][a-zA-Z0-9_-]{0,99})\.([0-9a-f]{64})(?![\s\S])/.exec(value);
  if (!match || !identifier(match[1])) return null;
  return { runId: match[1], token: value };
}
__name(parseToken, "parseToken");
function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(hex, "hex");
function digest2(token, invocation, issuedAtMs) {
  const canonical = [token, issuedAtMs, ...INVOCATION_KEYS.map((key) => invocation[key])];
  return createHash("sha256").update(`${VERSION}\0`).update(JSON.stringify(canonical)).digest();
}
__name(digest2, "digest");
function issueCapability(invocation, now = Date.now()) {
  let binding;
  try {
    binding = invocationFrom(invocation);
  } catch {
    binding = null;
  }
  if (!timestamp(now) || !binding || binding.expiresAtMs <= now || binding.expiresAtMs - now > CAPABILITY_MAX_TTL_MS) throw new Error("invalid-capability-invocation");
  const token = `m0p.${binding.runId}.${hex(randomBytes(32))}`;
  const record2 = Object.freeze({
    version: VERSION,
    issuedAtMs: now,
    invocation: Object.freeze(binding),
    digestSha256: hex(digest2(token, binding, now))
  });
  return Object.freeze({ token, record: record2 });
}
__name(issueCapability, "issueCapability");
function parseCapabilityAuthorization(header) {
  if (typeof header !== "string" || header.length > MAX_AUTHORIZATION_LENGTH || !header.startsWith("Bearer ")) return null;
  return parseToken(header.slice(7));
}
__name(parseCapabilityAuthorization, "parseCapabilityAuthorization");
function verifyCapability(token, record2, now = Date.now()) {
  try {
    const parsed = parseToken(token);
    const saved = fields(record2, RECORD_KEYS);
    if (!parsed || !saved || saved.version !== VERSION || !timestamp(now) || !timestamp(saved.issuedAtMs) || saved.issuedAtMs > now || typeof saved.digestSha256 !== "string" || !/^[0-9a-f]{64}(?![\s\S])/.test(saved.digestSha256)) return null;
    const binding = invocationFrom(saved.invocation);
    if (!binding || parsed.runId !== binding.runId || binding.expiresAtMs <= now || binding.expiresAtMs <= saved.issuedAtMs || binding.expiresAtMs - saved.issuedAtMs > CAPABILITY_MAX_TTL_MS) return null;
    const actual = digest2(parsed.token, binding, saved.issuedAtMs);
    const expected = Uint8Array.from(saved.digestSha256.match(/../g), (pair) => Number.parseInt(pair, 16));
    if (!timingSafeEqual(actual, expected)) return null;
    return Object.freeze(binding);
  } catch {
    return null;
  }
}
__name(verifyCapability, "verifyCapability");

// ../spikes/m0-model-proxy/durable-store.ts
function ledger(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-persisted-run-ledger");
  const row = value;
  if (typeof row.approval !== "string" || !Number.isSafeInteger(row.heldMicrousd) || row.heldMicrousd < 0 || !Number.isSafeInteger(row.dispatchCount) || row.dispatchCount < 0 || row.dispatchCount > 3 || !row.calls || typeof row.calls !== "object" || Array.isArray(row.calls)) throw new Error("invalid-persisted-run-ledger");
}
__name(ledger, "ledger");
var DurableRunStore = class {
  static {
    __name(this, "DurableRunStore");
  }
  storage;
  storageKey;
  constructor(storage, storageKey = "m0:model:ledger") {
    if (typeof storageKey !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(storageKey)) throw new Error("invalid-run-ledger-key");
    if (!storage || typeof storage.transactionSync !== "function" || typeof storage.sync !== "function" || !storage.kv || typeof storage.kv.get !== "function" || typeof storage.kv.put !== "function") throw new Error("sqlite-durable-storage-required");
    this.storage = storage;
    this.storageKey = storageKey;
  }
  async transact(operation) {
    const value = this.storage.transactionSync(() => {
      const stored = this.storage.kv.get(this.storageKey);
      if (stored !== void 0) ledger(stored);
      const current = stored === void 0 ? null : structuredClone(stored);
      const result = operation(current);
      if (result instanceof Promise) {
        void result.catch(() => {
        });
        throw new Error("run-ledger-operation-must-be-synchronous");
      }
      if (!result || typeof result !== "object" || typeof result.then === "function") throw new Error("run-ledger-operation-must-be-synchronous");
      ledger(result.state);
      const nextState = structuredClone(result.state);
      const nextValue = structuredClone(result.value);
      this.storage.kv.put(this.storageKey, nextState);
      return nextValue;
    });
    await this.storage.sync();
    return value;
  }
};

// ../spikes/m0-model-proxy/gateway-auth.ts
import { createHash as createHash2, createHmac, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
var DOMAIN = "riffology-m0-model-gateway-v1\0";
var MAX_SECRET_LENGTH = 1024;
var MAX_EXTERNAL_TOKEN_LENGTH = 4 + 100 + 1 + 64 + 1 + 64;
function singleBearer(header, maxTokenLength) {
  if (typeof header !== "string" || header.length > 7 + maxTokenLength || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  if (!/^[\x21-\x7e]+(?![\s\S])/.test(token) || token.includes(",")) return null;
  return token;
}
__name(singleBearer, "singleBearer");
function validSecret(secret) {
  return typeof secret === "string" && secret.length >= 32 && secret.length <= MAX_SECRET_LENGTH && /^[\x21-\x7e]+(?![\s\S])/.test(secret) && !secret.includes(",");
}
__name(validSecret, "validSecret");
function hex2(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(hex2, "hex");
function tag(innerToken, secret) {
  return createHmac("sha256", secret).update(DOMAIN).update(innerToken).digest();
}
__name(tag, "tag");
function wrapGatewayCapability(innerToken, secret) {
  if (!validSecret(secret)) throw new Error("invalid-model-gateway-secret");
  if (typeof innerToken !== "string" || !parseCapabilityAuthorization(`Bearer ${innerToken}`)) {
    throw new Error("invalid-inner-model-capability");
  }
  return `${innerToken}.${hex2(tag(innerToken, secret))}`;
}
__name(wrapGatewayCapability, "wrapGatewayCapability");
function unwrapGatewayAuthorization(header, secret) {
  if (!validSecret(secret)) return null;
  const external = singleBearer(header, MAX_EXTERNAL_TOKEN_LENGTH);
  if (!external) return null;
  const parts = external.split(".");
  if (parts.length !== 4 || !/^[0-9a-f]{64}(?![\s\S])/.test(parts[3])) return null;
  const innerToken = parts.slice(0, 3).join(".");
  const parsed = parseCapabilityAuthorization(`Bearer ${innerToken}`);
  if (!parsed) return null;
  const supplied = Uint8Array.from(parts[3].match(/../g), (pair) => Number.parseInt(pair, 16));
  if (!timingSafeEqual2(tag(innerToken, secret), supplied)) return null;
  return Object.freeze({ runId: parsed.runId, innerToken });
}
__name(unwrapGatewayAuthorization, "unwrapGatewayAuthorization");
function hasModelOperatorAuthorization(request, secret) {
  if (!validSecret(secret)) return false;
  const supplied = singleBearer(request.headers.get("authorization"), MAX_SECRET_LENGTH);
  if (!supplied) return false;
  const actual = createHash2("sha256").update(supplied).digest();
  const expected = createHash2("sha256").update(secret).digest();
  return timingSafeEqual2(actual, expected);
}
__name(hasModelOperatorAuthorization, "hasModelOperatorAuthorization");

// ../spikes/m0-model-proxy/stream.ts
var emptyTokens = /* @__PURE__ */ __name(() => ({ input: null, output: null, total: null, cacheRead: null, cacheWrite: null, reasoning: null }), "emptyTokens");
var integer = /* @__PURE__ */ __name((value) => Number.isSafeInteger(value) && value >= 0 ? value : null, "integer");
var record = /* @__PURE__ */ __name((value) => value !== null && typeof value === "object" && !Array.isArray(value), "record");
var encoder3 = new TextEncoder();
var CompletionStreamObserver = class {
  static {
    __name(this, "CompletionStreamObserver");
  }
  policy;
  outputCeiling;
  inputCeiling;
  decoder = new TextDecoder("utf-8", { fatal: true });
  pending = "";
  data = [];
  frameBytes = 0;
  totalBytes = 0;
  frames = 0;
  done = false;
  finishReason = null;
  upstreamResponseId = null;
  tokens = emptyTokens();
  usageSeen = false;
  usageValid = false;
  usageProblem = "missing-usage";
  usageTainted = false;
  terminalUsageSeen = false;
  constructor(policy, outputCeiling, inputCeiling = policy.maxInputTokens) {
    this.policy = policy;
    this.outputCeiling = outputCeiling;
    this.inputCeiling = inputCeiling;
  }
  push(bytes) {
    this.totalBytes += bytes.byteLength;
    if (this.totalBytes > this.policy.maxResponseBytes) throw new ProxyRejected("upstream-response-too-large", 502);
    let text;
    try {
      text = this.decoder.decode(bytes, { stream: true });
    } catch {
      throw new ProxyRejected("invalid-upstream-utf8", 502);
    }
    this.pending += text;
    this.lines(false);
  }
  end() {
    try {
      this.pending += this.decoder.decode();
    } catch {
      throw new ProxyRejected("invalid-upstream-utf8", 502);
    }
    this.lines(true);
    if (this.pending || this.data.length || !this.done) throw new ProxyRejected("incomplete-upstream-sse", 502);
  }
  lines(eof) {
    while (true) {
      const end = /\r\n|\r|\n/.exec(this.pending);
      if (!end || !eof && end[0] === "\r" && end.index === this.pending.length - 1) break;
      const line = this.pending.slice(0, end.index);
      this.pending = this.pending.slice(end.index + end[0].length);
      this.frameBytes += encoder3.encode(line).byteLength + end[0].length;
      if (this.frameBytes > this.policy.maxFrameBytes) throw new ProxyRejected("upstream-frame-too-large", 502);
      if (line === "") {
        this.frame();
        this.data = [];
        this.frameBytes = 0;
      } else if (line.startsWith("data:")) this.data.push(line.slice(5).replace(/^ /, ""));
      else if (line === "data") this.data.push("");
      else if (!line.startsWith(":") && !/^(event|id|retry):/.test(line)) throw new ProxyRejected("unsupported-upstream-sse-field", 502);
    }
    if (this.frameBytes + encoder3.encode(this.pending).byteLength > this.policy.maxFrameBytes) throw new ProxyRejected("upstream-frame-too-large", 502);
  }
  frame() {
    if (!this.data.length) return;
    if (++this.frames > 4096 || this.done) throw new ProxyRejected("unexpected-frame-after-terminal", 502);
    const data = this.data.join("\n");
    if (data === "[DONE]") {
      this.done = true;
      return;
    }
    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      throw new ProxyRejected("invalid-upstream-sse-json", 502);
    }
    if (!record(chunk) || chunk.error || chunk.object !== "chat.completion.chunk" || chunk.model !== this.policy.model || !Array.isArray(chunk.choices) || chunk.choices.length > 1) throw new ProxyRejected("upstream-protocol-or-model-drift", 502);
    const id = correlationId(chunk.id);
    if (chunk.id !== void 0 && chunk.id !== null && !id) throw new ProxyRejected("invalid-upstream-response-id", 502);
    if (id) {
      if (this.upstreamResponseId && this.upstreamResponseId !== id) throw new ProxyRejected("upstream-response-id-changed", 502);
      this.upstreamResponseId = id;
    }
    for (const choice of chunk.choices) {
      if (!record(choice) || choice.index !== 0 || !record(choice.delta)) throw new ProxyRejected("upstream-choice-protocol-drift", 502);
      if (this.finishReason && Object.values(choice.delta).some((value) => value !== null && value !== "")) throw new ProxyRejected("content-after-terminal-finish", 502);
      if (choice.finish_reason !== void 0 && choice.finish_reason !== null) {
        if (!["stop", "length"].includes(String(choice.finish_reason))) throw new ProxyRejected("unexpected-probe-finish-reason", 502);
        if (this.finishReason && this.finishReason !== choice.finish_reason) throw new ProxyRejected("conflicting-terminal-finish", 502);
        this.terminalUsageSeen = false;
        this.finishReason = choice.finish_reason;
      }
    }
    if (chunk.usage !== void 0 && chunk.usage !== null) this.captureUsage(chunk.usage);
  }
  captureUsage(value) {
    const seenBefore = this.usageSeen;
    this.usageSeen = true;
    if (this.finishReason) this.terminalUsageSeen = true;
    if (!record(value)) {
      this.usageTainted = true;
      this.usageValid = false;
      this.usageProblem = "invalid-usage";
      return;
    }
    const promptDetails = record(value.prompt_tokens_details) ? value.prompt_tokens_details : {};
    const completionDetails = record(value.completion_tokens_details) ? value.completion_tokens_details : {};
    const next = {
      input: integer(value.prompt_tokens),
      output: integer(value.completion_tokens),
      total: integer(value.total_tokens),
      cacheRead: integer(promptDetails.cached_tokens ?? value.prompt_cache_hit_tokens),
      cacheWrite: integer(value.cache_creation_input_tokens),
      reasoning: integer(completionDetails.reasoning_tokens)
    };
    const consistent = next.input !== null && next.output !== null && next.total !== null && next.input + next.output === next.total && (next.cacheRead === null || next.cacheRead <= next.input) && (next.cacheWrite === null || next.cacheWrite <= next.input) && (next.reasoning === null || next.reasoning <= next.output);
    if (seenBefore && JSON.stringify(next) !== JSON.stringify(this.tokens)) {
      this.usageTainted = true;
      this.usageProblem = "conflicting-usage-observations";
    }
    if (!consistent) {
      this.usageTainted = true;
      this.usageProblem = "invalid-or-inconsistent-usage";
    }
    this.tokens = next;
    this.usageValid = consistent && !this.usageTainted;
    if (this.usageValid) this.usageProblem = "provider-terminal-usage";
    if (next.output !== null && next.output > this.outputCeiling) throw new ProxyRejected("provider-output-ceiling-exceeded", 502);
    if (next.input !== null && next.input > this.inputCeiling) throw new ProxyRejected("provider-input-ceiling-exceeded", 502);
  }
  evidence(terminal) {
    const known = terminal === "completed" && this.done && this.finishReason !== null && this.terminalUsageSeen && this.usageSeen && this.usageValid;
    const reason = terminal !== "completed" ? `non-final-${terminal}` : !this.done || !this.finishReason ? "missing-terminal-confirmation" : this.usageSeen && !this.terminalUsageSeen ? "usage-not-confirmed-after-final-finish" : this.usageProblem;
    return { status: known ? "known" : "unknown", reason, observedTokens: { ...this.tokens }, billingAmount: null, billingStatus: "held-for-review" };
  }
};

// ../spikes/m0-model-proxy/index.ts
var json = /* @__PURE__ */ __name((status, value, id) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-riffology-request-id": id } }), "json");
function failureCode(error) {
  return error instanceof ProxyRejected ? "proxy-policy-rejected" : "proxy-upstream-or-adapter-failed";
}
__name(failureCode, "failureCode");
function createModelProxy(configuration, dependencies) {
  const policy = fixedPolicy(configuration);
  const now = dependencies.now ?? Date.now;
  return {
    policy,
    async handle(request) {
      const platformRequestId = crypto.randomUUID();
      const cancellation = new AbortController();
      let abortedAs = null;
      let receipt = null;
      let reservationStarted = false;
      let observer = new CompletionStreamObserver(policy, policy.maxOutputTokens);
      let reader = null;
      let sink = null;
      let streamActive = false;
      let upstreamHttpStatus = null;
      let upstreamRequestId = null;
      let upstreamRequestIdHeader = null;
      let finishPromise = null;
      let resolveCompletion;
      const completion = new Promise((resolve) => {
        resolveCompletion = resolve;
      });
      const clean = /* @__PURE__ */ __name(() => {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", cancelRequest);
      }, "clean");
      const cancelReader = /* @__PURE__ */ __name(() => {
        if (reader) {
          const active = reader;
          reader = null;
          void active.cancel().catch(() => {
          });
        }
      }, "cancelReader");
      const finish = /* @__PURE__ */ __name((outcome, errorCode) => {
        if (finishPromise) return finishPromise;
        clean();
        cancelReader();
        const facts = { outcome, errorCode, upstreamHttpStatus, upstreamRequestId, upstreamRequestIdHeader, upstreamResponseId: observer.upstreamResponseId, responseBytes: observer.totalBytes, usage: observer.evidence(outcome) };
        finishPromise = (async () => {
          if (!receipt) return { persistence: reservationStarted ? "unconfirmed" : "not-reserved", receipt: null, errorCode };
          try {
            const storageAbort = new AbortController();
            const deadline = setTimeout(() => storageAbort.abort(), Math.min(policy.timeoutMs, 5e3));
            try {
              const saved = await untilAbort(dependencies.authority.finish(receipt.invocation.callId, receipt.platformRequestId, facts), storageAbort.signal);
              return { persistence: "saved", receipt: saved, errorCode };
            } finally {
              clearTimeout(deadline);
            }
          } catch {
            return { persistence: "unconfirmed", receipt, errorCode: "terminal-persistence-unconfirmed" };
          }
        })();
        void finishPromise.then(resolveCompletion);
        return finishPromise;
      }, "finish");
      const abort = /* @__PURE__ */ __name((as) => {
        if (finishPromise || abortedAs) return;
        abortedAs = as;
        cancellation.abort();
        cancelReader();
        if (streamActive) {
          try {
            sink?.error(new Error(`proxy-${as}`));
          } catch {
          }
          void finish(as, `proxy-${as}`);
        }
      }, "abort");
      const cancelRequest = /* @__PURE__ */ __name(() => abort("cancelled"), "cancelRequest");
      const timer = setTimeout(() => abort("timeout"), policy.timeoutMs);
      request.signal.addEventListener("abort", cancelRequest, { once: true });
      if (request.signal.aborted) abort("cancelled");
      const checkAbort = /* @__PURE__ */ __name(() => {
        if (cancellation.signal.aborted) throw new ProxyRejected("request-aborted", abortedAs === "timeout" ? 504 : 499);
      }, "checkAbort");
      try {
        checkAbort();
        validateRequestRoute(request, policy);
        const authenticated = await untilAbort(dependencies.authenticate(request, cancellation.signal), cancellation.signal);
        const invocation = authenticated ? structuredClone(authenticated) : null;
        validateInvocation(invocation, policy.callerPrincipal, now());
        const body = await readJsonBody(request, policy.maxBodyBytes, cancellation.signal);
        const normalized = boundedCompletionBody(body.value, policy);
        if (!dependencies.inputTokenBound) throw new ProxyRejected("verified-input-token-bound-required", 503);
        const bound = await untilAbort(dependencies.inputTokenBound(normalized.encoded, cancellation.signal), cancellation.signal);
        if (bound.kind !== "verified-upper-bound" || bound.provider !== policy.provider || bound.model !== policy.model || !/^[a-zA-Z0-9._/-]{1,100}$/.test(bound.version) || !Number.isSafeInteger(bound.tokens) || bound.tokens < 1 || bound.tokens > policy.maxInputTokens) throw new ProxyRejected("verified-input-token-bound-required", 413);
        observer = new CompletionStreamObserver(policy, normalized.maxOutputTokens, bound.tokens);
        const headers = upstreamHeaders(await untilAbort(dependencies.resolveSecret(cancellation.signal), cancellation.signal));
        const payloadHash = await untilAbort(digest(normalized.encoded), cancellation.signal);
        checkAbort();
        reservationStarted = true;
        const reservation = await untilAbort(dependencies.authority.reserve({ invocation, platformRequestId, payloadHash, provider: policy.provider, model: policy.model, inputTokenUpperBound: bound.tokens, maxOutputTokens: normalized.maxOutputTokens, inputBoundVersion: bound.version }), cancellation.signal);
        receipt = reservation.receipt;
        if (!reservation.created) {
          clean();
          const record2 = { persistence: "saved", receipt, errorCode: "call-already-recorded" };
          resolveCompletion(record2);
          return { response: json(409, { error: "call-already-recorded", receipt }, platformRequestId), completion };
        }
        checkAbort();
        receipt = await untilAbort(dependencies.authority.markDispatched(invocation.callId, platformRequestId), cancellation.signal);
        checkAbort();
        validateInvocation(invocation, policy.callerPrincipal, now());
        const target = policy.upstreamOrigin + policy.upstreamPath;
        const pending = dependencies.fetch(target, { method: "POST", headers, body: normalized.encoded, redirect: "manual", signal: cancellation.signal });
        void pending.then((response) => {
          if (cancellation.signal.aborted) void response.body?.cancel().catch(() => {
          });
        }, () => {
        });
        const upstream = await untilAbort(pending, cancellation.signal);
        checkAbort();
        upstreamHttpStatus = upstream.status;
        for (const name of ["x-request-id", "request-id", "x-amzn-requestid"]) {
          const id = correlationId(upstream.headers.get(name));
          if (id) {
            upstreamRequestId = id;
            upstreamRequestIdHeader = name;
            break;
          }
        }
        if (upstream.status !== 200 || upstream.url && upstream.url !== target || !/^text\/event-stream(?:\s*;[^\r\n]*)?$/i.test(upstream.headers.get("content-type") ?? "") || !upstream.body) {
          void upstream.body?.cancel().catch(() => {
          });
          throw new ProxyRejected("upstream-http-or-protocol-rejected", 502);
        }
        reader = upstream.body.getReader();
        let pulls = 0;
        let deliveredBytes = 0;
        const stream = new ReadableStream({
          start(controller) {
            sink = controller;
          },
          async pull(controller) {
            if (finishPromise) return;
            try {
              checkAbort();
              if (!reader) throw new ProxyRejected("upstream-stream-unavailable", 502);
              const next = await untilAbort(reader.read(), cancellation.signal);
              checkAbort();
              if (++pulls > policy.maxResponseBytes + 1) throw new ProxyRejected("upstream-chunk-limit", 502);
              if (next.done) {
                observer.end();
                await finish("completed", null);
                controller.close();
                return;
              }
              observer.push(next.value);
              deliveredBytes += next.value.byteLength;
              if (deliveredBytes > policy.maxResponseBytes) throw new ProxyRejected("upstream-response-too-large", 502);
              if (next.value.byteLength) controller.enqueue(next.value);
              if (observer.done) {
                observer.end();
                await finish("completed", null);
                controller.close();
              }
            } catch (error) {
              const code = abortedAs ? `proxy-${abortedAs}` : failureCode(error);
              cancellation.abort();
              await finish(abortedAs ?? "failed", code);
              try {
                controller.error(new Error(code));
              } catch {
              }
            }
          },
          async cancel() {
            abort("cancelled");
            await finish("cancelled", "proxy-cancelled");
          }
        }, { highWaterMark: 0 });
        const responseHeaders = new Headers({ "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-riffology-request-id": platformRequestId });
        if (upstreamRequestId) responseHeaders.set("x-riffology-upstream-request-id", upstreamRequestId);
        streamActive = true;
        checkAbort();
        return { response: new Response(stream, { headers: responseHeaders }), completion };
      } catch (error) {
        cancellation.abort();
        const errorCode = abortedAs ? `proxy-${abortedAs}` : failureCode(error);
        await finish(abortedAs ?? "failed", errorCode);
        return { response: json(abortedAs === "timeout" ? 504 : abortedAs === "cancelled" ? 499 : error instanceof ProxyRejected ? error.status : 502, { error: errorCode }, platformRequestId), completion };
      }
    }
  };
}
__name(createModelProxy, "createModelProxy");

// ../spikes/m0-model-proxy/cloud.ts
var META_KEY = "m0:model:metadata";
var REVOKED_KEY = "m0:model:revoked";
var LEDGER_KEY = "m0:model:ledger";
var PROXY_ORIGIN = "https://riffology-m0-model-proxy-staging.jihe-gao.workers.dev";
var FIXTURE_MODEL = "m0-text-fixture";
var POLICY = {
  proxyOrigin: PROXY_ORIGIN,
  upstreamOrigin: "https://m0-model-provider.invalid",
  upstreamPath: "/v1/chat/completions",
  provider: "m0-fixture",
  model: FIXTURE_MODEL,
  callerPrincipal: TRUSTED_PI_PRINCIPAL,
  mapper: "deepseek-thinking-disabled",
  maxBodyBytes: 8192,
  maxInputTokens: 128,
  maxOutputTokens: 32,
  maxResponseBytes: 65536,
  maxFrameBytes: 8192,
  timeoutMs: 3e4
};
var LIVE_POLICY = {
  ...POLICY,
  ...HISTORICAL_PROFILE,
  proxyOrigin: GO_LIVE_BUDGET.origin,
  budgetProfile: GO_LIVE_BUDGET.id,
  maxInputTokens: GO_LIVE_BUDGET.inputTokens,
  maxOutputTokens: 256
};
function modelProfile(env) {
  if (env.M0_MODEL_MODE === "fixture-only") return { mode: "fixture-only", policy: POLICY, live: false };
  if (env.M0_MODEL_MODE === "go-live-only" && env.M0_CONTROL_ORIGIN === GO_LIVE_BUDGET.origin) return { mode: "go-live-only", policy: LIVE_POLICY, live: true };
  throw new ProxyRejected("model-profile-disabled", 503);
}
__name(modelProfile, "modelProfile");
var json2 = /* @__PURE__ */ __name((value, status = 200, mode = "fixture-only") => Response.json(value, { status, headers: {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-riffology-m0-mode": mode
} }), "json");
async function hasEmptyBody(request) {
  if (!request.body) return true;
  const reader = request.body.getReader();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 1500);
  try {
    for (let count = 0; count < 16; count++) {
      const part = await untilAbort(reader.read(), abort.signal);
      if (part.done) return true;
      if (part.value.byteLength) return false;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
}
__name(hasEmptyBody, "hasEmptyBody");
var M0ModelProxyRun = class extends DurableObject {
  static {
    __name(this, "M0ModelProxyRun");
  }
  #instanceNonce = crypto.randomUUID();
  #active = /* @__PURE__ */ new Map();
  #activeCalls = /* @__PURE__ */ new Map();
  #removeRequest(key) {
    this.#active.delete(key);
    this.#activeCalls.delete(key);
  }
  #requireCall(invocation) {
    const meta = this.#requireActive();
    if (this.ctx.storage.kv.get(`m0:model:cancel:${invocation.callId}`)) throw new ProxyRejected("call-cancelled", 403);
    if (meta.mode === "go-live-only") {
      if (!["call-1", "call-2"].includes(invocation.callId)) throw new ProxyRejected("fixed-live-call-required", 403);
      if (invocation.callId === "call-2") {
        const first = this.ctx.storage.kv.get(LEDGER_KEY)?.calls["call-1"];
        if (first?.state !== "terminal" || first.facts?.outcome !== "completed") throw new ProxyRejected("first-call-not-completed", 409);
      }
    }
  }
  #metadata() {
    return this.ctx.storage.kv.get(META_KEY);
  }
  #checkObject(runId) {
    if (modelProfile(this.env).live && runId !== GO_LIVE_BUDGET.runId) throw new ProxyRejected("fixed-live-run-required", 403);
    if (!isRunId(runId) || !this.ctx.id.equals(this.env.MODEL_RUNS.idFromName(`m0-model-${runId}`))) throw new ProxyRejected("run-object-mismatch", 403);
  }
  #requireActive() {
    const meta = this.#metadata();
    const profile = modelProfile(this.env);
    if (!meta || meta.schema !== 1 || meta.mode !== profile.mode || this.ctx.storage.kv.get(REVOKED_KEY) || meta.approval.expiresAtMs <= Date.now()) throw new ProxyRejected("run-unavailable", 403);
    this.#checkObject(meta.runId);
    return meta;
  }
  async initialize(runId, tenant) {
    this.#checkObject(runId);
    const profile = modelProfile(this.env), policy = profile.policy;
    if (!isTenant(tenant) || profile.live && tenant !== "alpha") throw new ProxyRejected("tenant-denied", 403);
    const now = Date.now();
    const expiresAtMs = profile.live ? Math.min(now + 6e5, GO_LIVE_BUDGET.expiresAtMs) : now + 6e5;
    if (profile.live && (now < GO_LIVE_BUDGET.verifiedAtMs || expiresAtMs <= now)) throw new ProxyRejected("live-rate-review-expired", 403);
    const base = { kind: "trusted-pi", principal: TRUSTED_PI_PRINCIPAL, tenantId: `m0-${tenant}`, workspaceId: `m0-${tenant}-${runId}`, runId, expiresAtMs };
    const capabilities = (profile.live ? ["call-1", "call-2"] : ["call-1", "call-2", "call-3"]).map((callId) => ({ callId, ...issueCapability({ ...base, callId }, now) }));
    const approval = profile.live ? {
      ...base,
      provider: policy.provider,
      model: policy.model,
      budgetProfile: GO_LIVE_BUDGET.id,
      maxRunMicrousd: GO_LIVE_BUDGET.maxRunMicrousd,
      rate: {
        provider: policy.provider,
        model: policy.model,
        version: "go-peak-public-tariff-20260906",
        source: "https://opencode.ai/docs/go/",
        verifiedAtMs: GO_LIVE_BUDGET.verifiedAtMs,
        expiresAtMs,
        inputMicrousdPerMillion: GO_LIVE_BUDGET.inputMicrousdPerMillion,
        outputMicrousdPerMillion: GO_LIVE_BUDGET.outputMicrousdPerMillion,
        boundsAllBillableTokens: true
      }
    } : {
      ...base,
      provider: policy.provider,
      model: policy.model,
      maxRunMicrousd: 5e4,
      rate: {
        provider: policy.provider,
        model: policy.model,
        version: "synthetic-fixture-not-money-v1",
        source: "https://m0-model-provider.invalid/rate-fixture",
        verifiedAtMs: now,
        expiresAtMs,
        inputMicrousdPerMillion: 1e6,
        outputMicrousdPerMillion: 2e6,
        boundsAllBillableTokens: true
      }
    };
    this.ctx.storage.transactionSync(() => {
      if (this.#metadata() || this.ctx.storage.kv.get(REVOKED_KEY)) throw new ProxyRejected("run-already-initialized-or-revoked", 409);
      const meta = {
        schema: 1,
        mode: profile.mode,
        runId,
        tenantId: base.tenantId,
        workspaceId: base.workspaceId,
        approval,
        capabilities: capabilities.map((item) => item.record)
      };
      this.ctx.storage.kv.put(META_KEY, meta);
    });
    await this.ctx.storage.sync();
    return {
      runId,
      mode: profile.mode,
      expiresAtMs,
      capabilities: capabilities.map(({ callId, token }) => ({ callId, token })),
      identitySource: profile.live ? "operator-authorized-live-probe; not production user login" : "operator-authorized-synthetic-probe; not production user login",
      liveEnabled: profile.live
    };
  }
  status(runId) {
    this.#checkObject(runId);
    const meta = this.#metadata(), profile = modelProfile(this.env);
    return {
      runId,
      mode: profile.mode,
      initialized: !!meta,
      tenantId: meta?.tenantId ?? null,
      workspaceId: meta?.workspaceId ?? null,
      revoked: this.ctx.storage.kv.get(REVOKED_KEY) === true,
      instanceNonce: this.#instanceNonce,
      ledger: this.ctx.storage.kv.get(LEDGER_KEY) ?? null,
      fixtureDispatches: this.ctx.storage.kv.get("m0:model:fixture-dispatches") ?? 0,
      cancelledCalls: meta?.capabilities.map((item) => item.invocation.callId).filter((callId) => this.ctx.storage.kv.get(`m0:model:cancel:${callId}`) === true) ?? [],
      activeRequests: this.#active.size,
      realProviderCalls: profile.live ? null : 0,
      liveEnabled: profile.live,
      ...profile.live ? {
        budgetBasis: "public-contract-token-value-upper-bound",
        budgetProfile: GO_LIVE_BUDGET.id,
        maxPlatformDispatches: 2,
        upstreamDispatchIntents: this.ctx.storage.kv.get(LEDGER_KEY)?.dispatchCount ?? 0,
        rawTokenValueReservedMicrousd: this.ctx.storage.kv.get(LEDGER_KEY)?.heldMicrousd ?? 0,
        GoQuotaDelta: null,
        cashCharge: null,
        absoluteCashCapProven: false
      } : {}
    };
  }
  async revoke(runId) {
    this.#checkObject(runId);
    this.ctx.storage.kv.put(REVOKED_KEY, true);
    await this.ctx.storage.sync();
    const count = this.#active.size;
    for (const controller of this.#active.values()) controller.abort();
    return { runId, revoked: true, activeRequestsAborted: count };
  }
  async cancelCall(innerToken) {
    const invocation = this.#invocation(new Request(modelProfile(this.env).policy.proxyOrigin + "/v1/cancel", { headers: { authorization: `Bearer ${innerToken}` } }));
    if (!invocation) throw new ProxyRejected("invalid-call-capability", 401);
    this.ctx.storage.transactionSync(() => {
      this.#requireActive();
      this.ctx.storage.kv.put(`m0:model:cancel:${invocation.callId}`, true);
    });
    await this.ctx.storage.sync();
    let count = 0;
    for (const [key, controller] of this.#active) if (this.#activeCalls.get(key) === invocation.callId) {
      controller.abort();
      count++;
    }
    return { runId: invocation.runId, callId: invocation.callId, cancelled: true, activeRequestsAborted: count };
  }
  async armAbort(runId) {
    this.#checkObject(runId);
    this.#requireActive();
    if (modelProfile(this.env).live) throw new ProxyRejected("fixture-fault-disabled-in-live", 403);
    this.ctx.storage.kv.put("m0:model:abort-after-intent", true);
    await this.ctx.storage.sync();
    return { runId, armed: true, fault: "after-durable-dispatch-intent-before-fixture" };
  }
  async restart(runId) {
    this.#checkObject(runId);
    this.#requireActive();
    await this.ctx.storage.sync();
    if (modelProfile(this.env).live && this.#active.size) throw new ProxyRejected("active-live-restart-denied", 409);
    this.ctx.abort("M0 controlled model-proxy restart; no provider request");
  }
  #invocation(request) {
    const parsed = parseCapabilityAuthorization(request.headers.get("authorization"));
    if (!parsed) return null;
    const meta = this.#requireActive();
    if (parsed.runId !== meta.runId) return null;
    for (const record2 of meta.capabilities) {
      const invocation = verifyCapability(parsed.token, record2);
      if (invocation && invocation.runId === meta.runId && invocation.tenantId === meta.tenantId && invocation.workspaceId === meta.workspaceId) return invocation;
    }
    return null;
  }
  async #fixture(invocation, init) {
    if (modelProfile(this.env).live) throw new ProxyRejected("fixture-transport-disabled", 403);
    this.#requireCall(invocation);
    init.signal?.throwIfAborted();
    if (this.ctx.storage.kv.get("m0:model:abort-after-intent") && !this.ctx.storage.kv.get("m0:model:abort-used")) {
      this.ctx.storage.kv.put("m0:model:abort-used", true);
      await this.ctx.storage.sync();
      this.ctx.abort("M0 intentional interruption after durable intent; no fixture/provider dispatch");
    }
    this.ctx.storage.transactionSync(() => {
      this.#requireCall(invocation);
      this.ctx.storage.kv.put("m0:model:fixture-dispatches", (this.ctx.storage.kv.get("m0:model:fixture-dispatches") ?? 0) + 1);
    });
    await this.ctx.storage.sync();
    this.#requireCall(invocation);
    init.signal?.throwIfAborted();
    const id = `fixture-${invocation.runId}-${invocation.callId}`;
    const frame = /* @__PURE__ */ __name((content, finish, usage) => `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      model: FIXTURE_MODEL,
      choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finish }],
      ...usage ? { usage } : {},
      synthetic: true
    })}

`, "frame");
    const encoder4 = new TextEncoder();
    if (invocation.callId !== "call-3") return new Response(
      frame("fixture-ok", null) + frame("", "stop", { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }) + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream", "x-request-id": `fixture-header-${invocation.callId}` } }
    );
    let controller;
    const abort = /* @__PURE__ */ __name(() => {
      try {
        controller.error(new Error("fixture-stream-cancelled"));
      } catch {
      }
      init.signal?.removeEventListener("abort", abort);
    }, "abort");
    const body = new ReadableStream({
      start(sink) {
        controller = sink;
        sink.enqueue(encoder4.encode(frame("fixture-begin", null, { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 })));
      },
      cancel() {
        init.signal?.removeEventListener("abort", abort);
      }
    });
    init.signal?.addEventListener("abort", abort, { once: true });
    if (init.signal?.aborted) abort();
    return new Response(body, { headers: { "content-type": "text/event-stream", "x-request-id": "fixture-header-call-3" } });
  }
  async fetch(request) {
    const profile = modelProfile(this.env), policy = profile.policy;
    if (this.#active.size >= (profile.live ? 1 : 8)) return json2({ error: "run-concurrency-limit" }, 429, profile.mode);
    const requestKey = crypto.randomUUID();
    const controller = new AbortController();
    this.#active.set(requestKey, controller);
    try {
      const meta = this.#requireActive();
      const invocation = this.#invocation(request);
      if (!invocation) throw new ProxyRejected("invalid-call-capability", 401);
      this.#requireCall(invocation);
      this.#activeCalls.set(requestKey, invocation.callId);
      const store = new DurableRunStore(this.ctx.storage);
      const guardedStore = { transact: /* @__PURE__ */ __name((operation) => store.transact((current) => {
        this.#requireCall(invocation);
        return operation(current);
      }), "transact") };
      const guardedAuthority = new RunReservationAuthority(meta.approval, guardedStore);
      const terminalAuthority = new RunReservationAuthority(meta.approval, store);
      const proxy = createModelProxy(policy, {
        authenticate: /* @__PURE__ */ __name(async () => {
          this.#requireCall(invocation);
          return this.#invocation(request);
        }, "authenticate"),
        authority: { reserve: /* @__PURE__ */ __name((input) => guardedAuthority.reserve(input), "reserve"), markDispatched: /* @__PURE__ */ __name((call, id) => guardedAuthority.markDispatched(call, id), "markDispatched"), finish: /* @__PURE__ */ __name((call, id, facts) => terminalAuthority.finish(call, id, facts), "finish") },
        // Live reserves the entire public model context, NOT a measured input count.
        inputTokenBound: /* @__PURE__ */ __name(async () => ({
          provider: policy.provider,
          model: policy.model,
          version: profile.live ? GO_LIVE_BUDGET.id : "synthetic-response-fixed-10-tokens-v1",
          kind: "verified-upper-bound",
          tokens: profile.live ? GO_LIVE_BUDGET.inputTokens : 128
        }), "inputTokenBound"),
        resolveSecret: /* @__PURE__ */ __name(async () => profile.live ? this.env.M0_GO_API_KEY ?? "" : "synthetic-fixture-not-a-provider-credential", "resolveSecret"),
        fetch: /* @__PURE__ */ __name(async (target, init) => {
          if (profile.live) {
            if (target !== HISTORICAL_PROFILE.upstreamOrigin + HISTORICAL_PROFILE.upstreamPath || init.method !== "POST" || init.redirect !== "manual") throw new ProxyRejected("live-target-denied", 403);
            this.#requireCall(invocation);
            init.signal?.throwIfAborted();
            const headers2 = new Headers(init.headers);
            headers2.set("user-agent", "riffology-m0-controlled-pi/1.0 (Pi/0.85.0)");
            headers2.set("x-opencode-session", "m0-" + GO_LIVE_BUDGET.runId);
            return fetch(target, { ...init, headers: headers2, redirect: "manual" });
          }
          if (target !== "https://m0-model-provider.invalid/v1/chat/completions") throw new ProxyRejected("fixture-target-denied", 403);
          return this.#fixture(invocation, init);
        }, "fetch")
      });
      const exchange = await proxy.handle(new Request(request, { signal: AbortSignal.any([request.signal, controller.signal]) }));
      this.ctx.waitUntil(exchange.completion.then((record2) => {
        if (record2.persistence === "unconfirmed") console.warn(JSON.stringify({ event: "model-receipt-unconfirmed", runId: meta.runId, callId: invocation.callId }));
      }).finally(() => {
        this.#removeRequest(requestKey);
      }));
      const headers = new Headers(exchange.response.headers);
      headers.set("x-riffology-m0-mode", profile.mode);
      return new Response(exchange.response.body, { status: exchange.response.status, headers });
    } catch (error) {
      this.#removeRequest(requestKey);
      controller.abort();
      return json2({ error: error instanceof ProxyRejected ? "model-call-denied" : "model-runtime-interrupted" }, error instanceof ProxyRejected ? error.status : 500, profile.mode);
    }
  }
};
var cloud_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    let profile;
    try {
      profile = modelProfile(env);
    } catch {
      return json2({ error: "probe-disabled" }, 503);
    }
    const send = /* @__PURE__ */ __name((value, status = 200) => json2(value, status, profile.mode), "send");
    if (env.PROTOCOL_VERSION !== "m0-model-proxy-v1") return send({ error: "probe-disabled" }, 503);
    if (url.origin !== env.M0_CONTROL_ORIGIN || url.search || url.hash || url.username || url.password) return send({ error: "origin-or-route-denied" }, 404);
    if (url.pathname === "/v1/chat/completions" || url.pathname === "/v1/cancel") {
      if (request.method !== "POST") return send({ error: "method-denied" }, 405);
      const capability = unwrapGatewayAuthorization(request.headers.get("authorization"), env.M0_PROBE_TOKEN);
      if (!capability || !isRunId(capability.runId) || profile.live && capability.runId !== GO_LIVE_BUDGET.runId) return send({ error: "model-capability-required" }, 401);
      if (url.pathname === "/v1/cancel") {
        if (!await hasEmptyBody(request)) return send({ error: "empty-body-required" }, 400);
        try {
          return send(await env.MODEL_RUNS.getByName(`m0-model-${capability.runId}`).cancelCall(capability.innerToken));
        } catch {
          return send({ error: "cancel-unconfirmed", next: "read run status; do not blindly repeat cancellation" }, 500);
        }
      }
      const uploadAbort = new AbortController();
      const uploadTimer = setTimeout(() => uploadAbort.abort(), 1500);
      let body;
      try {
        body = JSON.stringify((await readJsonBody(request, profile.policy.maxBodyBytes, AbortSignal.any([request.signal, uploadAbort.signal]))).value);
      } catch (error) {
        return send({ error: "invalid-or-incomplete-model-body" }, error instanceof ProxyRejected ? error.status : 400);
      } finally {
        clearTimeout(uploadTimer);
      }
      const headers = new Headers(request.headers);
      headers.set("authorization", `Bearer ${capability.innerToken}`);
      headers.delete("content-length");
      headers.delete("transfer-encoding");
      const input = new Request(profile.policy.proxyOrigin + url.pathname, { method: "POST", headers, body, signal: request.signal, redirect: "manual" });
      try {
        return await env.MODEL_RUNS.getByName(`m0-model-${capability.runId}`).fetch(input);
      } catch {
        return send({ error: "model-runtime-interrupted", next: "read run status; never replay an unknown call under a new ID" }, 500);
      }
    }
    if (!hasModelOperatorAuthorization(request, env.M0_PROBE_TOKEN)) return send({ error: "operator-required" }, 401);
    if (url.pathname === "/health" && request.method === "GET") return send({
      mode: profile.mode,
      liveEnabled: profile.live,
      protocolVersion: env.PROTOCOL_VERSION,
      realProviderCalls: profile.live ? null : 0,
      ...profile.live ? { fixedRunId: GO_LIVE_BUDGET.runId, maxPlatformDispatches: 2, absoluteCashCapProven: false } : {}
    });
    const match = /^\/probe\/([a-z0-9-]+)\/(status|revoke|restart|arm-abort|init\/(alpha|bravo))$/.exec(url.pathname);
    if (!match || !isRunId(match[1]) || profile.live && match[1] !== GO_LIVE_BUDGET.runId) return send({ error: "route-denied" }, 404);
    const runId = match[1], action = match[2];
    if (profile.live && (action === "init/bravo" || action === "arm-abort")) return send({ error: "fixed-live-action-denied" }, 403);
    if (request.method !== (action === "status" ? "GET" : "POST")) return send({ error: "method-denied" }, 405);
    if (!await hasEmptyBody(request)) return send({ error: "empty-body-required" }, 400);
    const run = env.MODEL_RUNS.getByName(`m0-model-${runId}`);
    try {
      if (action.startsWith("init/")) {
        const tenant = match[3];
        if (!isTenant(tenant)) return send({ error: "tenant-denied" }, 403);
        const result = await run.initialize(runId, tenant);
        return send({ ...result, capabilities: result.capabilities.map(({ callId, token }) => ({ callId, token: wrapGatewayCapability(token, env.M0_PROBE_TOKEN) })) });
      }
      if (action === "status") return send(await run.status(runId));
      if (action === "revoke") return send(await run.revoke(runId));
      if (action === "arm-abort") return send(await run.armAbort(runId));
      await run.restart(runId);
      return send({ error: "restart-did-not-interrupt" }, 500);
    } catch (error) {
      return send({ error: "control-operation-interrupted", next: "read status; do not blindly repeat mutations" }, error instanceof ProxyRejected ? error.status : 500);
    }
  }
};
export {
  M0ModelProxyRun,
  cloud_default as default
};
//# sourceMappingURL=cloud.js.map
