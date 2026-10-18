import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IrProject, diagnostic } from './project.mjs';

const browserRoot = new URL('../browser/', import.meta.url);
const publicAssets = new Set(['app.html', 'app.js', 'app.css', 'runtime.js', 'worker.js']);
const brokers = new Map();

export async function startBroker(workspace, { port = 0, project = new IrProject(workspace) } = {}) {
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== new URL(origin).host) return send(403, { error: 'loopback_host_required' });
      if (req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'same_origin_required' });
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('referrer-policy', 'no-referrer');
      const url = new URL(req.url, origin);
      const asset = url.pathname === '/' ? 'app.html' : url.pathname.replace('/assets/', '');
      if (req.method === 'GET' && publicAssets.has(asset)) {
        res.writeHead(200, { 'content-type': asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html', 'cache-control': 'no-store' });
        return res.end(await readFile(new URL(asset, browserRoot)));
      }
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'authorization_required' });
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { status: 'ok', service: 'riffoid-ir', workspace: project.workspace });
      if (req.method === 'GET' && url.pathname === '/runtime') {
        const ref = url.searchParams.get('ref'); await project.assertBlob(ref, 'runtimes', 'runtime.js');
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
        return res.end(await readFile(await project.path(ref)));
      }
      if (req.method !== 'POST' || url.pathname !== '/v1') return send(404, { error: 'not_found' });
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) return send(413, { error: 'request_too_large' });
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const abort = new AbortController();
      res.on('close', () => { if (!res.writableEnded) abort.abort(); });
      send(200, await project.operation(body.operation, body.input, abort.signal));
    } catch (error) { if (!res.headersSent) send(400, { status: 'failed', diagnostics: error.diagnostics || [diagnostic('request_failed', 'request', error.message)] }); }
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
  const connection = { version: 1, origin: `http://127.0.0.1:${server.address().port}`, token, pid: process.pid };
  await project.write('.riffoid-ir/connection.json', connection);
  return { project, connection, server,
    async close() { await project.exclusive(() => project.interruptAll()); await new Promise(accept => server.close(accept)); },
  };
}

export function request(connection, operation, input = {}, signal) {
  return fetch(`${connection.origin}/v1`, { method: 'POST', headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ operation, input }), signal }).then(async response => {
    const data = await response.json(); if (!response.ok) throw new Error(data.error || `IR bridge HTTP ${response.status}`); return data;
  });
}

export async function connectProject(workspace) {
  const root = resolve(workspace);
  if (brokers.has(root)) return brokers.get(root);
  const connect = (async () => {
    const project = new IrProject(root);
    const existing = await project.read('.riffoid-ir/connection.json').catch(() => undefined);
    if (existing && /^http:\/\/127\.0\.0\.1:\d+$/.test(existing.origin) && /^[a-f0-9]{64}$/.test(existing.token)) {
      const healthy = await fetch(`${existing.origin}/health`, { headers: { authorization: `Bearer ${existing.token}` }, signal: AbortSignal.timeout(1500) }).then(async r => r.ok && (await r.json()).workspace === root).catch(() => false);
      if (healthy) return { connection: existing, call: (op, input, signal) => request(existing, op, input, signal) };
    }
    const lock = await project.path('.riffoid-ir/broker.lock');
    await mkdir(dirname(lock), { recursive: true });
    try { await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(lock, 'utf8'));
      let alive = true; try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
      if (alive) throw new Error('IR bridge is starting in another session; retry after it is ready');
      await rm(lock); return connectProjectAfterUnlock();
    }
    async function connectProjectAfterUnlock() { brokers.delete(root); return connectProject(root); }
    try {
      const broker = await startBroker(root, { project }); broker.server.unref();
      return { ...broker, call: (op, input, signal) => request(broker.connection, op, input, signal) };
    } finally { await rm(lock, { force: true }); }
  })();
  brokers.set(root, connect);
  try { return await connect; } catch (error) { brokers.delete(root); throw error; }
}

export async function acquireProject(workspace) {
  const root = resolve(workspace), bridge = await connectProject(root);
  bridge.references = (bridge.references || 0) + 1;
  let released = false;
  return { ...bridge, async release() {
    if (released) return; released = true;
    if (--bridge.references === 0) {
      if (bridge.close) await bridge.close();
      brokers.delete(root);
    }
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--workspace');
  const broker = await startBroker(i >= 0 ? process.argv[i + 1] : process.cwd());
  console.log(`Riffoid IR bridge ready for ${broker.project.workspace} (${broker.connection.origin}). Open IR Model in PI WEB.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await broker.close(); process.exit(); });
}
