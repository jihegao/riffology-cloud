import {createPublicationPanel} from './publication.js';
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
  notice.textContent = message;
  notice.className = `notice${error ? ' error' : ''}`;
  notice.hidden = !message;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const messages = { 400: '输入格式不正确', 401: '请先登录', 403: '请求来源未通过验证', 404: '当前账号没有平台管理权限', 409: '这次重试的内容与首次请求不同', 503: '服务暂不可用，请稍后再试' };
    let code;
    try { code = (await response.json())?.error; } catch {}
    const message = code === 'not_ready' ? '模型内容包尚未通过验证，请核对上传内容和摘要后重试' : messages[response.status] || '请求失败，请稍后重试';
    throw Object.assign(new Error(message), { status: response.status, code });
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

function statusCell(value) {
  const cell = document.createElement('td');
  const badge = document.createElement('span');
  const allowed = new Set(['active', 'suspended', 'deleting', 'pending', 'accepted', 'revoked', 'expired', 'completed', 'failed', 'unknown', 'draft', 'validated', 'published']);
  badge.className = `status ${allowed.has(value) ? value : ''}`;
  badge.textContent = ({ active: '正常', suspended: '已暂停', deleting: '删除中', pending: '待使用', accepted: '已接受', revoked: '已撤销', expired: '已过期', completed: '完成', failed: '失败', unknown: '未知', draft: '草稿', validated: '已验证', published: '已发布' })[value] || value;
  cell.append(badge);
  return cell;
}

function time(value) {
  return Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function renderOverview(value) {
  const definitions = [
    ['租户', value.tenants, `${value.activeTenants} 正常`],
    ['项目', value.projects, `${value.provisioningProjects} 准备中`],
    ['失败项目', value.failedProjects, '需人工检查'],
    ['待用邀请', value.pendingInvitations, '尚未过期'],
    ['未知任务', value.unknownOutbox, '需先协调状态'],
  ];
  const box = $('#metrics');
  box.replaceChildren();
  for (const [label, amount, detail] of definitions) {
    const card = document.createElement('article');
    card.className = 'card metric';
    const name = document.createElement('p'); name.textContent = label;
    const number = document.createElement('strong'); number.textContent = String(amount);
    const note = document.createElement('small'); note.textContent = detail;
    card.append(name, number, note); box.append(card);
  }
  $('#updated-at').textContent = `数据时间 ${time(value.updatedAt)} · 只展示平台元数据`;
}

function emptyRow(body, columns, message) {
  const row = document.createElement('tr');
  const cell = textCell(message); cell.colSpan = columns; cell.className = 'empty-cell';
  row.append(cell); body.append(row);
}

function renderInvitations(items) {
  const body = $('#invitations'); body.replaceChildren();
  if (!items.length) return emptyRow(body, 5, '暂无邀请。');
  for (const item of items) {
    const row = document.createElement('tr');
    row.append(textCell(item.normalized_email), statusCell(item.state), textCell(time(item.created_at)), textCell(time(item.expires_at)));
    const action = document.createElement('td');
    if (item.state === 'pending') {
      const button = document.createElement('button');
      button.className = 'button compact'; button.type = 'button'; button.textContent = '撤销';
      button.onclick = () => revokeInvitation(item, button);
      action.append(button);
    } else action.textContent = '—';
    row.append(action); body.append(row);
  }
}

function renderTenants(items) {
  const body = $('#tenants'); body.replaceChildren();
  if (!items.length) return emptyRow(body, 7, '暂无租户。');
  for (const item of items) {
    const row = document.createElement('tr');
    row.append(textCell(item.id), statusCell(item.status), textCell(item.projects), textCell(item.provisioning), textCell(item.ready), textCell(item.failed), textCell(time(item.created_at)));
    body.append(row);
  }
}

function renderAudit(items) {
  const body = $('#audit'); body.replaceChildren();
  if (!items.length) return emptyRow(body, 6, '暂无审计事件。');
  for (const item of items) {
    const row = document.createElement('tr');
    row.append(textCell(time(item.created_at)), textCell(item.action), textCell(`${item.target_type}:${item.target_id}`), statusCell(item.outcome), textCell(item.reason_code), textCell(item.request_id));
    body.append(row);
  }
}

function renderModels(items) {
  const body = $('#models'); body.replaceChildren();
  if (!items.length) return emptyRow(body, 6, '暂无已发布或待处理的模型元数据。');
  for (const item of items) {
    const row = document.createElement('tr');
    row.append(textCell(item.model_id), textCell(item.version), textCell(item.title), statusCell(item.status), textCell(item.description));
    const action = document.createElement('td');
    if (item.status === 'draft') {
      const label = document.createElement('label'); label.textContent = '上传规范包';
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.setAttribute('aria-label', '上传规范包');
      input.onchange = () => uploadModelContent(item, input);
      label.append(input); action.append(label);
    }
    const next = item.status === 'draft' ? ['validate', '验证'] : item.status === 'validated' ? ['publish', '发布'] : item.status === 'published' ? ['withdraw', '撤回'] : null;
    if (next) { const button = document.createElement('button'); button.className = 'button compact'; button.type = 'button'; button.textContent = next[1]; button.onclick = () => mutateModel(item, next[0], button); action.append(button); } else action.textContent = '—';
    row.append(action); body.append(row);
  }
}

async function uploadModelContent(item, input) {
  const file = input.files?.[0]; if (!file) return;
  input.disabled = true;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('规范包不能超过 8 MiB。');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== String(item.content_sha256 || '').toLowerCase()) throw new Error('规范包 SHA-256 与模型摘要不一致，请核对文件后重试。');
    const key = `${item.id || item.model_id}@${item.version}:${digest}`;
    let intent = modelUploadIntents.get(key); if (!intent) { intent = { key: crypto.randomUUID() }; modelUploadIntents.set(key, intent); }
    await api(`/api/admin/models/${encodeURIComponent(item.id || item.model_id)}/content`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent.key }, body: file });
    modelUploadIntents.delete(key); await refresh(); show('内容包已上传，可以验证。');
  } catch (error) { show(`${error.message}；重试会保持相同请求。`, true); }
  finally { input.value = ''; input.disabled = false; }
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
    renderOverview(overview); renderTenants(tenants.tenants); renderInvitations(invitations.invitations); renderAudit(audit.events); renderModels(models.models || []); show('');
  } catch (error) {
    if (generation !== viewGeneration) return;
    if (error.status === 401 || error.status === 404) {
      operator = false; if (error.status === 401) authenticated = false; accountView();
    }
    show(error.message, true);
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
  try { await api(`/api/admin/models/${encodeURIComponent(id)}/` + action, { method: 'POST', headers: { 'Idempotency-Key': intent.key }, body: '{}' }); modelActionIntents.delete(key); show(`${action === 'validate' ? '模型内容包已验证' : action === 'publish' ? '模型已发布' : '模型已撤回'}。`); await refresh(); }
  catch (error) { button.disabled = false; button.textContent = '重试'; show(`${error.message}；重试会保持相同请求。`, true); }
}

