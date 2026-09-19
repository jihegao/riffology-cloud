import {createBrowserPreviewPanel,browserPreviewRoute} from './browser-preview.js';
import {isAcceptanceProject,projectModelSummary} from './project-status.js';
import {createPublicationPanel} from './publication.js';
import {createExportPanel} from './export.js';
import {createEvidencePanel} from './evidence.js';
import {createWorkspaceLayout} from './layout.js';
import {createServicePanel} from './services.js';
import {createPreviewPanel} from './previews.js';
import {createComparisonPanel} from './comparison.js';
import {createSimulationPanel} from './simulation.js';
const $ = selector => document.querySelector(selector);
function filterProjectCards(){const filter=$('#project-filter')?.value??'all',search=($('#project-search')?.value??'').toLowerCase();for(const card of document.querySelectorAll('#projects .project'))card.hidden=!card.dataset.title.toLowerCase().includes(search)||(filter==='ordinary'&&card.dataset.acceptance==='true')||(filter==='acceptance'&&card.dataset.acceptance!=='true')||(filter==='preview'&&card.dataset.previewReady!=='true');}
$('#project-filter')?.addEventListener('change',filterProjectCards);$('#project-search')?.addEventListener('input',filterProjectCards);
async function loadProjectSummaries(jobs,generation,requestNumber){let next=0;async function lane(){while(next<jobs.length&&generation===viewGeneration&&requestNumber===listGeneration){const {project,card,summary}=jobs[next++];if(!project.workspace_id||project.status!=='ready'){summary.textContent='工作区尚未就绪；模型状态暂未读取。';continue;}const base=`/api/workspaces/${encodeURIComponent(project.workspace_id)}`;const [model,preview]=await Promise.all(['/model','/browser-preview'].map(s=>api(base+s,{signal:AbortSignal.timeout(15000)}).catch(()=>null)));if(generation!==viewGeneration||requestNumber!==listGeneration||!card.isConnected)return;const value=projectModelSummary(model,preview);summary.textContent=value.text;card.dataset.previewReady=String(value.previewReady);filterProjectCards();}}await Promise.all([lane(),lane()]);}
const workspaceLayout=createWorkspaceLayout({root:$('#workspace')});
let observedModel=null,observedService=null;
let executionAvailability={service:false,preview:false,simulation:false};
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
    text='模型已保存。本地预览兼容性见下方；云端运行状态独立显示。';
  }
  status.dataset.state=state;status.textContent=text;
}
const browserPreviewPanel=createBrowserPreviewPanel({root:$('#workspace-browser-preview'),api,onVerified:()=>{void simulationPanel.reload();void comparisonPanel.reload();}});
const previewPanel=createPreviewPanel({root:$('#workspace-preview'),api,autoRestore:true,onState:value=>{const pinned=value.available?.runId||value.current?.runId;if(pinned)servicePanel.selectRun(pinned);}});
const servicePanel=createServicePanel({root:$('#workspace-services'),inspectRoot:$('#workspace-runtime-details'),api,workspaceMode:true,onPreparingRun:runId=>previewPanel.prepareRun(runId),onPreviewRun:(runId,options)=>options?.automatic?previewPanel.restoreRun(runId):previewPanel.openRun(runId),onState:detail=>{observedService=detail;renderModelState();if(detail.stopRequestedAt||['stopped','failed','cancelled'].includes(detail.runStatus))previewPanel.stoppedRun(detail.runId);}});
const comparisonPanel=createComparisonPanel({root:$('#workspace-comparison'),api});
const publicationPanel=createPublicationPanel({root:$('#workspace-publication'),api});
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
let pendingProjectTenantId = null;
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
let workspaceFiles = null, filesReadEpoch = 0, diffReadEpoch = 0;
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

