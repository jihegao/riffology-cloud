import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {MessageChannel} from 'node:worker_threads';
import {createContext,runInContext} from 'node:vm';
import {isolatedBrowserMain} from '../../services/project-views/isolated-browser.mjs';

const init=()=>({type:'init',frameHtml:'<!doctype html><script>/* trusted bootstrap fixture */</script>',view:{id:'home',title:'Home',entrypoint:'app/home.html'},package:{schema:'project.view-package/v1',scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},revisionId:null,filesSha256:'a'.repeat(64),packageIdentity:'b'.repeat(64),manifest:{schema:'project.views/v1',files:['app/home.html'],views:[{id:'home',title:'Home',entrypoint:'app/home.html'}]},assets:[{path:'app/home.html',mediaType:'text/html',base64:Buffer.from('<h1>synthetic</h1>').toString('base64'),sha256:'c'.repeat(64),sourceSha256:'c'.repeat(64)}]}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness(t,{install,onOutput,screenshot}={}){
 const input=new PassThrough(),signals=new EventEmitter(),lines=[],calls=[],ports=[],screenshotStarted=deferred();let closed=0,exitCode;
 const frame={},window={},context=createContext({window,MessageChannel,TextEncoder}),browserContext=new EventEmitter(),pageEvents=new EventEmitter();
 const evaluate=(fn,args)=>{context.__args=args;return runInContext('('+fn.toString()+')(__args)',context);};
 const page={context:()=>browserContext,on:(...args)=>pageEvents.on(...args),mainFrame:()=>frame,exposeBinding:async(name,fn)=>{window[name]=text=>fn({page,frame},text);},setContent:async(html,opts)=>calls.push(['setContent',html,opts]),evaluateHandle:async(fn,args)=>{const port=evaluate(fn,args);ports.push(port);return port;},evaluate:async(fn,args)=>evaluate(fn,args),screenshot:async()=>{calls.push(['capture']);screenshotStarted.resolve();return screenshot?await screenshot():Buffer.from('synthetic-png-transport');},mouse:{click:async(...args)=>calls.push(['click',...args]),wheel:async(...args)=>calls.push(['wheel',...args])},keyboard:{press:async(...args)=>calls.push(['key',...args]),insertText:async(...args)=>calls.push(['text',...args])}};
 window.postMessage=(message,target,transferred)=>{
  assert.equal(message.type,'project-view-init');assert.equal(target,'*');assert.equal(transferred.length,1);
  const port=transferred[0];ports.push(port);port.start();
  if(install)install(port,message);
  else port.postMessage({type:'installed'});
 };
 const chromium={launch:async options=>{calls.push(['launch',options]);return {newPage:async options=>{calls.push(['newPage',options]);return page;},close:async()=>{closed++;for(const port of ports)port.close();}};}};
 const output=new Writable({write(chunk,encoding,callback){const value=JSON.parse(chunk.toString());lines.push(value);callback();onOutput?.(value,{input,calls,lines});}});
 const result=isolatedBrowserMain({input,output,chromium,signals,setExitCode:code=>{exitCode=code;}});
 t.after(()=>{input.destroy();for(const port of ports)port.close();});
 return {input,signals,lines,calls,result,screenshotStarted,browserContext,pageEvents,get closed(){return closed;},get exitCode(){return exitCode;},send:value=>input.write(JSON.stringify(value)+'\n')};
}

test('real MessageChannel transports broker replies while installation awaits project data, then captures and inputs serially',async t=>{
 const received=deferred();let worker;
 worker=harness(t,{install:port=>{
  port.onmessage=event=>{received.resolve(event.data);port.postMessage({type:'installed'});};
  port.postMessage({type:'files.read',id:1,path:'docs/data.json'});
 },onOutput:message=>{
  if(message.type==='broker'&&message.message.type==='files.read')worker.send({type:'broker',message:{id:1,value:{text:'authorized project data'}}});
  if(message.type==='broker'&&message.message.type==='installed')for(const command of [{type:'input',event:{kind:'click',x:10,y:20}},{type:'input',event:{kind:'key',key:'Tab'}},{type:'input',event:{kind:'text',text:'hello'}},{type:'input',event:{kind:'wheel',deltaY:0.5}},{type:'capture'}])worker.send(command);
  if(message.type==='frame')worker.send({type:'close'});
 }});
 worker.send(init());
 assert.deepEqual(await received.promise,{id:1,value:{text:'authorized project data'}});
 assert.deepEqual(await worker.result,{status:'closed'});assert.equal(worker.closed,1);
 assert.deepEqual(worker.calls[0],['launch',{executablePath:'/opt/chrome/chrome',headless:true,chromiumSandbox:true,timeout:10000}]);
 assert.deepEqual(worker.calls[1],['newPage',{viewport:{width:800,height:600}}]);
 assert.deepEqual(worker.calls.slice(3).map(call=>call[0]),['click','key','text','wheel','capture']);
 assert.deepEqual(worker.calls.find(call=>call[0]==='wheel'),['wheel',0,0.5]);
 assert.deepEqual(worker.lines.at(-1),{type:'frame',base64:Buffer.from('synthetic-png-transport').toString('base64'),width:800,height:600});
});

test('broker messages bypass an in-flight capture and preserve snapshot messages without ids',async t=>{
 const release=deferred(),reply=deferred();let worker;
 worker=harness(t,{install:port=>{port.onmessage=event=>{reply.resolve(event.data);release.resolve(Buffer.from('frame'));};port.postMessage({type:'installed'});},screenshot:()=>release.promise,onOutput:message=>{if(message.type==='broker')worker.send({type:'capture'});if(message.type==='frame')worker.send({type:'close'});}});
 worker.send(init());await worker.screenshotStarted.promise;
 worker.send({type:'broker',message:{type:'snapshot',snapshot:{version:'current'}}});
 assert.deepEqual(await reply.promise,{type:'snapshot',snapshot:{version:'current'}});
 assert.equal((await worker.result).status,'closed');
});

test('split UTF-8 NDJSON input is accepted while malformed and oversized lines fail before browser launch',async t=>{
 const good=harness(t,{onOutput:message=>{if(message.type==='broker')good.send({type:'close'});}}),value=init();value.view.title='页面';value.package.manifest.views[0].title='页面';
 const encoded=Buffer.from(JSON.stringify(value)+'\n'),split=encoded.indexOf(Buffer.from('页面'))+1;
 good.input.write(encoded.subarray(0,split));good.input.write(encoded.subarray(split));assert.equal((await good.result).status,'closed');
 for(const line of [Buffer.from('{bad}\n'),Buffer.from('{"type":"capture","padding":"'+'x'.repeat(70*1024)+'"}\n'),Buffer.from('x'.repeat(4*1024*1024+1)),Buffer.from([0xff,10])]){
  const worker=harness(t);worker.input.write(line);assert.equal((await worker.result).status,'failed');assert.equal(worker.calls.length,0);assert.equal(worker.exitCode,1);assert.equal(worker.lines.at(-1).type,'error');
 }
});

test('malformed package, second init and invalid input fail closed without emitting frames',async t=>{
 const broken=init();broken.package.assets[0].path='../secret.html';
 const invalid=harness(t);invalid.send(broken);assert.equal((await invalid.result).error,'isolated-browser-package-invalid');assert.equal(invalid.calls.length,0);
 const repeated=harness(t);repeated.send(init());repeated.send(init());assert.equal((await repeated.result).error,'isolated-browser-already-initialized');
 const worker=harness(t,{onOutput:message=>{if(message.type==='broker')worker.send({type:'input',event:{kind:'click',x:800,y:0}});}});
 worker.send(init());assert.equal((await worker.result).error,'isolated-browser-input-invalid');assert(!worker.lines.some(message=>message.type==='frame'));assert.equal(worker.closed,1);
});

test('oversized PNG and broker output are refused and the browser closes',async t=>{
 const png=harness(t,{screenshot:()=>Buffer.alloc(2*1024*1024+1),onOutput:message=>{if(message.type==='broker')png.send({type:'capture'});}});
 png.send(init());assert.equal((await png.result).error,'isolated-browser-frame-limit');assert(!png.lines.some(message=>message.type==='frame'));assert.equal(png.closed,1);
 const broker=harness(t,{install:port=>port.postMessage({type:'files.read',padding:'x'.repeat(65536)})});broker.send(init());assert.equal((await broker.result).status,'failed');assert(!broker.lines.some(message=>message.type==='broker'));assert.equal(broker.closed,1);
});

test('close and SIGTERM can end an interactive session without waiting for stdin EOF',async t=>{
 for(const interrupt of [false,true]){
  const worker=harness(t,{onOutput:message=>{if(message.type==='broker'){if(interrupt)worker.signals.emit('SIGTERM');else worker.send({type:'close'});}}});
  worker.send(init());assert.equal((await worker.result).status,interrupt?'failed':'closed');assert.equal(worker.closed,1);assert.equal(worker.signals.listenerCount('SIGTERM'),0);
 }
});

test('EOF with a partial line and command queue flooding are bounded failures',async t=>{
 const partial=harness(t);partial.input.end('{"type":');assert.equal((await partial.result).error,'isolated-browser-unterminated-line');
 const flooded=harness(t);flooded.input.write([init(),...Array.from({length:17},()=>({type:'capture'}))].map(message=>JSON.stringify(message)).join('\n')+'\n');assert.equal((await flooded.result).error,'isolated-browser-command-limit');
});

test('network diagnostics are capped and omit URLs and private error content without intercepting requests',async t=>{
 const worker=harness(t,{onOutput:message=>{
  if(message.type==='broker'){
   worker.browserContext.emit('requestfailed',{failure:()=>({errorText:'net::ERR_CONNECTION_REFUSED'})});
   const socket=new EventEmitter();worker.pageEvents.emit('websocket',socket);socket.emit('socketerror','private https://example.invalid/secret');
   for(let n=0;n<100;n++)worker.browserContext.emit('requestfailed',{failure:()=>({errorText:'private project URL'})});
   worker.send({type:'close'});
  }
 }});
 worker.send(init());assert.equal((await worker.result).status,'closed');
 const network=worker.lines.filter(message=>message.type==='network');assert.equal(network.length,64);
 assert.deepEqual(network[0],{type:'network',event:'requestfailed',error:'net::ERR_CONNECTION_REFUSED'});
 assert.deepEqual(network[1],{type:'network',event:'websocket-error',error:'request-failed'});
 assert(!JSON.stringify(network).includes('private'));assert(!JSON.stringify(network).includes('https:'));
});