function resetIssueIntent() {
  issueIntent = null;
  $('#issue-email').disabled = false; $('#issue-days').disabled = false;
  $('#issue-submit').disabled = false; $('#issue-submit').textContent = '创建邀请';
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
    $('#token-title').textContent = result.token ? `请立即保存 ${result.invitation.normalized_email} 的邀请码` : '请求已成功执行，但邀请码不会再次显示；请撤销后重新创建。';
    $('#token-panel').hidden = false;
    show(result.token ? '邀请已创建。' : '已确认原请求成功。');
    resetIssueIntent(); $('#issue-email').value = '';
    await refresh();
  } catch (error) {
    $('#issue-submit').disabled = false; $('#issue-submit').textContent = '重试同一请求';
    show(`${error.message}；重试会保持相同请求。`, true);
  }
};

$('#issue-reset').onclick = () => { resetIssueIntent(); show('已取消本次重试，可创建新邀请。'); };

$('#model-reset').onclick = () => { modelIntent = null; $('#model-submit').disabled = false; $('#model-submit').textContent = '创建草稿'; $('#model-reset').hidden = true; show('已取消本次重试，可创建新草稿。'); };

$('#model-form').onsubmit = async event => {
  event.preventDefault(); if (!operator || loading) return;
  const payload = { modelId: $('#model-id').value.trim(), version: $('#model-version').value.trim(), title: $('#model-title').value.trim(), description: $('#model-description').value.trim(), starterVersion: $('#model-starter').value.trim(), contentRef: $('#model-content-ref').value.trim(), contentSha256: $('#model-content-sha').value.trim().toLowerCase() };
  if (Object.values(payload).some(value => !value)) return;
  modelIntent ??= { key: crypto.randomUUID(), payload };
  const current = modelIntent; $('#model-submit').disabled = true; $('#model-reset').hidden = false;
  try { await api('/api/admin/models', { method: 'POST', headers: { 'Idempotency-Key': current.key }, body: JSON.stringify(current.payload) }); modelIntent = null; $('#model-submit').disabled = false; $('#model-reset').hidden = true; show('模型草稿已创建。'); await refresh(); }
  catch (error) { $('#model-submit').disabled = false; $('#model-submit').textContent = '重试同一请求'; show(`${error.message}；重试会保持相同请求。`, true); }
};

async function revokeInvitation(item, button) {
  if (!confirm(`撤销发给 ${item.normalized_email} 的邀请？`)) return;
  button.disabled = true;
  try {
    await api(`/api/admin/invitations/${encodeURIComponent(item.id)}/revoke`, { method: 'POST', body: '{}' });
    show('邀请已撤销。'); await refresh();
  } catch (error) { show(error.message, true); }
  finally { button.disabled = false; }
}

$('#copy-token').onclick = async () => {
  const input = $('#issued-token');
  if (!input.value) return;
  try { await navigator.clipboard.writeText(input.value); show('邀请码已复制。'); }
  catch { input.select(); show('请复制选中的邀请码。'); }
};

$('#google').onclick = async () => {
  try {
    const data = await api('/api/auth/sign-in/social', { method: 'POST', body: JSON.stringify({ provider: 'google', callbackURL: location.origin + '/admin' }) });
    if (data?.url) location.assign(data.url);
  } catch (error) { show(error.message, true); }
};

$('#sign-out').onclick = async () => {
  const button = $('#sign-out'); button.disabled = true; viewGeneration++;
  try {
    await api('/api/auth/sign-out', { method: 'POST', body: '{}' });
    authenticated = false; operator = false; resetIssueIntent(); accountView(); show('已退出登录。');
  } catch (error) { show(error.message, true); }
  finally { button.disabled = false; }
};

$('#refresh').onclick = refresh;

async function load() {
  const generation = ++viewGeneration;
  try {
    const session = await api('/api/auth/get-session');
    if (generation !== viewGeneration) return;
    operatorUserId=typeof session?.user?.id==='string'?session.user.id:null;
    authenticated = Boolean(session?.user); operator = false; accountView();
    if (!authenticated) return;
    await api('/api/admin/overview');
    if (generation !== viewGeneration) return;
    operator = true; accountView(); await refresh();
  } catch (error) {
    if (generation !== viewGeneration) return;
    if (error.status === 401) authenticated = false;
    operator = false; accountView(); show(error.status === 404 && authenticated ? '当前账号没有平台管理权限。' : error.message, error.status !== 404);
  }
}

void load();
