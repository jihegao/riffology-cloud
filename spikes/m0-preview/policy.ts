import { ACCESS_COOKIE, CHALLENGE_COOKIE, SESSION_COOKIE, type BrowserAction, type BrowserResult } from './browser.ts';
import { hasProbeAuthorization, isRunId, isTenant, objectId, type ProbeTenant } from '../m0-cloud/auth.ts';

export const CAPABILITY_SECONDS = 120;
export const COOKIE_NAME = ACCESS_COOKIE;
const encoder = new TextEncoder();
const GENERATION = /^[a-f0-9]{32}$/;
const PATHS = new Set(['/', '/app.js', '/api/state', '/api/headers', '/ws', '/redirect-safe', '/redirect-external', '/redirect-control', '/set-cookie']);
export type Scope = { run_id: string; tenant: ProbeTenant; preview_id: string; generation: string };
export type Grant = Scope & { expires_at: number };
export type PreviewConfig = { ENVIRONMENT?: string; PROTOCOL_VERSION?: string; M0_PROBE_TOKEN?: string; M0_PREVIEW_SIGNING_KEY?: string; M0_CONTROL_ORIGIN?: string; M0_PREVIEW_ORIGIN?: string };
export interface PreviewOperations {
  start(runId: string, tenant: ProbeTenant): Promise<Grant>;
  revoke(runId: string, tenant: ProbeTenant): Promise<unknown>;
  status(runId: string, tenant: ProbeTenant): Promise<unknown>;
  diagnostics(runId: string, tenant: ProbeTenant): Promise<unknown>;
  authorize(scope: Scope): Promise<boolean>;
  proxy(scope: Scope, request: Request, access: string): Promise<Response>;
  browser(action: BrowserAction): Promise<BrowserResult>;
  endSession(sid: string, scopes: Scope[]): Promise<void>;
}
export function previewPrefix(scope: Scope): string {
  return `/p/${scope.run_id}/${scope.tenant}/${scope.preview_id}/${scope.generation}`;
}
export function sameScope(left: Scope, right: Scope): boolean {
  return left.run_id === right.run_id && left.tenant === right.tenant && left.preview_id === right.preview_id && left.generation === right.generation;
}
export function validScope(value: Scope): boolean {
  return isRunId(value.run_id) && isTenant(value.tenant) && value.preview_id === objectId(value.tenant, 'preview') && GENERATION.test(value.generation);
}
function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('encoding');
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const bytes = Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), c => c.charCodeAt(0));
  if (base64(bytes) !== value) throw new Error('noncanonical');
  return bytes;
}
async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(`riffology-m0-preview-v1\0${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signCookie(secret: string, name: string, id: string): Promise<string> {
  return `${id}.${base64(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(`${name}\0${id}`))))}`;
}
export async function readCookie(request: Request, secret: string, name: string): Promise<string | null> {
  const matches = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  try {
    const [id, signature, extra] = matches[0]!.slice(name.length + 1).split('.');
    if (!id || !/^[a-f0-9]{64}$/.test(id) || !signature || extra !== undefined) return null;
    return await crypto.subtle.verify('HMAC', await key(secret), decode(signature), encoder.encode(`${name}\0${id}`)) ? id : null;
  } catch { return null; }
}
function cookie(name: string, value: string, expires: number, now: number): string {
  return `${name}=${value}; Path=/; Max-Age=${Math.max(0, expires - Math.floor(now / 1000))}; Secure; HttpOnly; SameSite=Strict`;
}
export function previewOrigin(base: string, scope: Scope): string {
  const url = new URL(base);
  url.hostname = `p-${scope.generation}.${url.hostname}`;
  return url.origin;
}
export function originAllowed(request: Request, previewOrigin: string, webSocket: boolean): boolean {
  const origin = request.headers.get('origin');
  return (origin === null && !webSocket) || origin === previewOrigin;
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } });
}
async function emptyBody(request: Request): Promise<boolean> {
  if (request.body === null) return true;
  const length = request.headers.get('content-length');
  if (length && length !== '0') return false;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Workerd represents some zero-length POSTs as an empty stream.
    const first = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('body-timeout')), 1000); })]);
    return first.done === true;
  } catch { return false; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}
function configuration(config: PreviewConfig): { control: string; preview: string; secret: string } | null {
  try {
    const control = new URL(config.M0_CONTROL_ORIGIN!);
    const preview = new URL(config.M0_PREVIEW_ORIGIN!);
    const safe = (url: URL) => url.origin === url.href.replace(/\/$/, '') && !url.username && !url.password && url.protocol === 'https:';
    const secret = config.M0_PREVIEW_SIGNING_KEY;
    const probe = config.M0_PROBE_TOKEN;
    if (!safe(control) || !safe(preview) || (control.hostname === preview.hostname || control.hostname.endsWith(`.${preview.hostname}`)) || !probe || probe.length < 32 || probe.length > 1024 || !secret || secret.length < 32 || secret.length > 1024 || secret === config.M0_PROBE_TOKEN) return null;
    return { control: control.origin, preview: preview.origin, secret };
  } catch { return null; }
}
/** Deliberate allowlist: no forwarded cookie, bearer, Referer, arbitrary Host, or SDK proxy headers. */
export function upstreamRequest(request: Request, path: string): Request {
  const headers = new Headers();
  const websocket = path === '/ws';
  for (const name of websocket ? ['upgrade', 'sec-websocket-key', 'sec-websocket-version'] : ['accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (websocket) headers.set('connection', 'Upgrade');
  return new Request(`http://m0-preview.internal:8080${path}`, { method: 'GET', headers, redirect: 'manual' });
}
/** Project responses cannot grant cookies, CORS, navigate off-origin, or replace policy headers. */
export function filterUpstreamResponse(response: Response, scope: Scope, requestPath: string, previewOrigin: string, controlOrigin: string): Response {
  const headers = new Headers({
    'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'none'; script-src 'self'; connect-src 'self' ${controlOrigin}; base-uri 'none'; form-action 'none'; frame-ancestors ${controlOrigin}; sandbox allow-scripts allow-same-origin`,
    'cross-origin-resource-policy': 'same-origin', 'origin-agent-cluster': '?1',
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location || !location.startsWith('/') || location.startsWith('//') || location.includes('\\') || location.includes('%') || location.includes('?') || location.includes('#') || !PATHS.has(location) || location === '/ws') {
      void response.body?.cancel().catch(() => {});
      return json({ error: 'project-redirect-denied' }, 502);
    }
    headers.set('location', `${previewOrigin}${previewPrefix(scope)}${location}`);
  }
  const expected = requestPath === '/' ? 'text/html; charset=utf-8' : requestPath === '/app.js' ? 'text/javascript; charset=utf-8' : 'application/json';
  headers.set('content-type', expected);
  return new Response(response.body, { status: response.status, headers });
}
const CONTROL_SCRIPT = `
(async () => {
  const parts = location.pathname.split('/');
  const run = parts[4], tenant = parts[5];
  const response = await fetch('/m0/browser/' + run + '/' + tenant + '/ticket', {method:'POST'});
  if (!response.ok) { document.querySelector('#status').textContent = 'access denied'; return; }
  const result = await response.json();
  const frame = document.createElement('iframe');
  frame.id = 'preview'; frame.title = 'Synthetic project Preview';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.src = result.url; document.body.append(frame);
  document.querySelector('#status').textContent = 'synthetic fixture';
})().catch(() => { document.querySelector('#status').textContent = 'access denied'; });`;
function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(null, { status: 303, headers });
}
function controlDocument(body: string, settings: { control: string; preview: string }, javascript = false): Response {
  const preview = new URL(settings.preview);
  return new Response(body, { headers: {
    'content-type': javascript ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
    'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    'origin-agent-cluster': '?1',
    'content-security-policy': `default-src 'none'; script-src 'self'; connect-src 'self'; frame-src 'self' https://*.${preview.host}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  } });
}
export async function handlePreviewRequest(request: Request, config: PreviewConfig, operations: PreviewOperations, now = Date.now()): Promise<Response> {
  if (config.ENVIRONMENT !== 'staging' || config.PROTOCOL_VERSION !== 'm0-v1') return json({ error: 'probe_environment_disabled' }, 503);
  const url = new URL(request.url);
  const settings = configuration(config);
  if (!settings) return json({ error: 'preview-configuration-required' }, 503);
  const management = url.pathname.match(/^\/m0\/preview\/([^/]+)\/([^/]+)\/(start|revoke|cleanup|status|enroll|diagnostics)$/);
  if (management) {
    if (url.origin !== settings.control || !originAllowed(request, settings.control, false)) return json({ error: 'control-origin-denied' }, 403);
    if (!await hasProbeAuthorization(request, config.M0_PROBE_TOKEN)) return json({ error: 'probe-authorization-required' }, 401);
    const [, runId, tenant, action] = management;
    if (!isRunId(runId) || !isTenant(tenant) || url.search || request.method !== (action === 'status' || action === 'diagnostics' ? 'GET' : 'POST') || !await emptyBody(request)) return json({ error: 'invalid-probe-request' }, 400);
    try {
      if (action === 'enroll') {
        const enrollment = await operations.browser({ kind: 'enroll', run_id: runId, tenant });
        return json({ fixture: 'server-owned-synthetic-principal', url: `${settings.control}/m0/browser/enroll?code=${enrollment.enrollment}` });
      }
      if (action === 'status') return json(await operations.status(runId, tenant));
      if (action === 'diagnostics') return json(await operations.diagnostics(runId, tenant));
      if (action !== 'start') return json(await operations.revoke(runId, tenant));
      const grant = await operations.start(runId, tenant);
      return json({ operation: 'G0-T07', gate_decision: 'not_evaluated', grant, origin: previewOrigin(settings.preview, grant), raw_preview_url: null, cloud_browser_matrix: 'not_run' });
    } catch { return json({ error: 'preview-operation-failed', gate_decision: 'not_evaluated' }, 502); }
  }
  if (url.origin === settings.control) {
    if (request.headers.has('authorization')) return json({ error: 'management-bearer-not-browser-login' }, 403);
    const sid = await readCookie(request, settings.secret, SESSION_COOKIE);
    if (url.pathname === '/m0/browser/enroll' && request.method === 'GET' && url.searchParams.size === 1 && url.searchParams.has('code')) {
      if (sid) return json({ error: 'existing-browser-session' }, 409);
      const login = await operations.browser({ kind: 'login', enrollment: url.searchParams.get('code')! });
      if (!login.ok) return json({ error: login.error }, 403);
      return redirect(`${settings.control}/m0/browser/session`, [cookie(SESSION_COOKIE, await signCookie(settings.secret, SESSION_COOKIE, login.sid!), login.expires_at!, now)]);
    }
    if (!sid) return json({ error: 'browser-session-required' }, 403);
    const session = await operations.browser({ kind: 'session', sid });
    if (!session.ok) return json({ error: session.error }, 403);
    if (url.pathname === '/m0/browser/authorize' && request.method === 'GET' && url.searchParams.size === 1 && url.searchParams.has('challenge')) {
      if (!originAllowed(request, settings.control, false)) return json({ error: 'control-origin-denied' }, 403);
      const authorized = await operations.browser({ kind: 'authorize', sid, challenge: url.searchParams.get('challenge')! });
      if (!authorized.ok) return json({ error: authorized.error }, 403);
      if (!await operations.authorize(authorized.grant!)) return json({ error: 'preview-revoked' }, 403);
      return redirect(`${previewOrigin(settings.preview, authorized.grant!)}/auth/redeem?code=${authorized.code}`);
    }
    if (url.search) return json({ error: 'control-path-denied' }, 404);
    if (url.pathname === '/m0/browser/session' && request.method === 'GET') return json({ fixture: true, principal: session.principal, tenant: session.tenant });
    if (url.pathname === '/m0/browser/app.js' && request.method === 'GET') return controlDocument(CONTROL_SCRIPT, settings, true);
    const frame = url.pathname.match(/^\/m0\/browser\/frame\/([^/]+)\/(alpha|bravo)$/);
    if (frame && request.method === 'GET' && isRunId(frame[1]) && frame[2] === session.tenant) return controlDocument('<!doctype html><meta charset="utf-8"><title>M0 synthetic control</title><h1>Synthetic control fixture</h1><p id="status">loading</p><script src="/m0/browser/app.js"></script>', settings);
    const ticketRoute = url.pathname.match(/^\/m0\/browser\/([^/]+)\/(alpha|bravo)\/ticket$/);
    const logout = url.pathname === '/m0/browser/logout';
    if (!ticketRoute && !logout) return json({ error: 'control-route-not-found' }, 404);
    // SameSite does not defend against malicious same-site project subdomains.
    // Every control write requires exact Origin, a real server-owned session,
    // and an empty body. Headers/body/URL never select a principal.
    if (request.method !== 'POST' || request.headers.get('origin') !== settings.control || !await emptyBody(request)) return json({ error: 'control-csrf-denied' }, 403);
    if (logout) {
      const result = await operations.browser({ kind: 'logout', sid });
      if (!result.ok) return json({ error: result.error }, 403);
      await operations.endSession(sid, result.scopes!);
      return new Response(null, { status: 204, headers: { 'set-cookie': cookie(SESSION_COOKIE, '', 0, now), 'cache-control': 'no-store' } });
    }
    const [, runId, tenant] = ticketRoute!;
    if (!isRunId(runId) || !isTenant(tenant) || tenant !== session.tenant) return json({ error: 'ticket-owner-denied' }, 403);
    const state = await operations.status(runId, tenant) as { state?: Grant & { status: string } };
    if (!state.state || !await operations.authorize(state.state)) return json({ error: 'preview-not-active' }, 403);
    const ticket = await operations.browser({ kind: 'ticket', sid, grant: state.state });
    return ticket.ok ? json({ url: `${previewOrigin(settings.preview, state.state)}/auth/start?ticket=${ticket.ticket}`, expires_in: 30 }) : json({ error: ticket.error }, 403);
  }
  if (request.headers.has('authorization')) return json({ error: 'platform-bearer-forbidden-on-preview' }, 403);
  const base = new URL(settings.preview);
  const host = url.hostname.match(/^p-([a-f0-9]{32})\.(.+)$/);
  if (!host || host[2] !== base.hostname || url.port !== base.port || url.protocol !== 'https:') return json({ error: 'preview-origin-denied' }, 403);
  if (request.method !== 'GET' || request.body !== null) return json({ error: 'preview-method-denied' }, 405);
  if (url.pathname === '/auth/start' || url.pathname === '/auth/redeem') {
    if (request.headers.has('upgrade') || !originAllowed(request, url.origin, false)) return json({ error: 'preview-origin-denied' }, 403);
    if (url.searchParams.size !== 1) return json({ error: 'auth-query-denied' }, 400);
    if (url.pathname === '/auth/start' && url.searchParams.has('ticket')) {
      const result = await operations.browser({ kind: 'begin', ticket: url.searchParams.get('ticket')!, generation: host[1]! });
      if (!result.ok || !await operations.authorize(result.grant!)) return json({ error: result.error ?? 'preview-revoked' }, 403);
      return redirect(`${settings.control}/m0/browser/authorize?challenge=${result.challenge}`, [cookie(CHALLENGE_COOKIE, await signCookie(settings.secret, CHALLENGE_COOKIE, result.nonce!), result.expires_at!, now)]);
    }
    const nonce = await readCookie(request, settings.secret, CHALLENGE_COOKIE);
    if (url.pathname !== '/auth/redeem' || !url.searchParams.has('code') || !nonce) return json({ error: 'challenge-required' }, 403);
    const result = await operations.browser({ kind: 'redeem', code: url.searchParams.get('code')!, nonce, generation: host[1]! });
    if (!result.ok || !await operations.authorize(result.grant!)) return json({ error: result.error ?? 'preview-revoked' }, 403);
    return redirect(`${url.origin}${previewPrefix(result.grant!)}/`, [cookie(ACCESS_COOKIE, await signCookie(settings.secret, ACCESS_COOKIE, result.access!), result.expires_at!, now), cookie(CHALLENGE_COOKIE, '', 0, now)]);
  }
  const match = url.pathname.match(/^\/p\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)(\/.*)$/);
  if (!match) return json({ error: 'preview-route-not-found' }, 404);
  const [, run_id, tenant, preview_id, generation, path] = match as [string, string, ProbeTenant, string, string, string];
  const scope = { run_id, tenant, preview_id, generation };
  if (!validScope(scope) || previewOrigin(settings.preview, scope) !== url.origin) return json({ error: 'invalid-preview-scope' }, 403);
  const upgrade = request.headers.get('upgrade'), websocket = path === '/ws';
  if ((websocket && upgrade?.toLowerCase() !== 'websocket') || (!websocket && upgrade !== null)) return json({ error: 'preview-upgrade-denied' }, 400);
  if (!originAllowed(request, url.origin, websocket)) return json({ error: 'preview-origin-denied' }, 403);
  if (url.search || !PATHS.has(path)) return json({ error: 'preview-path-denied' }, 404);
  const access = await readCookie(request, settings.secret, ACCESS_COOKIE);
  const session = access && await operations.browser({ kind: 'access', access, scope });
  if (!session || !session.ok || !await operations.authorize(scope)) return json({ error: 'preview-capability-denied' }, 403);
  try {
    const response = await operations.proxy(scope, upstreamRequest(request, path), access!);
    return websocket ? response : filterUpstreamResponse(response, scope, path, url.origin, settings.control);
  } catch { return json({ error: 'preview-upstream-failed' }, 502); }
}
