import {createPublicationPanel} from './publication.js';
import {applyTranslations,errorMessage,formatDate,formatNumber,getLocale,installLocaleSelector,msg,setLocale,t,uiError} from './i18n.js';
import {bindAttribute,bindValue} from './i18n-bindings.js';
import {createLocalePreferenceController} from './locale-preference.js';
const $ = selector => document.querySelector(selector);
const publicationPanel=createPublicationPanel({root:$('#model-submissions'),api,admin:true});
const notice = $('#notice');
let authenticated = false;
let operatorUserId=null;
let operator = false;
let loading = false;
let issueIntent = null;
let modelIntent = null;
const modelActionIntents = new Map();
const modelUploadIntents = new Map();
let viewGeneration = 0;

function show(message, error = false) {
  bindValue(notice, message);
  notice.className = `notice${error ? ' error' : ''}`;
  notice.hidden = !String(message ?? '');
}

const localeStatus = $('#locale-status');
const localePreferences = createLocalePreferenceController({
  read: () => api('/api/me/locale'),
  write: locale => api('/api/me/locale', {method:'PUT', body:JSON.stringify({locale})}),
  currentLocale: getLocale,
  applyLocale: locale => { setLocale(locale); applyTranslations(); },
  onSaveFailure: () => { if (localeStatus) bindValue(localeStatus, msg('locale.saveFailed')); },
  onSaveSuccess: () => { if (localeStatus) bindValue(localeStatus, ''); },
});
installLocaleSelector({onChange: locale => localePreferences.select(locale)});

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const messages = { 400: 'admin.error.invalidInput', 401: 'admin.error.signInRequired', 403: 'admin.error.originRejected', 404: 'admin.error.noAdminAccess', 409: 'admin.error.retryMismatch', 503: 'admin.error.unavailable' };
    let code;
    try { code = (await response.json())?.error; } catch {}
    const key = code === 'not_ready' ? 'admin.error.modelNotReady' : messages[response.status] || 'admin.error.requestFailed';
    throw Object.assign(uiError(key), { status: response.status, code });
  }
  return response.status === 204 ? null : response.json();
}

function accountView() {
  $('#admin-login').hidden = authenticated;
  $('#admin-denied').hidden = !authenticated || operator;
  $('#admin-app').hidden = !operator;
  if(operator&&operatorUserId)publicationPanel.enter({workspaceId:'admin',userId:operatorUserId});else publicationPanel.leave();
  $('#sign-out').hidden = !authenticated;
}

function textCell(value) {
  const cell = document.createElement('td');
  cell.textContent = String(value ?? '—');
  return cell;
}

function platformCell(value) {
  const cell = document.createElement('td');
  bindValue(cell, value);
  return cell;
}

function statusCell(value) {
  const cell = document.createElement('td');
  const badge = document.createElement('span');
  const allowed = new Set(['active', 'suspended', 'deleting', 'pending', 'accepted', 'revoked', 'expired', 'completed', 'failed', 'unknown', 'draft', 'validated', 'published']);
  badge.className = `status ${allowed.has(value) ? value : ''}`;
  const labels = { active: 'admin.status.active', suspended: 'admin.status.suspended', deleting: 'admin.status.deleting', pending: 'admin.status.pending', accepted: 'admin.status.accepted', revoked: 'admin.status.revoked', expired: 'admin.status.expired', completed: 'admin.status.completed', failed: 'admin.status.failed', unknown: 'admin.status.unknown', draft: 'admin.status.draft', validated: 'admin.status.validated', published: 'admin.status.published' };
  if (labels[value]) bindValue(badge, msg(labels[value]));
  else badge.textContent = String(value ?? '');
  cell.append(badge);
  return cell;
}

function time(value) {
  return Number.isFinite(value) ? msg('admin.date', () => ({value:formatDate(new Date(value), {dateStyle:'medium', timeStyle:'medium', hour12:false})})) : msg('admin.notAvailable');
}

