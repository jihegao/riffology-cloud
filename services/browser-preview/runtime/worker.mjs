import {loadPyodide} from '../../../.local/browser-preview/assets/pyodide.mjs';
import createPyodideModule from '../../../.local/browser-preview/assets/pyodide.asm.mjs';
import {checkedPackage, checkedAssets} from './package-loader.mjs';
import {validateRunRequest, validateTrace, MESSAGE_SCHEMA, LIMITS} from './protocol.mjs';
import {resolveParameters} from '../../simulation/model-spec.ts';
import {canonicalPreviewJson} from '../contract.ts';
import {sha256Hex} from './sha256.mjs';
const nativeFetch = globalThis.fetch.bind(globalThis);
const digest=value=>sha256Hex(typeof value==='string'?new TextEncoder().encode(value):value);
let pending = null;
let stdoutBytes = 0;
const print = text => {stdoutBytes += new TextEncoder().encode(String(text)).length; if (stdoutBytes > 65536) throw Error('runtime-stdout-limit');};
self.addEventListener('securitypolicyviolation', event => self.postMessage({schema:MESSAGE_SCHEMA,type:'diagnostic',requestId:pending?.requestId,packageIdentity:pending?.packageIdentity,directive:String(event.effectiveDirective).slice(0,128),blockedURI:String(event.blockedURI).slice(0,256)}));
self.onmessage = async event => {
  if (pending) return;
  const message = event.data;
  try {
    if (!message || Object.keys(message).sort().join(',') !== 'assets,envelope,profile,request') throw Error('runtime-load-invalid');
    validateRunRequest(message.request); pending = message.request;
    const loaded = await checkedPackage(message.envelope, [message.profile],digest);
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
    pyodide.globals.set('riffology_config_json', JSON.stringify(pending.input));
    pyodide.globals.set('riffology_max_output_bytes', LIMITS.resultBytes);
    const json = await pyodide.runPythonAsync(`import json, sys, inspect\nsys.path.insert(0, '/model')\nfrom model import run\n_result = run(json.loads(riffology_config_json))\nif inspect.isawaitable(_result): _result = await _result\n_encoder = json.JSONEncoder(allow_nan=False, separators=(',', ':'))\n_chunks = []\n_total = 0\nfor _chunk in _encoder.iterencode(_result):\n    _total += len(_chunk.encode('utf-8'))\n    if _total > riffology_max_output_bytes: raise ValueError('runtime-output-limit')\n    _chunks.append(_chunk)\n''.join(_chunks)`);
    const trace = validateTrace(JSON.parse(String(json)));
    if (trace.snapshots.some(s => s.space.type !== loaded.visualization.renderer)) throw Error('runtime-renderer-mismatch');
    await new Promise(resolve => setTimeout(resolve, 20));
    self.postMessage({schema:MESSAGE_SCHEMA,type:'result',requestId:pending.requestId,packageIdentity:pending.packageIdentity,trace});
  } catch (error) {
    self.postMessage({schema:MESSAGE_SCHEMA,type:'error',requestId:pending?.requestId ?? '',packageIdentity:pending?.packageIdentity ?? '',code:'runtime-execution-failed',text:String(error?.message ?? error).slice(0,1024)});
  }
};
