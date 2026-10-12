// services/gateway/http.ts
function json(value, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
function requireOrigin(request, origin) {
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError("origin_denied", 403);
}
var HttpError = class extends Error {
  status;
  constructor(code, status) {
    super(code);
    this.status = status;
  }
};

// services/gateway/origins.ts
function publicHttpsOrigin(value) {
  const url = new URL(value);
  if (url.origin !== value || url.protocol !== "https:" || url.username || url.password || url.port || url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(url.hostname)) throw Error("invalid-public-origin");
  return url;
}
function requireRequestHost(request) {
  const url = new URL(request.url), host = request.headers.get("host");
  if (url.username || url.password || host !== null && host !== url.host) throw new HttpError("origin_denied", 403);
}

// services/gateway/transport-headers.ts
var g5ReadHeaders = ["x-riffology-g5-read-session", "x-riffology-g5-read-capability"];

// services/entry/signature.ts
var forwardedHeaders = ["accept", "accept-language", "content-type", "cookie", "origin", "referer", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "idempotency-key", "last-event-id", "range", "if-none-match", "if-modified-since", "user-agent", ...g5ReadHeaders];
var proofHeader = "x-riffoid-entry-proof";
var signatureHeader = "x-riffoid-entry-signature";
var SIGNATURE_LIFETIME_MS = 3e4;
var MAX_HEADER_BYTES = 16384;
var encoder = new TextEncoder();
var algorithm = { name: "ECDSA", namedCurve: "P-256" };
var signAlgorithm = { name: "ECDSA", hash: "SHA-256" };
var smallBodies = 0;
var largeBodies = 0;
var smallRequests = 0;
var largeRequests = 0;
function signedRequestCapacity(request) {
  if (request.body === null) return () => {
  };
  const large = request.method === "POST" && /^\/api\/admin\/models\/[A-Za-z0-9_-]{1,128}\/content$/.test(new URL(request.url).pathname);
  if (large ? largeRequests >= 1 : smallRequests >= 32) throw new HttpError("entry_body_capacity", 503);
  if (large) largeRequests++;
  else smallRequests++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (large) largeRequests--;
    else smallRequests--;
  };
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decode(value, size) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new HttpError("entry_proof_denied", 403);
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), (c) => c.charCodeAt(0));
  if (base64url(bytes) !== value || size !== void 0 && bytes.length !== size) throw new HttpError("entry_proof_denied", 403);
  return bytes;
}
async function sha256(value) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : Uint8Array.from(value))));
}
function clientIp(value) {
  if (value === null || value.length > 45) throw new HttpError("entry_ip_denied", 403);
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value) && value.split(".").every((part) => Number(part) <= 255)) return value;
  if (!/^[0-9a-fA-F:.]+$/.test(value) || !value.includes(":")) throw new HttpError("entry_ip_denied", 403);
  try {
    return new URL(`http://[${value}]/`).hostname.slice(1, -1);
  } catch {
    throw new HttpError("entry_ip_denied", 403);
  }
}
function forwarded(input) {
  const result = new Headers();
  for (const name of forwardedHeaders) {
    const value = input.get(name);
    if (value !== null) result.set(name, value);
  }
  if (encoder.encode(JSON.stringify([...result])).length > MAX_HEADER_BYTES) throw new HttpError("entry_headers_too_large", 431);
  result.set("cache-control", "no-store");
  return result;
}
async function headersHash(headers) {
  return sha256(JSON.stringify(forwardedHeaders.map((name) => [name, headers.get(name)])));
}
function pathQuery(request) {
  const url = new URL(request.url);
  if (url.hash) throw new HttpError("entry_proof_denied", 403);
  return request.url.slice(url.origin.length);
}
function keyId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(value)) throw Error("entry-key-config");
}
function jwk(value, privateKey) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("entry-key-config");
  const key = value, expected = privateKey ? ["kty", "crv", "x", "y", "d"] : ["kty", "crv", "x", "y"];
  if (Object.keys(key).length !== expected.length || expected.some((k) => !Object.hasOwn(key, k)) || key.kty !== "EC" || key.crv !== "P-256") throw Error("entry-key-config");
  for (const name of expected.filter((n) => !["kty", "crv"].includes(n))) if (typeof key[name] !== "string" || decode(key[name], 32).length !== 32) throw Error("entry-key-config");
  return key;
}
async function signedBody(request) {
  const large = request.method === "POST" && /^\/api\/admin\/models\/[A-Za-z0-9_-]{1,128}\/content$/.test(new URL(request.url).pathname);
  const maximum = large ? 8 * 1024 * 1024 : 32768, timeoutMs = large ? 3e4 : 5e3;
  const declared = request.headers.get("content-length");
  const transfer = request.headers.get("transfer-encoding");
  if (request.headers.has("content-encoding") || transfer !== null && (transfer.toLowerCase() !== "chunked" || declared !== null) || declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || !Number.isSafeInteger(Number(declared)))) throw new HttpError("entry_body_ambiguous", 400);
  if (declared !== null && Number(declared) > maximum) throw new HttpError("body_too_large", 413);
  if (["GET", "HEAD"].includes(request.method) && request.body !== null) throw new HttpError("entry_body_ambiguous", 400);
  if (request.body === null) {
    if (declared !== null && Number(declared) !== 0) throw new HttpError("entry_body_ambiguous", 400);
    return new Uint8Array();
  }
  if (large ? largeBodies >= 1 : smallBodies >= 32) throw new HttpError("entry_body_capacity", 503);
  const reader = request.body.getReader(), parts = [];
  let size = 0, timer;
  if (large) largeBodies++;
  else smallBodies++;
  let rejectAbort = () => {
  };
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new HttpError("request_timeout", 408)), timeoutMs);
    rejectAbort = () => reject(new HttpError("request_cancelled", 408));
  });
  request.signal.addEventListener("abort", rejectAbort, { once: true });
  try {
    if (request.signal.aborted) throw new HttpError("request_cancelled", 408);
    for (let count = 0; count < 8192; count++) {
      const chunk = await Promise.race([reader.read(), expired]);
      if (chunk.done) {
        if (declared !== null && Number(declared) !== size) throw new HttpError("entry_body_ambiguous", 400);
        const all = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          all.set(part, offset);
          offset += part.length;
        }
        return all;
      }
      size += chunk.value.byteLength;
      if (size > maximum) throw new HttpError("body_too_large", 413);
      parts.push(Uint8Array.from(chunk.value));
    }
    throw new HttpError("body_too_large", 413);
  } finally {
    if (large) largeBodies--;
    else smallBodies--;
    clearTimeout(timer);
    request.signal.removeEventListener("abort", rejectAbort);
    void reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
}
function withBody(request, headers, bytes) {
  return new Request(request.url, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? void 0 : bytes.slice().buffer, redirect: "manual", cache: "no-store", signal: request.signal });
}
async function signEntry(request, native, canonical, env, now) {
  if (new URL(native.url).origin !== canonical || native.method !== request.method || pathQuery(native) !== pathQuery(request)) throw new HttpError("entry_source_denied", 403);
  if (env.ENTRY_NATIVE_IP_BOUNDARY !== "cloudflare-direct-visitor-waf-v1" || !env.ENTRY_SIGNING_PRIVATE_JWK) throw new HttpError("entry_signing_not_configured", 503);
  if (native.headers.has("cf-worker")) throw new HttpError("entry_source_denied", 403);
  keyId(env.ENTRY_SIGNING_KEY_ID);
  const ip = clientIp(native.headers.get("cf-connecting-ip"));
  const key = await crypto.subtle.importKey("jwk", jwk(JSON.parse(env.ENTRY_SIGNING_PRIVATE_JWK), true), algorithm, false, ["sign"]);
  const bytes = await signedBody(native), headers = forwarded(request.headers), nonce = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const issued = now ?? Date.now();
  const proof = ["riffoid-entry-v1", env.ENTRY_SIGNING_KEY_ID, canonical, new URL(request.url).origin, request.method, pathQuery(request), issued, issued + SIGNATURE_LIFETIME_MS, nonce, ip, await sha256(bytes), await headersHash(headers)];
  const payload = encoder.encode(JSON.stringify(proof));
  if (payload.byteLength > 1536) throw new HttpError("entry_proof_too_large", 414);
  headers.set(proofHeader, base64url(payload));
  headers.set(signatureHeader, base64url(new Uint8Array(await crypto.subtle.sign(signAlgorithm, key, payload))));
  return withBody(request, headers, bytes);
}

