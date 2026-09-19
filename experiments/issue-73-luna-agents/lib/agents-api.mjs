import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import OpenAI from 'openai';
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';
import { appendJsonLine } from './util.mjs';

const TERMINAL_EVENT_TYPES = new Set([
  'agent.session.turn.completed',
  'agent.session.turn.failed',
  'agent.session.turn.cancelled',
]);

export function createClient(apiKey, timeoutMs) {
  const dispatcher = new EnvHttpProxyAgent();
  return new OpenAI({
    apiKey,
    baseURL: 'https://api.openai.com/v1',
    fetch: undiciFetch,
    fetchOptions: { dispatcher },
    maxRetries: 0,
    timeout: timeoutMs,
  });
}

export async function consumeEventStream(stream, rawEventPath) {
  let sessionId = null;
  let terminal = null;
  const eventTypes = [];
  try {
    for await (const event of stream) {
      await appendJsonLine(rawEventPath, event);
      eventTypes.push(event.type);
      if (event.type === 'agent.session.created') sessionId = event.session.id;
      else if (event.session_id) sessionId = event.session_id;
      if (TERMINAL_EVENT_TYPES.has(event.type)) {
        terminal = event;
        break;
      }
      if (event.type === 'agent.session.failed' || event.type === 'agent.session.error') {
        throw new Error(`session-terminal-error:${event.type}`);
      }
      if (event.type === 'agent.session.requires_action') {
        throw new Error('unexpected-required-action');
      }
    }
  } catch (error) {
    error.observedSessionId = sessionId;
    error.observedEventTypes = eventTypes;
    throw error;
  } finally {
    stream?.controller?.abort?.();
  }
  return { sessionId, terminal, eventTypes };
}

export async function reconcileTurn(client, sessionId, knownTurnIds, deadlineMs) {
  let lastSeen = null;
  while (Date.now() < deadlineMs) {
    const turns = [];
    for await (const turn of client.beta.agents.sessions.turns.list(sessionId, { order: 'asc' })) {
      turns.push(turn);
    }
    const candidate = turns.find((turn) => !knownTurnIds.has(turn.id));
    if (candidate) {
      lastSeen = candidate;
      if (['completed', 'failed', 'cancelled'].includes(candidate.status)) return candidate;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (lastSeen) throw new Error(`delivery-unknown:turn-${lastSeen.status}:${lastSeen.id}`);
  throw new Error('delivery-unknown:no-new-turn-observed');
}

export async function retrieveTurnWithUsage(
  client,
  sessionId,
  turnId,
  {
    deadlineMs = Date.now() + 60_000,
    intervalMs = 2_000,
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {},
) {
  const observations = [];
  let turn;
  do {
    turn = await client.beta.agents.sessions.turns.retrieve(turnId, {
      session_id: sessionId,
    });
    observations.push({
      observedAt: new Date(now()).toISOString(),
      status: turn.status,
      usageAvailable: turn.usage != null,
    });
    if (turn.usage != null || !['completed', 'failed', 'cancelled'].includes(turn.status)) break;
    const remaining = deadlineMs - now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  } while (now() <= deadlineMs);
  return { turn, observations };
}

export async function startSessionTurn({ client, request, rawEventPath, timeoutMs }) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error('turn-observer-timeout')), timeoutMs);
  let observed = null;
  try {
    const stream = await client.beta.agents.sessions.create(
      { ...request, stream: true },
      { signal: abort.signal },
    );
    observed = await consumeEventStream(stream, rawEventPath);
    if (!observed.terminal) throw new Error('initial-stream-ended-without-terminal-turn');
    return observed;
  } catch (error) {
    const recoveredSessionId = observed?.sessionId ?? error.observedSessionId;
    if (!recoveredSessionId) throw new Error(`delivery-unknown:session-create:${error.message}`);
    let turn;
    try {
      turn = await reconcileTurn(client, recoveredSessionId, new Set(), Date.now() + Math.min(timeoutMs, 60_000));
    } catch (reconciliationError) {
      reconciliationError.observedSessionId = recoveredSessionId;
      throw reconciliationError;
    }
    return {
      sessionId: recoveredSessionId,
      eventTypes: observed?.eventTypes ?? error.observedEventTypes ?? [],
      terminal: canonicalTerminal(turn),
      reconciled: true,
      observerError: error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function continueSessionTurn({
  client,
  sessionId,
  input,
  idempotencyKey,
  knownTurnIds,
  rawEventPath,
  timeoutMs,
}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error('turn-observer-timeout')), timeoutMs);
  let stream;
  try {
    stream = await client.beta.agents.sessions.events.stream(sessionId, { signal: abort.signal });
    await client.beta.agents.sessions.events.create(
      sessionId,
      {
        events: [
          {
            type: 'agent.session.input.message',
            input: [
              {
                role: 'user',
                content: [{ type: 'input_text', text: input }],
              },
            ],
          },
        ],
        'Idempotency-Key': idempotencyKey,
      },
      { signal: abort.signal },
    );
    const observed = await consumeEventStream(stream, rawEventPath);
    if (!observed.terminal) throw new Error('followup-stream-ended-without-terminal-turn');
    return observed;
  } catch (error) {
    stream?.controller?.abort?.();
    const turn = await reconcileTurn(
      client,
      sessionId,
      knownTurnIds,
      Date.now() + Math.min(timeoutMs, 60_000),
    );
    return { sessionId, terminal: canonicalTerminal(turn), reconciled: true, observerError: error.message };
  } finally {
    clearTimeout(timer);
  }
}

function canonicalTerminal(turn) {
  return {
    type: `agent.session.turn.${turn.status}`,
    session_id: turn.session_id,
    turn_id: turn.id,
    turn,
    usage: turn.usage,
  };
}

export async function listTurnItems(client, sessionId, turnId) {
  const items = [];
  for await (const item of client.beta.agents.sessions.items.list(sessionId, { order: 'asc' })) {
    if (item.turn_id === turnId) items.push(item);
  }
  return items;
}

async function listArtifactsForTurn(client, sessionId, turnId) {
  const artifacts = [];
  for await (const artifact of client.beta.agents.sessions.artifacts.list(sessionId, { order: 'asc' })) {
    if (artifact.turn_id === turnId) artifacts.push(artifact);
  }
  return artifacts;
}

export async function downloadTurnArtifacts({
  client,
  sessionId,
  turnId,
  expectedPaths,
  destination,
}) {
  let artifacts = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    artifacts = await listArtifactsForTurn(client, sessionId, turnId);
    if (expectedPaths.every((path) => artifacts.some((artifact) => artifact.path === path))) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  await mkdir(destination, { recursive: true });
  const downloaded = new Map();
  for (const path of expectedPaths) {
    const artifact = artifacts.find((candidate) => candidate.path === path);
    if (!artifact) throw new Error(`required-artifact-missing:${path}`);
    const response = await client.beta.agents.sessions.artifacts.content(artifact.id, {
      session_id: sessionId,
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const localPath = join(destination, basename(path));
    await writeFile(localPath, bytes, { mode: 0o600 });
    downloaded.set(path, { artifact, bytes, localPath });
  }
  return downloaded;
}

export async function deleteSessionBounded(client, sessionId, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await client.beta.agents.sessions.delete(sessionId);
      if (result.deleted !== true || result.id !== sessionId) throw new Error('deletion-not-confirmed');
      return result;
    } catch (error) {
      lastError = error;
      if (error?.status !== 409 || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw new Error(`session-cleanup-failed:${lastError?.status ?? 'unknown'}:${lastError?.message}`);
}
