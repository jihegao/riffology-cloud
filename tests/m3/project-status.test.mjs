import test from 'node:test';
import assert from 'node:assert/strict';
import {setLocale} from '../../services/web/i18n.js';
import {isAcceptanceProject,projectModelSummary} from '../../services/web/project-status.js';
test('test-project classification is explicit, title-based and non-destructive',()=>{
 for(const s of ['G4 synthetic Queue','G5 Mac v5','Phase1 queue','Research Loop acceptance 81d','staging-v3-reliability-acceptance'])assert.equal(isAcceptanceProject(s),true);
 for(const s of ['aa','My Queue','G40 research'])assert.equal(isAcceptanceProject(s),false);
});
test('saved model, preview and workspace creation are independent',()=>{
 setLocale('zh-CN');const summary=projectModelSummary({version:{revisionId:'r'}},{build:{status:'unsupported'}});
 assert.deepEqual({...summary,text:String(summary.text)},{saved:true,previewReady:false,text:'模型已保存 · 本地预览暂不兼容'});
 assert.equal(String(projectModelSummary(null,null).text),'模型状态未确认 · 预览状态未确认');
 assert.equal(projectModelSummary({version:{revisionId:'r'}},{build:{status:'ready'}}).previewReady,true);
 setLocale('en');assert.equal(String(summary.text),'Model saved · Local preview is not compatible');setLocale('zh-CN');
});
