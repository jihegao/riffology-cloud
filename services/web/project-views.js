import {msg} from './i18n.js';
import {bindValue} from './i18n-bindings.js';
import {createProjectViewLocal,PROJECT_VIEW_HTTP_TIMEOUT_MS,PROJECT_VIEW_RPC_TIMEOUT_MS} from './project-view-local.js';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf8',{fatal:true});
const fail=code=>{throw Error('project-view-'+code);};
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const decode=asset=>Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0));
const irOperations=new Set(['show','draft','records','heartbeat','submit','detach','project_ir_result']);
const IR_INPUT_BYTES=256*1024,IR_RESPONSE_BYTES=512*1024;
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
/** Called only with a package returned by the current authenticated host API. */
export async function verifyProjectViewPackage(pkg,scope,isCurrent=()=>true){
 if(!isCurrent()||!pkg||pkg.schema!=='project.view-package/v1'||pkg.scope?.tenantId!==scope.tenantId||pkg.scope?.workspaceId!==scope.workspaceId||scope.projectId&&pkg.scope.projectId!==scope.projectId||scope.workspaceGeneration!==undefined&&pkg.scope.workspaceGeneration!==scope.workspaceGeneration||!Array.isArray(pkg.assets)||pkg.assets.length>64||pkg.manifest?.schema!=='project.views/v1'||!Array.isArray(pkg.manifest.views)||pkg.manifest.views.length>16)fail('scope-denied');
 const {packageIdentity,...body}=pkg;
 const bytes=encoder.encode(JSON.stringify(body));if(bytes.length>3*1024*1024||await sha(bytes)!==packageIdentity)fail('package-digest');
 if(!isCurrent())fail('stale');
 const paths=new Set();let size=0;
 for(const a of pkg.assets){if(!a||typeof a.path!=='string'||paths.has(a.path)||typeof a.base64!=='string'||typeof a.mediaType!=='string')fail('asset-invalid');paths.add(a.path);const bytes=decode(a);size+=bytes.length;if(bytes.length>256*1024||size>2*1024*1024||await sha(bytes)!==a.sha256)fail('asset-digest');if(!isCurrent())fail('stale');}
 if(pkg.manifest.files.length!==paths.size||pkg.manifest.files.some(p=>!paths.has(p))||pkg.manifest.views.some(v=>!paths.has(v.entrypoint)))fail('closure-invalid');
 return pkg;
}
/** Scope is a closure held by the host, never a claim accepted from a frame.
 * No app API URL, credentials, command or arbitrary file write enters this port.
 * IR replies and result submissions use their own explicit bounded contract. */
