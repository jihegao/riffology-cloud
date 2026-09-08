import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantEvidence, probeOutcome } from '../../../services/runtime/pi-probe-evidence.mjs';

test('probe strips estimated cost and makes interrupted usage explicitly non-final', () => {
  const evidence = assistantEvidence({ responseId: 'chatcmpl-test', stopReason: 'aborted', usage: {
    input: 207, output: 1, totalTokens: 208, cost: { total: 0 },
  } });
  assert.equal(evidence.usage.status, 'not-final');
  assert.equal(evidence.usage.billingAmount, null);
  assert.equal(evidence.usage.pricebookStatus, 'not-configured');
  assert.equal('cost' in evidence.usage, false);
  assert.equal(evidence.responseId, 'chatcmpl-test');
  assert.equal(evidence.usage.observedTokens.input, 207);
});

test('a requested but unobserved cancellation cannot pass despite successful normal turns', () => {
  const result = probeOutcome({ contextRestored: true, completedWithoutErrors: true,
    cancellation: 'provider-completed-before-cancel', cancelRequested: true,
    responses: [{ requestId: 'request-1' }], events: [],
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.cancelCasePass, false);
});

test('response-body IDs can be recorded separately when gateway request headers are unavailable', () => {
  const result = probeOutcome({ contextRestored: true, completedWithoutErrors: true,
    cancellation: 'observed-aborted', cancelRequested: true,
    responses: [{ requestId: null }], events: [{ type: 'message_end', ...assistantEvidence({
      responseId: 'chatcmpl-test', stopReason: 'stop', usage: { totalTokens: 10 },
    }) }],
  });
  assert.equal(result.responseCorrelation.status, 'available');
  assert.equal(result.responseCorrelation.headerRequestIds, 0);
  assert.equal(result.responseCorrelation.messageResponseIds, 1);
  assert.equal(result.outcome, 'pass-local-live-subset');
  const missing = probeOutcome({ contextRestored: true, completedWithoutErrors: true,
    cancellation: 'not-requested', cancelRequested: false, responses: [{ requestId: null }], events: [],
  });
  assert.equal(missing.outcome, 'partial-correlation-unavailable');
  assert.equal(missing.responseCorrelation.status, 'unavailable');
});
