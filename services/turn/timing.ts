import type { TurnEvent, TurnRecord } from './protocol.ts';

export type TurnTimingStage = 'queued' | 'preparing' | 'executing' | 'saving' | 'completed' | 'cancelled' | 'failed';
export type TurnTiming = {
  stage: TurnTimingStage;
  queuedMs: number | null;
  preparingMs: number | null;
  executingMs: number | null;
  savingMs: number | null;
};

const terminalStages = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const finiteTime = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

function elapsed(start: number | null, end: number | null): number | null {
  if (start === null || end === null || end < start) return null;
  return end - start;
}

/**
 * Derive user-facing turn timing from durable record fields and retained
 * events. Missing event boundaries stay unknown; this function never fills a
 * gap with an inferred timestamp.
 */
export function deriveTurnTiming(turn: TurnRecord, events: readonly TurnEvent[], now: number): TurnTiming {
  const rows = events.filter(event => event.turnId === turn.id).filter(event => finiteTime(event.at) !== null).sort((a, b) => a.at - b.at || a.sequence - b.sequence);
  const started = finiteTime(turn.startedAt);
  const created = finiteTime(turn.createdAt);
  const checkpointing = rows.find(event => event.type === 'turn.checkpointing');
  const requesting = rows.find(event => event.type === 'provider.status' && event.payload?.state === 'requesting');
  const terminal = rows.find(event => event.type.startsWith('turn.') && terminalStages.has(event.type.slice('turn.'.length)));
  const finished = finiteTime(turn.finishedAt) ?? finiteTime(terminal?.at);
  const observed = finiteTime(now);
  const end = finished ?? observed;
  const terminalStatus = turn.status === 'completed' || turn.status === 'cancelled' || turn.status === 'failed' || turn.status === 'interrupted'
    ? turn.status : terminal?.type.slice('turn.'.length);

  let stage: TurnTimingStage;
  if (terminalStatus === 'completed') stage = 'completed';
  else if (terminalStatus === 'cancelled') stage = 'cancelled';
  else if (terminalStatus === 'failed' || terminalStatus === 'interrupted') stage = 'failed';
  else if (turn.status === 'checkpointing' || checkpointing) stage = 'saving';
  else if (requesting) stage = 'executing';
  else if (started !== null || turn.status === 'running' || turn.status === 'cancelling') stage = 'preparing';
  else stage = 'queued';

  // The first boundary is durable (createdAt/startedAt), so queue time stays
  // available even after the corresponding event has been compacted.
  const queuedMs = started !== null ? elapsed(created, started) : stage === 'queued' ? elapsed(created, observed) : null;
  const preparingEnd = requesting ? requesting.at : (stage === 'preparing' ? end : null);
  const preparingMs = elapsed(started, preparingEnd);
  const executingEnd = checkpointing ? checkpointing.at : (stage === 'executing' ? end : null);
  const executingMs = elapsed(finiteTime(requesting?.at), executingEnd);
  // A saving duration requires the checkpointing event. A completed record
  // with that event retained can use its durable finishedAt; an in-flight save
  // uses now as the observation endpoint.
  const savingMs = elapsed(finiteTime(checkpointing?.at), checkpointing ? end : null);
  return { stage, queuedMs, preparingMs, executingMs, savingMs };
}
