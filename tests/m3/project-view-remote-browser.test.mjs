import test from 'node:test';
import assert from 'node:assert/strict';
import {remoteBrowserFixture,installRemoteClient} from './project-view-remote-fixture.mjs';

test('remote canvas uses a real MessageChannel broker round trip and validated PNG; no project iframe or HTML enters app DOM',async t=>{
 const f=await remoteBrowserFixture(t),p=f.page;await installRemoteClient(p);
 await p.evaluate(()=>remoteFixture.start({seed:{polls:[{messages:[{type:'installed'},{id:1,type:'files.read',path:'docs/data.json'}],frame:remoteFixture.frame()}]}}));
 await p.waitForFunction(()=>remoteFixture.sessions['session-1']?.broker.some(m=>m.id===1));
 await p.waitForFunction(()=>remoteFixture.draws.length===1);
 const state=await p.evaluate(()=>({requests:remoteFixture.requests,reply:remoteFixture.sessions['session-1'].broker.find(m=>m.id===1),states:remoteFixture.states,pixel:[...document.querySelector('canvas').getContext('2d').getImageData(200,200,1,1).data],iframes:document.querySelectorAll('iframe').length,executed:window.PROJECT_HTML_MUST_NOT_EXECUTE,body:document.body.textContent,decodes:remoteFixture.decodes,bitmapCloses:remoteFixture.bitmapCloses}));
 assert.equal(state.reply.value.text,'{"label":"saved project data"}');assert.deepEqual(state.pixel,[3,71,207,255]);
 assert.deepEqual(state.states,[{key:'one',state:'ready'}]);assert.equal(state.iframes,0);assert.equal(state.executed,undefined);assert.equal(state.body.includes('private project page'),false);
 assert.equal(state.requests[0].body.package.schema,'project.view-package/v1');assert.equal(state.requests[0].body.view.id,'home');assert.equal(state.requests[0].authorization,null);
 for(const r of state.requests.slice(1)){assert.equal(r.authorization,'Bearer fixture-session-secret-1');assert.equal(r.url,f.executionOrigin+'/project-views/v1/sessions/session-1');assert.equal(r.method,'POST');}
 assert.equal(state.decodes,1);assert.equal(state.bitmapCloses,1);assert.deepEqual(f.errors,[]);assert.deepEqual(f.nativeRemoteRequests,[]);
 await p.evaluate(()=>remoteFixture.clients.one.close());
});

test('real canvas events serialize bounded click, key, text and wheel input only to the originating session',async t=>{
 const f=await remoteBrowserFixture(t),p=f.page;await installRemoteClient(p);await p.evaluate(()=>remoteFixture.start());await p.waitForFunction(()=>remoteFixture.draws.length===1);
 const canvas=p.locator('canvas');await canvas.click({position:{x:200,y:150}});await canvas.press('Enter');await canvas.press('a');
 await p.evaluate(()=>{
  const canvas=document.querySelector('canvas'),rect=canvas.getBoundingClientRect();
  canvas.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:'你好 🌿',bubbles:true,cancelable:true}));
  canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:2500,bubbles:true,cancelable:true}));
  canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-2500,bubbles:true,cancelable:true}));
  canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:0.5,bubbles:true,cancelable:true}));
  canvas.dispatchEvent(new MouseEvent('click',{clientX:rect.left-1,clientY:rect.top+2,bubbles:true}));
  canvas.dispatchEvent(new MouseEvent('click',{clientX:rect.right,clientY:rect.bottom,bubbles:true}));
  canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'F12',bubbles:true}));
  canvas.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:'界'.repeat(342),bubbles:true,cancelable:true}));
  const invalidWheel=new Event('wheel',{bubbles:true,cancelable:true});Object.defineProperty(invalidWheel,'deltaY',{value:Infinity});canvas.dispatchEvent(invalidWheel);
 });
 await p.waitForFunction(()=>remoteFixture.sessions['session-1'].input.length>=6);
 const inputs=await p.evaluate(()=>remoteFixture.sessions['session-1'].input);
 assert.deepEqual(inputs,[{kind:'click',x:400,y:300},{kind:'key',key:'Enter'},{kind:'text',text:'a'},{kind:'text',text:'你好 🌿'},{kind:'wheel',deltaY:1000},{kind:'wheel',deltaY:-1000},{kind:'wheel',deltaY:0.5}]);
 await p.evaluate(()=>remoteFixture.clients.one.close());assert.deepEqual(f.errors,[]);assert.deepEqual(f.nativeRemoteRequests,[]);
});

test('same-app, external or malformed execution origins and unknown transports are rejected before any transport call',async t=>{
 const f=await remoteBrowserFixture(t),p=f.page;await installRemoteClient(p);
 const result=await p.evaluate(async()=>{
  const invalid=[{executionOrigin:location.origin,transport:'isolated-browser/v1'},{executionOrigin:'https://outside.invalid',transport:'isolated-browser/v1'},{executionOrigin:remoteFixture.executionOrigin+'/path',transport:'isolated-browser/v1'},{executionOrigin:remoteFixture.executionOrigin+'?token=x',transport:'isolated-browser/v1'},{executionOrigin:remoteFixture.executionOrigin+'#x',transport:'isolated-browser/v1'},{executionOrigin:remoteFixture.executionOrigin.replace('http://','http://user:secret@'),transport:'isolated-browser/v1'},{executionOrigin:remoteFixture.executionOrigin,transport:'legacy-iframe/v1'}];
  const results=[];for(let i=0;i<invalid.length;i++){const before=remoteFixture.errors.length;let threw=false;try{await remoteFixture.start({key:'invalid-'+i,delivery:invalid[i]});}catch{threw=true;}results.push(threw||remoteFixture.errors.length>before);await remoteFixture.clients['invalid-'+i]?.close();}
  return {results,requests:remoteFixture.requests};
 });
 assert.deepEqual(result.results,Array(7).fill(true));assert.deepEqual(result.requests,[]);assert.deepEqual(f.nativeRemoteRequests,[]);
});

