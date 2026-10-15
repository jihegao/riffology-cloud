import {msg} from './i18n.js';
import {bindValue} from './i18n-bindings.js';
import {createProjectViewRemote} from './project-view-remote.js';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf8',{fatal:true});
const fail=code=>{throw Error('project-view-'+code);};
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const decode=asset=>Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0));
/** Called only with a package returned by the current authenticated host API. */
export async function verifyProjectViewPackage(pkg,scope,isCurrent=()=>true){
 if(!isCurrent()||!pkg||pkg.schema!=='project.view-package/v1'||pkg.scope?.tenantId!==scope.tenantId||pkg.scope?.workspaceId!==scope.workspaceId||scope.projectId&&pkg.scope.projectId!==scope.projectId||!Array.isArray(pkg.assets)||pkg.assets.length>64||pkg.manifest?.schema!=='project.views/v1'||!Array.isArray(pkg.manifest.views)||pkg.manifest.views.length>16)fail('scope-denied');
 const {packageIdentity,...body}=pkg;
 const bytes=encoder.encode(JSON.stringify(body));if(bytes.length>3*1024*1024||await sha(bytes)!==packageIdentity)fail('package-digest');
 if(!isCurrent())fail('stale');
 const paths=new Set();let size=0;
 for(const a of pkg.assets){if(!a||typeof a.path!=='string'||paths.has(a.path)||typeof a.base64!=='string'||typeof a.mediaType!=='string')fail('asset-invalid');paths.add(a.path);const bytes=decode(a);size+=bytes.length;if(bytes.length>256*1024||size>2*1024*1024||await sha(bytes)!==a.sha256)fail('asset-digest');if(!isCurrent())fail('stale');}
 if(pkg.manifest.files.length!==paths.size||pkg.manifest.files.some(p=>!paths.has(p))||pkg.manifest.views.some(v=>!paths.has(v.entrypoint)))fail('closure-invalid');
 return pkg;
}
/** Scope is a closure held by the host, never a claim accepted from a frame.
 * No app API URL, credentials, command or write operation enters this port. */
