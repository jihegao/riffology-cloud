const STATUSES = new Set(['queued','waiting_for_capacity','preparing','running','finalizing','stopping','unknown','completed','failed','cancelled']);
const TERMINAL = new Set(['completed','failed','cancelled']);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const MODEL_REASONS = {
  'model-spec-missing': '尚未保存模型说明。请让建模助手创建模型并保存。',
  'model-spec-invalid': '已保存的模型说明格式不完整。请让建模助手修复并保存新版本。',
  'model-contract-mismatch': '模型说明引用的执行文件不完整。请让建模助手同步修复模型说明与代码，再保存新版本。',
  'model-dependencies-invalid': '模型运行环境说明无法读取。请让建模助手修复并保存新版本。',
  'model-dependencies-unsupported': '模型需要当前环境尚不支持的依赖。请调整模型运行环境并保存新版本。',
};
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function modelView(model, experiments, rawOpen, toggleRaw) {
  const section = element('section', undefined, 'model-view');
  section.setAttribute('aria-label', 'Model 模型说明');
  section.append(element('h2', 'Model · 模型说明'));
  if (!model) { section.append(element('p', '正在读取已保存的模型说明…')); return section; }
  if (model.reasonCode) {
    const warning = element('p', MODEL_REASONS[model.reasonCode] || '模型暂不可运行，请刷新后检查。', 'model-warning');
    warning.setAttribute('role', 'status'); section.append(warning);
  }
  if (!model.spec || !model.version) return section;
  const spec = model.spec, version = model.version;
  section.append(element('p', `已保存版本：${version.revisionId ?? '初始模型版本'}`, 'model-version'));
  section.append(element('p', '此说明与已保存代码属于同一版本；未保存的修改不会显示在这里。结构校验不代表模型假设已被验证。', 'meta'));
  const fields = [['研究问题', spec.researchQuestion], ['范围与边界', spec.scope], ['实体与资源', spec.entities], ['机制与规则', spec.mechanisms], ['假设', spec.assumptions], ['限制与未包含的机制', spec.limitations]];
  const grid = element('div', undefined, 'model-sections');
  for (const [label, value] of fields) {
    const part = element('section'); part.append(element('h3', label));
    if (Array.isArray(value) && value.length) { const list = element('ul'); for (const item of value) list.append(element('li', item)); part.append(list); }
    else part.append(element('p', typeof value === 'string' && value ? value : '此版本未声明'));
    grid.append(part);
  }
  section.append(grid);
  const definitions = element('div', undefined, 'model-sections');
  for (const [label, values, isParameter] of [['参数定义', spec.parameters, true], ['输出指标', spec.metrics, false]]) {
    const part = element('section'); part.append(element('h3', label));
    const list = element('dl');
    for (const [name, value] of Object.entries(values || {})) {
      list.append(element('dt', name));
      const types = {number:'数值',integer:'整数',enum:'选项',boolean:'开关'};
      const summary = isParameter
        ? `${types[value.type] || value.type} · 默认 ${String(value.default)}${value.unit ? ` · 单位 ${value.unit}` : ''}${value.minimum !== undefined ? ` · 最小 ${value.minimum}` : ''}${value.maximum !== undefined ? ` · 最大 ${value.maximum}` : ''}${value.values ? ` · 可选 ${value.values.join('、')}` : ''}`
        : `${value.description || '此版本未提供说明'}${value.unit ? ` · 单位 ${value.unit}` : ''}`;
      list.append(element('dd', summary));
    }
    part.append(list.children.length ? list : element('p', '此版本未声明')); definitions.append(part);
  }
  section.append(definitions);
  const mismatches = experiments.filter(run => run.version?.filesSha256 === version.filesSha256 && run.version?.specSha256 === version.specSha256 && ['simulation-result-invalid','invalid-model-spec','model-contract-mismatch'].includes(run.errorCode));
  for (const run of mismatches) section.append(element('p', `实验 ${run.runId} 的参数、指标或结果未通过契约校验，不能用于可信结论。请检查该次运行并修复模型。`, 'model-warning'));
  if (!model.canRun && !model.reasonCode) section.append(element('p', '模型说明已保存；当前运行环境尚未启用实验。', 'meta'));
  const raw = element('details'); raw.open = rawOpen; raw.ontoggle = () => toggleRaw(raw.open);
  raw.append(element('summary', '查看完整版本标识与原始模型说明'));
  raw.append(element('pre', JSON.stringify({version, spec}, null, 2))); section.append(raw);
  return section;
}
function createSimulationPanel({root,api,modelRoot=null,historyRoot=null,onModel}) {
  if(!root||typeof api!=='function')throw Error('invalid-simulation-panel');
  let context=null,model=null,experiments=[],pending=null,loading=false,message='',timer=null,posting=false,generation=0,readEpoch=0,draft={},seedValue=42,draftDirty=false,rawOpen=false;
  const keyFor=value=>`riffology:simulation-intent:${value.tenantId}:${value.workspaceId}`;
  const readPending=()=>{try{const value=JSON.parse(sessionStorage.getItem(keyFor(context))||'null');return value?.key&&value.body?value:null;}catch{return null;}};
  const savePending=value=>{try{if(value)sessionStorage.setItem(keyFor(context),JSON.stringify(value));else sessionStorage.removeItem(keyFor(context));}catch{}};
  const path=suffix=>`/api/workspaces/${encodeURIComponent(context.workspaceId)}${suffix}`;
  const params=(spec,filter=item=>!pending||Object.hasOwn(pending.body?.parameters||{},item.id))=>spec?.parameters&&typeof spec.parameters==='object'&&!Array.isArray(spec.parameters)?Object.entries(spec.parameters).map(([id,value])=>({id,...(value||{})})).filter(filter):[];
  const publicExperiment=value=>value&&id(value.experimentId)&&id(value.runId)&&STATUSES.has(value.status)?value:null;
  function render(){root.replaceChildren();const box=document.createElement('div');box.className='simulation-panel-inner';const title=document.createElement('h2');title.textContent='Experiment · 参数实验';const description=modelView(model,experiments,rawOpen,value=>{rawOpen=value;});if(modelRoot)modelRoot.replaceChildren(description);else box.append(description);if(modelRoot&&model?.spec?.researchQuestion)box.append(element('p',model.spec.researchQuestion,'research-question'));box.append(title);if(pending?.body){const frozen=document.createElement('p');frozen.className='meta simulation-pending';frozen.textContent=`待重试请求 · revision ${pending.body.revisionId} · files ${pending.body.filesSha256} · spec ${pending.body.specSha256} · seed ${pending.body.seed} · 参数 ${JSON.stringify(pending.body.parameters||{})}`;box.append(frozen);}const status=document.createElement('p');status.className='meta';status.textContent=message||(loading?'正在读取模型与实验…':model?.reasonCode?(MODEL_REASONS[model.reasonCode]||'当前模型暂不可运行。'):model?.version?'基于已保存版本运行参数实验。':'保存首个模型版本后可运行实验。');box.append(status);const refresh=document.createElement('button');refresh.type='button';refresh.className='button';refresh.textContent='刷新模型与实验';refresh.onclick=()=>void load();box.append(refresh);const form=document.createElement('form');form.className='simulation-form';
    const frozen=Boolean(pending);for(const item of params(model?.spec)){if(!id(item.id))continue;const label=document.createElement('label');label.textContent=item.title||item.name||item.id;let input;if(item.type==='enum'||Array.isArray(item.values)||Array.isArray(item.options)){input=document.createElement('select');for(const option of item.values||item.options)input.append(new Option(String(option.label??option),String(option.value??option)));}else{input=document.createElement('input');input.type=item.type==='integer'||item.type==='number'?'number':item.type==='boolean'?'checkbox':'text';if(item.minimum!==undefined||item.min!==undefined)input.min=item.minimum??item.min;input.step=item.type==='integer'?'1':'any';input.required=item.type!=='boolean';if(item.maximum!==undefined||item.max!==undefined)input.max=item.maximum??item.max;}const value=frozen&&pending.body?.parameters&&Object.hasOwn(pending.body.parameters,item.id)?pending.body.parameters[item.id]:Object.hasOwn(draft,item.id)?draft[item.id]:item.default;if(item.type==='boolean')input.checked=value===true;else input.value=value??'';input.name=item.id;input.disabled=frozen;const update=()=>{draft[item.id]=item.type==='boolean'?input.checked:input.value;draftDirty=true;};input.oninput=update;input.onchange=update;label.append(input);form.append(label);}
    const seed=document.createElement('input');seed.name='seed';seed.type='number';seed.min='0';seed.max='4294967295';seed.step='1';seed.required=true;seed.value=String(frozen&&pending.body?.seed!==undefined?pending.body.seed:seedValue);seed.disabled=frozen;seed.oninput=()=>{seedValue=Number(seed.value);draftDirty=true;};const seedLabel=document.createElement('label');seedLabel.textContent='Seed';seedLabel.append(seed);form.append(seedLabel);const actions=document.createElement('div');const reset=document.createElement('button');reset.type='button';reset.className='button';reset.textContent='恢复默认';reset.disabled=frozen;reset.onclick=()=>{draft=Object.fromEntries(params(model?.spec).map(item=>[item.id,item.default]));seedValue=42;draftDirty=true;render();};const run=document.createElement('button');run.type='submit';run.className='button primary';run.disabled=(!model?.canRun&&!pending)||loading||posting;run.textContent=pending?'重试实验':'运行实验';actions.append(reset,run);form.append(actions);form.onsubmit=e=>{e.preventDefault();void submit(new FormData(form));};box.append(form);const list=document.createElement('div');list.className='simulation-experiments';for(const item of experiments){const row=document.createElement('article');row.className='simulation-experiment';const text=document.createElement('span');text.textContent=`${item.status} · ${item.runId}${item.stale?' · 版本已变化':''} · 版本 ${item.version?.revisionId||'初始版本'} · seed ${item.seed} · 参数 ${JSON.stringify(item.parameters)}`;row.append(text);if(item.evidenceRejection)row.append(element('small',`已否定：${item.evidenceRejection.reason}；此 Run 不能作为有效结论。`,'model-warning'));if(item.errorCode)row.append(element('small',`运行未通过：${item.errorCode}`,'model-warning'));if(item.result?.metrics){const metrics=document.createElement('small');metrics.textContent=JSON.stringify(item.result.metrics);row.append(metrics);}if(!TERMINAL.has(item.status)){const cancel=document.createElement('button');cancel.type='button';cancel.className='button compact';cancel.textContent='停止';cancel.onclick=()=>void cancelRun(item.runId);row.append(cancel);}list.append(row);}if(historyRoot){historyRoot.replaceChildren(element('h2','单次实验记录'),list);const latest=experiments[0];if(latest){const summary=element('div',undefined,'latest-result');summary.append(element('h3','最近结果'),element('p',`${latest.status}${latest.stale?' · 旧版本结果':''} · 版本 ${latest.version?.revisionId??'初始版本'} · seed ${latest.seed}`));if(latest.evidenceRejection)summary.append(element('p',`已否定：${latest.evidenceRejection.reason}；此 Run 不能作为有效结论。`,'model-warning'));if(latest.result?.metrics)summary.append(element('p',JSON.stringify(latest.result.metrics)));box.append(summary);}}else if(experiments.length)box.append(list);root.append(box);}
  async function load(){
    const token=generation,current=context;if(!current)return;const epoch=++readEpoch;clearTimeout(timer);loading=true;render();
    const valid=()=>token===generation&&current===context&&epoch===readEpoch;
    try{const [m,e]=await Promise.all([api(path('/model')),api(path('/experiments'))]);if(!valid())return;
      const changed=model?.version&&(model.version.filesSha256!==m.version?.filesSha256||model.version.specSha256!==m.version?.specSha256);
      model=m;onModel?.(m);experiments=(e?.items||[]).map(publicExperiment).filter(Boolean);
      if(pending?.body){draft={...(pending.body.parameters||{})};seedValue=Number.isSafeInteger(pending.body.seed)?pending.body.seed:42;}
      else if(changed){draft={};draftDirty=false;seedValue=42;}
      else if(!draftDirty&&experiments[0]&&experiments[0].version?.filesSha256===m.version?.filesSha256){draft={...(experiments[0].parameters||{})};seedValue=Number.isSafeInteger(experiments[0].seed)?experiments[0].seed:42;}
      message='';
    }catch(error){if(valid())message=error.message||'Simulation 状态读取失败，请重试。';}
    finally{if(valid()){loading=false;render();schedulePoll();}}
  }
  function schedulePoll(){
    clearTimeout(timer);if(!context||loading||!experiments.some(item=>!TERMINAL.has(item.status)))return;
    const token=generation,current=context,epoch=readEpoch,valid=()=>token===generation&&current===context&&epoch===readEpoch;
    timer=setTimeout(async()=>{try{const e=await api(path('/experiments'));if(valid()){experiments=(e?.items||[]).map(publicExperiment).filter(Boolean);render();}}catch{}finally{if(valid())schedulePoll();}},1500);
  }
  async function submitPending(){if(!pending||loading||posting)return;posting=true;render();const token=generation,current=context,attempt=pending;try{const result=await api(path('/experiments'),{method:'POST',headers:{'Idempotency-Key':attempt.key},body:JSON.stringify(attempt.body),signal:AbortSignal.timeout(15000)});if(token!==generation||current!==context||pending!==attempt)return;savePending(null);pending=null;readEpoch++;loading=false;clearTimeout(timer);experiments=[publicExperiment(result),...experiments.filter(item=>item.runId!==result.runId)].filter(Boolean);message='实验已接收，状态会自动更新。';render();schedulePoll();}catch(error){if(token===generation&&current===context&&pending===attempt){message=error.message||'实验提交结果尚未确认，可使用同一请求重试。';const known=['simulation-input-invalid','invalid-model-spec','model-spec-missing','model-spec-invalid','model-contract-mismatch','model-dependencies-invalid','model-dependencies-unsupported'];if((error.status===400&&known.includes(error.code))||(error.status===409&&error.code==='simulation-model-stale')||(error.status===413&&error.code==='body_too_large')){savePending(null);pending=null;draft={...(attempt.body.parameters||{})};seedValue=Number.isSafeInteger(attempt.body.seed)?attempt.body.seed:42;draftDirty=true;}render();}}finally{if(token===generation&&current===context){posting=false;render();}}}
  async function submit(form){if(pending)return submitPending();if(!model?.canRun||!model.version)return;const parameters={};for(const item of params(model.spec)){const field=form.get(item.id);if(item.type==='boolean')parameters[item.id]=field!==null;else if(item.type==='integer'||item.type==='number')parameters[item.id]=Number(field);else parameters[item.id]=field;}if(!Number.isSafeInteger(seedValue)||seedValue<0||seedValue>4294967295||Object.values(parameters).some(value=>typeof value==='number'&&!Number.isFinite(value))){message='参数或 Seed 无效，请检查输入。';render();return;}pending={key:crypto.randomUUID(),body:{revisionId:model.version.revisionId,filesSha256:model.version.filesSha256,specSha256:model.version.specSha256,parameters,seed:seedValue}};savePending(pending);await submitPending();}
  async function cancelRun(runId){const token=generation,current=context;try{await api(`/api/workspaces/${encodeURIComponent(current.workspaceId)}/simulation-runs/${encodeURIComponent(runId)}/cancel`,{method:'POST',body:'{}'});if(token===generation&&current===context)await load();}catch(error){if(token===generation&&current===context){message=error.message||'停止请求尚未确认。';render();}}}
  async function enter(value){leave();if(!value||!id(value.tenantId)||!id(value.workspaceId))throw Error('invalid-simulation-context');context=value;generation++;pending=readPending();render();await load();}
  function leave(){generation++;clearTimeout(timer);timer=null;posting=false;context=null;model=null;experiments=[];pending=null;draft={};seedValue=42;draftDirty=false;rawOpen=false;root.replaceChildren();modelRoot?.replaceChildren();historyRoot?.replaceChildren();}
  return {enter,leave,reload:load};
}
export {createSimulationPanel};
