import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('actual Gateway serves the complete real Workspace asset dependency graph in Workerd', {timeout:30000}, async t=>{
 const files=Object.fromEntries(await Promise.all((await readdir('services/web')).filter(n=>/\.(?:html|js|css)$/.test(n)).map(async name=>['/'+name,await readFile('services/web/'+name,'utf8')])));
 // The fixture supplies only the backing static asset store. All routing,
 // allowlisting, response headers and rejected paths use the real Gateway.
 const source=`import gateway from './services/gateway/index.ts';const files=${JSON.stringify(files)};export default {fetch(request){return gateway.fetch(request,{APP_ORIGIN:'https://assets.test',ASSETS:{async fetch(req){const path=new URL(req.url).pathname;return new Response(files[path==='/'?'/index.html':path]??'missing',{status:files[path==='/'?'/index.html':path]?200:404,headers:{'content-type':path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'text/html'}});}}});}};`;
 const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'workspace-assets-fixture.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,telemetry:{enabled:false},cf:{},workers:[{config:{type:'worker',name:'workspace-assets',compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env'],manifest:{mainModule:'gateway.mjs',modules:{'gateway.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}}},dev:{unsafeRegisterWorker:false}}]});t.after(()=>mf.dispose());
 const queue=['/index.html'],seen=new Set();
 while(queue.length){const path=queue.shift();if(seen.has(path))continue;seen.add(path);const response=await mf.dispatchFetch('https://assets.test'+path);assert.equal(response.status,200,path);assert.equal(await response.text(),files[path],path);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cache-control'),'no-store');
  const contents=files[path];const references=path.endsWith('.html')?[...contents.matchAll(/(?:src|href)=["'](\.\/[^"']+)["']/g)].map(m=>m[1]):path.endsWith('.js')?[...contents.matchAll(/(?:from\s*|import\s*)["'](\.\/[^"']+)["']/g)].map(m=>m[1]):[];
  for(const relative of references)queue.push(new URL(relative,'https://assets.test'+path).pathname);
 }
 assert.ok(seen.has('/layout.js'));assert.ok(seen.has('/evidence.js'));assert.ok(seen.has('/export.js'));
 assert.equal((await mf.dispatchFetch('https://assets.test/private.js')).status,404);
 assert.equal((await mf.dispatchFetch('https://assets.test/layout.js',{method:'POST'})).status,404);
});
