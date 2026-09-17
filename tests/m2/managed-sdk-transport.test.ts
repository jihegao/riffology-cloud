import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedSdkTransport, managedInputEnvelope, managedCorrelation} from '../../services/turn-runtime/managed-sdk-transport.ts';
import {attachBinding, type ExecutionBinding, type ExecutionBindingStore} from '../../services/turn-runtime/backend-contract.ts';
import {OfflineManagedAdapter, type ManagedInput} from '../../services/turn-runtime/managed-adapter.ts';
import {turnDigest} from '../../services/turn/protocol.ts';

async function fixture() {
  const identity = {scope: {tenantId: 'tenant', projectId: 'project', workspaceId: 'workspace', workspaceGeneration: 1}, sessionId: 'local-session', turnId: 'local-turn', dispatchId: 'local-dispatch', generation: 1};
  const input: ManagedInput = {identity, actor: {userId: 'user', authVersion: 1}, message: 'Synthetic task', base: {workspace: null, session: null}};
  let binding: ExecutionBinding | null = null, saved: ManagedInput | null = null;
  const calls: Array<{method: string; path: string; body: any; headers: Headers}> = [];
  let items: any[] = [], reservations = 0, failPost = false, spoof = false, duplicate = false, wrongArtifact = false, oversized = false, lostCreate = false;
  let session: any = null;
  const store: ExecutionBindingStore = {
    async read() {return binding;},
    async reserve(value) {if (binding) return {binding, created: false}; binding = value; return {binding, created: true};},
    async attach(_, remote) {binding = attachBinding(binding!, remote); return binding;},
  };
  const admission = {async reserve(_: ExecutionBinding, _op: string, value: ManagedInput) {assert.equal(reservations, 0); reservations++; saved = structuredClone(value);}, async readInput() {return saved;}};
  const transport = new ManagedSdkTransport({apiKey: 'test-placeholder', store, admission, clock: () => 5000, fetch: async (url, init) => {
    const path = new URL(String(url)).pathname, method = init?.method ?? 'GET', body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({method, path, body, headers: new Headers(init?.headers)});
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});
    const page = (data: unknown[]) => json({object: 'list', data, has_more: false, first_id: null, last_id: null});
    if (path === '/v1/agents/sessions' && method === 'POST') {assert.equal(reservations, 1); session = {id: 'remote-session', status: 'idle', metadata: body.metadata}; if (lostCreate) throw Error('reply-lost'); return json(session);}
    if (path === '/v1/agents/sessions' && method === 'GET') return page(session ? [session] : []);
    if (path.endsWith('/events') && method === 'POST') {
      assert.equal(binding!.remoteSessionId, 'remote-session');
      const text = body.events[0].input[0].content[0].text;
      items = [{type: 'message', role: 'user', turn_id: 'original-turn', content: [{type: 'input_text', text}]}];
      if (failPost) throw Error('reply-lost');
      return new Response(null, {status: 204});
    }
    if (path.endsWith('/items')) {
      let data = structuredClone(items);
      if (spoof) data[0].content[0].text += ' tampered';
      if (duplicate) data.push({...data[0], turn_id: 'second-turn'});
      data.push({type: 'message', role: 'user', turn_id: 'newest-unrelated', content: [{type: 'input_text', text: 'unrelated'}]});
      data.push({id: 'output', type: 'message', role: 'assistant', status: 'completed', turn_id: 'original-turn', content: [{type: 'output_text', text: 'actual output'}]});
      return page(data);
    }
    if (path.endsWith('/turns/original-turn')) return json({id: 'original-turn', session_id: 'remote-session', subagent_id: null, status: 'completed', completed_at: 4, usage: null});
    if (path.endsWith('/artifacts/artifact/content')) return new Response(new Uint8Array(oversized ? 5 : 4));
    if (path.endsWith('/artifacts/artifact')) return json({id: 'artifact', session_id: 'remote-session', turn_id: wrongArtifact ? 'foreign-turn' : 'original-turn', path: '/workspace/outputs/project.tar', size_bytes: 4});
    if (path.endsWith('/remote-session') && method === 'DELETE') return json({id: 'remote-session', deleted: true});
    if (path.endsWith('/remote-session')) return json(session);
    throw Error(`unexpected-test-request:${method}:${path}`);
  }});
  const adapter = () => new OfflineManagedAdapter({mode: 'offline', store, transport, clock: () => 5000});
  return {input, store, transport, adapter, calls, get binding() {return binding!;}, get reservations() {return reservations;}, losePost() {failPost = true;}, loseCreate() {lostCreate = true;}, spoof() {spoof = true;}, duplicate() {duplicate = true;}, wrongArtifact() {wrongArtifact = true;}, oversized() {oversized = true;}, foreignScope() {session.metadata.riffology_scope = 'foreign';}};
}
test('real SDK sends pinned hosted configuration and exact input idempotency after durable reservation', async () => {
  const f = await fixture(), result = await f.adapter().accept(f.input);
  assert.equal(result.execution, 'completed'); assert.equal(result.usage.status, 'unknown'); assert.equal(result.nativeFence, null);
  const create = f.calls.find(c => c.method === 'POST' && c.path.endsWith('/sessions'))!;
  assert.equal(create.body.agent.model, 'gpt-5.6-luna'); assert.deepEqual(create.body.agent.multi_agent, {enabled: false});
  assert.equal(create.body.environment.network.access, 'disabled'); assert.equal(create.body.input, undefined);
  assert.equal(create.headers.get('openai-beta'), 'agents=v1');
  const post = f.calls.find(c => c.path.endsWith('/events'))!;
  assert.equal(post.headers.get('idempotency-key'), await managedCorrelation(f.binding));
  assert.equal(post.body.events[0].input[0].content[0].text, await managedInputEnvelope(f.binding, f.input.message));
  const again = await f.adapter().observe(f.input.identity); assert.deepEqual(again.events, result.events);
});
test('lost input acknowledgement reconciles original user item without SDK retry or resubmission', async () => {
  const f = await fixture(); f.losePost();
  assert.equal((await f.adapter().accept(f.input)).execution, 'unknown');
  const result = await f.adapter().accept(f.input); assert.equal(result.execution, 'completed');
  assert.equal(f.binding.remoteTurnId, 'original-turn'); assert.equal(f.reservations, 1);
  assert.equal(f.calls.filter(c => c.path.endsWith('/events')).length, 1);
});
test('lost Session creation recovers the idle original but does not invent or send a missing Turn', async () => {
  const f = await fixture(); f.loseCreate();
  assert.equal((await f.adapter().accept(f.input)).execution, 'unknown');
  assert.equal((await f.adapter().observe(f.input.identity)).execution, 'unknown');
  assert.equal(f.binding.remoteSessionId, 'remote-session'); assert.equal(f.binding.remoteTurnId, null);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal((await f.adapter().deleteSession(f.input.identity)).status, 'remote-deleted');
});
test('correlation refuses altered user payload and ambiguous matching Turns', async () => {
  const f = await fixture(); f.losePost(); await f.adapter().accept(f.input); f.spoof();
  assert.equal(await f.transport.lookupOriginal(f.binding), null);
  const g = await fixture(); g.losePost(); await g.adapter().accept(g.input); g.duplicate();
  await assert.rejects(g.transport.lookupOriginal(g.binding), /original-turn-ambiguous/);
});
test('foreign Session and artifact Turn fail closed; downloaded bytes enforce metadata size', async () => {
  const f = await fixture(); await f.adapter().accept(f.input); f.wrongArtifact();
  await assert.rejects(f.transport.download(f.binding, 'artifact'), /scope-or-size-denied/);
  assert.equal(f.calls.filter(c => c.path.endsWith('/content')).length, 0);
  f.foreignScope(); await assert.rejects(f.transport.retrieve(f.binding), /session-scope-denied/);
  const g = await fixture(); await g.adapter().accept(g.input); g.oversized();
  await assert.rejects(g.transport.download(g.binding, 'artifact'), /size-mismatch/);
});
test('cancel after canonical completion sends no Session-wide cancellation', async () => {
  const f = await fixture(); await f.adapter().accept(f.input); await f.transport.cancel(f.binding);
  assert.equal(f.calls.filter(c => c.path.endsWith('/events')).length, 1);
});
