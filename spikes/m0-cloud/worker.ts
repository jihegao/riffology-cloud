import { hasProbeAuthorization, isResourceKind, isRunId, isTenant, issueCapability, objectId, verifyCapability } from './auth.ts';

export interface ProbeEnvironment {
  M0_PROBE_TOKEN?: string;
  ENVIRONMENT?: string;
  PROTOCOL_VERSION?: string;
}
export interface ProbeOperations {
  isolation(runId: string): Promise<unknown>;
  tenancy(runId: string): Promise<unknown>;
  egress(runId: string): Promise<unknown>;
  cleanup(runId: string): Promise<unknown>;
}
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
type BodyReadObservation = {
  version: 1;
  authMs: number;
  readStartMs: number;
  firstReadMs: number;
  eofMs: number;
  timerMs: number;
  chunks: number;
  bytes: number;
  outcome: 'invalid_body' | 'reading' | 'complete' | 'deadline' | 'read_error' | 'size_limit' | 'invalid_json';
};
// Relative I/O timings only. Workers clocks do not advance during CPU execution.
// -1 means the event was not observed; no client-provided value is copied here.
function elapsed(started: number): number { return Math.max(0, Date.now() - started); }
function bodyObservation(authMs: number): BodyReadObservation {
  return { version: 1, authMs, readStartMs: -1, firstReadMs: -1, eofMs: -1, timerMs: -1, chunks: 0, bytes: 0, outcome: 'invalid_body' };
}
async function boundedJson(request: Request, observation?: BodyReadObservation, started = 0): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase().endsWith('/json')) throw new Error('InvalidBody');
  if (!request.body) throw new Error('InvalidBody');
  const reader = request.body.getReader();
  if (observation) { observation.readStartMs = elapsed(started); observation.outcome = 'reading'; }
  let length = 0;
  const chunks: Uint8Array[] = [];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      if (observation) { observation.timerMs = elapsed(started); observation.outcome = 'deadline'; }
      reject(new Error('BodyDeadline'));
    }, 1000);
  });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), expired]);
      if (observation && observation.firstReadMs === -1) observation.firstReadMs = elapsed(started);
      if (next.done) { if (observation) observation.eofMs = elapsed(started); break; }
      length += next.value.byteLength;
      if (observation) { observation.chunks++; observation.bytes = length; }
      if (length > 1024) { if (observation) observation.outcome = 'size_limit'; throw new Error('InvalidBody'); }
      chunks.push(next.value);
    }
  } catch {
    if (observation?.outcome === 'reading') observation.outcome = 'read_error';
    // Cancellation itself may be non-cooperative; it must not hold the request.
    void reader.cancel().catch(() => undefined);
    throw new Error('InvalidBody');
  } finally { clearTimeout(timeout); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { if (observation) observation.outcome = 'invalid_json'; throw new Error('InvalidBody'); }
  if (observation) observation.outcome = 'invalid_body';
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('InvalidBody');
  if (observation) observation.outcome = 'complete';
  return body as Record<string, unknown>;
}

type BodyScenario = 'complete' | 'drip' | 'stalled';
function fixedBodyStream(scenario: BodyScenario) {
  const encoder = new TextEncoder();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let state: 'open' | 'closed' | 'cancelled' | 'disposed' = 'open';
  const clearSourceTimers = () => { for (const timer of timers) clearTimeout(timer); timers.clear(); };
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      if (scenario === 'complete') {
        value.enqueue(encoder.encode('{"probe":"fixed"}')); value.close(); state = 'closed';
        return;
      }
      value.enqueue(encoder.encode('{"probe":'));
      if (scenario === 'drip') for (const delay of [300, 600, 900, 1200]) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (state !== 'open') return;
          value.enqueue(encoder.encode(delay === 1200 ? '"fixed"}' : ' '));
          if (delay === 1200) { value.close(); state = 'closed'; }
        }, delay);
        timers.add(timer);
      }
    },
    cancel() { state = 'cancelled'; clearSourceTimers(); },
  });
  return {
    scenario, stream,
    dispose() {
      clearSourceTimers();
      // All streams are owned, so erroring an open controller promptly settles
      // a pending read without awaiting a caller-controlled cancel promise.
      if (state === 'open') { state = 'disposed'; controller.error(new Error('DiagnosticStopped')); }
    },
    cleanupObservation() { return { sourceState: state, pendingSourceTimers: timers.size, streamLocked: Number(stream.locked) }; },
  };
}

