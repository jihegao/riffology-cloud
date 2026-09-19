import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { loadDefinition } from '../../experiments/issue-73-luna-agents/lib/definition.mjs';
import { runExperiment } from '../../experiments/issue-73-luna-agents/lib/runner.mjs';
import { sha256 } from '../../experiments/issue-73-luna-agents/lib/util.mjs';

function fixture(turn) {
  const files = {
    'model.py': Buffer.from(`threshold = ${turn === 1 ? '0.4' : turn === 2 ? '0.4\nmobility_noise = 0.1' : '0.45\nmobility_noise = 0.1'}\n`),
    'tests/test_model.py': Buffer.from('def test_model(): assert True\n'),
    'results/baseline.csv': Buffer.from('threshold,seed,happy\n0.2,101,0.7\n'),
    'plots/summary.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    'report.md': Buffer.from(`# Turn ${turn}\n`),
  };
  if (turn >= 2) files['results/noise.csv'] = Buffer.from('noise,seed,happy\n0.1,101,0.71\n');
  const kind = (path) => {
    if (path.endsWith('.py') && path.startsWith('tests/')) return 'test';
    if (path.endsWith('.py')) return 'source';
    if (path.startsWith('results/')) return 'result';
    if (path.startsWith('plots/')) return 'plot';
    return 'report';
  };
  const command = `python verify_turn_${turn}.py`;
  const manifest = {
    schemaVersion: 1,
    fixtureVersion: 'schelling-v1',
    turn,
    executed: true,
    runtime: { python: '3.12.10', mesa: '3.5.1' },
    verificationCommands: [{ command, exitCode: 0 }],
    workspaceFiles: Object.entries(files).map(([path, bytes]) => ({
      path,
      kind: kind(path),
      sha256: sha256(bytes),
    })),
    experiment: {
      parametersVaried: turn === 2 ? ['mobility_noise'] : ['similarity_threshold'],
      parameterValues:
        turn === 2
          ? { mobility_noise: [0, 0.1, 0.3] }
          : turn === 3
            ? { similarity_threshold: [0.45] }
          : { similarity_threshold: [0.2, 0.35, 0.5, 0.65] },
      seeds: turn === 3 ? [] : [101, 202, 303],
      steps: turn === 3 ? 0 : 50,
      primaryMetrics: ['happy_fraction'],
      runCount: turn === 3 ? 1 : 12,
    },
    changes: {
      inspectedFiles: ['model.py'],
      modifiedFiles:
        turn === 1
          ? Object.keys(files)
          : turn === 2
            ? ['model.py', 'results/noise.csv', 'report.md']
            : ['model.py', 'report.md'],
    },
    assumptions: ['one agent per occupied cell'],
    limitations: ['synthetic model'],
  };
  return {
    command,
    manifest: Buffer.from(JSON.stringify(manifest)),
    project: Buffer.from(
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([path, bytes]) => [`project/${path}`, strToU8(bytes.toString())]),
        ),
      ),
    ),
  };
}

function asyncPage(values) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* values;
    },
  };
}

function stream(events) {
  return {
    controller: { abort() {} },
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
  };
}

function budgetManifest(now, cleanup = 'delete-after-download') {
  return {
    schemaVersion: 1,
    experimentId: 'issue-73-luna-agents',
    model: 'gpt-5.6-luna',
    repetitionsPerCondition: 2,
    maxSessions: 4,
    maxTurns: 12,
    maxWallTimeSecondsPerTurn: 60,
    maxTokensPerTurn: 1000,
    maxTotalTokens: 10000,
    maxModelCostUsd: 1,
    maxSandboxCostUsd: 1,
    authorizationReference: 'test-only',
    approvedAt: now - 1000,
    deadline: now + 60_000,
    privacyScope: 'synthetic-schelling-fixture-only',
    rateCard: {
      source: 'https://developers.openai.com/api/docs/pricing',
      checkedAt: new Date(now).toISOString(),
      inputUsdPerMillion: 0.2,
      cachedInputUsdPerMillion: 0.02,
      outputUsdPerMillion: 1.2,
      sandbox1GbUsdPer20Minutes: 0.03,
      minimumSandboxMinutes: 5,
    },
    cleanup,
  };
}

