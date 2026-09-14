import {createExportPanel} from './export.js';
import {createEvidencePanel} from './evidence.js';
import {createWorkspaceLayout} from './layout.js';
import {createServicePanel} from './services.js';
import {createPreviewPanel} from './previews.js';
import {createComparisonPanel} from './comparison.js';
import {createSimulationPanel} from './simulation.js';
const $ = selector => document.querySelector(selector);
const workspaceLayout=createWorkspaceLayout({root:$('#workspace')});
let observedModel=null,observedService=null;
function renderModelState(){
  const status=$('#workspace-model-status');if(!status)return;
  const active=workspaceSnapshot?.activeTurnId&&workspaceSnapshot.turns?.[workspaceSnapshot.activeTurnId];
  let state='ready',text='还没有模型预览。请在左侧描述研究问题。';
  if(active&&!['completed','failed','cancelled','interrupted'].includes(active.status)){
    state='building';text='正在构建或检查模型；已保存的预览和结果保留各自版本。';
  }else if(observedService&&['stopped','failed','cancelled'].includes(observedService.runStatus)){
    state=observedService.runStatus==='failed'?'failed':'stopped';text='交互模型已结束，已保存的参数和结果仍可查看。需要时明确重新运行。';
  }else if(observedService?.stopRequestedAt||observedService?.runStatus==='stopping'){
    state='stopping';text='正在停止交互模型；已保存的参数和结果仍可查看。';
  }else if(observedService?.version?.filesSha256&&observedModel?.version?.filesSha256&&observedService.version.filesSha256!==observedModel.version.filesSha256){
    state='old';text=`当前预览属于旧版本 ${observedService.version.revisionId}；新版本 ${observedModel.version.revisionId??'初始版本'} 已保存。运行已保存模型后才会切换。`;
  }else if(observedService?.runStatus==='running'){
    state='running';text='交互模型正在运行。参数实验与保存结果可在下方查看。';
  }else if(['queued','starting','unknown'].includes(observedService?.runStatus)){
    state='starting';text='模型预览正在准备；状态会自动更新。';
  }else if(observedModel?.reasonCode){
    state='failed';text='模型尚未通过运行检查，请在 Model 查看说明并继续修改。';
  }else if(observedModel?.version){
    text='模型已保存。可以运行交互模型，或直接进行参数实验。';
  }
  status.dataset.state=state;status.textContent=text;
}
const previewPanel=createPreviewPanel({root:$('#workspace-preview'),api,autoRestore:true,onState:value=>{const pinned=value.available?.runId||value.current?.runId;if(pinned)servicePanel.selectRun(pinned);}});
const servicePanel=createServicePanel({root:$('#workspace-services'),inspectRoot:$('#workspace-runtime-details'),api,workspaceMode:true,onPreparingRun:runId=>previewPanel.prepareRun(runId),onPreviewRun:(runId,options)=>options?.automatic?previewPanel.restoreRun(runId):previewPanel.openRun(runId),onState:detail=>{observedService=detail;renderModelState();if(detail.stopRequestedAt||['stopped','failed','cancelled'].includes(detail.runStatus))previewPanel.stoppedRun(detail.runId);}});
const comparisonPanel=createComparisonPanel({root:$('#workspace-comparison'),api});
const exportPanel=createExportPanel({root:$('#workspace-export')});
const evidencePanel=createEvidencePanel({root:$('#workspace-evidence'),api,onAssessment:()=>{void comparisonPanel.reload();void simulationPanel.reload();}});
const simulationPanel=createSimulationPanel({root:$('#workspace-simulation'),modelRoot:$('#workspace-model'),historyRoot:$('#workspace-run-history'),api,onModel:model=>{observedModel=model;renderModelState();}});
const notice = $('#notice');
const dialog = $('#project-dialog');
let tenant = null;
let authenticated = false;
let viewGeneration = 0;
let listGeneration = 0;
let pollTimer = null;
let pollDeadline = 0;
let intent = null;
let creating = false;
let pendingProject = null;
let models = [];
let modelsStatus = 'loading';
let modelsGeneration = 0;
let activeProject = null;
let workspaceSnapshot = null;
let workspaceEvents = [];
let workspaceHistoryTruncated = false;
let selectedSessionId = null;
let sessionIntent = null;
let creatingSession = false;
let messageIntent = null;
let sendingMessage = false;
const recoveryId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const recoveryKey = workspaceId => `riffology:conversation:${tenant.id}:${workspaceId}`;
function readConversation(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!value || value.schemaVersion !== 1) return {};
    return {
      selectedSessionId: recoveryId(value.selectedSessionId) ? value.selectedSessionId : null,
      draft: typeof value.draft === 'string' ? value.draft : '',
      messageIntent: value.messageIntent && recoveryId(value.messageIntent.key) && recoveryId(value.messageIntent.sessionId) && typeof value.messageIntent.message === 'string' ? {key:value.messageIntent.key,sessionId:value.messageIntent.sessionId,message:value.messageIntent.message} : null,
      sessionIntent: value.sessionIntent && recoveryId(value.sessionIntent.key) && typeof value.sessionIntent.title === 'string' ? {key:value.sessionIntent.key,title:value.sessionIntent.title} : null,
    };
  } catch { return {}; }
}
function saveConversation(key, patch) {
  try { sessionStorage.setItem(key, JSON.stringify({schemaVersion:1,...readConversation(key),...patch})); }
  catch { throw Error('无法保存待确认请求，请检查浏览器存储后重试。'); }
}
function canSubmitConversation() {
  return Boolean(activeProject?.status === 'ready' && workspaceSnapshot && !['maintenance','unavailable'].includes(workspaceSnapshot.admission?.state));
}

let eventSource = null;
let eventRetryTimer = null;
let snapshotRecovery = false;
let workspaceFiles = null;
let workspaceFilesError = '';
let workspaceDiff = null;
let workspaceDiffError = '';
let workspaceArtifactPanel = 'files';
const POLL_WINDOW_MS = 300000;
const TERMINAL_TURNS = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const TURN_REQUEST_MAX_BYTES = 8192;
const encodedTurnRequestBytes = message => new TextEncoder().encode(JSON.stringify({message})).byteLength;