test('malformed, oversized and wrong-sized PNG frames fail closed without drawing project bytes',async t=>{
 for(const kind of ['invalid-base64','encoded-too-large','claimed-size','decoded-size'])await t.test(kind,async t=>{
  const f=await remoteBrowserFixture(t),p=f.page;await installRemoteClient(p);
  await p.evaluate(async kind=>{
   let frame=remoteFixture.frame();if(kind==='invalid-base64')frame.base64='not-a-png!';if(kind==='encoded-too-large')frame.base64='A'.repeat(3*1024*1024);if(kind==='claimed-size')frame.width=801;if(kind==='decoded-size')frame.base64=remoteFixture.makePng(1,1);
   try{await remoteFixture.start({seed:{polls:[{messages:[],frame}]}});}catch(error){remoteFixture.errors.push({key:'one',error:String(error)});}
  },kind);
  await p.waitForFunction(()=>remoteFixture.errors.length>0);
  assert.equal(await p.evaluate(()=>remoteFixture.draws.length),0);assert.equal(await p.locator('iframe').count(),0);
  await p.evaluate(()=>remoteFixture.clients.one?.close());assert.deepEqual(f.nativeRemoteRequests,[]);
 });
});

test('dispose aborts lifetime; delayed old decode cannot overwrite a new session and close keeps its original token',async t=>{
 const f=await remoteBrowserFixture(t),p=f.page;await installRemoteClient(p);
 await p.evaluate(()=>{remoteFixture.deferDecode=1;void remoteFixture.start({key:'old'});});
 await p.waitForFunction(()=>remoteFixture.decodeWaiters.length===1);
 await p.evaluate(()=>{window.oldClosed=remoteFixture.clients.old.close();});
 await p.evaluate(()=>remoteFixture.start({key:'new',seed:{polls:[{messages:[],frame:remoteFixture.frame('rgb(10, 190, 20)')}]}}));
 await p.waitForFunction(()=>remoteFixture.draws.length===1);
 await p.evaluate(async()=>{remoteFixture.decodeWaiters.shift()();await oldClosed;});
 await p.waitForFunction(()=>remoteFixture.bitmapCloses===2);
 await p.evaluate(()=>remoteFixture.clients.new.close());
 const state=await p.evaluate(()=>({draws:remoteFixture.draws,pixel:[...document.querySelector('canvas').getContext('2d').getImageData(200,200,1,1).data],closes:remoteFixture.requests.filter(r=>r.body.type==='close'),aborts:remoteFixture.aborts,input:remoteFixture.sessions['session-1'].input}));
 assert.equal(state.draws.length,1);assert.deepEqual(state.pixel,[10,190,20,255]);
 assert.deepEqual(state.closes.map(r=>[r.url.split('/').at(-1),r.authorization]),[['session-1','Bearer fixture-session-secret-1'],['session-2','Bearer fixture-session-secret-2']]);
 assert.ok(state.aborts.length>0,'dispose must abort the lifetime signal');assert.deepEqual(state.input,[]);assert.deepEqual(f.errors,[]);assert.deepEqual(f.nativeRemoteRequests,[]);
});

test('a stale panel drops queued broker replies and inputs; close still targets only its original remote session',async t=>{
 const f=await remoteBrowserFixture(t),p=f.page;await installRemoteClient(p);
 await p.evaluate(()=>remoteFixture.start({seed:{deferPoll:true}}));await p.waitForFunction(()=>remoteFixture.pollWaiters.length===1);
 await p.evaluate(()=>{remoteFixture.current.one=false;remoteFixture.pollWaiters.shift().resolve({messages:[{id:1,type:'files.read',path:'docs/data.json'}],frame:remoteFixture.frame()});document.querySelector('canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
 await p.evaluate(()=>remoteFixture.clients.one.close());
 const state=await p.evaluate(()=>({session:remoteFixture.sessions['session-1'],draws:remoteFixture.draws,requests:remoteFixture.requests}));
 assert.deepEqual(state.session.broker,[]);assert.deepEqual(state.session.input,[]);assert.equal(state.draws.length,0);assert.equal(state.session.closed,true);
 assert.equal(state.requests.filter(r=>r.body.type==='close').length,1);assert.deepEqual(f.nativeRemoteRequests,[]);
});

test('dispose during create waits for the original response and closes that session without polling or drawing it',async t=>{
 const f=await remoteBrowserFixture(t),p=f.page;await installRemoteClient(p);
 await p.evaluate(()=>{window.lateStart=remoteFixture.start({key:'late',seed:{deferCreate:true,polls:[{messages:[{type:'installed'}],frame:remoteFixture.frame()}]}});});
 await p.waitForFunction(()=>remoteFixture.createWaiters.length===1);
 await p.evaluate(()=>{window.lateClose=remoteFixture.clients.late.close();});
 assert.equal(await p.evaluate(()=>remoteFixture.requests.length),1);
 await p.evaluate(async()=>{remoteFixture.createWaiters.shift().resolve();await lateStart;await lateClose;});
 const state=await p.evaluate(()=>({requests:remoteFixture.requests,draws:remoteFixture.draws,session:remoteFixture.sessions['session-1']}));
 assert.deepEqual(state.requests.map(r=>r.body.type??'create'),['create','close']);assert.equal(state.requests[1].authorization,'Bearer fixture-session-secret-1');assert.equal(state.session.closed,true);assert.equal(state.draws.length,0);assert.deepEqual(f.errors,[]);assert.deepEqual(f.nativeRemoteRequests,[]);
});
