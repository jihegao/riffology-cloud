// Labels describe independent states, never infer model presence from origin.
export function isAcceptanceProject(title){return /^(?:G[45]\b|Phase1\b|Research Loop acceptance\b|staging-.*(?:acceptance|reliability))/i.test(title);}
export function projectModelSummary(model,preview){
 const saved=Boolean(model?.version),status=preview?.build?.status;
 const label=status==='ready'?'本地预览可用':status==='building'?'本地预览构建中':status==='unsupported'?'本地预览暂不兼容':status==='failed'?'本地预览构建失败':preview===null?'预览状态未确认':'尚无本地预览';
 return {saved,previewReady:status==='ready',text:`${saved?'模型已保存':model===null?'模型状态未确认':'尚无有效模型说明'} · ${label}`};
}
