import { unzipSync } from 'fflate';
import { FIXTURE_VERSION } from './constants.mjs';
import { assertPlainObject, sha256 } from './util.mjs';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MACHINE_READABLE_PATTERN = /\.(csv|json|jsonl|parquet)$/i;
const PLOT_PATTERN = /\.(png|svg|pdf)$/i;
const CODE_KINDS = new Set(['source', 'config', 'test']);

function normalizeArchiveEntries(bytes) {
  const raw = unzipSync(new Uint8Array(bytes));
  const entries = Object.entries(raw).filter(([path]) => !path.endsWith('/'));
  const hasProjectPrefix = entries.length > 0 && entries.every(([path]) => path.startsWith('project/'));
  const normalized = new Map();
  for (const [rawPath, content] of entries) {
    const path = hasProjectPrefix ? rawPath.slice('project/'.length) : rawPath;
    if (!path || path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error(`unsafe-project-archive-path:${rawPath}`);
    }
    if (normalized.has(path)) throw new Error(`duplicate-project-archive-path:${path}`);
    normalized.set(path, Buffer.from(content));
  }
  if (normalized.size === 0) throw new Error('empty-project-archive');
  return normalized;
}

function validateManifestShape(value, expectedTurn) {
  const manifest = assertPlainObject(value, 'turn-manifest');
  if (manifest.schemaVersion !== 1) throw new Error('unsupported-turn-manifest-schema');
  if (manifest.fixtureVersion !== FIXTURE_VERSION) throw new Error('fixture-version-mismatch');
  if (manifest.turn !== expectedTurn) throw new Error('turn-number-mismatch');
  if (manifest.executed !== true) throw new Error('turn-not-marked-executed');
  assertPlainObject(manifest.runtime, 'runtime');
  if (!String(manifest.runtime.python ?? '').trim()) throw new Error('python-version-missing');
  if (!String(manifest.runtime.mesa ?? '').trim()) throw new Error('mesa-version-missing');
  if (!Array.isArray(manifest.verificationCommands) || manifest.verificationCommands.length === 0) {
    throw new Error('verification-commands-missing');
  }
  if (!Array.isArray(manifest.workspaceFiles) || manifest.workspaceFiles.length === 0) {
    throw new Error('workspace-files-missing');
  }
  if (!Array.isArray(manifest.assumptions) || manifest.assumptions.length === 0) {
    throw new Error('assumptions-missing');
  }
  if (!Array.isArray(manifest.limitations) || manifest.limitations.length === 0) {
    throw new Error('limitations-missing');
  }
  assertPlainObject(manifest.experiment, 'experiment');
  assertPlainObject(manifest.changes, 'changes');
  if (!Array.isArray(manifest.changes.inspectedFiles)) throw new Error('inspected-files-missing');
  if (!Array.isArray(manifest.changes.modifiedFiles)) throw new Error('modified-files-missing');
  return manifest;
}

function validateWorkspaceFiles(manifest, archiveEntries) {
  const listed = new Map();
  for (const file of manifest.workspaceFiles) {
    assertPlainObject(file, 'workspace-file');
    if (typeof file.path !== 'string' || !file.path || file.path.startsWith('/')) {
      throw new Error('invalid-workspace-file-path');
    }
    if (file.path.split('/').includes('..')) throw new Error('unsafe-workspace-file-path');
    if (!['source', 'config', 'test', 'result', 'plot', 'report', 'other'].includes(file.kind)) {
      throw new Error(`invalid-workspace-file-kind:${file.path}`);
    }
    if (!HASH_PATTERN.test(file.sha256)) throw new Error(`invalid-workspace-file-hash:${file.path}`);
    if (listed.has(file.path)) throw new Error(`duplicate-workspace-file:${file.path}`);
    listed.set(file.path, file);
  }
  const archivedPaths = [...archiveEntries.keys()].sort();
  const listedPaths = [...listed.keys()].sort();
  if (JSON.stringify(archivedPaths) !== JSON.stringify(listedPaths)) {
    throw new Error('workspace-file-list-does-not-match-archive');
  }
  for (const [path, bytes] of archiveEntries) {
    if (sha256(bytes) !== listed.get(path).sha256) throw new Error(`workspace-hash-mismatch:${path}`);
  }
  return listed;
}

