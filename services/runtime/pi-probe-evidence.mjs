export function correlationId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._:/-]{1,256}$/.test(value) ? value : null;
}

/** SDK cost estimates are not a configured pricebook or a settlement receipt. */
export function assistantEvidence(message) {
  const observedTokens = Object.fromEntries(
    ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'totalTokens'].map((key) => [
      key, Number.isFinite(message.usage?.[key]) ? message.usage[key] : null,
    ]),
  );
  return {
    responseId: correlationId(message.responseId),
    stopReason: message.stopReason,
    usage: {
      status: ['aborted', 'error'].includes(message.stopReason) ? 'not-final' : 'sdk-reported-on-completion',
      observedTokens,
      billingUsageStatus: 'unreconciled',
      billingAmount: null,
      pricebookStatus: 'not-configured',
    },
  };
}

export function probeOutcome({ contextRestored, completedWithoutErrors, cancellation, cancelRequested, responses, events }) {
  const messages = events.filter((event) => event.type === 'message_end' && event.usage);
  const expected = Math.max(responses.length, messages.length);
  let correlated = 0;
  for (let index = 0; index < expected; index += 1) {
    if (responses[index]?.requestId || messages[index]?.responseId) correlated += 1;
  }
  const responseCorrelation = {
    status: expected > 0 && correlated === expected ? 'available' : 'unavailable',
    expectedResponses: expected,
    correlatedResponses: correlated,
    headerRequestIds: responses.filter((response) => response.requestId).length,
    messageResponseIds: messages.filter((message) => message.responseId).length,
    meaning: 'Provider header request IDs and SDK response IDs remain distinct; downstream reconciliation is not proven.',
  };
  const cancelCasePass = cancelRequested ? cancellation === 'observed-aborted' : null;
  const basePass = contextRestored && completedWithoutErrors && cancelCasePass !== false;
  const outcome = !basePass ? 'failed' : responseCorrelation.status === 'available'
    ? 'pass-local-live-subset' : 'partial-correlation-unavailable';
  return { outcome, cancelCasePass, responseCorrelation, billingAmount: null, pricebookStatus: 'not-configured' };
}
