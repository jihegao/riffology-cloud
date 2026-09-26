// This static frame has no app API, package endpoint, credential, or fetch broker.
import {MESSAGE_SCHEMA,LIMITS} from './protocol.mjs';
import {sha256Hex} from './sha256.mjs';
let port, worker, workerURL, canvas, activeRequest, activeIndex=0, sequence=0, inFlight=false, queuedPaint=null, ready=false, pendingPaint=null, started=false, diagnostics=0, invalidMessages=0, paintedMessages=0;
const exact=(value,fields)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===fields.sort().join(',');
const stop=()=>{worker?.terminate();worker=null;if(workerURL)URL.revokeObjectURL(workerURL);workerURL=null;canvas?.remove();canvas=null;activeRequest=null;inFlight=false;queuedPaint=null;pendingPaint=null;ready=false;};
const notifyPaintDispatched=()=>port.postMessage({schema:MESSAGE_SCHEMA,type:'paint-dispatched',requestId:activeRequest.requestId,packageIdentity:activeRequest.packageIdentity,index:pendingPaint.index,token:pendingPaint.token});
const sendPaint=message=>{if(!worker||!activeRequest)return;inFlight=true;pendingPaint={sequence:++sequence,index:message.index,token:message.token};worker.postMessage({schema:MESSAGE_SCHEMA,type:'paint',requestId:activeRequest.requestId,packageIdentity:activeRequest.packageIdentity,...pendingPaint});notifyPaintDispatched();};
// Python can reach Worker.postMessage through Pyodide. Reject its output in this
// opaque frame before a large or repeated message reaches the application port.
const allowedWorkerMessage=message=>{
  if(!activeRequest||!message||message.schema!==MESSAGE_SCHEMA||message.requestId!==activeRequest.requestId||message.packageIdentity!==activeRequest.packageIdentity)return false;
  const base=['schema','type','requestId','packageIdentity'];
  if(message.type==='started'){
    if(started||!exact(message,base))return false;
    started=true;return true;
  }
  if(message.type==='diagnostic'){
    if(!exact(message,[...base,'directive','blockedURI'])||typeof message.directive!=='string'||message.directive.length>128||typeof message.blockedURI!=='string'||message.blockedURI.length>256||diagnostics>=64)return false;
    diagnostics++;return true;
  }
  if(message.type==='result'){
    if(!started||ready||!exact(message,[...base,'trace'])||!message.trace||!Array.isArray(message.trace.snapshots)||message.trace.snapshots.length>LIMITS.frames)return false;
    // The envelope adds a few bytes around a trace at the protocol limit.
    const maximum=LIMITS.resultBytes+512;
    try {const json=JSON.stringify(message);if(!json||json.length>maximum||new TextEncoder().encode(json).byteLength>maximum)return false;}catch{return false;}
    ready=true;return true;
  }
  if(message.type==='painted'){
    if(!ready||!canvas||!inFlight||!pendingPaint||paintedMessages>=2048||!exact(message,[...base,'sequence','index','token'])||message.sequence!==pendingPaint.sequence||message.index!==pendingPaint.index||message.token!==pendingPaint.token)return false;
    paintedMessages++;return true;
  }
  if(message.type==='error')return exact(message,[...base,'code','text'])&&typeof message.code==='string'&&message.code.length<=128&&typeof message.text==='string'&&message.text.length<=1024;
  return false;
};
const rejectWorkerMessage=()=>{
  if(!activeRequest)return;
  if(++invalidMessages<32)return;
  port.postMessage({schema:MESSAGE_SCHEMA,type:'error',requestId:activeRequest.requestId,packageIdentity:activeRequest.packageIdentity,code:'runtime-worker-message-invalid',text:'runtime-worker-message-invalid'});
  stop();
};
self.addEventListener('message', event => {
  if (port || event.source !== parent || !event.data || event.data.type !== 'connect' || event.ports.length !== 1) return;
  port = event.ports[0];
  port.onmessage = async event => {
    const message = event.data;
    if (message?.type === 'terminate') {stop(); return;}
    if(message?.type==='paint') {
      if(!worker||!canvas||!activeRequest||message.requestId!==activeRequest.requestId||message.packageIdentity!==activeRequest.packageIdentity||!Number.isSafeInteger(message.index)||message.index<0||message.index>500||!Number.isSafeInteger(message.token)||message.token<1||Object.keys(message).sort().join(',')!=='index,packageIdentity,requestId,token,type')return;
      activeIndex=message.index;
      if(inFlight)queuedPaint=message;else sendPaint(message);
      return;
    }
    if (message?.type !== 'execute' || worker) return;
    const workerAsset = message.payload.profile?.assetManifest.find(a => a.path === 'delivery/worker.bundle.mjs');
    const supplied = Array.isArray(message.payload.assets) ? message.payload.assets.filter(a=>a?.path==='delivery/worker.bundle.mjs') : [];
    try {
      if (!workerAsset || !/^[a-f0-9]{64}$/.test(workerAsset.sha256) || !Number.isSafeInteger(workerAsset.byteLength) || workerAsset.byteLength<1 || supplied.length!==1) throw Error('runtime-worker-delivery-mismatch');
      const bytes=supplied[0].bytes;
      if(!(bytes instanceof Uint8Array)||bytes.byteLength!==workerAsset.byteLength||sha256Hex(bytes)!==workerAsset.sha256)throw Error('runtime-worker-delivery-mismatch');
      workerURL=URL.createObjectURL(new Blob([bytes],{type:'text/javascript'}));
      worker = new Worker(workerURL);
      const canvasMode=message.payload.canvas===true;
      if(message.payload.canvas!==true&&message.payload.canvas!==false)throw Error('runtime-canvas-mode-invalid');
      activeRequest=message.payload.request;
      let surface=null;
      if(canvasMode){
        canvas=document.createElement('canvas');canvas.width=600;canvas.height=420;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Python Canvas local preview');document.body.append(canvas);
        surface=canvas.transferControlToOffscreen();
        canvas.addEventListener('pointerdown', event=>{
          if(!worker||!activeRequest||!ready||inFlight||queuedPaint)return;
          const bounds=canvas.getBoundingClientRect();
          const x=Math.max(0,Math.min(600,Math.round((event.clientX-bounds.left)*600/bounds.width)));
          const y=Math.max(0,Math.min(420,Math.round((event.clientY-bounds.top)*420/bounds.height)));
          inFlight=true;pendingPaint={sequence:++sequence,index:activeIndex,token:0};
          worker.postMessage({schema:MESSAGE_SCHEMA,type:'pointer',requestId:activeRequest.requestId,packageIdentity:activeRequest.packageIdentity,...pendingPaint,event:{x,y,button:event.button}});
          notifyPaintDispatched();
        });
      }
      worker.onmessage = event => {const message=event.data;if(!allowedWorkerMessage(message)){rejectWorkerMessage();return;}port.postMessage(message);if(message.type==='painted'&&canvasMode){inFlight=false;pendingPaint=null;if(queuedPaint){const next=queuedPaint;queuedPaint=null;sendPaint(next);}}if(message.type==='error'||message.type==='result'&&!canvasMode)stop();};
      worker.onerror = event => {port.postMessage({schema:MESSAGE_SCHEMA,type:'error',requestId:message.payload.request.requestId,packageIdentity:message.payload.request.packageIdentity,code:'runtime-worker-failed',text:String(event.message).slice(0,1024)});stop();};
      const {canvas:_,...payload}=message.payload;
      worker.postMessage({...payload,canvas:surface},surface?[surface]:[]);
    } catch(error) {
      port.postMessage({schema:MESSAGE_SCHEMA,type:'error',requestId:message.payload?.request?.requestId??'',packageIdentity:message.payload?.request?.packageIdentity??'',code:'runtime-worker-failed',text:String(error?.message??error).slice(0,1024)});stop();
    }
  };
  port.start(); port.postMessage({type:'connected'});
});
