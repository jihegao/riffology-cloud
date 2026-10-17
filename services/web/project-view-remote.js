const encoder=new TextEncoder(),WIDTH=800,HEIGHT=600,MAX_PNG=2*1024*1024;
const fail=code=>{throw Error('project-view-remote-'+code);};
export function validateProjectViewRemoteDelivery(win,delivery,pkg){
 if(delivery?.transport==='isolated-browser-authenticated/v1'){
  const origin=value=>{let u;try{u=new URL(value);}catch{fail('origin');}if(u.username||u.password||u.href!==u.origin+'/'||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))fail('origin');return u.origin;};
  const app=origin(win.location.origin),execution=origin(delivery.executionOrigin),workspaceId=pkg?.scope?.workspaceId;
  if(app!==execution)fail('origin');
  if(typeof workspaceId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)||delivery.sessionPath!=='/api/workspaces/'+encodeURIComponent(workspaceId)+'/project-view-sessions')fail('session-path');
  return execution;
 }
 const origin=value=>{let u;try{u=new URL(value);}catch{fail('origin');}if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.href!==u.origin+'/')fail('origin');return u.origin;};
 if(delivery?.transport!=='isolated-browser/v1')fail('transport');
 const app=origin(win.location.origin),execution=origin(delivery.executionOrigin);
 if(app===execution)fail('origin');
 return execution;
}
/** The application only receives PNG pixels and bounded broker data. Project
 * HTML, scripts and browser DOM never enter this document. */
