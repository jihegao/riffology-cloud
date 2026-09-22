import {browserPreviewRequest} from './browser-preview.js';
import {t} from './i18n.js';
import {bindText} from './i18n-bindings.js';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const MAX_BYTES = 16_384;
const canonical = value => value && typeof value === 'object' && !Array.isArray(value)
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : JSON.stringify(value);

export function createVerifyHandoffPanel({root, api, onVerified = () => {}, requestTimeoutMs = 15_000}) {
  if (!root || typeof api !== 'function' || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw Error('invalid-verify-handoff-panel');
  const win = root.ownerDocument.defaultView;
  const requests = new Set();
  const nodes = {};
  let context = null, draft = null, storageBlocked = false, submitting = false, recovering = false, messageKey = '', generation = 0;
  const key = () => `riffology:browser-preview:verify:${context.tenantId}:${context.projectId}:${context.workspaceId}`;
  const handoffKey = () => `${key()}:handoff`;
  const validBase = value => value && value.intent === 'experiment' && id(value.revisionId) && hash(value.packageIdentity)
    && Number.isInteger(value.seed) && value.seed >= 0 && value.seed <= 4294967295
    && value.parameters && typeof value.parameters === 'object' && !Array.isArray(value.parameters)
    && Object.keys(value.parameters).length <= 64
    && Object.entries(value.parameters).every(([name, item]) => id(name) && (typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= Number.MAX_SAFE_INTEGER || typeof item === 'string' && item.length <= 1024));
  const validPending = value => validBase(value) && Object.keys(value).sort().join(',') === 'idempotencyKey,intent,packageIdentity,parameters,revisionId,seed' && id(value.idempotencyKey);
  const validDraft = value => validBase(value) && Object.keys(value).sort().join(',') === 'intent,packageIdentity,parameters,revisionId,seed';
  function read(storageKey, validator) {
    try {
      const text = win.sessionStorage.getItem(storageKey);
      if (text === null) return {value: null};
      if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return {error: true};
      const value = JSON.parse(text);
      return validator(value) ? {value} : {error: true};
    } catch { return {error: true}; }
  }
  function write(storageKey, value) {
    try {
      if (value) {
        const text = JSON.stringify(value);
        if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw Error('oversized-verify-intent');
        win.sessionStorage.setItem(storageKey, text);
      } else win.sessionStorage.removeItem(storageKey);
    }
    catch { throw Error('verifyHandoff.storageFailed'); }
  }
  const request = (url, options = {}) => browserPreviewRequest(api, url, options, requests, {requestTimeoutMs});
  const status = () => context?.canVerify !== true && draft ? t('verifyHandoff.disabled') : messageKey ? t(messageKey) : !draft ? t('verifyHandoff.empty') : t('verifyHandoff.ready');
  const buttonText = () => submitting ? t('verifyHandoff.submitting') : draft?.idempotencyKey ? t('verifyHandoff.retry') : t('verifyHandoff.submit');
  function updateButton() { if (nodes.button) { nodes.button.disabled = storageBlocked || submitting || recovering || context?.canVerify !== true; bindText(nodes.button, buttonText); } if (nodes.status) bindText(nodes.status, status); }
  function render() {
    root.replaceChildren(); Object.keys(nodes).forEach(key => delete nodes[key]);
    const section = root.ownerDocument.createElement('section'); section.className = 'verify-handoff';
    nodes.title = root.ownerDocument.createElement('h2'); bindText(nodes.title, 'verifyHandoff.title'); section.append(nodes.title);
    nodes.status = root.ownerDocument.createElement('p'); nodes.status.className = 'meta'; nodes.status.setAttribute('role', 'status'); bindText(nodes.status, status); section.append(nodes.status);
    if (draft) {
      const boundary = root.ownerDocument.createElement('p'); bindText(boundary, 'verifyHandoff.boundary'); section.append(boundary);
      nodes.frozen = root.ownerDocument.createElement('p'); nodes.frozen.className = 'meta'; bindText(nodes.frozen, () => t('verifyHandoff.frozen', {revisionId: draft.revisionId, packageIdentity: draft.packageIdentity.slice(0, 12), seed: draft.seed, parameters: JSON.stringify(draft.parameters)})); section.append(nodes.frozen);
      nodes.button = root.ownerDocument.createElement('button'); nodes.button.type = 'button'; nodes.button.className = 'button primary'; nodes.button.dataset.verifyHandoffAction = 'submit'; section.append(nodes.button); updateButton();
    }
    root.append(section);
  }
  async function recover() {
    if (!draft?.idempotencyKey || storageBlocked || recovering) return;
    const current = draft, token = generation, scope = context; recovering = true; updateButton();
    try {
      const value = await request(`/api/workspaces/${encodeURIComponent(scope.workspaceId)}/browser-preview/verify/${encodeURIComponent(current.idempotencyKey)}`);
      if (token !== generation || scope !== context || draft !== current) return;
      const {idempotencyKey, ...captured} = current;
      if (value?.status === 'accepted' && value.verificationId === idempotencyKey && value.experiment && canonical(value.captured) === canonical(captured)) {
        write(handoffKey(), null); write(key(), null); draft = null; messageKey = 'verifyHandoff.recovered'; onVerified(value); render();
      }
    } catch { if (token === generation && scope === context) { messageKey = 'verifyHandoff.unconfirmed'; render(); } }
    finally { if (token === generation && scope === context) { recovering = false; updateButton(); } }
  }
  async function submit() {
    if (!draft || storageBlocked || submitting || recovering || context?.canVerify !== true) return;
    let current = draft;
    try {
      if (!validPending(current)) { current = {...draft, idempotencyKey: win.crypto.randomUUID()}; write(key(), current); draft = current; write(handoffKey(), null); }
    } catch (error) { messageKey = error.message; render(); return; }
    const token = generation, scope = context; submitting = true; updateButton();
    try {
      const value = await request(`/api/workspaces/${encodeURIComponent(scope.workspaceId)}/browser-preview/verify`, {method: 'POST', headers: {'Idempotency-Key': current.idempotencyKey}, body: JSON.stringify(current)});
      if (token !== generation || scope !== context || draft !== current) return;
      const {idempotencyKey, ...captured} = current;
      if (!value || value.verificationId !== idempotencyKey || !value.experiment || canonical(value.captured) !== canonical(captured)) throw Error('receipt');
      write(handoffKey(), null); write(key(), null); draft = null; messageKey = 'verifyHandoff.accepted'; onVerified(value); render();
    } catch { if (token === generation && scope === context && draft === current) { messageKey = 'verifyHandoff.unconfirmed'; render(); } }
    finally { if (token === generation && scope === context) { submitting = false; updateButton(); } }
  }
  function handoff(value) {
    if (!context || context.canVerify !== true || storageBlocked || !validDraft(value)) return false;
    if (draft?.idempotencyKey) { messageKey = 'verifyHandoff.pending'; render(); return true; }
    try { const next = structuredClone(value); write(handoffKey(), next); draft = next; messageKey = 'verifyHandoff.created'; render(); return true; }
    catch (error) { messageKey = error.message; render(); return false; }
  }
  function enter(value) {
    leave(); if (!value || !id(value.tenantId) || !id(value.projectId) || !id(value.workspaceId)) throw Error('invalid-verify-handoff-context');
    context = {...value, canVerify: false}; generation++;
    const pending = read(key(), validPending);
    if (pending.error) { storageBlocked = true; messageKey = 'verifyHandoff.storageFailed'; }
    else if (pending.value) draft = pending.value;
    else { const saved = read(handoffKey(), validDraft); storageBlocked = Boolean(saved.error); draft = saved.value; if (storageBlocked) messageKey = 'verifyHandoff.storageFailed'; }
    render(); void recover();
  }
  function setCanVerify(value) { if (context) { context.canVerify = value === true; updateButton(); } }
  function leave() { generation++; for (const controller of requests) controller.abort(); requests.clear(); context = null; draft = null; storageBlocked = submitting = recovering = false; messageKey = ''; root.replaceChildren(); }
  root.addEventListener('click', event => { const button = event.target.closest('[data-verify-handoff-action=submit]'); if (button && !button.disabled) void submit(); });
  return {enter, leave, handoff, recover, setCanVerify, dispose: leave};
}
