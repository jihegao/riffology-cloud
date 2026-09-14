const terminalRuns = new Set(['stopped', 'failed', 'cancelled']);
const deliveryLabels = { resolving: '正在准备', ready: '等待交付', 'delivery-unknown': '交付状态未知', delivered: '已交付', cancelled: '已取消', failed: '准备失败' };
const runLabels = { queued: '排队中', starting: '启动中', running: '运行中', unknown: '运行状态未知', stopping: '停止中', stopped: '已停止', failed: '运行失败', cancelled: '已取消' };
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function createServicePanel({ root, inspectRoot = null, api, onPreviewRun, onState, onPreparingRun, workspaceMode = false, requestTimeoutMs = 15000 }) {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw Error('invalid-service-request-timeout');
  const doc = root.ownerDocument;
  let current = null, generation = 0, listVersion = 0, detailVersion = 0, rows = [], cursor = null, selected = null, detail = null, savedRevision = null;
  let listError = '', listLoading = false, detailError = '', message = '', pending = null, posting = false, stopping = false, duration = 300000, timer = null, listening = false;
  const reads = new Set(), requests = new Set();
  let previewNotified=null,explicitPreview=false;
  const keyFor = context => `riffology:service-intent:${context.tenantId}:${context.workspaceId}`;
  const base = context => `/api/workspaces/${encodeURIComponent(context.workspaceId)}/services`;
  function save(context, value) { try { if (value) sessionStorage.setItem(keyFor(context), JSON.stringify(value)); else sessionStorage.removeItem(keyFor(context)); } catch { return false; } return true; }
  function restore(context) { try { const value = JSON.parse(sessionStorage.getItem(keyFor(context)) || 'null'); return value && id(value.key) && [60000, 300000, 900000].includes(value.maxDurationMs) ? value : null; } catch { return null; } }
  function element(tag, text, action) { const el = doc.createElement(tag); if (text) el.textContent = text; if (action) { el.type = 'button'; el.dataset.serviceAction = action; } return el; }
  function button(text, action, disabled = false) { const el = element('button', text, action); el.disabled = disabled; return el; }
  function clearTimer() { clearTimeout(timer); timer = null; }
  function isSettled(value) { return value && (terminalRuns.has(value.runStatus) || ['cancelled', 'failed'].includes(value.deliveryStatus)); }
  function render() {
    if (!current) return;
    const heading = element('h3',workspaceMode?'交互模型':'服务'),note=element('p',workspaceMode?'运行已保存模型，不会调用建模助手。关闭页面不会停止正在运行的模型。':'服务使用已保存的项目版本。关闭页面不会停止服务；停止请求需等待运行端确认。');
    const controls = element('div'), select = element('select'); select.dataset.serviceDuration = ''; select.setAttribute('aria-label', '服务运行时限');
    for (const [value, label] of [[60000, '1 分钟'], [300000, '5 分钟'], [900000, '15 分钟']]) { const option = element('option', label); option.value = String(value); select.append(option); }
    select.value = String(pending?.maxDurationMs ?? duration); select.disabled = Boolean(pending) || posting || !current.canStart;
    if(workspaceMode){const durationBox=element('details');durationBox.dataset.inspectOnly='';durationBox.append(element('summary','运行时限'),select);controls.append(durationBox);}else controls.append(select);controls.append(button(pending?'重试启动':workspaceMode?'运行已保存模型':'启动服务','start',posting||!current.canStart),button(workspaceMode?'刷新状态':'刷新列表','refresh'));
    const status = element('p', message || (!current.canStart ? '当前不可新建服务，仍可查看和停止已有服务。' : '')); status.setAttribute('role', 'status');
    const list = element('ul');
    for (const row of rows) { const item = element('li'), choose = button(`${row.runId} · ${deliveryLabels[row.deliveryStatus] || '交付状态未知'} · ${runLabels[row.runStatus] || '运行状态待查询'}`, 'select'); choose.dataset.runId = row.runId; item.append(choose); list.append(item); }
    const contents=[heading,note,controls,status,element('p',listError||(listLoading?'正在读取运行记录…':rows.length?'':workspaceMode?'尚未运行交互模型。':'暂无服务记录。'))];if(workspaceMode){const history=element('details');history.className='workspace-service-details';history.dataset.inspectOnly='';history.append(element('summary','交互运行记录'),list);contents.push(history);}else contents.push(list);
    if (cursor) contents.push(button('加载更多', 'more'));
    if (selected) {
      const box = element('section'); box.append(element('h4',workspaceMode?'当前模型运行':`服务详情 ${selected}`));
      box.append(element('p', detailError || (detail ? `${deliveryLabels[detail.deliveryStatus] || '交付状态未知'}；${runLabels[detail.runStatus] || '尚未确认运行状态'}` : '正在读取详情…')));
      if(detail?.version)box.append(element('p',`模型版本：${detail.version.revisionId} · ${detail.version.filesSha256.slice(0,12)}`));
      if (detail?.updatedAt) box.append(element('p', `${detailError ? '上次确认时间（旧状态）' : '最近确认时间'}：${new Date(detail.updatedAt).toLocaleString('zh-CN', { hour12: false })}`));
      if (!detailError && detail?.stopRequestedAt) box.append(element('p', terminalRuns.has(detail.runStatus) ? '运行端已确认结束。' : '已请求停止，等待运行端确认。'));
      if (detail?.errorCode) box.append(element('p', '服务发生错误，请刷新详情。'));
      if (detail?.version?.filesSha256 && savedRevision?.filesSha256 && detail.version.filesSha256 !== savedRevision.filesSha256) box.append(element('p', '项目已保存新版本；此服务仍使用旧版本，请启动新服务预览更新。'));
      box.append(button('刷新详情','detail'),button(stopping?'正在请求停止…':workspaceMode?'停止':'停止服务','stop',stopping||Boolean(!detailError&&detail&&isSettled(detail))));
      if(onPreviewRun&&!workspaceMode)box.append(button('打开此服务的 Preview','preview',!current.canStart||Boolean(detailError)||detail?.runStatus!=='running'||Boolean(detail?.stopRequestedAt)));
      contents.push(box);
    }
    if(workspaceMode){
      if(selected)controls.append(button(stopping?'正在停止…':'停止','stop',stopping||Boolean(!detailError&&detail&&isSettled(detail))));
      const currentState=element('p',detailError||listError||(detail?`${runLabels[detail.runStatus]||'正在恢复运行状态'}${detail.version?.revisionId?` · 模型版本：${detail.version.revisionId}`:''}${message?` · ${message}`:''}`:message|| (listLoading?'正在恢复模型状态…':'尚无交互预览；可运行已保存模型。')));currentState.setAttribute('role','status');
      const diagnostics=element('details');diagnostics.dataset.inspectOnly='';diagnostics.className='workspace-service-details';diagnostics.append(element('summary','交互运行记录与诊断'),list);if(detail)diagnostics.append(element('pre',JSON.stringify(detail,null,2)));
      if(inspectRoot){const durationBox=controls.querySelector('[data-inspect-only]');if(durationBox)diagnostics.append(durationBox);inspectRoot.replaceChildren(diagnostics);root.replaceChildren(controls,currentState);}else root.replaceChildren(controls,currentState,diagnostics);return;
    }
    root.replaceChildren(...contents);
  }
  async function request(path, options = {}, isRead = false) {
    const controller = new AbortController(); requests.add(controller); if (isRead) reads.add(controller);
    let timeout, onAbort;
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason?.name === 'TimeoutError' ? controller.signal.reason : Object.assign(new Error('service-request-aborted'), { name: 'AbortError' }));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(() => controller.abort(Object.assign(new Error('service-request-timeout'), { name: 'TimeoutError' })), requestTimeoutMs);
    });
    try { return await Promise.race([Promise.resolve().then(() => api(path, { ...options, signal: controller.signal })), cancelled]); }
    finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', onAbort); requests.delete(controller); reads.delete(controller); }
  }
  function read(path) { return request(path, {}, true); }
  async function load(more = false) {
    if (!current) return; const context = current, token = generation, version = ++listVersion; listLoading = true; render();
    let path = base(context); if (more && cursor) path += `?before_created_at=${cursor.createdAt}&before_run_id=${encodeURIComponent(cursor.runId)}`;
    try { const value = await read(path); if (generation !== token || version !== listVersion) return; rows = more ? [...new Map([...rows, ...value.items].map(row => [row.runId, row])).values()] : value.items; cursor = value.nextCursor; listError = '';if(workspaceMode&&!selected&&rows.length){selected=(rows.find(row=>row.runStatus==='running')||rows.find(row=>!isSettled(row))||rows[0]).runId;void refreshDetail();} }
    catch (error) { if (generation !== token || version !== listVersion || error.name === 'AbortError') return; listError = error?.status && error.status < 500 ? error.message : '列表读取失败，请刷新重试。'; }
    finally { if (generation === token && version === listVersion) { listLoading = false; render(); } }
  }
  function schedule() { clearTimer(); if (current && selected && !doc.hidden && (detailError || !isSettled(detail))) timer = setTimeout(() => refreshDetail(), 3000); }
  async function refreshDetail() {
    if (!current || !selected || doc.hidden) return; clearTimer(); const token = generation, version = ++detailVersion, runId = selected;
    try { const value = await read(`${base(current)}/${encodeURIComponent(runId)}`); if (token !== generation || version !== detailVersion || selected !== runId) return; detail = value; detailError = '';if(workspaceMode&&isSettled(value))message=''; }
    catch (error) { if (token !== generation || version !== detailVersion || error.name === 'AbortError') return; detailError = error?.status && error.status < 500 ? `无法读取服务：${error.message}` : '当前运行状态未知：读取失败，将重试。'; }
    render();if(workspaceMode&&!detailError&&detail){onState?.(detail,savedRevision);if(detail.runStatus==='running'&&!detail.stopRequestedAt&&previewNotified!==selected){previewNotified=selected;onPreviewRun?.(selected,{automatic:!explicitPreview});explicitPreview=false;}}schedule();
  }
  async function start() {
    if (!current?.canStart || posting) return; const context = current, token = generation; posting=true;render();
    if (!pending) { let saved;try{saved=await read(`/api/workspaces/${encodeURIComponent(context.workspaceId)}/files`);}catch{if(token===generation){posting=false;message='无法确认已保存版本，请刷新后重试。';render();}return;}if(token!==generation)return;pending = { key: crypto.randomUUID(), maxDurationMs: duration,...(saved.revision?.revisionId?{expectedRevisionId:saved.revision.revisionId}:{}) }; if (!save(context, pending)) { message = '无法保存启动请求，请检查浏览器存储后重试。'; pending = null; posting=false;render(); return; } }
    const attempt = pending; posting = true; message = '正在提交启动请求…'; render();
    try { const result = await request(base(context), { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify({ maxDurationMs: attempt.maxDurationMs,...(attempt.expectedRevisionId?{expectedRevisionId:attempt.expectedRevisionId}:{}) }) });
      if (restore(context)?.key === attempt.key) save(context, null); if (token !== generation) return; pending = null; message = '启动请求已接收，运行状态请查看详情。'; selected = result.runId;if(workspaceMode)onPreparingRun?.(selected);explicitPreview=true;previewNotified=null; detail = result; detailError = ''; await load(); await refreshDetail();
    } catch (error) {
      if (token !== generation) return;
      if (error?.status === 409 && error.code === 'service_revision_changed') {
        if (restore(context)?.key === attempt.key) save(context, null);
        pending = null;
        message = '项目已保存新版本，原启动请求已失效；请重新启动服务预览更新。';
      } else message = error?.status && error.status < 500 ? `无法启动服务：${error.message}` : '启动结果尚未确认。重试将使用同一请求和原运行时限。';
    }
    finally { if (token === generation) { posting = false; render(); } }
  }
  async function stop() {
    if (!current || !selected || stopping) return; const token = generation, runId = selected, context = current; detailVersion++; clearTimer(); stopping = true; render();
    try { const result = await request(`${base(context)}/${encodeURIComponent(runId)}/stop`, { method: 'POST', body: '{}' }); if (token !== generation || runId !== selected) return; detail = result; detailError = ''; message = '停止请求已接收，等待运行端确认。';if(workspaceMode)onState?.(result,savedRevision); }
    catch (error) { if (token === generation && runId === selected) { detailError = error?.status && error.status < 500 ? `无法停止服务：${error.message}` : '停止结果尚未确认，请重试停止并刷新详情。'; } }
    finally { if (token === generation) { stopping = false; render(); schedule(); } }
  }
  function click(event) { const target = event.target.closest?.('[data-service-action]'); if (!target || (!root.contains(target)&&!inspectRoot?.contains(target)) || target.disabled) return; const action = target.dataset.serviceAction; if(action==='preview'){if(current?.canStart&&!detailError&&detail?.runStatus==='running'&&!detail?.stopRequestedAt)onPreviewRun?.(selected);} else if (action === 'start') void start(); else if (action === 'refresh') { void load(); if(workspaceMode&&selected)void refreshDetail(); } else if (action === 'more') void load(true); else if (action === 'detail') void refreshDetail(); else if (action === 'stop') void stop(); else if (action === 'select') { selected = target.dataset.runId; detail = null; detailError = ''; render(); void refreshDetail(); } }
  function change(event) { if (event.target.matches?.('[data-service-duration]') && !pending) duration = Number(event.target.value); }
  function visibility() { clearTimer(); if (doc.hidden) { detailVersion++; for (const controller of reads) controller.abort(); } else if (selected) void refreshDetail(); }
  function close() { generation++; listVersion++; detailVersion++; current = null; clearTimer(); for (const controller of requests) controller.abort(); requests.clear(); reads.clear(); if (listening) { root.removeEventListener('click', click); root.removeEventListener('change', change);inspectRoot?.removeEventListener('click',click);inspectRoot?.removeEventListener('change',change); doc.removeEventListener('visibilitychange', visibility); listening = false; } root.replaceChildren();inspectRoot?.replaceChildren(); }
  function open(context) { close(); current = { ...context };previewNotified=null;explicitPreview=false; savedRevision = null; rows = []; cursor = null; selected = null; detail = null; listError = ''; detailError = ''; pending = restore(current); posting = false; stopping = false; message = pending ? '存在未确认的启动请求，请使用原请求重试。' : ''; if (!listening) { root.addEventListener('click', click); root.addEventListener('change', change);inspectRoot?.addEventListener('click',click);inspectRoot?.addEventListener('change',change); doc.addEventListener('visibilitychange', visibility); listening = true; } render(); return load(); }
  function updateSavedRevision(workspaceId, revision) { if (current?.workspaceId !== workspaceId) return; savedRevision = revision && typeof revision === 'object' ? { ...revision } : null; render();if(workspaceMode&&detail)onState?.(detail,savedRevision); }
  function selectRun(runId){if(!current||!id(runId)||selected===runId)return;selected=runId;detail=null;detailError='';void refreshDetail();}
  return { open, close, savedRevision: updateSavedRevision,selectRun };
}
