import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PreviewRoutes } from '../../services/preview/routes.ts';
import { previewHost } from '../../services/gateway/preview-host.ts';
import { PREVIEW_NONCE_COOKIE } from '../../services/preview/browser.ts';
import { ProjectCatalog } from '../../services/catalog/projects.ts';
import { SqliteCatalog } from '../m1/sqlite-database.ts';
import { actor, scope as baseScope, spec, reference } from './run-fixture.ts';
import type { PreviewBinding } from '../../services/preview/bindings.ts';
import type { TurnScope } from '../../services/turn/protocol.ts';

const appOrigin = 'https://app.example.test', previewBase = 'https://preview.example.test';
const ticket = 'a'.repeat(64), nonce = 'b'.repeat(64), access = 'c'.repeat(64);

async function setup(t: { after(fn: () => void): void }, expiryOffset = 90000) {
  const db = new SqliteCatalog();
  t.after(() => db.sqlite.close());
  db.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/0008_preview_routes.sql', import.meta.url), 'utf8'));
  db.seed('user-a');
  const principal = { userId: 'user-a', authVersion: 1 };
  const project = await new ProjectCatalog(db, new Set(['blank-v1'])).create(principal, 'tenant-user-a', 'preview', { title: 'Preview', starterVersion: 'blank-v1' });
  db.sqlite.exec("UPDATE catalog_projects SET status='ready'; UPDATE catalog_workspaces SET status='ready';");
  const scope: TurnScope = { ...baseScope, tenantId: 'tenant-user-a', projectId: project.project.id, workspaceId: project.project.workspace_id };
  const now = Date.now();
  const routes = new PreviewRoutes(db, () => now);
  const route = await routes.register(principal, scope, 'preview-a', now + expiryOffset);
  let targetCalls = 0, exchangeCalls = 0, disposed = 0;
  let target: unknown = { binding: { previewId: route.previewId, scope, runId: 'run-a', expiresAt: route.expiresAt, revokedAt: null } };
  const env = {
    M3_PREVIEW_ENABLED: 'true', M3_PREVIEW_ORIGIN: previewBase, APP_ORIGIN: appOrigin,
    WORKSPACE_AGENT: { getByName(name: string) {
      assert.equal(name, `workspace:${scope.tenantId}:${scope.workspaceId}`);
      return {
        async previewTarget(input: { scope: TurnScope; previewId: string }) { targetCalls++; assert.deepEqual(input, { scope, previewId: route.previewId }); return target; },
        async exchangePreviewTicket(input: { scope: TurnScope; previewId: string; ticket: string; nonce: string }) {
          exchangeCalls++; assert.deepEqual(input, { scope, previewId: route.previewId, ticket, nonce });
          return { access, expiresAt: Date.now() + 60000 };
        },
      };
    } },
  };
  return { db, routes, route, scope, env, counts: () => ({ targetCalls, exchangeCalls, disposed }), setTarget(value: unknown) { target = value; }, disposeTarget() { target = Object.assign(target as object, { [Symbol.dispose]() { disposed++; } }); } };
}

function url(route: Awaited<ReturnType<typeof setup>>['route'], path: string) { return `https://${route.hostLabel}.preview.example.test${path}`; }
function binding(route: Awaited<ReturnType<typeof setup>>['route'], scope: TurnScope, patch: Partial<PreviewBinding> = {}): PreviewBinding {
  return { previewId: route.previewId, scope, runId: 'run-a', source: spec().plan.source, runtime: { ...reference('run-a'), deadlineAt: route.expiresAt }, createdAt: 1000, expiresAt: route.expiresAt, revokedAt: null, reason: null, ...patch };
}

test('registered exact host serves bootstrap and exchange passes scope, preview id, and cookie nonce', async t => {
  const f = await setup(t); f.setTarget({ binding: binding(f.route, f.scope) }); f.disposeTarget();
  const bootstrap = await previewHost(new Request(url(f.route, '/__riff/bootstrap')), f.env, f.db);
  assert.equal(bootstrap.status, 200);
  const exchange = await previewHost(new Request(url(f.route, '/__riff/exchange'), { method: 'POST', headers: { origin: url(f.route, ''), 'content-type': 'application/json', cookie: `${PREVIEW_NONCE_COOKIE}=${nonce}` }, body: JSON.stringify({ ticket }) }), f.env, f.db);
  assert.equal(exchange.status, 200);
  assert.deepEqual(f.counts(), { targetCalls: 2, exchangeCalls: 1, disposed: 2 });
});

