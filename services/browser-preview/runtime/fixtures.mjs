import {readFile} from 'node:fs/promises';
import {createPreviewManifest, previewSha256, BROWSER_PREVIEW_SOURCE_PATHS} from '../contract.ts';
export async function makeFixture(profile, model = 'queue', replacement = null, adapter = null) {
  const grid = model === 'mesa';
  const parameters = grid ? {steps:{type:'integer',default:40,minimum:1,maximum:500},width:{type:'integer',default:20,minimum:4,maximum:60},height:{type:'integer',default:14,minimum:4,maximum:60},density:{type:'number',default:0.82,minimum:0.05,maximum:0.98},minority_fraction:{type:'number',default:0.35,minimum:0,maximum:1},homophily:{type:'number',default:0.5,minimum:0,maximum:1}} : {servers:{type:'integer',default:2,minimum:1,maximum:8},customers:{type:'integer',default:30,minimum:1,maximum:200},arrival_rate:{type:'number',default:0.8,minimum:0.01,maximum:100},service_rate:{type:'number',default:1,minimum:0.01,maximum:100}};
  const metrics = Object.fromEntries((grid ? ['population','unhappy','happy_fraction'] : ['queue_length','completed','mean_wait','throughput']).map(k => [k,{}]));
  const spec = {schemaVersion:1,researchQuestion:'How does the configuration affect the observed model?',scope:'Finite browser acceptance fixture',entities:[grid?'residents':'customers'],mechanisms:['Seeded model transitions'],assumptions:['Finite horizon'],parameters,metrics,limitations:['Local visual output is unverified'],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
  const values = [replacement ?? await readFile(new URL(`./fixtures/${model}.py`,import.meta.url),'utf8'), adapter ?? await readFile(new URL('./fixtures/run.py',import.meta.url),'utf8'),JSON.stringify(spec),JSON.stringify({schema:'riffology.visualization/v1',protocol:'riffology.visual/v0.1',renderer:grid?'grid':'lane',metricKeys:Object.keys(metrics)}),JSON.stringify({schemaVersion:1,packages:profile.packages})];
  const files = BROWSER_PREVIEW_SOURCE_PATHS.map((path,i) => ({path,base64:Buffer.from(values[i]).toString('base64')}));
  const sources = await Promise.all(BROWSER_PREVIEW_SOURCE_PATHS.map(async (path,i) => ({path,sha256:await previewSha256(values[i]),byteLength:Buffer.byteLength(values[i])})));
  const manifest = await createPreviewManifest({schema:'riffology.browser-preview/v1',projectId:'browser-runtime-acceptance',revisionId:`revision-${await previewSha256(values.join(''))}`,filesSha256:await previewSha256(values.join('')),sources,runtime:profile.runtime});
  return {manifest,files};
}
export const emptyTracePython = `return {'model':'negative-fixture','snapshots':[{'schemaVersion':'riffology.visual/v0.1','frame':0,'time':0,'space':{'type':'lane','lanes':['queue']},'agents':[],'metrics':{'queue_length':0,'completed':0,'mean_wait':0,'throughput':0}}]}`;
