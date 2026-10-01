import profiles from './assets/profiles.json' with {type:'json'};
import {checkedPackage, checkedAssets} from './package-loader.mjs';
import {validateInput, validateRunRequest, validateResult, MESSAGE_SCHEMA, LIMITS} from './protocol.mjs';
import {resolveParameters} from '../../simulation/model-spec.ts';
export {profiles};
export class BrowserPreviewRuntime {
  get canvasActive() {return this.pending?.canvasMode===true&&this.pending.phase==='ready';}
  constructor({executionOrigin, frameUrl, jsFrameUrl=null, assetLoader, timeoutMs = LIMITS.deadlineMs, canvasSessionMs=120000, canvasPaintMs=10000, onStarted = () => {}, onDiagnostic = () => {}, onCanvasError = () => {}}) {
    const url = new URL(executionOrigin); if (url.origin === location.origin || !['http:','https:'].includes(url.protocol)) throw Error('runtime-execution-origin-invalid');
    const local = host => ['localhost','127.0.0.1','[::1]'].includes(host);
    if (!(local(url.hostname) && local(location.hostname)) && (url.protocol !== 'https:' || url.hostname.split('.').slice(-2).join('.') === location.hostname.split('.').slice(-2).join('.'))) throw Error('runtime-dedicated-site-required');
    const frame = new URL(frameUrl,url.origin); if (frame.origin !== url.origin || frame.search || frame.hash || !/^\/runtime\/[a-f0-9]{64}\/frame\.html$/.test(frame.pathname)) throw Error('runtime-frame-url-invalid');
    let jsFrame=null;if(jsFrameUrl!==null){jsFrame=new URL(jsFrameUrl,url.origin);if(jsFrame.origin!==url.origin||jsFrame.search||jsFrame.hash||!/^\/runtime\/[a-f0-9]{64}\/js-frame\.html$/.test(jsFrame.pathname))throw Error('runtime-js-frame-url-invalid');}
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIMITS.deadlineMs) throw Error('runtime-timeout-invalid');
    if(!Number.isInteger(canvasSessionMs)||canvasSessionMs<1||canvasSessionMs>120000)throw Error('runtime-canvas-session-limit-invalid');
    if(!Number.isInteger(canvasPaintMs)||canvasPaintMs<1||canvasPaintMs>10000)throw Error('runtime-canvas-paint-limit-invalid');
    this.executionOrigin = url.origin; this.frameUrl = frame.href;this.jsFrameUrl=jsFrame?.href??null; this.assetLoader = assetLoader; this.timeoutMs = Math.min(timeoutMs, LIMITS.deadlineMs);this.canvasSessionMs=canvasSessionMs;this.canvasPaintMs=canvasPaintMs; this.onStarted = onStarted; this.onDiagnostic = onDiagnostic; this.onCanvasError=onCanvasError; this.sequence = 0; this.loadGeneration = 0;
  }
  async load(envelope) {
    const generation = ++this.loadGeneration, captured = structuredClone(envelope); this.cancel();
    const current = () => {if (generation !== this.loadGeneration) throw Error('runtime-load-superseded');};
    const loaded = await checkedPackage(captured, profiles); current();
    const raw = await this.assetLoader(loaded.profile); current();
    const assets = await checkedAssets(raw, loaded.profile); current();
    this.cancel(); this.loaded = loaded; this.envelope = captured; this.assets = assets;
    return loaded;
  }
  run(input, visualRoot=null) {
    this.cancel();
    if (!this.loaded) throw Error('runtime-package-not-loaded');
    validateInput(input);
    const request = validateRunRequest({schema:MESSAGE_SCHEMA,type:'run',requestId:`local-${++this.sequence}`,packageIdentity:this.loaded.manifest.packageIdentity,input:{parameters:resolveParameters(this.loaded.spec,input.parameters),seed:input.seed}});
    const pythonCanvas=this.loaded.visualization.renderer==='python-canvas',jsCanvas=this.loaded.visualization.renderer==='javascript-canvas',canvasMode=pythonCanvas||jsCanvas;
    if(canvasMode&&(!visualRoot||typeof visualRoot.replaceChildren!=='function'))throw Error('runtime-canvas-container-invalid');
    if(jsCanvas&&(!this.jsFrameUrl||!this.loaded.frontend))throw Error('runtime-js-frame-unavailable');
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe'); frame.hidden = !pythonCanvas; frame.sandbox = 'allow-scripts'; frame.src = this.frameUrl;
      if(canvasMode){frame.className=pythonCanvas?'preview-python-canvas':'preview-javascript-canvas';frame.title=pythonCanvas?'Isolated Python Canvas local preview':'Isolated JavaScript model frontend';frame.width='616';frame.height='436';frame.style.maxWidth='100%';frame.style.border='0';visualRoot.replaceChildren();}
      const channel = new MessageChannel();
      this.pending = {request, resolve, reject, frame, channel, phase:'connecting', diagnostics:0,canvasMode,pythonCanvas,jsCanvas,visualRoot,createdAt:Date.now(),traceLength:0,paintToken:0,inFlightPaint:null,trace:null};
      const finish = (error, trace) => {if (this.pending?.request !== request) return; this.destroy(); error ? reject(error) : resolve(trace);};
      channel.port1.onmessage = event => {
        if (this.pending?.request !== request) return;
        const message = event.data;
        if (message?.type === 'connected' && this.pending.phase === 'connecting') {
          this.pending.phase = 'loading';
          channel.port1.postMessage({type:'execute',payload:{request,envelope:this.envelope,profile:this.loaded.profile,assets:[...this.assets].map(([path,bytes]) => ({path,bytes})),canvas:pythonCanvas}});
          return;
        }
        if (message?.schema !== MESSAGE_SCHEMA || message?.requestId !== request.requestId || message?.packageIdentity !== request.packageIdentity) return;
        if (message.type === 'diagnostic' && typeof message.directive==='string' && message.directive.length<=128 && typeof message.blockedURI==='string' && message.blockedURI.length<=256 && this.pending.diagnostics++<64) {this.onDiagnostic({directive:message.directive,blockedURI:message.blockedURI});return;}
        if (message.type === 'started' && this.pending.phase === 'loading') {this.pending.phase='running';this.onStarted(request); return;}
        if (message.type === 'result' && this.pending.phase === 'running') {try {const trace=validateResult(message,request);if(jsCanvas)this.startJavaScriptFrame(trace);else if(pythonCanvas)this.readyCanvas(trace);else finish(null,trace);} catch (error) {finish(error);} }
        if(message.type==='paint-dispatched'&&this.pending.phase==='ready'&&canvasMode&&Number.isSafeInteger(message.index)&&message.index>=0&&message.index<this.pending.traceLength&&Number.isSafeInteger(message.token)&&message.token>=0&&message.token<=this.pending.paintToken){
          if(!this.pending.inFlightPaint){this.pending.inFlightPaint={index:message.index,token:message.token};this.paintTimer=setTimeout(()=>this.failCanvas(Error('runtime-canvas-paint-timeout')),this.canvasPaintMs);}return;
        }
        if (message.type === 'painted'&&this.pending.phase==='ready'&&Number.isSafeInteger(message.index)&&message.index>=0&&message.index<this.pending.traceLength&&Number.isSafeInteger(message.token)){const flight=this.pending.inFlightPaint;if(flight?.index===message.index&&flight.token===message.token){clearTimeout(this.paintTimer);this.paintTimer=null;this.pending.inFlightPaint=null;}return;}
        if (message.type === 'error' && typeof message.code==='string' && message.code.length<=128 && typeof message.text==='string' && message.text.length<=1024) {if(this.pending.phase==='ready')this.failCanvas(Error(message.text||message.code));else finish(Error(message.text || message.code));}
      };
      // A sandboxed frame without allow-same-origin has a fresh opaque origin for
      // every run, so targetOrigin must be "*". The one-shot MessageChannel and
      // event.source check in the frame retain the authority boundary.
      frame.onload = () => {if (this.pending?.request === request) frame.contentWindow.postMessage({type:'connect'},'*',[channel.port2]);};
      this.timer = setTimeout(() => finish(Error('runtime-timeout')), this.timeoutMs);
      if(pythonCanvas)visualRoot.append(frame);else document.body.append(frame);
    });
  }
  readyCanvas(trace){const p=this.pending;if(!p)return;p.phase='ready';p.trace=trace;p.traceLength=trace.snapshots.length;clearTimeout(this.timer);const remaining=Math.max(1,p.createdAt+this.canvasSessionMs-Date.now());this.timer=setTimeout(()=>this.failCanvas(Error('runtime-canvas-session-timeout')),remaining);p.resolve(trace);}
  startJavaScriptFrame(trace){
    const p=this.pending;if(!p||!p.jsCanvas)return;
    p.channel.port1.postMessage({type:'terminate'});p.channel.port1.close();p.channel.port2.close();p.frame.remove();
    const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.src=this.jsFrameUrl;frame.className='preview-javascript-canvas';frame.title='Isolated JavaScript model frontend';frame.width='616';frame.height='436';frame.style.maxWidth='100%';frame.style.border='0';
    const channel=new MessageChannel();p.frame=frame;p.channel=channel;p.phase='js-connecting';p.trace=trace;p.traceLength=trace.snapshots.length;
    const fail=error=>{if(this.pending!==p)return;this.destroy();p.reject(error);};
    channel.port1.onmessage=event=>{
      if(this.pending!==p)return;const message=event.data;
      if(message?.type==='connected'&&p.phase==='js-connecting'){
        p.phase='js-loading';const source=this.loaded.frontend.source;
        channel.port1.postMessage({type:'initialize',payload:{request:p.request,revisionId:this.loaded.manifest.revisionId,trace,visualization:this.loaded.visualization,frontend:{packageIdentity:p.request.packageIdentity,manifest:this.loaded.frontend.manifest,source}}});return;
      }
      if(message?.schema!==MESSAGE_SCHEMA||message?.requestId!==p.request.requestId||message?.packageIdentity!==p.request.packageIdentity)return;
      if(message.type==='ready'&&p.phase==='js-loading'&&message.index===0&&message.token===0){this.readyCanvas(trace);return;}
      if(message.type==='paint-dispatched'&&p.phase==='ready'&&Number.isSafeInteger(message.index)&&message.index>=0&&message.index<p.traceLength&&Number.isSafeInteger(message.token)&&message.token>=0&&message.token<=p.paintToken){if(!p.inFlightPaint){p.inFlightPaint={index:message.index,token:message.token};this.paintTimer=setTimeout(()=>this.failCanvas(Error('runtime-canvas-paint-timeout')),this.canvasPaintMs);}return;}
      if(message.type==='painted'&&p.phase==='ready'&&Number.isSafeInteger(message.index)&&message.index>=0&&message.index<p.traceLength&&Number.isSafeInteger(message.token)){const flight=p.inFlightPaint;if(flight?.index===message.index&&flight.token===message.token){clearTimeout(this.paintTimer);this.paintTimer=null;p.inFlightPaint=null;}return;}
      if(message.type==='error'&&typeof message.code==='string'&&message.code.length<=128&&typeof message.text==='string'&&message.text.length<=1024){const error=Error(message.text||message.code);if(p.phase==='ready')this.failCanvas(error);else fail(error);}
    };
    frame.onload=()=>{if(this.pending===p)frame.contentWindow.postMessage({type:'connect'},'*',[channel.port2]);};p.visualRoot.append(frame);
  }
  paint(index) {const p=this.pending;if(!p||!p.canvasMode||p.phase!=='ready'||!Number.isSafeInteger(index)||index<0||index>=p.traceLength)throw Error('runtime-canvas-session-ended');p.paintToken++;p.channel.port1.postMessage({type:'paint',requestId:p.request.requestId,packageIdentity:p.request.packageIdentity,index,token:p.paintToken});}
  failCanvas(error) {const p=this.pending;if(!p||p.phase!=='ready')return;this.destroy();this.onCanvasError(error);}
  destroy() {clearTimeout(this.timer);clearTimeout(this.paintTimer);const p = this.pending; this.pending = null; p?.channel.port1.postMessage({type:'terminate'}); p?.channel.port1.close(); p?.channel.port2.close(); p?.frame.remove();}
  cancel() {const p = this.pending; if (!p) return; this.destroy(); if(p.phase!=='ready')p.reject(Error('runtime-cancelled'));}
  dispose() {this.loadGeneration++; this.cancel(); this.loaded=null;this.envelope=null;this.assets=null;}
}
