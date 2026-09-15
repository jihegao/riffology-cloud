// This static frame has no app API, package endpoint, credential, or fetch broker.
import {MESSAGE_SCHEMA} from './protocol.mjs';
let port, worker;
self.addEventListener('message', event => {
  if (port || event.source !== parent || !event.data || event.data.type !== 'connect' || event.ports.length !== 1) return;
  port = event.ports[0];
  port.onmessage = event => {
    const message = event.data;
    if (message?.type === 'terminate') {worker?.terminate(); worker = null; return;}
    if (message?.type !== 'execute' || worker) return;
    const workerAsset = message.payload.profile?.assetManifest.find(a => a.path === 'delivery/worker.bundle.mjs');
    if (!workerAsset || !/^[a-f0-9]{64}$/.test(workerAsset.sha256)) return;
    worker = new Worker(`/runtime/${workerAsset.sha256}/worker.bundle.mjs`, {type:'module'});
    worker.onmessage = event => port.postMessage(event.data);
    worker.onerror = event => port.postMessage({schema:MESSAGE_SCHEMA,type:'error',requestId:message.payload.request.requestId,packageIdentity:message.payload.request.packageIdentity,code:'runtime-worker-failed',text:String(event.message).slice(0,1024)});
    worker.postMessage(message.payload);
  };
  port.start(); port.postMessage({type:'connected'});
});
