import { DurableObject } from 'cloudflare:workers';
import { ContainerProxy, getSandbox, Sandbox } from '@cloudflare/sandbox';
import { objectId, type ProbeTenant } from '../m0-cloud/auth.ts';
import { CAPABILITY_SECONDS, handlePreviewRequest, json, sameScope, validScope, type Grant, type PreviewOperations, type Scope } from './policy.ts';
import { accessStillAllowed, resolveBrowserAccess } from './lifecycle.ts';
import { browserAction, emptyBrowserState, type BrowserAction, type BrowserResult, type BrowserState } from './browser.ts';
import { PREVIEW_PORT, projectService } from './runtime.ts';

export { ContainerProxy };
export interface Env extends M0PreviewEnv {
  M0_CONTROL_ORIGIN?: string;
  M0_PREVIEW_ORIGIN?: string;
}
export class PreviewSandbox extends Sandbox<Env> {
  override enableInternet = false;
  override allowedHosts: string[] = [];
  override envVars = {};
  override sleepAfter = '60s';
}
PreviewSandbox.outbound = async () => new Response('M0 preview outbound denied', { status: 403 });

type RecordState = Grant & { status: 'starting' | 'active' | 'revoked' | 'expired' | 'failed' };
const STATE_KEY = 'preview-authority';
/** Worker-side authority. No project stdout, HTTP payload, or VM file can grant access. */
export class M0PreviewCoordinator extends DurableObject<Env> {
  busy = false;
  sockets = new Map<WebSocket, string>();
  async browser(input: BrowserAction): Promise<BrowserResult> {
    const result = browserAction({
      read: () => this.ctx.storage.kv.get<BrowserState>('browser-authority') ?? emptyBrowserState(),
      write: state => this.ctx.storage.kv.put('browser-authority', state),
      transaction: callback => this.ctx.storage.transactionSync(callback),
    }, input);
    await this.ctx.storage.sync();
    return result;
  }
  sessionRevoked(sid: string): boolean { return this.ctx.storage.kv.get<boolean>(`revoked-browser-session:${sid}`) === true; }
  accessAuthority() {
    return {
      nowSeconds: () => Math.floor(Date.now() / 1000),
      scopeActive: (scope: Scope) => this.scopeActive(scope),
      sessionRevoked: (sid: string) => this.sessionRevoked(sid),
      lookup: (scope: Scope, access: string) => this.env.PREVIEW.get(this.env.PREVIEW.idFromName('m0-browser-authority')).browser({ kind: 'access', access, scope }),
    };
  }
  authorizeAccess(scope: Scope, access: string): Promise<BrowserResult | null> {
    return resolveBrowserAccess(this.accessAuthority(), scope, access);
  }
  closeSession(sid: string) {
    // Persist first: an in-flight authorization RPC may carry a stale success.
    this.ctx.storage.kv.put(`revoked-browser-session:${sid}`, true);
    for (const [socket, owner] of this.sockets) if (owner === sid) {
      this.sockets.delete(socket);
      try { socket.close(1008, 'Browser session ended'); } catch {}
    }
  }
  sandbox(scope: Scope) {
    // Worker-generated 128-bit generation is unique; full ownership stays in the
    // authority record. Keep IDs below SDK's 63-character limit for every run ID.
    return getSandbox(this.env.PreviewSandbox, `m0-preview-${scope.tenant}-${scope.generation}`, { normalizeId: true, enableDefaultSession: false, keepAlive: false, sleepAfter: '60s' });
  }
  state(): RecordState | undefined { return this.ctx.storage.kv.get<RecordState>(STATE_KEY); }
  async save(value: RecordState) { this.ctx.storage.kv.put(STATE_KEY, value); await this.ctx.storage.sync(); }
  async start(run_id: string, tenant: ProbeTenant): Promise<Grant> {
    if (this.busy) throw new Error('preview-start-busy');
    this.busy = true;
    let next: RecordState | undefined;
    try {
      const previous = this.state();
      if (previous?.status === 'active' && previous.expires_at > Math.floor(Date.now() / 1000)) return previous;
      if (previous) await this.revoke(run_id, tenant);
      next = { run_id, tenant, preview_id: objectId(tenant, 'preview'), generation: crypto.randomUUID().replaceAll('-', ''), expires_at: 0, status: 'starting' };
      await this.save(next);
      const sandbox = this.sandbox(next);
      await sandbox.writeFile('/tmp/m0-preview.py', projectService(next.generation, this.env.M0_CONTROL_ORIGIN!, this.env.M0_PREVIEW_ORIGIN!));
      const process = await sandbox.startProcess('python3 /tmp/m0-preview.py', { autoCleanup: false });
      await process.waitForPort(PREVIEW_PORT, { path: '/api/state', status: 200, timeout: 20000 });
      // Revoke can interleave while the VM starts. It must never be undone here.
      const current = this.state();
      if (!current || !sameScope(current, next) || current.status !== 'starting') throw new Error('preview-start-revoked');
      next = { ...next, status: 'active', expires_at: Math.floor(Date.now() / 1000) + CAPABILITY_SECONDS };
      await this.save(next);
      await this.ctx.storage.setAlarm(next.expires_at * 1000);
      return next;
    } catch {
      if (next) {
        const current = this.state();
        if (current && sameScope(current, next) && current.status === 'starting') await this.save({ ...current, status: 'failed' });
        try { await this.sandbox(next).destroy(); } catch { /* status remains denied; cleanup must be retried */ }
      }
      throw new Error('preview-start-failed');
    } finally { this.busy = false; }
  }
  scopeActive(scope: Scope): boolean {
    const current = this.state();
    return !!current && sameScope(current, scope) && current.status === 'active' && current.expires_at > Math.floor(Date.now() / 1000);
  }
  async authorize(scope: Scope): Promise<boolean> { return this.scopeActive(scope); }
  async status(runId: string, tenant: ProbeTenant) {
    const current = this.state();
    return { operation: 'G0-T07', gate_decision: 'not_evaluated', run_id: runId, tenant, state: current ?? null, raw_preview_url: null, cloud_browser_matrix: 'not_run' };
  }
  async diagnostics(runId: string, tenant: ProbeTenant) {
    const current = this.state();
    if (!current || current.run_id !== runId || current.tenant !== tenant || !this.scopeActive(current)) throw new Error('active-preview-required');
    // SDK 0.12.9 reads current forwarding state; this never exposes a port.
    // Strip capability-bearing URLs inside the trusted DO before serialization.
    const exposed = await this.sandbox(current).getExposedPorts(new URL(this.env.M0_PREVIEW_ORIGIN!).hostname);
    if (!this.scopeActive(current)) throw new Error('preview-changed-during-diagnostics');
    return { operation: 'G0-T07', generation: current.generation, sdk_exposed_port_count: exposed.length, sdk_exposed_ports: exposed.map((entry: { port: number }) => entry.port), raw_preview_url: null, urls_redacted: true, control_redirect_origin: this.env.M0_CONTROL_ORIGIN, gate_decision: 'not_evaluated' };
  }
  closeSockets() {
    for (const socket of this.sockets.keys()) { try { socket.close(1008, 'Preview access ended'); } catch {} }
    this.sockets.clear();
  }
  async revoke(runId: string, tenant: ProbeTenant) {
    const current = this.state();
    if (!current) return { run_id: runId, tenant, access: 'revoked', cleanup: 'no-instance' };
    await this.save({ ...current, status: 'revoked' });
    this.closeSockets();
    try {
      await this.sandbox(current).destroy();
      return { run_id: runId, tenant, access: 'revoked', cleanup: 'destroy_acknowledged' };
    } catch { return { run_id: runId, tenant, access: 'revoked', cleanup: 'cleanup_not_confirmed' }; }
  }
  async alarm() {
    const current = this.state();
    // An old generation's alarm must not expire a new starting record (TTL=0).
    if (current?.status === 'active' && current.expires_at <= Math.floor(Date.now() / 1000)) {
      await this.save({ ...current, status: 'expired' });
      this.closeSockets();
      await this.sandbox(current).destroy();
    }
  }
  async proxy(scope: Scope, request: Request, access: string): Promise<Response> {
    const initialAccess = await this.authorizeAccess(scope, access);
    if (!accessStillAllowed(this.accessAuthority(), scope, initialAccess)) return json({ error: 'preview-revoked' }, 403);
    // SDK 0.12.9 public method. Never exposePort(), tunnels(), or proxyToSandbox().
    const sandbox = this.sandbox(scope);
    const websocket = new URL(request.url).pathname === '/ws';
    // Upgraded Response objects use the fetch transport, not arbitrary RPC
    // result serialization. SDK wsConnect uses stub.fetch + switchPort.
    const response = websocket ? await sandbox.wsConnect(request, PREVIEW_PORT) : await sandbox.containerFetch(request, PREVIEW_PORT);
    const browserAccess = await this.authorizeAccess(scope, access);
    if (!accessStillAllowed(this.accessAuthority(), scope, browserAccess)) {
      response.webSocket?.close(1008, 'Preview access ended');
      await response.body?.cancel();
      return json({ error: 'preview-revoked' }, 403);
    }
    if (!websocket) return response;
    const upstream = response.webSocket;
    if (response.status !== 101 || !upstream) { await response.body?.cancel(); return json({ error: 'preview-websocket-upgrade-failed' }, 502); }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    upstream.accept();
    server.accept();
    this.sockets.set(server, browserAccess.sid!);
    this.sockets.set(upstream, browserAccess.sid!);
    const expires = Math.min(this.state()!.expires_at, browserAccess.expires_at!) * 1000;
    let ended = false;
    const close = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      clearInterval(revalidation);
      for (const socket of [server, upstream]) { this.sockets.delete(socket); try { socket.close(1008, 'Preview access ended'); } catch {} }
    };
    const timer = setTimeout(close, Math.max(0, expires - Date.now()));
    let checking = false;
    const revalidation = setInterval(async () => {
      if (checking) return;
      checking = true;
      try { if (!await this.authorizeAccess(scope, access)) close(); }
      catch { close(); }
      finally { checking = false; }
    }, 1000);
    upstream.addEventListener('message', async (event: MessageEvent) => {
      try {
        const current = await this.authorizeAccess(scope, access);
        if (ended || !accessStillAllowed(this.accessAuthority(), scope, current)) { close(); return; }
        server.send(event.data);
      } catch { close(); }
    });
    // The fixed stream is read-only; client messages never reach the project.
    server.addEventListener('message', close);
    for (const socket of [server, upstream]) {
      socket.addEventListener('close', close);
      socket.addEventListener('error', close);
    }
    return new Response(null, { status: 101, webSocket: client, headers: { 'cache-control': 'no-store' } });
  }
  override async fetch(request: Request): Promise<Response> {
    // Only the trusted outer Worker has this binding; no external route forwards
    // arbitrary request headers here. Strip the Worker scope before VM access.
    try {
      const scope: Scope = JSON.parse(request.headers.get('x-m0-preview-scope') ?? 'null');
      if (!scope || !validScope(scope) || new URL(request.url).pathname !== '/ws') return json({ error: 'invalid-internal-preview-route' }, 403);
      const headers = new Headers(request.headers);
      const access = headers.get('x-m0-preview-access');
      headers.delete('x-m0-preview-scope');
      headers.delete('x-m0-preview-access');
      if (!access || !/^[a-f0-9]{64}$/.test(access)) return json({ error: 'invalid-internal-preview-access' }, 403);
      return await this.proxy(scope, new Request(request, { headers }), access);
    } catch { return json({ error: 'preview-websocket-failed' }, 502); }
  }
}

