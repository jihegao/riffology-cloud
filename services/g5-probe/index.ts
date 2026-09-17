const PROBE_ORIGIN = 'https://riffology-g5-region-probe-us-east-20260916.jihe-gao.workers.dev';
const GATEWAY_ID = 'riffology-g5-region-probe-20260916';
const MODEL_ID = 'gpt-5.6-luna';
const PROBE_VERSION = 'g5-region-probe-us-east-v1';
const ACCOUNT_ID = '8b0d70250211aa10d89e20605a1c7e5e';
const MODELS_URL = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}/openai/models`;
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;

type G5ProbeEnv = {
  PRODUCTION_OPENAI_API_KEY: string;
  PRODUCTION_AI_GATEWAY_TOKEN: string;
  G5_PROBE_OPERATOR_CAPABILITY: string;
};

type ProbeState =
  | 'model-available'
  | 'model-unavailable'
  | 'region-blocked'
  | 'auth-rejected'
  | 'redirect-rejected'
  | 'body-limit-exceeded'
  | 'malformed-response'
  | 'upstream-rejected'
  | 'timeout'
  | 'transport-failed'
  | 'configuration-error';

type ProbeErrorCode =
  | null
  | 'model-not-listed'
  | 'unsupported-country-region-territory'
  | 'upstream-auth-rejected'
  | 'upstream-redirect-rejected'
  | 'upstream-body-limit-exceeded'
  | 'upstream-malformed-response'
  | 'upstream-http-rejected'
  | 'upstream-timeout'
  | 'upstream-transport-failed'
  | 'probe-configuration-error';

type ProbeResult = {
  version: typeof PROBE_VERSION;
  gateway: typeof GATEWAY_ID;
  model: typeof MODEL_ID;
  colo: string | null;
  executionPlacement?: string | null;
  status: number | null;
  state: ProbeState;
  errorCode: ProbeErrorCode;
  modelAvailable: boolean;
  inferenceCalls: 0;
};

type ProbeDependencies = {
  fetchImpl?: typeof fetch;
};

class ResponseLimitError extends Error {}

const encoder = new TextEncoder();

function notFound(): Response {
  return new Response('not found', {
    status: 404,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
  });
}

function json(result: ProbeResult): Response {
  return Response.json(result, { headers: { 'cache-control': 'no-store' } });
}

function validSecret(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 4096 && !/[\r\n]/.test(value);
}

async function safeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

async function hasNonEmptyBody(request: Request): Promise<boolean> {
  if (!request.body) return false;
  const reader = request.body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return false;
      if (next.value.byteLength > 0) return true;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function authorized(request: Request, env: G5ProbeEnv): Promise<boolean> {
  const url = new URL(request.url);
  if (
    request.method !== 'POST'
    || url.origin !== PROBE_ORIGIN
    || url.pathname !== '/probe'
    || url.search !== ''
    || url.hash !== ''
    || !validSecret(env.G5_PROBE_OPERATOR_CAPABILITY)
    || await hasNonEmptyBody(request)
  ) return false;
  const supplied = request.headers.get('authorization');
  if (!supplied?.startsWith('Bearer ')) return false;
  return safeEqual(supplied, `Bearer ${env.G5_PROBE_OPERATOR_CAPABILITY}`);
}

async function readBounded(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new ResponseLimitError();
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength === 0) return null;
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function listsModel(value: unknown): boolean | null {
  const root = object(value);
  if (!root || !Array.isArray(root.data)) return null;
  return root.data.some((item) => object(item)?.id === MODEL_ID);
}

function isRegionBlocked(value: unknown): boolean {
  const root = object(value);
  const error = object(root?.error);
  const code = error?.code ?? root?.code;
  return code === 'unsupported_country_region_territory';
}

function result(colo: string | null, fields: Omit<ProbeResult, 'version' | 'gateway' | 'model' | 'colo' | 'inferenceCalls'>): ProbeResult {
  return { version: PROBE_VERSION, gateway: GATEWAY_ID, model: MODEL_ID, colo, inferenceCalls: 0, ...fields };
}

function requestColo(request: Request): string | null {
  const colo = request.cf?.colo;
  return typeof colo === 'string' && /^[A-Z0-9]{3,8}$/.test(colo) ? colo : null;
}

function requestPlacement(request: Request): string | null {
  const placement = request.headers.get('cf-placement');
  return placement && /^(?:remote|local)-[A-Z0-9]{3,8}$/.test(placement) ? placement : null;
}

async function runProbe(request: Request, env: G5ProbeEnv, fetchImpl: typeof fetch): Promise<ProbeResult> {
  const colo = requestColo(request);
  if (!validSecret(env.PRODUCTION_OPENAI_API_KEY) || !validSecret(env.PRODUCTION_AI_GATEWAY_TOKEN)) {
    return result(colo, { status: null, state: 'configuration-error', errorCode: 'probe-configuration-error', modelAvailable: false });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('deadline', 'TimeoutError')), TIMEOUT_MS);
  const done = (value: ProbeResult): ProbeResult => {
    clearTimeout(timer);
    return value;
  };
  let response: Response;
  try {
    response = await fetchImpl(MODELS_URL, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${env.PRODUCTION_OPENAI_API_KEY}`,
        'cf-aig-authorization': `Bearer ${env.PRODUCTION_AI_GATEWAY_TOKEN}`,
        'cf-aig-cache-ttl': '0',
        'cf-aig-collect-log': 'false',
        'cf-aig-collect-log-payload': 'false',
        'cf-aig-max-attempts': '1',
        'cf-aig-skip-cache': 'true',
      },
    });
  } catch (error) {
    const timedOut = controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError';
    return done(result(colo, {
      status: null,
      state: timedOut ? 'timeout' : 'transport-failed',
      errorCode: timedOut ? 'upstream-timeout' : 'upstream-transport-failed',
      modelAvailable: false,
    }));
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    return done(result(colo, { status: response.status, state: 'redirect-rejected', errorCode: 'upstream-redirect-rejected', modelAvailable: false }));
  }

  let body: Uint8Array;
  try {
    body = await readBounded(response);
  } catch (error) {
    return done(result(colo, {
      status: response.status,
      state: error instanceof ResponseLimitError ? 'body-limit-exceeded' : 'transport-failed',
      errorCode: error instanceof ResponseLimitError ? 'upstream-body-limit-exceeded' : 'upstream-transport-failed',
      modelAvailable: false,
    }));
  }

  let parsed: unknown;
  try {
    parsed = parseJson(body);
  } catch {
    return done(result(colo, { status: response.status, state: 'malformed-response', errorCode: 'upstream-malformed-response', modelAvailable: false }));
  }

  if (response.status === 200) {
    const modelAvailable = listsModel(parsed);
    if (modelAvailable === null) return done(result(colo, { status: 200, state: 'malformed-response', errorCode: 'upstream-malformed-response', modelAvailable: false }));
    return done(result(colo, {
      status: 200,
      state: modelAvailable ? 'model-available' : 'model-unavailable',
      errorCode: modelAvailable ? null : 'model-not-listed',
      modelAvailable,
    }));
  }
  if (response.status === 403 && isRegionBlocked(parsed)) {
    return done(result(colo, { status: 403, state: 'region-blocked', errorCode: 'unsupported-country-region-territory', modelAvailable: false }));
  }
  if (response.status === 401 || response.status === 403) {
    return done(result(colo, { status: response.status, state: 'auth-rejected', errorCode: 'upstream-auth-rejected', modelAvailable: false }));
  }
  return done(result(colo, { status: response.status, state: 'upstream-rejected', errorCode: 'upstream-http-rejected', modelAvailable: false }));
}

export function createG5ProbeHandler(dependencies: ProbeDependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  return async (request: Request, env: G5ProbeEnv): Promise<Response> => {
    if (!await authorized(request, env)) return notFound();
    return json({...await runProbe(request, env, fetchImpl),executionPlacement:requestPlacement(request)});
  };
}

const handle = createG5ProbeHandler();

export default {
  fetch(request: Request, env: G5ProbeEnv): Promise<Response> {
    return handle(request, env);
  },
};

export const G5_PROBE_CONTRACT = Object.freeze({
  origin: PROBE_ORIGIN,
  modelsUrl: MODELS_URL,
  gateway: GATEWAY_ID,
  model: MODEL_ID,
  version: PROBE_VERSION,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  timeoutMs: TIMEOUT_MS,
});