export function createProjectViewBroker({port,pkg,isCurrent,onNavigate=()=>{},onState=()=>{},readAsset,readArtifacts=async()=>({items:[],nextCursor:null,version:null}),irRequest=async()=>{throw Error('ir-unavailable');},authorize=async()=>{},liveness=false,requestTimeoutMs=PROJECT_VIEW_RPC_TIMEOUT_MS}){
 if(!Number.isInteger(requestTimeoutMs)||requestTimeoutMs<100||requestTimeoutMs>PROJECT_VIEW_RPC_TIMEOUT_MS)fail('request-budget');
 let closed=false,failed=false,lastId=0,inflight=0,subscribed=false,artifactState=null,subscriptionEpoch=0;const requests=new Map();
 const post=port.postMessage.bind(port),closePort=port.close.bind(port),setTimer=globalThis.setTimeout.bind(globalThis),clearTimer=globalThis.clearTimeout.bind(globalThis),now=globalThis.performance.now.bind(globalThis.performance);
 let livenessStarted=false,pingNonce=null,pingTimer=null,pongTimer=null,pongDeadline=null;
 const current=()=>!closed&&isCurrent();
 function close(){if(closed)return;closed=true;subscriptionEpoch++;subscribed=false;clearTimer(pingTimer);clearTimer(pongTimer);pingTimer=pongTimer=pingNonce=pongDeadline=null;for(const [controller,timer] of requests){clearTimer(timer);controller.abort();}requests.clear();port.onmessage=null;closePort();}
 function ping(){
  pingTimer=null;if(!current())return;
  pingNonce=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
  pongDeadline=now()+3000;pongTimer=setTimer(()=>{if(!current())return;close();onState('failed');},3000);
  try{post({type:'project-view-ping',nonce:pingNonce});}catch{close();onState('failed');}
 }
 const checkAuthorization=async(options)=>{try{await authorize(options);}catch(error){if(current()&&!options?.signal?.aborted){failed=true;onState('failed');}throw error;}};
 const failHeartbeat=()=>{if(closed)return;const notify=!failed;failed=true;close();if(notify)onState('failed');};
 async function withinBudget(work,deliver=()=>{}){
  const controller=new AbortController(),deadline=now()+requestTimeoutMs;let expired=false,rejectAbort;
  const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
  const abort=()=>rejectAbort(Error(expired?'request-timeout':'request-ended'));
  controller.signal.addEventListener('abort',abort,{once:true});
  const timer=setTimer(()=>{expired=true;controller.abort();},requestTimeoutMs);requests.set(controller,timer);
  const alive=()=>{if(now()>=deadline){expired=true;controller.abort();}return current()&&!controller.signal.aborted;};
  try{const result=await Promise.race([work(controller.signal,alive),aborted]);if(!alive())throw Error(expired?'request-timeout':'request-ended');deliver(result);return result;}
  finally{clearTimer(timer);requests.delete(controller);controller.signal.removeEventListener('abort',abort);controller.abort();}
 }
 const snapshot=()=>({revisionId:pkg.revisionId,filesSha256:pkg.filesSha256,packageIdentity:pkg.packageIdentity,files:pkg.assets.map(({path,sha256,mediaType})=>({path,sha256,mediaType})),artifacts:artifactState,views:pkg.manifest.views.map(({id,title,entrypoint})=>({id,title,entrypoint}))});
 const send=(value,maxBytes=65536)=>{if(!current())return false;if(encoder.encode(JSON.stringify(value)).length>maxBytes){if(value.id)post({id:value.id,error:'response-too-large'});return false;}post(value);return true;};
 port.onmessage=async event=>{
  if(!current())return;
  const m=event.data;
  if(!m||typeof m!=='object'||Array.isArray(m))return;
  try{if(encoder.encode(JSON.stringify(m)).length>(m.type==='ir.request'?IR_INPUT_BYTES+1024:4096)){if(m.type==='ir.request'&&Number.isSafeInteger(m.id)&&m.id>lastId&&m.id<=2147483647){lastId=m.id;send({id:m.id,error:'request-too-large'});}return;}}catch{return;}
  if(m.type==='ended'&&Object.keys(m).sort().join(',')==='reason,type'&&m.reason==='navigation-ended'){failed=true;close();onState('navigation-ended');return;}
  if(m.type==='project-view-pong'){
   if(liveness===true&&pingNonce!==null&&Object.keys(m).sort().join(',')==='nonce,type'&&m.nonce===pingNonce){if(now()>=pongDeadline){close();onState('failed');return;}clearTimer(pongTimer);pongTimer=pongDeadline=null;pingNonce=null;pingTimer=setTimer(ping,1000);}return;
  }
  if(m.type==='installed'&&Object.keys(m).length===1){if(!failed){onState('ready');if(liveness===true&&!livenessStarted&&current()){livenessStarted=true;ping();}}return;}
  if(m.type==='failed'&&Object.keys(m).sort().join(',')==='error,type'&&['page-install-failed','page-script-failed','page-script-timeout'].includes(m.error)){failed=true;onState('failed');return;}
  if(!Number.isSafeInteger(m.id)||m.id<=lastId||m.id>2147483647)return;
  lastId=m.id;
  const keys=Object.keys(m).sort().join(','),expected=m.type==='ir.request'?'id,input,operation,type':m.type==='files.read'?'id,path,type':m.type==='artifacts.list'?'cursor,id,type':m.type==='artifacts.read'?'artifactId,id,offset,type':m.type==='navigate'?'entrypoint,id,type':'id,type';
  if(keys!==expected||inflight>=8||m.type==='ir.request'&&(!irOperations.has(m.operation)||!object(m.input))){send({id:m.id,error:'request-denied'});return;}
  const heartbeat=m.type==='ir.request'&&m.operation==='heartbeat';
  const requestSubscriptionEpoch=['updates.subscribe','updates.cancel'].includes(m.type)?++subscriptionEpoch:null;
  if(requestSubscriptionEpoch!==null)subscribed=false;
  inflight++;
  try{
   await withinBudget(async(signal,alive)=>{
    await checkAuthorization({signal});if(!alive())return;
    let value,subscriptionState;
    if(m.type==='ir.request'){
     if(encoder.encode(JSON.stringify(m.input)).length>IR_INPUT_BYTES){send({id:m.id,error:'request-too-large'});return;}
     value=await irRequest(m.operation,m.input,{signal});
     // A lost/uncertain response can follow a persisted claim. Close this
     // original frame instead of renewing a run that it never received.
     if(heartbeat&&(!object(value)||value.connected!==true||value.status==='failed'))throw Error('project-ir-heartbeat-failed');
    }else if(m.type==='files.list')value=snapshot().files;
    else if(m.type==='artifacts.list'){
     if(m.cursor!==null&&(typeof m.cursor!=='string'||! /^(?:[a-f0-9]{64}:){2,3}artifact-[a-f0-9]{60}$/.test(m.cursor)))throw Error('cursor-denied');
     value=await readArtifacts({cursor:m.cursor},{signal});
    }else if(m.type==='artifacts.read'){
     if(typeof m.artifactId!=='string'||! /^(?:artifact-[a-f0-9]{60}|manual-artifact-[a-f0-9]{64})$/.test(m.artifactId)||!Number.isSafeInteger(m.offset)||m.offset<0||m.offset>1114112)throw Error('artifact-denied');
     value=await readArtifacts({artifactId:m.artifactId,offset:m.offset},{signal});
    }else if(m.type==='files.read'){
     const a=pkg.assets.find(a=>a.path===m.path);if(!a)throw Error('file-denied');
     const bytes=readAsset?await readAsset(a,{signal}):decode(a);if(!alive())return;
     if(bytes.length>32768)throw Error('file-too-large');
     value=/^(text\/|application\/json)/.test(a.mediaType)?{path:a.path,sha256:a.sha256,sourceSha256:a.sourceSha256,text:decoder.decode(bytes)}:{path:a.path,sha256:a.sha256,sourceSha256:a.sourceSha256,base64:a.base64,mediaType:a.mediaType};
    }else if(m.type==='updates.subscribe'){
     subscriptionState=await readArtifacts({cursor:null},{signal});if(!alive())return;
     value={subscribed:requestSubscriptionEpoch===subscriptionEpoch};
    }else if(m.type==='updates.cancel')value={subscribed:false};
    else if(m.type==='navigate'){
     const v=pkg.manifest.views.find(v=>v.entrypoint===m.entrypoint);if(!v)throw Error('route-denied');
     if(alive())onNavigate(v.id);value={accepted:true};
    }else throw Error('request-denied');
    // A package update or Catalog revocation can happen while bytes are being
    // read. Recheck the real host authority at the final delivery boundary.
    if(['ir.request','files.read','artifacts.list','artifacts.read','updates.subscribe'].includes(m.type)){
     if(!alive())return;
     await checkAuthorization({signal});if(!alive())return;
     if(m.type==='updates.subscribe'&&requestSubscriptionEpoch!==subscriptionEpoch)return {value:{subscribed:false}};
    }
    if(!alive())return;
    return {value,subscriptionState};
   },result=>{
    if(!result)return;
    if(m.type==='updates.subscribe'&&requestSubscriptionEpoch===subscriptionEpoch){artifactState=result.subscriptionState;subscribed=true;}
    const delivered=send({id:m.id,value:result.value},m.type==='ir.request'?IR_RESPONSE_BYTES:65536);if(heartbeat&&!delivered)failHeartbeat();if(subscribed&&m.type==='updates.subscribe')send({type:'snapshot',snapshot:snapshot()});
   });
  }catch(error){
   if(!current())return;
   const timedOut=error?.message==='request-timeout',code=error?.code??error?.message;
   const reason=timedOut?'request-timeout':m.type==='ir.request'&&code==='project-ir-response-too-large'?'response-too-large':m.type==='ir.request'&&['project-ir-request-too-large','body_too_large'].includes(code)?'request-too-large':'request-denied';
   try{send({id:m.id,error:reason});}catch{ /* The original port may already be unavailable. */ }
   finally{if(heartbeat)failHeartbeat();}
   if(timedOut&&!closed){failed=true;close();onState('failed');}
  }finally{inflight--;}
 };
 port.start?.();
 return {close,async publish(){if(!subscribed||!current())return;const epoch=subscriptionEpoch;await withinBudget(async(signal,alive)=>{await checkAuthorization({signal});if(!alive()||!subscribed||epoch!==subscriptionEpoch)return;const state=await readArtifacts({cursor:null},{signal});if(!alive()||!subscribed||epoch!==subscriptionEpoch)return;await checkAuthorization({signal});if(!alive()||!subscribed||epoch!==subscriptionEpoch)return;artifactState=state;send({type:'snapshot',snapshot:snapshot()});});},get closed(){return closed;}};
}
export function createProjectViewsPanel({root,api,pollMs=5000}){
 const doc=root.ownerDocument,win=doc.defaultView;
 let context=null,generation=0,pkg=null,delivery=null,selected='',frame=null,local=null,broker=null,timer=null,requestEpoch=0,active=false,visible=true,closeTail=Promise.resolve();
 let failedPackageIdentity=null;
 const nav=doc.createElement('div'),body=doc.createElement('div'),status=doc.createElement('p'),retry=doc.createElement('button');
 nav.className='workspace-subtabs';nav.setAttribute('role','tablist');body.className='project-view-body';status.className='meta';retry.type='button';bindValue(retry,msg('projectViews.retry'));retry.onclick=()=>{failedPackageIdentity=null;void reload();};
 const storageKey=()=> 'riffology:project-views:'+context?.tenantId+':'+context?.workspaceId;
 async function readApi(path,signal,options={},timeoutMs=PROJECT_VIEW_HTTP_TIMEOUT_MS){
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,timeoutMs);
  try{return await api(path,{...options,signal:controller.signal});}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 function disposeFrame(){
  broker?.close();broker=null;frame?.remove();frame=null;
  const old=local;local=null;
  const task=closeTail.catch(()=>{}).then(()=>old?.close());
  closeTail=task;return task;
 }
 function leave(){generation++;requestEpoch++;clearTimeout(timer);timer=null;active=false;void disposeFrame().catch(()=>{});context=null;pkg=null;delivery=null;failedPackageIdentity=null;root.replaceChildren();}
 function renderNav(){nav.replaceChildren();for(const v of pkg?.manifest.views??[]){const button=doc.createElement('button');button.type='button';button.textContent=v.title;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(v.id===selected));button.onclick=()=>void choose(v.id);nav.append(button);}nav.hidden=!pkg||pkg.manifest.views.length<2;}
 async function choose(id){
  if(!active||!context||!pkg||!delivery)return;
  const ownPackage=pkg,ownContext=context,ownDelivery=delivery;
  const view=ownPackage.manifest.views.find(v=>v.id===id)??ownPackage.manifest.views[0];if(!view)return;
  generation++;const token=generation,disposal=disposeFrame();selected=view.id;failedPackageIdentity=null;renderNav();
  try{win.sessionStorage.setItem(storageKey(),JSON.stringify({id:selected}));}catch{}
  const current=()=>active&&token===generation&&context===ownContext&&pkg===ownPackage;
  try{
   // A route/scope change closes the original local frame and broker first.
   await disposal;if(!current())return;
   await verifyProjectViewPackage(ownPackage,ownContext,current);if(!current())return;
   bindValue(status,msg('projectViews.loading'));retry.hidden=true;
   const channel=new win.MessageChannel();
   broker=createProjectViewBroker({
    port:channel.port1,pkg:ownPackage,isCurrent:current,liveness:true,
    readArtifacts:async(query,{signal}={})=>{
     const params=new URLSearchParams({identity:ownPackage.packageIdentity});
     if(query.cursor)params.set('cursor',query.cursor);if(query.offset!==undefined)params.set('offset',String(query.offset));
     return readApi('/api/workspaces/'+encodeURIComponent(ownContext.workspaceId)+'/project-view-artifacts'+(query.artifactId?'/'+query.artifactId:'')+'?'+params,signal);
    },
    irRequest:async(operation,input,{signal}={})=>{
     if(!current())fail('stale');
     const result=await readApi('/api/workspaces/'+encodeURIComponent(ownContext.workspaceId)+'/project-ir',signal,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({packageIdentity:ownPackage.packageIdentity,operation,input})},25000);
     if(!current())fail('stale');return result;
    },
    onNavigate:next=>void choose(next),
    authorize:async({signal}={})=>{
     const authority=await readApi('/api/workspaces/'+encodeURIComponent(ownContext.workspaceId)+'/project-views?identity='+ownPackage.packageIdentity,signal);
     if(!authority?.current)fail('revoked');
    },
    onState:state=>{if(current()){if(state==='ready')ownLocal.installed();if(state==='failed'||state==='navigation-ended'){failedPackageIdentity=ownPackage.packageIdentity;void disposeFrame().catch(()=>{});}bindValue(status,msg(state==='ready'?'projectViews.ready':state==='navigation-ended'?'projectViews.navigationEnded':'projectViews.loadFailed'));retry.hidden=state==='ready';}},
   });
   const ownLocal=createProjectViewLocal({
    container:body,delivery:ownDelivery,pkg:ownPackage,view,port:channel.port2,isCurrent:current,
    onError:error=>{if(current()){failedPackageIdentity=ownPackage.packageIdentity;void disposeFrame().catch(()=>{});bindValue(status,msg(error.message==='project-view-local-navigation-ended'?'projectViews.navigationEnded':'projectViews.loadFailed'));retry.hidden=false;}},
   });
   local=ownLocal;frame=ownLocal.frame;
   await ownLocal.start();if(!current())await ownLocal.close();
  }catch{
   if(current()){if(local||broker||frame)await disposeFrame().catch(()=>{});failedPackageIdentity=ownPackage.packageIdentity;bindValue(status,msg('projectViews.unavailable'));retry.hidden=false;}
  }
 }
 async function reload(){
  if(!active||!context)return;const epoch=++requestEpoch,own=context;
  clearTimeout(timer);
  try{
   const result=await api('/api/workspaces/'+encodeURIComponent(own.workspaceId)+'/project-views',{signal:AbortSignal.timeout(10000)});
   if(!active||context!==own||epoch!==requestEpoch)return;
   if(!result?.package){generation++;await disposeFrame();pkg=null;root.hidden=true;return;}
   await verifyProjectViewPackage(result.package,own,()=>active&&context===own&&epoch===requestEpoch);
   if(!active||context!==own||epoch!==requestEpoch)return;
   root.hidden=false;
   if(failedPackageIdentity===result.package.packageIdentity)return;
   if(pkg?.packageIdentity!==result.package.packageIdentity||!frame||delivery?.executionOrigin!==result.delivery?.executionOrigin||delivery?.transport!==result.delivery?.transport||delivery?.frameUrl!==result.delivery?.frameUrl||delivery?.frameSha256!==result.delivery?.frameSha256){pkg=result.package;delivery=result.delivery;await choose(selected);}
   else await broker?.publish();
  }catch{
   if(active&&context===own&&epoch===requestEpoch){failedPackageIdentity=pkg?.packageIdentity??failedPackageIdentity;generation++;await disposeFrame().catch(()=>{});bindValue(status,msg('projectViews.savedUnavailable'));retry.hidden=false;root.hidden=false;}
  }finally{if(active&&context===own&&epoch===requestEpoch)timer=setTimeout(()=>void reload(),pollMs);}
 }
 function setActive(value){if(visible===value)return;visible=value;if(!value){active=false;generation++;requestEpoch++;clearTimeout(timer);void disposeFrame().catch(()=>{});}else if(context){active=true;void reload();}}
 win.addEventListener('pagehide',()=>leave());
 return {async enter(scope){leave();context=scope;active=visible;try{selected=JSON.parse(win.sessionStorage.getItem(storageKey())??'null')?.id??'';}catch{selected='';}root.replaceChildren(nav,status,retry,body);retry.hidden=true;await reload();},leave,reload,setActive};
}
