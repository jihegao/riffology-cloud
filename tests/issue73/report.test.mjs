import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildSanitizedEvidence } from '../../experiments/issue-73-luna-agents/lib/report.mjs';

function run(id, condition, accepted = true) {
  return {
    runId: id,
    repetition: Number(id.slice(1, 3)),
    condition,
    sessionId: `sess-secret-${id}`,
    providerModel: 'gpt-5.6-luna',
    environmentType: 'openai_hosted',
    accepted,
    rejectionReasons: accepted ? [] : ['rejected'],
    modelCostUsd: 0.01,
    estimatedSandboxCostUsd: 0.01,
    turns: [1, 2, 3].map((turn) => ({
      turn,
      turnId: `turn-secret-${id}-${turn}`,
      status: 'completed',
      accepted,
      rejectionReasons: [],
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 150,
      },
      wallTimeMs: 1000,
      toolCalls: 3,
      repairIterations: 0,
      artifactCount: 2,
      artifactSha256: { manifest: 'a'.repeat(64), projectZip: 'b'.repeat(64) },
      modelExecutionVerified: accepted,
      parameterExperimentCompleted: accepted,
      dimensions: {
        assumptionsExplicit: accepted,
        entitiesStateInteractionsExplicit: accepted,
        feedbackExplicit: accepted,
        emergentQuantityDefined: accepted,
        implementationVerifiedBeforeInterpretation: accepted,
        sensitivityAnalysis: accepted,
        machineReadableArtifacts: accepted,
      },
      fabricatedResultIncidents: 0,
      reconciledAfterObserverFailure: false,
    })),
  };
}

test('sanitized evidence pseudonymizes provider ids and writes checksums', async () => {
  const root = await mkdtemp(join(tmpdir(), 'issue73-report-'));
  const runs = [
    run('r01-baseline', 'baseline'),
    run('r02-baseline', 'baseline'),
    run('r01-skill', 'simulation-skill'),
    run('r02-skill', 'simulation-skill'),
  ];
  const result = await buildSanitizedEvidence(
    root,
    { experimentId: 'issue-73-luna-agents', definitionSha256: 'c'.repeat(64), provider: 'openai', api: 'agents-v1', model: 'gpt-5.6-luna', sdkVersion: '7.17.0', fixtureVersion: 'schelling-v1' },
    runs,
  );
  const runLevel = await readFile(join(result.destination, 'run-level.json'), 'utf8');
  assert.doesNotMatch(runLevel, /sess-secret|turn-secret/);
  assert.match(runLevel, /sha256:/);
  assert.match(await readFile(join(result.destination, 'SHA256SUMS'), 'utf8'), /summary\.json/);
  assert.equal(result.summary.conditions.baseline.acceptedTasks, 2);
  assert.equal(result.summary.conditions.baseline.unknownUsageTurns, 0);
  assert.equal(result.summary.provider, 'openai');
});

test('unknown usage stays explicit and is excluded from observed totals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'issue73-unknown-usage-'));
  const incomplete = run('r01-baseline', 'baseline', false);
  incomplete.turns[1].usageKnown = false;
  incomplete.turns[1].usage = {
    input_tokens: 0,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 0,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 0,
  };
  const result = await buildSanitizedEvidence(
    root,
    { experimentId: 'issue-73-luna-agents', definitionSha256: 'd'.repeat(64), provider: 'openai', api: 'agents-v1', model: 'gpt-5.6-luna', sdkVersion: '7.17.0', fixtureVersion: 'schelling-v1' },
    [incomplete],
  );
  assert.equal(result.summary.conditions.baseline.unknownUsageTurns, 1);
  assert.equal(result.summary.conditions.baseline.totalTokens, 300);
  assert.equal(result.sanitizedRuns[0].turns[1].usage, null);
  assert.match(
    await readFile(join(result.destination, 'report.md'), 'utf8'),
    /Turns with unknown usage \| 1 \| 0/,
  );
});