let projectNotice = null;
function show(message, error = false, action = null, project = null) {
  projectNotice = project ? {...project,tenantId:tenant?.id,kind:project.kind||'preparing'} : null;
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

function syncProjectNotice(projects) {
  if (!projectNotice || projectNotice.tenantId !== tenant?.id || projectNotice.kind !== 'preparing') return;
  const project = projects.find(item => item.id === projectNotice.id);
  if (!project) return;
  if (project.status === 'ready') show('');
  else if (project.status === 'failed') show('项目准备失败。请刷新项目状态后重试。', true, {label:'刷新',run:()=>void renderProjects()});
}
function scheduleProjectRefresh(projects) {
  const preparing = projects.find(project => project.status === 'provisioning');
  if (!preparing) return;
  if (notice.hidden) show('项目正在准备中。',false,null,{id:preparing.id});
  if (Date.now() >= pollDeadline) {
    // A project timeout must not overwrite an unrelated error or notice.
    if (!projectNotice || projectNotice.tenantId !== tenant?.id || projectNotice.id !== preparing.id) return;
    show('项目准备状态确认超时，已停止自动刷新。', false, {label:'刷新',run:()=>{
      pollDeadline=Date.now()+POLL_WINDOW_MS;
      show('项目正在准备中。',false,null,{id:preparing.id});
      void renderProjects();
    }}, {id:preparing.id,kind:'timeout'});
  } else if (!document.hidden) pollTimer=setTimeout(renderProjects,3000);
}

function renderResearchStart() {
  const button = $('#start-queue'), status = $('#queue-start-status');
  if (!button || !status) return;
  const available = modelsStatus === 'ready' && models.some(model => model.model_id === 'queue-research');
  button.disabled = !available;
  status.textContent = modelsStatus === 'loading' ? '正在检查官方案例…'
    : modelsStatus === 'error' ? '暂时无法读取案例目录，请刷新目录。'
    : available ? '已发布的 Queue 版本见下方目录；选择版本后创建独立副本。'
    : 'Queue 官方案例尚未发布。你可以先描述自己的研究问题。';
}

function renderModels() {
  renderResearchStart();
  const box = $('#models');
  const status = $('#models-status');
  if (!box || !status) return;
  box.replaceChildren();
  if (modelsStatus === 'loading') { status.textContent = '正在加载官方模型…'; return; }
  if (modelsStatus === 'error') { status.textContent = '官方模型暂时不可用，仍可创建空白项目。'; return; }
  if (!models.length) { status.textContent = '当前暂无可用的官方模型。'; return; }
  status.textContent = '选择固定版本开始独立项目。';
  for (const model of models) {
    const card = document.createElement('article'); card.className = 'model-card'; card.dataset.modelId = model.model_id; card.tabIndex = -1;
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

function managedBlockMessage(code) {
  const messages = {
    'managed-execution-unknown': '上一轮曾出现执行状态未确认，项目已暂停接收新请求；需要核对原任务后恢复，重复发送不会解除暂停。',
    'managed-usage-unknown': '上一轮用量尚未确认，项目已暂停接收新请求；需要核对原任务后恢复，稍后重试不会自动解除暂停。',
    'managed-original-unresolved': '上一轮执行或用量尚未确认，当前不能开始新任务。',
    'managed-cleanup-unconfirmed': '上一轮远端会话清理尚未确认，当前不能开始新任务。',
    'managed-input-in-flight': '上一轮仍在执行或确认资源释放，请等它结束后再发送。',
    'managed-session-base-unavailable': '当前对话的远端会话已不可继续，需要恢复会话后才能发送。',
    'managed-session-limit-or-cleanup-pending': '当前还有需要清理的远端会话，或已达到此项目的会话上限。',
    'managed-admission-denied': '当前项目的执行策略尚未开放。账号测试模式不会自动重开历史受控项目。',
    'managed-policy-immutable': '当前项目绑定的执行策略与环境配置不一致，需要管理员处理。',
    'managed-route-existing-turn-history': '这个历史项目使用原执行路径，不能直接切换到当前测试模式。',
    'managed-observation-failed': '上一轮运行状态读取失败，项目已暂停，需要核对原任务后恢复。',
  };
  if (messages[code]) return messages[code];
  if (['managed-window-expired','managed-turn-limit','managed-observed-cost-limit','managed-reservation-limit','managed-observed-cost-exceeds-hold'].includes(code)) return '此历史项目的受控运行额度或期限已触发停止；账号测试模式不会重置原策略。';
  return null;
}

async function api(path, options = {}) {
  const {responseType,onProgress,...fetchOptions}=options;
  const response = await fetch(path, {
    credentials: 'same-origin', ...fetchOptions,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const projectLimit = response.status === 429 && path.startsWith('/api/workspaces/');
    let code = null;
    try { const body = await response.clone().json(); if (typeof body?.error === 'string') code = body.error; } catch {}
    const messages = { 400: '请求内容无效', 401: '请先登录', 403: '登录或项目权限已变化，请刷新后重试', 404: '当前账号尚未获得访问权限', 409: '状态已变化，请刷新后重试', 413: '请求内容过大，请缩短后重试', 429: projectLimit ? '本项目已达到当前费用或运行上限' : '请求过于频繁，请稍后重试', 503: '服务暂不可用，请稍后再试' };
    if (code === 'g5_admission_disabled') messages[409] = '当前环境已暂停创建项目，请联系管理员恢复开放。刷新页面无法解除此限制。';
    if (code === 'turn_runtime_not_ready') messages[503] = '当前环境暂停接收新任务，请稍后查看状态。';
    const blocked = managedBlockMessage(code);
    throw Object.assign(new Error(blocked || messages[response.status] || '请求失败，请稍后重试'), { status: response.status, code, retryable: !blocked && code !== 'turn_runtime_not_ready' });
  }
  if(responseType==='bytes'){const length=Number(response.headers.get('content-length'));if(length>33554432)throw Error('资源过大');if(typeof onProgress==='function'&&response.body){const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>33554432)throw Error('资源过大');chunks.push(value);onProgress(size,length);}}catch(error){await reader.cancel().catch(()=>{});throw error;}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;}const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>33554432)throw Error('资源过大');return bytes;}
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
  if(!authenticated||!tenant||!activeProject){servicePanel.close();previewPanel.leave();browserPreviewPanel.leave();simulationPanel.leave();comparisonPanel.leave();exportPanel.leave();publicationPanel.leave();evidencePanel.leave();}
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
  if (turn.persistenceOutcome === 'saved') return `${labels[turn.status] || turn.status} · ${turn.status === 'completed' ? '已保存' : '恢复状态已保存（不代表建模完成）'}`;
  return labels[turn.status] || turn.status;
}

