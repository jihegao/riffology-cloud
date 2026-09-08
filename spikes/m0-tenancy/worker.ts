import { hasOperatorAuthorization, isKind, isObjectId, isRunId, isTenant, objectId, resourcePath, verifyCapability, type Kind, type Tenant } from './auth.ts';

export type JsonRecord = Record<string, unknown>;
export function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }); }
async function boundedBody(request: Request): Promise<JsonRecord> {
  if (!request.body || request.headers.has('transfer-encoding') || request.headers.get('content-length') === null) throw new Error('body-required');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0; let reads = 0; const deadline = Date.now() + 2000;
  try {
    while (true) {
      const remaining = deadline - Date.now(); if (remaining <= 0 || ++reads > 16) throw new Error('body-timeout');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { const part = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('body-timeout')), remaining); })]); if (part.done) break; length += part.value.byteLength; if (length > 256) throw new Error('body-too-large'); chunks.push(part.value); }
      finally { clearTimeout(timer); }
    }
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body-not-object');
  return value as JsonRecord;
}
export function parseResourcePath(pathname: string): { runId: string; tenant: Tenant; kind: Kind; objectId: string; servicePath: string } | null {
  const match = /^\/resource\/([^/]+)\/(alpha|bravo)\/(workspace|artifact)\/([^/]+)$/.exec(pathname);
  if (!match || !isRunId(match[1]) || !isTenant(match[2]) || !isKind(match[3]) || !isObjectId(match[4]) || match[4] !== objectId(match[2], match[3])) return null;
  return { runId: match[1], tenant: match[2], kind: match[3], objectId: match[4], servicePath: resourcePath(match[1], match[2], match[3], match[4]) };
}

export interface TenancyOperations {
  bootstrap(runId: string): Promise<unknown>;
  cleanup(runId: string): Promise<unknown>;
  resource(scope: { runId: string; tenant: Tenant; kind: Kind; objectId: string; servicePath: string }, write: boolean): Promise<unknown>;
}
export async function handleTenancyRequest(request: Request, env: { M0_PROBE_TOKEN?: string; ENVIRONMENT?: string; PROTOCOL_VERSION?: string }, operations: TenancyOperations | (() => TenancyOperations)): Promise<Response> {
  const getOperations = typeof operations === 'function' ? operations : () => operations;
  const url = new URL(request.url);
  if (env.ENVIRONMENT !== 'staging' || env.PROTOCOL_VERSION !== 'm0-v1' || url.search) return json({ error: 'probe-disabled-or-query-not-supported' }, 400);
  const resource = url.pathname.startsWith('/resource/') ? parseResourcePath(url.pathname) : null;
  if (resource) {
    if (!await verifyCapability(env.M0_PROBE_TOKEN ?? '', request.headers.get('x-m0-capability'), { run_id: resource.runId, tenant: resource.tenant, kind: resource.kind, object_id: resource.objectId, service_path: resource.servicePath })) return json({ error: 'scope-denied' }, 403);
    const write = request.method === 'POST';
    if (!write && request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
    if (write) { let body: JsonRecord; try { body = await boundedBody(request); } catch { return json({ error: 'invalid-fixed-body' }, 400); } if (JSON.stringify(body) !== '{"action":"write"}') return json({ error: 'invalid-fixed-body' }, 400); }
    try { return json(await getOperations().resource(resource, write)); }
    catch (error) {
      if (error instanceof Error && error.message === 'run-closed') return json({ error: 'run-closed' }, 403);
      return json({ error: 'resource-operation-failed' }, 502);
    }
  }
  if (!await hasOperatorAuthorization(request, env.M0_PROBE_TOKEN)) return json({ error: 'unauthorized' }, 401);
  const operatorMatch = /^\/(bootstrap|cleanup)\/([^/]+)$/.exec(url.pathname);
  if (request.method !== 'POST' || !operatorMatch || !isRunId(operatorMatch[2])) return json({ error: 'not-found' }, 404);
  let body: JsonRecord; try { body = await boundedBody(request); } catch { return json({ error: 'invalid-fixed-body' }, 400); }
  if (Object.keys(body).length !== 0) return json({ error: 'invalid-fixed-body' }, 400);
  try { const ops = getOperations(); return json(operatorMatch[1] === 'bootstrap' ? await ops.bootstrap(operatorMatch[2]) : await ops.cleanup(operatorMatch[2])); } catch { return json({ error: 'operator-operation-failed' }, 502); }
}
