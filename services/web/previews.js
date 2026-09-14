const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const nonce = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function createPreviewPanel({ root, api, requestTimeoutMs = 15000, autoRestore = false, onState }) {
  if (!root || typeof api !== 'function' || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw Error('invalid-preview-panel');
  const doc = root.ownerDocument, win = doc.defaultView;
  const controls = doc.createElement('div'), frames = doc.createElement('div'), requests = new Set();
  let context = null, generation = 0, version = 0, selected = null, state = null, message = '', busy = false, loading = false, loadingPromise = null;
  let frame = null, shownPreviewId = null, frameVersion = 0, expiryTimer = null, listener = null, awaitingRunId=null,stoppedRuns=new Set(),queuedOpenRun=null;
  const closedKey=()=>`riffology:preview-closed:${context.tenantId}:${context.workspaceId}`;
  const closed=()=>{try{return win.sessionStorage.getItem(closedKey());}catch{return null;}};
  const rememberClosed=value=>{try{if(value)win.sessionStorage.setItem(closedKey(),value);else win.sessionStorage.removeItem(closedKey());}catch{}};
  const storageKey = value => `riffology:preview-intent:${value.tenantId}:${value.workspaceId}`;
  const path = value => `/api/workspaces/${encodeURIComponent(value.workspaceId)}/previews`;
  function intent() {
    try { const v = JSON.parse(win.sessionStorage.getItem(storageKey(context)) || 'null');
      return v && Object.keys(v).length === 2 && id(v.key) && v.body && Object.keys(v.body).length === 2 && id(v.body.runId) && (v.body.expectedPreviewId === null || id(v.body.expectedPreviewId)) ? v : null;
    } catch { return null; }
  }
  function save(value) { if (value) win.sessionStorage.setItem(storageKey(context), JSON.stringify(value)); else win.sessionStorage.removeItem(storageKey(context)); }
  function target(value) {
    if (!value || !id(value.previewId) || !id(value.runId) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now()) throw Error('invalid-preview-target');
    const url = new URL(value.bootstrapUrl);
    if (url.href !== value.bootstrapUrl || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/__riff/bootstrap' || !/^p-[a-f0-9]{40}\./.test(url.hostname) || url.origin === win.location.origin) throw Error('invalid-preview-target');
    return { previewId: value.previewId, runId: value.runId, expiresAt: value.expiresAt, bootstrapUrl: url.href };
  }
  function snapshot(value) {
    if (!value || !Object.hasOwn(value, 'current') || !Object.hasOwn(value, 'available')) throw Error('invalid-preview-state');
    const c = value.current;
    if (c !== null && (!c || !id(c.previewId) || !id(c.runId) || !Number.isSafeInteger(c.expiresAt) || c.expiresAt <= 0 || !(c.revokedAt === null || Number.isSafeInteger(c.revokedAt) && c.revokedAt > 0))) throw Error('invalid-preview-state');
    return { current: c, available: value.available === null ? null : target(value.available) };
  }
  function button(text, action, disabled = false) { const b = doc.createElement('button'); b.type = 'button'; b.textContent = text; b.dataset.previewAction = action; b.disabled = disabled; return b; }
  function render() {
    if (!context) return;
    const title = doc.createElement('h3'); title.textContent = '项目预览';
    const status = doc.createElement('p'); status.setAttribute('role', 'status');
    status.textContent = message || (loading ? '正在读取预览状态…' : !context.canOpen ? '项目尚未就绪，暂不可打开预览。' : selected ? `已选择服务：${selected}` : '请从上方选择一个运行中的服务。');
    const note = doc.createElement('p'); note.textContent = '关闭预览只关闭当前视图，服务会继续运行。';
    const pending = intent(),healthy=autoRestore&&frame&&!loading&&(!message||message==='模型预览已连接。');
    controls.classList.toggle('preview-connected-controls',Boolean(healthy));status.hidden=Boolean(healthy);
    controls.replaceChildren(title, status, note);if(autoRestore){status.textContent=message||(loading?'正在恢复模型预览…':state?.available?'已有交互模型，可在此继续观察。':state?.current?'交互模型已停止或不可访问；已保存结果仍可查看，重新运行需明确操作。':'还没有交互预览。运行已保存模型后会显示在这里。');note.textContent='预览与已保存结果属于各自的模型版本。';if(frame)note.hidden=true;else note.hidden=false;}
    if (pending) { const p = doc.createElement('p'); p.textContent = `待确认的打开请求：${pending.body.runId}；重试会使用原请求。`; controls.append(p); }
    if (state?.current && !autoRestore) { const p = doc.createElement('p'); p.textContent = `当前预览：${state.current.previewId}`; controls.append(p); }
    if(!autoRestore||pending||(selected&&!frame&&!state?.available))controls.append(button(pending&&autoRestore?'重试原预览请求':autoRestore?'连接运行中的模型':'打开预览','open',busy||loading||!context.canOpen||(!selected&&!pending)));const refresh=button('刷新预览状态','refresh',busy||loading||!context.canOpen);if(autoRestore&&frame&&!message.includes('失败')){const details=doc.createElement('details'),summary=doc.createElement('summary');summary.textContent='预览选项';details.append(summary,refresh);controls.append(details);}else controls.append(refresh);
    if (state?.available && (!autoRestore || !frame)) controls.append(button('恢复预览', 'recover', busy || !context.canOpen));
    if (frame) controls.append(button('关闭预览', 'close'));
  }
  async function request(url, options = {}) {
    const controller = new AbortController(); requests.add(controller); let timer, onAbort;
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason || Object.assign(Error('preview-panel-aborted'), { name: 'AbortError' }));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => controller.abort(Object.assign(Error('preview-panel-timeout'), { name: 'TimeoutError' })), requestTimeoutMs);
    });
    try { return await Promise.race([Promise.resolve().then(() => api(url, { ...options, signal: controller.signal })), cancelled]); }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); requests.delete(controller); }
  }
  function removeFrame() {
    frameVersion++; clearTimeout(expiryTimer); expiryTimer = null;
    if (listener) win.removeEventListener('message', listener); listener = null;
    frames.replaceChildren(); frame = null; shownPreviewId = null;
  }
  function showTarget(raw,automatic=false) {
    if (!context?.canOpen) return;
    let value; try { value = target(raw); } catch { removeFrame(); message = '预览地址无效或已过期，请刷新。'; render(); return; }
    if(stoppedRuns.has(value.runId)||awaitingRunId&&awaitingRunId!==value.runId)return;
    if(automatic&&(closed()===value.previewId||awaitingRunId&&awaitingRunId!==value.runId))return;if(!automatic)rememberClosed(null);awaitingRunId=null;
    removeFrame(); const token = generation, fv = frameVersion, scope = context, origin = new URL(value.bootstrapUrl).origin;
    const node = doc.createElement('iframe'); frame = node; shownPreviewId = value.previewId; node.title = '项目预览'; node.sandbox.value = 'allow-scripts allow-same-origin allow-forms'; node.referrerPolicy = 'no-referrer';
    let handedOff = false;
    const active = () => generation === token && frameVersion === fv && frame === node;
    listener = async event => {
      if (!active() || event.source !== node.contentWindow || event.origin !== origin) return;
      if (event.data?.type === 'riffology-preview-error') { message = '预览连接失败，请恢复预览后重试。'; render(); return; }
      if (handedOff || event.data?.type !== 'riffology-preview-ready' || !nonce(event.data.nonce)) return;
      handedOff = true;
      try {
        const result = await request(`${path(scope)}/${value.previewId}/tickets`, { method: 'POST', body: JSON.stringify({ nonce: event.data.nonce }) });
        if (!active()) return;
        if (!nonce(result?.ticket) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now() || result.expiresAt > Math.min(value.expiresAt, Date.now() + 30000)) throw Error('invalid-preview-ticket');
        node.contentWindow.postMessage({ type: 'riffology-preview-ticket', ticket: result.ticket }, origin);
        message = autoRestore?'模型预览已连接。':'已交接预览访问，请查看下方页面。'; render();
      } catch { if (active()) { message = '预览连接失败，请恢复预览后重试。'; render(); } }
    };
    win.addEventListener('message', listener); node.src = value.bootstrapUrl; frames.append(node);
    expiryTimer = setTimeout(() => { if (active()) { removeFrame(); if (state) state.available = null; message = '预览已过期，请刷新状态。'; render(); } }, Math.min(2147483647, value.expiresAt - Date.now()));
    render();
  }
  async function load() {
    if (!context?.canOpen || busy) return;
    if (loadingPromise) return loadingPromise;
    const token = generation, v = ++version, scope = context;
    loading = true; render();
    const task = (async () => {
    try { const result = snapshot(await request(path(scope))); if (token !== generation || v !== version) return;if(result.available&&stoppedRuns.has(result.available.runId))result.available=null; state = result; if(frame && result.available?.previewId !== shownPreviewId)removeFrame(); if (!selected) selected = intent()?.body.runId || result.available?.runId || result.current?.runId || null; message = '';if(!awaitingRunId||result.available?.runId===awaitingRunId)onState?.(result);if(autoRestore&&result.available&&!frame&&!intent())showTarget(result.available,true); }
    catch (error) { if (token === generation && v === version) { state = null; removeFrame(); message = error.name === 'TimeoutError' ? '读取预览超时。' : error?.status && error.status < 500 ? `无法读取预览：${error.message}` : '读取预览失败，请重试。'; } }
    finally { if (token === generation && v === version) { loading = false; render(); } }
    })();
    loadingPromise = task;
    try { return await task; }
    finally { if (loadingPromise === task) loadingPromise = null; }
  }
  async function open() {
    if (!context?.canOpen || busy || loading || (!selected && !intent())) return;
    const token = generation, scope = context, runId = selected, v=++version; let submitted = false; busy = true; render();
    try {
      const latest = snapshot(await request(path(scope))); if (token !== generation||v!==version||stoppedRuns.has(runId)) return; state = latest;
      const pending = intent() || { key: crypto.randomUUID(), body: { runId, expectedPreviewId: latest.current?.previewId ?? null } };
      try { save(pending); } catch { message = '无法保存打开请求，请检查浏览器存储后重试。'; return; }
      submitted = true;
      const result = await request(path(scope), { method: 'POST', headers: { 'Idempotency-Key': pending.key }, body: JSON.stringify(pending.body) });
      if (token !== generation) return;
      const available = target(result); if (available.runId !== pending.body.runId) throw Error('preview-run-mismatch');
      save(null);if(v!==version||stoppedRuns.has(available.runId)||awaitingRunId&&awaitingRunId!==available.runId)return; state = { current: { previewId: available.previewId, runId: available.runId, expiresAt: available.expiresAt, revokedAt: null }, available }; message = ''; showTarget(available);
    } catch (error) {
      if (token !== generation) return;
      if (!submitted) message = error?.status === 503 ? '读取预览失败：服务暂不可用，请稍后重试。' : error?.name === 'TimeoutError' ? '读取预览超时，请重试。' : '读取预览失败，请重试。';
      else if (error?.status === 409) { try { save(null); } catch {} message = '状态已变化，请刷新后重试。'; }
      else if (error?.status && error.status < 500) message = `无法打开预览：${error.message}`;
      else message = '启动结果尚未确认，可使用同一请求重试。';
    } finally { if (token === generation) { busy = false; render();if(queuedOpenRun&&!intent()){const next=queuedOpenRun;queuedOpenRun=null;void openRun(next);} } }
  }
  function click(event) {
    const b = event.target.closest?.('[data-preview-action]'); if (!b || !root.contains(b) || b.disabled) return;
    const action = b.dataset.previewAction;
    if (action === 'open') void open(); else if (action === 'refresh') void load(); else if (action === 'recover') showTarget(state?.available); else if (action === 'close') { if(autoRestore)rememberClosed(shownPreviewId);removeFrame(); message = '已关闭预览视图，服务未停止。'; render(); }
  }
  function leave() { generation++; version++; removeFrame(); for (const c of requests) c.abort(); requests.clear(); context = null; selected = null;awaitingRunId=null;stoppedRuns=new Set();queuedOpenRun=null; state = null; message = ''; busy = false; loading = false; loadingPromise = null; root.removeEventListener('click', click); root.replaceChildren(); }
  async function enter(value) { leave(); if (!value || !id(value.tenantId) || !id(value.workspaceId)) throw Error('invalid-preview-context'); context = { tenantId: value.tenantId, workspaceId: value.workspaceId, canOpen: value.canOpen === true }; selected = intent()?.body.runId || null; root.append(controls, frames); root.addEventListener('click', click); render(); await load(); }
  function selectRun(runId) { selected = id(runId) ? runId : null; render(); }
  async function openRun(runId) { if(busy||intent()&&intent().body.runId!==runId){queuedOpenRun=runId;return;}selectRun(runId); if (!selected) return; const token = generation; if (loadingPromise) await loadingPromise; if (token !== generation || selected !== runId) return; await open(); }
  async function restoreRun(runId){if(!context||!id(runId))return;const token=generation;if(loadingPromise)await loadingPromise;if(token!==generation||stoppedRuns.has(runId)||intent()||closed()&&closed()===state?.current?.previewId)return;if(state?.available){if(state.available.runId===runId&&!frame)showTarget(state.available,true);return;}if(state?.current&&state.current.runId!==runId)return;selectRun(runId);await open();}
  function invalidateRead(){version++;loading=false;loadingPromise=null;}
  function stoppedRun(runId){if(!id(runId))return;stoppedRuns.add(runId);if(selected===runId||state?.available?.runId===runId||state?.current?.runId===runId){invalidateRead();removeFrame();if(state)state.available=null;message='交互模型已停止，参数与已保存结果仍可查看。重新运行需明确操作。';render();}}
  function prepareRun(runId){if(!context||!id(runId))return;invalidateRead();awaitingRunId=runId;removeFrame();message='新模型正在准备；确认运行后将显示新版本。';render();}
  return { enter, leave, selectRun, openRun, restoreRun, stoppedRun,prepareRun };
}
