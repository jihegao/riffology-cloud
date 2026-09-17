import OpenAI from 'openai';
import type { AgentSessionItem } from 'openai/resources/beta/agents/agents';
import type { ExecutionBinding, ExecutionBindingStore } from './backend-contract.ts';
import type { ManagedInput, ManagedReceipt, ManagedTransport } from './managed-adapter.ts';
import { turnDigest } from '../turn/protocol.ts';

/** Admission is a durable, single-writer authority. A reservation is consumed
 * before either hosted provisioning or input submission; retry is never implicit.
 * This boundary cannot promise a provider-enforced token or dollar ceiling. */
export interface ManagedPaidAdmission {
  reserve(binding: ExecutionBinding, operation: 'create' | 'continue', input: ManagedInput): Promise<void>;
  readInput(binding: ExecutionBinding): Promise<ManagedInput | null>;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const MAX_ITEMS = 1024, MAX_SESSIONS = 256, MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const instructions = 'Use only the supplied synthetic task. Do not use network access, subagents, or credentials. Write requested deliverables to /workspace/outputs. Report failures accurately.';

export async function managedCorrelation(binding: ExecutionBinding) {
  return turnDigest({ identity: binding.identity, inputSha256: binding.inputSha256 });
}
async function sessionScope(binding: ExecutionBinding) {
  const {scope, sessionId, generation} = binding.identity;
  return turnDigest({scope, sessionId, generation});
}
export async function managedInputEnvelope(binding: ExecutionBinding, message: string) {
  return `[riffology-input-v1:${await managedCorrelation(binding)}]\n${message}`;
}

/** Real public SDK transport, deliberately not assembled into product routing.
 * Reconciliation matches the exact persisted user input marker, never the
 * newest Turn or the first Turn absent from a prior listing. */
export class ManagedSdkTransport implements ManagedTransport {
  readonly client: OpenAI;
  readonly store: ExecutionBindingStore;
  readonly admission: ManagedPaidAdmission;
  readonly clock: () => number;
  constructor(input: {apiKey: string; store: ExecutionBindingStore; admission: ManagedPaidAdmission; fetch?: typeof fetch; clock?: () => number}) {
    if (!input.apiKey || !input.admission?.reserve || !input.admission.readInput) throw Error('managed-credentials-and-admission-required');
    this.client = new OpenAI({apiKey: input.apiKey, baseURL: 'https://api.openai.com/v1', maxRetries: 0, timeout: 30_000, fetch: input.fetch});
    this.store = input.store; this.admission = input.admission; this.clock = input.clock ?? Date.now;
  }
  private async inputBinding(input: ManagedInput) {
    const binding = await this.store.read(input.identity);
    if (!binding || binding.backend !== 'managed-agents' || binding.inputSha256 !== await turnDigest(input)) throw Error('managed-input-binding-conflict');
    return binding;
  }
  private async verifySession(binding: ExecutionBinding, sessionId: string) {
    const session = await this.client.beta.agents.sessions.retrieve(sessionId);
    if (session.id !== sessionId || session.metadata.riffology_scope !== await sessionScope(binding)) throw Error('managed-session-scope-denied');
    return session;
  }
  private async items(sessionId: string): Promise<AgentSessionItem[]> {
    const items: AgentSessionItem[] = [];
    for await (const item of this.client.beta.agents.sessions.items.list(sessionId, {order: 'asc', limit: 100})) {
      if (items.length >= MAX_ITEMS) throw Error('managed-item-scan-limit');
      items.push(item);
    }
    return items;
  }
  private async submit(input: ManagedInput, binding: ExecutionBinding, sessionId: string) {
    await this.client.beta.agents.sessions.events.create(sessionId, {
      'Idempotency-Key': await managedCorrelation(binding),
      events: [{type: 'agent.session.input.message', input: [{role: 'user', content: [{type: 'input_text', text: await managedInputEnvelope(binding, input.message)}]}]}],
    });
    const receipt = await this.lookupOriginal({...binding, remoteSessionId: sessionId});
    if (!receipt) throw Error('managed-input-delivery-unresolved');
    return receipt;
  }
  async create(input: ManagedInput) {
    const binding = await this.inputBinding(input);
    if (binding.remoteSessionId !== null || binding.remoteTurnId !== null) throw Error('managed-create-already-bound');
    await this.admission.reserve(binding, 'create', input);
    // Provision first, durably bind before sending model input. If this reply is
    // lost, scope+creation metadata can recover the idle Session, but never send
    // the missing input automatically.
    const session = await this.client.beta.agents.sessions.create({
      agent: {model: 'gpt-5.6-luna', instructions, multi_agent: {enabled: false}, reasoning: {effort: 'low'}, text: {verbosity: 'low'}, service_tier: 'default'},
      environment: {type: 'openai_hosted', network: {access: 'disabled'}},
      metadata: {riffology_scope: await sessionScope(binding), riffology_creation: await managedCorrelation(binding)},
      stream: false,
    });
    if (session.metadata.riffology_scope !== await sessionScope(binding) || session.metadata.riffology_creation !== await managedCorrelation(binding)) throw Error('managed-session-scope-denied');
    await this.store.attach(binding.identity, {sessionId: session.id, turnId: null});
    return this.submit(input, binding, session.id);
  }
  async continue(input: ManagedInput, sessionId: string) {
    const binding = await this.inputBinding(input);
    if (binding.remoteSessionId !== sessionId || binding.remoteTurnId !== null) throw Error('managed-continuation-binding-conflict');
    const session = await this.verifySession(binding, sessionId);
    if (session.status !== 'idle') throw Error('managed-session-not-idle');
    await this.admission.reserve(binding, 'continue', input);
    return this.submit(input, binding, sessionId);
  }
  async lookupOriginal(binding: ExecutionBinding): Promise<ManagedReceipt | null> {
    const input = await this.admission.readInput(binding);
    if (!input || await turnDigest(input) !== binding.inputSha256) throw Error('managed-original-input-unavailable');
    let sessionId = binding.remoteSessionId;
    if (!sessionId) {
      const scope = await sessionScope(binding), correlation = await managedCorrelation(binding);
      let count = 0;
      const matches: string[] = [];
      for await (const session of this.client.beta.agents.sessions.list({limit: 100, order: 'desc'})) {
        if (++count > MAX_SESSIONS) throw Error('managed-session-scan-limit');
        if (session.metadata.riffology_scope === scope && session.metadata.riffology_creation === correlation) matches.push(session.id);
      }
      if (matches.length > 1) throw Error('managed-original-session-ambiguous');
      if (!matches.length) return null;
      sessionId = matches[0];
      await this.store.attach(binding.identity, {sessionId, turnId: null});
    }
    await this.verifySession(binding, sessionId);
    const original = await managedInputEnvelope(binding, input.message);
    const turns = new Set<string>();
    for (const item of await this.items(sessionId)) {
      if (item.type === 'message' && item.role === 'user' && item.content.length === 1 && item.content[0].type === 'input_text' && item.content[0].text === original) turns.add(item.turn_id);
    }
    if (turns.size > 1) throw Error('managed-original-turn-ambiguous');
    if (!turns.size) return null;
    const turnId = [...turns][0];
    if (binding.remoteTurnId !== null && binding.remoteTurnId !== turnId) throw Error('managed-original-turn-conflict');
    const attached = await this.store.attach(binding.identity, {sessionId, turnId});
    return this.retrieve(attached);
  }
  async retrieve(binding: ExecutionBinding): Promise<ManagedReceipt> {
    if (!binding.remoteSessionId || !binding.remoteTurnId) throw Error('managed-original-reference-required');
    await this.verifySession(binding, binding.remoteSessionId);
    const turn = await this.client.beta.agents.sessions.turns.retrieve(binding.remoteTurnId, {session_id: binding.remoteSessionId});
    if (turn.id !== binding.remoteTurnId || turn.session_id !== binding.remoteSessionId || turn.subagent_id !== null) throw Error('managed-turn-scope-denied');
    if (!['queued', 'in_progress', 'waiting', ...TERMINAL].includes(turn.status)) throw Error('managed-turn-status-invalid');
    const observedAt = this.clock(), phase = TERMINAL.has(turn.status) ? turn.status as 'completed' | 'failed' | 'cancelled' : 'running';
    const events: ManagedReceipt['events'] = [];
    if (phase !== 'running') {
      if (!Number.isSafeInteger(turn.completed_at) || turn.completed_at! * 1000 > observedAt) throw Error('managed-turn-time-invalid');
      // Canonical completed items survive disconnects. No inferred tool events.
      for (const item of await this.items(binding.remoteSessionId)) {
        if (item.type !== 'message' || item.role !== 'assistant' || item.turn_id !== turn.id || item.status !== 'completed' || !item.id) continue;
        const text = item.content.filter(part => part.type === 'output_text').map(part => part.text).join('');
        if (text) events.push({id: item.id, type: 'agent.session.turn.output_text.done', at: Math.max(binding.reservedAt, turn.completed_at! * 1000), payload: {text}});
      }
    }
    return {schemaVersion: 1, identity: binding.identity, sessionId: turn.session_id, turnId: turn.id, phase, observedAt, usage: turn.usage, events};
  }
  async cancel(binding: ExecutionBinding) {
    const current = await this.retrieve(binding);
    if (TERMINAL.has(current.phase)) return;
    // This API cancels the Session's active Turn. Reject if another root Turn
    // exists instead of accidentally cancelling work outside this identity.
    let count = 0;
    for await (const turn of this.client.beta.agents.sessions.turns.list(current.sessionId, {limit: 100})) {
      if (++count > MAX_ITEMS) throw Error('managed-turn-scan-limit');
      if (!TERMINAL.has(turn.status) && turn.id !== current.turnId) throw Error('managed-cancel-scope-denied');
    }
    await this.client.beta.agents.sessions.events.create(current.sessionId, {events: [{type: 'agent.session.input.cancel'}]});
  }
  async deleteSession(binding: ExecutionBinding) {
    if (!binding.remoteSessionId) throw Error('managed-original-reference-required');
    const session = await this.verifySession(binding, binding.remoteSessionId);
    if (session.status !== 'idle' && session.status !== 'failed') throw Error('managed-delete-not-terminal');
    const receipt = await this.client.beta.agents.sessions.delete(binding.remoteSessionId);
    if (receipt.id !== binding.remoteSessionId || receipt.deleted !== true) throw Error('managed-delete-unconfirmed');
    return {sessionId: receipt.id, deleted: true, observedAt: this.clock()};
  }
  async download(binding: ExecutionBinding, artifactId: string) {
    if (!binding.remoteSessionId || !binding.remoteTurnId) throw Error('managed-original-reference-required');
    await this.verifySession(binding, binding.remoteSessionId);
    const params = {session_id: binding.remoteSessionId};
    const artifact = await this.client.beta.agents.sessions.artifacts.retrieve(artifactId, params);
    if (artifact.id !== artifactId || artifact.session_id !== binding.remoteSessionId || artifact.turn_id !== binding.remoteTurnId || !artifact.path.startsWith('/workspace/outputs/') || !Number.isSafeInteger(artifact.size_bytes) || artifact.size_bytes < 1 || artifact.size_bytes > MAX_ARTIFACT_BYTES) throw Error('managed-artifact-scope-or-size-denied');
    const response = await this.client.beta.agents.sessions.artifacts.content(artifactId, params, {signal: AbortSignal.timeout(30_000)});
    if (!response.body) throw Error('managed-artifact-body-missing');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength; if (size > artifact.size_bytes) throw Error('managed-artifact-size-mismatch'); chunks.push(value); }
    } finally { await reader.cancel(); }
    if (size !== artifact.size_bytes) throw Error('managed-artifact-size-mismatch');
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
  }
}