class FakeAgentsClient {
  constructor() {
    this.requests = [];
    this.sessions = new Map();
    this.artifactBytes = new Map();
    this.beta = {
      agents: {
        sessions: {
          create: async (request) => this.create(request),
          retrieve: async (sessionId) => this.sessions.get(sessionId).session,
          delete: async (sessionId) => ({ id: sessionId, deleted: true }),
          turns: {
            list: (sessionId) => asyncPage(this.sessions.get(sessionId).turns),
            retrieve: async (turnId, { session_id: sessionId }) =>
              this.sessions.get(sessionId).turns.find((turn) => turn.id === turnId),
          },
          items: { list: (sessionId) => asyncPage(this.sessions.get(sessionId).items) },
          artifacts: {
            list: (sessionId) => asyncPage(this.sessions.get(sessionId).artifacts),
            content: async (artifactId) => new Response(this.artifactBytes.get(artifactId)),
          },
          events: {
            stream: async (sessionId) => this.followupStream(sessionId),
            create: async () => undefined,
          },
        },
      },
    };
  }

  terminal(sessionId, turn) {
    return {
      type: 'agent.session.turn.completed',
      event_id: `event-${sessionId}-${turn}`,
      session_id: sessionId,
      turn_id: `turn-${sessionId}-${turn}`,
      turn: {
        id: `turn-${sessionId}-${turn}`,
        session_id: sessionId,
        status: 'completed',
      },
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 20 },
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 10 },
        total_tokens: 150,
      },
    };
  }

  async create(request) {
    const number = this.requests.length + 1;
    const sessionId = `sess_${number}`;
    this.requests.push(request);
    const state = {
      currentTurn: 1,
      session: {
        id: sessionId,
        agent: { model: 'gpt-5.6-luna', multi_agent: { enabled: false }, tools: [] },
        environment: {
          id: `env_${number}`,
          type: 'openai_hosted',
          network: { access: 'disabled', allowed_domains: [] },
          skills: request.environment.skills?.map((skill) => ({
            type: 'inline',
            name: skill.name,
            description: skill.description,
          })) ?? [],
        },
      },
      turns: [],
      items: [],
      artifacts: [],
    };
    for (let turn = 1; turn <= 3; turn += 1) {
      const turnId = `turn-${sessionId}-${turn}`;
      const terminal = this.terminal(sessionId, turn);
      state.turns.push({ ...terminal.turn, usage: terminal.usage });
      const data = fixture(turn);
      state.items.push(
        {
          id: `cmd-${sessionId}-${turn}`,
          type: 'command_execution',
          command: data.command,
          cwd: '/workspace/project',
          duration_ms: 10,
          exit_code: 0,
          output: 'ok',
          status: 'completed',
          turn_id: turnId,
        },
        {
          id: `msg-${sessionId}-${turn}`,
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          status: 'completed',
          content: [],
          turn_id: turnId,
        },
      );
      if (turn === 1 && request.environment.skills?.length === 1) {
        state.items.push({
          id: `skill-${sessionId}-${turn}`,
          type: 'command_execution',
          command: "cat /root/.agents/skills/riffology-simulation/SKILL.md",
          cwd: '/workspace',
          duration_ms: 5,
          exit_code: null,
          output: '# Riffology Simulation\n\n## Modeling workflow\n',
          status: 'completed',
          turn_id: turnId,
        });
      }
      for (const [suffix, path, bytes] of [
        ['manifest', `/workspace/outputs/turn-${turn}-manifest.json`, data.manifest],
        ['project', `/workspace/outputs/turn-${turn}-project.zip`, data.project],
      ]) {
        const id = `artifact-${sessionId}-${turn}-${suffix}`;
        state.artifacts.push({ id, path, turn_id: turnId, session_id: sessionId });
        this.artifactBytes.set(id, bytes);
      }
    }
    this.sessions.set(sessionId, state);
    return stream([
      { type: 'agent.session.created', event_id: `created-${sessionId}`, session: state.session },
      { ...this.terminal(sessionId, 1), usage: null },
    ]);
  }

  followupStream(sessionId) {
    const state = this.sessions.get(sessionId);
    state.currentTurn += 1;
    return stream([{ ...this.terminal(sessionId, state.currentTurn), usage: null }]);
  }
}

