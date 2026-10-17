/** Inject this function's source into the reviewed, network-none browser image.
 * All project code and bridge output remain untrusted. The host owns package
 * hashes, authorization, revocation, leases and original-container cleanup.
 * Optional dependencies exist only for protocol unit tests; stdin cannot set them. */
export async function isolatedBrowserMain(options={}) {
 const input=options.input??process.stdin,output=options.output??process.stdout;
 const signals=options.signals??process,setExitCode=options.setExitCode??(code=>{process.exitCode=code;});
 const {Buffer}=await import('node:buffer');
 const LIMIT={init:4*1024*1024,line:70*1024,broker:64*1024,png:2*1024*1024,queued:16,output:4*1024*1024};
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
 const bytes=value=>Buffer.byteLength(value,'utf8');
 const path=value=>typeof value==='string'&&value.length<=200&&/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(value)&&!value.split('/').some(part=>part==='node_modules'||part==='vendor');
 const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 let browser,page,bridge,initialized=false,stopping=false,failure,queued=0,brokerPending=0,outputBytes=0;
 let commandQueue=Promise.resolve(),outputQueue=Promise.resolve(),complete,bridgeResolve,bridgeReject;
 const waits=new Set();
 const finished=new Promise(resolve=>{complete=resolve;});
 const bridgeReady=new Promise((resolve,reject)=>{bridgeResolve=resolve;bridgeReject=reject;});
 // A failed init may have no broker replies waiting on this promise.
 void bridgeReady.catch(()=>{});
 const timeout=(promise,ms,code,duringClose=false)=>new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);waits.delete(cancel);error?reject(error):resolve(value);};
  const cancel=()=>finish(Error('isolated-browser-closed'));
  const timer=setTimeout(()=>finish(Error(code)),ms);
  if(!duringClose)waits.add(cancel);
  Promise.resolve(promise).then(value=>finish(null,value),error=>finish(error));
  if(stopping&&!duringClose)cancel();
 });
 function emit(value,max) {
  if(stopping&&value.type!=='error')return Promise.resolve();
  const line=JSON.stringify(value)+'\n',size=bytes(line);
  if(size>max||outputBytes+size>LIMIT.output)throw Error('isolated-browser-output-limit');
  outputBytes+=size;
  const next=outputQueue.then(()=>new Promise((resolve,reject)=>{
   output.write(line,error=>error?reject(error):resolve());
  })).finally(()=>{outputBytes-=size;});
  outputQueue=next.catch(()=>{});return next;
 }
 async function stop(code) {
  if(stopping)return;stopping=true;failure=code;
  for(const cancel of [...waits])cancel();
  bridgeReject(Error(code??'isolated-browser-closed'));
  if(code){
   setExitCode(1);
   try{await timeout(emit({type:'error',error:code},LIMIT.line),1000,'isolated-browser-output-timeout',true);}catch{}
  }
  // Closing the input also releases a reader waiting for another command.
  input.destroy?.();
  try{if(browser)await timeout(browser.close(),3000,'isolated-browser-close-timeout',true);}catch{failure??='isolated-browser-close-failed';setExitCode(1);}
  complete();
 }
 const fail=code=>{void stop(code);};
 const errorCode=error=>typeof error?.message==='string'&&/^isolated-browser-[a-z-]+$/.test(error.message)?error.message:'isolated-browser-command-failed';
 function validateInit(message) {
  if(!object(message.package)||message.package.schema!=='project.view-package/v1'||typeof message.frameHtml!=='string'||!message.frameHtml.length||bytes(message.frameHtml)>128*1024)throw Error('isolated-browser-init-invalid');
  const pkg=message.package,manifest=pkg.manifest;
  if(!object(pkg.scope)||!['tenantId','projectId','workspaceId'].every(key=>typeof pkg.scope[key]==='string'&&pkg.scope[key].length>0&&pkg.scope[key].length<=200)||!Number.isSafeInteger(pkg.scope.workspaceGeneration)||pkg.scope.workspaceGeneration<0||!(pkg.revisionId===null||typeof pkg.revisionId==='string'&&pkg.revisionId.length>0&&pkg.revisionId.length<=200)||!digest(pkg.filesSha256)||!digest(pkg.packageIdentity))throw Error('isolated-browser-package-invalid');
  if(!object(manifest)||manifest.schema!=='project.views/v1'||!Array.isArray(manifest.files)||manifest.files.length<1||manifest.files.length>64||!Array.isArray(manifest.views)||manifest.views.length<1||manifest.views.length>16||!Array.isArray(pkg.assets)||pkg.assets.length!==manifest.files.length)throw Error('isolated-browser-package-invalid');
  const files=new Set(manifest.files),assets=new Set(),ids=new Set();let total=0;
  if(files.size!==manifest.files.length||![...files].every(path))throw Error('isolated-browser-package-invalid');
  for(const asset of pkg.assets){
   if(!object(asset)||!files.has(asset.path)||assets.has(asset.path)||typeof asset.mediaType!=='string'||asset.mediaType.length>80||!digest(asset.sha256)||!digest(asset.sourceSha256)||typeof asset.base64!=='string'||asset.base64.length>349528||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.base64))throw Error('isolated-browser-package-invalid');
   const size=Buffer.from(asset.base64,'base64').length;
   if(size>256*1024||(total+=size)>2*1024*1024)throw Error('isolated-browser-package-limit');assets.add(asset.path);
  }
  for(const view of manifest.views){
   if(!object(view)||typeof view.id!=='string'||!/^[a-z][a-z0-9-]{0,47}$/.test(view.id)||ids.has(view.id)||typeof view.title!=='string'||!view.title.trim()||view.title.length>80||!files.has(view.entrypoint)||!view.entrypoint.endsWith('.html'))throw Error('isolated-browser-package-invalid');ids.add(view.id);
  }
  const view=message.view;
  if(!object(view)||!manifest.views.some(candidate=>candidate.id===view.id&&candidate.title===view.title&&candidate.entrypoint===view.entrypoint)||!pkg.assets.some(asset=>asset.path===view.entrypoint&&asset.mediaType==='text/html'))throw Error('isolated-browser-view-invalid');
 }
 async function initialize(message) {
  validateInit(message);
  // This function is also serialized with toString() into the container's
  // fixed Node program. Keep the native-only package out of Worker bundles;
  // the module name is fixed here and cannot come from stdin or project data.
  const browserModule='playwright';
  const chromium=options.chromium??(await import(browserModule)).chromium;
  if(stopping)return;
  const launched=await chromium.launch({executablePath:'/opt/chrome/chrome',headless:true,chromiumSandbox:true,timeout:10000});
  // A close or fatal input may arrive while launch is still pending.
  if(stopping){await timeout(launched.close(),3000,'isolated-browser-close-timeout',true);return;}browser=launched;
  browser.on?.('disconnected',()=>{if(!stopping)fail('isolated-browser-disconnected');});
  page=await browser.newPage({viewport:{width:800,height:600}});
  if(stopping)return;
  // Diagnostics only: no URL, request body, private error text or interception.
  // Actual network isolation belongs to the container's network-none contract.
  let networkEvents=0;
  const networkFailure=(event,error)=>{
   if(stopping||networkEvents>=64)return;networkEvents++;
   const safe=typeof error==='string'&&/^net::ERR_[A-Z0-9_]{1,80}$/.test(error)?error:'request-failed';
   try{void emit({type:'network',event,error:safe},LIMIT.line).catch(error=>fail(errorCode(error)));}catch(error){fail(errorCode(error));}
  };
  const context=page.context();
  context.on('requestfailed',request=>networkFailure('requestfailed',request.failure()?.errorText));
  const observeSockets=page=>page.on('websocket',socket=>socket.on('socketerror',error=>networkFailure('websocket-error',error)));
  context.on('page',observeSockets);observeSockets(page);
  page.on('crash',()=>fail('isolated-browser-page-crashed'));
  await page.exposeBinding('__riffologyIsolatedBroker',async(source,text)=>{
   if(stopping)return;
   try{
    if(source.page!==page||source.frame!==page.mainFrame()||typeof text!=='string'||bytes(text)>LIMIT.broker)throw Error('isolated-browser-broker-invalid');
    const message=JSON.parse(text);
    if(!object(message))throw Error('isolated-browser-broker-invalid');
    await emit({type:'broker',message},LIMIT.line);
   }catch(error){fail(errorCode(error));}
  });
  await page.setContent(message.frameHtml,{waitUntil:'load',timeout:5000});
  if(stopping)return;
  bridge=await page.evaluateHandle(({pkg,view})=>{
   const channel=new MessageChannel(),send=window.__riffologyIsolatedBroker.bind(window);
   channel.port1.onmessage=event=>{
    let text;
    try{text=JSON.stringify(event.data);}catch{void send('null');return;}
    if(typeof text!=='string'||new TextEncoder().encode(text).length>65500){void send('null');return;}
    void send(text);
   };
   channel.port1.start();
   // For the top-level synthetic page parent===window, matching the existing
   // bootstrap source check. Project installation continues asynchronously.
   window.postMessage({type:'project-view-init',package:pkg,view},'*',[channel.port2]);
   return channel.port1;
  },{pkg:message.package,view:message.view});
  bridgeResolve(bridge);
 }
 async function command(message) {
  if(stopping)return;
  if(message.type==='init')return initialize(message);
  await bridgeReady;if(stopping)return;
  if(message.type==='capture'){
   const png=await page.screenshot({type:'png',timeout:5000,fullPage:false});
   if(png.length>LIMIT.png)throw Error('isolated-browser-frame-limit');
   await emit({type:'frame',base64:png.toString('base64'),width:800,height:600},3*1024*1024);return;
  }
  const event=message.event;
  if(!object(event))throw Error('isolated-browser-input-invalid');
  if(event.kind==='click'&&Number.isInteger(event.x)&&event.x>=0&&event.x<800&&Number.isInteger(event.y)&&event.y>=0&&event.y<600)await page.mouse.click(event.x,event.y,{timeout:3000});
  else if(event.kind==='key'&&typeof event.key==='string'&&event.key.length>0&&event.key.length<=64&&!/[\r\n\0]/.test(event.key))await page.keyboard.press(event.key);
  else if(event.kind==='text'&&typeof event.text==='string'&&bytes(event.text)<=4096)await page.keyboard.insertText(event.text);
  else if(event.kind==='wheel'&&Number.isFinite(event.deltaY)&&Math.abs(event.deltaY)<=10000)await page.mouse.wheel(0,event.deltaY);
  else throw Error('isolated-browser-input-invalid');
 }
 function dispatch(message) {
  if(!object(message)||!['init','broker','input','capture','close'].includes(message.type))throw Error('isolated-browser-message-invalid');
  if(message.type==='close'){void stop();return;}
  if(message.type==='init'){
   if(initialized)throw Error('isolated-browser-already-initialized');initialized=true;
  }else if(!initialized)throw Error('isolated-browser-init-required');
  if(message.type==='broker'){
   if(!object(message.message)||bytes(JSON.stringify(message.message))>LIMIT.broker||brokerPending>=16)throw Error('isolated-browser-broker-invalid');brokerPending++;
   // A top-level await in a project module can require this reply while
   // initialization or a screenshot is pending. Never queue it behind those.
   void timeout(bridgeReady.then(async port=>{if(!stopping)await page.evaluate(({port,message})=>port.postMessage(message),{port,message:message.message});}),15000,'isolated-browser-broker-timeout').catch(error=>fail(errorCode(error))).finally(()=>{brokerPending--;});
   return;
  }
  if(queued>=LIMIT.queued)throw Error('isolated-browser-command-limit');queued++;
  commandQueue=commandQueue.then(()=>timeout(command(message),20000,'isolated-browser-command-timeout')).catch(error=>fail(errorCode(error))).finally(()=>{queued--;});
 }
 async function readCommands() {
  let chunks=[],size=0;
  try{
   for await(const chunk of input){
    const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);let start=0;
    while(start<buffer.length&&!stopping){
     const newline=buffer.indexOf(10,start),end=newline<0?buffer.length:newline,part=buffer.subarray(start,end);
     size+=part.length;if(size>(initialized?LIMIT.line:LIMIT.init))throw Error('isolated-browser-line-limit');chunks.push(part);
     if(newline<0)break;
     const line=Buffer.concat(chunks,size);chunks=[];size=0;
     let message;try{message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line));}catch{throw Error('isolated-browser-json-invalid');}
     if(bytes(line)>LIMIT.line&&message?.type!=='init')throw Error('isolated-browser-line-limit');
     dispatch(message);start=newline+1;
    }
    if(stopping)return;
   }
   if(!stopping){if(size)throw Error('isolated-browser-unterminated-line');await commandQueue;await stop();}
  }catch(error){if(!stopping)await stop(errorCode(error));}
 }
 const handlers=['SIGINT','SIGTERM'].map(signal=>{const handler=()=>fail('isolated-browser-interrupted');signals.on(signal,handler);return [signal,handler];});
 const outputError=()=>fail('isolated-browser-output-failed');output.on?.('error',outputError);
 void readCommands();
 try{await finished;await timeout(outputQueue,1000,'isolated-browser-output-timeout',true).catch(()=>{});return {status:failure?'failed':'closed',...(failure?{error:failure}:{})};}
 finally{for(const [signal,handler]of handlers)signals.removeListener(signal,handler);output.removeListener?.('error',outputError);}
}
