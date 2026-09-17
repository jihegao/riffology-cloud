// This static frame has no app API, package endpoint, credential, or fetch broker.
import {MESSAGE_SCHEMA} from './protocol.mjs';
import {sha256Hex} from './sha256.mjs';
let port, worker, workerURL;
const stop=()=>{worker?.terminate();worker=null;if(workerURL)URL.revokeObjectURL(workerURL);workerURL=null;};
self.addEventListener('message', event => {
  if (port || event.source !== parent || !event.data || event.data.type !== 'connect' || event.ports.length !== 1) return;
  port = event.ports[0];
  port.onmessage = async event => {
    const message = event.data;
    if (message?.type === 'terminate') {stop(); return;}
    if (message?.type !== 'execute' || worker) return;
    const workerAsset = message.payload.profile?.assetManifest.find(a => a.path === 'delivery/worker.bundle.mjs');
    const supplied = Array.isArray(message.payload.assets) ? message.payload.assets.filter(a=>a?.path==='delivery/worker.bundle.mjs') : [];
    try {
      if (!workerAsset || !/^[a-f0-9]{64}$/.test(workerAsset.sha256) || !Number.isSafeInteger(workerAsset.byteLength) || workerAsset.byteLength<1 || supplied.length!==1) throw Error('runtime-worker-delivery-mismatch');
      const bytes=supplied[0].bytes;
      if(!(bytes instanceof Uint8Array)||bytes.byteLength!==workerAsset.byteLength||sha256Hex(bytes)!==workerAsset.sha256)throw Error('runtime-worker-delivery-mismatch');
      workerURL=URL.createObjectURL(new Blob([bytes],{type:'text/javascript'}));
      worker = new Worker(workerURL);
      worker.onmessage = event => {port.postMessage(event.data);if(['result','error'].includes(event.data?.type))stop();};
      worker.onerror = event => {port.postMessage({schema:MESSAGE_SCHEMA,type:'error',requestId:message.payload.request.requestId,packageIdentity:message.payload.request.packageIdentity,code:'runtime-worker-failed',text:String(event.message).slice(0,1024)});stop();};
      worker.postMessage(message.payload);
    } catch(error) {
      port.postMessage({schema:MESSAGE_SCHEMA,type:'error',requestId:message.payload?.request?.requestId??'',packageIdentity:message.payload?.request?.packageIdentity??'',code:'runtime-worker-failed',text:String(error?.message??error).slice(0,1024)});stop();
    }
  };
  port.start(); port.postMessage({type:'connected'});
});
