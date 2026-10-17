import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {PROJECT_VIEW_FRAME_HTML,PROJECT_VIEW_FRAME_PATH} from '../../services/project-views/frame.mjs';

test('actual signed Entry delivers the native frame and module through canonical APP while unsigned transport stays closed',{timeout:45000},async t=>{
 const canonical='https://app.example.test',transport='https://transport.example.test';
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const strict=key=>Object.fromEntries(Object.entries(key).filter(([name])=>['kty','crv','x','y','d'].includes(name)));
 const privateKey=JSON.stringify(strict(await crypto.subtle.exportKey('jwk',pair.privateKey))),publicKeys=JSON.stringify({fixture:strict(await crypto.subtle.exportKey('jwk',pair.publicKey))});
 const module=await readFile('services/web/project-view-local.js','utf8'),index=await readFile('services/web/index.html','utf8');
 const now=Date.now(),policy=JSON.stringify({schema:'project-view-browser-policy/v1',enabled:true,startsAt:now-1000,endsAt:now+600000,dataEgress:'accepted',grants:[{scope:{tenantId:'t',projectId:'p',workspaceId:'w',workspaceGeneration:1},actor:{userId:'a',authVersion:1}}]});
 const options={bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'};
 const gatewaySource=`import handler from './services/gateway/index.ts';export * from './services/gateway/index.ts';const files=${JSON.stringify({'/project-view-local.js':module,'/index.html':index})};export default {fetch(request,env){const headers=new Headers(request.headers);headers.set('host',new URL(request.url).host);return handler.fetch(new Request(request,{headers}),{...env,ASSETS:{fetch(req){const path=new URL(req.url).pathname;return new Response(req.method==='HEAD'?null:files[path]??'missing',{status:files[path]?200:404,headers:{'content-type':path.endsWith('.js')?'text/javascript':'text/html'}});}}});}};`;
 const entrySource="import handler from './services/entry/index.ts';export default {fetch(request,env){const headers=new Headers(request.headers);headers.set('host',new URL(request.url).host);headers.set('cf-connecting-ip','198.51.100.23');headers.delete('cf-worker');return handler.fetch(new Request(request,{headers}),env);}};";
 const [gatewayCode,entryCode]=await Promise.all([gatewaySource,entrySource].map(contents=>build({...options,stdin:{contents,resolveDir:process.cwd()}}).then(r=>r.outputFiles[0].text)));
 const text=value=>({type:'text',value});
 const worker=(name,code,env,handler)=>new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},workers:[{config:{type:'worker',name,compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env','enable_request_signal'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:code}}},env,...(env.ENTRY_REPLAY?{exports:{EntryReplayGuard:{type:'durable-object',storage:'sqlite'}}}:{})},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler}}}]});
 let external=0,hops=0,lastHop;
 const gateway=worker('native-browser-gateway',gatewayCode,{APP_ORIGIN:text(canonical),APP_TRANSPORT_ORIGIN:text(transport),TWO_ACCOUNT_AUTH_MODE:text('signed-entry-v1'),ENTRY_SIGNING_PUBLIC_KEYS_JSON:text(publicKeys),ENTRY_REPLAY:{type:'durable-object',worker:'native-browser-gateway',exportName:'EntryReplayGuard'},PROJECT_VIEW_BROWSER_POLICY_JSON:text(policy)},()=>{external++;return new Response('external-denied',{status:403});});
 t.after(()=>gateway.dispose());await gateway.ready;
 const entry=worker('native-browser-entry',entryCode,{APP_ORIGIN:text(canonical),APP_TRANSPORT_ORIGIN:text(transport),TWO_ACCOUNT_AUTH_MODE:text('signed-entry-v1'),ENTRY_NATIVE_IP_BOUNDARY:text('cloudflare-direct-visitor-waf-v1'),ENTRY_SIGNING_KEY_ID:text('fixture'),ENTRY_SIGNING_PRIVATE_JWK:text(privateKey)},async request=>{
  assert.equal(new URL(request.url).origin,transport);hops++;
  const init={method:request.method,headers:new Headers(request.headers),...(['GET','HEAD'].includes(request.method)?{}:{body:await request.arrayBuffer()})};lastHop={url:request.url,init};
  return gateway.dispatchFetch(request.url,init);
 });
 t.after(()=>entry.dispose());await entry.ready;
 for(const method of ['GET','HEAD']){
  const response=await entry.dispatchFetch(canonical+PROJECT_VIEW_FRAME_PATH,{method,headers:{cookie:'synthetic-only=value'}});
  assert.equal(response.status,200);assert.equal(await response.text(),method==='HEAD'?'':PROJECT_VIEW_FRAME_HTML);
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors https:\/\/app.example.test/);assert.match(response.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.equal(response.headers.has('set-cookie'),false);
 }
 const script=await entry.dispatchFetch(canonical+'/project-view-local.js');assert.equal(script.status,200);assert.equal(await script.text(),module);
 const root=await entry.dispatchFetch(canonical+'/');assert.equal(root.status,200);assert.match(root.headers.get('content-security-policy'),/frame-src 'self'/);
 assert.equal((await gateway.dispatchFetch(lastHop.url,lastHop.init)).status,403,'the original signed proof cannot replay');
 for(const path of [PROJECT_VIEW_FRAME_PATH,'/project-view-local.js']){
  assert.equal((await gateway.dispatchFetch(transport+path)).status,403,'no unsigned transport shortcut');
  assert.equal((await gateway.dispatchFetch(canonical+path)).status,403,'canonical host alone is not signed provenance');
 }
 assert.equal((await entry.dispatchFetch(canonical+PROJECT_VIEW_FRAME_PATH+'?x=1')).status,404);
 assert.equal((await entry.dispatchFetch(canonical+PROJECT_VIEW_FRAME_PATH,{method:'POST',headers:{origin:canonical},body:'{}'})).status,404);
 assert.equal(external,0);assert.ok(hops>=6);
});
