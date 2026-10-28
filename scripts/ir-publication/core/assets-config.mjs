/** Live-preparation fork only; frozen A2 remains unchanged.
 * Official PUT metadata.assets.config schema allows all five classified fields.
 * The sole name translation is runtime raw_run_worker_first -> run_worker_first.
 */
import {guard} from './io-boundary.mjs';
import {hashJSON} from './a2/ir-publication-candidate.mjs';
export function classifiedAssetsConfig(runtime){
  const keys=['base_path','html_handling','not_found_handling','raw_run_worker_first','serve_directly'];
  guard(runtime&&typeof runtime==='object'&&hashJSON(Object.keys(runtime).sort())===hashJSON(keys),'unclassified-assets-field');
  guard(['auto-trailing-slash','force-trailing-slash','drop-trailing-slash','none'].includes(runtime.html_handling),'assets-html-mode');
  guard(['none','404-page','single-page-application'].includes(runtime.not_found_handling),'assets-not-found-mode');
  guard(typeof runtime.serve_directly==='boolean'&&(runtime.base_path===null||typeof runtime.base_path==='string'),'assets-preserved-platform-config');
  guard(typeof runtime.raw_run_worker_first==='boolean'||Array.isArray(runtime.raw_run_worker_first)&&runtime.raw_run_worker_first.every(x=>typeof x==='string'),'unclassified-assets-config-shape');
  return {html_handling:runtime.html_handling,not_found_handling:runtime.not_found_handling,serve_directly:runtime.serve_directly,base_path:runtime.base_path,run_worker_first:structuredClone(runtime.raw_run_worker_first)};
}
export function attachAssetCompletion(metadata,baseline,completion){
  guard(typeof completion==='string'&&completion.length>0&&completion.length<16384,'asset-completion-required');
  return {...structuredClone(metadata),assets:{jwt:completion,config:classifiedAssetsConfig(baseline.version.resources.script_runtime.assets)}};
}
