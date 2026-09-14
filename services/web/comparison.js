const TERMINAL = new Set(['completed', 'partial', 'failed', 'cancelled']);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const button = (text, action, disabled = false) => { const b = node('button', text, 'button'); b.type = 'button'; b.disabled = disabled; b.onclick = action; return b; };
const defaults = spec => Object.fromEntries(Object.entries(spec?.parameters || {}).map(([key, value]) => [key, value.default]));

export function createComparisonPanel({root, api}) {
  let context = null, generation = 0, readEpoch = 0, model = null, groups = [], cursor = null, pending = null, timer = null, busy = false, loading = false, message = '';
  let draft = null, editor, history, status, rawOpen = new Set();
  const storageKey = () => `riffology:comparison-intent:${context.tenantId}:${context.workspaceId}`;
  const path = suffix => `/api/workspaces/${encodeURIComponent(context.workspaceId)}${suffix}`;
  const freshDraft = () => ({hypothesis:'', baseline:{label:'基线', parameters:defaults(model?.spec)}, interventions:[{label:'干预 1', parameters:defaults(model?.spec)}], seeds:'42, 43, 44'});
  const active = () => groups.some(g => !TERMINAL.has(g.status));
  const persist = value => { try { if (value) sessionStorage.setItem(storageKey(), JSON.stringify(value)); else sessionStorage.removeItem(storageKey()); return true; } catch { return false; } };
  const mark = text => { message = text; if (status) status.textContent = message; };
  function setup() {
    root.replaceChildren(); root.append(node('h2', 'Compare · 对照实验'));
    root.append(node('p', '在同一保存版本上比较基线与干预。每个种子在所有配置中各运行一次，无需修改模型。'));
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
    if (!editor) return; editor.replaceChildren(); const frozen = !!pending;
    const refresh = button('刷新比较与模型', () => void load(), loading || busy); editor.append(refresh);
    if (pending) {
      editor.append(node('p', '提交结果尚未确认。已冻结原始参数、种子和版本；重试使用同一请求，不会创建新的实验意图。', 'model-warning'));
      const detail = node('details'); detail.append(node('summary', '待确认请求的版本与参数'), node('pre', JSON.stringify(pending.body, null, 2))); editor.append(detail);
      editor.append(button('重试同一比较', () => void submitPending(), loading || busy)); return;
    }
    if (!model?.spec || !model?.version) { editor.append(node('p','先保存完整模型说明，再建立对照实验。')); return; }
    if (!draft) draft = freshDraft();
    const form = node('form', undefined, 'comparison-form');
    const question = node('label', '研究假设'); const hypothesis = node('input'); hypothesis.name = 'hypothesis'; hypothesis.required = true; hypothesis.maxLength = 2000; hypothesis.value = draft.hypothesis; hypothesis.oninput = () => { draft.hypothesis = hypothesis.value; }; question.append(hypothesis); form.append(question);
    const configs = node('div', undefined, 'comparison-configs');
    for (const [index, config] of [draft.baseline, ...draft.interventions].entries()) {
      const fieldset = node('fieldset'); fieldset.dataset.configuration = index === 0 ? 'baseline' : `intervention-${index}`; fieldset.append(node('legend',index === 0 ? '基线' : `干预 ${index}`));
      const label = node('label','配置名称'); const name = node('input'); name.name='label'; name.required=true; name.maxLength=80; name.value=config.label; name.oninput=()=>{config.label=name.value;}; label.append(name); fieldset.append(label);
      for (const [key, def] of Object.entries(model.spec.parameters || {})) fieldset.append(typedField(key,def,config.parameters,frozen));
      if (index > 0 && draft.interventions.length > 1) fieldset.append(button('移除此干预',()=>{draft.interventions.splice(index-1,1);renderEditor();})); configs.append(fieldset);
    }
    form.append(configs);form.append(button('添加干预',()=>{draft.interventions.push({label:`干预 ${draft.interventions.length+1}`,parameters:defaults(model.spec)});renderEditor();},draft.interventions.length>=3));
    const seedLabel=node('label','随机种子（逗号或空格分隔，最多 20 个不重复整数）');const seeds=node('input');seeds.name='seeds';seeds.required=true;seeds.value=draft.seeds;const count=node('p',undefined,'comparison-count');const countSeeds=()=>{const n=draft.seeds.trim()?draft.seeds.trim().split(/[\s,，]+/).length:0;count.textContent=`每个配置重复 ${n} 次，共 ${(1+draft.interventions.length)*n} 个 Run；所有配置使用相同种子。`;};seeds.oninput=()=>{draft.seeds=seeds.value;countSeeds();};countSeeds();seedLabel.append(seeds);form.append(seedLabel,count);
    const actions=node('div',undefined,'comparison-actions');actions.append(button('恢复比较默认值',()=>{draft=freshDraft();renderEditor();}));const run=node('button','运行并比较','button primary');run.type='submit';run.disabled=loading||busy||!model.canRun;actions.append(run);form.append(actions);
    if(!model.canRun)form.append(node('p','当前模型或运行环境尚不可执行，请检查 Model 中的说明。','model-warning'));
    form.onsubmit=event=>{event.preventDefault();void submit();};editor.append(form);
  }
  function renderHistory() {
    if(!history)return;history.replaceChildren();history.append(node('h3','比较历史'));
    if(!groups.length)history.append(node('p','尚无已接收的比较实验。'));
    for(const group of groups){
      const article=node('article',undefined,'comparison-group');article.dataset.groupId=group.groupId;
      article.append(node('h3',group.hypothesis),node('p',`${group.status} · ${group.groupId}`),node('p',`版本 ${group.version?.revisionId??'初始模型'} · 每个配置 ${group.repetitions ?? group.seeds?.length} 次`));
      if(group.errorCode)article.append(node('p',`比较状态说明：${group.errorCode}`,'model-warning'));
      if(group.stale)article.append(node('p','模型版本已变化：这些结果属于旧版本，不能与当前模型直接合并。','model-warning'));
      const p=group.progress||{};article.append(node('p',`共 ${p.total??0} · 等待 ${p.pending??0} · 活跃 ${p.active??0} · 完成 ${p.completed??0} · 失败 ${p.failed??0} · 取消 ${p.cancelled??0}${p.rejected ? ` · 已否定 ${p.rejected}` : ''}`));
      if(p.rejected)article.append(node('p','已否定的运行已从比较汇总排除；执行完成不代表证据有效。','model-warning'));
      if(group.status==='partial'||group.status==='failed'||group.status==='cancelled')article.append(node('p','存在失败、取消或缺失运行；下表仅使用各配置已完成且通过契约校验的结果，请检查样本数。','model-warning'));
      const table=node('table');table.append(node('caption','结果比较（差值 = 干预均值 − 基线均值）'));const head=node('tr');for(const text of ['配置 / 指标','有效 / 缺失','均值','基线均值','差值'])head.append(node('th',text));table.append(head);
      const format=value=>typeof value==='number'&&Number.isFinite(value)?String(Number(value.toPrecision(6))):'—';
      for(const summary of group.summary||[])for(const [metric,value]of Object.entries(summary.metrics||{})){const row=node('tr'),config=group.configurations?.find(c=>c.configurationId===summary.configurationId);for(const text of [`${config?.label||summary.configurationId} / ${metric}${group.metrics?.[metric]?.unit?` (${group.metrics[metric].unit})`:''}`,`${value.count??0} / ${value.missing??0}${value.errorCode ? ` · ${value.errorCode}` : ''}`,format(value.mean),format(value.baselineMean),format(value.delta)])row.append(node('td',text));table.append(row);}
      const scroll=node('div',undefined,'comparison-table');scroll.append(table);article.append(scroll);
      if(!TERMINAL.has(group.status))article.append(button('停止此比较',()=>void cancel(group.groupId),busy));
      const detail=node('details');detail.open=rawOpen.has(group.groupId);detail.ontoggle=()=>{if(detail.open)rawOpen.add(group.groupId);else rawOpen.delete(group.groupId);};detail.append(node('summary',`查看 ${group.runs?.length??0} 个 Run 与证据`));
      for(const run of group.runs||[]){const row=node('section',undefined,'comparison-run');row.append(node('h4',`${run.configurationId} · Seed ${run.seed} · ${run.status}`),node('p',run.runId||'尚未分配 Run'));if(run.evidenceRejection)row.append(node('p',`已否定：${run.evidenceRejection.reason}`,'model-warning'));if(run.errorCode)row.append(node('p',`失败原因：${run.errorCode}`,'model-warning'));row.append(node('pre',JSON.stringify({runId:run.runId,version:group.version,configuration:group.configurations?.find(c=>c.configurationId===run.configurationId),seed:run.seed,status:run.status,errorCode:run.errorCode,result:run.result,released:run.released,evidenceRejection:run.evidenceRejection},null,2)));detail.append(row);}
      article.append(detail);history.append(article);
    }
    if(cursor)history.append(button('加载更早的比较',()=>void loadMore(),loading));
  }
  function schedule() {
    clearTimeout(timer);if(!context||loading||!active())return;const token=generation,epoch=readEpoch,valid=()=>token===generation&&epoch===readEpoch;
    timer=setTimeout(async()=>{try{const updates=await Promise.all(groups.filter(g=>!TERMINAL.has(g.status)).map(g=>api(path(`/experiment-groups/${encodeURIComponent(g.groupId)}`))));if(!valid())return;for(const item of updates)groups=groups.map(g=>g.groupId===item.groupId?item:g);renderHistory();}catch{if(valid())mark('比较状态暂时无法更新；可刷新读取，已接收的实验不会重新提交。');}finally{if(valid())schedule();}},1500);
  }
  async function load() {
    if(!context)return;const token=generation,epoch=++readEpoch,valid=()=>token===generation&&epoch===readEpoch;clearTimeout(timer);loading=true;renderEditor();
    try{const [m,page]=await Promise.all([api(path('/model')),api(path('/experiment-groups'))]);if(!valid())return;
      if(draft&&model?.version&&(model.version.filesSha256!==m.version?.filesSha256||model.version.specSha256!==m.version?.specSha256)){draft=null;mark('保存的模型已变化，未提交的比较参数已恢复新版本默认值。');}
      model=m;groups=(page.items||[]).filter(g=>safeId(g.groupId));cursor=page.nextCursor||null;
    }catch(error){if(valid())mark(error.message||'无法读取比较，请刷新重试。');}finally{if(valid()){loading=false;renderEditor();renderHistory();schedule();}}
  }
  async function loadMore(){
    if(!cursor||loading)return;const token=generation,epoch=++readEpoch,valid=()=>token===generation&&epoch===readEpoch;clearTimeout(timer);loading=true;renderHistory();
    try{const page=await api(path(`/experiment-groups?before=${encodeURIComponent(cursor)}`));if(!valid())return;groups=[...groups,...(page.items||[]).filter(g=>safeId(g.groupId)&&!groups.some(old=>old.groupId===g.groupId))];cursor=page.nextCursor||null;}catch(error){if(valid())mark(error.message||'历史读取失败');}finally{if(valid()){loading=false;renderHistory();schedule();}}
  }
  async function submit(){
    if(pending)return submitPending();if(busy||loading||!model?.canRun)return;
    const seeds=draft.seeds.trim()?draft.seeds.trim().split(/[\s,，]+/).map(Number):[];
    if(!draft.hypothesis.trim()||!seeds.length||seeds.length>20||new Set(seeds).size!==seeds.length||seeds.some(s=>!Number.isSafeInteger(s)||s<0||s>4294967295)){mark('请输入研究假设与 1–20 个不重复的有效 Seed（0–4294967295）。');return;}
    const labels=[draft.baseline,...draft.interventions].map(c=>c.label.trim());if(labels.some(label=>!label)||new Set(labels).size!==labels.length){mark('每个配置需要不同的非空名称。');return;}
    const body={...model.version,hypothesis:draft.hypothesis.trim(),baseline:structuredClone(draft.baseline),interventions:structuredClone(draft.interventions),seeds};
    const attempt={key:crypto.randomUUID(),body};if(!persist(attempt)){mark('无法保存重试凭据，请允许此页面使用会话存储后再提交。');return;}pending=attempt;await submitPending();
  }
  async function submitPending(){if(!pending||busy||loading)return;const token=generation,attempt=pending;busy=true;renderEditor();try{
    const group=await api(path('/experiment-groups'),{method:'POST',headers:{'Idempotency-Key':attempt.key},body:JSON.stringify(attempt.body),signal:AbortSignal.timeout(15000)});
    if(token!==generation)return;if(!safeId(group?.groupId))throw Error('比较接收结果无效；请重试同一请求确认。');persist(null);pending=null;groups=[group,...groups.filter(g=>g.groupId!==group.groupId)];mark('比较已接收；可离开后重新读取，运行不会因刷新而重复。');
  }catch(error){if(token!==generation)return;mark(error.message||'提交结果尚未确认，请重试同一比较。');const known=['simulation-input-invalid','invalid-model-spec','model-spec-missing','model-spec-invalid','model-contract-mismatch','model-dependencies-invalid','model-dependencies-unsupported'];if(error.status===400&&known.includes(error.code)||error.status===409&&error.code==='simulation-model-stale'||error.status===413&&error.code==='body_too_large'){persist(null);pending=null;draft=null;mark(`${message} 请刷新模型后重新建立比较。`);model=null;}}
    finally{if(token===generation){busy=false;renderEditor();renderHistory();schedule();}}
  }
  async function cancel(groupId){if(busy)return;const token=generation;busy=true;renderHistory();try{await api(path(`/experiment-groups/${encodeURIComponent(groupId)}/cancel`),{method:'POST',body:'{}',signal:AbortSignal.timeout(15000)});if(token===generation){mark('停止请求已接收；等待运行释放状态。');await load();}}catch(error){if(token===generation)mark(error.message||'停止结果尚未确认，可再次停止。');}finally{if(token===generation){busy=false;renderHistory();}}}
  async function enter(value){leave();if(!safeId(value?.tenantId)||!safeId(value?.workspaceId))throw Error('invalid-comparison-context');context=value;try{const saved=JSON.parse(sessionStorage.getItem(storageKey())||'null');if(saved?.key&&saved?.body)pending=saved;}catch{}setup();await load();}
  function leave(){generation++;clearTimeout(timer);context=null;model=null;groups=[];cursor=null;pending=null;busy=false;loading=false;draft=null;message='';rawOpen=new Set();root.replaceChildren();editor=history=status=null;}
  return {enter,leave,reload:load};
}
