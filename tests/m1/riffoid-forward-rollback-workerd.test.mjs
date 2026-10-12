import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import http from 'node:http';
import {Miniflare} from 'miniflare';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {serializeSignedCookie} from 'better-call';
import {createAuth} from '../../services/gateway/auth.ts';
import {SqliteCatalog} from './sqlite-database.ts';
import {base64url,replayShard} from '../../services/entry/signature.ts';
const origin='https://m1.riff-demo.gaojihe.cn',secret='offline-forward-rollback-original-auth-secret-000000000';
const text=value=>({type:'text',value});
const schemas=['0001_catalog.sql','0002_auth.sql','0003_provisioning.sql','0004_operator_invitations.sql','0005_initial_operator.sql','0006_model_catalog.sql','0007_model_content_checks.sql','0010_project_budget_routes.sql','0012_project_archives.sql'];
async function buildWorker(path,adapter=false){const result=await build({...(adapter?{stdin:{contents:`import handler from './${path}';export * from './${path}';import {EntryReplayGuard as Base} from './services/entry/replay.ts';import {replayShard} from './services/entry/signature.ts';import {turnEventStream} from './services/gateway/events.ts';let aborted=0,polls=0;export class EntryReplayGuard extends Base{};export default {async fetch(native,env){const path=new URL(native.url).pathname;if(path==='/_fixture/state')return Response.json({aborted,polls});native.signal.addEventListener('abort',()=>aborted++,{once:true});if(path==='/_fixture/claim'){const v=await native.json();return Response.json(await env.ENTRY_REPLAY.getByName(replayShard(v.nonce)).claim(v));}const headers=new Headers(native.headers);headers.set('host','m1.riff-demo.gaojihe.cn');env.ASSETS={fetch:req=>new URL(req.url).search==='?stream=1'?turnEventStream({scope:{workspaceId:'offline-original',workspaceGeneration:1},afterSequence:12,signal:req.signal,pollMs:50,maxMs:20000,authorize:async()=>{polls++;},replay:async cursor=>({events:[],nextSequence:cursor,hasMore:false,oldestSequence:1,snapshotRequired:false})}):new Response('<!doctype html><title>original assets</title>',{headers:{'content-type':'text/html'}})};return handler.fetch(new Request('${origin}'+path+new URL(native.url).search,{method:native.method,headers,body:native.body,signal:native.signal}),env);}};`,resolveDir:process.cwd(),sourcefile:'rollback-local-adapter.mjs'}}:{entryPoints:[path]}),bundle:true,write:false,metafile:true,format:'esm',platform:'neutral',target:'es2024',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});return {code:result.outputFiles[0].text,exports:Object.values(result.metafile.outputs)[0].exports};}