function managedAccountingSummary(payload) {
  if (payload?.backend !== 'managed-agents') return null;
  const usage = payload.usage;
  const observed = usage?.status === 'observed' && ['inputTokens','outputTokens','totalTokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0) && usage.inputTokens + usage.outputTokens === usage.totalTokens;
  return {
    usage: observed ? `Managed 用量已观测：输入 ${usage.inputTokens} Token，输出 ${usage.outputTokens} Token。` : 'Managed 用量尚未确认。',
    detail: '费用尚未结算；执行完成或已保存不代表正式实验通过。' + (payload.resources === 'session-retained' ? ' 回合结束时远端会话仍保留，删除状态需单独确认。' : ' 远端资源状态需单独确认。'),
  };
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
  if (workspaceSnapshot.managedState?.stopped) {
    appendTurnCard('system', managedBlockMessage(workspaceSnapshot.managedState.stopped) || '项目因上一轮异常暂停接收新请求，需要核对后恢复。');
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
    const managedStatus = events.findLast?.(event => event.type === 'provider.status' && event.payload?.backend === 'managed-agents');
    const accounting = managedAccountingSummary(managedStatus?.payload);
    if (accounting) appendTurnCard('system', accounting.usage, accounting.detail);
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
  meta.textContent = `版本 ${workspaceFiles.revision.revisionId} · ${files.length} 项 · 保存于 ${new Date(workspaceFiles.revision.committedAt).toLocaleString('zh-CN', { hour12: false })}`;
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
  const workspaceId=activeProject.workspace_id,epoch=++filesReadEpoch,valid=()=>generation===viewGeneration&&activeProject?.workspace_id===workspaceId&&epoch===filesReadEpoch;
  workspaceFilesError='';renderWorkspaceFiles();
  try{const value=await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`);if(!valid())return;
    const changed=workspaceFiles?.revision?.filesSha256!==value.revision?.filesSha256||workspaceFiles?.revision?.revisionId!==value.revision?.revisionId;
    workspaceFiles=value;servicePanel.savedRevision(workspaceId,value.revision);
    if(changed){browserPreviewPanel.savedRevision();diffReadEpoch++;workspaceDiff=null;workspaceDiffError='';renderWorkspaceDiff();if(workspaceArtifactPanel==='diff')void refreshWorkspaceDiff(generation);void simulationPanel.reload();void comparisonPanel.reload();}
  }catch(error){if(!valid())return;workspaceFilesError=error.message;}
  if(valid())renderWorkspaceFiles();
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

async function refreshWorkspaceDiff(generation=viewGeneration){
  if(!activeProject||generation!==viewGeneration)return;const workspaceId=activeProject.workspace_id,epoch=++diffReadEpoch,valid=()=>generation===viewGeneration&&activeProject?.workspace_id===workspaceId&&epoch===diffReadEpoch;
  workspaceDiffError='';renderWorkspaceDiff();try{const value=await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/diff`);if(!valid())return;workspaceDiff=value;}catch(error){if(!valid())return;workspaceDiffError=error.message;}if(valid())renderWorkspaceDiff();
}

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
  if (project.status === 'provisioning' && notice.hidden) show('项目正在准备中。',false,null,{id:project.id});
  syncProjectNotice([project]);
  scheduleProjectRefresh([project]);
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
  const browserRoute=browserPreviewRoute(location);
  const standalone=browserRoute?.projectId===project.id;
  $('#workspace').classList.toggle('browser-preview-standalone',standalone);
  if (!standalone&&location.hash !== `#/workspace/${encodeURIComponent(project.id)}`) history.replaceState(null, '', `#/workspace/${encodeURIComponent(project.id)}`);
  $('#workspace-title').textContent = project.title;
  $('#workspace-title').title = project.title;
  const ready=project.status==='ready';
  $('#workspace-meta').textContent = ready?'研究工作区 · 模型与结果自动保存':project.status==='provisioning'?'项目准备中 · 自动刷新状态':'项目恢复中 · 已保存结果仍可查看';
  $('#message-input').disabled=!ready;$('#message-submit').disabled=true;$('#new-session').disabled=true;
  $('#session-select').disabled=!ready;$('#cancel-turn').hidden=true;
  $('#files-refresh').disabled=!ready;$('#files-tab').disabled=!ready;$('#diff-tab').disabled=!ready;
  $('#message-error').textContent = '';
  accountView();workspaceLayout.refresh();
  renderWorkspace();renderModelState();
  renderWorkspaceFiles();
  renderWorkspaceDiff();
  selectArtifactPanel('files');
  if(standalone)workspaceLayout.select('preview');
  void browserPreviewPanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id,projectId:project.id,canOpen:ready,canVerify:executionAvailability.simulation,standalone,...(standalone?browserRoute:{})});
  if(standalone){servicePanel.close();previewPanel.leave();simulationPanel.leave();comparisonPanel.leave();exportPanel.leave();publicationPanel.leave();evidencePanel.leave();return;}
  previewPanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id,canOpen:ready&&executionAvailability.preview,paused:!executionAvailability.preview});
  servicePanel.open({workspaceId:project.workspace_id,tenantId:tenant.id,canStart:ready&&executionAvailability.service});
  if(ready){void simulationPanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id});void comparisonPanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id});}else{simulationPanel.leave();comparisonPanel.leave();}
  exportPanel.enter({workspaceId:project.workspace_id});publicationPanel.enter({workspaceId:project.workspace_id});
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
    if (pendingProject && pendingProjectTenantId !== tenant.id) pendingProject = null;
    syncProjectNotice(projects);
    if (pendingProject && projects.some(project => project.id === pendingProject.id)) pendingProject = null;
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
    const summaryJobs=[];
    for (const project of projects) {
      const card = document.createElement('article');
      card.className = 'card project';
      card.dataset.title=project.title;card.dataset.acceptance=String(isAcceptanceProject(project.title));card.dataset.previewReady='false';
      const open = document.createElement('button');
      open.className = 'project-open';
      open.type = 'button';
      open.disabled = !project.workspace_id;
      open.setAttribute('aria-label', project.status === 'ready' ? `打开项目 ${project.title}` : `管理项目 ${project.title}`);
      const title = document.createElement('h2');
      title.textContent = project.title;
      const status = document.createElement('span');
      const labels = { provisioning: '工作区准备中', ready: '工作区已创建', failed: '工作区准备失败', deleting: '删除中' };
      status.className = `status ${Object.hasOwn(labels, project.status) ? project.status : ''}`;
      status.textContent = labels[project.status] || '未知';
      const detail = document.createElement('p');
      detail.className = 'meta';
      detail.textContent = project.source_model_id && project.source_model_version ? `官方版本 · 独立副本 · ${project.source_model_id}@${project.source_model_version}` : '从空白创建 · 当前模型状态见下方';
      open.append(title, status, detail);
      const summary=document.createElement('p');summary.className='meta';summary.textContent='正在读取模型与本地预览状态…';open.append(summary);summaryJobs.push({project,card,summary});
      if(isAcceptanceProject(project.title)){const tag=document.createElement('span');tag.className='meta';tag.textContent='验收／调试（按标题）';open.append(tag);}
      if (!open.disabled) open.onclick = () => openWorkspace(project);
      card.append(open);
      box.append(card);
    }
    scheduleProjectRefresh(projects);
    filterProjectCards();void loadProjectSummaries(summaryJobs,generation,requestNumber);
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
  const browserRoute=browserPreviewRoute(location);if(browserRoute)return browserRoute.projectId;
  const match = location.hash.match(/^#\/workspace\/([^/]+)$/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

async function load() {
  servicePanel.close();previewPanel.leave();browserPreviewPanel.leave();simulationPanel.leave();comparisonPanel.leave();exportPanel.leave();publicationPanel.leave();evidencePanel.leave();
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
    executionAvailability={service:user.execution?.service===true,preview:user.execution?.preview===true,simulation:user.execution?.simulation===true};
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
    const data = await api('/api/auth/sign-in/social', { method: 'POST', body: JSON.stringify({ provider: 'google', callbackURL: location.origin + '/' + (browserPreviewRoute(location)?location.hash:'') }) });
    if (data?.url) location.assign(data.url);
  } catch (error) { show(error.message, true); }
};

