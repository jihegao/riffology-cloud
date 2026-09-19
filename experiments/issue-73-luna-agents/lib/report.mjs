import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pseudonym, sha256, writeJson } from './util.mjs';

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function failureCategory(reason) {
  if (/delivery-unknown|usage-(?:unavailable|invalid)/.test(reason)) return 'provider-outcome-unknown';
  if (/^stop:|budget|token-headroom/.test(reason)) return 'budget-gate';
  if (/provider-model|model-not-available/.test(reason)) return 'model-access-or-identity';
  if (/cleanup|session-cleanup/.test(reason)) return 'resource-cleanup';
  if (/artifact|manifest|workspace|command-not-observed|continuity/.test(reason)) {
    return 'evidence-contract';
  }
  return 'runtime-or-harness';
}

function summarizeCondition(runs) {
  const accepted = runs.filter((run) => run.accepted);
  const turns = runs.flatMap((run) => run.turns);
  const costDataComplete = runs.every((run) => run.costState === 'observed') && turns.every((turn) => turn.usageKnown);
  const dimensionNames = [
    'assumptionsExplicit',
    'entitiesStateInteractionsExplicit',
    'feedbackExplicit',
    'emergentQuantityDefined',
    'implementationVerifiedBeforeInterpretation',
    'sensitivityAnalysis',
    'machineReadableArtifacts',
  ];
  return {
    runs: runs.length,
    acceptedTasks: accepted.length,
    acceptedTaskRate: runs.length ? accepted.length / runs.length : 0,
    firstRunSuccessRate: runs.length
      ? runs.filter((run) => run.turns[0]?.accepted).length / runs.length
      : 0,
    autonomousDebugSuccessRate: runs.length
      ? runs.filter((run) => run.turns.some((turn) => turn.repairIterations > 0) && run.accepted).length /
        runs.length
      : 0,
    modelExecutionVerifiedRate: turns.length
      ? turns.filter((turn) => turn.modelExecutionVerified).length / turns.length
      : 0,
    parameterExperimentRate: runs.length
      ? runs.filter((run) => run.turns[0]?.parameterExperimentCompleted).length / runs.length
      : 0,
    skillReadRate: runs.length
      ? runs.filter((run) => run.simulationSkillRead === true).length / runs.length
      : 0,
    fabricatedResultIncidents: runs.reduce(
      (sum, run) => sum + run.turns.reduce((turnSum, turn) => turnSum + turn.fabricatedResultIncidents, 0),
      0,
    ),
    meanToolCalls: mean(turns.map((turn) => turn.toolCalls)),
    meanRepairIterations: mean(turns.map((turn) => turn.repairIterations)),
    totalTokens: turns.reduce(
      (sum, turn) => sum + (turn.usageKnown && turn.usage ? turn.usage.total_tokens : 0),
      0,
    ),
    unknownUsageTurns: turns.filter((turn) => !turn.usageKnown).length,
    costDataComplete,
    totalWallTimeMs: turns.reduce((sum, turn) => sum + turn.wallTimeMs, 0),
    modelCostUsd: runs.reduce((sum, run) => sum + run.modelCostUsd, 0),
    estimatedSandboxCostUsd: runs.reduce((sum, run) => sum + run.estimatedSandboxCostUsd, 0),
    estimatedTotalCostUsd: runs.reduce(
      (sum, run) => sum + run.modelCostUsd + run.estimatedSandboxCostUsd,
      0,
    ),
    costPerAcceptedTaskUsd: accepted.length && costDataComplete
      ? runs.reduce(
          (sum, run) => sum + run.modelCostUsd + run.estimatedSandboxCostUsd,
          0,
        ) / accepted.length
      : null,
    artifactCount: turns.reduce((sum, turn) => sum + turn.artifactCount, 0),
    dimensionRates: Object.fromEntries(
      dimensionNames.map((name) => [
        name,
        turns.length ? turns.filter((turn) => turn.dimensions?.[name] === true).length / turns.length : 0,
      ]),
    ),
  };
}

function decision(summary) {
  const baseline = summary.conditions.baseline;
  const skill = summary.conditions['simulation-skill'];
  if (!baseline || !skill || baseline.runs < 2 || skill.runs < 2) return 'blocked';
  if (baseline.acceptedTaskRate === 0 && skill.acceptedTaskRate === 0) return 'retain-current-runtime';
  const dimensionMean = (condition) => mean(Object.values(condition.dimensionRates));
  const skillImproves =
    skill.acceptedTaskRate > baseline.acceptedTaskRate ||
    skill.fabricatedResultIncidents < baseline.fabricatedResultIncidents ||
    skill.modelExecutionVerifiedRate > baseline.modelExecutionVerifiedRate ||
    dimensionMean(skill) > dimensionMean(baseline) + 0.05;
  if (skill.acceptedTaskRate >= 2 / 3 && baseline.acceptedTaskRate >= 2 / 3 && skillImproves) {
    return 'proceed-to-cloudflare-spike';
  }
  if (skillImproves) return 'improve-simulation-skill';
  return 'retain-current-runtime';
}

