import { strict as assert } from 'node:assert';
import test from 'node:test';
import { deriveTurnTiming } from '../../services/turn/timing.ts';
import type { TurnEvent, TurnRecord } from '../../services/turn/protocol.ts';

const turn = (overrides: Partial<TurnRecord> = {}) => ({ id: 'turn-a', status: 'queued', createdAt: 100, updatedAt: 100, startedAt: null, finishedAt: null, ...overrides } as TurnRecord);
const event = (type: TurnEvent['type'], at: number, payload: Record<string, unknown> = {}, sequence = at): TurnEvent => ({ sequence, eventId: `event-${sequence}`, turnId: 'turn-a', workspaceId: 'workspace-a', runtimeGeneration: 1, type, at, payload });

test('reports an active queued turn from durable creation time', () => {
  assert.deepEqual(deriveTurnTiming(turn(), [event('turn.queued', 100)], 150), { stage: 'queued', queuedMs: 50, preparingMs: null, executingMs: null, savingMs: null });
});

test('uses requesting provider status as the execution boundary', () => {
  const value = deriveTurnTiming(turn({ status: 'running', startedAt: 110 }), [event('turn.started', 110), event('provider.status', 125, { state: 'requesting' })], 160);
  assert.deepEqual(value, { stage: 'executing', queuedMs: 10, preparingMs: 15, executingMs: 35, savingMs: null });
});

test('uses checkpointing and finishedAt for saved terminal timing', () => {
  const value = deriveTurnTiming(turn({ status: 'completed', startedAt: 110, finishedAt: 170 }), [event('turn.started', 110), event('provider.status', 125, { state: 'requesting' }), event('turn.checkpointing', 160), event('turn.completed', 170)], 999);
  assert.deepEqual(value, { stage: 'completed', queuedMs: 10, preparingMs: 15, executingMs: 35, savingMs: 10 });
});

test('does not invent execution or saving time across cropped events', () => {
  const value = deriveTurnTiming(turn({ status: 'completed', startedAt: 110, finishedAt: 170 }), [event('turn.completed', 170)], 999);
  assert.deepEqual(value, { stage: 'completed', queuedMs: 10, preparingMs: null, executingMs: null, savingMs: null });
});

test('keeps failed and cancelled stages explicit', () => {
  assert.equal(deriveTurnTiming(turn({ status: 'failed', startedAt: 110, finishedAt: 130 }), [event('turn.failed', 130)], 999).stage, 'failed');
  assert.equal(deriveTurnTiming(turn({ status: 'cancelled', finishedAt: 120 }), [event('turn.cancelled', 120)], 999).stage, 'cancelled');
});

test('reports an in-flight saving observation without a terminal event', () => {
  const value = deriveTurnTiming(turn({ status: 'checkpointing', startedAt: 110 }), [event('provider.status', 125, { state: 'requesting' }), event('turn.checkpointing', 160)], 175);
  assert.deepEqual(value, { stage: 'saving', queuedMs: 10, preparingMs: 15, executingMs: 35, savingMs: 15 });
});
