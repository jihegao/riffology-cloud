import {BROWSER_PREVIEW_GENERATION_CONTRACT,BROWSER_PREVIEW_SERVER_ADAPTER_SHA256} from '../trusted-pi/release-candidate.mjs';
import {validateSavedPreview} from './validator.ts';
import {emptyPreviewRegistry} from './profiles.ts';
import {parsePreviewRunInput,previewSha256} from './contract.ts';
import {resolveParameters} from '../simulation/model-spec.ts';
/** A post-save contract check, not an LLM generation or an authorized build trigger. */
export async function inspectGeneratedBrowserPreview(source,archiveBytes,kind,{registry=emptyPreviewRegistry}={}){
 if(!['mesa','stdlib'].includes(kind))throw Error('browser-preview-generation-kind-invalid');
 const result=await validateSavedPreview(source,archiveBytes,BROWSER_PREVIEW_GENERATION_CONTRACT.profiles[kind],registry);
 if(result.status!=='compatible')return result;
 if(await previewSha256(result.value.files.get('model/run.py'))!==BROWSER_PREVIEW_SERVER_ADAPTER_SHA256)return {status:'invalid-generation',reasonCode:'generation-wrapper-mismatch'};
 // Validate the same saved defaults passed by both trusted browser UI and server.
 parsePreviewRunInput({parameters:resolveParameters(result.value.spec,{}),seed:0});
 return result;
}
