import {OBSERVER_LIMITS as L} from '../preview/observer-protocol.ts';

const operations=new Set(['snapshot','screenshot','console','reload']);
const consoleTypes=new Set(['log','debug','info','error','warning','dir','dirxml','table','trace','clear','startGroup','startGroupCollapsed','endGroup','assert','profile','profileEnd','count','timeEnd']);
function clipped(text,limit){let out='',size=0;for(const c of text){const n=Buffer.byteLength(c);if(size+n>limit)return {text:out,truncated:true};out+=c;size+=n;}return {text:out,truncated:false};}

/** Browser must be platform-owned and launched behind an independently verified
 * network fence. Playwright routing alone is NOT an OS/container egress fence.
 * fetchResource must authorize every hop and share the observation-wide budget.
 * This adapter never launches a browser or borrows the user's context. */
export async function observeWithPlaywright(browser,{operation,pageUrl,signal,timeoutMs,fetchResource}){
 if(!operations.has(operation)||typeof pageUrl!=='string'||!/^https:\/\//.test(pageUrl)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>L.timeoutMs||typeof fetchResource!=='function')throw Error('observer-command-denied');
 let context,closing,finished=false,failure,bodyBytes=0,requests=0,chunks=0;
 const activeReaders=new Set(),controller=new AbortController();
 const close=()=>context?(closing??=context.close()):Promise.resolve();
 let rejectFailure;
 const failed=new Promise((_,reject)=>{rejectFailure=reject;});failed.catch(()=>{});
 const fail=(code)=>{if(!failure){failure=Error(code);controller.abort();rejectFailure(failure);for(const reader of activeReaders)void reader.cancel().catch(()=>{});void close().catch(()=>{});}};
 const abort=()=>fail('observer-cancelled');
 const timer=setTimeout(()=>fail('observer-timeout'),timeoutMs);
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const guard=()=>{if(failure)throw failure;if(finished)throw Error('observer-cancelled');};
 const work=(async()=>{
  guard();
  const created=browser.newContext({viewport:{width:L.screenshotWidth,height:L.screenshotHeight},serviceWorkers:'block',acceptDownloads:false});
  // An abort may win while newContext is pending. Its late result is still closed.
  created.then(value=>{context=value;if(failure||finished)void close().catch(()=>{});},()=>{});
  context=await created;guard();
  await context.clearCookies();
  await context.routeWebSocket('**/*',socket=>{socket.close();fail('observer-http-denied');});
  let page;
  context.on('page',candidate=>{if(page&&candidate!==page){void candidate.close().catch(()=>{});fail('observer-http-denied');}});
  await context.route('**/*',async route=>{
   let response,reader;
   try{
    guard();const req=route.request();
    if(++requests>L.resourceRequests)throw Error('observer-resource-limit');
    if(!['GET','HEAD'].includes(req.method())||req.postDataBuffer()!==null||req.frame()!==page.mainFrame())throw Error('observer-http-denied');
    // No browser credentials, headers, cookies or caller-provided body survive.
    response=await fetchResource(new Request(req.url(),{method:req.method(),redirect:'manual',signal:controller.signal}));guard();
    const buffers=[];reader=response.body?.getReader();if(reader)activeReaders.add(reader);
    if(reader)for(;;){const part=await reader.read();guard();if(part.done)break;if(++chunks>L.resourceChunks||(bodyBytes+=part.value.byteLength)>L.resourceResponseBytes)throw Error('observer-resource-limit');buffers.push(Buffer.from(part.value));}
    guard();await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.concat(buffers)});
   }catch(error){if(reader)await reader.cancel().catch(()=>{});else if(response?.body)await response.body.cancel().catch(()=>{});fail(['observer-resource-limit','observer-cancelled','observer-timeout'].includes(error?.message)?error.message:'observer-http-denied');await route.abort().catch(()=>{});}
   finally{if(reader){activeReaders.delete(reader);reader.releaseLock();}}
  });
  page=await context.newPage();guard();
  page.setDefaultTimeout(timeoutMs);page.on('download',download=>{void download.cancel().catch(()=>{});fail('observer-http-denied');});
  page.on('framenavigated',frame=>{if(frame!==page.mainFrame())fail('observer-http-denied');});
  const entries=[];let consoleBytes=0,truncated=false,dropped=0;
  page.on('console',message=>{
   if(entries.length>=L.consoleEntries||consoleBytes>=L.consoleBytes){truncated=true;dropped++;return;}
   const item=clipped(message.text(),Math.min(L.consoleEntryBytes,L.consoleBytes-consoleBytes));
   consoleBytes+=Buffer.byteLength(item.text);truncated ||= item.truncated;
   entries.push({type:consoleTypes.has(message.type())?message.type():'log',text:item.text});
  });
  await page.goto(pageUrl,{waitUntil:'networkidle',timeout:timeoutMs});guard();
  let payload;
  if(operation==='reload'){await page.reload({waitUntil:'networkidle',timeout:timeoutMs});payload={type:'reload',reloaded:true};}
  else if(operation==='console')payload={type:'console',entries,truncated,dropped};
  else if(operation==='screenshot'){
   const bytes=await page.screenshot({type:'png',fullPage:false,animations:'disabled',timeout:timeoutMs});
   if(bytes.byteLength>L.screenshotBytes)throw Error('observer-result-limit');
   payload={type:'screenshot',mimeType:'image/png',bytes:new Uint8Array(bytes),width:L.screenshotWidth,height:L.screenshotHeight};
  }else{
   // Fixed script, bounded renderer-to-host payload; no model expressions.
   const result=await page.evaluate(limit=>{const walker=document.createTreeWalker(document.body||document.documentElement,NodeFilter.SHOW_TEXT);let text='',size=0;const encoder=new TextEncoder();for(let node=walker.nextNode();node;node=walker.nextNode()){if(node.parentElement?.closest('script,style,noscript'))continue;for(const character of node.nodeValue||''){const bytes=encoder.encode(character).length;if(size+bytes>limit)return {text,truncated:true};size+=bytes;text+=character;}}return {text,truncated:false};},L.snapshotBytes);
   payload={type:'snapshot',...result};
  }
  guard();await close();guard();return {stopped:true,payload};
 })();
 try{return await Promise.race([work,failed]);}
 catch(error){throw failure??Error(['observer-result-limit'].includes(error?.message)?error.message:'observer-browser-failed');}
 finally{finished=true;controller.abort();clearTimeout(timer);signal?.removeEventListener('abort',abort);try{await close();}catch{throw Error('observer-stop-unconfirmed');}}
}