function validateExperiment(manifest, turn) {
  const experiment = manifest.experiment;
  if (!Array.isArray(experiment.parametersVaried) || experiment.parametersVaried.length === 0) {
    throw new Error('parameters-varied-missing');
  }
  assertPlainObject(experiment.parameterValues, 'parameter-values');
  if (!Array.isArray(experiment.seeds)) throw new Error('experiment-seeds-missing');
  if (!Number.isSafeInteger(experiment.steps) || experiment.steps < 0) {
    throw new Error('invalid-experiment-steps');
  }
  if (!Number.isSafeInteger(experiment.runCount) || experiment.runCount < 1) {
    throw new Error('invalid-run-count');
  }
  if (!Array.isArray(experiment.primaryMetrics) || experiment.primaryMetrics.length === 0) {
    throw new Error('primary-metrics-missing');
  }
  if (turn === 1) {
    if (experiment.seeds.length < 3) throw new Error('at-least-three-seeds-required');
    if (experiment.steps < 1) throw new Error('invalid-experiment-steps');
    const thresholdKey = Object.keys(experiment.parameterValues).find((key) =>
      /threshold|similarity/i.test(key),
    );
    if (!thresholdKey || !Array.isArray(experiment.parameterValues[thresholdKey]) || experiment.parameterValues[thresholdKey].length < 4) {
      throw new Error('turn-1-threshold-sweep-incomplete');
    }
  }
  if (turn === 2) {
    if (experiment.seeds.length < 3) throw new Error('at-least-three-seeds-required');
    if (experiment.steps < 1) throw new Error('invalid-experiment-steps');
    const noiseKey = Object.keys(experiment.parameterValues).find((key) => /mobility_noise/i.test(key));
    const values = noiseKey ? experiment.parameterValues[noiseKey] : null;
    if (!Array.isArray(values) || ![0, 0.1, 0.3].every((value) => values.includes(value))) {
      throw new Error('turn-2-mobility-noise-sweep-incomplete');
    }
  }
  if (turn === 3) {
    const thresholdKey = Object.keys(experiment.parameterValues).find((key) =>
      /threshold|similarity/i.test(key),
    );
    const values = thresholdKey ? experiment.parameterValues[thresholdKey] : null;
    if (!Array.isArray(values) || !values.includes(0.45)) {
      throw new Error('turn-3-default-threshold-verification-missing');
    }
  }
}

function validateCommandEvidence(manifest, commandItems) {
  const used = new Set();
  for (const record of manifest.verificationCommands) {
    assertPlainObject(record, 'verification-command');
    if (typeof record.command !== 'string' || !record.command.trim()) {
      throw new Error('invalid-verification-command');
    }
    if (!Number.isInteger(record.exitCode)) throw new Error('verification-exit-code-missing');
    const observedIndex = commandItems.findIndex((item, index) => {
      if (used.has(index)) return false;
      const commandMatches = commandsEquivalent(item.command, record.command);
      const outcomeMatches = Number.isInteger(item.exit_code)
        ? item.exit_code === record.exitCode
        : record.exitCode === 0
          ? item.status === 'completed'
          : item.status === 'failed';
      return commandMatches && outcomeMatches;
    });
    if (observedIndex < 0) throw new Error(`manifest-command-not-observed:${record.command}`);
    used.add(observedIndex);
  }
  if (!commandItems.some((item) => commandSucceeded(item) && /python|pytest/i.test(item.command))) {
    throw new Error('no-successful-python-execution-observed');
  }
}