test('full runner keeps A/B isolated, reuses each Session, and emits sanitized evidence', async () => {
  const now = Date.now();
  const definition = await loadDefinition(2);
  const manifest = {
    schemaVersion: 1,
    experimentId: 'issue-73-luna-agents',
    model: 'gpt-5.6-luna',
    repetitionsPerCondition: 2,
    maxSessions: 4,
    maxTurns: 12,
    maxWallTimeSecondsPerTurn: 60,
    maxTokensPerTurn: 1000,
    maxTotalTokens: 10000,
    maxModelCostUsd: 1,
    maxSandboxCostUsd: 1,
    authorizationReference: 'test-only',
    approvedAt: now - 1000,
    deadline: now + 60_000,
    privacyScope: 'synthetic-schelling-fixture-only',
    rateCard: {
      source: 'https://developers.openai.com/api/docs/pricing',
      checkedAt: new Date(now).toISOString(),
      inputUsdPerMillion: 0.2,
      cachedInputUsdPerMillion: 0.02,
      outputUsdPerMillion: 1.2,
      sandbox1GbUsdPer20Minutes: 0.03,
      minimumSandboxMinutes: 5,
    },
    cleanup: 'retain-until-evidence-promoted',
  };
  const client = new FakeAgentsClient();
  const rawRoot = await mkdtemp(join(tmpdir(), 'issue73-runner-'));
  const result = await runExperiment({ definition, manifest, rawRoot, client });
  assert.equal(result.totals.sessions, 4);
  assert.equal(result.totals.turns, 12);
  assert.equal(result.totals.tokens, 1800);
  assert.ok(result.runs.every((run) => run.accepted));
  assert.ok(
    result.runs
      .filter((run) => run.condition === 'simulation-skill')
      .every((run) => run.simulationSkillRead),
  );
  assert.ok(result.runs.every((run) => run.turns.length === 3));
  assert.equal(client.requests.filter((request) => request.environment.skills?.length === 1).length, 2);
  assert.equal(client.requests.filter((request) => request.environment.skills === undefined).length, 2);
  assert.equal(new Set(client.requests.map((request) => request.input)).size, 1);
  assert.ok(client.requests.every((request) => request.agent.reasoning.effort === 'low'));
  assert.ok(client.requests.every((request) => request.metadata.run_set));
  assert.ok(client.requests.every((request) => request.metadata.definition_sha256 === definition.definitionSha256));
  assert.equal(result.evidence.summary.conditions.baseline.acceptedTasks, 2);
  assert.equal(result.evidence.summary.conditions['simulation-skill'].acceptedTasks, 2);
  const auditPath = join(rawRoot, 'artifact-audit.json');
  await promisify(execFile)(process.execPath, ['experiments/issue-73-luna-agents/audit-artifacts.mjs', rawRoot, auditPath]);
  const audit = JSON.parse(await readFile(auditPath, 'utf8'));
  assert.equal(audit.runs.length, 4);
  assert.ok(audit.runs.flatMap(run => run.turns).every(turn => turn.allHashesMatch));
  assert.deepEqual(audit.runs[0].turns[2].changedCodeFiles, ['model.py']);
  assert.equal(audit.runs[0].turns[0].csvTables[0].nonemptyDataLines, 1);
});

test('authorized completed missing usage continues without replay and keeps cost conclusions incomplete', async () => {
  const definition = await loadDefinition(2);
  const client = new FakeAgentsClient();
  const manifest = { ...budgetManifest(Date.now()), executionPolicy: 'bounded-attempts-observed-thresholds' };
  const rawRoot = await mkdtemp(join(tmpdir(), 'issue73-limited-'));
  const result = await runExperiment({
    definition, client, manifest, rawRoot,
    reconcileUsage: async (c, sessionId, turnId) => ({
      turn: { ...await c.beta.agents.sessions.turns.retrieve(turnId, { session_id: sessionId }), usage: null },
      observations: [{ status: 'completed', usageAvailable: false }],
    }),
  });
  assert.equal(result.stopped, null);
  assert.equal(result.totals.sessions, 4);
  assert.equal(result.totals.turns, 12);
  assert.equal(client.requests.length, 4);
  assert.equal(result.totals.unknownUsageTurns, 12);
  assert.ok(result.runs.every((run) => run.accepted && run.sessionDeleted));
  assert.ok(result.runs.flatMap((run) => run.turns).every((turn) => turn.usage === null));
  for (const condition of Object.values(result.evidence.summary.conditions)) {
    assert.equal(condition.unknownUsageTurns, 6);
    assert.equal(condition.costDataComplete, false);
    assert.equal(condition.costPerAcceptedTaskUsd, null);
  }
});