function renderOverview(value) {
  const definitions = [
    ['admin.metric.tenants', value.tenants, msg('admin.metric.activeTenants', () => ({count:formatNumber(value.activeTenants)}))],
    ['admin.metric.projects', value.projects, msg('admin.metric.provisioningProjects', () => ({count:formatNumber(value.provisioningProjects)}))],
    ['admin.metric.failedProjects', value.failedProjects, msg('admin.metric.manualCheck')],
    ['admin.metric.pendingInvitations', value.pendingInvitations, msg('admin.metric.notExpired')],
    ['admin.metric.unknownOutbox', value.unknownOutbox, msg('admin.metric.coordinateFirst')],
  ];
  const box = $('#metrics');
  box.replaceChildren();
  for (const [label, amount, detail] of definitions) {
    const card = document.createElement('article');
    card.className = 'card metric';
    const name = document.createElement('p'); bindValue(name, msg(label));
    const number = document.createElement('strong'); bindValue(number, () => formatNumber(amount));
    const note = document.createElement('small'); bindValue(note, detail);
    card.append(name, number, note); box.append(card);
  }
  bindValue($('#updated-at'), msg('admin.updatedAt', () => ({time:String(time(value.updatedAt))})));
}

function emptyRow(body, columns, message) {
  const row = document.createElement('tr');
  const cell = platformCell(message); cell.colSpan = columns; cell.className = 'empty-cell';
  row.append(cell); body.append(row);
}

function renderInvitations(items) {
  const body = $('#invitations'); body.replaceChildren();
  if (!items.length) return emptyRow(body, 5, msg('admin.emptyInvitations'));
  for (const item of items) {
    const row = document.createElement('tr');
    row.append(textCell(item.normalized_email), statusCell(item.state), platformCell(time(item.created_at)), platformCell(time(item.expires_at)));
    const action = document.createElement('td');
    if (item.state === 'pending') {
      const button = document.createElement('button');
      button.className = 'button compact'; button.type = 'button'; bindValue(button, msg('admin.revoke'));
      button.onclick = () => revokeInvitation(item, button);
      action.append(button);
    } else if (item.state === 'accepted' && (item.access_state === 'active' || item.access_state === 'revoked')) {
      const button = document.createElement('button');
      const next = item.access_state === 'active' ? 'revoke' : 'restore';
      button.className = 'button compact'; button.type = 'button'; bindValue(button, msg(next === 'revoke' ? 'admin.revokeAccess' : 'admin.restoreAccess'));
      button.onclick = () => changeInvitationAccess(item, next, button);
      action.append(button);
    } else bindValue(action, msg(item.state === 'accepted' && item.access_state === 'blocked' ? 'admin.lifecycleRequired' : 'admin.notAvailable'));
    row.append(action); body.append(row);
  }
}

function renderTenants(items) {
  const body = $('#tenants'); body.replaceChildren();
  if (!items.length) return emptyRow(body, 7, msg('admin.emptyTenants'));
  for (const item of items) {
    const row = document.createElement('tr');
    row.append(textCell(item.id), statusCell(item.status), platformCell(() => formatNumber(item.projects)), platformCell(() => formatNumber(item.provisioning)), platformCell(() => formatNumber(item.ready)), platformCell(() => formatNumber(item.failed)), platformCell(time(item.created_at)));
    body.append(row);
  }
}

function renderAudit(items) {
  const body = $('#audit'); body.replaceChildren();
  if (!items.length) return emptyRow(body, 6, msg('admin.emptyAudit'));
  for (const item of items) {
    const row = document.createElement('tr');
    row.append(platformCell(time(item.created_at)), textCell(item.action), textCell(`${item.target_type}:${item.target_id}`), statusCell(item.outcome), textCell(item.reason_code), textCell(item.request_id));
    body.append(row);
  }
}

