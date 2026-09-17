import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadonlyApi,readonlyApiPath} from './g4-operator-hooks.mjs';
const auth={origin:'https://app.example',cookie:'not-used-in-cdp'};
test('operator API admits only fixed GET paths; default transport keeps cookie and timeout',async()=>{
 for(const p of ['/api/me','/api/tenants/tenant-a/g4-window','/api/workspaces/workspace-a/g4-compute-counts'])assert.equal(readonlyApiPath(p),p);
 for(const p of ['/api/tasks','https://other/api/me','/api/me?x=1','/api/tenants/%2e%2e/g4-window','/api/workspaces/a%2fb/g4-compute-counts'])assert.throws(()=>readonlyApiPath(p));
 let called;const t=await createReadonlyApi(auth,{fetchImpl:async(url,opts)=>{called={url,opts};return {status:200,json:async()=>({userId:'owned'})};}});assert.deepEqual(await t.get('/api/me'),{userId:'owned'});assert.equal(called.opts.method,'GET');assert.equal(called.opts.redirect,'error');assert.equal(called.opts.headers.cookie,auth.cookie);await t.close();
});
test('CDP reuses existing origin page, restores proxy for CLI, and closes client only',async()=>{
 const previous=process.env.HTTPS_PROXY;process.env.HTTPS_PROXY='test-proxy';let closes=0,args;
 const page={url:()=>auth.origin+'/workspace',evaluate:async(fn,input)=>{args={source:String(fn),input};return {userId:'owned'};}};
 const browser={contexts:()=>[{pages:()=>[{url:()=> 'https://other.example'},page]}],close:async()=>{closes++;}};
 try{const t=await createReadonlyApi(auth,{cdpUrl:'http://127.0.0.1:9237',connect:async(url,opts)=>{assert.equal(process.env.HTTPS_PROXY,undefined);assert.equal(opts.timeout,10000);return browser;}});assert.equal(process.env.HTTPS_PROXY,'test-proxy');await t.get('/api/me');assert.deepEqual(args.input,{origin:auth.origin,path:'/api/me'});assert.match(args.source,/credentials:'include'/);assert.match(args.source,/method:'GET'/);assert.equal(args.source.includes('cookie'),false);await assert.rejects(t.get('/api/tasks'));await t.close();assert.equal(closes,1);
 await assert.rejects(createReadonlyApi(auth,{cdpUrl:'http://127.0.0.1:9237',connect:async()=>{throw Error('connect-failed');}}),/connect-failed/);assert.equal(process.env.HTTPS_PROXY,'test-proxy');
 await assert.rejects(createReadonlyApi(auth,{cdpUrl:'http://external.example:9237',connect:async()=>browser}),/cdp-endpoint/);
 }finally{if(previous===undefined)delete process.env.HTTPS_PROXY;else process.env.HTTPS_PROXY=previous;}
});