// services/entry/abort.ts
function requestAbortBridge(source) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (source.aborted) abort();
  else source.addEventListener("abort", abort, { once: true });
  return { signal: controller.signal, abort, dispose: () => source.removeEventListener("abort", abort) };
}
function abortableResponse(response, bridge) {
  if (!response.body) {
    bridge.dispose();
    return response;
  }
  const reader = response.body.getReader();
  let done = false;
  let output;
  const finish = () => {
    if (done) return;
    done = true;
    bridge.signal.removeEventListener("abort", onAbort);
    bridge.dispose();
  };
  const onAbort = () => {
    if (done) return;
    finish();
    output.error(new DOMException("Request aborted", "AbortError"));
    void reader.cancel().catch(() => {
    });
  };
  const body = new ReadableStream({
    start(controller) {
      output = controller;
      bridge.signal.addEventListener("abort", onAbort, { once: true });
      if (bridge.signal.aborted) onAbort();
    },
    async pull(controller) {
      try {
        const value = await reader.read();
        if (done) return;
        if (value.done) {
          finish();
          controller.close();
        } else controller.enqueue(value.value);
      } catch (error) {
        if (!done) {
          finish();
          controller.error(error);
        }
      }
    },
    async cancel() {
      if (done) return;
      finish();
      bridge.abort();
      await reader.cancel().catch(() => {
      });
    }
  }, { highWaterMark: 0 });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// services/entry/index.ts
var requestHeaders = ["accept", "accept-language", "content-type", "cookie", "origin", "referer", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "idempotency-key", "last-event-id", "range", "if-none-match", "if-modified-since", "user-agent", ...g5ReadHeaders];
function checkedLocation(location, request, canonical) {
  if (/[\\\u0000-\u0020\u007f]/u.test(location) || /^\/\//.test(location) || /%(?:00|0a|0d|5c)/i.test(location)) throw Error("unsafe-upstream-location");
  if (!location.startsWith("/") && !location.startsWith("https://")) throw Error("unsafe-upstream-location");
  const target = new URL(location, canonical);
  if (target.username || target.password) throw Error("unsafe-upstream-location");
  if (target.origin === canonical) return;
  if (new URL(request.url).pathname === "/api/auth/sign-in/social" && request.method === "POST" && target.origin === "https://accounts.google.com" && target.pathname === "/o/oauth2/v2/auth" && target.searchParams.getAll("redirect_uri").length === 1 && target.searchParams.get("redirect_uri") === canonical + "/api/auth/callback/google") return;
  throw Error("unsafe-upstream-location");
}
function entryResponse(response, request, canonical) {
  if (response.status === 101) throw Error("upstream-upgrade-denied");
  const headers = new Headers(response.headers);
  for (const cookie of response.headers.getSetCookie()) {
    if (/;\s*domain\s*=/i.test(cookie) || !/^__Secure-riffology\.[A-Za-z0-9_-]+=/.test(cookie) || !/;\s*Secure(?:;|$)/i.test(cookie) || !/;\s*HttpOnly(?:;|$)/i.test(cookie) || !/;\s*SameSite=Lax(?:;|$)/i.test(cookie) || !/;\s*Path=\/(?:;|$)/i.test(cookie)) throw Error("unsafe-upstream-cookie");
  }
  const location = headers.get("location");
  if (location !== null) checkedLocation(location, request, canonical);
  headers.delete("access-control-allow-origin");
  headers.delete("access-control-allow-credentials");
  headers.set("cache-control", headers.get("content-type")?.startsWith("text/event-stream") ? "no-store, no-transform" : "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
async function entry(request, env, send = fetch) {
  let releaseCapacity = () => {
  };
  let bridge;
  try {
    const canonical = publicHttpsOrigin(env.APP_ORIGIN), transport = publicHttpsOrigin(env.APP_TRANSPORT_ORIGIN);
    if (canonical.origin === transport.origin) throw Error("entry-loop");
    requireRequestHost(request);
    const url = new URL(request.url);
    if (url.origin !== canonical.origin) throw new HttpError("origin_denied", 403);
    if (request.headers.has("upgrade")) throw new HttpError("upgrade_denied", 403);
    if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)) throw new HttpError("method_not_allowed", 405);
    if (!["GET", "HEAD"].includes(request.method)) requireOrigin(request, canonical.origin);
    const mode = env.TWO_ACCOUNT_AUTH_MODE ?? "disabled";
    if (mode === "disabled") return json({ error: "two_account_auth_disabled" }, 503);
    if (mode !== "signed-entry-v1" && mode !== "shared-limited") return json({ error: "entry_signing_not_configured" }, 503);
    if (mode === "signed-entry-v1") {
      bridge = requestAbortBridge(request.signal);
      request = new Request(request, { signal: bridge.signal });
    }
    const target = transport.origin + pathQuery(request);
    const headers = new Headers();
    for (const name of requestHeaders) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    headers.set("cache-control", "no-store");
    const init = { method: request.method, headers, redirect: "manual", cache: "no-store", signal: request.signal, duplex: "half" };
    if (mode === "shared-limited" && !["GET", "HEAD"].includes(request.method)) init.body = request.body;
    let upstream = new Request(target, init);
    if (mode === "signed-entry-v1") {
      releaseCapacity = signedRequestCapacity(request);
      upstream = await signEntry(upstream, request, canonical.origin, env);
    }
    const response = await send(upstream);
    try {
      const result = entryResponse(response, request, canonical.origin);
      if (!bridge) return result;
      const streaming = abortableResponse(result, bridge);
      bridge = void 0;
      return streaming;
    } catch {
      if (response.body) void response.body.cancel().catch(() => {
      });
      return json({ error: "upstream_response_denied" }, 502);
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: "entry_unavailable" }, 502);
  } finally {
    releaseCapacity();
    bridge?.dispose();
  }
}
var index_default = { fetch(request, env) {
  return entry(request, env);
} };
export {
  index_default as default,
  entry,
  entryResponse
};
