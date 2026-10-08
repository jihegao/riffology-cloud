import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import profiles from '../../services/browser-preview/runtime/assets/profiles.json' with {type:'json'};
import {makeFixture} from '../../services/browser-preview/runtime/fixtures.mjs';
import {canonicalPreviewJson} from '../../services/browser-preview/contract.ts';
import {browserPreviewStaticIndex as index} from '../../services/browser-preview/execution/assets/static-index.ts';
const listen=async handler=>{const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server;};
const close=server=>new Promise(resolve=>server.close(resolve));

test('real Pyodide local Runs execute a frozen Fire comparison, match CPython and release every opaque frame',async t=>{
 const pkg=await makeFixture(profiles[0],'fire'),manifest=pkg.manifest;
 const spec=JSON.parse(Buffer.from(pkg.files.find(file=>file.path==='model/model-spec.json').base64,'base64'));
 const version={revisionId:manifest.revisionId,filesSha256:manifest.filesSha256,specSha256:manifest.sources.find(file=>file.path==='model/model-spec.json').sha256};
 const executionRequests=[],appRequests=[];
 const execution=await listen(async(req,res)=>{try{executionRequests.push({url:req.url,cookie:req.headers.cookie??null});const asset=index.assets.find(asset=>asset.kind==='frame'&&asset.url===req.url);if(!asset){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':`default-src 'none'; script-src 'sha256-${Buffer.from(asset.scriptSha256,'hex').toString('base64')}' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'none'; worker-src blob:; frame-ancestors *; base-uri 'none'; form-action 'none'`});res.end(await readFile(resolve('.local/browser-preview/execution-assets',asset.file)));}catch(error){res.writeHead(500);res.end(error.message);}});t.after(()=>close(execution));
 const delivery={...index.delivery,executionOrigin:`http://127.0.0.1:${execution.address().port}`};
 const model={canRun:false,capabilityReason:'invited-runs-paused',version,spec};
 const app=await listen(async(req,res)=>{try{
  appRequests.push({url:req.url,method:req.method});const url=new URL(req.url,'http://local');
  const json=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname.endsWith('/model'))return json(model);
  if(url.pathname.endsWith('/experiments')||url.pathname.endsWith('/experiment-groups'))return json({items:[]});
  if(url.pathname.endsWith('/browser-preview'))return json({currentRevisionId:manifest.revisionId,stale:false,build:{status:'ready',revisionId:manifest.revisionId,packageIdentity:manifest.packageIdentity},delivery});
  if(url.pathname.includes('/browser-preview/packages/')){res.writeHead(200,{'Content-Type':'application/octet-stream'});return res.end(canonicalPreviewJson(pkg));}
  if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html','Set-Cookie':'app_session=sentinel; Path=/; SameSite=Lax'});return res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/workspace.css"><main class="container workspace-view"><section id="single" class="service-panel"></section><section id="compare" class="service-panel comparison-panel"></section></main>');}
  const asset=index.assets.find(asset=>asset.kind==='app'&&asset.url===url.pathname);
  const path=asset?resolve('.local/browser-preview/app-assets',asset.file):/^\/[a-z0-9-]+\.(js|css)$/.test(url.pathname)?resolve('services/web',url.pathname.slice(1)):null;
  if(!path){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':asset?.contentType||(url.pathname.endsWith('.css')?'text/css':'text/javascript')});res.end(await readFile(path));
 }catch(error){res.writeHead(500);res.end(error.message);}});t.after(()=>close(app));
 const browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||'chrome'});t.after(()=>browser.close());const page=await browser.newPage();await page.goto(`http://localhost:${app.address().port}`);
 await page.evaluate(async({model,projectId})=>{
  const [{createLocalRuns},{createSimulationPanel},{createComparisonPanel},{setLocale}]=await Promise.all([import('/local-runs.js'),import('/simulation.js'),import('/comparison.js'),import('/i18n.js')]);setLocale('en',{persist:false});
  const api=async(url,options={})=>{const response=await fetch(url,options);if(!response.ok)throw Error('read-failed');return options.responseType==='bytes'?new Uint8Array(await response.arrayBuffer()):response.json();};
  window.scope={tenantId:'tenant',workspaceId:'workspace',projectId};window.runner=createLocalRuns({api});await runner.enter(scope);
  window.single=createSimulationPanel({root:document.querySelector('#single'),api,localRuns:runner});window.compare=createComparisonPanel({root:document.querySelector('#compare'),api,localRuns:runner});await single.enter(scope);await compare.enter(scope);
 },{model,projectId:manifest.projectId});
 await page.locator('#compare input[name=hypothesis]').fill('Fire density comparison');await page.locator('#compare [data-configuration=baseline] input[name=density]').fill('0.5');await page.locator('#compare [data-configuration=intervention-1] input[name=density]').fill('0.6');await page.locator('#compare input[name=seeds]').fill('42,43');await page.getByRole('button',{name:'Run and compare locally',exact:true}).click();
 await page.waitForFunction(()=>!runner.busy&&document.querySelector('.local-run-record'),null,{timeout:90000});
 const records=await page.evaluate(()=>JSON.parse(localStorage.getItem(`riffology:local-runs:v1:tenant:${scope.projectId}:workspace`)).records);const record=records[0];assert.equal(record.status,'completed',JSON.stringify(record));assert.equal(record.runs.length,4);assert.equal(record.packageIdentity,manifest.packageIdentity);assert.deepEqual(record.runtime,manifest.runtime);
 for(const run of record.runs){const code='import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location("model",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);print(json.dumps(m.run(json.loads(sys.argv[2]))["snapshots"][-1]["metrics"]))';const result=spawnSync('python3',['-I','-c',code,resolve('services/browser-preview/runtime/fixtures/fire.py'),JSON.stringify({parameters:run.parameters,seed:run.seed})],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(run.metrics,JSON.parse(result.stdout));}
 assert.equal(await page.locator('iframe').count(),0);assert.equal(appRequests.filter(req=>req.method!=='GET').length,0);assert.equal(executionRequests.length,4);assert.ok(executionRequests.every(request=>request.cookie===null));
 await page.evaluate(async()=>{runner.leave();await runner.enter(scope);});assert.match(await page.locator('#compare').innerText(),/Completed locally \/ unverified/);assert.equal(executionRequests.length,4);
 const out=process.env.LOCAL_RUNS_EVIDENCE_DIR;if(out){await mkdir(out,{recursive:true});await writeFile(resolve(out,'pyodide-comparison.json'),JSON.stringify({environment:'local-fixture',model:'fire',version,runtime:manifest.runtime,packageIdentity:manifest.packageIdentity,records,appRequests,executionRequests,serverWrites:0,cloudExecution:false,realPyodide:true,cpythonMatched:true,framesAfter:0},null,2)+'\n');await page.screenshot({path:resolve(out,'local-runs.png'),fullPage:true});}
 await page.setViewportSize({width:390,height:844});await page.locator('#compare .local-run-record summary').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(out)await page.screenshot({path:resolve(out,'local-runs-mobile.png'),fullPage:true});
});