function workspaceNeedsTurnUpdates(snapshot = workspaceSnapshot) {
  if (!snapshot) return false;
  if (snapshot.activeTurnId || snapshot.resourceWait || snapshot.releaseHold || snapshot.recoveryHold) return true;
  return Object.values(snapshot.turns || {}).some(turn => turn?.status === 'queued');
}

function show(message, error = false, action = null) {
  notice.replaceChildren();
  const text = document.createElement('span');
  text.textContent = message;
  notice.append(text);
  if (action) {
    const button = document.createElement('button');
    button.className = 'button';
    button.textContent = action.label;
    button.onclick = action.run;
    notice.append(button);
  }
  notice.className = `notice${error ? ' error' : ''}`;
  notice.hidden = !message;
}

function renderModels() {
  const box = $('#models');
  const status = $('#models-status');
  if (!box || !status) return;
  box.replaceChildren();
  if (modelsStatus === 'loading') { status.textContent = '正在加载官方模型…'; return; }
  if (modelsStatus === 'error') { status.textContent = '官方模型暂时不可用，仍可创建空白项目。'; return; }
  if (!models.length) { status.textContent = '当前暂无可用的官方模型。'; return; }
  status.textContent = '选择固定版本开始独立项目。';
  for (const model of models) {
    const card = document.createElement('article'); card.className = 'model-card';
    const title = document.createElement('h3'); title.textContent = model.title || model.model_id;
    const description = document.createElement('p'); description.textContent = model.description || '暂无说明。';
    const version = document.createElement('small'); version.textContent = `版本 ${model.version}`;
    const use = document.createElement('button'); use.className = 'button compact'; use.type = 'button'; use.textContent = '使用此版本'; use.onclick = () => openProjectDialog(model);
    card.append(title, description, version, use); box.append(card);
  }
}

async function loadModels() {
  const generation = ++modelsGeneration;
  const priorSelection = $('#project-model')?.value || '';
  $('#models-refresh').disabled = true;
  modelsStatus = 'loading'; renderModels();
  try {
    const data = await api('/api/models');
    if (generation !== modelsGeneration) return;
    models = Array.isArray(data?.models) ? data.models.filter(model => model && (!model.status || model.status === 'published') && model.model_id && model.version) : [];
    modelsStatus = 'ready'; renderModels();
    const select = $('#project-model');
    if (select) {
      select.replaceChildren(new Option('空白项目', ''));
      for (const model of models) { const option = new Option(`${model.title || model.model_id} · ${model.version}`, `${model.model_id}@${model.version}`); option.dataset.modelId = model.model_id; option.dataset.modelVersion = model.version; select.append(option); }
      const frozen = intent?.payload?.modelId ? `${intent.payload.modelId}@${intent.payload.modelVersion}` : '';
      if (frozen && ![...select.options].some(option => option.value === frozen)) {
        const option = new Option(`${intent.payload.modelId} · ${intent.payload.modelVersion}（已冻结）`, frozen);
        option.dataset.modelId = intent.payload.modelId; option.dataset.modelVersion = intent.payload.modelVersion; select.append(option);
      }
      const wanted = frozen || priorSelection;
      select.value = [...select.options].some(option => option.value === wanted) ? wanted : '';
      select.disabled = Boolean(intent);
    }
  } catch {
    if (generation !== modelsGeneration) return;
    models = []; modelsStatus = 'error'; renderModels();
    const select = $('#project-model');
    if (select && !intent) select.replaceChildren(new Option('空白项目', ''));
  } finally {
    if (generation === modelsGeneration) $('#models-refresh').disabled = false;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const projectLimit = response.status === 429 && path.startsWith('/api/workspaces/');
    let code = null;
    try { const body = await response.clone().json(); if (typeof body?.error === 'string') code = body.error; } catch {}
    const messages = { 400: '请求内容无效', 401: '请先登录', 403: '登录或项目权限已变化，请刷新后重试', 404: '当前账号尚未获得访问权限', 409: '状态已变化，请刷新后重试', 413: '请求内容过大，请缩短后重试', 429: projectLimit ? '本项目已达到当前费用或运行上限' : '请求过于频繁，请稍后重试', 503: '服务暂不可用，请稍后再试' };
    if (code === 'turn_runtime_not_ready') messages[503] = '当前环境暂停接收新任务，请稍后查看状态。';
    throw Object.assign(new Error(messages[response.status] || '请求失败，请稍后重试'), { status: response.status, code, retryable: code !== 'turn_runtime_not_ready' });
  }
  return response.status === 204 ? null : response.json();
}

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
}

function stopEventStream() {
  clearTimeout(eventRetryTimer);
  eventRetryTimer = null;
  eventSource?.close();
  eventSource = null;
}

function accountView() {
  if(!authenticated||!tenant||!activeProject){servicePanel.close();previewPanel.leave();simulationPanel.leave();comparisonPanel.leave();exportPanel.leave();evidencePanel.leave();}
  $('#login').hidden = authenticated;
  const workspaceRoutePending = Boolean(workspaceProjectIdFromHash()) && !activeProject;
  $('#app').hidden = !tenant || Boolean(activeProject) || workspaceRoutePending;
  $('#workspace').hidden = !tenant || !activeProject;
  $('#invitation').hidden = !authenticated || Boolean(tenant);
  $('#sign-out').hidden = !authenticated;
}

