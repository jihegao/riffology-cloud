import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { inlineSkill } from './archive.mjs';
import {
  continueSessionTurn,
  createClient,
  deleteSessionBounded,
  downloadTurnArtifacts,
  listTurnItems,
  retrieveTurnWithUsage,
  startSessionTurn,
} from './agents-api.mjs';
import {
  assertBudgetRemaining,
  estimatedSandboxCost,
  normalizeObservedUsage,
  observedModelCost,
} from './budget.mjs';
import {
  ARTIFACT_PATHS,
  HOSTED_PACKAGES,
  MODEL,
  REASONING_EFFORT,
  SKILL_DESCRIPTION,
  SKILL_NAME,
} from './constants.mjs';
import { verifyContinuity, verifyTurnEvidence, summarizeItems } from './evidence.mjs';
import { buildSanitizedEvidence } from './report.mjs';
import { publicDefinition } from './definition.mjs';
import { writeJson } from './util.mjs';

const AGENT_INSTRUCTIONS = `You are the single modeling agent for a bounded synthetic simulation experiment.
Do not delegate or create subagents. Work only with the provided synthetic fixture and local files.
Use an available relevant skill when one is present. Execute code and preserve failures before repair.
Follow the artifact contract exactly. Never claim values that were not produced by executed code.`;

function emptyTotals() {
  return { sessions: 0, turns: 0, tokens: 0, modelCostUsd: 0, sandboxCostUsd: 0, unknownUsageTurns: 0 };
}

function usageEvidence(terminal, persistedTurn) {
  const candidates = [
    ['persisted-turn', persistedTurn?.usage],
    ['terminal-event', terminal?.usage],
    ['terminal-turn', terminal?.turn?.usage],
  ];
  const [source, candidate] = candidates.find(([, value]) => value != null) ?? [];
  if (!source) return {
    usage: null,
    usageKnown: false,
    usageError: null,
  };
  try {
    return { usage: normalizeObservedUsage(candidate), usageKnown: true, usageError: null };
  } catch (error) {
    return {
      usage: null,
      usageKnown: false,
      usageError: `${error.message}:${source}`,
    };
  }
}

function terminalStatus(terminal) {
  return terminal?.turn?.status ?? terminal?.type?.split('.').at(-1) ?? 'unknown';
}

function failureIncident(error) {
  return /hash-mismatch|command-not-observed|not-marked-executed|file-list-does-not-match/.test(
    error.message,
  )
    ? 1
    : 0;
}

function stopReason(signal) {
  return signal?.reason?.message ?? 'stop:operator-signal';
}

function assertNotStopped(signal) {
  if (signal?.aborted) throw new Error(stopReason(signal));
}

async function evaluateTurn({
  client,
  sessionId,
  terminal,
  runDirectory,
  turnNumber,
  wallTimeMs,
  reconciled,
  reconcileUsage = retrieveTurnWithUsage,
}) {
  const turnId = terminal.turn_id ?? terminal.turn.id;
  const { turn: persistedTurn, observations: usageObservations } = await reconcileUsage(
    client,
    sessionId,
    turnId,
  );
  await writeJson(join(runDirectory, `turn-${turnNumber}`, 'turn.json'), persistedTurn);
  await writeJson(
    join(runDirectory, `turn-${turnNumber}`, 'usage-observations.json'),
    usageObservations,
  );
  const status = persistedTurn.status ?? terminalStatus(terminal);
  const items = await listTurnItems(client, sessionId, turnId);
  await writeJson(join(runDirectory, `turn-${turnNumber}`, 'items.json'), items);
  const itemSummary = summarizeItems(items);
  const usage = usageEvidence(terminal, persistedTurn);
  const turn = {
    turn: turnNumber,
    turnId,
    status,
    accepted: false,
    rejectionReasons: [],
    usage: usage.usage,
    usageKnown: usage.usageKnown,
    usageError: usage.usageError,
    wallTimeMs,
    ...itemSummary,
    artifactCount: 0,
    artifactSha256: {},
    modelExecutionVerified: false,
    parameterExperimentCompleted: false,
    dimensions: {},
    fabricatedResultIncidents: 0,
    reconciledAfterObserverFailure: Boolean(reconciled),
    verifiedManifest: null,
  };
  if (status !== 'completed') {
    turn.rejectionReasons.push(`turn-${status}`);
    return turn;
  }
  try {
    const expectedPaths = [ARTIFACT_PATHS.manifest(turnNumber), ARTIFACT_PATHS.project(turnNumber)];
    const artifacts = await downloadTurnArtifacts({
      client,
      sessionId,
      turnId,
      expectedPaths,
      destination: join(runDirectory, `turn-${turnNumber}`, 'artifacts'),
    });
    turn.artifactCount = artifacts.size;
    const verified = verifyTurnEvidence({
      manifestBytes: artifacts.get(ARTIFACT_PATHS.manifest(turnNumber)).bytes,
      projectZipBytes: artifacts.get(ARTIFACT_PATHS.project(turnNumber)).bytes,
      expectedTurn: turnNumber,
      commandItems: items.filter((item) => item.type === 'command_execution'),
    });
    turn.accepted = true;
    turn.artifactSha256 = verified.artifactSha256;
    turn.modelExecutionVerified = true;
    turn.parameterExperimentCompleted = verified.manifest.experiment.runCount > 0;
    turn.dimensions = verified.dimensions;
    turn.verifiedManifest = verified.manifest;
  } catch (error) {
    turn.rejectionReasons.push(error.message);
    turn.fabricatedResultIncidents += failureIncident(error);
  }
  return turn;
}

