import { DurableObject } from 'cloudflare:workers';
import { hasProbeAuthorization, isRunId } from '../m0-cloud/auth.ts';
import { saveCheckpoint, restoreCheckpoint, sha256, type Authority, type Receipt, type Entry } from './checkpoint.ts';
import { R2Blobs, currentCheckpoint, commitCheckpoint } from './adapters.ts';
import { StorageFaultProbe, StorageFaultConflict, parseStorageFaultRoute, hasEmptyStorageFaultBody, storageEventStream, type StorageFaultAction } from './faults.ts';


export class M0StorageCoordinator extends DurableObject<M0StorageEnv> implements Authority {
  busy = false;
  faultBusy = false;
  instanceNonce = crypto.randomUUID();
  faultProbe() { return new StorageFaultProbe(this.ctx, this.env.CHECKPOINTS, this.instanceNonce); }
  async faultAction(action: StorageFaultAction) {
    if (this.faultBusy) return { httpStatus: 409 as const, error: 'fault-action-in-progress' };
    this.faultBusy = true;
    try { return await this.faultProbe().action(action); }
    catch (error) { if (error instanceof StorageFaultConflict) return { httpStatus: 409 as const, error: error.message }; throw error; }
    finally { this.faultBusy = false; }
  }
  faultStatus() { return this.faultProbe().status(); }
  faultEvents(after: number) { return storageEventStream(cursor => this.faultProbe().events(cursor), after); }
  async current() { return currentCheckpoint(this.ctx.storage); }
  async commit(input: { revision: string; parent: string | null; generation: number }): Promise<Receipt> {
    return commitCheckpoint(this.ctx.storage, input);
  }
  async probe() {
    if (this.busy || this.ctx.storage.kv.get('started')) return { error: 'run-already-started', rerun: 'use a new run ID' };
    this.busy = true;
    this.ctx.storage.kv.put('started', true);
    await this.ctx.storage.sync();
    try {
      const blobs = new R2Blobs(this.env.CHECKPOINTS, `m0/${this.ctx.id.toString()}`);
      const encode = (s: string) => new TextEncoder().encode(s);
      const session = encode('synthetic trusted Pi session; no user content');
      let entries: Entry[] = [{ path: 'model', kind: 'directory', mode: 0o755 }, { path: 'model/a.py', kind: 'file', mode: 0o644, bytes: encode('print(1)') }];
      const initial = await saveCheckpoint({ entries, session, generation: 1, parent: null, blobs, authority: this });
      const state = await restoreCheckpoint(blobs, initial.revision);
      const restorationVerified = state.entries.length === 2 && state.entries[1]?.kind === 'file'
        && await sha256(state.entries[1].bytes) === await sha256(encode('print(1)'))
        && await sha256(state.session) === await sha256(session);
      const observations: Record<string, boolean> = { restorationVerified };
      entries = [{ path: 'renamed.py', kind: 'file', mode: 0o755, bytes: encode('print(2)') }];
      const next = { entries, session, generation: 1, parent: initial.revision, blobs, authority: this };
      blobs.failOnPut = blobs.putCount + 2;
      let uploadFailed = false;
      try { await saveCheckpoint(next); } catch (error) { uploadFailed = error instanceof Error && error.message === 'injected-upload-interruption'; }
      observations.interruptedUploadKeptPointer = uploadFailed && (await this.current())?.revision === initial.revision;
      blobs.failOnPut = 0;
      const beforeCommit: Authority = { current: () => this.current(), commit: async () => { throw new Error('injected-precommit-interruption'); } };
      let precommitFailed = false;
      try { await saveCheckpoint({ ...next, authority: beforeCommit }); } catch (error) { precommitFailed = error instanceof Error && error.message === 'injected-precommit-interruption'; }
      observations.precommitKeptPointer = precommitFailed && (await this.current())?.revision === initial.revision;
      const lostResponse: Authority = { current: () => this.current(), commit: async input => { await this.commit(input); throw new Error('injected-lost-response'); } };
      let responseLost = false;
      try { await saveCheckpoint({ ...next, authority: lostResponse }); } catch (error) { responseLost = error instanceof Error && error.message === 'injected-lost-response'; }
      const replay = await saveCheckpoint(next);
      const events = Array.from(this.ctx.storage.kv.list<Receipt>({ prefix: 'events/' }), ([, receipt]) => receipt);
      observations.lostResponseOneReceipt = responseLost && replay.sequence === 2 && events.length === 2;
      const restored = await restoreCheckpoint(blobs, replay.revision);
      observations.renameModeAndDeletion = restored.entries.length === 1 && restored.entries[0]?.path === 'renamed.py' && restored.entries[0].mode === 0o755;
      const competing = ['writer-c.py', 'writer-d.py'].map(path => saveCheckpoint({
        entries: [{ path, kind: 'file', mode: 0o644, bytes: encode(path) }],
        session, generation: 1, parent: replay.revision, blobs, authority: this,
      }));
      const competingResults = await Promise.allSettled(competing);
      const winners = competingResults.filter(r => r.status === 'fulfilled');
      const losers = competingResults.filter(r => r.status === 'rejected');
      const winner = winners[0];
      const eventCount = Array.from(this.ctx.storage.kv.list({ prefix: 'events/' })).length;
      observations.concurrentParentOneWinner = winners.length === 1 && losers.length === 1
        && losers[0]?.reason?.message === 'parent-conflict' && eventCount === 3
        && winner?.status === 'fulfilled' && (await this.current())?.revision === winner.value.revision;
      const beforeMetadata = await this.current();
      let metadataFailed = false;
      try {
        await commitCheckpoint(this.ctx.storage, { revision: 'e'.repeat(64), parent: beforeMetadata!.revision, generation: 1 }, receipt => {
          this.ctx.storage.kv.put('synthetic-turn-metadata', { revision: receipt.revision });
          throw new Error('injected-metadata-interruption');
        });
      } catch (error) { metadataFailed = error instanceof Error && error.message === 'injected-metadata-interruption'; }
      observations.metadataFailureRollsBackReceiptAndEvent = metadataFailed
        && (await this.current())?.revision === beforeMetadata!.revision
        && this.ctx.storage.kv.get('synthetic-turn-metadata') === undefined
        && Array.from(this.ctx.storage.kv.list({ prefix: 'events/' })).length === 3;
      await commitCheckpoint(this.ctx.storage, { revision: beforeMetadata!.revision, parent: replay.revision, generation: 1 }, receipt => {
        this.ctx.storage.kv.put('synthetic-turn-metadata', { revision: receipt.revision, sequence: receipt.sequence });
        return undefined;
      });
      observations.metadataReplayKeepsSingleReceipt = JSON.stringify(this.ctx.storage.kv.get('synthetic-turn-metadata'))
        === JSON.stringify({ revision: beforeMetadata!.revision, sequence: 3 })
        && Array.from(this.ctx.storage.kv.list({ prefix: 'events/' })).length === 3;
      this.ctx.storage.kv.put('generation', 2);
      let staleRejected = false;
      try { await saveCheckpoint({ ...next, parent: replay.revision }); } catch (error) { staleRejected = error instanceof Error && error.message === 'stale-generation'; }
      observations.staleGenerationRejected = staleRejected;
      const report = {
        protocol: this.env.PROTOCOL_VERSION, observations, primitiveChecksPassed: Object.values(observations).every(Boolean),
        receipt: await this.current(), events: Array.from(this.ctx.storage.kv.list<Receipt>({ prefix: 'events/' }), ([, receipt]) => receipt),
        gateStatus: 'needs-review',
        limits: ['synthetic entries; no filesystem CRUD', 'injected failures; no VM kill', 'no browser reconnect', 'no real Pi Session', 'no release or G0 acceptance'],
      };
      this.ctx.storage.kv.put('report', report);
      await this.ctx.storage.sync();
      return report;
    } finally { this.busy = false; }
  }
  report() { return this.ctx.storage.kv.get('report') ?? { error: 'report-unavailable' }; }
}
export default {
  async fetch(request: Request, env: M0StorageEnv): Promise<Response> {
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    if (!await hasProbeAuthorization(request, env.M0_PROBE_TOKEN)) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
    if (env.ENVIRONMENT !== 'staging' || env.PROTOCOL_VERSION !== 'm0-v1') return Response.json({ error: 'probe-environment-disabled' }, { status: 503, headers });
    const faultRoute = parseStorageFaultRoute(request);
    if (faultRoute) {
      if (!await hasEmptyStorageFaultBody(request)) return Response.json({ error: 'probe-body-not-empty-or-unreadable' }, { status: 400, headers });
      const stub = env.STORAGE.getByName(`m0-storage-faults-${faultRoute.runId}`);
      try {
        if (faultRoute.action === 'events') return await stub.faultEvents(faultRoute.cursor);
        const result = faultRoute.action === 'status' ? await stub.faultStatus() : await stub.faultAction(faultRoute.action);
        return Response.json(result, { status: 'httpStatus' in result ? result.httpStatus : 200, headers });
      } catch {
        return Response.json({ error: 'fault-operation-interrupted', next: 'read status; never blindly repeat a mutation', gateStatus: 'needs-review' }, { status: 500, headers });
      }
    }
    const match = new URL(request.url).pathname.match(/^\/probe\/([^/]+)\/(run|report)$/);
    if (!match || !isRunId(match[1])) return Response.json({ error: 'not-found' }, { status: 404, headers });
    const action = match[2];
    if (request.method !== (action === 'run' ? 'POST' : 'GET')) return Response.json({ error: 'method-not-allowed' }, { status: 405, headers });
    try {
      const stub = env.STORAGE.getByName(`m0-storage-${match[1]}`);
      return Response.json(action === 'run' ? await stub.probe() : await stub.report(), { headers });
    } catch {
      return Response.json({ error: 'probe-failed', conclusion: 'no gate accepted; inspect scoped runtime logs' }, { status: 500, headers });
    }
  },
} satisfies ExportedHandler<M0StorageEnv>;