function turnStatus(turn) {
  const labels = { queued: '排队中', running: '正在执行', cancelling: '正在停止', checkpointing: '正在保存', completed: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断' };
  if (turn.persistenceOutcome === 'failed') return `${labels[turn.status] || turn.status} · 保存失败`;
  if (turn.persistenceOutcome === 'saved') return `${labels[turn.status] || turn.status} · 已保存`;
  return labels[turn.status] || turn.status;
}

function appendTurnCard(kind, text, detail = '') {
  const card = document.createElement('article');
  card.className = `turn-card ${kind}`;
  if(kind==='assistant'||kind==='user'){const origin=document.createElement('strong');origin.textContent=kind==='assistant'?'Agent 解释 · 未核验测量':'用户提供内容 · 未核验事实';card.append(origin);}
  const body = document.createElement('p');
  body.textContent = text;
  card.append(body);
  if (detail) {
    const meta = document.createElement('small');
    meta.textContent = detail;
    card.append(meta);
  }
  $('#turns').append(card);
}

function appendToolCards(events, turnId) {
  const cards = new Map();
  const publicArtifact = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1
      || typeof value.artifactId !== 'string' || !/^artifact-[a-f0-9]{60}$/.test(value.artifactId)
      || !['read', 'list', 'search'].includes(value.operation) || value.mediaType !== 'application/json'
      || !Number.isSafeInteger(value.bytes) || value.bytes <= 16384 || value.bytes > 1024 * 1024 + 64 * 1024
      || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
      || !Number.isSafeInteger(value.createdAt) || value.createdAt < 1) return null;
    return { artifactId: value.artifactId, bytes: value.bytes };
  };
  for (const [index, event] of events.entries()) {
    if (!['tool.started', 'tool.updated', 'tool.completed'].includes(event?.type)) continue;
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    const callId = typeof payload.toolCallId === 'string' && payload.toolCallId ? payload.toolCallId : `missing-${index}`;
    const key = `${turnId}:${callId}`;
    const card = cards.get(key) || { name: '项目工具', status: 'running', summary: '', artifact: null };
    if (typeof payload.name === 'string' && payload.name) card.name = payload.name;
    if (typeof payload.summary === 'string') card.summary = payload.summary;
    if (event.type === 'tool.completed') {
      card.status = payload.isError === true ? 'failed' : 'completed';
      card.artifact = payload.isError === true ? null : publicArtifact(payload.artifact);
    }
    else if (event.type === 'tool.updated' && card.status !== 'failed' && card.status !== 'completed') card.status = 'running';
    cards.set(key, card);
  }
  for (const card of cards.values()) {
    const details = document.createElement('details'); details.className = 'tool-card';
    const summary = document.createElement('summary'); summary.textContent = `${card.name} · ${card.status === 'completed' ? '已完成' : card.status === 'failed' ? '失败' : '运行中'}`;
    const detail = document.createElement('p'); detail.className = 'tool-summary'; detail.textContent = card.summary || '暂无更新摘要';
    details.append(summary, detail);
    if (card.artifact && activeProject?.workspace_id) {
      const link = document.createElement('a');
      link.className = 'tool-artifact-link';
      link.href = `/api/workspaces/${encodeURIComponent(activeProject.workspace_id)}/artifacts/${encodeURIComponent(card.artifact.artifactId)}`;
      link.target = '_blank'; link.rel = 'noopener';
      link.textContent = `查看完整结果 · ${sizeLabel(card.artifact.bytes)}`;
      details.append(link);
    }
    $('#turns').append(details);
  }
}

function appendAssistantMessage(events) {
  const assistant = events.filter(event => event?.type === 'assistant.delta' || event?.type === 'assistant.message');
  if (!assistant.length) return;
  const ordered = [...assistant].sort((a, b) => (Number.isInteger(a?.sequence) ? a.sequence : Number.MAX_SAFE_INTEGER) - (Number.isInteger(b?.sequence) ? b.sequence : Number.MAX_SAFE_INTEGER));
  const final = ordered.findLast?.(event => event.type === 'assistant.message' && typeof event.payload?.text === 'string' && event.payload.text.length > 0);
  let text = '';
  let detail = '';
  if (final) {
    text = final.payload.text;
    if (typeof final.payload.stopReason === 'string' && final.payload.stopReason) detail = final.payload.stopReason;
  } else {
    const bySequence = new Map();
    for (const event of ordered) {
      const value = event.payload && typeof event.payload === 'object' ? event.payload.text : null;
      if (typeof value !== 'string' || value.length === 0 || !Number.isInteger(event.sequence) || event.sequence <= 0) continue;
      if (!bySequence.has(event.sequence)) bySequence.set(event.sequence, value);
    }
    text = [...bySequence.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value).join('');
    if (!text) return;
    detail = '流式输出';
  }
  appendTurnCard('assistant', text, detail);
}

function renderWorkspace() {
  const box = $('#turns');
  box.replaceChildren();
  if (!workspaceSnapshot) {
    $('#message-submit').disabled = true; $('#new-session').disabled = true; $('#session-select').disabled = true;
    $('#message-input').readOnly = Boolean(messageIntent);
    const loading = document.createElement('p');
    loading.className = 'turn-empty';
    loading.textContent = '正在读取项目状态…';
    box.append(loading);
    return;
  }
  const admission = workspaceSnapshot.admission;
  const unavailable = admission?.state === 'unavailable';
  const maintenance = admission?.state === 'maintenance';
  if (maintenance) appendTurnCard('system', '当前环境暂停接收新任务。', '草稿会保留；已接收回合仍可继续观察、取消和读取保存结果。');
  if (unavailable) appendTurnCard('system', '当前执行环境暂不可用。', '平台正在恢复运行资源，请稍后重试；草稿会保留。');
  if (workspaceHistoryTruncated) appendTurnCard('system', '这里只显示近期对话回复。', '较早回复已超出显示保留范围；项目文件和实验结果仍可查看。');
  $('#message-input').disabled = maintenance || unavailable;
  $('#message-submit').disabled = maintenance || unavailable || sendingMessage;
  $('#new-session').disabled = maintenance || unavailable || creatingSession || Boolean(messageIntent);
  $('#message-input').readOnly = Boolean(messageIntent);
  $('#message-submit').textContent = messageIntent ? '重试上次请求' : '发送';
  $('#session-select').disabled = maintenance || unavailable || Boolean(messageIntent) || Boolean(sessionIntent);
  const sessions = Object.values(workspaceSnapshot.sessions || {}).sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  if (messageIntent) selectedSessionId = messageIntent.sessionId;
  else if (!selectedSessionId || !workspaceSnapshot.sessions?.[selectedSessionId]) selectedSessionId = sessions[0]?.id || null;
  try { saveConversation(recoveryKey(activeProject.workspace_id), {selectedSessionId}); } catch (error) { $('#message-error').textContent = error.message; }
  const sessionSelect = $('#session-select');
  if (sessionSelect) {
    sessionSelect.replaceChildren(...sessions.map(session => {
      const option = document.createElement('option'); option.value = session.id; option.textContent = session.title || session.id; return option;
    }));
    sessionSelect.value = selectedSessionId || '';
    sessionSelect.disabled = !sessions.length;
  }
  if (workspaceSnapshot.releaseHold) {
    const detail = workspaceSnapshot.releaseHold.status === 'recovery-hold'
      ? '资源释放仍未确认，系统会继续安全恢复；文件和差异仍可读取。'
      : '释放确认完成后，下一轮会自动开始。';
    appendTurnCard('system', '上一轮已结束，正在等待执行资源释放。', detail);
  } else if (workspaceSnapshot.resourceWait) {
    const cleanup = workspaceSnapshot.resourceWait.status === 'release-pending';
    appendTurnCard('system', cleanup ? '回合未启动，正在释放执行许可。' : '回合已排队，正在等待执行资源。', cleanup ? '释放确认后，队列会自动继续。' : '获得应用运行许可后会自动开始。');
  }
  const turns = Object.values(workspaceSnapshot.turns || {}).filter(turn => turn.sessionId === selectedSessionId).sort((a, b) => a.createdAt - b.createdAt);
  if (!turns.length) {
    const empty = document.createElement('p');
    empty.className = 'turn-empty';
    empty.textContent = '从一条消息开始。关闭页面不会终止已经提交的回合。';
    box.append(empty);
  }
  for (const turn of turns) {
    appendTurnCard('user', turn.message, turnStatus(turn));
    if(turn.timing){const labels={queuedMs:'排队',preparingMs:'准备',executingMs:'执行',savingMs:'保存'};const durations=Object.entries(labels).filter(([k])=>turn.timing[k]!==null).map(([k,v])=>`${v} ${(turn.timing[k]/1000).toFixed(1)} 秒`);if(durations.length)appendTurnCard('system',durations.join(' · '));}
    const events = workspaceEvents.filter(event => event.turnId === turn.id);
    appendAssistantMessage(events);
    appendToolCards(events, turn.id);
    const providerError = events.findLast?.(event => event.type === 'provider.status' && event.payload?.state === 'error');
    if (providerError) appendTurnCard('system', `模型服务返回错误${providerError.payload?.status ? `（${providerError.payload.status}）` : ''}，平台仍会保存可恢复状态。`);
    if (turn.errorCode && !events.some(event => event.type === 'assistant.message')) appendTurnCard('system', `回合未完成：${turn.errorCode}`, turnStatus(turn));
  }
  const active = workspaceSnapshot.activeTurnId && workspaceSnapshot.turns?.[workspaceSnapshot.activeTurnId];
  $('#cancel-turn').hidden = !active || TERMINAL_TURNS.has(active.status);
  $('#cancel-turn').dataset.turnId = active?.id || '';
}