function renderModels(items) {
  const body = $('#models'); body.replaceChildren();
  if (!items.length) return emptyRow(body, 6, msg('admin.emptyModels'));
  for (const item of items) {
    const row = document.createElement('tr');
    row.append(textCell(item.model_id), textCell(item.version), textCell(item.title), statusCell(item.status), textCell(item.description));
    const action = document.createElement('td');
    if (item.status === 'draft') {
      const label = document.createElement('label'); const text = document.createElement('span'); bindValue(text, msg('admin.uploadPackage')); label.append(text);
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; bindAttribute(input, 'aria-label', 'admin.uploadPackage');
      input.onchange = () => uploadModelContent(item, input);
      label.append(input); action.append(label);
    }
    const next = item.status === 'draft' ? ['validate', 'admin.validate'] : item.status === 'validated' ? ['publish', 'admin.publish'] : item.status === 'published' ? ['withdraw', 'admin.withdraw'] : null;
    if (next) { const button = document.createElement('button'); button.className = 'button compact'; button.type = 'button'; bindValue(button, msg(next[1])); button.onclick = () => mutateModel(item, next[0], button); action.append(button); } else bindValue(action, msg('admin.notAvailable'));
    row.append(action); body.append(row);
  }
}

async function uploadModelContent(item, input) {
  const file = input.files?.[0]; if (!file) return;
  input.disabled = true;
  try {
    if (file.size > 8 * 1024 * 1024) throw uiError('admin.error.packageTooLarge');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== String(item.content_sha256 || '').toLowerCase()) throw uiError('admin.error.packageHashMismatch');
    const key = `${item.id || item.model_id}@${item.version}:${digest}`;
    let intent = modelUploadIntents.get(key); if (!intent) { intent = { key: crypto.randomUUID() }; modelUploadIntents.set(key, intent); }
    await api(`/api/admin/models/${encodeURIComponent(item.id || item.model_id)}/content`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.key }, body: file });
    modelUploadIntents.delete(key); await refresh(); show(msg('admin.packageUploaded'));
  } catch (error) { show(msg('admin.retrySameRequest', () => ({message:errorMessage(error)})), true); }
  finally { input.value = ''; input.disabled = false; }
}

async function refreshPrivateBeta() {
  const status=$('#private-beta-status');if(!status)return;
  try {
    const state=await api('/api/admin/private-beta');
    const cost=(state.usage||[]).reduce((sum,row)=>sum+Number(row.reservedNanodollars||0),0)/1e9;
    const latest=state.alerts?.[0];
    bindValue(status, msg('admin.betaStatus', () => ({
      state:String(msg(state.enabled&&!state.paused ? 'admin.betaOpen' : 'admin.betaPaused')),
      active:formatNumber(state.active), maximum:formatNumber(state.limits.maxActiveTurns), quarantined:formatNumber(state.quarantined),
      cost:formatNumber(cost, {style:'currency', currency:'USD'}), maximumCost:formatNumber(state.limits.maxNanodollarsTotal / 1e9, {style:'currency', currency:'USD'}),
      alert:latest ? ` · ${String(msg('admin.alert'))}: ${latest.code}` : '',
    })));
    $('#private-beta-pause').disabled=state.paused;
    $('#private-beta-resume').disabled=!state.paused||state.active>0;
  } catch {
    bindValue(status, msg('admin.betaUnavailable'));
    $('#private-beta-resume').disabled=true;
  }
}
for(const action of ['pause','resume']) {
  const button=$('#private-beta-'+action);if(button)button.onclick=async()=>{
    button.disabled=true;
    try{await api('/api/admin/private-beta',{method:'POST',body:JSON.stringify({action})});await refreshPrivateBeta();}
    catch(error){show(error.code==='private-beta-release-unconfirmed'?msg('admin.error.releaseUnconfirmed'):errorMessage(error),true);button.disabled=false;}
  };
}

