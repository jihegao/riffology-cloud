import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createControlledPiSession } from '../../services/runtime/controlled-pi.mjs';
import { assistantEvidence, correlationId, probeOutcome } from '../../services/runtime/pi-probe-evidence.mjs';

// An explicit opt-in prevents `node scripts/m0/pi-live-probe.mjs` from making
// paid calls. The caller supplies an approved credential through the environment.
if (!process.argv.includes('--live') || process.env.RIFFOLOGY_PI_PROBE_LIVE !== '1') {
  console.error('No request sent. Use --live and RIFFOLOGY_PI_PROBE_LIVE=1 with approved injected provider settings.');
  process.exitCode = 2;
} else {
  const required = ['RIFFOLOGY_PI_PROVIDER', 'RIFFOLOGY_PI_MODEL', 'RIFFOLOGY_PI_API_KEY'];
  for (const name of required) {
    if (!process.env[name]?.trim()) throw new Error(`Missing ${name}; no global Pi configuration is read`);
  }
  const provider = process.env.RIFFOLOGY_PI_PROVIDER;
  const id = process.env.RIFFOLOGY_PI_MODEL;
  const baseUrl = process.env.RIFFOLOGY_PI_BASE_URL;
  const api = process.env.RIFFOLOGY_PI_API ?? 'openai-completions';
  const trustedCwd = await mkdtemp(join(tmpdir(), 'riffology-pi-live-'));
  const marker = `m0-${randomUUID().slice(0, 8)}`;
  const events = [];
  const responses = [];
  const hosts = [];
  const options = {
    trustedCwd,
    scope: { tenantId: 'm0-authorized-probe', projectId: 'm0-pi-host', sessionId: randomUUID() },
    allowedModels: [{ provider, id }], selectedModel: { provider, id },
    ...(baseUrl ? { providerDefinitions: [{ provider, config: {
      api, baseUrl,
      models: [{ id, name: id, reasoning: false, input: ['text'],
        // Accounting values here are unknown, so the evidence reports provider
        // token usage only. This is not a customer billing rate configuration.
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16384, maxTokens: 256 }],
    } }] } : {}),
    resolveCredential: async () => process.env.RIFFOLOGY_PI_API_KEY,
    systemPrompt: 'You are a platform API verification agent. Reply briefly in plain text. Do not use tools.',
    onProviderResponse: ({ status, headers }) => {
      const values = new Headers(headers);
      responses.push({ status, requestId: correlationId(values.get('x-request-id') ?? values.get('request-id') ?? values.get('x-amzn-requestid')) });
    },
  };
  const attach = (host) => {
    hosts.push(host);
    host.subscribe((event) => {
      const record = { type: event.type };
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        Object.assign(record, assistantEvidence(event.message));
      }
      events.push(record);
    });
    return host;
  };
    async function boundedPrompt(host, prompt) {
    const timer = setTimeout(() => { void host.cancel().catch(() => {}); }, 30000);
    try { await host.prompt(prompt); }
    finally { clearTimeout(timer); }
  }
  try {
    const host = attach(await createControlledPiSession(options));
    await boundedPrompt(host, `Remember this marker: ${marker}. Reply exactly PI_M0_OK.`);
    const snapshot = host.snapshot();
    await host.dispose();
    const restored = attach(await createControlledPiSession({ ...options, snapshot }));
    await boundedPrompt(restored, 'Reply with only the marker from the earlier message.');
    const replies = restored.inspect().messages.filter((message) => message.role === 'assistant');
    const lastText = replies.at(-1)?.content.filter((part) => part.type === 'text').map((part) => part.text).join('') ?? '';
    const contextRestored = lastText.includes(marker);
    const errors = replies.filter((message) => ['error', 'aborted'].includes(message.stopReason));
    let cancellation = 'not-requested';
    if (process.argv.includes('--cancel')) {
      let cancelled = false;
      const unsubscribe = restored.subscribe((event) => {
        if (event.type === 'message_update' && !cancelled) { cancelled = true; void restored.cancel().catch(() => {}); }
      });
      await boundedPrompt(restored, 'Count all integers from 1 to 10000, one per line.');
      unsubscribe();
      cancellation = restored.inspect().messages.at(-1)?.stopReason === 'aborted' ? 'observed-aborted' : 'provider-completed-before-cancel';
    }
    const assessment = probeOutcome({ contextRestored, completedWithoutErrors: errors.length === 0,
      cancellation, cancelRequested: process.argv.includes('--cancel'), responses, events });
    console.log(JSON.stringify({
      probe: 'G0-T01-local-live-provider', sdkVersion: '0.85.0', provider, model: id,
      environment: 'local-trusted-pi-host', paidRequestOptIn: true,
      contextRestored, cancellation, responses, events,
      ...assessment,
      cloudGatePassed: false,
    }, null, 2));
    if (assessment.outcome !== 'pass-local-live-subset') process.exitCode = 1;
  } finally {
    for (const host of hosts) await host.dispose();
    await rm(trustedCwd, { recursive: true, force: true });
  }
}