function sizeLabel(value) {
  if (!Number.isSafeInteger(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
}

function renderWorkspaceFiles() {
  const box = $('#workspace-files'), meta = $('#files-meta');
  if (!box || !meta) return;
  box.replaceChildren();
  if (workspaceFilesError) { meta.textContent = '读取失败'; const error = document.createElement('p'); error.className = 'file-empty file-error'; error.textContent = workspaceFilesError; box.append(error); return; }
  if (!workspaceFiles) { meta.textContent = '正在读取最新已保存版本…'; const loading = document.createElement('p'); loading.className = 'file-empty'; loading.textContent = '正在加载文件清单'; box.append(loading); return; }
  const files = Array.isArray(workspaceFiles.files) ? workspaceFiles.files : [];
  if (!workspaceFiles.revision) { meta.textContent = '尚无 Turn 保存版本'; const empty = document.createElement('p'); empty.className = 'file-empty'; empty.textContent = '项目完成首个回合并保存后，文件会显示在这里。'; box.append(empty); return; }
  meta.textContent = `${files.length} 项 · 保存于 ${new Date(workspaceFiles.revision.committedAt).toLocaleString('zh-CN', { hour12: false })}`;
  for (const item of files) {
    if (!item || typeof item.path !== 'string' || !['file', 'directory'].includes(item.type)) continue;
    const row = document.createElement('div'); row.className = `file-entry ${item.type}`;
    const path = document.createElement('span'); path.textContent = `${item.type === 'directory' ? '▸ ' : ''}${item.path}`;
    const detail = document.createElement('small'); detail.textContent = item.type === 'directory' ? '目录' : sizeLabel(item.size);
    row.append(path, detail); box.append(row);
  }
  if (!box.childElementCount) { const empty = document.createElement('p'); empty.className = 'file-empty'; empty.textContent = '这个保存版本没有可展示的文件。'; box.append(empty); }
}

async function refreshWorkspaceFiles(generation = viewGeneration) {
  if (!activeProject || generation !== viewGeneration) return;
  const workspaceId = activeProject.workspace_id;
  workspaceFilesError = ''; renderWorkspaceFiles();
  try { const value = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`); if (generation !== viewGeneration || activeProject?.workspace_id !== workspaceId) return; const changed=workspaceFiles?.revision?.filesSha256!==value.revision?.filesSha256;workspaceFiles = value; servicePanel.savedRevision(workspaceId, value.revision);if(changed){void simulationPanel.reload();void comparisonPanel.reload();} }
  catch (error) { if (generation !== viewGeneration) return; workspaceFilesError = error.message; }
  renderWorkspaceFiles();
}

function renderWorkspaceDiff() {
  const box=$('#workspace-diff'),meta=$('#diff-meta');if(!box||!meta)return;box.replaceChildren();
  if(workspaceDiffError){meta.textContent='读取失败';const error=document.createElement('p');error.className='file-empty file-error';error.textContent=workspaceDiffError;box.append(error);return;}
  if(!workspaceDiff){meta.textContent='选择 Diff 后读取父版本差异';const empty=document.createElement('p');empty.className='file-empty';empty.textContent='尚未读取差异';box.append(empty);return;}
  if(!workspaceDiff.revision){meta.textContent='尚无 Turn 保存版本';const empty=document.createElement('p');empty.className='file-empty';empty.textContent='首个保存版本形成后，差异会显示在这里。';box.append(empty);return;}
  const summary=workspaceDiff.summary||{},changes=Array.isArray(workspaceDiff.changes)?workspaceDiff.changes:[];meta.textContent=`新增 ${summary.added||0} · 修改 ${summary.modified||0} · 删除 ${summary.deleted||0}`;
  for(const item of changes){if(!item||typeof item.path!=='string'||!['added','modified','deleted'].includes(item.change))continue;const row=document.createElement('div');row.className=`file-entry ${item.change}`;const path=document.createElement('span'),mark=document.createElement('b');mark.className='diff-mark';mark.textContent=item.change==='added'?'+ ':item.change==='deleted'?'− ':'~ ';path.append(mark,document.createTextNode(item.path));const detail=document.createElement('small');detail.textContent=item.type==='directory'?'目录':sizeLabel(item.size);row.append(path,detail);box.append(row);}
  if(!box.childElementCount){const empty=document.createElement('p');empty.className='file-empty';empty.textContent='与父版本相比没有文件变化。';box.append(empty);}
}

async function refreshWorkspaceDiff(generation=viewGeneration){if(!activeProject||generation!==viewGeneration)return;const workspaceId=activeProject.workspace_id;workspaceDiffError='';renderWorkspaceDiff();try{const value=await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/diff`);if(generation!==viewGeneration||activeProject?.workspace_id!==workspaceId)return;workspaceDiff=value;}catch(error){if(generation!==viewGeneration)return;workspaceDiffError=error.message;}renderWorkspaceDiff();}

function selectArtifactPanel(panel){workspaceArtifactPanel=panel==='diff'?'diff':'files';const diff=workspaceArtifactPanel==='diff';$('#files-tab').setAttribute('aria-selected',String(!diff));$('#diff-tab').setAttribute('aria-selected',String(diff));$('#files-view').hidden=diff;$('#diff-view').hidden=!diff;if(diff&&!workspaceDiff&&!workspaceDiffError)void refreshWorkspaceDiff(viewGeneration);}

async function readWorkspaceEvents(workspaceId) {
  const events = [];
  let cursor = 0;
  let historyTruncated = false;
  let oldestSequence = null;
  let lastCursor = -1;
  for (let pageNumber = 0; pageNumber < 12; pageNumber++) {
    const page = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/events?after_sequence=${cursor}&limit=200`);
    if (page.snapshotRequired) {
      if (!Number.isSafeInteger(page.oldestSequence) || page.oldestSequence < 1) throw new Error('事件保留窗口无效，请刷新项目。');
      const retainedCursor = page.oldestSequence - 1;
      if (retainedCursor <= cursor) throw new Error('事件保留窗口无法推进，请刷新项目。');
      historyTruncated = true;
      oldestSequence = page.oldestSequence;
      cursor = retainedCursor;
      continue;
    }
    if (page.hasMore && Number(page.nextSequence) <= cursor) throw new Error('事件读取没有进展，请刷新项目。');
    events.push(...page.events);
    cursor = page.nextSequence;
    if (!page.hasMore) return { events, cursor, snapshotRequired: false, historyTruncated, oldestSequence };
    if (cursor <= lastCursor) throw new Error('事件读取没有进展，请刷新项目。');
    lastCursor = cursor;
  }
  throw new Error('事件过多，请刷新项目后重试');
}

function connectEventStream(workspaceId, cursor, generation) {
  stopEventStream();
  if (!workspaceNeedsTurnUpdates() || document.hidden || generation !== viewGeneration) return;
  const source = new EventSource(`/api/workspaces/${encodeURIComponent(workspaceId)}/events?after_sequence=${cursor}`);
  eventSource = source;
  const eventTypes = ['turn.queued', 'turn.started', 'turn.cancel_requested', 'turn.checkpointing', 'turn.completed', 'turn.failed', 'turn.cancelled', 'turn.interrupted', 'assistant.delta', 'assistant.message', 'tool.started', 'tool.updated', 'tool.completed', 'provider.status'];
  for (const type of eventTypes) source.addEventListener(type, event => {
    if (source !== eventSource || generation !== viewGeneration) return;
    try {
      const value = JSON.parse(event.data);
      if (!workspaceEvents.some(item => item.eventId === value.eventId)) workspaceEvents.push(value);
      cursor = Math.max(cursor, Number(event.lastEventId || value.sequence || 0));
      renderWorkspace();
      if (['turn.completed', 'turn.failed', 'turn.cancelled', 'turn.interrupted'].includes(type)) void refreshWorkspace(generation);
    } catch { $('#message-error').textContent = '事件格式无效，请刷新项目。'; }
  });
  source.addEventListener('snapshot.required', () => {
    if (source !== eventSource || generation !== viewGeneration || snapshotRecovery) return;
    snapshotRecovery = true;
    stopEventStream();
    void refreshWorkspace(generation);
  });
  source.addEventListener('stream.closed', event => {
    if (source !== eventSource) return;
    let reason = 'temporarily_unavailable';
    try { reason = JSON.parse(event.data).reason; } catch {}
    stopEventStream();
    if (reason === 'authorization_changed') { void load(); return; }
    if (generation === viewGeneration && activeProject && !document.hidden) eventRetryTimer = setTimeout(() => void refreshWorkspace(generation), 1500);
  });
  source.onerror = () => {
    if (source !== eventSource) return;
    stopEventStream();
    if (generation === viewGeneration && activeProject && !document.hidden) eventRetryTimer = setTimeout(() => void refreshWorkspace(generation), 1500);
  };
}

async function refreshWorkspace(generation = viewGeneration) {
  if (!activeProject || generation !== viewGeneration) return;
  if(activeProject.status!=='ready')return;
  const workspaceId = activeProject.workspace_id;
  try {
    const [snapshot, replay] = await Promise.all([api(`/api/workspaces/${encodeURIComponent(workspaceId)}`), readWorkspaceEvents(workspaceId)]);
    if (generation !== viewGeneration || activeProject?.workspace_id !== workspaceId) return;
    workspaceSnapshot = snapshot;
    workspaceEvents = replay.events;
    workspaceHistoryTruncated = replay.historyTruncated === true;
    renderWorkspace();renderModelState();
    void refreshWorkspaceFiles(generation);
    workspaceDiff=null;workspaceDiffError='';renderWorkspaceDiff();if(workspaceArtifactPanel==='diff')void refreshWorkspaceDiff(generation);
    connectEventStream(workspaceId, replay.cursor, generation);
  } catch (error) {
    if (generation !== viewGeneration) return;
    $('#message-error').textContent = error.message;
  } finally {
    if (generation === viewGeneration) snapshotRecovery = false;
  }
}

function openWorkspace(project) {
  if (!project.workspace_id) return;
  stopPolling();
  stopEventStream();
  viewGeneration++;
  activeProject = project;observedModel=null;observedService=null;workspaceLayout.enter({tenantId:tenant.id,workspaceId:project.workspace_id});
  workspaceSnapshot = null;
  workspaceEvents = [];
  workspaceHistoryTruncated = false;
  workspaceFiles = null;
  workspaceFilesError = '';
  workspaceDiff = null;
  workspaceDiffError = '';
  workspaceArtifactPanel = 'files';
  const recovery = readConversation(recoveryKey(project.workspace_id));
  selectedSessionId = recovery.selectedSessionId || null;
  sessionIntent = recovery.sessionIntent || null;
  creatingSession = false;
  messageIntent = recovery.messageIntent || null;
  $('#message-input').value = messageIntent?.message ?? recovery.draft ?? '';
  $('#new-session').textContent = sessionIntent ? '重试新建对话' : '新建对话';
  if (location.hash !== `#/workspace/${encodeURIComponent(project.id)}`) history.replaceState(null, '', `#/workspace/${encodeURIComponent(project.id)}`);
  $('#workspace-title').textContent = project.title;
  const ready=project.status==='ready';
  $('#workspace-meta').textContent = ready?'研究工作区 · 模型与结果自动保存':'项目恢复中 · 已保存结果仍可查看';
  $('#message-input').disabled=!ready;$('#message-submit').disabled=true;$('#new-session').disabled=true;
  $('#session-select').disabled=!ready;$('#cancel-turn').hidden=true;
  $('#files-refresh').disabled=!ready;$('#files-tab').disabled=!ready;$('#diff-tab').disabled=!ready;
  $('#message-error').textContent = '';
  accountView();workspaceLayout.refresh();
  renderWorkspace();renderModelState();
  renderWorkspaceFiles();
  renderWorkspaceDiff();
  selectArtifactPanel('files');
  previewPanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id,canOpen:ready});
  servicePanel.open({workspaceId:project.workspace_id,tenantId:tenant.id,canStart:ready});
  if(ready){void simulationPanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id});void comparisonPanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id});}else{simulationPanel.leave();comparisonPanel.leave();}
  exportPanel.enter({workspaceId:project.workspace_id});
  void evidencePanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id});
  if(!ready){$('#turns').replaceChildren();appendTurnCard('system','项目暂未就绪。会话与文件恢复后可继续使用；独立服务可在下方管理。');$('#files-meta').textContent='项目暂未就绪';$('#workspace-files').replaceChildren();}
  void refreshWorkspace(viewGeneration);
}

