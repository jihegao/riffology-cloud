/**
 * Synthetic, offline container probe. This function is self-contained so an
 * external supervisor can inject its source into an explicitly prepared image.
 * It does not build an image, launch Docker or contact a cloud API.
 */
export async function projectViewBrowserProbe() {
 const {networkInterfaces}=await import('node:os');
 const {readFile}=await import('node:fs/promises');
 const {createConnection}=await import('node:net');
 const {randomUUID,createHash}=await import('node:crypto');
 const {chromium}=await import('playwright');
 const MAX_INPUT=16384,MAX_OUTPUT=8*1024*1024,MAX_FRAME=2*1024*1024,MAX_EVENTS=16;
 const truncate=(value,max=1024)=>String(value).slice(0,max);
 let inputBytes=0,inputText='';
 for await(const chunk of process.stdin){
  inputBytes+=Buffer.byteLength(chunk);if(inputBytes>MAX_INPUT)throw Error('browser-probe-input-limit');
  inputText+=chunk;
 }
 const input=JSON.parse(inputText);
 if(input?.schema!=='riffology.offline-browser-probe-input/v1'||typeof input.collectorUrl!=='string')throw Error('browser-probe-input-invalid');
 const collector=new URL(input.collectorUrl);
 if(collector.protocol!=='http:'||!['127.0.0.1','198.18.0.1'].includes(collector.hostname)||!collector.port||!Number.isInteger(Number(collector.port))||Number(collector.port)<1||Number(collector.port)>65535||collector.username||collector.password||collector.search||collector.hash||collector.pathname!=='/')throw Error('browser-probe-collector-invalid');
 const operationId=input.operationId??randomUUID();
 if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(operationId))throw Error('browser-probe-operation-invalid');
 const caseTimeoutMs=input.caseTimeoutMs??2000;
 if(!Number.isInteger(caseTimeoutMs)||caseTimeoutMs<500||caseTimeoutMs>5000)throw Error('browser-probe-timeout-invalid');

 const interfaces=Object.entries(networkInterfaces()).flatMap(([name,addresses])=>(addresses??[]).map(address=>({name,family:address.family,internal:address.internal})));
 const nonLoopback=interfaces.filter(address=>address.name!=='lo'||!address.internal);
 if(!interfaces.length||nonLoopback.length)throw Error('browser-probe-network-interface-present');
 const routeText=await readFile('/proc/net/route','utf8'),routeLines=routeText.trim().split(/\r?\n/);
 if(!/^Iface\s/.test(routeLines[0]??'')||routeLines.slice(1).some(line=>line.trim()))throw Error('browser-probe-network-route-present');
 const connectResult=await new Promise(resolveResult=>{
  const socket=createConnection({host:'198.18.0.1',port:Number(collector.port)});let done=false;
  const finish=code=>{if(done)return;done=true;socket.destroy();resolveResult(code);};
  socket.once('connect',()=>finish('connected'));
  socket.once('error',error=>finish(error.code??'unknown-error'));
  socket.setTimeout(1500,()=>finish('timeout'));
 });
 if(!['ENETUNREACH','EHOSTUNREACH'].includes(connectResult))throw Error('browser-probe-kernel-network-inconclusive');

 const browser=await chromium.launch({executablePath:'/opt/chrome/chrome',headless:true,chromiumSandbox:true,timeout:10000});
 const probe={schema:'riffology.offline-browser-probe/v1',operationId,collectorOrigin:collector.origin,executablePath:'/opt/chrome/chrome',network:{interfaces,ipv4RouteRows:0,nativeConnectTarget:'198.18.0.1:'+collector.port},sandboxRequested:true,sandboxText:null,sandboxReadError:null,interaction:null,cases:[],status:'pending',uncovered:[
  'No cloud execution, real user project, credentials, persistence or production UI.',
  'Host collector positive controls and packet observations belong to the external supervisor.',
  'Browser request failures are observations; individual errors may arise before a kernel connect.',
  'chrome://sandbox text is observational and is not a complete process or kernel sandbox attestation.',
  'No browser/kernel exploit resistance, multi-user isolation, recovery or production resource lifecycle claim.',
  'PNG pixels/chunks/CRC are not independently decoded or validated by this probe.',
 ]};
 const browserVersion=browser.version();let frames;
 try{
  const sandboxContext=await browser.newContext();
  try{
   const sandboxPage=await sandboxContext.newPage();
   await sandboxPage.goto('chrome://sandbox',{waitUntil:'domcontentloaded',timeout:3000});
   probe.sandboxText=truncate(await sandboxPage.locator('body').innerText({timeout:3000}),12288);
  }catch(error){probe.sandboxReadError=truncate(error.message);}
  finally{await sandboxContext.close();}

  const interactionContext=await browser.newContext({viewport:{width:800,height:600}});
  try{
   const page=await interactionContext.newPage();
   await page.setContent('<!doctype html><meta charset="utf-8"><style>body{font:24px sans-serif}button,input,output{display:block;margin:24px;width:400px;min-height:60px}</style><button id="counter" type="button">SYNTHETIC 0</button><input id="text" aria-label="Synthetic keyboard input"><output id="echo"></output><script>window.synthetic={clicks:0,trustedClicks:0,keyEvents:0,inputEvents:0};const button=document.querySelector("#counter"),input=document.querySelector("#text");button.addEventListener("click",event=>{window.synthetic.clicks++;window.synthetic.trustedClicks+=Number(event.isTrusted);button.textContent="SYNTHETIC "+window.synthetic.clicks});input.addEventListener("keydown",event=>{window.synthetic.keyEvents+=Number(event.isTrusted)});input.addEventListener("input",event=>{window.synthetic.inputEvents+=Number(event.isTrusted);document.querySelector("#echo").textContent=input.value});</script>',{waitUntil:'load',timeout:5000});
   const before=await page.screenshot({type:'png',timeout:5000});
   await page.locator('#counter').click({timeout:3000});
   await page.locator('#text').click({timeout:3000});
   const typed='SYNTHETIC keyboard 42';
   await page.keyboard.type(typed);
   const observed=await page.evaluate(()=>({...window.synthetic,value:document.querySelector('#text').value,echo:document.querySelector('#echo').textContent,button:document.querySelector('#counter').textContent}));
   if(observed.clicks!==1||observed.trustedClicks!==1||observed.keyEvents<1||observed.inputEvents<1||observed.value!==typed||observed.echo!==typed||observed.button!=='SYNTHETIC 1')throw Error('browser-probe-interaction-unconfirmed');
   const after=await page.screenshot({type:'png',timeout:5000});
   if(before.length>MAX_FRAME||after.length>MAX_FRAME)throw Error('browser-probe-frame-limit');
   const hashes=[before,after].map(bytes=>createHash('sha256').update(bytes).digest('hex'));
   if(hashes[0]===hashes[1])throw Error('browser-probe-interaction-frame-unchanged');
   frames=[before.toString('base64'),after.toString('base64')];
   probe.interaction={...observed,frameHashes:hashes};
  }finally{await interactionContext.close();}

  async function runCase(kind){
   const url=new URL('/riffology-synthetic/'+operationId+'/'+kind,collector);
   url.searchParams.set('canary','SYNTHETIC-'+operationId+'-'+kind);
   if(kind==='websocket')url.protocol='ws:';
   const target=url.href,marker='riffology-synthetic-probe:';
   const result={kind,target,invoked:false,requests:[],requestFailed:[],responses:[],navigationErrors:[],navigations:[],pageErrors:[],consoleEvents:[],webSockets:[],popupCount:0,droppedEvents:0,blocked:false};
   const append=(array,value)=>{if(array.length<MAX_EVENTS)array.push(value);else result.droppedEvents++;};
   const matches=value=>{try{const candidate=new URL(value);return candidate.hostname===url.hostname&&candidate.port===url.port&&candidate.pathname===url.pathname;}catch{return false;}};
   const context=await browser.newContext({viewport:{width:800,height:600}});
   let terminalResolve,terminalDone=false,terminalTimer;
   const terminal=new Promise(resolveResult=>{terminalResolve=()=>{if(terminalDone)return;terminalDone=true;clearTimeout(terminalTimer);resolveResult();};});
   const attachPage=page=>{
    page.on('pageerror',error=>append(result.pageErrors,truncate(error.message)));
    page.on('framenavigated',frame=>{if(matches(frame.url()))append(result.navigations,{url:truncate(frame.url()),main:frame===page.mainFrame()});});
    page.on('console',message=>{
     const text=message.text();if(!text.startsWith(marker))return;
     try{
      const event=JSON.parse(text.slice(marker.length));
      append(result.consoleEvents,event);
      if(event.stage==='invoked')result.invoked=true;
      if(['fetch-error','image-error','websocket-error','api-error'].includes(event.stage))terminalResolve();
     }catch{append(result.pageErrors,'invalid-synthetic-console-event');}
    });
    page.on('websocket',socket=>{
     if(!matches(socket.url()))return;
     const record={url:truncate(socket.url()),errors:[],closed:false};append(result.webSockets,record);
     socket.on('socketerror',error=>{append(record.errors,truncate(error));terminalResolve();});
     socket.on('close',()=>{record.closed=true;terminalResolve();});
    });
   };
   context.on('page',page=>{result.popupCount++;attachPage(page);});
   context.on('request',request=>{
    if(matches(request.url()))append(result.requests,{url:truncate(request.url()),method:request.method(),resourceType:request.resourceType(),navigation:request.isNavigationRequest(),body:truncate(request.postData()??'',512)});
   });
   context.on('requestfailed',request=>{
    if(matches(request.url())){const error=truncate(request.failure()?.errorText??'unknown');append(result.requestFailed,{url:truncate(request.url()),error});if(request.isNavigationRequest())append(result.navigationErrors,error);terminalResolve();}
   });
   context.on('response',response=>{
    if(matches(response.url())){append(result.responses,{url:truncate(response.url()),status:response.status()});terminalResolve();}
   });
   try{
    const page=await context.newPage();result.popupCount=0;
    await page.setContent('<!doctype html><meta charset="utf-8"><button id="attempt" type="button">Run synthetic '+kind+' attempt</button>',{waitUntil:'load',timeout:3000});
    await page.evaluate(({kind,target,marker})=>{
     const emit=(stage,details={})=>console.info(marker+JSON.stringify({stage,...details}));
     document.querySelector('#attempt').addEventListener('click',()=>{
      emit('invoked',{kind});
      try{
       if(kind==='href')window.location.href=target;
       else if(kind==='assign')window.location.assign(target);
       else if(kind==='replace')window.location.replace(target);
       else if(kind==='fetch')fetch(target,{mode:'no-cors',cache:'no-store'}).then(response=>emit('fetch-response',{status:response.status})).catch(error=>emit('fetch-error',{message:String(error.message).slice(0,512)}));
       else if(kind==='beacon')emit('beacon-queued',{accepted:navigator.sendBeacon(target,'SYNTHETIC beacon body')});
       else if(kind==='image'){const image=new Image();image.onload=()=>emit('image-loaded');image.onerror=()=>emit('image-error');document.body.append(image);image.src=target;}
       else if(kind==='form'){const form=document.createElement('form');form.method='POST';form.action=target;const field=document.createElement('input');field.name='canary';field.value='SYNTHETIC form body';form.append(field);document.body.append(form);form.requestSubmit();}
       else if(kind==='window-open'){const popup=window.open(target,'_blank');emit('popup-return',{opened:popup!==null});}
       else if(kind==='websocket'){const socket=new WebSocket(target);window.syntheticSocket=socket;socket.onopen=()=>{emit('websocket-open');socket.send('SYNTHETIC websocket body');};socket.onerror=()=>emit('websocket-error');socket.onclose=event=>emit('websocket-close',{code:event.code});}
       else throw Error('unknown-case');
      }catch(error){emit('api-error',{message:String(error.message).slice(0,512)});}
     },{once:true});
    },{kind,target,marker});
    const navigation=['href','assign','replace','form'].includes(kind)?page.waitForNavigation({waitUntil:'domcontentloaded',timeout:caseTimeoutMs}).catch(error=>{append(result.navigationErrors,truncate(error.message));terminalResolve();}):null;
    terminalTimer=setTimeout(terminalResolve,caseTimeoutMs);
    await page.locator('#attempt').click({timeout:caseTimeoutMs,noWaitAfter:true}).catch(error=>append(result.navigationErrors,truncate(error.message)));
    await terminal;
    if(navigation)await navigation;
    // Let the API rejection and CDP request-failure events both be recorded.
    await new Promise(resolveDelay=>setTimeout(resolveDelay,100));
    const attempted=result.requests.length>0||result.webSockets.length>0;
    const failed=result.requestFailed.length>0||result.webSockets.some(socket=>socket.errors.length>0);
    const unexpectedlyOpened=result.consoleEvents.some(event=>['websocket-open','image-loaded','fetch-response'].includes(event.stage));
    result.blocked=result.invoked&&attempted&&failed&&result.responses.length===0&&!unexpectedlyOpened;
    if(!result.blocked)result.reason=!result.invoked?'invocation-unconfirmed':!attempted?'browser-request-unconfirmed':!failed?'request-failure-unconfirmed':'unexpected-response-or-open';
   }catch(error){result.reason=truncate(error.message);}
   finally{clearTimeout(terminalTimer);await context.close();}
   return result;
  }
  for(const kind of ['href','assign','replace','fetch','beacon','image','form','window-open','websocket'])probe.cases.push(await runCase(kind));
  probe.status=probe.cases.every(result=>result.blocked)?'synthetic-network-attempts-blocked':'blocked';
 }finally{await browser.close();}
 const output={schema:'offline-synthetic-frames/v1',productionEligible:false,userUiEligible:false,browser:browserVersion,chromiumSandbox:true,nonLoopback,connectResult,frames,browserProbe:probe};
 const encoded=JSON.stringify(output);
 if(Buffer.byteLength(encoded)>MAX_OUTPUT)throw Error('browser-probe-output-limit');
 await new Promise((resolveWrite,rejectWrite)=>process.stdout.write(encoded+'\n',error=>error?rejectWrite(error):resolveWrite()));
 if(probe.status!=='synthetic-network-attempts-blocked')throw Error('browser-probe-case-unconfirmed');
 return output;
}

const {pathToFileURL}=await import('node:url');
const {resolve}=await import('node:path');
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await projectViewBrowserProbe();
