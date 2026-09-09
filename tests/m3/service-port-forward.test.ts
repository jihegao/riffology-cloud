import assert from 'node:assert/strict';
import test from 'node:test';
import { forwardRunningService } from '../../services/run/http-forward.ts';

const publicOrigin = 'https://p-' + 'a'.repeat(40) + '.preview.example.test';

test('missing or stopped containers fail without resolving a port or fetching', async () => {
  let portCalls = 0, fetchCalls = 0;
  const stopped = {
    running: false,
    getTcpPort() { portCalls++; return { fetch: async () => { fetchCalls++; return new Response(); } }; },
  };
  await assert.rejects(forwardRunningService(undefined, new Request(publicOrigin + '/status')), /service-container-not-running/);
  await assert.rejects(forwardRunningService(stopped, new Request(publicOrigin + '/status')), /service-container-not-running/);
  assert.equal(portCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('a container that stops while the request body is being read is rejected', async () => {
  let running = true, controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const container = {
    get running() { return running; },
    getTcpPort() { throw Error('must-not-resolve-port'); },
  };
  const pending = forwardRunningService(container, new Request(publicOrigin + '/upload', {
    method: 'POST', body, headers: { 'content-type': 'text/plain' }, duplex: 'half',
  } as RequestInit));
  await new Promise(resolve => setTimeout(resolve, 5));
  running = false;
  controller.enqueue(new TextEncoder().encode('late body'));
  controller.close();
  await assert.rejects(pending, /service-container-not-running/);
});

test('running containers forward to only port 8080 with a fixed internal URL and clean headers', async () => {
  let port: number | undefined, forwarded: Request | undefined;
  const container = {
    running: true,
    getTcpPort(value: number) {
      port = value;
      return { fetch: async (request: Request) => { forwarded = request; return new Response('ok', { status: 202 }); } };
    },
  };
  const response = await forwardRunningService(container, new Request(publicOrigin + '/app/index.html?q=1', {
    method: 'GET', headers: {
      accept: 'text/html', cookie: 'secret=1', authorization: 'Bearer secret',
      'x-riffology-sandbox-id': 'forged', origin: publicOrigin,
    },
  }));
  assert.equal(response.status, 202);
  assert.equal(await response.text(), 'ok');
  assert.equal(port, 8080);
  assert.ok(forwarded);
  assert.equal(forwarded!.url, 'http://localhost:8080/app/index.html?q=1');
  assert.equal(forwarded!.method, 'GET');
  assert.equal(forwarded!.headers.get('accept'), 'text/html');
  for (const header of ['cookie', 'authorization', 'upgrade', 'x-riffology-sandbox-id', 'origin']) assert.equal(forwarded!.headers.get(header), null);
});


test('deadline bounds a port fetch that ignores cancellation and cancels its late body', async () => {
 let resolve!: (response: Response) => void, cancelled=false;
 const container={running:true,getTcpPort(){return {fetch:()=>new Promise<Response>(done=>{resolve=done;})};}};
 const pending=forwardRunningService(container,new Request(publicOrigin+'/slow'),Date.now()+1000);
 await assert.rejects(pending,/service-forward-expired/);
 resolve(new Response(new ReadableStream({cancel(){cancelled=true;}})));
 await new Promise(done=>setTimeout(done,0));assert.equal(cancelled,true);
});