test('malformed non-null usage stops before another Turn and remains unknown-cost evidence', async () => {
  const now = Date.now();
  const definition = await loadDefinition(2);
  const client = new FakeAgentsClient();
  const deleted = [];
  const retrieve = client.beta.agents.sessions.turns.retrieve;
  client.beta.agents.sessions.turns.retrieve = async (turnId, options) => {
    const turn = await retrieve(turnId, options);
    return {
      ...turn,
      usage: { ...turn.usage, total_tokens: turn.usage.total_tokens - 1 },
    };
  };
  client.beta.agents.sessions.delete = async (sessionId) => {
    deleted.push(sessionId);
    return { id: sessionId, deleted: true };
  };
  const rawRoot = await mkdtemp(join(tmpdir(), 'issue73-invalid-usage-'));
  const result = await runExperiment({
    definition,
    manifest: budgetManifest(now),
    rawRoot,
    client,
  });
  assert.equal(client.requests.length, 1);
  assert.equal(result.totals.turns, 1);
  assert.equal(result.totals.tokens, 0);
  assert.match(result.stopped.reason, /^usage-invalid:total-mismatch:persisted-turn$/);
  assert.equal(result.runs[0].turns[0].usageKnown, false);
  assert.equal(result.runs[0].costState, 'unknown-provider-outcome');
  assert.deepEqual(deleted, ['sess_1']);
});

test('provider delivery uncertainty stops the matrix without substituting a model or replaying', async () => {
  const now = Date.now();
  const definition = await loadDefinition(2);
  let creates = 0;
  const client = {
    beta: {
      agents: {
        sessions: {
          async create() {
            creates += 1;
            throw new Error('model-not-available');
          },
        },
      },
    },
  };
  const manifest = {
    schemaVersion: 1,
    experimentId: 'issue-73-luna-agents',
    model: 'gpt-5.6-luna',
    repetitionsPerCondition: 2,
    maxSessions: 4,
    maxTurns: 12,
    maxWallTimeSecondsPerTurn: 60,
    maxTokensPerTurn: 1000,
    maxTotalTokens: 10000,
    maxModelCostUsd: 1,
    maxSandboxCostUsd: 1,
    authorizationReference: 'test-only',
    approvedAt: now - 1000,
    deadline: now + 60_000,
    privacyScope: 'synthetic-schelling-fixture-only',
    rateCard: {
      source: 'https://developers.openai.com/api/docs/pricing',
      checkedAt: new Date(now).toISOString(),
      inputUsdPerMillion: 0.2,
      cachedInputUsdPerMillion: 0.02,
      outputUsdPerMillion: 1.2,
      sandbox1GbUsdPer20Minutes: 0.03,
      minimumSandboxMinutes: 5,
    },
    cleanup: 'delete-after-download',
  };
  const rawRoot = await mkdtemp(join(tmpdir(), 'issue73-provider-failure-'));
  const result = await runExperiment({ definition, manifest, rawRoot, client });
  assert.equal(creates, 1);
  assert.equal(result.totals.sessions, 1);
  assert.equal(result.totals.turns, 1);
  assert.equal(result.runs.length, 1);
  assert.match(result.stopped.reason, /^delivery-unknown:session-create:/);
  assert.equal(result.runs[0].expectedModel, 'gpt-5.6-luna');
  assert.equal(result.runs[0].providerModel, null);
  assert.equal(result.evidence.summary.decision, 'blocked');
});