async function refresh() {
  if (!operator || loading) return;
  const generation = viewGeneration;
  loading = true; $('#refresh').disabled = true;
  try {
    const [overview, tenants, invitations, audit, models] = await Promise.all([
      api('/api/admin/overview'), api('/api/admin/tenants'), api('/api/admin/invitations'), api('/api/admin/audit'), api('/api/admin/models'),
    ]);
    if (generation !== viewGeneration) return;
    renderOverview(overview); renderTenants(tenants.tenants); renderInvitations(invitations.invitations); renderAudit(audit.events); renderModels(models.models || []); show(''); await refreshPrivateBeta();
  } catch (error) {
    if (generation !== viewGeneration) return;
    if (error.status === 401 || error.status === 404) {
      operator = false; if (error.status === 401) authenticated = false; accountView();
    }
    show(errorMessage(error), true);
  } finally {
    loading = false; $('#refresh').disabled = false;
  }
}

async function mutateModel(item, action, button) {
  const key = `${item.model_id}@${item.version}:${action}`;
  let intent = modelActionIntents.get(key);
  if (!intent) { intent = { key: crypto.randomUUID() }; modelActionIntents.set(key, intent); }
  button.disabled = true;
  const id = item.id || item.model_id;
  try { await api(`/api/admin/models/${encodeURIComponent(id)}/` + action, { method: 'POST', headers: { 'Idempotency-Key': intent.key }, body: '{}' }); modelActionIntents.delete(key); show(msg(action === 'validate' ? 'admin.modelValidated' : action === 'publish' ? 'admin.modelPublished' : 'admin.modelWithdrawn')); await refresh(); }
  catch (error) { button.disabled = false; bindValue(button, msg('admin.retry')); show(msg('admin.retrySameRequest', () => ({message:errorMessage(error)})), true); }
}

function resetIssueIntent() {
  issueIntent = null;
  $('#issue-email').disabled = false; $('#issue-days').disabled = false;
  $('#issue-submit').disabled = false; bindValue($('#issue-submit'), msg('admin.createInvite'));
  $('#issue-reset').hidden = true;
}

$('#issue-form').onsubmit = async event => {
  event.preventDefault();
  if (!operator || loading) return;
  const email = $('#issue-email').value.trim();
  const expiresInDays = Number($('#issue-days').value);
  if (!email) return;
  issueIntent ??= { key: crypto.randomUUID(), payload: { email, expiresInDays } };
  const current = issueIntent;
  $('#issue-email').disabled = true; $('#issue-days').disabled = true; $('#issue-submit').disabled = true; $('#issue-reset').hidden = false;
  try {
    const result = await api('/api/admin/invitations', { method: 'POST', headers: { 'Idempotency-Key': current.key }, body: JSON.stringify(current.payload) });
    $('#issued-token').value = result.token || '';
    bindValue($('#token-title'), result.token ? msg('admin.tokenCreated', () => ({email:result.invitation.normalized_email})) : msg('admin.tokenUnavailable'));
    $('#token-panel').hidden = false;
    show(msg(result.token ? 'admin.inviteCreated' : 'admin.originalRequestConfirmed'));
    resetIssueIntent(); $('#issue-email').value = '';
    await refresh();
  } catch (error) {
    $('#issue-submit').disabled = false; bindValue($('#issue-submit'), msg('admin.retrySameRequestButton'));
    show(msg('admin.retrySameRequest', () => ({message:errorMessage(error)})), true);
  }
};

$('#issue-reset').onclick = () => { resetIssueIntent(); show(msg('admin.inviteRetryCancelled')); };

$('#model-reset').onclick = () => { modelIntent = null; $('#model-submit').disabled = false; bindValue($('#model-submit'), msg('admin.createDraft')); $('#model-reset').hidden = true; show(msg('admin.modelRetryCancelled')); };