async function internalBodyDiagnostics(): Promise<Response> {
  const started = Date.now();
  const totalLimitMs = 2500;
  const fixtures = (['complete', 'drip', 'stalled'] as const).map(fixedBodyStream);
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let totalDeadlineFired = false;
  const work = Promise.all(fixtures.map(async fixture => {
    const metrics = bodyObservation(0);
    let parseResult: 'accepted' | 'rejected' = 'rejected';
    let fixedValueMatched = 0;
    try {
      // This URL is only a Request identifier. No fetch, RPC or VM is involved.
      const input = new Request('https://m0-body-diagnostic.invalid/', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: fixture.stream, duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      const parsed = await boundedJson(input, metrics, started);
      parseResult = 'accepted';
      fixedValueMatched = Number(Object.keys(parsed).length === 1 && parsed.probe === 'fixed');
    } catch { /* Only the fixed metrics below leave this handler. */ }
    return { scenario: fixture.scenario, parseResult, fixedValueMatched, observation: metrics };
  }));
  try {
    await Promise.race([work, new Promise<void>(resolve => {
      totalTimer = setTimeout(() => {
        totalDeadlineFired = true;
        for (const fixture of fixtures) fixture.dispose();
        resolve();
      }, totalLimitMs);
    })]);
  } finally {
    clearTimeout(totalTimer);
    for (const fixture of fixtures) fixture.dispose();
  }
  // Disposal above settles every owned read; no arbitrary promise is joined.
  const cases = (await work).map((row, index) => ({ ...row, cleanup: fixtures[index]!.cleanupObservation() }));
  const expectedResults = cases.every(row => row.cleanup.pendingSourceTimers === 0 && row.cleanup.streamLocked === 0 && (row.scenario === 'complete'
    ? row.parseResult === 'accepted' && row.fixedValueMatched === 1 && row.observation.outcome === 'complete' && row.observation.timerMs === -1
    : row.parseResult === 'rejected' && row.observation.outcome === 'deadline' && row.observation.chunks === (row.scenario === 'drip' ? 4 : 1)));
  return json({
    version: 1, scope: 'cloud-internal-handler', gate_decision: 'not_evaluated',
    public_ingress_deadline: 'not_validated', status: totalDeadlineFired ? 'diagnostic_total_deadline' : expectedResults ? 'expected_observations_collected' : 'unexpected_observations',
    vmCalls: 0, modelCalls: 0, capabilitiesIssued: 0, bodyDeadlineMs: 1000, totalLimitMs,
    elapsedMs: elapsed(started), totalDeadlineFired: Number(totalDeadlineFired), cases,
  }, totalDeadlineFired ? 504 : expectedResults ? 200 : 502);
}

async function emptyDiagnosticBody(request: Request): Promise<boolean> {
  if (request.headers.has('transfer-encoding') || ![null, '0'].includes(request.headers.get('content-length'))) return false;
  if (request.body === null) return true;
  // Cloud ingress can represent a zero-byte body as an already-closed stream.
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const next = await Promise.race([reader.read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('BodyDeadline')), 1000);
    })]);
    return next.done === true;
  } catch { return false; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function handleProbeRequest(request: Request, env: ProbeEnvironment, operations: ProbeOperations): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health' && !url.search) {
    return json({ service: 'riffology-m0-probe', protocol: 'm0-v1', sandbox_sdk: '0.12.9', product_backend: false });
  }
  // Validate before allocating any DO, touching any VM or issuing fixture credentials.
  if (!await hasProbeAuthorization(request, env.M0_PROBE_TOKEN)) return json({ error: 'unauthorized' }, 401);
  const authMs = elapsed(started);
  if (env.ENVIRONMENT !== 'staging' || env.PROTOCOL_VERSION !== 'm0-v1') return json({ error: 'probe_environment_disabled' }, 503);
  if (url.search) return json({ error: 'query_parameters_not_supported' }, 400);
  const fixture = /^\/fixtures\/([a-z0-9-]+)\/(alpha|bravo)\/([a-z]+)\/([a-z0-9-]+)$/.exec(url.pathname);
  if (request.method === 'GET' && fixture) {
    const [, run_id, tenant, kind, object_id] = fixture;
    if (!isRunId(run_id) || !isTenant(tenant) || !isResourceKind(kind) || !object_id) return json({ error: 'invalid_scope' }, 400);
    if (!await verifyCapability(env.M0_PROBE_TOKEN!, request.headers.get('x-m0-capability'), { run_id, tenant, kind, object_id })) return json({ error: 'scope_denied' }, 403);
    return json({ fixture_only: true, run_id, tenant, kind, object_id, content: 'synthetic non-secret fixture' });
  }
  if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
  if (url.pathname === '/probes/body-reader-diagnostics') {
    // No parameters, even an empty JSON object: the client cannot choose a
    // body, delay, scenario, destination or capability scope for this probe.
    if (!await emptyDiagnosticBody(request)) return json({ error: 'diagnostic_body_not_allowed' }, 400);
    return internalBodyDiagnostics();
  }
  if (!['/probes/isolation', '/probes/tenancy', '/probes/egress', '/probes/cleanup', '/probes/capabilities'].includes(url.pathname)) return json({ error: 'not_found' }, 404);
  // Only this existing operator-only, non-VM route exposes fixed diagnostics.
  // The header is observational, not a signature, capability or authorization input.
  const observation = url.pathname === '/probes/capabilities' ? bodyObservation(authMs) : undefined;
  function bodyResponse(value: unknown, status = 200): Response {
    const response = json(value, status);
    if (observation) response.headers.set('x-m0-body-read-observation', JSON.stringify(observation));
    return response;
  }
  let body: Record<string, unknown>;
  try { body = await boundedJson(request, observation, started); } catch { return bodyResponse({ error: 'invalid_body' }, 400); }
  if (!isRunId(body.run_id)) return bodyResponse({ error: 'invalid_run_id' }, 400);
  const allowedKeys = url.pathname === '/probes/capabilities' ? ['run_id', 'tenant', 'kind'] : ['run_id'];
  if (Object.keys(body).some(key => !allowedKeys.includes(key))) return bodyResponse({ error: 'unexpected_field' }, 400);
  if (url.pathname === '/probes/capabilities') {
    if (!isTenant(body.tenant) || !isResourceKind(body.kind)) return bodyResponse({ error: 'invalid_scope' }, 400);
    return bodyResponse({ fixture_only: true, expires_in_seconds: 300, object_id: objectId(body.tenant, body.kind), capability: await issueCapability(env.M0_PROBE_TOKEN!, body.run_id, body.tenant, body.kind) });
  }
  const operation = url.pathname.slice('/probes/'.length) as keyof ProbeOperations;
  try {
    const result = await operations[operation](body.run_id);
    const failed = !!result && typeof result === 'object' && 'status' in result && ['probe_error', 'cleanup_incomplete'].includes(String(result.status));
    return json(result, failed ? 502 : 200);
  } catch {
    // SDK errors can contain command/output data. Detailed errors must be reviewed
    // in protected operator logs; never mirror them into the public HTTP response.
    return json({ run_id: body.run_id, status: 'probe_error', error: 'operation_failed', gate_decision: 'not_evaluated' }, 502);
  }
}