async function renderProjects() {
  stopPolling();
  if (!tenant || document.hidden) return;
  const generation = viewGeneration;
  const requestNumber = ++listGeneration;
  const box = $('#projects');
  box.setAttribute('aria-busy', 'true');
  try {
    const data = await api(`/api/tenants/${encodeURIComponent(tenant.id)}/projects`);
    if (generation !== viewGeneration || requestNumber !== listGeneration) return;
    const projects = [...data.projects];
    const requestedProjectId = workspaceProjectIdFromHash();
    if (requestedProjectId) {
      const requested = projects.find(project => project.id === requestedProjectId && project.workspace_id);
      if (requested) { openWorkspace(requested); return; }
      history.replaceState(null, '', location.pathname + location.search);
      if (activeProject) {
        stopEventStream();
        activeProject = null;
        workspaceSnapshot = null;
        workspaceEvents = [];
        workspaceFiles = null;
        workspaceFilesError = '';
        selectedSessionId = null;
        sessionIntent = null;
        creatingSession = false;
        messageIntent = null;
        $('#new-session').textContent = '新建对话';
        accountView();
      }
      else accountView();
    }
    if (pendingProject) {
      const authoritative = projects.find(project => project.id === pendingProject.id);
      if (authoritative) pendingProject = null;
      else projects.unshift(pendingProject);
    }
    box.replaceChildren();
    if (!projects.length) {
      const empty = document.createElement('p');
      empty.className = 'meta';
      empty.textContent = '还没有项目，创建你的第一个项目。';
      box.append(empty);
    }
    for (const project of projects) {
      const card = document.createElement('article');
      card.className = 'card project';
      const open = document.createElement('button');
      open.className = 'project-open';
      open.type = 'button';
      open.disabled = !project.workspace_id;
      open.setAttribute('aria-label', project.status === 'ready' ? `打开项目 ${project.title}` : `管理项目 ${project.title}`);
      const title = document.createElement('h2');
      title.textContent = project.title;
      const status = document.createElement('span');
      const labels = { provisioning: '准备中', ready: '就绪', failed: '失败', deleting: '删除中' };
      status.className = `status ${Object.hasOwn(labels, project.status) ? project.status : ''}`;
      status.textContent = labels[project.status] || '未知';
      const detail = document.createElement('p');
      detail.className = 'meta';
      detail.textContent = project.source_model_id && project.source_model_version ? `官方版本 · 独立副本 · ${project.source_model_id}@${project.source_model_version}` : '空白项目';
      open.append(title, status, detail);
      if (!open.disabled) open.onclick = () => openWorkspace(project);
      card.append(open);
      box.append(card);
    }
    if (projects.some(project => project.status === 'provisioning')) {
      if (Date.now() >= pollDeadline) {
        show('项目仍在准备中，已停止自动刷新。', false, { label: '刷新', run: () => {
          pollDeadline = Date.now() + POLL_WINDOW_MS;
          show('');
          void renderProjects();
        } });
      } else if (!document.hidden) {
        pollTimer = setTimeout(renderProjects, 3000);
      }
    }
  } catch (error) {
    if (generation !== viewGeneration || requestNumber !== listGeneration) return;
    if (error.status === 401) {
      authenticated = false;
      tenant = null;
      viewGeneration++;
      box.replaceChildren();
      accountView();
    }
    show(error.message, true);
  } finally {
    if (generation === viewGeneration && requestNumber === listGeneration) box.setAttribute('aria-busy', 'false');
  }
}

