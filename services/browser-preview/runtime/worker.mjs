import {loadPyodide} from '../../../.local/browser-preview/assets/pyodide.mjs';
import createPyodideModule from '../../../.local/browser-preview/assets/pyodide.asm.mjs';
import {checkedPackage, checkedAssets} from './package-loader.mjs';
import {validateRunRequest, validateTrace, MESSAGE_SCHEMA, LIMITS} from './protocol.mjs';
import {resolveParameters} from '../../simulation/model-spec.ts';
import {canonicalPreviewJson} from '../contract.ts';
import {sha256Hex} from './sha256.mjs';
import {createCanvasBridge} from './canvas.mjs';
const nativeFetch = globalThis.fetch.bind(globalThis);
function DeniedNestedWorker() { throw Error('runtime-subworker-denied'); }
Object.defineProperty(globalThis, 'Worker', {value:DeniedNestedWorker,writable:false,configurable:false,enumerable:false});
const digest=value=>sha256Hex(typeof value==='string'?new TextEncoder().encode(value):value);
let pending = null;
let canvasState = null;
let lastCommand = 0;
let paintQueue = Promise.resolve();
let stdoutBytes = 0;
const print = text => {stdoutBytes += new TextEncoder().encode(String(text)).length; if (stdoutBytes > 65536) throw Error('runtime-stdout-limit');};
self.addEventListener('securitypolicyviolation', event => self.postMessage({schema:MESSAGE_SCHEMA,type:'diagnostic',requestId:pending?.requestId,packageIdentity:pending?.packageIdentity,directive:String(event.effectiveDirective).slice(0,128),blockedURI:String(event.blockedURI).slice(0,256)}));
self.onmessage = async event => {
  const message = event.data;
  if (pending) {
    if (!canvasState || !message || message.schema!==MESSAGE_SCHEMA || message.requestId!==pending.requestId || message.packageIdentity!==pending.packageIdentity || !Number.isSafeInteger(message.sequence) || message.sequence<=lastCommand || !Number.isSafeInteger(message.index) || message.index<0 || message.index>=canvasState.trace.snapshots.length || !Number.isSafeInteger(message.token) || message.token<0 || !['paint','pointer'].includes(message.type)) return;
    if(message.type==='pointer' && (!message.event || Object.keys(message.event).sort().join(',')!=='button,x,y' || !Number.isInteger(message.event.button) || message.event.button<0 || message.event.button>2 || !Number.isInteger(message.event.x) || message.event.x<0 || message.event.x>600 || !Number.isInteger(message.event.y) || message.event.y<0 || message.event.y>420)) return;
    if(message.type==='paint' && (message.token<1||Object.keys(message).sort().join(',')!=='index,packageIdentity,requestId,schema,sequence,token,type')) return;
    if(message.type==='pointer' && (message.token!==0||Object.keys(message).sort().join(',')!=='event,index,packageIdentity,requestId,schema,sequence,token,type')) return;
    lastCommand=message.sequence;
    paintQueue=paintQueue.then(async()=>{
      canvasState.bridge.reset();
      canvasState.pyodide.globals.set('riffology_snapshot_json',JSON.stringify(canvasState.trace.snapshots[message.index]));
      canvasState.pyodide.globals.set('riffology_event_json',message.type==='pointer'?JSON.stringify(message.event):'null');
      await canvasState.pyodide.runPythonAsync(`_riffology_visual = _riffology_draw(_riffology_json_loads(riffology_snapshot_json), riffology_canvas, _riffology_json_loads(riffology_event_json))\nif _riffology_isawaitable(_riffology_visual): await _riffology_visual`);
      self.postMessage({schema:MESSAGE_SCHEMA,type:'painted',requestId:pending.requestId,packageIdentity:pending.packageIdentity,sequence:message.sequence,index:message.index,token:message.token});
    }).catch(error=>{
      self.postMessage({schema:MESSAGE_SCHEMA,type:'error',requestId:pending.requestId,packageIdentity:pending.packageIdentity,code:'runtime-canvas-failed',text:String(error?.message??error).slice(0,1024)});
    });
    return;
  }
  try {
    if (!message || Object.keys(message).sort().join(',') !== 'assets,canvas,envelope,profile,request') throw Error('runtime-load-invalid');
    validateRunRequest(message.request); pending = message.request;
    const loaded = await checkedPackage(message.envelope, [message.profile],digest);
    if ((loaded.visualization.renderer==='python-canvas') !== (typeof OffscreenCanvas!=='undefined' && message.canvas instanceof OffscreenCanvas)) throw Error('runtime-canvas-mode-mismatch');
    if (pending.packageIdentity !== loaded.manifest.packageIdentity) throw Error('runtime-package-mismatch');
    const workerAsset = loaded.profile.assetManifest.find(a => a.path === 'delivery/worker.bundle.mjs');
    if (!workerAsset) throw Error('runtime-worker-delivery-mismatch');
    if (canonicalPreviewJson(resolveParameters(loaded.spec,pending.input.parameters)) !== canonicalPreviewJson(pending.input.parameters)) throw Error('runtime-parameters-unresolved');
    const assets = await checkedAssets(message.assets, loaded.profile,digest);
    // An opaque-origin blob URL cannot resolve relative paths. This synthetic
    // absolute base is only a lookup key for the verified in-memory fetch map.
    const indexURL = 'https://browser-preview.invalid/fixed-pyodide/';
    // Only fixed verified in-memory assets. This function has no HTTP fallback.
    globalThis.fetch = async value => {
      const url = new URL(typeof value === 'string' ? value : value.url ?? value.href, indexURL);
      if (!url.href.startsWith(indexURL) || url.search || url.hash) throw Error('runtime-offline-asset-denied');
      const bytes = assets.get('assets/' + url.pathname.slice(new URL(indexURL).pathname.length));
      if (!bytes) throw Error('runtime-offline-asset-denied');
      return new Response(bytes, {headers:{'Content-Type':url.pathname.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'}});
    };
    const lock = JSON.parse(new TextDecoder().decode(assets.get('assets/pyodide-lock.json')));
    const pyodide = await loadPyodide({indexURL,packageBaseUrl:indexURL, stdLibURL:indexURL+'python_stdlib.zip', lockFileContents:lock, createPyodideModule, stdout:print, stderr:print});
    if (loaded.profile.runtime.dependencies.length) {
      const packages = loaded.profile.runtime.dependencies.filter(d => d.name !== 'mesa').map(d => d.name);
      await pyodide.loadPackage(packages);
      pyodide.unpackArchive(assets.get('assets/mesa-3.5.1-py3-none-any.whl'), 'zip', {extractDir:pyodide._api.sitePackages});
    }
    // All dynamic loading after bootstrap is denied by the worker's HTTP CSP.
    globalThis.fetch = nativeFetch;
    self.postMessage({schema:MESSAGE_SCHEMA,type:'started',requestId:pending.requestId,packageIdentity:pending.packageIdentity});
    pyodide.FS.mkdirTree('/model');
    pyodide.FS.writeFile('/model/model.py', loaded.files.get('model/model.py'));
    const bridge=message.canvas ? createCanvasBridge(message.canvas) : null;
    if(bridge)pyodide.globals.set('riffology_canvas',bridge.api);
    pyodide.globals.set('riffology_config_json', JSON.stringify(pending.input));
    const resultChunks = []; let resultBytes = 0, resultExceeded = false; const encoder = new TextEncoder();
    pyodide.globals.set('riffology_emit_chunk', value => {
      if (resultExceeded) return;
      const chunk = String(value), bytes = encoder.encode(chunk).byteLength;
      if (bytes > LIMITS.resultBytes - resultBytes) {resultExceeded = true; return;}
      resultBytes += bytes; resultChunks.push(chunk);
    });
    await pyodide.runPythonAsync(`import json, sys, inspect\n_riffology_json_loads = json.loads\n_riffology_isawaitable = inspect.isawaitable\nasync def _riffology_execute(config_json, emit):\n    _iterencode = json.JSONEncoder(allow_nan=False, separators=(',', ':')).iterencode\n    sys.path.insert(0, '/model')\n    from model import run\n    _result = run(_riffology_json_loads(config_json))\n    if _riffology_isawaitable(_result): _result = await _result\n    for _chunk in _iterencode(_result): emit(_chunk)\nawait _riffology_execute(riffology_config_json, riffology_emit_chunk)`);
    if (resultExceeded) throw Error('runtime-output-limit');
    const resultText = resultChunks.join('');
    if (encoder.encode(resultText).byteLength !== resultBytes) throw Error('runtime-output-limit');
    const trace = validateTrace(JSON.parse(resultText));
    if (loaded.visualization.renderer!=='python-canvas' && trace.snapshots.some(s => s.space.type !== loaded.visualization.renderer)) throw Error('runtime-renderer-mismatch');
    if (bridge) {
      if(trace.snapshots.some(s=>s.space.type!=='grid'&&s.space.type!=='lane'))throw Error('runtime-canvas-space-invalid');
      await pyodide.runPythonAsync(`from model import draw as _riffology_draw\nif not callable(_riffology_draw): raise TypeError('runtime-canvas-draw-missing')`);
      canvasState={bridge,pyodide,trace};
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    self.postMessage({schema:MESSAGE_SCHEMA,type:'result',requestId:pending.requestId,packageIdentity:pending.packageIdentity,trace});
  } catch (error) {
    self.postMessage({schema:MESSAGE_SCHEMA,type:'error',requestId:pending?.requestId ?? '',packageIdentity:pending?.packageIdentity ?? '',code:'runtime-execution-failed',text:String(error?.message ?? error).slice(0,1024)});
  }
};
