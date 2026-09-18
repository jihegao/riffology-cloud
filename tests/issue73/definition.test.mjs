import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDefinition, publicDefinition } from '../../experiments/issue-73-luna-agents/lib/definition.mjs';

test('definition fixes Luna, isolation, counterbalanced A/B, prompts, and skill digest', async () => {
  const first = await loadDefinition(3);
  const second = await loadDefinition(3);
  assert.equal(first.model, 'gpt-5.6-luna');
  assert.equal(first.reasoningEffort, 'low');
  assert.equal(first.provider, 'openai');
  assert.equal(first.api, 'agents-v1');
  assert.equal(first.networkAccess, 'disabled');
  assert.equal(first.multiAgent, false);
  assert.equal(first.mcp, false);
  assert.equal(first.runs.length, 6);
  assert.deepEqual(
    first.runs.map((run) => run.condition),
    ['baseline', 'simulation-skill', 'simulation-skill', 'baseline', 'baseline', 'simulation-skill'],
  );
  assert.equal(first.prompts.length, 3);
  assert.ok(first.prompts.every((prompt) => prompt.requiredArtifacts.length === 2));
  assert.ok(
    first.prompts.every((prompt) =>
      prompt.text.includes('an existing model or runner `.py` file\nmust remain `source`'),
    ),
  );
  assert.match(first.skill.sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.definitionSha256, second.definitionSha256);
  assert.equal(publicDefinition(first).skillArchive, undefined);
});

test('definition requires multiple repetitions', async () => {
  await assert.rejects(() => loadDefinition(1), /repetitions-must-be-between/);
});