export function createProjectViewRemote({canvas,delivery,pkg,view,port,isCurrent=()=>true,onError=()=>{},fetch:transport,pollMs=100}){
 const win=canvas.ownerDocument.defaultView,execution=validateProjectViewRemoteDelivery(win,delivery,pkg),authenticated=delivery.transport==='isolated-browser-authenticated/v1',fetcher=transport??win.fetch.bind(win);
 if(!Number.isInteger(pollMs)||pollMs<25||pollMs>1000)fail('poll-interval');
 if(authenticated)pollMs=Math.max(500,pollMs);
 let disposed=false,session=null,startPromise=null,closePromise=null,timer=null,tail=Promise.resolve(),queued=0,errorReported=false,composing=false;
 const lifetime=new win.AbortController(),listeners=[];
 const current=()=>!disposed&&isCurrent();
 canvas.width=WIDTH;canvas.height=HEIGHT;canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',view.title??view.id??'');
 const context=canvas.getContext('2d');if(!context)fail('canvas');
 async function json(response,limit){
  if(!response.ok||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))fail('response');
  const reader=response.body?.getReader();if(!reader)fail('response');
  let size=0;const parts=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)fail('response-limit');parts.push(value);}}
  finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
 }
 async function post(url,body,{token,timeout=10000,abort=true,keepalive=false,limit=4*1024*1024}={}){
  const signal=abort?win.AbortSignal.any([lifetime.signal,win.AbortSignal.timeout(timeout)]):win.AbortSignal.timeout(timeout);
  return json(await fetcher(url,{method:'POST',mode:authenticated?'same-origin':'cors',credentials:authenticated?'same-origin':'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',keepalive,signal,headers:{'Content-Type':'application/json',...(!authenticated&&token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}),limit);
 }
 function report(error){if(errorReported||disposed||!isCurrent())return;errorReported=true;try{onError(error);}finally{void close().catch(()=>{});}}
 function enqueue(body){
  if(!current())return Promise.resolve(null);
  if(++queued>64){queued--;const error=Error('project-view-remote-queue-limit');report(error);return Promise.reject(error);}
  const task=tail.then(async()=>{
   if(!current()||!session)return null;
   const path=authenticated?delivery.sessionPath+'/'+session.id:'/project-views/v1/sessions/'+session.id;
   const result=await post(execution+path,body,{token:session.token,timeout:body.type==='poll'?1500:3000});
   return current()?result:null;
  });
  tail=task.catch(()=>{});task.catch(error=>report(error)).finally(()=>{queued--;});
  return task;
 }
 function sendInput(event){if(current())void enqueue({type:'input',event}).catch(()=>{});}
 const listen=(type,handler,options)=>{canvas.addEventListener(type,handler,options);listeners.push([type,handler,options]);};
 listen('click',event=>{
  if(event.button!==0)return;const rect=canvas.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return;
  const x=Math.floor((event.clientX-rect.left)*WIDTH/rect.width),y=Math.floor((event.clientY-rect.top)*HEIGHT/rect.height);
  if(x<0||x>=WIDTH||y<0||y>=HEIGHT)return;canvas.focus();sendInput({kind:'click',x,y});
 });
 const text=value=>{if(typeof value==='string'&&value.length&&encoder.encode(value).length<=1024)sendInput({kind:'text',text:value});};
 listen('keydown',event=>{
  if(event.isComposing||composing||event.ctrlKey||event.metaKey||event.altKey)return;
  if(['Enter','Escape','Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Backspace','Delete','Home','End','PageUp','PageDown'].includes(event.key)){event.preventDefault();sendInput({kind:'key',key:event.key});}
  else if(typeof event.key==='string'&&[...event.key].length===1){event.preventDefault();text(event.key);}
 });
 listen('compositionstart',()=>{composing=true;});
 listen('compositionend',event=>{composing=false;text(event.data);});
 listen('beforeinput',event=>{if(event.isComposing||composing)return;if(event.inputType==='insertText'){event.preventDefault();text(event.data);}});
 listen('wheel',event=>{if(!Number.isFinite(event.deltaY))return;event.preventDefault();sendInput({kind:'wheel',deltaY:Math.max(-1000,Math.min(1000,event.deltaY))});},{passive:false});
 port.onmessage=event=>{
  if(!current())return;
  try{const message=event.data,bytes=encoder.encode(JSON.stringify(message)).length;if(!message||typeof message!=='object'||Array.isArray(message)||bytes>65536)fail('broker-limit');void enqueue({type:'broker',message}).catch(()=>{});}
  catch(error){report(error);}
 };
 port.start?.();
 async function draw(frame){
  if(!frame||frame.width!==WIDTH||frame.height!==HEIGHT||typeof frame.base64!=='string'||frame.base64.length>Math.ceil(MAX_PNG/3)*4||frame.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(frame.base64))fail('frame');
  const bytes=Uint8Array.from(win.atob(frame.base64),character=>character.charCodeAt(0));
  if(bytes.length<33||bytes.length>MAX_PNG||[137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n)||new DataView(bytes.buffer).getUint32(16)!==WIDTH||new DataView(bytes.buffer).getUint32(20)!==HEIGHT)fail('frame');
  const image=await win.createImageBitmap(new win.Blob([bytes],{type:'image/png'}));
  try{if(image.width!==WIDTH||image.height!==HEIGHT)fail('frame-dimensions');if(current())context.drawImage(image,0,0,WIDTH,HEIGHT);}
  finally{image.close();}
 }
 async function poll(){
  if(!current())return;
  try{
   const result=await enqueue({type:'poll'});if(!result||!current())return;
   if(result.closed===true){report(Error('project-view-remote-closed'));return;}
   if(result.closed!==undefined&&typeof result.closed!=='boolean'||!Array.isArray(result.messages)||result.messages.length>64)fail('poll');
   let bytes=0;
   for(const message of result.messages){const length=encoder.encode(JSON.stringify(message)).length;bytes+=length;if(!message||typeof message!=='object'||Array.isArray(message)||length>4096||bytes>256*1024)fail('broker-limit');if(current())port.postMessage(message);}
   if(result.frame)await draw(result.frame);
   if(current())timer=win.setTimeout(()=>void poll(),pollMs);
  }catch(error){report(error);}
 }
 function start(){
  if(startPromise)return startPromise;
  startPromise=(async()=>{
   if(!current())return;
   // Keep the bounded create response observable after disposal, so a late
   // original ID can be closed. The host must expire abandoned create replies.
   if(authenticated)session={id:win.crypto.randomUUID()};
   const body=authenticated?{requestId:session.id,packageIdentity:pkg.packageIdentity,viewId:view.id}:{package:pkg,view};
   const result=await post(execution+(authenticated?delivery.sessionPath:'/project-views/v1/sessions'),body,{abort:false,limit:4096});
   if(authenticated){if(!result||Object.keys(result).join(',')!=='id'||result.id!==session.id)fail('session');}
   else{
    if(!result||typeof result.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(result.id)||typeof result.token!=='string'||!/^[A-Za-z0-9_-]{1,512}$/.test(result.token))fail('session');
    session={id:result.id,token:result.token};
   }
   if(current())void poll();else void close().catch(()=>{});
  })().catch(error=>{if(authenticated)void close().catch(()=>{});throw error;});
  return startPromise;
 }
 function close(){
  if(closePromise)return closePromise;
  disposed=true;win.clearTimeout(timer);lifetime.abort();port.onmessage=null;port.close();
  for(const [type,handler,options]of listeners)canvas.removeEventListener(type,handler,options);
  closePromise=(async()=>{
   try{await startPromise;}catch{if(!authenticated)return;}
   if(!session)return;
   const path=authenticated?'/api/project-view-sessions/'+session.id+'/close':'/project-views/v1/sessions/'+session.id;
   const result=await post(execution+path,authenticated?{workspaceId:pkg.scope.workspaceId}:{type:'close'},{token:session.token,abort:false,keepalive:true,limit:4096});
   if(result.closed!==true||result.cleanupConfirmed!==true)fail('cleanup-unconfirmed');
  })().catch(error=>{closePromise=null;throw error;});
  return closePromise;
 }
 return {start,close};
}
