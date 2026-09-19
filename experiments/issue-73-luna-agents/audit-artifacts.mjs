#!/usr/bin/env node
// Read-only, post-run inspection. This does not change frozen acceptance scores
// or execute generated code, and never contacts a provider.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { sha256, writeJson } from './lib/util.mjs';

const [rawRoot, destination] = process.argv.slice(2);
if (!rawRoot || !destination) throw new Error('usage: audit-artifacts.mjs RAW_ROOT OUTPUT_JSON');
const runs = JSON.parse(await readFile(join(rawRoot, 'run-index.json'), 'utf8'));
const audit = [];
for (const run of runs) {
  let previous = null;
  const turns = [];
  for (const turn of run.turns) {
    const root = join(rawRoot, 'runs', run.runId, `turn-${turn.turn}`);
    const manifestBytes = await readFile(join(root, 'artifacts', `turn-${turn.turn}-manifest.json`));
    const zipBytes = await readFile(join(root, 'artifacts', `turn-${turn.turn}-project.zip`));
    const manifest = JSON.parse(manifestBytes);
    const entries = Object.entries(unzipSync(zipBytes)).filter(([name]) => !name.endsWith('/'));
    const prefix = entries.every(([name]) => name.startsWith('project/'));
    const files = new Map(entries.map(([name, bytes]) => [prefix ? name.slice(8) : name, Buffer.from(bytes)]));
    const allHashesMatch = files.size === manifest.workspaceFiles.length && manifest.workspaceFiles.every(file =>
      files.has(file.path) && sha256(files.get(file.path)) === file.sha256);
    if (!allHashesMatch) throw new Error(`archive-integrity-failed:${run.runId}:${turn.turn}`);
    const observations = JSON.parse(await readFile(join(root, 'usage-observations.json'), 'utf8'));
    const items = JSON.parse(await readFile(join(root, 'items.json'), 'utf8'));
    const code = manifest.workspaceFiles.filter(file => ['source', 'test', 'config'].includes(file.kind));
    const priorResults = previous?.workspaceFiles.filter(file => file.kind === 'result') ?? [];
    turns.push({
      turn: turn.turn,
      frozenAccepted: turn.accepted,
      frozenRejectionReasons: turn.rejectionReasons,
      manifestSha256: sha256(manifestBytes), projectZipSha256: sha256(zipBytes),
      allHashesMatch, archivedFiles: manifest.workspaceFiles,
      experiment: manifest.experiment, runtime: manifest.runtime,
      changedCodeFiles: previous ? code.filter(file => previous.workspaceFiles.find(old => old.path === file.path)?.sha256 !== file.sha256).map(file => file.path) : null,
      previousResultFiles: priorResults.length,
      unchangedPreviousResultFiles: priorResults.filter(file => manifest.workspaceFiles.some(next => next.path === file.path && next.sha256 === file.sha256)).length,
      previousResultsPreservedByHash: priorResults.map(file => ({
        previousPath: file.path,
        currentPaths: manifest.workspaceFiles.filter(next => next.sha256 === file.sha256).map(next => next.path),
      })),
      observedPassingTestCommands: items.filter(item => item.type === 'command_execution' && item.status === 'completed' && /Ran \d+ tests? in [^\n]+\s+OK\b/.test(item.output ?? '')).map(item => ({
        commandSha256: sha256(item.command), outputSha256: sha256(item.output),
        summary: item.output.match(/Ran \d+ tests? in [^\n]+\s+OK\b/)[0],
      })),
      csvTables: [...files].filter(([name]) => name.endsWith('.csv')).map(([name, bytes]) => ({
        path: name, header: bytes.toString().split(/\r?\n/)[0],
        nonemptyDataLines: bytes.toString().trim().split(/\r?\n/).length - 1,
        containsSeedMethodInsteadOfValue: /<bound method Random\.seed/.test(bytes.toString()),
      })),
      defaultThresholdEvidence: [...files].filter(([name]) => /(?:default|turn3).*verification.*\.json$/i.test(name)).map(([path, bytes]) => ({path, data: JSON.parse(bytes)})),
      usageKnown: turn.usageKnown,
      usageReadCount: observations.length,
      usageObservationSpanMs: observations.length > 1 ? Date.parse(observations.at(-1).observedAt) - Date.parse(observations[0].observedAt) : 0,
    });
    previous = manifest;
  }
  audit.push({ runId: run.runId, condition: run.condition, turns });
}
await writeJson(destination, {
  schemaVersion: 1,
  scope: 'Offline archive hashes, CSV physical line counts, result retention and default-check artifacts. No generated-code replay; no rescoring of frozen acceptance; CSV line counts are not a general CSV parser.',
  runs: audit,
});
console.log(JSON.stringify({ auditedRuns: audit.length, auditedTurns: audit.reduce((n, r) => n + r.turns.length, 0), destination }));
