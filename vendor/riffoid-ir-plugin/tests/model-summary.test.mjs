import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarize } from '../src/model-summary.mjs';
import { summarize as projectSummarize } from '../src/project.mjs';
import { irFixedSkill } from '../adapters/riffoid/platform.mjs';

test('project keeps the same public summary function as the pure browser-safe module', async () => {
  assert.equal(projectSummarize, summarize);
  const business = JSON.parse(await readFile(new URL('../acceptance/b1/business-ir.json', import.meta.url), 'utf8'));
  const result = summarize(business);
  assert.equal(result.tasks[1].firstWaveTime, '00:40');
  assert.equal(result.aircraft.length, 2);
  assert.equal(result.durationMinutes, 60);
  assert.match(result.assumptions.at(-1), /local\/unverified/);
  assert.deepEqual(summarize(null), { unsupported: 'No aircraft Business payload' });
});

test('generate-only authoring synchronizes the saved model display without simulation', async () => {
  const { content } = await irFixedSkill();
  assert.match(content, /generate only must stop before check\/compile\/run/);
  assert.match(content, /After writing or editing model\/business-ir\.draft\.json, call project_ir_show/);
  assert.match(content, /including generate-only requests; this starts no check, compilation or run/);
});
