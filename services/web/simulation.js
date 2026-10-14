import {createViewTabs,artifactView} from './artifact-views.js';
import {msg,t,uiError,errorMessage,cloudRunError,historicalRunError,formatNumber} from './i18n.js';
import {bindValue,bindAttribute} from './i18n-bindings.js';
const STATUSES = new Set(['queued','waiting_for_capacity','preparing','running','finalizing','stopping','unknown','completed','failed','cancelled']);
const TERMINAL = new Set(['completed','failed','cancelled']);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const MODEL_REASONS = {
  'model-spec-missing': msg('model.reason.missing'),
  'model-spec-invalid': msg('model.reason.invalid'),
  'model-contract-mismatch': msg('model.reason.contract'),
  'model-dependencies-invalid': msg('model.reason.dependenciesInvalid'),
  'model-dependencies-unsupported': msg('model.reason.dependenciesUnsupported'),
  'compiler-bundle-invalid': msg('model.reason.compilerBundle'),
};
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) bindValue(node,text);
  if (className) node.className = className;
  return node;
}
function modelView(model, experiments, rawOpen, toggleRaw) {
  const section = element('section', undefined, 'model-view');
  bindAttribute(section,'aria-label',()=>t('model.aria'));
  section.append(element('h2', msg('model.title')));
  if (!model) { section.append(element('p', msg('model.loading'))); return section; }
  if (model.reasonCode && !(model.artifacts && model.reasonCode==='model-spec-missing')) {
    const warning = element('p', MODEL_REASONS[model.reasonCode] || msg('model.unavailable'), 'model-warning');
    warning.setAttribute('role', 'status'); section.append(warning);
  }
  if (!model.spec || !model.version) return section;
  const spec = model.spec, version = model.version;
  section.append(element('p', msg('model.savedVersion', () => ({p0: version.revisionId ?? msg('model.initial')})), 'model-version'));
  if (model.compiler) section.append(element('p', msg('model.compilerIdentity', () => ({p0:model.compiler.compilerVersion,p1:model.compiler.bundleId.slice(0,12),p2:model.compiler.planFingerprint.slice(0,12)})), 'meta'));
  section.append(element('p', msg('model.revisionBoundary'), 'meta'));
  const fields = [[msg('model.question'), spec.researchQuestion], [msg('model.scope'), spec.scope], [msg('model.entities'), spec.entities], [msg('model.mechanisms'), spec.mechanisms], [msg('model.assumptions'), spec.assumptions], [msg('model.limitations'), spec.limitations]];
  const grid = element('div', undefined, 'model-sections');
  for (const [label, value] of fields) {
    const part = element('section'); part.append(element('h3', label));
    if (Array.isArray(value) && value.length) { const list = element('ul'); for (const item of value) list.append(element('li', item)); part.append(list); }
    else part.append(element('p', typeof value === 'string' && value ? value : msg('model.undeclared')));
    grid.append(part);
  }
  section.append(grid);
  const definitions = element('div', undefined, 'model-sections');
  for (const [label, values, isParameter] of [[msg('model.parameters'), spec.parameters, true], [msg('model.metrics'), spec.metrics, false]]) {
    const part = element('section'); part.append(element('h3', label));
    const list = element('dl');
    for (const [name, value] of Object.entries(values || {})) {
      list.append(element('dt', name));
      const types = {number:msg('model.type.number'),integer:msg('model.type.integer'),enum:msg('model.type.enum'),boolean:msg('model.type.boolean')};
      const summary = isParameter
        ? msg('model.parameterSummary', () => ({p0: types[value.type] || value.type, p1: typeof value.default==='number'?formatNumber(value.default):String(value.default), p2: value.unit ? msg('model.unit',{p0:value.unit}) : '', p3: value.minimum !== undefined ? msg('model.minimum',{value:formatNumber(value.minimum)}) : '', p4: value.maximum !== undefined ? msg('model.maximum',{value:formatNumber(value.maximum)}) : '', p5: value.values ? msg('model.choices',{values:value.values.join(', ')}) : ''}))
        : `${value.description || msg('model.noDescription')}${value.unit ? msg('model.unit', () => ({p0: value.unit})) : ''}`;
      list.append(element('dd', summary));
    }
    part.append(list.children.length ? list : element('p', msg('model.undeclared'))); definitions.append(part);
  }
  section.append(definitions);
  const mismatches = experiments.filter(run => run.version?.filesSha256 === version.filesSha256 && run.version?.specSha256 === version.specSha256 && ['simulation-result-invalid','invalid-model-spec','model-contract-mismatch'].includes(run.errorCode));
  for (const run of mismatches) section.append(element('p', msg('model.invalidRun', () => ({p0: run.runId})), 'model-warning'));
  if (!model.canRun && !model.reasonCode) section.append(element('p', model.capabilityReason?cloudRunError(model.capabilityReason):msg('model.runPaused'), 'meta'));
  if(model.runLimits)section.append(element('p',msg('run.resourceLimits',()=>({active:model.runLimits.maxActiveRuns,user:model.runLimits.maxRunsPerUser,seconds:model.runLimits.durationMs/1000,group:model.runLimits.maxGroupRuns})),'meta'));
  const raw = element('details'); raw.open = rawOpen; raw.ontoggle = () => toggleRaw(raw.open);
  raw.append(element('summary', msg('model.raw')));
  raw.append(element('pre', JSON.stringify({version, spec, ...(model.compiler?{compiler:model.compiler}:{})}, null, 2))); section.append(raw);
  return section;
}
function createSimulationPanel({root,api,modelRoot=null,historyRoot=null,runsRoot=null,onModel,localRuns=null}) {
  if(!root||typeof api!=='function')throw Error('invalid-simulation-panel');
  let context=null,model=null,experiments=[],pending=null,loading=false,message='',timer=null,posting=false,generation=0,readEpoch=0,draft={},seedValue=42,draftDirty=false,rawOpen=false,lastAgentDraft=null;
  const modelTabs=modelRoot?createViewTabs(modelRoot,'model'):null;
  const runNodes=runsRoot?[...runsRoot.children]:[],runTabs=runsRoot?createViewTabs(runsRoot,'runs'):null;
  function displayViews(description){
    const artifacts=model?.artifacts,views=artifacts?.manifest.views??[],identity=artifacts?.filesSha256??model?.version?.filesSha256??'';
    if(artifacts&&!model.spec)description.append(element('p',msg('model.savedVersion',{p0:artifacts.revisionId??msg('model.initial')}),'model-version'),element('p',msg('views.designSaved'),'meta'));
    if(model?.artifactReasonCode)description.append(element('p',msg('views.invalid'),'model-warning'));
    modelTabs?.update([{id:'_overview',title:msg('views.overview'),nodes:[description]},...views.filter(v=>v.section==='model').map(v=>({id:v.id,title:v.title,nodes:[artifactView(root.ownerDocument,v,artifacts)]}))],context,identity);
    if(runTabs){
      const metrics=element('section');metrics.append(element('h2',msg('views.metrics')),element('p',msg('views.runBoundary'),'meta'));
      for(const run of experiments){const entry=element('article');entry.append(element('p',msg('experiment.record',{p0:t('run.status.'+run.status,{},run.status),p1:run.runId,p2:run.stale?msg('experiment.stale'):'',p3:run.version?.revisionId??msg('model.initialVersion'),p4:run.seed,p5:JSON.stringify(run.parameters)})),element('pre',JSON.stringify(run.result?.metrics??{},null,2)));if(run.evidenceRejection)entry.append(element('p',msg('experiment.rejected',{p0:run.evidenceRejection.reason}),'model-warning'));if(run.errorCode)entry.append(element('p',historicalRunError(run.errorCode,run.status),'model-warning'));if(run.releasePending||TERMINAL.has(run.status)&&run.released===false)entry.append(element('p',msg('run.releasePending'),'meta'));metrics.append(entry);}
      const local=element('section'),localMetrics=element('section');localRuns?.renderHistory(local,'single',model?.version);localRuns?.renderHistory(localMetrics,'single',model?.version);metrics.append(localMetrics);
      runTabs.update([{id:'_overview',title:msg('views.runSetup'),nodes:runNodes},...views.filter(v=>v.section==='runs').map(v=>({id:v.id,title:v.title,nodes:v.renderer==='history'?[historyRoot,local].filter(Boolean):[metrics]}))],context,identity);
    }
  }
  let execution=localRuns?'local':'cloud';
  localRuns?.subscribe(()=>{if(context)render();});
  const keyFor=value=>`riffology:simulation-intent:${value.tenantId}:${value.workspaceId}`;
  const readPending=()=>{try{const value=JSON.parse(sessionStorage.getItem(keyFor(context))||'null');return value?.key&&value.body?value:null;}catch{return null;}};
  const savePending=value=>{try{if(value)sessionStorage.setItem(keyFor(context),JSON.stringify(value));else sessionStorage.removeItem(keyFor(context));return true;}catch{return false;}};
  const path=suffix=>`/api/workspaces/${encodeURIComponent(context.workspaceId)}${suffix}`;
  const params=(spec,filter=item=>!pending||Object.hasOwn(pending.body?.parameters||{},item.id))=>spec?.parameters&&typeof spec.parameters==='object'&&!Array.isArray(spec.parameters)?Object.entries(spec.parameters).map(([id,value])=>({id,...(value||{})})).filter(filter):[];
  const publicExperiment=value=>value&&id(value.experimentId)&&id(value.runId)&&STATUSES.has(value.status)?value:null;
  const inputKey=()=>`riffology:simulation-input:${context.tenantId}:${context.workspaceId}`;
  function rememberInput(){if(!model?.version||pending)return;try{sessionStorage.setItem(inputKey(),JSON.stringify({version:model.version,draft,seed:seedValue,agentDraftId:lastAgentDraft}));}catch{}}
  function restoreInput(){try{const saved=JSON.parse(sessionStorage.getItem(inputKey())||'null');if(saved?.version?.filesSha256===model?.version?.filesSha256&&saved?.version?.specSha256===model?.version?.specSha256&&saved.draft&&Number.isSafeInteger(saved.seed)){draft=saved.draft;seedValue=saved.seed;lastAgentDraft=saved.agentDraftId??null;draftDirty=true;}}catch{}}
  function render(){root.replaceChildren();const box=document.createElement('div');box.className='simulation-panel-inner';const title=document.createElement('h2');bindValue(title,()=>(msg('experiment.title')));const description=modelView(model,experiments,rawOpen,value=>{rawOpen=value;});if(!modelRoot)box.append(description);if(modelRoot&&model?.spec?.researchQuestion)box.append(element('p',model.spec.researchQuestion,'research-question'));box.append(title);if(pending?.body){const frozen=document.createElement('p');frozen.className='meta simulation-pending';bindValue(frozen,()=>(msg('experiment.pending', () => ({p0: pending.body.revisionId, p1: pending.body.filesSha256, p2: pending.body.specSha256, p3: pending.body.seed, p4: JSON.stringify(pending.body.parameters||{})}))));box.append(frozen);}const status=document.createElement('p');status.className='meta';bindValue(status,()=>(message||(loading?msg('experiment.loading'):model?.artifacts&&model.reasonCode==='model-spec-missing'?msg('views.designSaved'):model?.reasonCode?(MODEL_REASONS[model.reasonCode]||msg('experiment.unavailable')):model?.version?msg('experiment.ready'):msg('experiment.noRevision'))));box.append(status);const refresh=document.createElement('button');refresh.type='button';refresh.className='button';bindValue(refresh,()=>(msg('experiment.refresh')));refresh.onclick=()=>void load();box.append(refresh);const form=document.createElement('form');form.className='simulation-form';
    if(localRuns)form.append(localRuns.selector(execution,value=>{execution=value;render();},Boolean(pending)||localRuns.busy),element('p',msg(execution==='local'?'localRuns.boundary':'localRuns.cloudBoundary'),'meta'));
    if(execution==='local'&&model?.version&&!localRuns.eligible(model))form.append(element('p',msg('localRuns.unavailable'),'model-warning'));
    const frozen=Boolean(pending)||Boolean(localRuns?.busy);for(const item of params(model?.spec)){if(!id(item.id))continue;const label=document.createElement('label');label.append(bindValue(document.createElement('span'),()=>(item.title||item.name||item.id)));let input;if(item.type==='enum'||Array.isArray(item.values)||Array.isArray(item.options)){input=document.createElement('select');for(const option of item.values||item.options)input.append(new Option(String(option.label??option),String(option.value??option)));}else{input=document.createElement('input');input.type=item.type==='integer'||item.type==='number'?'number':item.type==='boolean'?'checkbox':'text';if(item.minimum!==undefined||item.min!==undefined)input.min=item.minimum??item.min;input.step=item.type==='integer'?'1':'any';input.required=item.type!=='boolean';if(item.maximum!==undefined||item.max!==undefined)input.max=item.maximum??item.max;}const value=frozen&&pending?.body?.parameters&&Object.hasOwn(pending.body.parameters,item.id)?pending.body.parameters[item.id]:Object.hasOwn(draft,item.id)?draft[item.id]:item.default;if(item.type==='boolean')input.checked=value===true;else input.value=value??'';input.name=item.id;input.disabled=frozen;const update=()=>{draft[item.id]=item.type==='boolean'?input.checked:input.value;draftDirty=true;rememberInput();};input.oninput=update;input.onchange=update;label.append(input);form.append(label);}
    const seed=document.createElement('input');seed.name='seed';seed.type='number';seed.min='0';seed.max='4294967295';seed.step='1';seed.required=true;seed.value=String(frozen&&pending?.body?.seed!==undefined?pending.body.seed:seedValue);seed.disabled=frozen;seed.oninput=()=>{seedValue=Number(seed.value);draftDirty=true;rememberInput();};const seedLabel=document.createElement('label');seedLabel.append(bindValue(document.createElement('span'),()=>msg('experiment.seed')));seedLabel.append(seed);form.append(seedLabel);const actions=document.createElement('div');const reset=document.createElement('button');reset.type='button';reset.className='button';bindValue(reset,()=>(msg('experiment.reset')));reset.disabled=frozen;reset.onclick=()=>{draft=Object.fromEntries(params(model?.spec).map(item=>[item.id,item.default]));seedValue=42;draftDirty=true;rememberInput();render();};const run=document.createElement('button');run.type='submit';run.className='button primary';run.disabled=(execution==='local'?!localRuns.eligible(model)||localRuns.busy:(!model?.canRun&&!pending))||loading||posting;bindValue(run,()=>(pending?msg('experiment.retry'):msg(execution==='local'?'localRuns.runSingle':'experiment.run')));actions.append(reset,run);form.append(actions);form.onsubmit=e=>{e.preventDefault();void submit(new FormData(form));};box.append(form);if(localRuns){const localHistory=element('section');localRuns.renderHistory(localHistory,'single',model?.version);box.append(localHistory);}
    const list=document.createElement('div');list.className='simulation-experiments';for(const item of experiments){const row=document.createElement('article');row.className='simulation-experiment';const text=document.createElement('span');bindValue(text,()=>(msg('experiment.record', () => ({p0: t('run.status.'+item.status,{},item.status), p1: item.runId, p2: item.stale?msg('experiment.stale'):'', p3: item.version?.revisionId||msg('model.initialVersion'), p4: item.seed, p5: JSON.stringify(item.parameters)}))));row.append(text);if(item.evidenceRejection)row.append(element('small',msg('experiment.rejected', () => ({p0: item.evidenceRejection.reason})),'model-warning'));if(item.errorCode)row.append(element('small',historicalRunError(item.errorCode,item.status),'model-warning'));if(item.releasePending||TERMINAL.has(item.status)&&item.released===false)row.append(element('p',msg('run.releasePending'),'meta'));if(item.result?.metrics){const metrics=document.createElement('small');bindValue(metrics,()=>(JSON.stringify(item.result.metrics)));row.append(metrics);}if(item.result?.compiler){const detail=element('details');detail.append(element('summary',msg('experiment.compilerIdentity')),element('pre',JSON.stringify(item.result.compiler,null,2)));row.append(detail);}if(!TERMINAL.has(item.status)){const cancel=document.createElement('button');cancel.type='button';cancel.className='button compact';bindValue(cancel,()=>(msg('experiment.stop')));cancel.onclick=()=>void cancelRun(item.runId);row.append(cancel);}list.append(row);}if(historyRoot){historyRoot.replaceChildren(element('h2',msg('experiment.history')),list);const latest=experiments[0];if(latest){const summary=element('div',undefined,'latest-result');summary.append(element('h3',msg('experiment.latest')),element('p',msg('experiment.latestSummary', () => ({p0: t('run.status.'+latest.status,{},latest.status), p1: latest.stale?msg('experiment.oldResult'):'', p2: latest.version?.revisionId??msg('model.initialVersion'), p3: latest.seed}))));if(latest.evidenceRejection)summary.append(element('p',msg('experiment.rejected', () => ({p0: latest.evidenceRejection.reason})),'model-warning'));if(latest.result?.metrics)summary.append(element('p',JSON.stringify(latest.result.metrics)));if(latest.result?.compiler){const detail=element('details');detail.append(element('summary',msg('experiment.compilerIdentity')),element('pre',JSON.stringify(latest.result.compiler,null,2)));summary.append(detail);}box.append(summary);}}else if(experiments.length)box.append(list);root.append(box);displayViews(description);}
  async function load(){
    const token=generation,current=context;if(!current)return;const epoch=++readEpoch;clearTimeout(timer);loading=true;render();
    const valid=()=>token===generation&&current===context&&epoch===readEpoch;
    try{const [m,e]=await Promise.all([api(path('/model')),api(path('/experiments'))]);if(!valid())return;
      const changed=model?.version&&(model.version.filesSha256!==m.version?.filesSha256||model.version.specSha256!==m.version?.specSha256);
      model=m;onModel?.(m);experiments=(e?.items||[]).map(publicExperiment).filter(Boolean);
      if(pending?.body){draft={...(pending.body.parameters||{})};seedValue=Number.isSafeInteger(pending.body.seed)?pending.body.seed:42;}
      else if(changed){draft={};draftDirty=false;seedValue=42;}
      else if(!draftDirty&&experiments[0]&&experiments[0].version?.filesSha256===m.version?.filesSha256){draft={...(experiments[0].parameters||{})};seedValue=Number.isSafeInteger(experiments[0].seed)?experiments[0].seed:42;}
      if(!pending){
        if(!draftDirty)restoreInput();
        const incoming=m.experimentDraft;
        if(incoming&&incoming.draftId!==lastAgentDraft&&incoming?.version?.filesSha256===m.version?.filesSha256&&incoming?.version?.specSha256===m.version?.specSha256){draft={...incoming.parameters};seedValue=incoming.seed;draftDirty=true;lastAgentDraft=incoming.draftId;rememberInput();}
      }
      message='';
    }catch(error){if(valid())message=cloudRunError(error)||msg('experiment.readFailed');}
    finally{if(valid()){loading=false;render();schedulePoll();}}
  }
  function schedulePoll(){
    clearTimeout(timer);if(!context||loading||!experiments.some(item=>!TERMINAL.has(item.status)||item.released===false))return;
    const token=generation,current=context,epoch=readEpoch,valid=()=>token===generation&&current===context&&epoch===readEpoch;
    timer=setTimeout(async()=>{try{const e=await api(path('/experiments'));if(valid()){experiments=(e?.items||[]).map(publicExperiment).filter(Boolean);render();}}catch{}finally{if(valid())schedulePoll();}},1500);
  }
  async function submitPending(){if(!pending||loading||posting)return;posting=true;render();const token=generation,current=context,attempt=pending;try{const result=await api(path('/experiments'),{method:'POST',headers:{'Idempotency-Key':attempt.key},body:JSON.stringify(attempt.body),signal:AbortSignal.timeout(15000)});if(token!==generation||current!==context||pending!==attempt)return;savePending(null);pending=null;readEpoch++;loading=false;clearTimeout(timer);experiments=[publicExperiment(result),...experiments.filter(item=>item.runId!==result.runId)].filter(Boolean);message=msg('experiment.accepted');render();schedulePoll();}catch(error){if(token===generation&&current===context&&pending===attempt){message=cloudRunError(error)||msg('experiment.unconfirmed');const known=['simulation-input-invalid','invalid-model-spec','model-spec-missing','model-spec-invalid','model-contract-mismatch','model-dependencies-invalid','model-dependencies-unsupported'];if((error.status===400&&known.includes(error.code))||(error.status===409&&error.code==='simulation-model-stale')||(error.status===413&&error.code==='body_too_large')){savePending(null);pending=null;draft={...(attempt.body.parameters||{})};seedValue=Number.isSafeInteger(attempt.body.seed)?attempt.body.seed:42;draftDirty=true;}render();}}finally{if(token===generation&&current===context){posting=false;render();}}}
  async function submit(form){if(pending)return submitPending();if(loading||posting||!model?.version||(execution==='cloud'&&!model.canRun))return;const parameters={};for(const item of params(model.spec)){const field=form.get(item.id);if(item.type==='boolean')parameters[item.id]=field!==null;else if(item.type==='integer'||item.type==='number')parameters[item.id]=Number(field);else parameters[item.id]=field;}if(!Number.isSafeInteger(seedValue)||seedValue<0||seedValue>4294967295||Object.values(parameters).some(value=>typeof value==='number'&&!Number.isFinite(value))){message=msg('experiment.invalidInput');render();return;}if(execution==='local'){const token=generation;try{await localRuns.execute('single',model,{parameters,seed:seedValue});}catch(error){if(token===generation)message=errorMessage(error);}finally{if(token===generation)render();}return;}pending={key:crypto.randomUUID(),body:{revisionId:model.version.revisionId,filesSha256:model.version.filesSha256,specSha256:model.version.specSha256,parameters,seed:seedValue}};if(!savePending(pending)){pending=null;message=msg('run.storageFailed');render();return;}await submitPending();}
  async function cancelRun(runId){const token=generation,current=context;try{await api(`/api/workspaces/${encodeURIComponent(current.workspaceId)}/simulation-runs/${encodeURIComponent(runId)}/cancel`,{method:'POST',body:'{}'});if(token===generation&&current===context)await load();}catch(error){if(token===generation&&current===context){message=cloudRunError(error)||msg('experiment.stopUnconfirmed');render();}}}
  async function enter(value){leave();if(!value||!id(value.tenantId)||!id(value.workspaceId))throw Error('invalid-simulation-context');context=value;generation++;pending=readPending();execution=pending?'cloud':localRuns?'local':'cloud';render();await load();}
  function leave(){generation++;clearTimeout(timer);timer=null;posting=false;context=null;model=null;experiments=[];pending=null;draft={};seedValue=42;draftDirty=false;rawOpen=false;lastAgentDraft=null;root.replaceChildren();modelRoot?.replaceChildren();historyRoot?.replaceChildren();}
  return {enter,leave,reload:load};
}
export {createSimulationPanel};
