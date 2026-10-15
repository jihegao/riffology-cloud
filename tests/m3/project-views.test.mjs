import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildProjectViews,parseProjectViews} from '../../services/project-views/package.ts';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {createProjectViewBroker,verifyProjectViewPackage} from '../../services/web/project-views.js';
import worker from '../../services/browser-preview/execution/index.ts';
import {PROJECT_VIEW_FRAME_PATH} from '../../services/project-views/frame.mjs';
import {scope,manifest,projectFiles,packaged} from './project-views-fixture.mjs';
test('no model contract is required; immutable package freezes complete local modules/CSS/media/data closure',async()=>{
 const {pkg,bytes,source}=await packaged();assert.equal(pkg.manifest.views.length,2);assert.equal(pkg.revisionId,'revision-a');
 assert.match(Buffer.from(pkg.assets.find(a=>a.path==='app/main.mjs').base64,'base64').toString(),/https:\/\/project.invalid\/app\/value.mjs/);
 await verifyProjectViewPackage(pkg,scope);await assert.rejects(verifyProjectViewPackage(pkg,{...scope,projectId:'other'}),/scope/);
 const bad=structuredClone(pkg);bad.assets[0].base64=btoa('tampered');await assert.rejects(verifyProjectViewPackage(bad,scope),/digest/);
 await assert.rejects(buildProjectViews({...source,revision:{...source.revision,filesSha256:'c'.repeat(64)}},bytes),/source-mismatch/);
});
test('undeclared imports, external packages, computed dynamic imports and traversal fail before delivery',async()=>{
 for(const code of ['import "./missing.mjs";','import "https://example.test/lib.mjs";','const a="./value.mjs";import(a);'])await assert.rejects(packaged({...projectFiles(),'app/main.mjs':code}),/project-view-/);
 assert.throws(()=>parseProjectViews({...manifest,files:['../secret.html']}),/manifest-invalid/);
});
test('fixed frame stays on approved independent origin and refuses credentials/query before delivery',async()=>{
 const env={APP_ORIGIN:'http://localhost:8011',EXECUTION_ORIGIN:'http://127.0.0.1:8012',ALLOW_LOCALHOST_HTTP:'true',RUNTIME_ASSETS:{fetch:async()=>{throw Error('unused');}}};
 const production={...env,APP_ORIGIN:'https://app.example.com',EXECUTION_ORIGIN:'https://pages.example.net',ALLOW_LOCALHOST_HTTP:'false'};
 assert.equal((await worker.fetch(new Request(production.EXECUTION_ORIGIN+PROJECT_VIEW_FRAME_PATH),production)).status,503);
 const response=await worker.fetch(new Request(env.EXECUTION_ORIGIN+PROJECT_VIEW_FRAME_PATH),env);assert.equal(response.status,200);
 assert.match(response.headers.get('content-security-policy'),/connect-src 'none'/);assert.match(response.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.doesNotMatch(response.headers.get('content-security-policy'),/allow-same-origin/);
 for(const headers of [{Cookie:'session=secret'},{Authorization:'Bearer secret'}])assert.equal((await worker.fetch(new Request(env.EXECUTION_ORIGIN+PROJECT_VIEW_FRAME_PATH,{headers}),env)).status,404);
 assert.equal((await worker.fetch(new Request(env.EXECUTION_ORIGIN+PROJECT_VIEW_FRAME_PATH+'?anything=1'),env)).status,404);
 assert.equal((await worker.fetch(new Request(env.APP_ORIGIN+PROJECT_VIEW_FRAME_PATH),{...env,EXECUTION_ORIGIN:env.APP_ORIGIN})).status,503);
});
test('broker binds generation and package; forged scope, cross-project path, writes and late results never deliver data',async()=>{
 const {pkg}=await packaged(),messages=[];let current=true,release;
 const port={postMessage:m=>messages.push(m),close(){},start(){},onmessage:null};
 const broker=createProjectViewBroker({port,pkg,isCurrent:()=>current,readAsset:()=>new Promise(r=>{release=r;})});
 await port.onmessage({data:{id:1,type:'files.list',scope:{projectId:'other'}}});assert.equal(messages.at(-1).error,'request-denied');
 await port.onmessage({data:{id:2,type:'files.read',path:'../other/secret'}});assert.equal(messages.at(-1).error,'request-denied');
 await port.onmessage({data:{id:3,type:'write',path:'app/home.html'}});assert.equal(messages.at(-1).error,'request-denied');
 const pending=port.onmessage({data:{id:4,type:'files.read',path:'docs/data.json'}});await Promise.resolve();const before=messages.length;current=false;release(new TextEncoder().encode('late secret'));await pending;assert.equal(messages.length,before);
 broker.close();assert.equal(broker.closed,true);
});


test('broker read hashes the exact transformed bytes and reports failures without accepting later success',async()=>{
 const {pkg}=await packaged(),messages=[],states=[];
 const port={postMessage:m=>messages.push(m),close(){},start(){},onmessage:null};
 const broker=createProjectViewBroker({port,pkg,isCurrent:()=>true,onState:s=>states.push(s)});
 await port.onmessage({data:{type:'files.read',id:1,path:'app/main.mjs'}});
 const read=messages.at(-1).value,asset=pkg.assets.find(a=>a.path===read.path);
 assert.equal(read.sha256,createHash('sha256').update(read.text).digest('hex'));
 assert.equal(read.sha256,asset.sha256);assert.equal(read.sourceSha256,asset.sourceSha256);assert.notEqual(read.sha256,read.sourceSha256);
 await port.onmessage({data:{type:'failed',error:'UNTRUSTED_ERROR_TEXT'}});assert.deepEqual(states,[]);
 await port.onmessage({data:{type:'failed',error:'page-script-failed'}});
 await port.onmessage({data:{type:'installed'}});assert.deepEqual(states,['failed']);
 broker.close();
});

test('artifact broker rejects keys/scope/writes and drops delayed replies after cancellation or generation change',async()=>{
 const {pkg}=await packaged(),messages=[];let current=true,release,calls=0;
 const port={postMessage:m=>messages.push(m),close(){},start(){},onmessage:null};
 const broker=createProjectViewBroker({port,pkg,isCurrent:()=>current,readArtifacts:async()=>{calls++;return new Promise(r=>{release=r;});}});
 for(const [id,m]of [
  [1,{type:'artifacts.read',artifactId:'tool-artifacts/private-key',offset:0}],
  [2,{type:'artifacts.read',artifactId:'artifact-'+'a'.repeat(60),offset:0,scope:{projectId:'other'}}],
  [3,{type:'artifacts.list',cursor:'untrusted cursor'}],
  [4,{type:'artifacts.delete'}],
 ]){await port.onmessage({data:{id,...m}});assert.equal(messages.at(-1).error,'request-denied');}
 assert.equal(calls,0);
 const pending=port.onmessage({data:{id:5,type:'artifacts.read',artifactId:'artifact-'+'a'.repeat(60),offset:0}});await Promise.resolve();const before=messages.length;current=false;release({base64:btoa('late private artifact')});await pending;assert.equal(messages.length,before);
 broker.close();
});

test('subscription cancellation fences pending authorization, initial reads and published updates',async()=>{
 const {pkg}=await packaged();
 for(const stage of ['authorization','initial','publish']){
  const messages=[];let release,block=false;
  const port={postMessage:m=>messages.push(m),close(){},start(){},onmessage:null};
  const broker=createProjectViewBroker({port,pkg,isCurrent:()=>true,authorize:async()=>{if(stage==='authorization'&&block)await new Promise(r=>{release=r;});},readArtifacts:async()=>{if(stage!=='authorization'&&block)await new Promise(r=>{release=r;});return {items:[{artifactId:'private'}],nextCursor:null,version:'a'.repeat(64)};}});
  if(stage==='publish')await port.onmessage({data:{id:1,type:'updates.subscribe'}});
  block=true;
  const pending=stage==='publish'?broker.publish():port.onmessage({data:{id:1,type:'updates.subscribe'}});
  for(let n=0;n<5&&!release;n++)await Promise.resolve();assert.equal(typeof release,'function');
  block=false;await port.onmessage({data:{id:2,type:'updates.cancel'}});const afterCancel=messages.length;
  release();await pending;
  assert.equal(messages.slice(afterCancel).some(m=>m.type==='snapshot'||m.value?.subscribed===true),false,stage);
  broker.close();
 }
});