export async function buildSanitizedEvidence(rawRoot, publicDefinition, rawRuns) {
  const salt = randomBytes(32).toString('hex');
  const sanitizedRuns = rawRuns.map((run) => ({
    runId: run.runId,
    repetition: run.repetition,
    condition: run.condition,
    sessionRef: pseudonym(run.sessionId, salt),
    expectedModel: run.expectedModel ?? publicDefinition.model,
    providerModel: run.providerModel,
    environmentType: run.environmentType,
    installedSkillNames: run.installedSkillNames ?? [],
    simulationSkillRead: run.simulationSkillRead ?? false,
    accepted: run.accepted,
    rejectionReasons: run.rejectionReasons,
    failureCategories: [...new Set(run.rejectionReasons.map(failureCategory))],
    costState: run.costState ?? 'observed',
    modelCostUsd: run.modelCostUsd,
    estimatedSandboxCostUsd: run.estimatedSandboxCostUsd,
    totalSessionWallTimeMs: run.totalSessionWallTimeMs ?? null,
    sessionDeleted: run.sessionDeleted ?? null,
    turns: run.turns.map((turn) => ({
      turn: turn.turn,
      turnRef: pseudonym(turn.turnId, salt),
      status: turn.status,
      accepted: turn.accepted,
      rejectionReasons: turn.rejectionReasons,
      usage: (turn.usageKnown ?? true) ? turn.usage : null,
      usageKnown: turn.usageKnown ?? true,
      usageError: turn.usageError ?? null,
      wallTimeMs: turn.wallTimeMs,
      toolCalls: turn.toolCalls,
      repairIterations: turn.repairIterations,
      simulationSkillRead: turn.simulationSkillRead ?? false,
      artifactCount: turn.artifactCount,
      artifactSha256: turn.artifactSha256,
      modelExecutionVerified: turn.modelExecutionVerified,
      parameterExperimentCompleted: turn.parameterExperimentCompleted,
      dimensions: turn.dimensions,
      fabricatedResultIncidents: turn.fabricatedResultIncidents,
      reconciledAfterObserverFailure: turn.reconciledAfterObserverFailure,
    })),
  }));
  const conditions = Object.fromEntries(
    ['baseline', 'simulation-skill'].map((condition) => [
      condition,
      summarizeCondition(sanitizedRuns.filter((run) => run.condition === condition)),
    ]),
  );
  const summary = {
    schemaVersion: 1,
    experimentId: publicDefinition.experimentId,
    definitionSha256: publicDefinition.definitionSha256,
    provider: publicDefinition.provider,
    api: publicDefinition.api,
    model: publicDefinition.model,
    sdkVersion: publicDefinition.sdkVersion,
    fixtureVersion: publicDefinition.fixtureVersion,
    conditions,
  };
  summary.decision = decision(summary);
  const destination = join(rawRoot, 'sanitized');
  await mkdir(destination, { recursive: true });
  await writeJson(join(destination, 'definition.json'), publicDefinition);
  await writeJson(join(destination, 'run-level.json'), sanitizedRuns);
  await writeJson(join(destination, 'summary.json'), summary);
  const report = [
    '# Issue 73 Luna Agents experiment',
    '',
    `Decision: \`${summary.decision}\``,
    '',
    `Definition SHA-256: \`${summary.definitionSha256}\``,
    '',
    'Costs are observed model usage plus estimated sandbox charges, not billing reconciliation. Missing usage remains unknown, never zero; when incomplete, totals are partial observations and cost-efficiency conclusions are unavailable. Historical runs are separate, not refunded or reset by this matrix.',
    '',
    `Provider/API/SDK: \`${summary.provider}\` / \`${summary.api}\` / \`${summary.sdkVersion}\``,
    '',
    '| Metric | Luna baseline | Luna + simulation-skill |',
    '|---|---:|---:|',
    `| accepted task rate | ${conditions.baseline.acceptedTaskRate.toFixed(3)} | ${conditions['simulation-skill'].acceptedTaskRate.toFixed(3)} |`,
    `| first-run success | ${conditions.baseline.firstRunSuccessRate.toFixed(3)} | ${conditions['simulation-skill'].firstRunSuccessRate.toFixed(3)} |`,
    `| autonomous debug success | ${conditions.baseline.autonomousDebugSuccessRate.toFixed(3)} | ${conditions['simulation-skill'].autonomousDebugSuccessRate.toFixed(3)} |`,
    `| model execution verified | ${conditions.baseline.modelExecutionVerifiedRate.toFixed(3)} | ${conditions['simulation-skill'].modelExecutionVerifiedRate.toFixed(3)} |`,
    `| parameter experiment completed | ${conditions.baseline.parameterExperimentRate.toFixed(3)} | ${conditions['simulation-skill'].parameterExperimentRate.toFixed(3)} |`,
    `| simulation skill read | ${conditions.baseline.skillReadRate.toFixed(3)} | ${conditions['simulation-skill'].skillReadRate.toFixed(3)} |`,
    `| evidence-integrity flags (legacy fabricatedResultIncidents field) | ${conditions.baseline.fabricatedResultIncidents} | ${conditions['simulation-skill'].fabricatedResultIncidents} |`,
    `| mean tool calls | ${conditions.baseline.meanToolCalls.toFixed(2)} | ${conditions['simulation-skill'].meanToolCalls.toFixed(2)} |`,
    `| mean repair iterations | ${conditions.baseline.meanRepairIterations.toFixed(2)} | ${conditions['simulation-skill'].meanRepairIterations.toFixed(2)} |`,
    `| observed usage/tokens | ${conditions.baseline.totalTokens} | ${conditions['simulation-skill'].totalTokens} |`,
    `| Turns with unknown usage | ${conditions.baseline.unknownUsageTurns} | ${conditions['simulation-skill'].unknownUsageTurns} |`,
    `| wall time (ms) | ${conditions.baseline.totalWallTimeMs} | ${conditions['simulation-skill'].totalWallTimeMs} |`,
    `| model cost (USD) | ${conditions.baseline.modelCostUsd} | ${conditions['simulation-skill'].modelCostUsd} |`,
    `| estimated sandbox cost (USD) | ${conditions.baseline.estimatedSandboxCostUsd} | ${conditions['simulation-skill'].estimatedSandboxCostUsd} |`,
    `| cost per accepted task (USD) | ${conditions.baseline.costPerAcceptedTaskUsd ?? 'n/a'} | ${conditions['simulation-skill'].costPerAcceptedTaskUsd ?? 'n/a'} |`,
    `| artifact count | ${conditions.baseline.artifactCount} | ${conditions['simulation-skill'].artifactCount} |`,
    `| explicit entities/state/interactions | ${conditions.baseline.dimensionRates.entitiesStateInteractionsExplicit.toFixed(3)} | ${conditions['simulation-skill'].dimensionRates.entitiesStateInteractionsExplicit.toFixed(3)} |`,
    `| emergent quantity defined | ${conditions.baseline.dimensionRates.emergentQuantityDefined.toFixed(3)} | ${conditions['simulation-skill'].dimensionRates.emergentQuantityDefined.toFixed(3)} |`,
    `| verification before interpretation | ${conditions.baseline.dimensionRates.implementationVerifiedBeforeInterpretation.toFixed(3)} | ${conditions['simulation-skill'].dimensionRates.implementationVerifiedBeforeInterpretation.toFixed(3)} |`,
    `| sensitivity analysis | ${conditions.baseline.dimensionRates.sensitivityAnalysis.toFixed(3)} | ${conditions['simulation-skill'].dimensionRates.sensitivityAnalysis.toFixed(3)} |`,
    '',
    'Session and Turn identifiers are salted SHA-256 pseudonyms. Raw events and identifiers remain under `.local/` and are not part of this evidence bundle.',
    'The legacy fabricatedResultIncidents counter flags hash/command/evidence mismatches; it does not establish fabricated simulation values. First-run success means first-Turn contract acceptance, repairs count failed command items, and methodology scores are lexical proxies. Review actual source, raw tables and logs before drawing scientific conclusions.',
    '',
  ].join('\n');
  await writeFile(join(destination, 'report.md'), report);
  const names = (await readdir(destination)).filter((name) => name !== 'SHA256SUMS').sort();
  const checksums = [];
  for (const name of names) checksums.push(`${sha256(await readFile(join(destination, name)))}  ${basename(name)}`);
  await writeFile(join(destination, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
  await writeFile(join(rawRoot, 'pseudonym-salt.local'), `${salt}\n`, { mode: 0o600 });
  return { destination, summary, sanitizedRuns };
}
