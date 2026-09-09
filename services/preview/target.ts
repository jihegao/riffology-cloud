import type {PreviewBinding} from './bindings.ts';
import type {ServiceIntentRecord} from '../workspace/service-intents.ts';
import {matchedServiceRun} from '../run/view.ts';
import {previewSource} from './source.ts';
import {serviceRuntimeReference} from '../run/service.ts';
import {sameScope} from '../turn/protocol.ts';

export interface PreviewTargetPorts{
 binding(previewId:string):Promise<PreviewBinding>;
 view(runId:string):Promise<{intent:ServiceIntentRecord;run:unknown}>;
}
/** A point-in-time private target, not a browser credential or socket grant.
 * Re-read the binding after remote observation so replacement wins over a
 * delayed Run reply. The eventual proxy must also enforce session revocation. */
export async function resolvePreviewTarget(ports:PreviewTargetPorts,previewId:string,clock=Date.now){
 const binding=await ports.binding(previewId);
 const view=await ports.view(binding.runId),task=view.intent.task;
 if(!task||view.intent.runId!==binding.runId||view.intent.status!=='delivered'||view.intent.stopRequestedAt!==null)throw Error('preview-target-unavailable');
 const run=matchedServiceRun(view.run,task);
 if(!run||!sameScope(run.scope,binding.scope)||run.status!=='running'||run.stopRequestedAt!==null||!run.runtime||
  JSON.stringify(previewSource(run.spec.plan.source))!==JSON.stringify(previewSource(binding.source))||
  JSON.stringify(serviceRuntimeReference(run.runtime))!==JSON.stringify(serviceRuntimeReference(binding.runtime)))throw Error('preview-target-unavailable');
 const latest=await ports.binding(previewId);
 if(JSON.stringify(latest)!==JSON.stringify(binding)||latest.expiresAt<=clock()||run.runtime.deadlineAt<=clock())throw Error('preview-target-unavailable');
 return {binding:latest,run};
}
