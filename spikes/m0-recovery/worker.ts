import { hasProbeAuthorization, isRunId } from '../m0-cloud/auth.ts';

export const ACTIONS = ['accept', 'accept-process', 'accept-container', 'report', 'events', 'kill-process', 'kill-container', 'recover', 'late-event', 'cleanup'] as const;
export type Action = typeof ACTIONS[number];
export type ProbeResponse = { status: number; body: unknown };
export type RecoveryEvent = { sequence: number; generation: number; kind: 'phase' | 'cleanup'; phase: string; reason: string | null; at: string };
export interface RecoveryOperations {
  invoke(runId: string, action: Exclude<Action, 'events'>): Promise<ProbeResponse>;
  events(runId: string, cursor: number): Promise<{ events: RecoveryEvent[]; terminal: boolean }>;
}

export function recoverySandboxId(coordinator: string, generation: number): string {
  if (!/^[a-f0-9]{64}$/.test(coordinator) || !Number.isSafeInteger(generation) || generation < 1 || generation > 1000000) throw new Error('invalid-coordinator-id-or-generation');
  // Physical identity also changes: a late destroy of g1 can never reach g2.
  return `m0-recovery-${coordinator.slice(0, 32)}-g${generation}`;
}

/** The stream only observes durable events; cancelling it never owns or stops a job. */
export function observationStream(read: (cursor: number) => Promise<{ events: RecoveryEvent[]; terminal: boolean }>, cursor: number): Response {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) return;
      try {
        const page = await read(cursor);
        if (closed) return;
        for (const event of page.events) {
          if (event.sequence <= cursor) throw new Error('invalid-event-cursor');
          cursor = event.sequence;
          controller.enqueue(encoder.encode(`id: ${cursor}\nevent: turn\ndata: ${JSON.stringify(event)}\n\n`));
        }
        if (page.terminal) { closed = true; controller.close(); return; }
        if (page.events.length === 0) controller.enqueue(encoder.encode(': observing\n\n'));
        await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 500); });
      } catch { if (!closed) { closed = true; controller.error(new Error('observation-unavailable')); } }
      finally { wake = undefined; clearTimeout(timer); }
    },
    cancel() { closed = true; clearTimeout(timer); wake?.(); },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

export async function handleRecoveryRequest(request: Request, env: {
  M0_PROBE_TOKEN?: string; ENVIRONMENT?: string; PROTOCOL_VERSION?: string;
}, operations: RecoveryOperations): Promise<Response> {
  const respond = (body: unknown, status: number) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  if (!await hasProbeAuthorization(request, env.M0_PROBE_TOKEN)) return respond({ error: 'unauthorized' }, 401);
  if (env.ENVIRONMENT !== 'staging' || env.PROTOCOL_VERSION !== 'm0-v1') return respond({ error: 'probe-environment-disabled' }, 503);
  const url = new URL(request.url), match = /^\/probe\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (!match || !isRunId(match[1]) || url.search || !ACTIONS.includes(match[2] as Action)) return respond({ error: 'not-found' }, 404);
  const action = match[2] as Action;
  if (request.method !== (['report', 'events'].includes(action) ? 'GET' : 'POST')) return respond({ error: 'method-not-allowed' }, 405);
  if (request.body) {
    const reader = request.body.getReader();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const first = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('body-timeout')), 1000); })]);
      if (!first.done) return respond({ error: 'body-not-allowed' }, 400);
    } catch { return respond({ error: 'body-not-allowed' }, 400); }
    finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  try {
    if (action === 'events') {
      const raw = request.headers.get('last-event-id') ?? '0';
      if (!/^(0|[1-9][0-9]{0,5})$/.test(raw)) return respond({ error: 'invalid-cursor' }, 400);
      return observationStream(cursor => operations.events(match[1]!, cursor), Number(raw));
    }
    const result = await operations.invoke(match[1]!, action);
    return respond(result.body, result.status);
  } catch { return respond({ error: 'probe-operation-failed', gate_decision: 'not_evaluated' }, 500); }
}