function normalizedShellCommand(value) {
  const command = String(value ?? '');
  const doubleQuoted = command.match(/^\/bin\/bash -lc "([\s\S]*)"$/);
  if (doubleQuoted) {
    return doubleQuoted[1]
      .replace(/\\\n/g, '')
      .replace(/\\(["\\$`])/g, '$1');
  }
  const singleQuoted = command.match(/^\/bin\/bash -lc '([^']*)'$/s);
  return singleQuoted ? singleQuoted[1] : command;
}

function commandsEquivalent(observed, declared) {
  return normalizedShellCommand(observed) === normalizedShellCommand(declared);
}

function commandSucceeded(item) {
  return item.exit_code === 0 || (item.exit_code == null && item.status === 'completed');
}

function commandFailed(item) {
  return (Number.isInteger(item.exit_code) && item.exit_code !== 0) ||
    (item.exit_code == null && item.status === 'failed');
}

export function verifyTurnEvidence({ manifestBytes, projectZipBytes, expectedTurn, commandItems }) {
  const manifest = validateManifestShape(JSON.parse(Buffer.from(manifestBytes).toString('utf8')), expectedTurn);
  const archiveEntries = normalizeArchiveEntries(projectZipBytes);
  const listed = validateWorkspaceFiles(manifest, archiveEntries);
  validateExperiment(manifest, expectedTurn);
  validateCommandEvidence(manifest, commandItems);
  const files = [...listed.values()];
  if (!files.some((file) => file.kind === 'source' && file.path.endsWith('.py'))) {
    throw new Error('python-model-source-missing');
  }
  if (!files.some((file) => file.kind === 'result' && MACHINE_READABLE_PATTERN.test(file.path))) {
    throw new Error('machine-readable-result-missing');
  }
  if (!files.some((file) => file.kind === 'plot' && PLOT_PATTERN.test(file.path))) {
    throw new Error('plot-artifact-missing');
  }
  const reportText = files
    .filter((file) => file.kind === 'report')
    .map((file) => archiveEntries.get(file.path)?.toString('utf8') ?? '')
    .join('\n');
  const has = (pattern) => pattern.test(reportText);
  const parameterBreadth = Object.values(manifest.experiment.parameterValues).some(
    (values) => Array.isArray(values) && values.length >= 3,
  );
  return {
    manifest,
    archiveFileCount: archiveEntries.size,
    artifactSha256: {
      manifest: sha256(manifestBytes),
      projectZip: sha256(projectZipBytes),
    },
    dimensions: {
      assumptionsExplicit: manifest.assumptions.length > 0,
      entitiesStateInteractionsExplicit:
        has(/\b(entit(?:y|ies)|agents?|residents?)\b/i) &&
        has(/\b(state|attributes?|positions?)\b/i) &&
        has(/\b(interactions?|neighbou?rhood|grid)\b/i),
      feedbackExplicit: has(/\bfeedback\b|moves? alter|relocation.{0,80}neighbou?r/i),
      emergentQuantityDefined:
        has(/\b(emergent|segregation|clustering)\b/i) &&
        manifest.experiment.primaryMetrics.length > 0,
      implementationVerifiedBeforeInterpretation:
        has(/\b(verif(?:y|ied|ication)|tests?|executed)\b/i) &&
        has(/\b(interpret(?:ation|ed)?|results?)\b/i),
      sensitivityAnalysis:
        parameterBreadth &&
        manifest.experiment.seeds.length >= 3 &&
        has(/\b(sensitivity|robustness|seeds?)\b/i),
      machineReadableArtifacts: true,
    },
  };
}

function fileMap(manifest) {
  return new Map(manifest.workspaceFiles.map((file) => [file.path, file]));
}

export function verifyContinuity(previous, current) {
  const before = fileMap(previous);
  const after = fileMap(current);
  const beforeCode = [...before.values()].filter((file) => CODE_KINDS.has(file.kind));
  const retainedCode = beforeCode.filter((file) => after.has(file.path));
  if (beforeCode.length === 0 || retainedCode.length / beforeCode.length < 0.5) {
    throw new Error('continuity-code-retention-below-half');
  }
  const oldResults = [...before.values()].filter((file) => file.kind === 'result');
  if (!oldResults.some((file) => after.has(file.path))) {
    throw new Error('continuity-old-results-not-retained');
  }
  const changedCode = [...after.values()].filter((file) => {
    const old = before.get(file.path);
    return CODE_KINDS.has(file.kind) && (!old || old.sha256 !== file.sha256);
  });
  const declared = new Set(current.changes.modifiedFiles);
  for (const file of changedCode) {
    if (!declared.has(file.path)) throw new Error(`undeclared-modified-file:${file.path}`);
  }
  if (current.turn === 3) {
    if (current.changes.inspectedFiles.length === 0) throw new Error('turn-3-inspection-not-recorded');
    if (changedCode.length > 2) throw new Error('turn-3-source-change-not-minimal');
  }
  return { retainedCodeFiles: retainedCode.length, changedCodeFiles: changedCode.length };
}

export function summarizeItems(items) {
  const commands = items.filter((item) => item.type === 'command_execution');
  const failedCommands = commands.filter(commandFailed);
  const simulationSkillRead = commands.some(
    (item) =>
      commandSucceeded(item) &&
      /SKILL\.md/.test(String(item.command ?? '')) &&
      /# Riffology Simulation|Modeling workflow/.test(String(item.output ?? '')),
  );
  const finalMessages = items.filter(
    (item) => item.type === 'message' && item.role === 'assistant' && item.phase === 'final_answer',
  );
  return {
    toolCalls: items.filter((item) => !['message', 'reasoning'].includes(item.type)).length,
    commandCalls: commands.length,
    failedCommands: failedCommands.length,
    repairIterations: failedCommands.length,
    finalAnswerPresent: finalMessages.length > 0,
    simulationSkillRead,
  };
}
