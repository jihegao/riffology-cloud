import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  consumeEventStream,
  createClient,
  deleteSessionBounded,
  reconcileTurn,
  retrieveTurnWithUsage,
  startSessionTurn,
} from '../../experiments/issue-73-luna-agents/lib/agents-api.mjs';

test('unconfirmed resource deletion is a cleanup failure', async () => {
  const client = { beta: { agents: { sessions: { delete: async () => ({ id: 'sess_1', deleted: false }) } } } };
  await assert.rejects(deleteSessionBounded(client, 'sess_1'), /session-cleanup-failed.*deletion-not-confirmed/);
});

test('client pins the official endpoint and disables SDK retries', () => {
  const client = createClient('test-key', 1_000);
  assert.equal(client.baseURL, 'https://api.openai.com/v1');
  assert.equal(client.maxRetries, 0);
  assert.equal(client.timeout, 1_000);
  assert.equal(client.fetchOptions.dispatcher.constructor.name, 'EnvHttpProxyAgent');
});

test('event consumer records a completed turn and aborts its observer', async () => {
  let aborted = false;
  const stream = {
    controller: { abort: () => (aborted = true) },
    async *[Symbol.asyncIterator]() {
      yield { type: 'agent.session.created', event_id: 'e1', session: { id: 'sess_1' } };
      yield {
        type: 'agent.session.turn.completed',
        event_id: 'e2',
        session_id: 'sess_1',
        turn_id: 'turn_1',
        turn: { id: 'turn_1', status: 'completed' },
        usage: null,
      };
      throw new Error('must stop at terminal event');
    },
  };
  const directory = await mkdtemp(join(tmpdir(), 'issue73-events-'));
  const path = join(directory, 'events.jsonl');
  const observed = await consumeEventStream(stream, path);
  assert.equal(observed.sessionId, 'sess_1');
  assert.equal(observed.terminal.turn_id, 'turn_1');
  assert.equal(aborted, true);
  assert.equal((await readFile(path, 'utf8')).trim().split('\n').length, 2);
});

test('reconciliation returns a new terminal turn without resubmitting input', async () => {
  const client = {
    beta: {
      agents: {
        sessions: {
          turns: {
            list() {
              return {
                async *[Symbol.asyncIterator]() {
                  yield { id: 'old', status: 'completed' };
                  yield { id: 'new', status: 'completed' };
                },
              };
            },
          },
        },
      },
    },
  };
  const turn = await reconcileTurn(client, 'sess_1', new Set(['old']), Date.now() + 1000);
  assert.equal(turn.id, 'new');
});

test('usage retrieval polls only the same terminal Turn until usage appears', async () => {
  let retrieves = 0;
  let clock = 1_000;
  const client = {
    beta: {
      agents: {
        sessions: {
          turns: {
            async retrieve(turnId, { session_id: sessionId }) {
              retrieves += 1;
              assert.equal(turnId, 'turn_1');
              assert.equal(sessionId, 'sess_1');
              return {
                id: turnId,
                session_id: sessionId,
                status: 'completed',
                usage:
                  retrieves < 3
                    ? null
                    : {
                        input_tokens: 90,
                        input_tokens_details: { cached_tokens: 20 },
                        output_tokens: 10,
                        output_tokens_details: { reasoning_tokens: 2 },
                        total_tokens: 100,
                      },
              };
            },
          },
        },
      },
    },
  };
  const result = await retrieveTurnWithUsage(client, 'sess_1', 'turn_1', {
    deadlineMs: 1_100,
    intervalMs: 20,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
  });
  assert.equal(retrieves, 3);
  assert.equal(result.turn.usage.total_tokens, 100);
  assert.deepEqual(
    result.observations.map((entry) => entry.usageAvailable),
    [false, false, true],
  );
});

test('usage retrieval stops at its deadline without replaying a Turn', async () => {
  let retrieves = 0;
  let clock = 2_000;
  const client = {
    beta: {
      agents: {
        sessions: {
          turns: {
            async retrieve() {
              retrieves += 1;
              return { id: 'turn_1', status: 'completed', usage: null };
            },
          },
        },
      },
    },
  };
  const result = await retrieveTurnWithUsage(client, 'sess_1', 'turn_1', {
    deadlineMs: 2_025,
    intervalMs: 10,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
  });
  assert.equal(retrieves, 4);
  assert.equal(result.turn.usage, null);
  assert.ok(result.observations.every((entry) => entry.usageAvailable === false));
});

test('initial observer failure reconciles the already-created Session without replay', async () => {
  let creates = 0;
  const client = {
    beta: {
      agents: {
        sessions: {
          async create() {
            creates += 1;
            return {
              controller: { abort() {} },
              async *[Symbol.asyncIterator]() {
                yield { type: 'agent.session.created', session: { id: 'sess_recover' } };
                throw new Error('observer-disconnected');
              },
            };
          },
          turns: {
            list() {
              return {
                async *[Symbol.asyncIterator]() {
                  yield { id: 'turn_recovered', session_id: 'sess_recover', status: 'completed' };
                },
              };
            },
          },
        },
      },
    },
  };
  const directory = await mkdtemp(join(tmpdir(), 'issue73-reconcile-'));
  const observed = await startSessionTurn({
    client,
    request: { input: 'test' },
    rawEventPath: join(directory, 'events.jsonl'),
    timeoutMs: 1_000,
  });
  assert.equal(creates, 1);
  assert.equal(observed.sessionId, 'sess_recover');
  assert.equal(observed.terminal.turn_id, 'turn_recovered');
  assert.equal(observed.reconciled, true);
});
