import {canonicalPreviewJson, parsePreviewManifest, previewSha256, BROWSER_PREVIEW_SOURCE_PATHS} from '../contract.ts';
import {LIMITS} from './protocol.mjs';
import {parseModelSpec} from '../../simulation/model-spec.ts';
const decode = text => {if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw Error('runtime-base64-invalid'); const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));let encoded='';for(const byte of bytes) encoded+=String.fromCharCode(byte);if(btoa(encoded)!==text)throw Error('runtime-base64-invalid');return bytes;};
export async function checkedPackage(envelope, profiles) {
  if (envelope instanceof Uint8Array) {const text = new TextDecoder('utf-8',{fatal:true}).decode(envelope);if(envelope.byteLength>LIMITS.bundleBytes)throw Error('runtime-package-limit');envelope=JSON.parse(text);if(text!==canonicalPreviewJson(envelope))throw Error('runtime-package-noncanonical');}
  if (new TextEncoder().encode(canonicalPreviewJson(envelope)).byteLength > LIMITS.bundleBytes) throw Error('runtime-package-limit');
  if (!envelope || Object.keys(envelope).sort().join(',') !== 'files,manifest' || !Array.isArray(envelope.files)) throw Error('runtime-package-invalid');
  const manifest = await parsePreviewManifest(envelope.manifest);
  const profile = profiles.find(p => canonicalPreviewJson(p.runtime) === canonicalPreviewJson(manifest.runtime));
  if (!profile || await previewSha256(canonicalPreviewJson(LIMITS)) !== manifest.runtime.limitsSha256 || await previewSha256(canonicalPreviewJson(profile.assetManifest)) !== manifest.runtime.assetSha256) throw Error('runtime-profile-unavailable');
  if (envelope.files.length !== BROWSER_PREVIEW_SOURCE_PATHS.length) throw Error('runtime-package-invalid');
  const files = new Map(); let total = 0;
  for (let i = 0; i < envelope.files.length; i++) {
    const f = envelope.files[i], source = manifest.sources[i];
    if (!f || Object.keys(f).sort().join(',') !== 'base64,path' || f.path !== BROWSER_PREVIEW_SOURCE_PATHS[i] || source.path !== f.path || typeof f.base64 !== 'string' || f.base64.length > Math.ceil(LIMITS.sourceBytes / 3) * 4) throw Error('runtime-package-invalid');
    const bytes = decode(f.base64); total += bytes.byteLength;
    if (bytes.byteLength !== source.byteLength || bytes.byteLength > LIMITS.sourceBytes || await previewSha256(bytes) !== source.sha256 || total > LIMITS.bundleBytes) throw Error('runtime-source-mismatch');
    files.set(f.path, bytes);
  }
  const visualization = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(files.get('model/visualization.json')));
  if (!visualization || Object.keys(visualization).sort().join(',') !== 'metricKeys,protocol,renderer,schema' || visualization.schema !== 'riffology.visualization/v1' || visualization.protocol !== 'riffology.visual/v0.1' || !['grid','lane'].includes(visualization.renderer) || !Array.isArray(visualization.metricKeys) || !visualization.metricKeys.length || visualization.metricKeys.length > 64 || visualization.metricKeys.some(k => typeof k !== 'string' || k.length > 128)) throw Error('runtime-visualization-invalid');
  const spec = parseModelSpec(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(files.get('model/model-spec.json'))));
  if (manifest.sources.find(s=>s.path==='model/run.py').sha256 !== 'fa7987095bbc29f2c6d87e9b0f815415f88c9079ad7070fb7fe8b91e7ebf0898') throw Error('runtime-server-adapter-mismatch');
  if (spec.execution.entrypoint !== 'model/run.py' || spec.execution.dependencyLock !== 'app/requirements.lock') throw Error('runtime-model-entrypoint-invalid');
  if (visualization.metricKeys.some(k => !Object.hasOwn(spec.metrics,k)) || new Set(visualization.metricKeys).size !== visualization.metricKeys.length) throw Error('runtime-visualization-invalid');
  const lock = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(files.get('app/requirements.lock')));
  if (canonicalPreviewJson(lock) !== canonicalPreviewJson({schemaVersion:1,packages:profile.packages})) throw Error('runtime-dependency-lock-mismatch');
  return {manifest, profile, files, visualization, spec};
}
export async function checkedAssets(raw, profile) {
  if (!Array.isArray(raw) || raw.length !== profile.assetManifest.length) throw Error('runtime-assets-invalid');
  const result = new Map();
  for (let i = 0; i < raw.length; i++) {
    const asset = raw[i], expected = profile.assetManifest[i];
    if (!asset || asset.path !== expected.path || !(asset.bytes instanceof Uint8Array)) throw Error('runtime-assets-mismatch');
    const captured = Uint8Array.from(asset.bytes);
    if (captured.byteLength !== expected.byteLength || await previewSha256(captured) !== expected.sha256) throw Error('runtime-assets-mismatch');
    result.set(asset.path, captured);
  }
  return result;
}