export function createProjectViewBroker({port,pkg,isCurrent,onNavigate=()=>{},onState=()=>{},readAsset,readArtifacts=async()=>({items:[],nextCursor:null,version:null}),authorize=async()=>{}}){
 let closed=false,failed=false,lastId=0,inflight=0,subscribed=false,artifactState=null,subscriptionEpoch=0;
 const current=()=>!closed&&isCurrent();
 const snapshot=()=>({revisionId:pkg.revisionId,filesSha256:pkg.filesSha256,packageIdentity:pkg.packageIdentity,files:pkg.assets.map(({path,sha256,mediaType})=>({path,sha256,mediaType})),artifacts:artifactState,views:pkg.manifest.views.map(({id,title,entrypoint})=>({id,title,entrypoint}))});
 const send=value=>{if(!current())return;if(encoder.encode(JSON.stringify(value)).length>65536){if(value.id)port.postMessage({id:value.id,error:'response-too-large'});return;}port.postMessage(value);};
 port.onmessage=async event=>{
  if(!current())return;
  const m=event.data;
  if(!m||typeof m!=='object'||Array.isArray(m)||encoder.encode(JSON.stringify(m)).length>4096)return;
  if(m.type==='installed'&&Object.keys(m).length===1){if(!failed)onState('ready');return;}
  if(m.type==='failed'&&Object.keys(m).sort().join(',')==='error,type'&&['page-install-failed','page-script-failed','page-script-timeout'].includes(m.error)){failed=true;onState('failed');return;}
  if(!Number.isSafeInteger(m.id)||m.id<=lastId||m.id>2147483647)return;
  lastId=m.id;
  const keys=Object.keys(m).sort().join(','),expected=m.type==='files.read'?'id,path,type':m.type==='artifacts.list'?'cursor,id,type':m.type==='artifacts.read'?'artifactId,id,offset,type':m.type==='navigate'?'entrypoint,id,type':'id,type';
  if(keys!==expected||inflight>=8){send({id:m.id,error:'request-denied'});return;}
  const requestSubscriptionEpoch=['updates.subscribe','updates.cancel'].includes(m.type)?++subscriptionEpoch:null;
  if(requestSubscriptionEpoch!==null)subscribed=false;
  inflight++;
  try{
   await authorize();if(!current())return;
   let value;
   if(m.type==='files.list')value=snapshot().files;
   else if(m.type==='artifacts.list'){
    if(m.cursor!==null&&(typeof m.cursor!=='string'||! /^(?:[a-f0-9]{64}:){2,3}artifact-[a-f0-9]{60}$/.test(m.cursor)))throw Error('cursor-denied');
    value=await readArtifacts({cursor:m.cursor});
   }else if(m.type==='artifacts.read'){
    if(typeof m.artifactId!=='string'||! /^(?:artifact-[a-f0-9]{60}|manual-artifact-[a-f0-9]{64})$/.test(m.artifactId)||!Number.isSafeInteger(m.offset)||m.offset<0||m.offset>1114112)throw Error('artifact-denied');
    value=await readArtifacts({artifactId:m.artifactId,offset:m.offset});
   }
   else if(m.type==='files.read'){
    const a=pkg.assets.find(a=>a.path===m.path);if(!a)throw Error('file-denied');
    const bytes=readAsset?await readAsset(a):decode(a);if(!current())return;
    if(bytes.length>32768)throw Error('file-too-large');
    value=/^(text\/|application\/json)/.test(a.mediaType)?{path:a.path,sha256:a.sha256,sourceSha256:a.sourceSha256,text:decoder.decode(bytes)}:{path:a.path,sha256:a.sha256,sourceSha256:a.sourceSha256,base64:a.base64,mediaType:a.mediaType};
   }else if(m.type==='updates.subscribe'){const epoch=requestSubscriptionEpoch;const state=await readArtifacts({cursor:null});if(!current())return;if(epoch!==subscriptionEpoch){send({id:m.id,value:{subscribed:false}});return;}artifactState=state;subscribed=true;value={subscribed:true};}
   else if(m.type==='updates.cancel'){value={subscribed:false};}
   else if(m.type==='navigate'){
    const v=pkg.manifest.views.find(v=>v.entrypoint===m.entrypoint);if(!v)throw Error('route-denied');
    if(current())onNavigate(v.id);value={accepted:true};
   }else throw Error('request-denied');
   if(!current())return;send({id:m.id,value});if(subscribed&&m.type==='updates.subscribe')send({type:'snapshot',snapshot:snapshot()});
  }catch{send({id:m.id,error:'request-denied'});if(!current())return;}finally{inflight--;}
 };
 port.start?.();
 return {close(){closed=true;subscriptionEpoch++;subscribed=false;port.onmessage=null;port.close();},async publish(){if(!subscribed||!current())return;const epoch=subscriptionEpoch;await authorize();if(!current()||!subscribed||epoch!==subscriptionEpoch)return;const state=await readArtifacts({cursor:null});if(!current()||!subscribed||epoch!==subscriptionEpoch)return;artifactState=state;send({type:'snapshot',snapshot:snapshot()});},get closed(){return closed;}};
}
export function createProjectViewsPanel({root,api,pollMs=5000}){
 const doc=root.ownerDocument,win=doc.defaultView;
 let context=null,generation=0,pkg=null,delivery=null,selected='',frame=null,remote=null,broker=null,timer=null,requestEpoch=0,active=false,visible=true,closeTail=Promise.resolve();
 const closing=new Set();
 const nav=doc.createElement('div'),body=doc.createElement('div'),status=doc.createElement('p'),retry=doc.createElement('button');
 nav.className='workspace-subtabs';nav.setAttribute('role','tablist');body.className='project-view-body';status.className='meta';retry.type='button';bindValue(retry,msg('projectViews.retry'));retry.onclick=()=>void reload();
 const storageKey=()=> 'riffology:project-views:'+context?.tenantId+':'+context?.workspaceId;
 function disposeFrame(){
  broker?.close();broker=null;frame?.remove();frame=null;
  if(remote){closing.add(remote);remote=null;}
  const task=closeTail.catch(()=>{}).then(async()=>{for(const old of [...closing]){await old.close();closing.delete(old);}});
  closeTail=task;return task;
 }
 function leave(){generation++;requestEpoch++;clearTimeout(timer);timer=null;active=false;void disposeFrame().catch(()=>{});context=null;pkg=null;delivery=null;root.replaceChildren();}
 function renderNav(){nav.replaceChildren();for(const v of pkg?.manifest.views??[]){const button=doc.createElement('button');button.type='button';button.textContent=v.title;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(v.id===selected));button.onclick=()=>void choose(v.id);nav.append(button);}nav.hidden=!pkg||pkg.manifest.views.length<2;}
 async function choose(id){
  if(!active||!context||!pkg||!delivery)return;
  const ownPackage=pkg,ownContext=context,ownDelivery=delivery;
  const view=ownPackage.manifest.views.find(v=>v.id===id)??ownPackage.manifest.views[0];if(!view)return;
  generation++;const token=generation,disposal=disposeFrame();selected=view.id;renderNav();
  try{win.sessionStorage.setItem(storageKey(),JSON.stringify({id:selected}));}catch{}
  const current=()=>active&&token===generation&&context===ownContext&&pkg===ownPackage;
  try{
   // The local host has one slot. A route/scope change first confirms that its
   // original browser session is closed, then creates the replacement.
   await disposal;if(!current())return;
   await verifyProjectViewPackage(ownPackage,ownContext,current);if(!current())return;
   frame=doc.createElement('canvas');const ownFrame=frame;
   ownFrame.style.cssText='width:100%;max-width:800px;height:auto;aspect-ratio:4/3;display:block';
   bindValue(status,msg('projectViews.loading'));retry.hidden=true;
   const channel=new win.MessageChannel();
   broker=createProjectViewBroker({
    port:channel.port1,pkg:ownPackage,isCurrent:current,
    readArtifacts:async query=>{
     const params=new URLSearchParams({identity:ownPackage.packageIdentity});
     if(query.cursor)params.set('cursor',query.cursor);if(query.offset!==undefined)params.set('offset',String(query.offset));
     return api('/api/workspaces/'+encodeURIComponent(ownContext.workspaceId)+'/project-view-artifacts'+(query.artifactId?'/'+query.artifactId:'')+'?'+params,{signal:AbortSignal.timeout(10000)});
    },
    onNavigate:next=>void choose(next),
    authorize:async()=>{
     const authority=await api('/api/workspaces/'+encodeURIComponent(ownContext.workspaceId)+'/project-views?identity='+ownPackage.packageIdentity,{signal:AbortSignal.timeout(10000)});
     if(!authority?.current)fail('revoked');
    },
    onState:state=>{if(current()){if(state==='failed')void disposeFrame().catch(()=>{});bindValue(status,msg(state==='ready'?'projectViews.ready':'projectViews.loadFailed'));retry.hidden=state==='ready';}},
   });
   const ownRemote=createProjectViewRemote({
    canvas:ownFrame,delivery:ownDelivery,pkg:ownPackage,view,port:channel.port2,isCurrent:current,
    onError:()=>{if(current()){void disposeFrame().catch(()=>{});bindValue(status,msg('projectViews.loadFailed'));retry.hidden=false;}},
   });
   remote=ownRemote;body.replaceChildren(ownFrame);
   await ownRemote.start();if(!current())await ownRemote.close();
  }catch{
   if(current()){if(remote||broker||frame)await disposeFrame().catch(()=>{});bindValue(status,msg('projectViews.unavailable'));retry.hidden=false;}
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
   if(pkg?.packageIdentity!==result.package.packageIdentity||!frame||delivery?.executionOrigin!==result.delivery?.executionOrigin||delivery?.transport!==result.delivery?.transport){pkg=result.package;delivery=result.delivery;await choose(selected);}
   else await broker?.publish();
  }catch{
   if(active&&context===own&&epoch===requestEpoch){generation++;await disposeFrame().catch(()=>{});bindValue(status,msg('projectViews.savedUnavailable'));retry.hidden=false;root.hidden=false;}
  }finally{if(active&&context===own&&epoch===requestEpoch)timer=setTimeout(()=>void reload(),pollMs);}
 }
 function setActive(value){if(visible===value)return;visible=value;if(!value){active=false;generation++;requestEpoch++;clearTimeout(timer);void disposeFrame().catch(()=>{});}else if(context){active=true;void reload();}}
 win.addEventListener('pagehide',()=>leave());
 return {async enter(scope){leave();context=scope;active=visible;try{selected=JSON.parse(win.sessionStorage.getItem(storageKey())??'null')?.id??'';}catch{selected='';}root.replaceChildren(nav,status,retry,body);retry.hidden=true;await reload();},leave,reload,setActive};
}
