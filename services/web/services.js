import {errorMessage,formatDate,msg} from './i18n.js';
import {bindValue} from './i18n-bindings.js';
const terminalRuns = new Set(['stopped', 'failed', 'cancelled']);
const deliveryLabels = Object.fromEntries(['resolving','ready','delivery-unknown','delivered','cancelled','failed'].map(value=>[value,msg(`service.delivery.${value}`)]));
const runLabels = Object.fromEntries(['queued','starting','running','unknown','stopping','stopped','failed','cancelled'].map(value=>[value,msg(`service.run.${value}`)]));
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function createServicePanel({ root, inspectRoot = null, api, onPreviewRun, onState, onPreparingRun, workspaceMode = false, requestTimeoutMs = 15000 }) {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw Error('invalid-service-request-timeout');
  const doc = root.ownerDocument;
  let current = null, generation = 0, listVersion = 0, detailVersion = 0, rows = [], cursor = null, selected = null, detail = null, savedRevision = null;
  let listError = '', listLoading = false, detailError = '', message = '', pending = null, posting = false, stopping = false, duration = 300000, timer = null, listening = false;
  const reads = new Set(), requests = new Set();
  let previewNotified=null,explicitPreview=false,inspectionDetail=null,inspectionError='',inspectVersion=0;
  const keyFor = context => `riffology:service-intent:${context.tenantId}:${context.workspaceId}`;
  const base = context => `/api/workspaces/${encodeURIComponent(context.workspaceId)}/services`;
  function save(context, value) { try { if (value) sessionStorage.setItem(keyFor(context), JSON.stringify(value)); else sessionStorage.removeItem(keyFor(context)); } catch { return false; } return true; }
  function restore(context) { try { const value = JSON.parse(sessionStorage.getItem(keyFor(context)) || 'null'); return value && id(value.key) && [60000, 300000, 900000].includes(value.maxDurationMs) ? value : null; } catch { return null; } }
  function element(tag, text, action) { const el = doc.createElement(tag); if (text!==undefined&&text!==null) bindValue(el,text); if (action) { el.type = 'button'; el.dataset.serviceAction = action; } return el; }
  function button(text, action, disabled = false) { const el = element('button', text, action); el.disabled = disabled; return el; }
  function clearTimer() { clearTimeout(timer); timer = null; }
  function isSettled(value) { return value && (terminalRuns.has(value.runStatus) || ['cancelled', 'failed'].includes(value.deliveryStatus)); }
  function render() {
    if (!current) return;
    const heading = element('h3',workspaceMode?msg('service.workspaceTitle'):msg('service.title')),note=element('p',workspaceMode?msg('service.workspaceNote'):msg('service.note'));
    const controls = element('div'), select = element('select'); select.dataset.serviceDuration = ''; select.setAttribute('aria-label', String(msg('service.duration')));
    for (const [value, label] of [[60000, 'service.duration1'], [300000, 'service.duration5'], [900000, 'service.duration15']]) { const option = element('option', msg(label)); option.value = String(value); select.append(option); }
    select.value = String(pending?.maxDurationMs ?? duration); select.disabled = Boolean(pending) || posting || !current.canStart;
    if(workspaceMode){const durationBox=element('details');durationBox.dataset.inspectOnly='';durationBox.append(element('summary',msg('service.duration')),select);controls.append(durationBox);}else controls.append(select);controls.append(button(()=>pending?msg('service.retryStart'):workspaceMode?msg('service.workspaceStart'):msg('service.start'),'start',posting||!current.canStart),button(()=>workspaceMode?msg('service.workspaceRefresh'):msg('service.refresh'),'refresh'));
    const status = element('p', message || (!current.canStart ? msg('service.cannotStart') : '')); status.setAttribute('role', 'status');
    const list = element('ul');
    for (const row of rows) { const item = element('li'), choose = button(msg('service.row',()=>({runId:row.runId,delivery:String(deliveryLabels[row.deliveryStatus] || msg('service.deliveryUnknown')),run:String(runLabels[row.runStatus] || msg('service.runUnknown'))})), 'select'); choose.dataset.runId = row.runId; item.append(choose); list.append(item); }
    const contents=[heading,note,controls,status,element('p',listError||(listLoading?msg('service.loading'):rows.length?'':workspaceMode?msg('service.noneWorkspace'):msg('service.none')))];if(workspaceMode){const history=element('details');history.className='workspace-service-details';history.dataset.inspectOnly='';history.append(element('summary',msg('service.history')),list);contents.push(history);}else contents.push(list);
    if (cursor) contents.push(button(msg('service.more'), 'more'));
    if (selected) {
      const box = element('section'); box.append(element('h4',workspaceMode?msg('service.currentRun'):msg('service.detail',()=>({runId:selected}))));
      box.append(element('p', detailError || (detail ? msg('service.detailStatus',()=>({delivery:String(deliveryLabels[detail.deliveryStatus]||msg('service.deliveryUnknown')),run:String(runLabels[detail.runStatus]||msg('service.runUnknown'))})) : msg('service.detailLoading'))));
      if(detail?.version)box.append(element('p',msg('service.version',()=>({revisionId:detail.version.revisionId,hash:detail.version.filesSha256.slice(0,12)}))));
      if (detail?.updatedAt) box.append(element('p',msg(detailError?'service.confirmedOld':'service.confirmedAt',()=>({time:formatDate(new Date(detail.updatedAt),{dateStyle:'medium',timeStyle:'medium',hour12:false})}))));
      if (!detailError && detail?.stopRequestedAt) box.append(element('p', terminalRuns.has(detail.runStatus) ? msg('service.stopConfirmed') : msg('service.stopRequested')));
      if (detail?.errorCode) box.append(element('p', msg('service.runError')));
      if (detail?.version?.filesSha256 && savedRevision?.filesSha256 && detail.version.filesSha256 !== savedRevision.filesSha256) box.append(element('p',msg('service.oldRevision')));
      box.append(button(msg('service.refreshDetail'),'detail'),button(stopping?msg('service.stopping'):workspaceMode?msg('service.stop'):msg('service.stopService'),'stop',stopping||Boolean(!detailError&&detail&&isSettled(detail))));
      if(onPreviewRun&&!workspaceMode)box.append(button(msg('service.openPreview'),'preview',!current.canStart||Boolean(detailError)||detail?.runStatus!=='running'||Boolean(detail?.stopRequestedAt)));
      contents.push(box);
    }
    if(workspaceMode){
      if(selected)controls.append(button(stopping?msg('service.stopping'):msg('service.stop'),'stop',stopping||Boolean(!detailError&&detail&&isSettled(detail))));
      const workspaceText=detail?msg('service.workspaceState',()=>({run:String(runLabels[detail.runStatus]||msg('service.runUnknown')),revision:detail.version?.revisionId?` · ${String(msg('service.versionShort',()=>({revisionId:detail.version.revisionId})))}`:'',message:message?` · ${String(message)}`:''})):message||(!current.canStart?msg('service.workspacePaused'):listLoading?msg('service.restoring'):msg('service.noInteractive'));
      const currentState=element('p',detailError||listError||workspaceText);currentState.setAttribute('role','status');
      const diagnostics=element('details');diagnostics.dataset.inspectOnly='';diagnostics.className='workspace-service-details';diagnostics.open=inspectRoot?.querySelector('details')?.open??false;diagnostics.append(element('summary',msg('service.diagnostics')),list);if(cursor)diagnostics.append(button(msg('service.more'),'more',listLoading));if(inspectionError)diagnostics.append(element('p',inspectionError));const inspected=inspectionDetail??detail;if(inspected){diagnostics.append(element('p',inspectionDetail?msg('service.historyDetail'):msg('service.currentPreviewRun')),element('pre',JSON.stringify(inspected,null,2)));}
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
    catch (error) { if (generation !== token || version !== listVersion || error.name === 'AbortError') return; listError = error?.status && error.status < 500 ? errorMessage(error) : msg('service.listFailed'); }
    finally { if (generation === token && version === listVersion) { listLoading = false; render(); } }
  }
  function schedule() { clearTimer(); if (current && selected && !doc.hidden && (detailError || !isSettled(detail))) timer = setTimeout(() => refreshDetail(), 3000); }
  async function refreshDetail() {
    if (!current || !selected || doc.hidden) return; clearTimer(); const token = generation, version = ++detailVersion, runId = selected;
    try { const value = await read(`${base(current)}/${encodeURIComponent(runId)}`); if (token !== generation || version !== detailVersion || selected !== runId) return; detail = value; detailError = '';if(workspaceMode&&isSettled(value))message=''; }
    catch (error) { if (token !== generation || version !== detailVersion || error.name === 'AbortError') return; detailError = error?.status && error.status < 500 ? msg('service.detailError',()=>({message:errorMessage(error)})) : msg('service.stateUnknown'); }
    render();if(workspaceMode&&!detailError&&detail){onState?.(detail,savedRevision);if(detail.runStatus==='running'&&!detail.stopRequestedAt&&previewNotified!==selected){previewNotified=selected;onPreviewRun?.(selected,{automatic:!explicitPreview});explicitPreview=false;}}schedule();
  }
  async function start() {
    if (!current?.canStart || posting) return; const context = current, token = generation; posting=true;render();
    if (!pending) { let saved;try{saved=await read(`/api/workspaces/${encodeURIComponent(context.workspaceId)}/files`);}catch{if(token===generation){posting=false;message=msg('service.savedRevisionUnknown');render();}return;}if(token!==generation)return;pending = { key: crypto.randomUUID(), maxDurationMs: duration,...(saved.revision?.revisionId?{expectedRevisionId:saved.revision.revisionId}:{}) }; if (!save(context, pending)) { message = msg('service.storageFailed'); pending = null; posting=false;render(); return; } }
    const attempt = pending; posting = true; message = msg('service.submitting'); render();
    try { const result = await request(base(context), { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify({ maxDurationMs: attempt.maxDurationMs,...(attempt.expectedRevisionId?{expectedRevisionId:attempt.expectedRevisionId}:{}) }) });
      if (restore(context)?.key === attempt.key) save(context, null); if (token !== generation) return; pending = null; message = msg('service.startAccepted'); selected = result.runId;if(workspaceMode)onPreparingRun?.(selected);explicitPreview=true;previewNotified=null; detail = result; detailError = ''; await load(); await refreshDetail();
    } catch (error) {
      if (token !== generation) return;
      if (error?.status === 409 && error.code === 'service_revision_changed') {
        if (restore(context)?.key === attempt.key) save(context, null);
        pending = null;
        message = msg('service.revisionChanged');
      } else message = error?.status && error.status < 500 ? msg('service.startError',()=>({message:errorMessage(error)})) : msg('service.startUnconfirmed');
    }
    finally { if (token === generation) { posting = false; render(); } }
  }
  async function stop() {
    if (!current || !selected || stopping) return; const token = generation, runId = selected, context = current; detailVersion++; clearTimer(); stopping = true; render();
    try { const result = await request(`${base(context)}/${encodeURIComponent(runId)}/stop`, { method: 'POST', body: '{}' }); if (token !== generation || runId !== selected) return; detail = result; detailError = ''; message = msg('service.stopRequested');if(workspaceMode)onState?.(result,savedRevision); }
    catch (error) { if (token === generation && runId === selected) { detailError = error?.status && error.status < 500 ? msg('service.stopError',()=>({message:errorMessage(error)})) : msg('service.stopUnconfirmed'); } }
    finally { if (token === generation) { stopping = false; render(); schedule(); } }
  }
  function click(event) { const target = event.target.closest?.('[data-service-action]'); if (!target || (!root.contains(target)&&!inspectRoot?.contains(target)) || target.disabled) return; const action = target.dataset.serviceAction; if(action==='preview'){if(current?.canStart&&!detailError&&detail?.runStatus==='running'&&!detail?.stopRequestedAt)onPreviewRun?.(selected);} else if (action === 'start') void start(); else if (action === 'refresh') { void load(); if(workspaceMode&&selected)void refreshDetail(); } else if (action === 'more') void load(true); else if (action === 'detail') void refreshDetail(); else if (action === 'stop') void stop(); else if (action === 'select'&&workspaceMode) { void inspectRun(target.dataset.runId); } else if (action === 'select') { selected = target.dataset.runId; detail = null; detailError = ''; render(); void refreshDetail(); } }
  async function inspectRun(runId){
    if(!current||!id(runId))return;const token=generation,version=++inspectVersion;inspectionError='';
    try{const value=await read(`${base(current)}/${encodeURIComponent(runId)}`);if(token!==generation||version!==inspectVersion)return;inspectionDetail=value;}catch(error){if(token!==generation||version!==inspectVersion)return;inspectionError=errorMessage(error)||String(msg('service.historyFailed'));}render();
  }
  function change(event) { if (event.target.matches?.('[data-service-duration]') && !pending) duration = Number(event.target.value); }
  function visibility() { clearTimer(); if (doc.hidden) { detailVersion++; for (const controller of reads) controller.abort(); } else if (selected) void refreshDetail(); }
  function close() { generation++; listVersion++; detailVersion++; current = null; clearTimer(); for (const controller of requests) controller.abort(); requests.clear(); reads.clear(); if (listening) { root.removeEventListener('click', click); root.removeEventListener('change', change);inspectRoot?.removeEventListener('click',click);inspectRoot?.removeEventListener('change',change); doc.removeEventListener('visibilitychange', visibility); listening = false; } root.replaceChildren();inspectRoot?.replaceChildren(); }
  function open(context) { close(); current = { ...context };previewNotified=null;explicitPreview=false;inspectionDetail=null;inspectionError='';inspectVersion++; savedRevision = null; rows = []; cursor = null; selected = null; detail = null; listError = ''; detailError = ''; pending = restore(current); posting = false; stopping = false; message = pending ? msg('service.pendingStart') : ''; if (!listening) { root.addEventListener('click', click); root.addEventListener('change', change);inspectRoot?.addEventListener('click',click);inspectRoot?.addEventListener('change',change); doc.addEventListener('visibilitychange', visibility); listening = true; } render(); return load(); }
  function updateSavedRevision(workspaceId, revision) { if (current?.workspaceId !== workspaceId) return; savedRevision = revision && typeof revision === 'object' ? { ...revision } : null; render();if(workspaceMode&&detail)onState?.(detail,savedRevision); }
  function selectRun(runId){if(!current||!id(runId)||selected===runId)return;selected=runId;detail=null;detailError='';void refreshDetail();}
  return { open, close, savedRevision: updateSavedRevision,selectRun };
}
