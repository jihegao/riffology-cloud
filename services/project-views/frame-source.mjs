/** This bootstrap runs in the independent, opaque, untrusted page frame. Its
 * messages are never action success, evidence or permission authority. */
export function bootstrap(){
 'use strict';
 let port,started=false,failed=false,sequence=0,connectionNonce=null,connectionOrigin=null;const pending=new Map(),listeners=new Set(),urls=[];
 const reportFailure=code=>{if(failed)return;failed=true;port?.postMessage({type:'failed',error:code});};
 window.addEventListener('error',()=>reportFailure('page-script-failed'));
 window.addEventListener('unhandledrejection',()=>reportFailure('page-script-failed'));
 const request=(type,extra={})=>new Promise((resolve,reject)=>{if(!port)return reject(Error('page disconnected'));if(pending.size>=8)return reject(Error('page request limit'));const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('page request timeout'));},5000);pending.set(id,{resolve,reject,timer});port.postMessage({type,id,...extra});});
 Object.defineProperty(window,'riffoid',{value:Object.freeze({listFiles:()=>request('files.list'),readFile:path=>request('files.read',{path}),listArtifacts:(cursor=null)=>request('artifacts.list',{cursor}),readArtifact:(artifactId,offset=0)=>request('artifacts.read',{artifactId,offset}),subscribe:async listener=>{if(typeof listener!=='function')throw Error('listener required');listeners.add(listener);await request('updates.subscribe');return()=>{listeners.delete(listener);if(!listeners.size)void request('updates.cancel').catch(()=>{});};}})});
 function resolve(from,ref){const u=new URL(ref,'https://project.invalid/'+from);if(u.origin!=='https://project.invalid'||u.search||!assets.has(u.pathname.slice(1)))throw Error('undeclared page asset');return u.pathname.slice(1);}
 let assets=new Map(),blob=new Map();
 const url=(bytes,type)=>{const result=URL.createObjectURL(new Blob([bytes],{type}));urls.push(result);return result;};
 const decode=a=>Uint8Array.from(atob(a.base64),c=>c.charCodeAt(0));
 function assetUrl(path,stack=[]){if(blob.has(path))return blob.get(path);if(stack.includes(path))throw Error('cyclic stylesheet');const a=assets.get(path);if(!a)throw Error('undeclared page asset');let bytes=decode(a);if(a.mediaType==='text/css')bytes=css(new TextDecoder().decode(bytes),path,[...stack,path]);const result=url(bytes,a.mediaType);blob.set(path,result);return result;}
 function css(text,path,stack=[]){return text.replace(/@import\s+(["'])([^"']+)\1/g,(_,q,ref)=>`@import url("${assetUrl(resolve(path,ref),stack)}")`).replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g,(_,q,ref)=>{if(ref.startsWith('blob:')||ref.startsWith('data:'))return `url("${ref}")`;return `url("${assetUrl(resolve(path,ref),stack)}")`;});}
 async function install(pkg,view){
  assets=new Map(pkg.assets.map(a=>[a.path,a]));
  const imports={};for(const a of pkg.assets)if(a.mediaType==='text/javascript')imports['https://project.invalid/'+a.path]=assetUrl(a.path);
  const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports});document.head.append(map);
  const html=new TextDecoder().decode(decode(assets.get(view.entrypoint))),parsed=new DOMParser().parseFromString(html,'text/html');
  for(const node of parsed.querySelectorAll('base,meta[http-equiv],iframe,object,embed'))node.remove();
  for(const node of parsed.querySelectorAll('*')){
   for(const name of ['src','href','poster','srcset','action','formaction'])if(node.hasAttribute(name)){
    const ref=node.getAttribute(name);if(node.tagName==='A'&&name==='href'){node.dataset.projectHref=ref;node.setAttribute('href','#');continue;}
    if(name==='srcset'||name==='action'||name==='formaction'){node.removeAttribute(name);continue;}
    if(ref?.startsWith('data:')&&['IMG','SOURCE'].includes(node.tagName))continue;
    node.setAttribute(name,assetUrl(resolve(view.entrypoint,ref)));
   }
   if(node.hasAttribute('style'))node.setAttribute('style',css(node.getAttribute('style'),view.entrypoint));
   if(node.tagName==='STYLE')node.textContent=css(node.textContent,view.entrypoint);
  }
  const scripts=[...parsed.querySelectorAll('script')];for(const script of scripts)script.remove();
  for(const node of [...parsed.head.children])document.head.append(document.importNode(node,true));
  document.body.replaceChildren(...[...parsed.body.childNodes].map(n=>document.importNode(n,true)));
  document.addEventListener('submit',e=>e.preventDefault());
  document.addEventListener('click',e=>{const link=e.target.closest?.('a[data-project-href]');if(!link)return;e.preventDefault();try{const target=resolve(view.entrypoint,link.dataset.projectHref);port.postMessage({type:'navigate',id:++sequence,entrypoint:target});}catch{}});
  for(const old of scripts){
   const s=document.createElement('script');for(const attr of old.attributes)if(attr.name!=='nonce')s.setAttribute(attr.name,attr.value);s.textContent=old.textContent;
   const executable=['','text/javascript','application/javascript','module'].includes(s.type);
   if(executable&&(s.hasAttribute('src')||s.type==='module'))await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{reportFailure('page-script-timeout');reject(Error('page script timeout'));},5000);
    s.onload=()=>{clearTimeout(timer);resolve();};s.onerror=()=>{clearTimeout(timer);reportFailure('page-script-failed');reject(Error('page script failed'));};s.async=false;document.body.append(s);
   });else document.body.append(s);
   if(failed)return;
  }
  // Let inline unhandled rejections report failure before announcing installation.
  await new Promise(resolve=>setTimeout(resolve,0));
  if(!failed)port.postMessage({type:'installed'});
 }
 window.addEventListener('message',event=>{
  if(started||event.source!==parent)return;
  const m=event.data;
  if(m?.type==='project-view-connect'){
   if(event.ports.length||Object.keys(m).sort().join(',')!=='nonce,type'||typeof m.nonce!=='string'||! /^[a-f0-9]{64}$/.test(m.nonce)||event.origin==='null')return;
   if(connectionNonce!==null&&(connectionNonce!==m.nonce||connectionOrigin!==event.origin))return;
   connectionNonce=m.nonce;connectionOrigin=event.origin;parent.postMessage({type:'project-view-ready',nonce:connectionNonce},connectionOrigin);return;
  }
  if(m?.type!=='project-view-init'||event.ports.length!==1)return;
  // Frozen offline/remote probes may directly initialize only before a nonce
  // connection. Browser-local delivery never falls back to that legacy path.
  if(connectionNonce!==null&&(m.nonce!==connectionNonce||event.origin!==connectionOrigin||Object.keys(m).sort().join(',')!=='nonce,package,type,view'))return;
  started=true;port=event.ports[0];port.onmessage=e=>{const m=e.data;if(m?.type==='snapshot'){for(const listener of listeners)try{listener(m.snapshot);}catch{}return;}const item=pending.get(m?.id);if(!item)return;pending.delete(m.id);clearTimeout(item.timer);m.error?item.reject(Error(m.error)):item.resolve(m.value);};port.start();
  void install(event.data.package,event.data.view).catch(()=>reportFailure('page-install-failed'));
 });
 window.addEventListener('pagehide',()=>{failed=true;try{port?.postMessage({type:'ended',reason:'navigation-ended'});}catch{}port?.close();for(const u of urls)URL.revokeObjectURL(u);});
}
