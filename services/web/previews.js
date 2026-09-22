import {errorMessage,msg} from './i18n.js';
import {bindAttribute,bindValue} from './i18n-bindings.js';
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
  function button(text, action, disabled = false) { const b = doc.createElement('button'); b.type = 'button'; bindValue(b,text); b.dataset.previewAction = action; b.disabled = disabled; return b; }
  function render() {
    if (!context) return;
    root.hidden=context.paused;if(context.paused){controls.replaceChildren();return;}
    const title = doc.createElement('h3'); bindValue(title,()=>msg('preview.title'));
    const status = doc.createElement('p'); status.setAttribute('role', 'status');
    bindValue(status,()=>message || (loading ? msg('preview.loading') : !context.canOpen ? msg('preview.unavailable') : selected ? msg('preview.selected',()=>({runId:selected})) : msg('preview.selectRun')));
    const note = doc.createElement('p'); bindValue(note,()=>msg('preview.note'));
    const pending = intent(),healthy=autoRestore&&frame&&!loading&&(!message||String(message)===String(msg('preview.connected')));
    controls.classList.toggle('preview-connected-controls',Boolean(healthy));status.hidden=Boolean(healthy);
    controls.replaceChildren(title, status, note);if(autoRestore){bindValue(status,()=>message||(loading?msg('preview.restoring'):state?.available?msg('preview.available'):state?.current?msg('preview.stoppedAvailable'):msg('preview.none')));bindValue(note,()=>msg('preview.note'));note.hidden=Boolean(frame);}
    if (pending) { const p = doc.createElement('p'); bindValue(p,()=>msg('preview.pending',()=>({runId:pending.body.runId}))); controls.append(p); }
    if (state?.current && !autoRestore) { const p = doc.createElement('p'); bindValue(p,()=>msg('preview.current',()=>({previewId:state.current.previewId}))); controls.append(p); }
    if(!autoRestore||pending||(selected&&!frame&&!state?.available))controls.append(button(()=>pending&&autoRestore?msg('preview.retry'):autoRestore?msg('preview.connect'):msg('preview.open'),'open',busy||loading||!context.canOpen||(!selected&&!pending)));const refresh=button(()=>msg('preview.refresh'),'refresh',busy||loading||!context.canOpen);if(autoRestore&&frame&&!String(message).includes(String(msg('preview.failedWord')))){const details=doc.createElement('details'),summary=doc.createElement('summary');bindValue(summary,()=>msg('preview.options'));details.append(summary,refresh);controls.append(details);}else controls.append(refresh);
    if (state?.available && (!autoRestore || !frame)) controls.append(button(()=>msg('preview.recover'), 'recover', busy || !context.canOpen));
    if (frame) controls.append(button(()=>msg('preview.close'), 'close'));
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
    let value; try { value = target(raw); } catch { removeFrame(); message = msg('preview.invalidTarget'); render(); return; }
    if(stoppedRuns.has(value.runId)||awaitingRunId&&awaitingRunId!==value.runId)return;
    if(automatic&&(closed()===value.previewId||awaitingRunId&&awaitingRunId!==value.runId))return;if(!automatic)rememberClosed(null);awaitingRunId=null;
    removeFrame(); const token = generation, fv = frameVersion, scope = context, origin = new URL(value.bootstrapUrl).origin;
    const node = doc.createElement('iframe'); frame = node; shownPreviewId = value.previewId; bindAttribute(node,'title','preview.iframeTitle'); node.sandbox.value = 'allow-scripts allow-same-origin allow-forms'; node.referrerPolicy = 'no-referrer';
    let handedOff = false;
    const active = () => generation === token && frameVersion === fv && frame === node;
    listener = async event => {
      if (!active() || event.source !== node.contentWindow || event.origin !== origin) return;
      if (event.data?.type === 'riffology-preview-error') { message = msg('preview.connectionFailed'); render(); return; }
      if (handedOff || event.data?.type !== 'riffology-preview-ready' || !nonce(event.data.nonce)) return;
      handedOff = true;
      try {
        const result = await request(`${path(scope)}/${value.previewId}/tickets`, { method: 'POST', body: JSON.stringify({ nonce: event.data.nonce }) });
        if (!active()) return;
        if (!nonce(result?.ticket) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now() || result.expiresAt > Math.min(value.expiresAt, Date.now() + 30000)) throw Error('invalid-preview-ticket');
        node.contentWindow.postMessage({ type: 'riffology-preview-ticket', ticket: result.ticket }, origin);
        message = autoRestore?msg('preview.connected'):msg('preview.handedOff'); render();
      } catch { if (active()) { message = msg('preview.connectionFailed'); render(); } }
    };
    win.addEventListener('message', listener); node.src = value.bootstrapUrl; frames.append(node);
    expiryTimer = setTimeout(() => { if (active()) { removeFrame(); if (state) state.available = null; message = msg('preview.expired'); render(); } }, Math.min(2147483647, value.expiresAt - Date.now()));
    render();
  }
  async function load() {
    if (!context?.canOpen || busy) return;
    if (loadingPromise) return loadingPromise;
    const token = generation, v = ++version, scope = context;
    loading = true; render();
    const task = (async () => {
    try { const result = snapshot(await request(path(scope))); if (token !== generation || v !== version) return;if(result.available&&stoppedRuns.has(result.available.runId))result.available=null; state = result; if(frame && result.available?.previewId !== shownPreviewId)removeFrame(); if (!selected) selected = intent()?.body.runId || result.available?.runId || result.current?.runId || null; message = '';if(!awaitingRunId||result.available?.runId===awaitingRunId)onState?.(result);if(autoRestore&&result.available&&!frame&&!intent())showTarget(result.available,true); }
    catch (error) { if (token === generation && v === version) { state = null; removeFrame(); message = error.name === 'TimeoutError' ? msg('preview.loadTimeout') : error?.status && error.status < 500 ? msg('preview.loadError',()=>({message:errorMessage(error)})) : msg('preview.loadFailed'); } }
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
      try { save(pending); } catch { message = msg('preview.storageFailed'); return; }
      submitted = true;
      const result = await request(path(scope), { method: 'POST', headers: { 'Idempotency-Key': pending.key }, body: JSON.stringify(pending.body) });
      if (token !== generation) return;
      const available = target(result); if (available.runId !== pending.body.runId) throw Error('preview-run-mismatch');
      save(null);if(v!==version||stoppedRuns.has(available.runId)||awaitingRunId&&awaitingRunId!==available.runId)return; state = { current: { previewId: available.previewId, runId: available.runId, expiresAt: available.expiresAt, revokedAt: null }, available }; message = ''; showTarget(available);
    } catch (error) {
      if (token !== generation) return;
      if (!submitted) message = error?.status === 503 ? msg('preview.serviceUnavailable') : error?.name === 'TimeoutError' ? msg('preview.openTimeout') : msg('preview.loadFailed');
      else if (error?.status === 409) { try { save(null); } catch {} message = msg('preview.stateChanged'); }
      else if (error?.status && error.status < 500) message = msg('preview.openError',()=>({message:errorMessage(error)}));
      else message = msg('preview.unconfirmed');
    } finally { if (token === generation) { busy = false; render();if(queuedOpenRun&&!intent()){const next=queuedOpenRun;queuedOpenRun=null;void openRun(next);} } }
  }
  function click(event) {
    const b = event.target.closest?.('[data-preview-action]'); if (!b || !root.contains(b) || b.disabled) return;
    const action = b.dataset.previewAction;
    if (action === 'open') void open(); else if (action === 'refresh') void load(); else if (action === 'recover') showTarget(state?.available); else if (action === 'close') { if(autoRestore)rememberClosed(shownPreviewId);removeFrame(); message = msg('preview.closed'); render(); }
  }
  function leave() { root.hidden=true;generation++; version++; removeFrame(); for (const c of requests) c.abort(); requests.clear(); context = null; selected = null;awaitingRunId=null;stoppedRuns=new Set();queuedOpenRun=null; state = null; message = ''; busy = false; loading = false; loadingPromise = null; root.removeEventListener('click', click); root.replaceChildren(); }
  async function enter(value) { leave(); if (!value || !id(value.tenantId) || !id(value.workspaceId)) throw Error('invalid-preview-context'); context = { tenantId: value.tenantId, workspaceId: value.workspaceId, canOpen: value.canOpen === true&&value.paused!==true, paused:value.paused===true }; selected = intent()?.body.runId || null; root.append(controls, frames); root.addEventListener('click', click); render(); await load(); }
  function selectRun(runId) { selected = id(runId) ? runId : null; render(); }
  async function openRun(runId) { if(busy||intent()&&intent().body.runId!==runId){queuedOpenRun=runId;return;}selectRun(runId); if (!selected) return; const token = generation; if (loadingPromise) await loadingPromise; if (token !== generation || selected !== runId) return; await open(); }
  async function restoreRun(runId){if(!context||!id(runId))return;const token=generation;if(loadingPromise)await loadingPromise;if(token!==generation||stoppedRuns.has(runId)||intent()||closed()&&closed()===state?.current?.previewId)return;if(state?.available){if(state.available.runId===runId&&!frame)showTarget(state.available,true);return;}if(state?.current&&state.current.runId!==runId)return;selectRun(runId);await open();}
  function invalidateRead(){version++;loading=false;loadingPromise=null;}
  function stoppedRun(runId){if(!id(runId))return;stoppedRuns.add(runId);if(selected===runId||state?.available?.runId===runId||state?.current?.runId===runId){invalidateRead();removeFrame();if(state)state.available=null;message=msg('preview.runStopped');render();}}
  function prepareRun(runId){if(!context||!id(runId))return;invalidateRead();awaitingRunId=runId;removeFrame();message=msg('preview.preparingRun');render();}
  return { enter, leave, selectRun, openRun, restoreRun, stoppedRun,prepareRun };
}