test('forward rollback builds same DO exports and retains local namespace/data while restoring original auth/session/CSRF/assets',{timeout:45000},async()=>{
 const [original,rollback,originalAdapter,rollbackAdapter]=await Promise.all([buildWorker('services/gateway/index.ts'),buildWorker('services/gateway/forward-rollback.ts'),buildWorker('services/gateway/index.ts',true),buildWorker('services/gateway/forward-rollback.ts',true)]);
 assert.deepEqual(rollback.exports.sort(),original.exports.sort());assert.ok(rollback.exports.includes('EntryReplayGuard'));
 const directory=await mkdtemp(join(tmpdir(),'riffoid-forward-'));let mf,outbound=0;const fixture=new SqliteCatalog();
 const env={APP_ORIGIN:text(origin),CATALOG:{type:'d1',id:'same-original-catalog',name:'same-original-catalog'},ENTRY_REPLAY:{type:'durable-object',worker:'gateway',exportName:'EntryReplayGuard'},BETTER_AUTH_SECRET:text(secret),GOOGLE_CLIENT_ID:text('offline-client'),GOOGLE_CLIENT_SECRET:text('offline-secret')};
 function options(code,overrides={}){return {host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},workers:[{config:{type:'worker',name:'gateway',compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env','enable_request_signal'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:code}}},env:{...env,...overrides},exports:{EntryReplayGuard:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,unsafeDirectSockets:[{host:'127.0.0.1',port:0,proxy:false}],outboundService:{type:'fetcher',handler:()=>{outbound++;return new Response('offline-denied',{status:403});}}}}]};}
 const nonce=base64url(crypto.getRandomValues(new Uint8Array(32))),now=Date.now(),claim={nonce,issued:now,expires:now+30000};
 try{
  mf=new Miniflare(options(originalAdapter.code));await mf.ready;let db=await mf.getD1Database('CATALOG','gateway');
  for(const name of schemas){const schema=(await readFile('services/catalog/migrations/'+name,'utf8')).replace(/--[^\n]*/g,'');for(const sql of schema.match(/\s*CREATE\s+TRIGGER[\s\S]*?\bEND\s*;|[^;]+;/gi)||[])await db.prepare(sql.trim()).run();}
  fixture.sqlite.exec(await readFile('services/catalog/migrations/0002_auth.sql','utf8'));
  fixture.sqlite.prepare("INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES('offline-invite',?,'original@example.test',?,?)").run('a'.repeat(64),Date.now(),Date.now()+60000);
  const auth=createAuth({database:fixture.sqlite,catalog:fixture,origin,secret,googleClientId:'offline-client',googleClientSecret:'offline-secret'}),context=await auth.$context;
  const user=await context.internalAdapter.createUser({name:'Original Alice',email:'original@example.test',emailVerified:true},{method:'oauth',oauth:{providerId:'google'}}),session=await context.internalAdapter.createSession(user.id);
  for(const table of ['auth_user','auth_session','catalog_invitations'])for(const row of fixture.sqlite.prepare('SELECT * FROM '+table).all()){const keys=Object.keys(row);await db.prepare('INSERT INTO '+table+' ('+keys.map(k=>'"'+k+'"').join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row)).run();}
  const cookie=(await serializeSignedCookie(context.authCookies.sessionToken.name,session.token,secret)).split(';')[0];
  const before=(await db.prepare('SELECT * FROM auth_session').all()).results;
  assert.equal(await (await mf.dispatchFetch(origin+'/_fixture/claim',{method:'POST',body:JSON.stringify(claim)})).json(),'accepted');
  await mf.dispose();mf=new Miniflare(options(rollbackAdapter.code));await mf.ready;db=await mf.getD1Database('CATALOG','gateway');
  assert.equal(await (await mf.dispatchFetch(origin+'/_fixture/claim',{method:'POST',body:JSON.stringify(claim)})).json(),'replay','same local namespace retains original burned nonce through forward deployment');
  const sessionResponse=await mf.dispatchFetch(origin+'/api/auth/get-session',{headers:{cookie}});assert.equal(sessionResponse.status,200);const current=await sessionResponse.json();assert.equal(current.user.id,user.id);assert.equal(current.session.id,session.id);
  assert.deepEqual((await db.prepare('SELECT * FROM auth_session').all()).results,before,'original session not replaced or extended');
  const asset=await mf.dispatchFetch(origin+'/');assert.equal(asset.status,200);assert.match(await asset.text(),/original assets/);assert.match(asset.headers.get('content-security-policy'),/connect-src 'self'/);assert.equal(asset.headers.get('cache-control'),'no-store');
  const denied=await mf.dispatchFetch(origin+'/api/auth/sign-out',{method:'POST',headers:{origin:'https://app.riffoid.com','content-type':'application/json',cookie},body:'{}'});assert.equal(denied.status,403);assert.deepEqual((await db.prepare('SELECT * FROM auth_session').all()).results,before);
  const direct=await mf.unsafeGetDirectURL();const nativeStats=()=>fetch(new URL('/_fixture/state',direct)).then(r=>r.json());
  const client=http.request(new URL('/app.js?stream=1',direct));client.on('error',()=>{});const streaming=new Promise(resolve=>client.once('response',resolve));client.end();const response=await streaming;assert.equal(response.statusCode,200);await new Promise(resolve=>response.once('data',resolve));client.destroy();
  for(let count=0;count<100&&(await nativeStats()).aborted===0;count++)await new Promise(r=>setTimeout(r,10));assert.equal((await nativeStats()).aborted,1,'new flag on original single-origin Gateway emits native SSE abort');const stopped=(await nativeStats()).polls;await new Promise(r=>setTimeout(r,200));assert.equal((await nativeStats()).polls,stopped,'original observer stops without signed transport');
  for(const [field,value] of [['APP_TRANSPORT_ORIGIN','https://transport.example.test'],['TWO_ACCOUNT_AUTH_MODE','disabled'],['LEGACY_RECOVERY_ORIGIN',origin],['LEGACY_RECOVERY_UNTIL',new Date(now+3600000).toISOString()],['APP_ORIGIN','https://app.riffoid.com']]){await mf.dispose();mf=new Miniflare(options(rollbackAdapter.code,{[field]:text(value)}));await mf.ready;assert.equal((await mf.dispatchFetch(origin+'/')).status,503,field+' must not retain topology or wrong canonical');}
  assert.equal(outbound,0);
 }finally{if(mf)await mf.dispose();fixture.sqlite.close();await rm(directory,{recursive:true,force:true});}
});
