import {msg,t,uiError,errorMessage,cloudRunError,historicalRunError,formatNumber} from './i18n.js';
import {bindValue,bindAttribute} from './i18n-bindings.js';
const TERMINAL = new Set(['completed', 'partial', 'failed', 'cancelled']);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) { if(tag==='label')n.append(bindValue(document.createElement('span'),text));else bindValue(n,text); } if (className) n.className = className; return n; };
const button = (text, action, disabled = false) => { const b = node('button', text, 'button'); b.type = 'button'; b.disabled = disabled; b.onclick = action; return b; };
const defaults = spec => Object.fromEntries(Object.entries(spec?.parameters || {}).map(([key, value]) => [key, value.default]));

export function createComparisonPanel({root, api,localRuns=null}) {
  let context = null, generation = 0, readEpoch = 0, model = null, groups = [], cursor = null, pending = null, timer = null, busy = false, loading = false, message = '', lastAgentDraft = null;
  let execution=localRuns?'local':'cloud';
  localRuns?.subscribe(()=>{if(context){renderEditor();renderHistory();}});
  let draft = null, editor, history, status, rawOpen = new Set();
  const storageKey = () => `riffology:comparison-intent:${context.tenantId}:${context.workspaceId}`;
  const path = suffix => `/api/workspaces/${encodeURIComponent(context.workspaceId)}${suffix}`;
  const freshDraft = () => ({hypothesis:'', baseline:{label:t('compare.baseline'), parameters:defaults(model?.spec)}, interventions:[{label:t('compare.firstIntervention'), parameters:defaults(model?.spec)}], seeds:'42, 43, 44'});
  const active = () => groups.some(g => !TERMINAL.has(g.status));
  const persist = value => { try { if (value) sessionStorage.setItem(storageKey(), JSON.stringify(value)); else sessionStorage.removeItem(storageKey()); return true; } catch { return false; } };
  const mark = text => { message = text; if (status) bindValue(status,()=>(message)); };
  const inputKey=()=>`riffology:comparison-input:${context.tenantId}:${context.workspaceId}`;
  function rememberInput(){if(!model?.version||pending||!draft)return;try{sessionStorage.setItem(inputKey(),JSON.stringify({version:model.version,draft,agentDraftId:lastAgentDraft}));}catch{}}
  function restoreInput(){try{const saved=JSON.parse(sessionStorage.getItem(inputKey())||'null');if(saved?.version?.filesSha256===model?.version?.filesSha256&&saved?.version?.specSha256===model?.version?.specSha256&&saved.draft){draft=saved.draft;lastAgentDraft=saved.agentDraftId??null;}}catch{}}
  function setup() {
    root.replaceChildren(); root.append(node('h2', msg('compare.title')));
    root.append(node('p', msg('compare.description')));
    status = node('p', message); status.setAttribute('role','status'); root.append(status);
    editor = node('div', undefined, 'comparison-editor'); history = node('div', undefined, 'comparison-history'); root.append(editor, history);
    renderEditor(); renderHistory();
  }
  function typedField(name, definition, values, disabled) {
    const label = node('label', `${name}${definition.unit ? ` (${definition.unit})` : ''}`);
    let input;
    if (definition.type === 'enum') { input = node('select'); for (const value of definition.values) input.append(new Option(value, value)); }
    else { input = node('input'); input.type = definition.type === 'boolean' ? 'checkbox' : 'number'; if (definition.minimum !== undefined) input.min = definition.minimum; if (definition.maximum !== undefined) input.max = definition.maximum; input.step = definition.type === 'integer' ? '1' : 'any'; input.required = definition.type !== 'boolean'; }
    input.name = name; input.disabled = disabled;
    if (definition.type === 'boolean') input.checked = values[name] === true; else input.value = values[name] ?? definition.default;
    input.oninput = input.onchange = () => { values[name] = definition.type === 'boolean' ? input.checked : definition.type === 'enum' ? input.value : Number(input.value); };
    label.append(input); return label;
  }
  function renderEditor() {
    if (!editor) return; editor.replaceChildren(); const frozen = !!pending||Boolean(localRuns?.busy);
    const refresh = button(msg('compare.refresh'), () => void load(), loading || busy); editor.append(refresh);
    if (pending) {
      editor.append(node('p', msg('compare.pending'), 'model-warning'));
      const detail = node('details'); detail.append(node('summary', msg('compare.pendingDetails')), node('pre', JSON.stringify(pending.body, null, 2))); editor.append(detail);
      editor.append(button(msg('compare.retry'), () => void submitPending(), loading || busy)); return;
    }
    if (!model?.spec || !model?.version) { editor.append(node('p',msg('compare.noModel'))); return; }
    if (!draft) draft = freshDraft();
    const form = node('form', undefined, 'comparison-form');
    if(localRuns)form.append(localRuns.selector(execution,value=>{execution=value;renderEditor();},frozen),node('p',msg(execution==='local'?'localRuns.boundary':'localRuns.cloudBoundary'),'meta'));
    const question = node('label', msg('compare.hypothesis')); const hypothesis = node('input'); hypothesis.name = 'hypothesis'; hypothesis.required = true; hypothesis.maxLength = 2000; hypothesis.disabled=frozen;hypothesis.value = draft.hypothesis; hypothesis.oninput = () => { draft.hypothesis = hypothesis.value; }; question.append(hypothesis); form.append(question);
    const configs = node('div', undefined, 'comparison-configs');
    for (const [index, config] of [draft.baseline, ...draft.interventions].entries()) {
      const fieldset = node('fieldset'); fieldset.dataset.configuration = index === 0 ? 'baseline' : `intervention-${index}`; fieldset.append(node('legend',index === 0 ? msg('compare.baseline') : msg('compare.intervention', () => ({p0: index}))));
      const label = node('label',msg('compare.configName')); const name = node('input'); name.name='label'; name.required=true; name.maxLength=80; name.disabled=frozen;name.value=config.label; name.oninput=()=>{config.label=name.value;}; label.append(name); fieldset.append(label);
      for (const [key, def] of Object.entries(model.spec.parameters || {})) fieldset.append(typedField(key,def,config.parameters,frozen));
      if (index > 0 && draft.interventions.length > 1) fieldset.append(button(msg('compare.remove'),()=>{draft.interventions.splice(index-1,1);rememberInput();renderEditor();},frozen)); configs.append(fieldset);
    }
    form.append(configs);form.append(button(msg('compare.add'),()=>{draft.interventions.push({label:t('compare.intervention', ({p0: draft.interventions.length+1})),parameters:defaults(model.spec)});rememberInput();renderEditor();},frozen||draft.interventions.length>=3));
    const seedLabel=node('label',msg('compare.seeds'));const seeds=node('input');seeds.name='seeds';seeds.required=true;seeds.disabled=frozen;seeds.value=draft.seeds;const count=node('p',undefined,'comparison-count');const countSeeds=()=>{const n=draft.seeds.trim()?draft.seeds.trim().split(/[\s,，]+/).length:0;bindValue(count,()=>(msg('compare.count', () => ({p0: formatNumber(n), p1: formatNumber((1+draft.interventions.length)*n)}))));};seeds.oninput=()=>{draft.seeds=seeds.value;countSeeds();};countSeeds();seedLabel.append(seeds);form.append(seedLabel,count);
    const actions=node('div',undefined,'comparison-actions');actions.append(button(msg('compare.reset'),()=>{draft=freshDraft();rememberInput();renderEditor();},frozen));const run=node('button',msg(execution==='local'?'localRuns.runComparison':'compare.run'),'button primary');run.type='submit';run.disabled=loading||busy||(execution==='local'?!localRuns.eligible(model)||localRuns.busy:!model.canRun);actions.append(run);form.append(actions);
    if(execution==='local'&&!localRuns.eligible(model))form.append(node('p',msg('localRuns.unavailable'),'model-warning'));
    if(execution==='cloud'&&!model.canRun)form.append(node('p',model.capabilityReason?cloudRunError(model.capabilityReason):msg('compare.unavailable'),'model-warning'));
    if(execution==='cloud'&&model.runLimits)form.append(node('p',msg('run.resourceLimits',()=>({active:model.runLimits.maxActiveRuns,user:model.runLimits.maxRunsPerUser,seconds:model.runLimits.durationMs/1000,group:model.runLimits.maxGroupRuns})),'meta'));
    form.oninput=()=>rememberInput();form.onchange=()=>rememberInput();form.onsubmit=event=>{event.preventDefault();void submit();};editor.append(form);
  }
  function renderHistory() {
    if(!history)return;history.replaceChildren();if(localRuns){const localHistory=node('section');localRuns.renderHistory(localHistory,'comparison',model?.version);history.append(localHistory);}history.append(node('h3',msg('compare.history')));
    if(!groups.length)history.append(node('p',msg('compare.empty')));
    for(const group of groups){
      const article=node('article',undefined,'comparison-group');article.dataset.groupId=group.groupId;
      article.append(node('h3',group.hypothesis),node('p',msg('compare.groupStatus',()=>({status:t('run.status.'+group.status,{},group.status),id:group.groupId}))),node('p',msg('compare.revision', () => ({p0: group.version?.revisionId??msg('model.initial'), p1: group.repetitions ?? group.seeds?.length}))));
      if(group.errorCode)article.append(node('p',historicalRunError(group.errorCode,group.status),'model-warning'));
      if(group.stale)article.append(node('p',msg('compare.stale'),'model-warning'));
      const p=group.progress||{};article.append(node('p',msg('compare.progress', () => ({p0: formatNumber(p.total??0), p1: formatNumber(p.pending??0), p2: formatNumber(p.active??0), p3: formatNumber(p.completed??0), p4: formatNumber(p.failed??0), p5: formatNumber(p.cancelled??0), p6: p.rejected ? msg('compare.rejectedCount',{value:formatNumber(p.rejected)}) : ''}))));
      if(p.rejected)article.append(node('p',msg('compare.rejectedWarning'),'model-warning'));
      if(group.status==='partial'||group.status==='failed'||group.status==='cancelled')article.append(node('p',msg('compare.partialWarning'),'model-warning'));
      const table=node('table');table.append(node('caption',msg('compare.caption')));const head=node('tr');for(const text of [msg('compare.column.metric'),msg('compare.column.count'),msg('compare.column.mean'),msg('compare.column.baseline'),msg('compare.column.delta')])head.append(node('th',text));table.append(head);
      const format=value=>typeof value==='number'&&Number.isFinite(value)?msg('common.formattedNumber',()=>({value:formatNumber(value,{maximumSignificantDigits:6})})):'—';
      for(const summary of group.summary||[])for(const [metric,value]of Object.entries(summary.metrics||{})){const row=node('tr'),config=group.configurations?.find(c=>c.configurationId===summary.configurationId);for(const text of [`${config?.label||summary.configurationId} / ${metric}${group.metrics?.[metric]?.unit?` (${group.metrics[metric].unit})`:''}`,msg('compare.samples',()=>({valid:formatNumber(value.count??0),missing:formatNumber(value.missing??0),error:value.errorCode?' / '+value.errorCode:''})),format(value.mean),format(value.baselineMean),format(value.delta)])row.append(node('td',text));table.append(row);}
      const scroll=node('div',undefined,'comparison-table');scroll.append(table);article.append(scroll);
      if(!TERMINAL.has(group.status))article.append(button(msg('compare.stop'),()=>void cancel(group.groupId),busy));
      const detail=node('details');detail.open=rawOpen.has(group.groupId);detail.ontoggle=()=>{if(detail.open)rawOpen.add(group.groupId);else rawOpen.delete(group.groupId);};detail.append(node('summary',msg('compare.details', () => ({p0: group.runs?.length??0}))));
      for(const run of group.runs||[]){const row=node('section',undefined,'comparison-run');row.append(node('h4',msg('compare.runStatus',()=>({configuration:run.configurationId,seed:run.seed,status:t('run.status.'+run.status,{},run.status)}))),node('p',run.runId||msg('compare.unassigned')));if(run.evidenceRejection)row.append(node('p',msg('compare.rejection', () => ({p0: run.evidenceRejection.reason})),'model-warning'));if(run.errorCode)row.append(node('p',msg('compare.failure', () => ({p0: run.errorCode})),'model-warning'));row.append(node('pre',JSON.stringify({runId:run.runId,version:group.version,configuration:group.configurations?.find(c=>c.configurationId===run.configurationId),seed:run.seed,status:run.status,errorCode:run.errorCode,failure:run.failure,result:run.result,released:run.released,evidenceRejection:run.evidenceRejection},null,2)));detail.append(row);}
      article.append(detail);history.append(article);
    }
    if(cursor)history.append(button(msg('compare.more'),()=>void loadMore(),loading));
  }
  function schedule() {
    clearTimeout(timer);if(!context||loading||!active())return;const token=generation,epoch=readEpoch,valid=()=>token===generation&&epoch===readEpoch;
    timer=setTimeout(async()=>{try{const updates=await Promise.all(groups.filter(g=>!TERMINAL.has(g.status)).map(g=>api(path(`/experiment-groups/${encodeURIComponent(g.groupId)}`))));if(!valid())return;for(const item of updates)groups=groups.map(g=>g.groupId===item.groupId?item:g);renderHistory();}catch{if(valid())mark(msg('compare.pollFailed'));}finally{if(valid())schedule();}},1500);
  }
  async function load() {
    if(!context)return;const token=generation,epoch=++readEpoch,valid=()=>token===generation&&epoch===readEpoch;clearTimeout(timer);loading=true;renderEditor();
    try{const [m,page]=await Promise.all([api(path('/model')),api(path('/experiment-groups'))]);if(!valid())return;
      if(draft&&model?.version&&(model.version.filesSha256!==m.version?.filesSha256||model.version.specSha256!==m.version?.specSha256)){draft=null;mark(msg('compare.modelChanged'));}
      model=m;
      if(!pending){
        if(!draft)restoreInput();
        const incoming=m.experimentDraft;
        if(incoming?.comparison&&incoming.draftId!==lastAgentDraft&&incoming.version?.filesSha256===m.version?.filesSha256&&incoming.version?.specSha256===m.version?.specSha256){const c=incoming.comparison;draft={hypothesis:c.hypothesis,baseline:structuredClone(c.baseline),interventions:structuredClone(c.interventions),seeds:c.seeds.join(', ')};lastAgentDraft=incoming.draftId;rememberInput();}
      }
      groups=(page.items||[]).filter(g=>safeId(g.groupId));cursor=page.nextCursor||null;
    }catch(error){if(valid())mark(cloudRunError(error)||msg('compare.readFailed'));}finally{if(valid()){loading=false;renderEditor();renderHistory();schedule();}}
  }
  async function loadMore(){
    if(!cursor||loading)return;const token=generation,epoch=++readEpoch,valid=()=>token===generation&&epoch===readEpoch;clearTimeout(timer);loading=true;renderHistory();
    try{const page=await api(path(`/experiment-groups?before=${encodeURIComponent(cursor)}`));if(!valid())return;groups=[...groups,...(page.items||[]).filter(g=>safeId(g.groupId)&&!groups.some(old=>old.groupId===g.groupId))];cursor=page.nextCursor||null;}catch(error){if(valid())mark(cloudRunError(error)||msg('compare.historyFailed'));}finally{if(valid()){loading=false;renderHistory();schedule();}}
  }
  async function submit(){
    if(pending)return submitPending();if(busy||loading||!model?.version||(execution==='cloud'&&!model.canRun))return;
    const seeds=draft.seeds.trim()?draft.seeds.trim().split(/[\s,，]+/).map(Number):[];
    if(!draft.hypothesis.trim()||!seeds.length||seeds.length>20||new Set(seeds).size!==seeds.length||seeds.some(s=>!Number.isSafeInteger(s)||s<0||s>4294967295)){mark(msg('compare.invalidSeeds'));return;}
    const labels=[draft.baseline,...draft.interventions].map(c=>c.label.trim());if(labels.some(label=>!label)||new Set(labels).size!==labels.length){mark(msg('compare.invalidNames'));return;}
    const body={...model.version,hypothesis:draft.hypothesis.trim(),baseline:structuredClone(draft.baseline),interventions:structuredClone(draft.interventions),seeds};
    if(execution==='local'){const token=generation;try{await localRuns.execute('comparison',model,body);}catch(error){if(token===generation)mark(errorMessage(error));}finally{if(token===generation){renderEditor();renderHistory();}}return;}
    if(model.runLimits&&seeds.length*(draft.interventions.length+1)>model.runLimits.maxGroupRuns){mark(msg('run.error.invited-runs-group-limit'));return;}
    const attempt={key:crypto.randomUUID(),body};if(!persist(attempt)){mark(msg('compare.storageFailed'));return;}pending=attempt;await submitPending();
  }
  async function submitPending(){if(!pending||busy||loading)return;const token=generation,attempt=pending;busy=true;renderEditor();try{
    const group=await api(path('/experiment-groups'),{method:'POST',headers:{'Idempotency-Key':attempt.key},body:JSON.stringify(attempt.body),signal:AbortSignal.timeout(15000)});
    if(token!==generation)return;if(!safeId(group?.groupId))throw uiError('compare.receiptInvalid');persist(null);pending=null;groups=[group,...groups.filter(g=>g.groupId!==group.groupId)];mark(msg('compare.accepted'));
  }catch(error){if(token!==generation)return;mark(cloudRunError(error)||msg('compare.unconfirmed'));const known=['simulation-input-invalid','invalid-model-spec','model-spec-missing','model-spec-invalid','model-contract-mismatch','model-dependencies-invalid','model-dependencies-unsupported'];if(error.status===400&&known.includes(error.code)||error.status===409&&error.code==='simulation-model-stale'||error.status===413&&error.code==='body_too_large'){persist(null);pending=null;draft=null;const previousMessage=message;mark(msg('compare.refreshRequired', {p0:previousMessage}));model=null;}}
    finally{if(token===generation){busy=false;renderEditor();renderHistory();schedule();}}
  }
  async function cancel(groupId){if(busy)return;const token=generation;busy=true;renderHistory();try{await api(path(`/experiment-groups/${encodeURIComponent(groupId)}/cancel`),{method:'POST',body:'{}',signal:AbortSignal.timeout(15000)});if(token===generation){mark(msg('compare.stopAccepted'));await load();}}catch(error){if(token===generation)mark(cloudRunError(error)||msg('compare.stopUnconfirmed'));}finally{if(token===generation){busy=false;renderHistory();}}}
  async function enter(value){leave();if(!safeId(value?.tenantId)||!safeId(value?.workspaceId))throw Error('invalid-comparison-context');context=value;try{const saved=JSON.parse(sessionStorage.getItem(storageKey())||'null');if(saved?.key&&saved?.body)pending=saved;}catch{}execution=pending?'cloud':localRuns?'local':'cloud';setup();await load();}
  function leave(){generation++;clearTimeout(timer);context=null;model=null;groups=[];cursor=null;pending=null;busy=false;loading=false;draft=null;lastAgentDraft=null;message='';rawOpen=new Set();root.replaceChildren();editor=history=status=null;}
  return {enter,leave,reload:load};
}