test('a known hosted Session is deleted when post-create validation fails', async () => {
  const now = Date.now();
  const definition = await loadDefinition(2);
  const client = new FakeAgentsClient();
  const deleted = [];
  const retrieve = client.beta.agents.sessions.retrieve;
  client.beta.agents.sessions.retrieve = async (sessionId) => {
    const session = await retrieve(sessionId);
    return { ...session, agent: { ...session.agent, model: 'gpt-5.6-terra' } };
  };
  client.beta.agents.sessions.delete = async (sessionId) => {
    deleted.push(sessionId);
    return { id: sessionId, deleted: true };
  };
  const manifest = {
    schemaVersion: 1,
    experimentId: 'issue-73-luna-agents',
    model: 'gpt-5.6-luna',
    repetitionsPerCondition: 2,
    maxSessions: 4,
    maxTurns: 12,
    maxWallTimeSecondsPerTurn: 60,
    maxTokensPerTurn: 1000,
    maxTotalTokens: 10000,
    maxModelCostUsd: 1,
    maxSandboxCostUsd: 1,
    authorizationReference: 'test-only',
    approvedAt: now - 1000,
    deadline: now + 60_000,
    privacyScope: 'synthetic-schelling-fixture-only',
    rateCard: {
      source: 'https://developers.openai.com/api/docs/pricing',
      checkedAt: new Date(now).toISOString(),
      inputUsdPerMillion: 0.2,
      cachedInputUsdPerMillion: 0.02,
      outputUsdPerMillion: 1.2,
      sandbox1GbUsdPer20Minutes: 0.03,
      minimumSandboxMinutes: 5,
    },
    cleanup: 'delete-after-download',
  };
  const rawRoot = await mkdtemp(join(tmpdir(), 'issue73-cleanup-after-failure-'));
  const result = await runExperiment({ definition, manifest, rawRoot, client });
  assert.deepEqual(deleted, ['sess_1']);
  assert.equal(result.runs[0].sessionDeleted, true);
  assert.equal(result.runs[0].providerModel, 'gpt-5.6-terra');
  assert.match(result.stopped.reason, /^provider-model-identifier-mismatch:/);
});

test('operator stop finishes the observed Turn, sends no follow-up, and deletes the Session', async () => {
  const now = Date.now();
  const definition = await loadDefinition(2);
  const client = new FakeAgentsClient();
  const stopController = new AbortController();
  const deleted = [];
  const create = client.create.bind(client);
  client.create = async (request) => {
    const result = await create(request);
    stopController.abort(new Error('stop:operator-signal:SIGINT'));
    return result;
  };
  client.beta.agents.sessions.delete = async (sessionId) => {
    deleted.push(sessionId);
    return { id: sessionId, deleted: true };
  };
  const manifest = {
    schemaVersion: 1,
    experimentId: 'issue-73-luna-agents',
    model: 'gpt-5.6-luna',
    repetitionsPerCondition: 2,
    maxSessions: 4,
    maxTurns: 12,
    maxWallTimeSecondsPerTurn: 60,
    maxTokensPerTurn: 1000,
    maxTotalTokens: 10000,
    maxModelCostUsd: 1,
    maxSandboxCostUsd: 1,
    authorizationReference: 'test-only',
    approvedAt: now - 1000,
    deadline: now + 60_000,
    privacyScope: 'synthetic-schelling-fixture-only',
    rateCard: {
      source: 'https://developers.openai.com/api/docs/pricing',
      checkedAt: new Date(now).toISOString(),
      inputUsdPerMillion: 0.2,
      cachedInputUsdPerMillion: 0.02,
      outputUsdPerMillion: 1.2,
      sandbox1GbUsdPer20Minutes: 0.03,
      minimumSandboxMinutes: 5,
    },
    cleanup: 'delete-after-download',
  };
  const rawRoot = await mkdtemp(join(tmpdir(), 'issue73-graceful-stop-'));
  const result = await runExperiment({
    definition,
    manifest,
    rawRoot,
    client,
    signal: stopController.signal,
  });
  assert.equal(client.requests.length, 1);
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].turns.length, 1);
  assert.deepEqual(deleted, ['sess_1']);
  assert.equal(result.runs[0].sessionDeleted, true);
  assert.equal(result.stopped.reason, 'stop:operator-signal:SIGINT');
});
