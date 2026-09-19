#!/usr/bin/env node
import { cp, mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { loadBudgetManifest } from './lib/budget.mjs';
import {
  DEFAULT_REPETITIONS,
  REPOSITORY_ROOT,
} from './lib/constants.mjs';
import { loadDefinition, publicDefinition } from './lib/definition.mjs';
import { runExperiment } from './lib/runner.mjs';
import { parseArgs, runSetId, writeJson } from './lib/util.mjs';

function usage() {
  return `Usage:
  node experiments/issue-73-luna-agents/cli.mjs plan [--repetitions 3] [--output plan.json]
  node experiments/issue-73-luna-agents/cli.mjs run --live --manifest budget.json [--output-root .local/...]
  node experiments/issue-73-luna-agents/cli.mjs promote --run-root .local/... --name YYYYMMDD-run
`;
}

function pathFrom(value, fallback) {
  const selected = value || fallback;
  return isAbsolute(selected) ? selected : resolve(REPOSITORY_ROOT, selected);
}

async function plan(args) {
  const repetitions = Number(args.repetitions ?? DEFAULT_REPETITIONS);
  const definition = await loadDefinition(repetitions);
  const output = publicDefinition(definition);
  if (args.output) await writeJson(pathFrom(args.output), output);
  else process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

async function run(args) {
  if (args.live !== true) throw new Error('live-run-requires-explicit---live');
  if (typeof args.manifest !== 'string') throw new Error('live-run-requires---manifest');
  process.loadEnvFile(join(REPOSITORY_ROOT, '.env.local'));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY-not-found');
  const manifest = await loadBudgetManifest(pathFrom(args.manifest));
  const definition = await loadDefinition(manifest.repetitionsPerCondition);
  const outputRoot = pathFrom(
    args['output-root'],
    join('.local', 'issue73', 'runs', runSetId()),
  );
  const stopController = new AbortController();
  let interrupted = false;
  const handlers = new Map(
    ['SIGINT', 'SIGTERM'].map((name) => [
      name,
      () => {
        if (stopController.signal.aborted) return;
        interrupted = true;
        process.stderr.write(
          `${name} received; finishing the active Turn, preserving evidence, and stopping before new input.\n`,
        );
        stopController.abort(new Error(`stop:operator-signal:${name}`));
      },
    ]),
  );
  for (const [name, handler] of handlers) process.once(name, handler);
  let result;
  try {
    result = await runExperiment({
      apiKey,
      definition,
      manifest,
      rawRoot: outputRoot,
      signal: stopController.signal,
    });
  } finally {
    for (const [name, handler] of handlers) process.removeListener(name, handler);
  }
  process.stdout.write(
    `${JSON.stringify({
      rawRoot: result.rawRoot,
      sanitizedEvidence: result.evidence.destination,
      totals: result.totals,
      decision: result.evidence.summary.decision,
      stopped: result.stopped,
    }, null, 2)}\n`,
  );
  if (interrupted) process.exitCode = 130;
}

async function promote(args) {
  if (typeof args['run-root'] !== 'string') throw new Error('promote-requires---run-root');
  if (typeof args.name !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(args.name)) {
    throw new Error('promote-requires-safe---name');
  }
  const source = join(pathFrom(args['run-root']), 'sanitized');
  const destination = join(REPOSITORY_ROOT, 'docs', 'evidence', 'issue-73-luna-agents', args.name);
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  process.stdout.write(`${destination}\n`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === 'plan') return plan(args);
  if (command === 'run') return run(args);
  if (command === 'promote') return promote(args);
  throw new Error(usage());
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
