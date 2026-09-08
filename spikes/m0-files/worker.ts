import { hasProbeAuthorization, isRunId } from '../m0-cloud/auth.ts';

export type ProbeResponse = { status: number; body: unknown };
export function fileSandboxId(coordinatorId: string): string {
  if (!/^[a-f0-9]{64}$/.test(coordinatorId)) throw new Error('invalid-coordinator-id');
  // 192 bits from the server-owned DO identifier fit the SDK's 63-character limit.
  return `m0-files-${coordinatorId.slice(0, 48)}`;
}
export interface FileProbeOperations {
  run(runId: string): Promise<ProbeResponse>;
  report(runId: string): Promise<ProbeResponse>;
  cleanup(runId: string): Promise<ProbeResponse>;
}
export async function handleFilesRequest(request: Request, env: {
  M0_PROBE_TOKEN?: string; ENVIRONMENT?: string; PROTOCOL_VERSION?: string;
}, operations: FileProbeOperations): Promise<Response> {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  const respond = (body: unknown, status: number) => Response.json(body, { status, headers });
  if (!await hasProbeAuthorization(request, env.M0_PROBE_TOKEN)) return respond({ error: 'unauthorized' }, 401);
  if (env.ENVIRONMENT !== 'staging' || env.PROTOCOL_VERSION !== 'm0-v1') return respond({ error: 'probe-environment-disabled' }, 503);
  const url = new URL(request.url), match = url.pathname.match(/^\/probe\/([^/]+)\/(run|report|cleanup)$/);
  if (!match || !isRunId(match[1]) || url.search) return respond({ error: 'not-found' }, 404);
  const action = match[2] as keyof FileProbeOperations;
  if (request.method !== (action === 'report' ? 'GET' : 'POST')) return respond({ error: 'method-not-allowed' }, 405);
  // The caller selects a fixed run, never commands, scripts, paths or restore bytes.
  if (request.body !== null) {
    const reader = request.body.getReader();
    let nonempty = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      nonempty = !(await Promise.race([reader.read(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('body-deadline')), 1000);
      })])).done;
    } catch { nonempty = true; }
    finally {
      clearTimeout(timer);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (nonempty) return respond({ error: 'body-not-allowed' }, 400);
  }
  try {
    const result = await operations[action](match[1]);
    return respond(result.body, result.status);
  } catch {
    return respond({ error: 'probe-failed', gate_decision: 'not_evaluated' }, 500);
  }
}
