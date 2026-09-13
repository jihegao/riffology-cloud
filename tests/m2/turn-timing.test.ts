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
test('tool completion cannot project a running turn as completed',()=>{
 const turn={id:'t',status:'running',createdAt:1,startedAt:2,finishedAt:null} as any;
 const timing=deriveTurnTiming(turn,[{turnId:'t',type:'provider.status',at:3,sequence:1,payload:{state:'requesting'}},{turnId:'t',type:'tool.completed',at:4,sequence:2,payload:{}}] as any,5);
 assert.equal(timing.stage,'executing');assert.equal(timing.executingMs,2);
});

for (const status of ['failed', 'cancelled', 'interrupted'] as const) {
  test(`${status} closes the final retained execution phase at finishedAt`, () => {
    const value = deriveTurnTiming(turn({ status, startedAt: 200, finishedAt: 600 }), [event('turn.started', 200), event('provider.status', 300, { state: 'requesting' }), event(`turn.${status}`, 600)], 999);
    assert.deepEqual(value, { stage: status === 'cancelled' ? 'cancelled' : 'failed', queuedMs: 100, preparingMs: 100, executingMs: 300, savingMs: null });
  });
  test(`${status} closes preparation only with its retained start boundary`, () => {
    const value = deriveTurnTiming(turn({ status, startedAt: 200, finishedAt: 600 }), [event('turn.started', 200), event(`turn.${status}`, 600)], 999);
    assert.deepEqual(value, { stage: status === 'cancelled' ? 'cancelled' : 'failed', queuedMs: 100, preparingMs: 400, executingMs: null, savingMs: null });
    const cropped = deriveTurnTiming(turn({ status, startedAt: 200, finishedAt: 600 }), [event(`turn.${status}`, 600)], 999);
    assert.equal(cropped.preparingMs, null);
    assert.equal(cropped.executingMs, null);
  });
}
test('terminal timing never uses now when both terminal endpoints are missing', () => {
  const value = deriveTurnTiming(turn({status:'failed',startedAt:200}), [event('turn.started',200),event('provider.status',300,{state:'requesting'})],999);
  assert.equal(value.preparingMs,100);assert.equal(value.executingMs,null);
});
