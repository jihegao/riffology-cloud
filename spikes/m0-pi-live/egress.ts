/** Fixed G0-T09 destinations, not a configurable general-purpose proxy.
 * Runtime must export ContainerProxy and use enableInternet=false,
 * interceptHttps=true and these exact allowedHosts WITH catch-all handlers.
 * DNS via Cloudflare's resolver is a documented platform exception; HTTP
 * handlers cannot claim to filter DNS packets or arbitrary TCP/UDP traffic.
 * https://developers.cloudflare.com/sandbox/guides/outbound-traffic/
 */
export const MODEL_PROXY_ORIGIN = 'https://riffology-m0-model-proxy-go-live-staging.jihe-gao.workers.dev';
export const TRUSTED_ALLOWED_HOSTS = Object.freeze([new URL(MODEL_PROXY_ORIGIN).hostname]);
export const DEPENDENCY_PIN = Object.freeze({
  filename: 'simpy-4.1.1-py3-none-any.whl', bytes: 27224,
  url: 'https://files.pythonhosted.org/packages/48/72/920ed1224c94a8a5a69e6c1275ac7fe4eb911ba8feffddf469f1629d47f3/simpy-4.1.1-py3-none-any.whl',
  sha256: '7c5ae380240fd2238671160e4830956f8055830a8317edf5c05e495b3823cd88',
  source: 'https://pypi.org/project/simpy/4.1.1/',
});
export const PROJECT_ALLOWED_HOSTS = Object.freeze(['files.pythonhosted.org']);
export type EgressFetcher = (request: Request) => Promise<Response>;
const CHAT = MODEL_PROXY_ORIGIN + '/v1/chat/completions';
const CANCEL = MODEL_PROXY_ORIGIN + '/v1/cancel';
const MAX_BODY = 8192;
// Transport metadata is accepted but discarded, never forwarded as routing or
// authorization input. Node fetch adds Sec-Fetch-Mode / Accept-Language.
const ORDINARY_HEADERS = new Set(['host', 'accept', 'accept-encoding', 'accept-language', 'user-agent', 'connection', 'content-length',
  'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'x-forwarded-proto', 'x-real-ip']);
const MODEL_RESPONSE_HEADERS = ['content-type', 'x-riffology-m0-mode', 'x-riffology-request-id', 'x-riffology-upstream-request-id', 'x-request-id', 'request-id', 'retry-after'];
const deny = (status = 403) => Response.json({ error: status === 403 ? 'egress-policy-denied' : 'egress-upstream-unconfirmed' },
  { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-riffology-m0-egress': 'fixed-v1' } });
const discard = (body: ReadableStream | null) => { if (body) void body.cancel().catch(() => {}); };

function exactUrl(request: Request, targets: string[]): string | null {
  let url: URL; try { url = new URL(request.url); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !targets.includes(request.url)) return null;
  const host = request.headers.get('host');
  return host !== null && host !== url.host ? null : request.url;
}
function headersAllowed(request: Request, model: boolean) {
  for (const [name] of request.headers) {
    if (!ORDINARY_HEADERS.has(name) && !(model && ['authorization', 'content-type'].includes(name))) return false;
  }
  return true;
}
/** These pure selectors never resolve DNS, allocate resources or fetch. */
export function trustedTarget(request: Request): string | null {
  const target = exactUrl(request, [CHAT, CANCEL]);
  if (!target || request.method !== 'POST' || !headersAllowed(request, true)) return null;
  // Shape check excludes operator/provider keys. The proxy still owns MAC,
  // capability expiry, principal, budget and call-count validation.
  if (!/^Bearer m0p\.[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(request.headers.get('authorization') ?? '')) return null;
  const contentType = request.headers.get('content-type');
  if (target === CHAT && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType ?? '')) return null;
  if (target === CANCEL && contentType !== null && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) return null;
  return target;
}
export function projectTarget(request: Request): string | null {
  return request.method === 'GET' && headersAllowed(request, false) ? exactUrl(request, [DEPENDENCY_PIN.url]) : null;
}

async function boundedBody(request: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(); let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('body-deadline')), 1000); });
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (let reads = 0; reads < 1024; reads++) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) {
        const result = new Uint8Array(bytes); let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
        return result;
      }
      bytes += part.value.byteLength;
      if (bytes > max) throw new Error('body-limit');
      chunks.push(part.value);
    }
    throw new Error('body-chunk-limit');
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function responseAllowed(response: Response, target: string) {
  return !response.redirected && (!response.url || response.url === target) && !(response.status >= 300 && response.status < 400)
    && !response.headers.has('location');
}

/** Inject ONLY the fixed MODEL_PROXY service binding's fetch method. No
 * environment access or ambient global fetch exists in this module. The VM's
 * bounded gateway capability is forwarded, never an operator/provider key. */
export async function trustedOutbound(request: Request, serviceFetch: EgressFetcher): Promise<Response> {
  const target = trustedTarget(request);
  if (!target) return deny();
  let body: Uint8Array<ArrayBuffer>;
  try { body = await boundedBody(request, target === CANCEL ? 0 : MAX_BODY); }
  catch { return deny(); }
  if (target === CHAT) {
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return deny();
      // Payload model and monetary policy stay in the proxy. Routing/header
      // knobs have no business crossing this earlier transport boundary.
      if (Object.keys(value).some(key => ['url', 'base_url', 'baseUrl', 'endpoint', 'headers', 'api_key', 'apiKey', 'upstream', 'upstream_url'].includes(key))) return deny();
    } catch { return deny(); }
  }
  const headers = new Headers({ authorization: request.headers.get('authorization')!, accept: target === CHAT ? 'text/event-stream' : 'application/json' });
  if (target === CHAT) headers.set('content-type', 'application/json');
  try {
    request.signal.throwIfAborted();
    const response = await serviceFetch(new Request(target, { method: 'POST', headers, body: target === CHAT ? body : undefined, redirect: 'manual', signal: request.signal }));
    if (!responseAllowed(response, target)) { discard(response.body); return deny(502); }
    const safe = new Headers({ 'cache-control': 'no-store', 'x-riffology-m0-egress': 'fixed-v1' });
    for (const name of MODEL_RESPONSE_HEADERS) { const value = response.headers.get(name); if (value !== null) safe.set(name, value); }
    return new Response(response.body, { status: response.status, headers: safe });
  } catch { return deny(502); }
}

/** Transport allows one immutable public file. The supervisor MUST compare
 * downloaded bytes with DEPENDENCY_PIN.sha256 before install/use; a 200 here is
 * transport evidence, not a claim that a digest has already been checked. */
export async function projectOutbound(request: Request, publicFetch: EgressFetcher): Promise<Response> {
  const target = projectTarget(request);
  if (!target) return deny();
  try { await boundedBody(request, 0); } catch { return deny(); }
  try {
    request.signal.throwIfAborted();
    const response = await publicFetch(new Request(target, { method: 'GET', headers: { accept: 'application/octet-stream' }, redirect: 'manual', signal: request.signal }));
    if (!responseAllowed(response, target) || response.status !== 200) { discard(response.body); return deny(502); }
    return new Response(response.body, { status: 200, headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-riffology-m0-egress': 'fixed-v1' } });
  } catch { return deny(502); }
}
