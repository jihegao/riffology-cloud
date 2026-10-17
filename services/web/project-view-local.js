const fail=code=>{throw Error('project-view-local-'+code);};
/** Fixed app-delivered bootstrap, executed with an opaque sandbox origin. */
export function validateProjectViewLocalDelivery(win,delivery){
 if(!delivery||Object.keys(delivery).sort().join(',')!=='execution,executionOrigin,frameSha256,frameUrl,transport'||delivery.execution!=='browser-local'||delivery.transport!=='native-dom/v1')fail('delivery');
 let app;try{app=new URL(win.location.origin);}catch{fail('origin');}
 if(!(app.protocol==='https:'||app.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(app.hostname))||delivery.executionOrigin!==app.origin)fail('origin');
 if(typeof delivery.frameSha256!=='string'||!/^[a-f0-9]{64}$/.test(delivery.frameSha256)||delivery.frameUrl!==app.origin+'/project-views/'+delivery.frameSha256+'/frame.html')fail('frame-path');
 return delivery.frameUrl;
}
/** Native DOM runs locally. Sandbox isolates app authority; self-navigation can
 * still send already-authorized project data, under the selected DOM contract. */
export function createProjectViewLocal({container,delivery,pkg,view,port,isCurrent=()=>true,onError=()=>{},timeoutMs=10000}){
 const doc=container.ownerDocument,win=doc.defaultView;
 let url;try{url=validateProjectViewLocalDelivery(win,delivery);if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)fail('timeout');}catch(error){port.close();throw error;}
 const frame=doc.createElement('iframe'),nonce=[...win.crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
 frame.sandbox='allow-scripts';frame.referrerPolicy='no-referrer';frame.title=view.title??view.id??'';
 frame.style.cssText='width:100%;min-height:480px;border:0;display:block';
 frame.setAttribute('allow',"camera 'none'; microphone 'none'; geolocation 'none'; usb 'none'; storage-access 'none'");
 let disposed=false,started=false,loads=0,transferred=false,ready=false,errorReported=false,timer=null,startPromise=null,resolveStart,rejectStart;
 const current=()=>!disposed&&isCurrent();
 const stop=()=>{
  if(disposed)return;disposed=true;win.clearTimeout(timer);timer=null;
  win.removeEventListener('message',message);win.removeEventListener('pagehide',pagehide);frame.removeEventListener('load',loaded);frame.removeEventListener('error',loadError);
  port.close();frame.remove();if(!ready)rejectStart?.(Error('project-view-local-closed'));
 };
 const report=code=>{if(disposed)return;const notify=current()&&!errorReported;errorReported=true;stop();if(notify)onError(Error('project-view-local-'+code));};
 function message(event){
  if(!current()||transferred||event.source!==frame.contentWindow||event.origin!=='null')return;
  const m=event.data;if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).sort().join(',')!=='nonce,type'||m.type!=='project-view-ready'||m.nonce!==nonce)return;
  transferred=true;
  try{if(!current())return;frame.contentWindow.postMessage({type:'project-view-init',nonce,package:pkg,view},'*',[port]);}catch{report('initialization');}
 }
 function loaded(){
  if(!current())return;
  if(++loads!==1){report('navigation-ended');return;}
  try{frame.contentWindow.postMessage({type:'project-view-connect',nonce},'*');}catch{report('handshake');}
 }
 function loadError(){report('load-failed');}
 function pagehide(){stop();}
 function start(){
  if(startPromise)return startPromise;
  if(!current())return Promise.reject(Error('project-view-local-closed'));
  started=true;startPromise=new Promise((resolve,reject)=>{resolveStart=resolve;rejectStart=reject;});
  win.addEventListener('message',message);win.addEventListener('pagehide',pagehide);frame.addEventListener('load',loaded);frame.addEventListener('error',loadError);
  timer=win.setTimeout(()=>report('startup-timeout'),timeoutMs);frame.src=url;container.replaceChildren(frame);
  return startPromise;
 }
 function installed(){if(!current()||!started||!transferred||ready)return;ready=true;win.clearTimeout(timer);timer=null;resolveStart?.();}
 return {frame,start,installed,close(){stop();return Promise.resolve();}};
}
