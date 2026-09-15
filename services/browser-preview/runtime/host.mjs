import profiles from './assets/profiles.json' with {type:'json'};
import {checkedPackage, checkedAssets} from './package-loader.mjs';
import {validateInput, validateRunRequest, validateResult, MESSAGE_SCHEMA, LIMITS} from './protocol.mjs';
import {resolveParameters} from '../../simulation/model-spec.ts';
export {profiles};
export class BrowserPreviewRuntime {
  constructor({executionOrigin, assetLoader, timeoutMs = LIMITS.deadlineMs, onStarted = () => {}, onDiagnostic = () => {}}) {
    const url = new URL(executionOrigin); if (url.origin === location.origin || !['http:','https:'].includes(url.protocol)) throw Error('runtime-execution-origin-invalid');
    const local = host => ['localhost','127.0.0.1','[::1]'].includes(host);
    if (!(local(url.hostname) && local(location.hostname)) && (url.protocol !== 'https:' || url.hostname.split('.').slice(-2).join('.') === location.hostname.split('.').slice(-2).join('.'))) throw Error('runtime-dedicated-site-required');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIMITS.deadlineMs) throw Error('runtime-timeout-invalid');
    this.executionOrigin = url.origin; this.assetLoader = assetLoader; this.timeoutMs = Math.min(timeoutMs, LIMITS.deadlineMs); this.onStarted = onStarted; this.onDiagnostic = onDiagnostic; this.sequence = 0; this.loadGeneration = 0;
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
  run(input) {
    this.cancel();
    if (!this.loaded) throw Error('runtime-package-not-loaded');
    validateInput(input);
    const request = validateRunRequest({schema:MESSAGE_SCHEMA,type:'run',requestId:`local-${++this.sequence}`,packageIdentity:this.loaded.manifest.packageIdentity,input:{parameters:resolveParameters(this.loaded.spec,input.parameters),seed:input.seed}});
    return new Promise((resolve, reject) => {
      const frameAsset = this.loaded.profile.assetManifest.find(a => a.path === 'delivery/frame.bundle.mjs');
      const frame = document.createElement('iframe'); frame.hidden = true; frame.sandbox = 'allow-scripts allow-same-origin'; frame.src = this.executionOrigin + `/runtime/${frameAsset.sha256}/frame.html`;
      const channel = new MessageChannel();
      this.pending = {request, resolve, reject, frame, channel, phase:'connecting', diagnostics:0};
      const finish = (error, trace) => {if (this.pending?.request !== request) return; this.destroy(); error ? reject(error) : resolve(trace);};
      channel.port1.onmessage = event => {
        if (this.pending?.request !== request) return;
        const message = event.data;
        if (message?.type === 'connected' && this.pending.phase === 'connecting') {
          this.pending.phase = 'loading';
          channel.port1.postMessage({type:'execute',payload:{request,envelope:this.envelope,profile:this.loaded.profile,assets:[...this.assets].map(([path,bytes]) => ({path,bytes}))}});
          return;
        }
        if (message?.schema !== MESSAGE_SCHEMA || message?.requestId !== request.requestId || message?.packageIdentity !== request.packageIdentity) return;
        if (message.type === 'diagnostic' && typeof message.directive==='string' && message.directive.length<=128 && typeof message.blockedURI==='string' && message.blockedURI.length<=256 && this.pending.diagnostics++<64) {this.onDiagnostic({directive:message.directive,blockedURI:message.blockedURI});return;}
        if (message.type === 'started' && this.pending.phase === 'loading') {this.pending.phase='running';this.onStarted(request); return;}
        if (message.type === 'result' && this.pending.phase === 'running') {try {finish(null, validateResult(message,request));} catch (error) {finish(error);} }
        if (message.type === 'error' && typeof message.code==='string' && message.code.length<=128 && typeof message.text==='string' && message.text.length<=1024) finish(Error(message.text || message.code));
      };
      frame.onload = () => {if (this.pending?.request === request) frame.contentWindow.postMessage({type:'connect'},this.executionOrigin,[channel.port2]);};
      this.timer = setTimeout(() => finish(Error('runtime-timeout')), this.timeoutMs);
      document.body.append(frame);
    });
  }
  destroy() {clearTimeout(this.timer); const p = this.pending; this.pending = null; p?.channel.port1.postMessage({type:'terminate'}); p?.channel.port1.close(); p?.channel.port2.close(); p?.frame.remove();}
  cancel() {const p = this.pending; if (!p) return; this.destroy(); p.reject(Error('runtime-cancelled'));}
  dispose() {this.loadGeneration++; this.cancel(); this.loaded=null;this.envelope=null;this.assets=null;}
}
