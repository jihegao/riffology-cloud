import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {CANONICAL_APP_ORIGIN as canonical,EXISTING_APP_ORIGIN as legacy,publicHopProbe} from '../../scripts/m1/riffoid-public-hop.ts';

test('unchanged real Gateway in local Workerd cannot serve a canonical app via a transparent public hop',{timeout:45_000},async()=>{
  const bundle=await build({entryPoints:['services/gateway/index.ts'],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});
  let outbound=0;
  const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},workers:[{
    config:{type:'worker',name:'two-account-offline',compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env','global_fetch_strictly_public'],manifest:{mainModule:'gateway.mjs',modules:{'gateway.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{
      CATALOG:{type:'d1',id:'two-account-offline',name:'two-account-offline'},APP_ORIGIN:{type:'text',value:legacy},
      BETTER_AUTH_SECRET:{type:'text',value:'offline-only-workerd-auth-key-0000000000000000'},GOOGLE_CLIENT_ID:{type:'text',value:'offline-only'},GOOGLE_CLIENT_SECRET:{type:'text',value:'offline-only'},
    }},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{outbound++;return new Response('offline-outbound-denied',{status:403});}}},
  }]});
  try{
    await mf.ready;
    const database=await mf.getD1Database('CATALOG','two-account-offline');
    for(const filename of ['0001_catalog.sql','0002_auth.sql']){
      const schema=(await readFile(`services/catalog/migrations/${filename}`,'utf8')).replace(/--[^\n]*/g,'');
      for(const statement of schema.match(/\s*CREATE\s+TRIGGER[\s\S]*?\bEND\s*;|[^;]+;/gi)||[])await database.prepare(statement.trim()).run();
    }
    const direct=await mf.dispatchFetch(canonical+'/api/me');assert.equal(direct.status,403);
    const request=publicHopProbe(new Request(canonical+'/api/auth/sign-out',{method:'POST',headers:{origin:canonical,'sec-fetch-site':'same-origin','content-type':'application/json'},body:'{}'}));
    const response=await mf.dispatchFetch(request.url,{method:request.method,headers:request.headers,body:await request.text()});
    assert.equal(response.status,403);assert.equal((await response.json()).error,'origin_denied');
    const anonymous=await mf.dispatchFetch(legacy+'/api/auth/get-session');assert.equal(anonymous.status,200);assert.equal(await anonymous.json(),null,'an anonymous 200 is not a successful migration');
    const forged=await mf.dispatchFetch(legacy+'/api/auth/sign-out',{method:'POST',headers:{origin:canonical,'x-forwarded-host':'app.riffoid.com','x-forwarded-proto':'https','content-type':'application/json'},body:'{}'});
    assert.equal(forged.status,403);assert.equal(outbound,0);
  }finally{await mf.dispose();}
});
