import { readFile } from 'node:fs/promises';
import { EXPERIMENT_ID, MODEL, RATE_CARD, TURNS_PER_SESSION } from './constants.mjs';
import {
  assertPlainObject,
  assertPositiveInteger,
  assertPositiveNumber,
} from './util.mjs';

const PLACEHOLDER = /REPLACE_WITH|TODO|CHANGEME/i;

function timestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`invalid-${label}`);
  }
  return Date.parse(value);
}

export async function loadBudgetManifest(path, now = Date.now()) {
  const manifest = assertPlainObject(JSON.parse(await readFile(path, 'utf8')), 'budget-manifest');
  if (manifest.schemaVersion !== 1) throw new Error('unsupported-budget-schema');
  if (manifest.experimentId !== EXPERIMENT_ID) throw new Error('wrong-experiment-id');
  if (manifest.model !== MODEL) throw new Error('model-must-remain-gpt-5.6-luna');
  const repetitions = assertPositiveInteger(
    manifest.repetitionsPerCondition,
    'repetitions-per-condition',
  );
  if (repetitions < 2 || repetitions > 10) throw new Error('invalid-repetition-bound');
  if (manifest.maxSessions !== repetitions * 2) throw new Error('max-sessions-mismatch');
  if (manifest.maxTurns !== manifest.maxSessions * TURNS_PER_SESSION) {
    throw new Error('max-turns-mismatch');
  }
  assertPositiveInteger(manifest.maxWallTimeSecondsPerTurn, 'wall-time-seconds-per-turn');
  assertPositiveInteger(manifest.maxTokensPerTurn, 'tokens-per-turn');
  assertPositiveInteger(manifest.maxTotalTokens, 'total-tokens');
  if (manifest.maxTokensPerTurn > manifest.maxTotalTokens) {
    throw new Error('per-turn-token-reservation-exceeds-total-cap');
  }
  assertPositiveNumber(manifest.maxModelCostUsd, 'model-cost-usd');
  assertPositiveNumber(manifest.maxSandboxCostUsd, 'sandbox-cost-usd');
  if (
    typeof manifest.authorizationReference !== 'string' ||
    !manifest.authorizationReference.trim() ||
    PLACEHOLDER.test(manifest.authorizationReference)
  ) {
    throw new Error('explicit-authorization-reference-required');
  }
  const approvedAt = timestamp(manifest.approvedAt, 'approved-at');
  const deadline = timestamp(manifest.deadline, 'deadline');
  if (manifest.executionPolicy != null && manifest.executionPolicy !== 'bounded-attempts-observed-thresholds') {
    throw new Error('invalid-execution-policy');
  }
  if (manifest.executionPolicy === 'bounded-attempts-observed-thresholds') {
    if (manifest.maxSessions > 4 || manifest.maxTurns > 12 || deadline - approvedAt > 3 * 3600_000) {
      throw new Error('limited-experiment-authorization-exceeded');
    }
    if (manifest.cleanup !== 'delete-after-download' || manifest.acknowledgeUnknownActualSpend !== true) {
      throw new Error('limited-experiment-requires-cleanup-and-unknown-spend-acknowledgment');
    }
  }
  if (approvedAt > now + 60_000) throw new Error('approval-is-in-the-future');
  if (deadline <= now) throw new Error('budget-deadline-expired');
  if (manifest.privacyScope !== 'synthetic-schelling-fixture-only') {
    throw new Error('privacy-scope-must-remain-synthetic-only');
  }
  const rateCard = assertPlainObject(manifest.rateCard, 'rate-card');
  if (rateCard.source !== RATE_CARD.source) throw new Error('untrusted-rate-card-source');
  const checkedAt = timestamp(rateCard.checkedAt, 'rate-card-checked-at');
  if (now - checkedAt > 7 * 24 * 60 * 60 * 1000) throw new Error('rate-card-is-stale');
  for (const field of [
    'inputUsdPerMillion',
    'cachedInputUsdPerMillion',
    'outputUsdPerMillion',
    'sandbox1GbUsdPer20Minutes',
    'minimumSandboxMinutes',
  ]) {
    assertPositiveNumber(rateCard[field], field);
    if (rateCard[field] !== RATE_CARD[field]) throw new Error(`rate-card-mismatch:${field}`);
  }
  if (!['retain-until-evidence-promoted', 'delete-after-download'].includes(manifest.cleanup)) {
    throw new Error('invalid-cleanup-policy');
  }
  return Object.freeze({ ...manifest, approvedAt, deadline, checkedAt });
}

export function observedModelCost(usage, rateCard) {
  const input = usage?.input_tokens ?? 0;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const uncached = Math.max(0, input - cached);
  return (
    (uncached * rateCard.inputUsdPerMillion +
      cached * rateCard.cachedInputUsdPerMillion +
      output * rateCard.outputUsdPerMillion) /
    1_000_000
  );
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`usage-invalid:${label}`);
  return value;
}

export function normalizeObservedUsage(value) {
  if (value == null) return null;
  let usage;
  let inputDetails;
  let outputDetails;
  try {
    usage = assertPlainObject(value, 'usage');
    inputDetails = assertPlainObject(usage.input_tokens_details, 'usage-input-details');
    outputDetails = assertPlainObject(usage.output_tokens_details, 'usage-output-details');
  } catch (error) {
    throw new Error(`usage-invalid:shape:${error.message}`);
  }
  const input = nonnegativeInteger(usage.input_tokens, 'input-tokens');
  const cached = nonnegativeInteger(inputDetails.cached_tokens, 'cached-tokens');
  const output = nonnegativeInteger(usage.output_tokens, 'output-tokens');
  const reasoning = nonnegativeInteger(outputDetails.reasoning_tokens, 'reasoning-tokens');
  const total = nonnegativeInteger(usage.total_tokens, 'total-tokens');
  if (cached > input) throw new Error('usage-invalid:cached-exceeds-input');
  if (reasoning > output) throw new Error('usage-invalid:reasoning-exceeds-output');
  if (total !== input + output) throw new Error('usage-invalid:total-mismatch');
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: cached },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: reasoning },
    total_tokens: total,
  };
}

export function estimatedSandboxCost(wallTimeMs, rateCard, retained = false) {
  const observedMinutes = Math.ceil(Math.max(0, wallTimeMs) / 60_000);
  const billedMinutes = retained
    ? Math.max(60, observedMinutes)
    : Math.max(rateCard.minimumSandboxMinutes, observedMinutes);
  return (billedMinutes / 20) * rateCard.sandbox1GbUsdPer20Minutes;
}

export function assertBudgetRemaining(
  manifest,
  totals,
  { now = Date.now(), startingSession = false, startingTurn = false } = {},
) {
  if (now >= manifest.deadline) throw new Error('stop:deadline');
  if (startingSession && totals.sessions >= manifest.maxSessions) throw new Error('stop:session-cap');
  if (startingTurn && totals.turns >= manifest.maxTurns) throw new Error('stop:turn-cap');
  if (totals.tokens >= manifest.maxTotalTokens) throw new Error('stop:token-cap');
  if (manifest.executionPolicy !== 'bounded-attempts-observed-thresholds' && startingTurn && totals.tokens + manifest.maxTokensPerTurn > manifest.maxTotalTokens) {
    throw new Error('stop:insufficient-token-headroom');
  }
  if (totals.modelCostUsd >= manifest.maxModelCostUsd) throw new Error('stop:model-cost-cap');
  if (totals.sandboxCostUsd >= manifest.maxSandboxCostUsd) throw new Error('stop:sandbox-cost-cap');
}