async function runOne({ client, definition, planRun, manifest, rawRoot, totals, signal, reconcileUsage }) {
  assertNotStopped(signal);
  assertBudgetRemaining(manifest, totals, { startingSession: true, startingTurn: true });
  const runDirectory = join(rawRoot, 'runs', planRun.id);
  await mkdir(runDirectory, { recursive: true });
  const environment = {
    type: 'openai_hosted',
    network: { access: 'disabled' },
    packages: HOSTED_PACKAGES,
    setup_commands: [
      {
        command:
          "python -c \"import sys, mesa, numpy, pandas, matplotlib, networkx; print(sys.version); print(mesa.__version__)\"",
        cwd: '/workspace',
      },
    ],
  };
  if (planRun.skillEnabled) {
    environment.skills = [
      inlineSkill(definition.skillArchive, SKILL_NAME, SKILL_DESCRIPTION),
    ];
  }
  const request = {
    agent: {
      model: MODEL,
      instructions: AGENT_INSTRUCTIONS,
      multi_agent: { enabled: false },
      reasoning: { effort: REASONING_EFFORT },
      text: { verbosity: 'low' },
    },
    environment,
    metadata: {
      experiment: definition.experimentId,
      fixture: definition.fixtureVersion,
      condition: planRun.condition,
      run: planRun.id,
      run_set: basename(rawRoot),
      definition_sha256: definition.definitionSha256,
    },
    input: definition.prompts[0].text,
  };
  const timeoutMs = manifest.maxWallTimeSecondsPerTurn * 1_000;
  const started = Date.now();
  let sessionId = null;
  let run = null;
  let primaryError = null;
  try {
    totals.sessions += 1;
    totals.turns += 1;
    await writeJson(join(rawRoot, 'totals.json'), totals);
    const initial = await startSessionTurn({
      client,
      request,
      rawEventPath: join(runDirectory, 'turn-1', 'events.jsonl'),
      timeoutMs: Math.min(timeoutMs, Math.max(1, manifest.deadline - Date.now())),
    });
    sessionId = initial.sessionId;
    if (!sessionId) throw new Error('delivery-unknown:no-session-id');
    run = {
      runId: planRun.id,
      repetition: planRun.repetition,
      condition: planRun.condition,
      sessionId,
      expectedModel: MODEL,
      providerModel: null,
      environmentType: null,
      installedSkillNames: [],
      accepted: false,
      rejectionReasons: [],
      modelCostUsd: 0,
      estimatedSandboxCostUsd: 0,
      turns: [],
    };
    const session = await client.beta.agents.sessions.retrieve(sessionId);
    run.providerModel = session.agent.model;
    run.environmentType = session.environment.type;
    run.installedSkillNames = (session.environment.skills ?? []).map((skill) => skill.name);
    if (session.agent.model !== MODEL) {
      throw new Error(`provider-model-identifier-mismatch:${session.agent.model}`);
    }
    if (session.agent.multi_agent?.enabled !== false) throw new Error('multi-agent-was-not-disabled');
    if (session.environment.type !== 'openai_hosted') throw new Error('managed-environment-not-provisioned');
    if (session.environment.network?.access !== 'disabled') throw new Error('sandbox-network-was-not-disabled');
    if ((session.agent.tools ?? []).length !== 0) throw new Error('unexpected-agent-tools-enabled');
    if (planRun.skillEnabled && !run.installedSkillNames.includes(SKILL_NAME)) {
      throw new Error('simulation-skill-was-not-installed');
    }
    if (!planRun.skillEnabled && run.installedSkillNames.length !== 0) {
      throw new Error('baseline-environment-contained-skills');
    }
    await writeJson(join(runDirectory, 'session.json'), session);
    const knownTurnIds = new Set();
    let observed = initial;
    for (let turnNumber = 1; turnNumber <= 3; turnNumber += 1) {
      if (turnNumber > 1) {
        assertNotStopped(signal);
        assertBudgetRemaining(manifest, {
          ...totals,
          sandboxCostUsd: totals.sandboxCostUsd + estimatedSandboxCost(Date.now() - started, manifest.rateCard),
        }, { startingTurn: true });
        const before = await client.beta.agents.sessions.retrieve(sessionId);
        if (before.id !== sessionId || before.environment.id !== session.environment.id) {
          throw new Error('session-continuity-boundary-changed');
        }
        const turnStarted = Date.now();
        totals.turns += 1;
        await writeJson(join(rawRoot, 'totals.json'), totals);
        observed = await continueSessionTurn({
          client,
          sessionId,
          input: definition.prompts[turnNumber - 1].text,
          idempotencyKey: `${definition.definitionSha256}:${planRun.id}:turn-${turnNumber}`,
          knownTurnIds,
          rawEventPath: join(runDirectory, `turn-${turnNumber}`, 'events.jsonl'),
          timeoutMs: Math.min(timeoutMs, Math.max(1, manifest.deadline - Date.now())),
        });
        observed.wallTimeMs = Date.now() - turnStarted;
      } else observed.wallTimeMs = Date.now() - started;
      const terminal = observed.terminal;
      if (!terminal) throw new Error('delivery-unknown:terminal-turn-missing');
      const turn = await evaluateTurn({
        client,
        sessionId,
        terminal,
        runDirectory,
        turnNumber,
        wallTimeMs: observed.wallTimeMs,
        reconciled: observed.reconciled,
        reconcileUsage,
      });
      knownTurnIds.add(turn.turnId);
      run.turns.push(turn);
      if (!turn.usageKnown) {
        totals.unknownUsageTurns += 1;
        run.costState = 'incomplete-usage';
        if (turn.usageError || turn.status !== 'completed' || manifest.executionPolicy !== 'bounded-attempts-observed-thresholds') {
          throw new Error(turn.usageError ?? `usage-unavailable:turn-${turnNumber}`);
        }
      } else {
        totals.tokens += turn.usage.total_tokens;
        const cost = observedModelCost(turn.usage, manifest.rateCard);
        totals.modelCostUsd += cost;
        run.modelCostUsd += cost;
      }
      if (!['completed', 'failed', 'cancelled'].includes(turn.status)) throw new Error('delivery-unknown:persisted-turn-not-terminal');
      await writeJson(join(runDirectory, 'run.json'), run);
      await writeJson(join(rawRoot, 'totals.json'), totals);
      if (!['completed'].includes(turn.status)) break;
    }
    for (let index = 1; index < run.turns.length; index += 1) {
      const previous = run.turns[index - 1];
      const current = run.turns[index];
      if (!previous.verifiedManifest || !current.verifiedManifest) continue;
      try {
        current.continuity = verifyContinuity(previous.verifiedManifest, current.verifiedManifest);
      } catch (error) {
        current.accepted = false;
        current.rejectionReasons.push(error.message);
      }
    }
    run.simulationSkillRead = run.turns.some((turn) => turn.simulationSkillRead);
    if (planRun.skillEnabled && !run.simulationSkillRead) {
      run.rejectionReasons.push('simulation-skill-read-not-observed');
    }
    if (!planRun.skillEnabled && run.simulationSkillRead) {
      run.rejectionReasons.push('baseline-read-simulation-skill');
    }
    run.accepted = run.turns.length === 3 && run.turns.every((turn) => turn.accepted);
    if (run.rejectionReasons.length > 0) run.accepted = false;
    if (!run.accepted) run.rejectionReasons.push('one-or-more-turns-rejected');
  } catch (error) {
    primaryError = error;
    sessionId ??= error.observedSessionId ?? null;
    if (run) {
      run.accepted = false;
      run.costState = /delivery-unknown|usage-(?:unavailable|invalid)/.test(error.message)
        ? 'unknown-provider-outcome'
        : 'partial-observed';
      if (!run.rejectionReasons.includes(error.message)) run.rejectionReasons.push(error.message);
    }
  } finally {
    if (run) {
      run.totalSessionWallTimeMs = Date.now() - started;
      run.estimatedSandboxCostUsd = estimatedSandboxCost(
        run.totalSessionWallTimeMs,
        manifest.rateCard,
        manifest.cleanup !== 'delete-after-download',
      );
      totals.sandboxCostUsd += run.estimatedSandboxCostUsd;
    }
    if (sessionId && manifest.cleanup === 'delete-after-download') {
      try {
        await deleteSessionBounded(client, sessionId);
        if (run) run.sessionDeleted = true;
      } catch (error) {
        if (run) {
          run.sessionDeleted = false;
          run.cleanupError = error.message;
          run.accepted = false;
          if (!run.rejectionReasons.includes(error.message)) run.rejectionReasons.push(error.message);
        }
        if (!primaryError) primaryError = error;
      }
    } else if (run) run.sessionDeleted = false;
    if (run) await writeJson(join(runDirectory, 'run.json'), run);
    await writeJson(join(rawRoot, 'totals.json'), totals);
  }
  if (primaryError) {
    primaryError.partialRun = run;
    throw primaryError;
  }
  return run;
}

