import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

const options={bundle:true,write:false,metafile:true,format:'esm',platform:'neutral',target:'es2024',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'};
function assertNativeBrowserExcluded(result){
 const inputs=Object.keys(result.metafile.inputs);
 assert.ok(inputs.some(path=>path.endsWith('services/project-views/isolated-browser.mjs')),'the real shared native program must be in the tested graph');
 assert.deepEqual(inputs.filter(path=>/node_modules[\\/](?:playwright|playwright-core)(?:[\\/]|$)/.test(path)),[],'Playwright and its Node dependency graph must stay in the image');
 assert.ok(result.outputFiles[0].text.length>0);
}

test('actual neutral Gateway and rollback bundles exclude native Playwright dependencies',{timeout:30000},async()=>{
 for(const entry of ['services/gateway/index.ts','services/gateway/forward-rollback.ts']){
  const result=await build({...options,entryPoints:[entry]});assertNativeBrowserExcluded(result);
  assert.ok(Object.values(result.metafile.outputs).some(output=>output.exports.includes('ProjectViewRuntime')),'real Gateway exports retain the runtime');
 }
});

test('real Runtime DO bundle starts in Workerd and owner lookup remains container-free',{timeout:30000},async t=>{
 const source=`export {ProjectViewRuntime} from './services/project-views/runtime-durable.ts';import {runtimeActorName} from './services/project-views/runtime-protocol.ts';export default {async fetch(request,env){return Response.json(await env.PROJECT_VIEW_RUNTIME.getByName(runtimeActorName('bundle-probe')).lookup({sessionId:'bundle-probe',actor:{userId:'fixture-owner',authVersion:1},workspaceId:'fixture-workspace'}));}};`;
 const result=await build({...options,stdin:{contents:source,sourcefile:'project-view-runtime-workerd-fixture.ts',resolveDir:process.cwd()}});assertNativeBrowserExcluded(result);
 let outbound=0;
 const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,telemetry:{enabled:false},cf:{},workers:[{config:{type:'worker',name:'project-view-runtime-bundle',compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:result.outputFiles[0].text}}},env:{PROJECT_VIEW_RUNTIME:{type:'durable-object',worker:'project-view-runtime-bundle',exportName:'ProjectViewRuntime'}},exports:{ProjectViewRuntime:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{outbound++;return new Response('disabled',{status:403});}}}}]});
 t.after(()=>mf.dispose());
 const response=await mf.dispatchFetch('https://runtime-bundle.test/');assert.equal(response.status,200);assert.equal(await response.json(),null);assert.equal(outbound,0);
});