$('#sign-out').onclick = async () => {
  viewGeneration++;
  servicePanel.close();previewPanel.leave();browserPreviewPanel.leave();simulationPanel.leave();comparisonPanel.leave();exportPanel.leave();publicationPanel.leave();evidencePanel.leave();
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
  } catch (error) { if(authenticated&&tenant&&activeProject){previewPanel.enter({workspaceId:activeProject.workspace_id,tenantId:tenant.id,canOpen:activeProject.status==='ready'&&executionAvailability.preview,paused:!executionAvailability.preview});servicePanel.open({workspaceId:activeProject.workspace_id,tenantId:tenant.id,canStart:activeProject.status==='ready'&&executionAvailability.service});void refreshWorkspace(viewGeneration);}show(error.message, true); }
  finally { button.disabled = false; }
};

document.addEventListener('visibilitychange', () => {
  stopPolling();
  stopEventStream();
  listGeneration++;
  if (!document.hidden && activeProject?.status === 'provisioning') void renderProjects();
  else if (!document.hidden && activeProject) void refreshWorkspace(viewGeneration);
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
$('#start-question')?.addEventListener('click', () => openProjectDialog());
$('#start-queue')?.addEventListener('click', () => {
  if (modelsStatus !== 'ready') return;
  const card = [...document.querySelectorAll('#models .model-card')].find(value => value.dataset.modelId === 'queue-research');
  if (card) { card.scrollIntoView({block:'center'}); card.focus(); }
});
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
    pendingProjectTenantId = current.tenantId;
    show(result.project.status === 'provisioning' ? '项目正在准备中。' : '项目已创建。',false,null,result.project.status==='provisioning'?{id:result.project.id}:null);
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
