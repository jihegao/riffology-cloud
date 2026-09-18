import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import {
  summarizeItems,
  verifyContinuity,
  verifyTurnEvidence,
} from '../../experiments/issue-73-luna-agents/lib/evidence.mjs';
import { sha256 } from '../../experiments/issue-73-luna-agents/lib/util.mjs';

function project(turn, extra = {}) {
  const files = {
    'model.py': Buffer.from(`threshold = ${turn === 3 ? '0.45' : '0.4'}\n`),
    'tests/test_model.py': Buffer.from('def test_model(): assert True\n'),
    'results/baseline.csv': Buffer.from('threshold,seed,happy\n0.2,101,0.7\n'),
    'plots/summary.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    'report.md': Buffer.from('# Results\n'),
    ...extra,
  };
  const kinds = {
    'model.py': 'source',
    'tests/test_model.py': 'test',
    'results/baseline.csv': 'result',
    'plots/summary.svg': 'plot',
    'report.md': 'report',
    'results/noise.csv': 'result',
  };
  const manifest = {
    schemaVersion: 1,
    fixtureVersion: 'schelling-v1',
    turn,
    executed: true,
    runtime: { python: '3.12.10', mesa: '3.5.1' },
    verificationCommands: [{ command: 'python model.py', exitCode: 0 }],
    workspaceFiles: Object.entries(files).map(([path, bytes]) => ({
      path,
      kind: kinds[path] ?? 'other',
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
      modifiedFiles: turn === 3 ? ['model.py'] : Object.keys(files),
    },
    assumptions: ['agents occupy at most one cell'],
    limitations: ['synthetic exploratory model'],
  };
  const zip = zipSync(
    Object.fromEntries(Object.entries(files).map(([path, bytes]) => [`project/${path}`, strToU8(bytes.toString())])),
  );
  return { files, manifest, zip };
}

function commandItem(exitCode = 0) {
  return {
    id: 'cmd_1',
    type: 'command_execution',
    command: 'python model.py',
    cwd: '/workspace/project',
    duration_ms: 10,
    exit_code: exitCode,
    output: 'ok',
    status: 'completed',
    turn_id: 'turn_1',
  };
}

test('turn evidence is accepted only when archive hashes and observed commands match', () => {
  const value = project(1);
  const verified = verifyTurnEvidence({
    manifestBytes: Buffer.from(JSON.stringify(value.manifest)),
    projectZipBytes: value.zip,
    expectedTurn: 1,
    commandItems: [commandItem()],
  });
  assert.equal(verified.archiveFileCount, 5);
  const corrupted = structuredClone(value.manifest);
  corrupted.workspaceFiles[0].sha256 = '0'.repeat(64);
  assert.throws(
    () =>
      verifyTurnEvidence({
        manifestBytes: Buffer.from(JSON.stringify(corrupted)),
        projectZipBytes: value.zip,
        expectedTurn: 1,
        commandItems: [commandItem()],
      }),
    /workspace-hash-mismatch/,
  );
  assert.throws(
    () =>
      verifyTurnEvidence({
        manifestBytes: Buffer.from(JSON.stringify(value.manifest)),
        projectZipBytes: value.zip,
        expectedTurn: 1,
        commandItems: [commandItem(1)],
      }),
    /manifest-command-not-observed/,
  );
});

test('continuity retains code and prior results while Turn 3 stays minimal', () => {
  const turn1 = project(1).manifest;
  const turn2 = project(2, { 'results/noise.csv': Buffer.from('noise,seed,happy\n0.1,101,0.71\n') }).manifest;
  turn2.workspaceFiles.find((file) => file.path === 'model.py').sha256 = '1'.repeat(64);
  turn2.changes.modifiedFiles = ['model.py', 'results/noise.csv'];
  const turn3 = project(3, { 'results/noise.csv': Buffer.from('noise,seed,happy\n0.1,101,0.71\n') }).manifest;
  turn3.workspaceFiles.find((file) => file.path === 'results/noise.csv').sha256 =
    turn2.workspaceFiles.find((file) => file.path === 'results/noise.csv').sha256;
  turn3.workspaceFiles.find((file) => file.path === 'model.py').sha256 = '2'.repeat(64);
  assert.equal(verifyContinuity(turn1, turn2).changedCodeFiles, 1);
  assert.equal(verifyContinuity(turn2, turn3).changedCodeFiles, 1);
});

test('Turn 3 accepts an executed default-value verification without inventing a new sweep', () => {
  const value = project(3, {
    'results/default-threshold.json': Buffer.from('{"default":0.45,"verified":true}\n'),
  });
  value.manifest.workspaceFiles.find(
    (file) => file.path === 'results/default-threshold.json',
  ).kind = 'result';
  const verified = verifyTurnEvidence({
    manifestBytes: Buffer.from(JSON.stringify(value.manifest)),
    projectZipBytes: value.zip,
    expectedTurn: 3,
    commandItems: [commandItem()],
  });
  assert.equal(verified.manifest.experiment.parameterValues.similarity_threshold[0], 0.45);
  assert.equal(verified.manifest.experiment.seeds.length, 0);
  assert.equal(verified.dimensions.sensitivityAnalysis, false);
});

test('item summary counts real tools, repairs, and final answer', () => {
  const summary = summarizeItems([
    commandItem(1),
    commandItem(0),
    { type: 'reasoning', turn_id: 'turn_1' },
    { type: 'message', role: 'assistant', phase: 'final_answer', turn_id: 'turn_1' },
  ]);
  assert.deepEqual(summary, {
    toolCalls: 2,
    commandCalls: 2,
    failedCommands: 1,
    repairIterations: 1,
    finalAnswerPresent: true,
    simulationSkillRead: false,
  });
});

test('hosted shell status and wrapped commands verify when exit_code is null', () => {
  const value = project(1);
  const wrapped = commandItem(null);
  wrapped.command = "/bin/bash -lc 'python model.py'";
  wrapped.status = 'completed';
  const verified = verifyTurnEvidence({
    manifestBytes: Buffer.from(JSON.stringify(value.manifest)),
    projectZipBytes: value.zip,
    expectedTurn: 1,
    commandItems: [wrapped],
  });
  assert.equal(verified.archiveFileCount, 5);
  const summary = summarizeItems([
    wrapped,
    { ...wrapped, id: 'cmd_2', status: 'failed' },
  ]);
  assert.equal(summary.failedCommands, 1);
});

test('hosted Bash escaping normalizes without accepting a command substring', () => {
  const value = project(1);
  value.manifest.verificationCommands = [
    { command: "python - <<'PY'\nopen('x').write('\\n')\nPY", exitCode: 0 },
  ];
  const escaped = commandItem(null);
  escaped.command = "/bin/bash -lc \"python - <<'PY'\nopen('x').write('\\\\n')\nPY\"";
  escaped.status = 'completed';
  assert.doesNotThrow(() =>
    verifyTurnEvidence({
      manifestBytes: Buffer.from(JSON.stringify(value.manifest)),
      projectZipBytes: value.zip,
      expectedTurn: 1,
      commandItems: [escaped],
    }),
  );
  assert.throws(
    () =>
      verifyTurnEvidence({
        manifestBytes: Buffer.from(JSON.stringify(value.manifest)),
        projectZipBytes: value.zip,
        expectedTurn: 1,
        commandItems: [{ ...escaped, command: `${escaped.command} && echo extra` }],
      }),
    /manifest-command-not-observed/,
  );
});

test('skill activation requires an observed successful SKILL.md content read', () => {
  const item = commandItem(null);
  item.command = "sed -n '1,240p' /root/.agents/skills/riffology-simulation/SKILL.md";
  item.output = '# Riffology Simulation\n\n## Modeling workflow\n';
  item.status = 'completed';
  assert.equal(summarizeItems([item]).simulationSkillRead, true);
  assert.equal(summarizeItems([{ ...item, status: 'failed' }]).simulationSkillRead, false);
});

test('methodology dimensions come from inspectable reports and experiment evidence, not manifest self-claims', () => {
  const report = Buffer.from(`# Methodology
Entities are resident agents with position state on a grid. Interactions use a
Moore neighborhood. Moves alter later neighborhoods, creating feedback and
candidate emergent segregation. Tests verified execution before result
interpretation. Sensitivity was checked across fixed seeds.
`);
  const value = project(1, { 'report.md': report });
  value.manifest.methodology = {
    entities: [],
    stateVariables: [],
    interactions: [],
  };
  const verified = verifyTurnEvidence({
    manifestBytes: Buffer.from(JSON.stringify(value.manifest)),
    projectZipBytes: value.zip,
    expectedTurn: 1,
    commandItems: [commandItem()],
  });
  assert.equal(verified.dimensions.entitiesStateInteractionsExplicit, true);
  assert.equal(verified.dimensions.feedbackExplicit, true);
  assert.equal(verified.dimensions.emergentQuantityDefined, true);
  assert.equal(verified.dimensions.implementationVerifiedBeforeInterpretation, true);
  assert.equal(verified.dimensions.sensitivityAnalysis, true);
});