function workspaceProjectIdFromHash() {
  const match = location.hash.match(/^#\/workspace\/([^/]+)$/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

async function load() {
  servicePanel.close();previewPanel.leave();simulationPanel.leave();comparisonPanel.leave();exportPanel.leave();evidencePanel.leave();
  const generation = ++viewGeneration;
  stopPolling();
  stopEventStream();
  activeProject = null;
  workspaceSnapshot = null;
  workspaceEvents = [];
  workspaceFiles = null;
  workspaceFilesError = '';
  try {
    const session = await api('/api/auth/get-session');
    if (generation !== viewGeneration) return;
    authenticated = Boolean(session?.user);
    tenant = null;
    accountView();
    if (!authenticated) return;
    const user = await api('/api/me');
    if (generation !== viewGeneration) return;
    tenant = user.tenants[0] || null;
    accountView();
    pollDeadline = Date.now() + POLL_WINDOW_MS;
    if (tenant) { await Promise.all([renderProjects(), loadModels()]); }
  } catch (error) {
    if (generation !== viewGeneration) return;
    accountView();
    show(error.status === 404 && authenticated ? '输入邀请码，启用你的个人空间。' : error.message, error.status !== 404);
  }
}

$('#google').onclick = async () => {
  try {
    const data = await api('/api/auth/sign-in/social', { method: 'POST', body: JSON.stringify({ provider: 'google', callbackURL: location.origin + '/' }) });
    if (data?.url) location.assign(data.url);
  } catch (error) { show(error.message, true); }
};

$('#sign-out').onclick = async () => {
  viewGeneration++;
  servicePanel.close();previewPanel.leave();simulationPanel.leave();comparisonPanel.leave();exportPanel.leave();evidencePanel.leave();
  stopEventStream();
  stopPolling();
  const button = $('#sign-out');
  button.disabled = true;
  try {
    await api('/api/auth/sign-out', { method: 'POST', body: '{}' });
    authenticated = false;
    tenant = null;
    activeProject = null;
    workspaceSnapshot = null;
    workspaceEvents = [];
    workspaceFiles = null;
    workspaceFilesError = '';
    intent = null;
    sessionIntent = null;
    creatingSession = false;
    messageIntent = null;
    $('#new-session').textContent = '新建对话';
    pendingProject = null;
    pollDeadline = 0;
    history.replaceState(null, '', location.pathname + location.search);
    $('#projects').replaceChildren();
    accountView();
    show('已退出登录。');
  } catch (error) { if(authenticated&&tenant&&activeProject){previewPanel.enter({workspaceId:activeProject.workspace_id,tenantId:tenant.id,canOpen:activeProject.status==='ready'});servicePanel.open({workspaceId:activeProject.workspace_id,tenantId:tenant.id,canStart:activeProject.status==='ready'});void refreshWorkspace(viewGeneration);}show(error.message, true); }
  finally { button.disabled = false; }
};

document.addEventListener('visibilitychange', () => {
  stopPolling();
  stopEventStream();
  listGeneration++;
  if (!document.hidden && activeProject) void refreshWorkspace(viewGeneration);
  else if (!document.hidden && tenant) void renderProjects();
});

window.addEventListener('hashchange', () => {
  if (workspaceProjectIdFromHash()) { if (tenant) void renderProjects(); }
  else if (activeProject) $('#workspace-back').click();
});

$('#workspace-back').onclick = () => {
  viewGeneration++;
  stopEventStream();
  activeProject = null;
  workspaceSnapshot = null;
  workspaceEvents = [];
  workspaceFiles = null;
  workspaceFilesError = '';
  selectedSessionId = null;
  sessionIntent = null;
  creatingSession = false;
  messageIntent = null;
  $('#new-session').textContent = '新建对话';
  history.replaceState(null, '', location.pathname + location.search);
  $('#message-error').textContent = '';
  accountView();
  pollDeadline = Date.now() + POLL_WINDOW_MS;
  void renderProjects();
};

$('#message-input').addEventListener('input', () => {
  if (!activeProject || !tenant || messageIntent) return;
  try { saveConversation(recoveryKey(activeProject.workspace_id), {draft:$('#message-input').value}); } catch (error) { $('#message-error').textContent = error.message; }
});

$('#session-select').onchange = () => {
  if (messageIntent || sessionIntent || !workspaceSnapshot?.sessions?.[$('#session-select').value]) return;
  selectedSessionId = $('#session-select').value;
  renderWorkspace();
};

$('#files-refresh').onclick = () => void (workspaceArtifactPanel==='diff'?refreshWorkspaceDiff(viewGeneration):refreshWorkspaceFiles(viewGeneration));
$('#files-tab').onclick=()=>selectArtifactPanel('files');
$('#diff-tab').onclick=()=>selectArtifactPanel('diff');

$('#new-session').onclick = async () => {
  if (!canSubmitConversation() || creatingSession || messageIntent) return;
  const workspaceId = activeProject.workspace_id;
  sessionIntent ??= { key: crypto.randomUUID(), title: `Session ${Object.keys(workspaceSnapshot?.sessions || {}).length + 1}` };
  const current = sessionIntent, savedKey = recoveryKey(workspaceId);
  const button = $('#new-session'); creatingSession = true; button.disabled = true;
  $('#message-error').textContent = '';
  try {
    saveConversation(savedKey, {sessionIntent:current, draft:$('#message-input').value});
    const created = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`, { method: 'POST', headers: { 'Idempotency-Key': current.key }, body: JSON.stringify({ title: current.title }) });
    if (activeProject?.workspace_id !== workspaceId) return;
    saveConversation(savedKey, {selectedSessionId:created.session.id, sessionIntent:null});
    selectedSessionId = created.session.id; sessionIntent = null;
    button.textContent = '新建对话';
    await refreshWorkspace(viewGeneration);
  } catch (error) { if (activeProject?.workspace_id === workspaceId) { $('#message-error').textContent = error.message; button.textContent = '重试新建 Session'; } }
  finally { creatingSession = false; button.disabled = !canSubmitConversation() || Boolean(messageIntent); }
};

$('#message-form').onsubmit = async event => {
  event.preventDefault();
  if (sendingMessage || !canSubmitConversation()) return;
  const text = messageIntent?.message ?? $('#message-input').value.trim();
  if (!text) return;
  if (messageIntent && encodedTurnRequestBytes(text) > TURN_REQUEST_MAX_BYTES) {
    const oversized = messageIntent;
    saveConversation(recoveryKey(activeProject.workspace_id), {messageIntent:null, selectedSessionId:oversized.sessionId, draft:oversized.message});
    messageIntent = null;
    $('#message-input').value = oversized.message;
    $('#message-input').readOnly = false;
    $('#message-submit').textContent = '发送';
    $('#message-error').textContent = `请求内容过大，请缩短后重试（最多 ${TURN_REQUEST_MAX_BYTES} 字节）。`;
    return;
  }
  if (encodedTurnRequestBytes(text) > TURN_REQUEST_MAX_BYTES) {
    $('#message-error').textContent = `请求内容过大，请缩短后重试（最多 ${TURN_REQUEST_MAX_BYTES} 字节）。`;
    return;
  }
  const generation = viewGeneration;
  const workspaceId = activeProject.workspace_id, savedKey = recoveryKey(workspaceId);
  let attemptedIntent = null;
  let turnAccepted = false;
  sendingMessage = true;
  $('#message-submit').disabled = true;
  $('#message-error').textContent = '';
  try {
    saveConversation(savedKey, {draft:text});
    if (!messageIntent && (sessionIntent || !selectedSessionId)) {
      sessionIntent ??= { key: crypto.randomUUID(), title: '主对话' };
      saveConversation(savedKey, {sessionIntent});
      const created = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`, { method: 'POST', headers: { 'Idempotency-Key': sessionIntent.key }, body: JSON.stringify({ title: sessionIntent.title }) });
      if (generation !== viewGeneration) return;
      saveConversation(savedKey, {selectedSessionId:created.session.id, sessionIntent:null});
      selectedSessionId = created.session.id;
      sessionIntent = null;
    }
    messageIntent ??= { key: crypto.randomUUID(), sessionId: selectedSessionId, message: text };
    const current = messageIntent;
    saveConversation(savedKey, {messageIntent:current, selectedSessionId:current.sessionId, draft:current.message});
    $('#message-input').readOnly = true;
    attemptedIntent = current;
    await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(current.sessionId)}/turns`, { method: 'POST', headers: { 'Idempotency-Key': current.key }, body: JSON.stringify({ message: current.message }) });
    turnAccepted = true;
    if (readConversation(savedKey).messageIntent?.key === current.key) saveConversation(savedKey, {messageIntent:null,draft:''});
    if (generation !== viewGeneration) return;
    messageIntent = null;
    $('#message-input').value = '';
    $('#message-submit').textContent = '发送';
    await refreshWorkspace(generation);
  } catch (error) {
    if (generation !== viewGeneration) return;
    if (!turnAccepted && ((error.status === 400 && error.code === 'invalid_input') || (error.status === 413 && error.code === 'body_too_large')) && attemptedIntent && messageIntent?.key === attemptedIntent.key) {
      saveConversation(savedKey, {messageIntent:null, selectedSessionId:attemptedIntent.sessionId, draft:attemptedIntent.message});
      messageIntent = null;
    }
    $('#message-error').textContent = error.message;
    $('#message-submit').textContent = messageIntent ? '重试' : '发送';
  } finally {
    sendingMessage = false;
    $('#message-input').readOnly = Boolean(messageIntent);
    $('#message-submit').disabled = !canSubmitConversation();
  }
};

$('#cancel-turn').onclick = async () => {
  if (!activeProject || !$('#cancel-turn').dataset.turnId) return;
  const generation = viewGeneration;
  const button = $('#cancel-turn');
  button.disabled = true;
  $('#message-error').textContent = '';
  try {
    await api(`/api/workspaces/${encodeURIComponent(activeProject.workspace_id)}/turns/${encodeURIComponent(button.dataset.turnId)}/cancel`, { method: 'POST', body: '{}' });
    if (generation === viewGeneration) await refreshWorkspace(generation);
  } catch (error) { if (generation === viewGeneration) $('#message-error').textContent = error.message; }
  finally { button.disabled = false; }
};

$('#invite-form').onsubmit = async event => {
  event.preventDefault();
  const token = $('#invite-token').value.trim();
  if (!token) return;
  try {
    const accepted = await api('/api/invitations/accept', { method: 'POST', body: JSON.stringify({ token }) });
    $('#invite-token').value = '';
    show('邀请已接受。');
    tenant = { id: accepted.tenantId };
    accountView();
    pollDeadline = Date.now() + POLL_WINDOW_MS;
    await Promise.all([renderProjects(), loadModels()]);
  } catch (error) { show(error.message, true); }
};

function openProjectDialog(model = null) {
  intent = null;
  $('#project-title').value = '';
  $('#project-title').disabled = false;
  $('#project-error').textContent = '';
  $('#project-model').disabled = false;
  $('#project-model').value = model?.model_id && model?.version ? `${model.model_id}@${model.version}` : '';
  $('#project-submit').textContent = '创建';
  dialog.showModal();
}
$('#new-project').onclick = () => openProjectDialog();
function closeDialog() { if (!creating) dialog.close(); }
$('#project-close').onclick = closeDialog;
$('#project-cancel').onclick = closeDialog;
dialog.addEventListener('cancel', event => { if (creating) event.preventDefault(); });

$('#project-form').onsubmit = async event => {
  event.preventDefault();
  if (creating || !tenant) return;
  const title = $('#project-title').value.trim();
  if (!title) return;
  const selectedModel = $('#project-model').selectedOptions[0];
  const payload = selectedModel?.dataset.modelId ? { title, modelId: selectedModel.dataset.modelId, modelVersion: selectedModel.dataset.modelVersion } : { title, starterVersion: 'blank-v1' };
  intent ??= { key: crypto.randomUUID(), tenantId: tenant.id, payload };
  const current = intent;
  const generation = viewGeneration;
  creating = true;
  $('#project-submit').disabled = true;
  $('#project-title').disabled = true;
  $('#project-model').disabled = true;
  $('#project-error').textContent = '';
  try {
    const result = await api(`/api/tenants/${encodeURIComponent(current.tenantId)}/projects`, {
      method: 'POST', headers: { 'Idempotency-Key': current.key }, body: JSON.stringify(current.payload),
    });
    if (generation !== viewGeneration) return;
    dialog.close();
    intent = null;
    pendingProject = result.project;
    show(result.project.status === 'provisioning' ? '项目正在准备中。' : '项目已创建。');
    pollDeadline = Date.now() + POLL_WINDOW_MS;
    await renderProjects();
  } catch (error) {
    if (generation !== viewGeneration) return;
    $('#project-error').textContent = error.message;
    $('#project-submit').textContent = '重试';
  } finally {
    creating = false;
    $('#project-submit').disabled = false;
  }
};
$('#models-refresh').onclick = () => void loadModels();
void load();