export async function runExperiment({
  apiKey,
  definition,
  manifest,
  rawRoot,
  client: suppliedClient,
  signal,
  reconcileUsage = retrieveTurnWithUsage,
}) {
  const client =
    suppliedClient ??
    createClient(apiKey, manifest.maxWallTimeSecondsPerTurn * 1_000 + 60_000);
  const totals = emptyTotals();
  const runs = [];
  await mkdir(rawRoot, { recursive: true });
  await writeJson(join(rawRoot, 'definition.json'), publicDefinition(definition));
  await writeJson(join(rawRoot, 'budget.json'), { ...manifest, approvedAt: manifest.approvedAt, deadline: manifest.deadline });
  let stopped = null;
  for (const planRun of definition.runs) {
    if (signal?.aborted) {
      stopped = { runId: null, reason: stopReason(signal) };
      await writeJson(join(rawRoot, 'stopped.json'), stopped);
      break;
    }
    try {
      const run = await runOne({ client, definition, planRun, manifest, rawRoot, totals, signal, reconcileUsage });
      runs.push(run);
      await writeJson(join(rawRoot, 'run-index.json'), runs);
      if (run.cleanupError) {
        stopped = { runId: planRun.id, reason: run.cleanupError };
        break;
      }
    } catch (error) {
      const failedRun = error.partialRun ?? {
        runId: planRun.id,
        repetition: planRun.repetition,
        condition: planRun.condition,
        sessionId: `unavailable:${planRun.id}`,
        expectedModel: MODEL,
        providerModel: null,
        environmentType: null,
        accepted: false,
        rejectionReasons: [error.message],
        modelCostUsd: 0,
        estimatedSandboxCostUsd: 0,
        costState: 'unknown-provider-outcome',
        turns: [],
      };
      runs.push(failedRun);
      stopped = { runId: planRun.id, reason: error.message };
      await writeJson(join(rawRoot, 'run-index.json'), runs);
      await writeJson(join(rawRoot, 'stopped.json'), stopped);
      break;
    }
  }
  const evidence = await buildSanitizedEvidence(rawRoot, publicDefinition(definition), runs);
  return { rawRoot, totals, runs, evidence, stopped };
}
