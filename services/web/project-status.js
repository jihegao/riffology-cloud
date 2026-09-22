import {msg} from './i18n.js';

// Labels describe independent states, never infer model presence from origin.
export function isAcceptanceProject(title){return /^(?:G[45]\b|Phase1\b|Research Loop acceptance\b|staging-.*(?:acceptance|reliability))/i.test(title);}
export function projectModelSummary(model,preview){
 const saved=Boolean(model?.version),status=preview?.build?.status;
 const label=status==='ready'?'projectStatus.previewReady':status==='building'?'projectStatus.previewBuilding':status==='unsupported'?'projectStatus.previewUnsupported':status==='failed'?'projectStatus.previewFailed':preview===null?'projectStatus.previewUnknown':'projectStatus.noPreview';
 const modelLabel=saved?'projectStatus.modelSaved':model===null?'projectStatus.modelUnknown':'projectStatus.noModel';
 return {saved,previewReady:status==='ready',text:msg('projectStatus.summary',()=>({model:String(msg(modelLabel)),preview:String(msg(label))}))};
}
