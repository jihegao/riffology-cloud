import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {chromium} from 'playwright';
import {materializeBrowserPreviewWeb,validateBrowserPreviewWebAssets} from '../../scripts/m3/materialize-browser-preview-web.mjs';
import {browserPreviewStaticIndex} from '../../services/browser-preview/execution/assets/static-index.ts';
async function freePort(){const s=createServer();await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}
test('actual Gateway ASSETS binding serves verified modules and same-app browser imports',{timeout:30000},async()=>{
 const path=await mkdtemp(join(tmpdir(),'preview-gateway-assets-')),port=await freePort(),origin='http://127.0.0.1:'+port,web=await materializeBrowserPreviewWeb();let mf,browser;
 assert.equal(validateBrowserPreviewWebAssets().status,'passed');const stale=join(web.directory,'deleted-web-file.js');await writeFile(stale,'stale');await materializeBrowserPreviewWeb();await assert.rejects(import('node:fs/promises').then(fs=>fs.readFile(stale)));const panel=join(web.directory,'browser-preview.js'),original=await import('node:fs/promises').then(fs=>fs.readFile(panel));await writeFile(panel,'tampered');assert.equal(validateBrowserPreviewWebAssets().status,'blocked');await writeFile(panel,original);assert.equal(validateBrowserPreviewWebAssets().status,'passed');
 const bundle=await build({entryPoints:['services/gateway/index.ts'],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});
 try{
  mf=new Miniflare({host:'127.0.0.1',port,inspectorPort:0,cf:{},telemetry:{enabled:false},resourcePersistencePath:path,workers:[{config:{type:'worker',name:'preview-assets-'+crypto.randomUUID().slice(0,8),compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'gateway.mjs',modules:{'gateway.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},assets:{directory:web.directory,hasUserWorker:true,runWorkerFirst:true,htmlHandling:'none',notFoundHandling:'none'},env:{ASSETS:{type:'assets'},APP_ORIGIN:{type:'text',value:origin},BROWSER_PREVIEW_EXECUTION_ORIGIN:{type:'text',value:'https://execution.other.test'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('external-disabled',{status:403})}}}]});await mf.ready;
  for(const asset of [...browserPreviewStaticIndex.assets.filter(a=>a.kind==='app')].sort((a,b)=>a.file.includes('host.bundle')?-1:b.file.includes('host.bundle')?1:0)){const response=await fetch(origin+asset.url,{signal:AbortSignal.timeout(5000),headers:{cookie:'private-app-session',authorization:'Bearer private'}});assert.equal(response.status,200,asset.file+(response.status===200?'':': '+await response.text()));const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,asset.byteLength);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);assert.equal(response.headers.get('set-cookie'),null);assert.match(response.headers.get('cache-control'),/immutable/);if(asset.byteLength>=65536){assert.equal(response.headers.get('content-encoding'),'gzip');assert.equal(response.headers.get('vary'),'Accept-Encoding');}}
  assert.equal((await mf.dispatchFetch(origin+web.delivery.hostModule.url+'?exfil=source')).status,404);assert.equal((await mf.dispatchFetch(origin+'/browser-preview-assets/'+'a'.repeat(64)+'/model.py')).status,404);
  const panelResponse=await fetch(origin+'/browser-preview.js');assert.equal(panelResponse.status,200);assert.match(panelResponse.headers.get('content-security-policy'),/script-src 'self'/);
  browser=await chromium.launch({headless:true,args:['--no-proxy-server'],executablePath:process.env.CHROMIUM_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage();await page.goto(origin+'/index.html');const modules=await page.evaluate(async delivery=>({host:Object.keys(await import(delivery.hostModule.url)),renderer:Object.keys(await import(delivery.rendererModule.url))}),web.delivery);assert.ok(modules.host.includes('BrowserPreviewRuntime'));assert.ok(modules.renderer.includes('PreviewPlayer'));
 }finally{await browser?.close();await mf?.dispose();await rm(path,{recursive:true,force:true});}
});