$('#model-form').onsubmit = async event => {
  event.preventDefault(); if (!operator || loading) return;
  const payload = { modelId: $('#model-id').value.trim(), version: $('#model-version').value.trim(), title: $('#model-title').value.trim(), description: $('#model-description').value.trim(), starterVersion: $('#model-starter').value.trim(), contentRef: $('#model-content-ref').value.trim(), contentSha256: $('#model-content-sha').value.trim().toLowerCase() };
  if (Object.values(payload).some(value => !value)) return;
  modelIntent ??= { key: crypto.randomUUID(), payload };
  const current = modelIntent; $('#model-submit').disabled = true; $('#model-reset').hidden = false;
  try { await api('/api/admin/models', { method: 'POST', headers: { 'Idempotency-Key': current.key }, body: JSON.stringify(current.payload) }); modelIntent = null; $('#model-submit').disabled = false; $('#model-reset').hidden = true; show(msg('admin.modelDraftCreated')); await refresh(); }
  catch (error) { $('#model-submit').disabled = false; bindValue($('#model-submit'), msg('admin.retrySameRequestButton')); show(msg('admin.retrySameRequest', () => ({message:errorMessage(error)})), true); }
};

async function revokeInvitation(item, button) {
  if (!confirm(String(msg('admin.confirmRevokeInvitation', () => ({email:item.normalized_email}))))) return;
  button.disabled = true;
  try {
    await api(`/api/admin/invitations/${encodeURIComponent(item.id)}/revoke`, { method: 'POST', body: '{}' });
    show(msg('admin.inviteRevoked')); await refresh();
  } catch (error) { show(errorMessage(error), true); }
  finally { button.disabled = false; }
}

async function changeInvitationAccess(item, action, button) {
  const revoking = action === 'revoke';
  const verb = revoking ? 'admin.revokeAccess' : 'admin.restoreAccess';
  const warning = revoking ? 'admin.confirmAccessRevokeWarning' : 'admin.confirmAccessRestoreWarning';
  if (!confirm(String(msg('admin.confirmAccessChange', () => ({verb:String(msg(verb)), email:item.normalized_email, warning:String(msg(warning))}))))) return;
  button.disabled = true;
  try {
    await api(`/api/admin/invitations/${encodeURIComponent(item.id)}/access`, { method: 'POST', body: JSON.stringify({ action }) });
    show(msg(revoking ? 'admin.accessRevoked' : 'admin.accessRestored')); await refresh();
  } catch (error) { show(errorMessage(error), true); }
  finally { button.disabled = false; }
}

$('#copy-token').onclick = async () => {
  const input = $('#issued-token');
  if (!input.value) return;
  try { await navigator.clipboard.writeText(input.value); show(msg('admin.tokenCopied')); }
  catch { input.select(); show(msg('admin.copySelectedToken')); }
};

$('#google').onclick = async () => {
  try {
    const data = await api('/api/auth/sign-in/social', { method: 'POST', body: JSON.stringify({ provider: 'google', callbackURL: location.origin + '/admin' }) });
    if (data?.url) location.assign(data.url);
  } catch (error) { show(errorMessage(error), true); }
};

$('#sign-out').onclick = async () => {
  const button = $('#sign-out'); button.disabled = true; viewGeneration++; localePreferences.begin();
  try {
    await api('/api/auth/sign-out', { method: 'POST', body: '{}' });
    authenticated = false; operator = false; resetIssueIntent(); accountView(); show(msg('admin.signedOut'));
  } catch (error) { show(errorMessage(error), true); }
  finally { button.disabled = false; }
};

$('#refresh').onclick = refresh;

async function load() {
  const generation = ++viewGeneration;
  const localeStart = localePreferences.begin();
  try {
    const session = await api('/api/auth/get-session');
    if (generation !== viewGeneration) return;
    operatorUserId=typeof session?.user?.id==='string'?session.user.id:null;
    authenticated = Boolean(session?.user); operator = false; accountView();
    if (!authenticated) return;
    localePreferences.activate(operatorUserId, generation, localeStart);
    await api('/api/admin/overview');
    if (generation !== viewGeneration) return;
    operator = true; accountView(); await refresh();
  } catch (error) {
    if (generation !== viewGeneration) return;
    if (error.status === 401) authenticated = false;
    operator = false; accountView(); show(error.status === 404 && authenticated ? msg('admin.error.noAdminAccess') : errorMessage(error), error.status !== 404);
  }
}

void load();