test('unknown, expired, wrong domain/port and disabled routes do not invoke workspace RPC', async t => {
  const f = await setup(t);
  for (const [request, expected] of [
    [new Request('https://p-' + '0'.repeat(40) + '.preview.example.test/__riff/bootstrap'), 404],
    [new Request(`https://${f.route.hostLabel}.preview.example.test:8443/__riff/bootstrap`), 403],
    [new Request('https://evil.example.test/__riff/bootstrap'), 403],
  ] as const) assert.equal((await previewHost(request, f.env, f.db)).status, expected);
  f.env.M3_PREVIEW_ORIGIN = 'https://preview.example.test';
  (f as any).env.M3_PREVIEW_ENABLED = 'false';
  assert.equal((await previewHost(new Request(url(f.route, '/__riff/bootstrap')), f.env, f.db)).status, 403);
  assert.deepEqual(f.counts(), { targetCalls: 0, exchangeCalls: 0, disposed: 0 });
});

test('expired registry route, revoked or mismatched target, and root proxy gap fail closed', async t => {
  const f = await setup(t, 20);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await previewHost(new Request(url(f.route, '/__riff/bootstrap')), f.env, f.db)).status, 404);
  assert.deepEqual(f.counts(), { targetCalls: 0, exchangeCalls: 0, disposed: 0 });
  const g = await setup(t); g.setTarget({ binding: binding(g.route, g.scope, { revokedAt: 1100, reason: 'operator' }) });
  assert.equal((await previewHost(new Request(url(g.route, '/__riff/bootstrap')), g.env, g.db)).status, 503);
  const h = await setup(t); h.setTarget({ binding: binding(h.route, { ...h.scope, tenantId: 'tenant-other' }) });
  assert.equal((await previewHost(new Request(url(h.route, '/__riff/bootstrap')), h.env, h.db)).status, 503);
  const root = await setup(t); root.setTarget({ binding: binding(root.route, root.scope) });
  assert.equal((await previewHost(new Request(url(root.route, '/')), root.env, root.db)).status, 403);
  assert.deepEqual(root.counts(), { targetCalls: 0, exchangeCalls: 0, disposed: 0 });
});


test('project HTTP requires access cookie, cleans credentials and filters the authorized response', async t => {
 const f=await setup(t);let authorized=0,forwarded=0,denied=false;
 const env={...f.env,WORKSPACE_AGENT:{getByName(name:string){const worker=f.env.WORKSPACE_AGENT.getByName(name);return {...worker,
  async authorizePreviewAccess(input:{scope:TurnScope;access:string;previewId:string}){authorized++;assert.deepEqual(input,{scope:f.scope,access,previewId:f.route.previewId});if(denied)throw Error('preview-access-denied');return {expiresAt:f.route.expiresAt};},
  async forwardPreviewHttp(input:{scope:TurnScope;access:string;previewId:string},request:Request){forwarded++;assert.equal(input.previewId,f.route.previewId);assert.equal(request.url,'http://localhost:8080/model?x=1');assert.equal(request.headers.has('cookie'),false);assert.equal(request.headers.has('authorization'),false);assert.equal(await request.text(),'update');return new Response('project result',{headers:{'content-type':'text/plain','set-cookie':'leak=1','access-control-allow-origin':'*'}});},
 };}}};
 const origin=new URL(url(f.route,'/')).origin;
 const request=(extra:Record<string,string>={})=>new Request(url(f.route,'/model?x=1'),{method:'POST',headers:{origin,cookie:'__Host-riff_preview='+access,authorization:'Bearer platform',...extra},body:'update'});
 const response=await previewHost(request(),env,f.db);assert.equal(response.status,200);assert.equal(await response.text(),'project result');assert.equal(response.headers.has('set-cookie'),false);assert.equal(response.headers.has('access-control-allow-origin'),false);assert.match(response.headers.get('content-security-policy')!,/sandbox/);assert.ok(authorized>=4);assert.equal(forwarded,1);
 const sandboxed=await previewHost(request({origin:'null','sec-fetch-site':'same-origin'}),env,f.db);assert.equal(sandboxed.status,200);assert.equal(await sandboxed.text(),'project result');assert.equal(forwarded,2);
 denied=true;assert.equal((await previewHost(request(),env,f.db)).status,403);assert.equal(forwarded,2);const before=authorized;assert.equal((await previewHost(request({origin:'https://attacker.example.test'}),env,f.db)).status,403);assert.equal(authorized,before);
});
