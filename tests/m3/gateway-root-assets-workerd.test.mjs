import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('production Gateway root and admin aliases serve explicit HTML assets for GET and HEAD with htmlHandling none',{timeout:30000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'gateway-root-assets-'));
 const index=await readFile('services/web/index.html','utf8'),admin=await readFile('services/web/admin.html','utf8');
 await Promise.all([writeFile(join(directory,'index.html'),index),writeFile(join(directory,'admin.html'),admin)]);
 const bundle=await build({entryPoints:['services/gateway/index.ts'],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});
 let mf;
 try{
  mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},workers:[{config:{type:'worker',name:'gateway-root-assets',compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'gateway.mjs',modules:{'gateway.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},assets:{directory,hasUserWorker:true,runWorkerFirst:true,htmlHandling:'none',notFoundHandling:'none'},env:{ASSETS:{type:'assets'},APP_ORIGIN:{type:'text',value:'https://root-assets.test'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('outbound-disabled',{status:403})}}}]});
  for(const [path,expected] of [['/',index],['/index.html',index],['/admin',admin],['/admin.html',admin]]){
   const get=await mf.dispatchFetch('https://root-assets.test'+path);assert.equal(get.status,200,path);assert.equal(await get.text(),expected,path);assert.equal(get.headers.get('cache-control'),'no-store');assert.equal(get.headers.get('x-content-type-options'),'nosniff');assert.match(get.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(get.headers.get('location'),null);
   const head=await mf.dispatchFetch('https://root-assets.test'+path,{method:'HEAD'});assert.equal(head.status,200,path+' HEAD');assert.equal(await head.text(),'');assert.equal(head.headers.get('content-type'),get.headers.get('content-type'));assert.equal(head.headers.get('etag'),get.headers.get('etag'));assert.equal(head.headers.get('cache-control'),'no-store');assert.equal(head.headers.get('content-security-policy'),get.headers.get('content-security-policy'));
  }
  for(const path of ['/','/admin'])assert.equal((await mf.dispatchFetch('https://root-assets.test'+path,{method:'POST'})).status,404);
  assert.equal((await mf.dispatchFetch('https://root-assets.test/private.html')).status,404);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
