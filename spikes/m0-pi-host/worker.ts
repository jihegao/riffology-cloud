import { hasProbeAuthorization, isRunId } from '../m0-cloud/auth.ts';
import { untilAbort } from '../m0-model-proxy/policy.ts';
export const ORIGIN = 'https://riffology-m0-pi-host-staging.jihe-gao.workers.dev';
export type HostAction = 'accept' | 'report' | 'cleanup';
export async function handleHostRequest(request: Request, env: { M0_PROBE_TOKEN?: string; M0_RUN_ID: string }, invoke: (action: HostAction) => Promise<unknown>) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-riffology-m0-mode': 'resource-loading-fixture' } });
  if (!await hasProbeAuthorization(request, env.M0_PROBE_TOKEN)) return json({ error: 'operator-required' }, 401);
  const url = new URL(request.url);
  const action = url.pathname.split('/').at(-1) as HostAction;
  if (!isRunId(env.M0_RUN_ID) || url.origin !== ORIGIN || url.search || url.hash || !['accept', 'report', 'cleanup'].includes(action)
    || url.pathname !== `/probe/${env.M0_RUN_ID}/${action}`) return json({ error: 'route-denied' }, 404);
  if (request.method !== (action === 'report' ? 'GET' : 'POST')) return json({ error: 'method-denied' }, 405);
  if (request.body) {
    const reader = request.body.getReader(), abort = new AbortController(), timer = setTimeout(() => abort.abort(), 1000);
    try { let ended = false; for (let i = 0; i < 16; i++) { const part = await untilAbort(reader.read(), abort.signal); if (part.done) { ended = true; break; } if (part.value.byteLength) return json({ error: 'empty-body-required' }, 400); } if (!ended) return json({ error: 'empty-body-required' }, 400); }
    catch { return json({ error: 'empty-body-required' }, 400); }
    finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  try { return json(await invoke(action), action === 'accept' ? 202 : 200); }
  catch { return json({ error: 'operation-unconfirmed', next: 'observe report; do not replay accept' }, 409); }
}
