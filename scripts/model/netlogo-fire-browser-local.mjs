import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import {BROWSER_PREVIEW_SOURCE_PATHS, previewSha256} from '../../services/browser-preview/contract.ts';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {productionPreviewRegistry} from '../../services/browser-preview/production-registry.ts';
import {validateSavedPreview} from '../../services/browser-preview/validator.ts';
import {packageCompatiblePreview} from '../../services/browser-preview/packager.ts';
import {browserPreviewStaticIndex as index} from '../../services/browser-preview/execution/assets/static-index.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const candidate = resolve(root, 'examples/netlogo-fire-candidate');
const output = resolve(root, '.local/netlogo-fire-candidate');
const files = Object.fromEntries(await Promise.all(BROWSER_PREVIEW_SOURCE_PATHS.map(async path => [path, await readFile(join(candidate, path))])));
const archive = initialWorkspaceArchive(files);
const filesSha256 = await previewSha256(archive);
// These identifiers are local harness labels, not production saved receipts.
const source = {projectId: 'local-fire-candidate', revisionId: 'local-fire-' + filesSha256, filesSha256};
const compatible = await validateSavedPreview(source, archive, 'python-stdlib/v1', await productionPreviewRegistry());
assert.equal(compatible.status, 'compatible');
const packaged = await packageCompatiblePreview(compatible.value);
const envelope = JSON.parse(new TextDecoder().decode(packaged.bytes));
const requests = [];
const listen = async handler => {
  const server = createServer(handler);
  await new Promise((accept, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', accept);});
  return server;
};
const close = server => new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
let execution, app, browser;
try {
  execution = await listen(async (req, res) => {
    requests.push({surface: 'execution', method: req.method, path: req.url, cookiePresent: Boolean(req.headers.cookie)});
    try {
      const asset = index.assets.find(item => item.kind === 'frame' && item.url === req.url);
      if (req.method !== 'GET' || !asset) {res.writeHead(404); return res.end();}
      const scriptHash = Buffer.from(asset.scriptSha256, 'hex').toString('base64');
      res.writeHead(200, {'Content-Type': 'text/html', 'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${scriptHash}' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'none'; worker-src blob:; frame-ancestors *; base-uri 'none'; form-action 'none'`});
      res.end(await readFile(resolve(root, '.local/browser-preview/execution-assets', asset.file)));
    } catch (error) {res.writeHead(500); res.end(error.message);}
  });
  app = await listen(async (req, res) => {
    requests.push({surface: 'app', method: req.method, path: req.url});
    try {
      if (req.method !== 'GET') {res.writeHead(405); return res.end();}
      if (req.url === '/') {
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        return res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fire local candidate</title><style>body{font:16px system-ui;margin:32px;background:#f8fafc;color:#172033}main{max-width:760px;margin:auto}h1{margin-bottom:8px}p{color:#475569}#visual{max-width:100%;overflow:hidden}pre{white-space:pre-wrap;background:white;padding:16px;border-radius:8px}</style><main><h1>Forest Fire</h1><p>Private local candidate · local / unverified</p><p id="input"></p><div id="visual"></div><pre id="metrics"></pre></main>');
      }
      const asset = index.assets.find(item => item.kind === 'app' && item.url === req.url);
      if (!asset) {res.writeHead(404); return res.end();}
      const bytes = await readFile(resolve(root, '.local/browser-preview/app-assets', asset.file));
      assert.equal(await previewSha256(bytes), asset.sha256);
      res.writeHead(200, {'Content-Type': asset.contentType});
      res.end(bytes);
    } catch (error) {res.writeHead(500); res.end(error.message);}
  });
  const launchOptions = {headless: true};
  if (process.env.M1_BROWSER_EXECUTABLE) launchOptions.executablePath = process.env.M1_BROWSER_EXECUTABLE;
  else if (process.env.M1_BROWSER_CHANNEL && process.env.M1_BROWSER_CHANNEL !== 'chromium') launchOptions.channel = process.env.M1_BROWSER_CHANNEL;
  browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({viewport: {width: 900, height: 800}});
  const unexpectedRequests = [], pageErrors = [];
  const appOrigin = `http://127.0.0.1:${app.address().port}`;
  const executionOrigin = `http://127.0.0.1:${execution.address().port}`;
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (!url.startsWith(appOrigin + '/') && !url.startsWith(executionOrigin + '/')) {
      unexpectedRequests.push(url); return route.abort();
    }
    return route.continue();
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(appOrigin);
  const delivery = index.versions[envelope.manifest.runtime.assetSha256];
  await page.evaluate(async ({delivery, executionOrigin, envelope}) => {
    const {BrowserPreviewRuntime} = await import(delivery.hostModule.url);
    window.diagnostics = [];
    window.runtime = new BrowserPreviewRuntime({executionOrigin, frameUrl: delivery.frameDocument.url, assetLoader: async profile => Promise.all(profile.assetManifest.map(async asset => {
      const response = await fetch(`${delivery.assetBaseUrl}/${asset.sha256}/${asset.path}`);
      if (!response.ok) throw Error('local-asset-read-failed');
      return {path: asset.path, bytes: new Uint8Array(await response.arrayBuffer())};
    })), onCanvasError: error => diagnostics.push(error.message)});
    await runtime.load(envelope);
  }, {delivery, executionOrigin, envelope});
  await mkdir(output, {recursive: true});
  const cases = [
    {name: 'frozen-bounded-input', input: {parameters: {density_percent: 57, steps: 5}, seed: 20261001}},
    {name: 'higher-density', input: {parameters: {density_percent: 80, steps: 40}, seed: 20261001}},
    {name: 'zero-density-ember-stop', input: {parameters: {density_percent: 0, steps: 80}, seed: 20261001}},
  ];
  const records = [];
  for (const item of cases) {
    const code = 'import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location("fire_candidate",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);print(json.dumps(m.run(json.loads(sys.argv[2])),sort_keys=True,separators=(",",":"),allow_nan=False))';
    const native = spawnSync('python3', ['-I', '-B', '-c', code, join(candidate, 'model/model.py'), JSON.stringify(item.input)], {encoding: 'utf8', timeout: 15000, maxBuffer: 12 * 1024 * 1024});
    assert.equal(native.status, 0, native.stderr);
    const expected = JSON.parse(native.stdout);
    const trace = await page.evaluate(async input => {
      document.querySelector('#input').textContent = `Density ${input.parameters.density_percent}% · up to ${input.parameters.steps} ticks · seed ${input.seed}`;
      const trace = await runtime.run(input, document.querySelector('#visual'));
      document.querySelector('#metrics').textContent = JSON.stringify(trace.snapshots[0].metrics, null, 2);
      return trace;
    }, item.input);
    assert.deepEqual(trace, expected, item.name);
    await page.waitForFunction(() => runtime.canvasActive);
    await page.evaluate(() => {
      window.lastPaintedToken = -1;
      const port = runtime.pending.channel.port1, original = port.onmessage;
      port.onmessage = event => {
        original(event);
        if (event.data?.type === 'painted') window.lastPaintedToken = event.data.token;
      };
    });
    const paint = async frame => {
      await page.evaluate(frame => {
        runtime.paint(frame);
        document.querySelector('#metrics').textContent = `Tick ${frame}\n` + JSON.stringify(runtime.pending.trace.snapshots[frame].metrics, null, 2);
      }, frame);
      await page.waitForFunction(() => runtime.pending && lastPaintedToken === runtime.pending.paintToken && !runtime.pending.inFlightPaint);
      assert.deepEqual(await page.evaluate(() => diagnostics), []);
    };
    await paint(0);
    if (item.name === 'frozen-bounded-input') await page.screenshot({path: join(output, 'fire-initial.png'), fullPage: true});
    const last = trace.snapshots.length - 1;
    await paint(last);
    if (item.name === 'frozen-bounded-input') await page.screenshot({path: join(output, 'fire-tick5.png'), fullPage: true});
    records.push({name: item.name, input: item.input, frames: trace.snapshots.length, finalTick: trace.snapshots[last].frame, finalMetrics: trace.snapshots[last].metrics, traceSha256: await previewSha256(JSON.stringify(trace)), entireTraceMatchesCPython: true});
    await page.evaluate(() => runtime.cancel());
    assert.equal(await page.locator('iframe').count(), 0);
  }
  await page.evaluate(() => runtime.dispose());
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unexpectedRequests, []);
  assert.ok(requests.every(request => request.method === 'GET'));
  assert.ok(requests.filter(request => request.surface === 'execution').every(request => !request.cookiePresent));
  const receipt = {schema: 'riffoid.fire-browser-local/v1', observedAt: new Date().toISOString(), environment: 'isolated-local-browser-harness', identityScope: 'synthetic-local-only', source, packageIdentity: envelope.manifest.packageIdentity, runtime: envelope.manifest.runtime, browserVersion: browser.version(), records, requestCount: requests.length, requests, unexpectedRequests, pageErrors, framesAfterEachRun: 0, classification: 'local/unverified', productionExecutionChecked: false};
  await writeFile(join(output, 'browser-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({receipt: join(output, 'browser-receipt.json'), packageIdentity: receipt.packageIdentity, browserVersion: receipt.browserVersion, records, requests: requests.length, framesAfterEachRun: 0}, null, 2));
} finally {
  if (browser) await browser.close();
  if (app) await close(app);
  if (execution) await close(execution);
}
