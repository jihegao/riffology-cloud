import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertBudgetRemaining,
  loadBudgetManifest,
  normalizeObservedUsage,
  observedModelCost,
} from '../../experiments/issue-73-luna-agents/lib/budget.mjs';

function validManifest(now) {
  return {
    schemaVersion: 1,
    experimentId: 'issue-73-luna-agents',
    model: 'gpt-5.6-luna',
    repetitionsPerCondition: 3,
    maxSessions: 6,
    maxTurns: 18,
    maxWallTimeSecondsPerTurn: 900,
    maxTokensPerTurn: 20000,
    maxTotalTokens: 360000,
    maxModelCostUsd: 1,
    maxSandboxCostUsd: 1,
    authorizationReference: 'user-approval-20260917',
    approvedAt: new Date(now - 1_000).toISOString(),
    deadline: new Date(now + 60_000).toISOString(),
    privacyScope: 'synthetic-schelling-fixture-only',
    rateCard: {
      source: 'https://developers.openai.com/api/docs/pricing',
      checkedAt: new Date(now - 1_000).toISOString(),
      inputUsdPerMillion: 0.2,
      cachedInputUsdPerMillion: 0.02,
      outputUsdPerMillion: 1.2,
      sandbox1GbUsdPer20Minutes: 0.03,
      minimumSandboxMinutes: 5,
    },
    cleanup: 'retain-until-evidence-promoted',
  };
}

test('limited policy enforces attempt/time bounds and observes thresholds without reserving token headroom', async () => {
  const now = Date.now();
  const manifest = {
    ...validManifest(now), repetitionsPerCondition: 2, maxSessions: 4, maxTurns: 12,
    executionPolicy: 'bounded-attempts-observed-thresholds', acknowledgeUnknownActualSpend: true,
    cleanup: 'delete-after-download',
  };
  const path = join(await mkdtemp(join(tmpdir(), 'issue73-limited-budget-')), 'budget.json');
  await writeFile(path, JSON.stringify(manifest));
  const loaded = await loadBudgetManifest(path, now);
  const totals = { sessions: 3, turns: 11, tokens: manifest.maxTotalTokens - 1, modelCostUsd: 0, sandboxCostUsd: 0 };
  assert.doesNotThrow(() => assertBudgetRemaining(loaded, totals, { startingTurn: true }));
  assert.throws(() => assertBudgetRemaining(loaded, { ...totals, turns: 12 }, { startingTurn: true }), /turn-cap/);
  assert.throws(() => assertBudgetRemaining(loaded, { ...totals, sessions: 4 }, { startingSession: true }), /session-cap/);
  assert.throws(() => assertBudgetRemaining(loaded, { ...totals, tokens: manifest.maxTotalTokens }), /token-cap/);
  assert.throws(() => assertBudgetRemaining(loaded, totals, { now: loaded.deadline }), /deadline/);
  await writeFile(path, JSON.stringify({ ...manifest, deadline: new Date(now + 3 * 3600_000).toISOString() }));
  await assert.rejects(loadBudgetManifest(path, now), /authorization-exceeded/);
});

async function writeManifest(value) {
  const directory = await mkdtemp(join(tmpdir(), 'issue73-budget-'));
  const path = join(directory, 'budget.json');
  await writeFile(path, JSON.stringify(value));
  return path;
}

test('budget manifest rejects placeholders and accepts a frozen bounded window', async () => {
  const now = Date.now();
  const placeholder = validManifest(now);
  placeholder.authorizationReference = 'REPLACE_WITH_EXPLICIT_USER_APPROVAL_REFERENCE';
  const placeholderPath = await writeManifest(placeholder);
  await assert.rejects(() => loadBudgetManifest(placeholderPath, now), /authorization/);
  const validPath = await writeManifest(validManifest(now));
  const loaded = await loadBudgetManifest(validPath, now);
  assert.equal(loaded.maxSessions, 6);
  assert.equal(loaded.model, 'gpt-5.6-luna');
});

test('observed model cost separates cached input and budget stops at caps', () => {
  const cost = observedModelCost(
    {
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 400 },
      output_tokens: 200,
    },
    { inputUsdPerMillion: 0.2, cachedInputUsdPerMillion: 0.02, outputUsdPerMillion: 1.2 },
  );
  assert.equal(cost, (600 * 0.2 + 400 * 0.02 + 200 * 1.2) / 1_000_000);
  assert.throws(
    () =>
      assertBudgetRemaining(
        { ...validManifest(Date.now()), deadline: Date.now() + 1_000 },
        { sessions: 6, turns: 0, tokens: 0, modelCostUsd: 0, sandboxCostUsd: 0 },
        { startingSession: true },
      ),
    /session-cap/,
  );
  assert.doesNotThrow(() =>
    assertBudgetRemaining(
      { ...validManifest(Date.now()), deadline: Date.now() + 1_000 },
      { sessions: 6, turns: 17, tokens: 0, modelCostUsd: 0, sandboxCostUsd: 0 },
      { startingTurn: true },
    ),
  );
  assert.throws(
    () =>
      assertBudgetRemaining(
        { ...validManifest(Date.now()), deadline: Date.now() + 1_000 },
        { sessions: 1, turns: 1, tokens: 350001, modelCostUsd: 0, sandboxCostUsd: 0 },
        { startingTurn: true },
      ),
    /token-headroom/,
  );
});

test('observed usage must be complete, internally consistent nonnegative integers', () => {
  const valid = {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 40 },
    output_tokens: 20,
    output_tokens_details: { reasoning_tokens: 5 },
    total_tokens: 120,
  };
  assert.deepEqual(normalizeObservedUsage(valid), valid);
  assert.equal(normalizeObservedUsage(null), null);
  assert.throws(
    () => normalizeObservedUsage({ ...valid, total_tokens: 119 }),
    /usage-invalid:total-mismatch/,
  );
  assert.throws(
    () =>
      normalizeObservedUsage({
        ...valid,
        input_tokens_details: { cached_tokens: 101 },
      }),
    /usage-invalid:cached-exceeds-input/,
  );
  assert.throws(
    () => normalizeObservedUsage({ ...valid, output_tokens_details: {} }),
    /usage-invalid:reasoning-tokens/,
  );
});