function operations(env: Env): PreviewOperations {
  const coordinator = (run: string, tenant: ProbeTenant) => env.PREVIEW.get(env.PREVIEW.idFromName(`m0-preview-${run}-${tenant}`));
  return {
    start: (run, tenant) => coordinator(run, tenant).start(run, tenant),
    revoke: (run, tenant) => coordinator(run, tenant).revoke(run, tenant),
    status: (run, tenant) => coordinator(run, tenant).status(run, tenant),
    diagnostics: (run, tenant) => coordinator(run, tenant).diagnostics(run, tenant),
    authorize: scope => coordinator(scope.run_id, scope.tenant).authorize(scope),
    browser: action => env.PREVIEW.get(env.PREVIEW.idFromName('m0-browser-authority')).browser(action),
    endSession: async (sid, scopes) => {
      await Promise.all(scopes.map(scope => coordinator(scope.run_id, scope.tenant).closeSession(sid)));
    },
    proxy: (scope, request, access) => {
      const target = coordinator(scope.run_id, scope.tenant);
      if (new URL(request.url).pathname !== '/ws') return target.proxy(scope, request, access);
      const headers = new Headers(request.headers);
      headers.set('x-m0-preview-scope', JSON.stringify(scope));
      headers.set('x-m0-preview-access', access);
      return target.fetch(new Request(request, { headers }));
    },
  };
}
export default {
  fetch(request: Request, env: Env): Promise<Response> { return handlePreviewRequest(request, env, operations(env)); },
};
