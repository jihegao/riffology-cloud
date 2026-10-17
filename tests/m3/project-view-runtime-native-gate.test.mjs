import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {projectViewRuntimeDigest} from '../../services/project-views/runtime-protocol.ts';

// Exercise the actual Runtime.start/native wiring. Only the Cloudflare base
// class and platform container API are synthetic; no native/container executes.
const compiled=await build({entryPoints:['services/project-views/runtime-durable.ts'],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'synthetic-do-base',setup(build){build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'base',namespace:'synthetic'}));build.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:'export class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }',loader:'js'}));}}]});
const directory=await mkdtemp(join(tmpdir(),'project-view-native-gate-')),modulePath=join(directory,'runtime.mjs');after(()=>rm(directory,{recursive:true,force:true}));await writeFile(modulePath,compiled.outputFiles[0].text);
const {ProjectViewRuntime}=await import(pathToFileURL(modulePath).href);
const pin='c'.repeat(64),image='registry.example/view@sha256:'+'d'.repeat(64),encoder=new TextEncoder();
const report=()=>({schema:'project-view-preflight/v1',contextReceiptSha256:pin,files:176,bytes:100,uid:10001,gid:10001,chromium:'153.0.8010.12'});
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
async function until(fn){for(let n=0;n<40&&!fn();n++)await new Promise(resolve=>setImmediate(resolve));assert.ok(fn());}
async function input(){
 const html='<p>private project marker</p>',view={id:'home',title:'Home',entrypoint:'app/home.html'},sha=createHash('sha256').update(html).digest('hex');
 const body={schema:'project.view-package/v1',scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},revisionId:'revision',filesSha256:'a'.repeat(64),manifest:{schema:'project.views/v1',files:['app/home.html'],views:[view]},assets:[{path:'app/home.html',mediaType:'text/html',base64:btoa(html),sourceSha256:sha,sha256:sha}]};
 const packageIdentity=await projectViewRuntimeDigest(body);
 return {identity:{schema:'project.view-session/v1',sessionId:'native-gate',operationId:'operation',scope:body.scope,actor:{userId:'owner',authVersion:1},packageIdentity,viewId:'home',policyHash:'b'.repeat(64)},pkg:{...body,packageIdentity},view,expiresAt:Date.now()+60_000};
}
async function fixture(t,{inspection={image:''},output=JSON.stringify(report())+'\n',gated=false,browserGated=false}={}){
 const db=new DatabaseSync(':memory:'),exit=deferred(),browser=deferred();let controller,running=false,destroys=0;const executions=[],writes=[];
 const stdout=new ReadableStream({start(value){controller=value;if(!gated){value.enqueue(encoder.encode(output));value.close();}}});
 const storage={sql:{exec(query,...args){const statement=db.prepare(query),rows=statement.columns().length?statement.all(...args):(statement.run(...args),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}},async sync(){},async setAlarm(){},async deleteAlarm(){}};
 const container={get running(){return running;},start(options){assert.equal(options.enableInternet,false);assert.deepEqual(options.env,{});running=true;},async setInactivityTimeout(){},monitor:()=>new Promise(()=>{}),async inspect(){return inspection;},async destroy(){destroys++;running=false;},async exec(argv,options){executions.push({argv,options});assert.deepEqual(options.env,{});assert.equal(options.user,'10001:10001');
  if(argv.length===5){assert.ok(argv[3].includes('project-view-runtime-preflight-denied'));assert.equal(argv[4],pin);assert.equal(options.stdin,undefined);return {stdout,exitCode:gated?exit.promise:Promise.resolve(0)};}
  assert.equal(argv.length,4);assert.ok(argv[3].includes('isolated-browser-closed'));const process={stdin:new WritableStream({write(bytes){writes.push(JSON.parse(new TextDecoder().decode(bytes)));}}),stdout:new ReadableStream(),exitCode:new Promise(()=>{})};
  if(browserGated){await browser.promise;}return process;
 }};
 const ctx={id:'synthetic-actor',storage,container,waitUntil(work){void work.catch(()=>{});}};
 const env={PROJECT_VIEW_RUNTIME:{idFromName:()=>({equals:id=>id===ctx.id})},PROJECT_VIEW_CAPACITY:{getByName:()=>({async acquire(){},async release(){}})},PROJECT_VIEW_RUNTIME_POLICY_HASH:'b'.repeat(64),PROJECT_VIEW_RUNTIME_IMAGE:image,PROJECT_VIEW_RUNTIME_CONTEXT_RECEIPT_SHA256:pin};
 const runtime=new ProjectViewRuntime(ctx,env),value=await input();
 t.after(async()=>{await runtime.close({identity:value.identity,reason:'fixture-finished'}).catch(()=>{});db.close();});
 return {runtime,value,executions,writes,exit,browser,controller,get destroys(){return destroys;}};
}

test('actual Runtime waits for bounded preflight EOF and exit before any browser exec or private init',async t=>{
 const f=await fixture(t,{gated:true}),starting=f.runtime.start(f.value);await until(()=>f.executions.length===1);
 assert.equal(f.executions[0].argv.some(arg=>arg.includes('private project marker')),false);assert.deepEqual(f.writes,[]);
 f.controller.enqueue(encoder.encode(JSON.stringify(report())+'\n'));f.controller.close();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.executions.length,1);assert.deepEqual(f.writes,[]);
 f.exit.resolve(0);assert.equal((await starting).status,'running');assert.equal(f.executions.length,2);assert.equal(f.writes[0].type,'init');assert.equal(f.writes[0].package.packageIdentity,f.value.pkg.packageIdentity);
});

test('actual Runtime rejects malformed preflight, missing inspection and mismatched nonempty image without private init',async t=>{
 for(const options of [{output:'{}\n'},{output:'x'.repeat(4097)},{inspection:null},{inspection:{image:'registry.example/wrong@sha256:'+'e'.repeat(64)}}])await t.test(JSON.stringify(options).slice(0,80),async t=>{
  const f=await fixture(t,options),state=await f.runtime.start(f.value);assert.notEqual(state.status,'running');assert.equal(f.executions.length,1);assert.deepEqual(f.writes,[]);assert.ok(f.destroys>0);assert.equal(state.cleanupConfirmed,false,'failed startup retains the original assignment guard');
 });
});

test('closing the original actor while preflight is pending blocks every later browser exec and init',async t=>{
 const f=await fixture(t,{gated:true}),starting=f.runtime.start(f.value);await until(()=>f.executions.length===1);
 await f.runtime.close({identity:f.value.identity,reason:'revoked-during-preflight'});assert.ok(f.destroys>0);
 f.controller.enqueue(encoder.encode(JSON.stringify(report())+'\n'));f.controller.close();f.exit.resolve(0);
 assert.notEqual((await starting).status,'running');assert.equal(f.executions.length,1);assert.deepEqual(f.writes,[]);
});

test('a browser exec handle returned after original actor close cannot send private init',async t=>{
 const f=await fixture(t,{browserGated:true}),starting=f.runtime.start(f.value);await until(()=>f.executions.length===2);
 await f.runtime.close({identity:f.value.identity,reason:'revoked-during-browser-exec'});assert.ok(f.destroys>0);
 f.browser.resolve();assert.notEqual((await starting).status,'running');assert.deepEqual(f.writes,[]);
});
