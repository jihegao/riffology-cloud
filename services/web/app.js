import {bindValue,bindAttribute} from './i18n-bindings.js';
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
import {createVerifyHandoffPanel} from './verify-handoff.js';
import {applyTranslations,getLocale,installLocaleSelector,setLocale,subscribe,t,msg,uiError,errorMessage,formatDate,formatNumber} from './i18n.js';
import {createLocalePreferenceController} from './locale-preference.js';
const $ = selector => document.querySelector(selector);
function filterProjectCards(){const filter=$('#project-filter')?.value??'all',search=($('#project-search')?.value??'').toLowerCase();for(const card of document.querySelectorAll('#projects .project'))card.hidden=!card.dataset.title.toLowerCase().includes(search)||(filter==='ordinary'&&card.dataset.acceptance==='true')||(filter==='acceptance'&&card.dataset.acceptance!=='true')||(filter==='preview'&&card.dataset.previewReady!=='true');}
let listedArchiveView=false;
$('#project-filter')?.addEventListener('change',()=>{const archived=$('#project-filter').value==='archived';if(archived!==listedArchiveView){listedArchiveView=archived;projectPageBefore=null;projectPageStack=[];void renderProjects();}else filterProjectCards();});$('#project-search')?.addEventListener('input',filterProjectCards);
async function loadProjectSummaries(jobs,generation,requestNumber){let next=0;async function lane(){while(next<jobs.length&&generation===viewGeneration&&requestNumber===listGeneration){const {project,card,summary}=jobs[next++];if(!project.workspace_id||project.status!=='ready'){bindValue(summary, () => (msg('workspace.summary.unready')));continue;}const base=`/api/workspaces/${encodeURIComponent(project.workspace_id)}`;const [model,preview]=await Promise.all(['/model','/browser-preview'].map(s=>api(base+s,{signal:AbortSignal.timeout(15000)}).catch(()=>null)));if(generation!==viewGeneration||requestNumber!==listGeneration||!card.isConnected)return;const value=projectModelSummary(model,preview);bindValue(summary, () => (value.text));card.dataset.previewReady=String(value.previewReady);filterProjectCards();}}await Promise.all([lane(),lane()]);}
const workspaceLayout=createWorkspaceLayout({root:$('#workspace')});
let observedModel=null,observedService=null;
let executionAvailability={service:false,preview:false,simulation:false};
function renderModelState(){
  const status=$('#workspace-model-status');if(!status)return;
  const active=workspaceSnapshot?.activeTurnId&&workspaceSnapshot.turns?.[workspaceSnapshot.activeTurnId];
  let state='ready',text=msg('workspace.model.empty');
  if(active&&!['completed','failed','cancelled','interrupted'].includes(active.status)){
    state='building';text=msg('workspace.model.building');
  }else if(observedService&&['stopped','failed','cancelled'].includes(observedService.runStatus)){
    state=observedService.runStatus==='failed'?'failed':'stopped';text=msg('workspace.model.stopped');
  }else if(observedService?.stopRequestedAt||observedService?.runStatus==='stopping'){
    state='stopping';text=msg('workspace.model.stopping');
  }else if(observedService?.version?.filesSha256&&observedModel?.version?.filesSha256&&observedService.version.filesSha256!==observedModel.version.filesSha256){
    state='old';text=msg('workspace.model.stale', () => ({p0: observedService.version.revisionId, p1: observedModel.version.revisionId??msg('model.initialVersion')}));
  }else if(observedService?.runStatus==='running'){
    state='running';text=msg('workspace.model.running');
  }else if(['queued','starting','unknown'].includes(observedService?.runStatus)){
    state='starting';text=msg('workspace.model.preparing');
  }else if(observedModel?.reasonCode){
    state='failed';text=msg('workspace.model.failed');
  }else if(observedModel?.version){
    text=msg('workspace.model.saved');
  }
  status.dataset.state=state;bindValue(status, () => (text));
}
const browserPreviewPanel=createBrowserPreviewPanel({root:$('#workspace-browser-preview'),api,onVerified:()=>{void simulationPanel.reload();void comparisonPanel.reload();},onVerifyHandoff:draft=>{const accepted=verifyHandoffPanel.handoff(draft);if(accepted){workspaceLayout.select('runs');if(browserPreviewRoute(location)&&activeProject)location.hash=`/workspace/${encodeURIComponent(activeProject.id)}`;}return accepted;},onVerificationAvailability:allowed=>verifyHandoffPanel.setCanVerify(allowed)});
const previewPanel=createPreviewPanel({root:$('#workspace-preview'),api,autoRestore:true,onState:value=>{const pinned=value.available?.runId||value.current?.runId;if(pinned)servicePanel.selectRun(pinned);}});
const servicePanel=createServicePanel({root:$('#workspace-services'),inspectRoot:$('#workspace-runtime-details'),api,workspaceMode:true,onPreparingRun:runId=>previewPanel.prepareRun(runId),onPreviewRun:(runId,options)=>options?.automatic?previewPanel.restoreRun(runId):previewPanel.openRun(runId),onState:detail=>{observedService=detail;renderModelState();if(detail.stopRequestedAt||['stopped','failed','cancelled'].includes(detail.runStatus))previewPanel.stoppedRun(detail.runId);}});
const comparisonPanel=createComparisonPanel({root:$('#workspace-comparison'),api});
const publicationPanel=createPublicationPanel({root:$('#workspace-publication'),api});
const exportPanel=createExportPanel({root:$('#workspace-export')});
const evidencePanel=createEvidencePanel({root:$('#workspace-evidence'),api,onAssessment:()=>{void comparisonPanel.reload();void simulationPanel.reload();}});
const simulationPanel=createSimulationPanel({root:$('#workspace-simulation'),modelRoot:$('#workspace-model'),historyRoot:$('#workspace-run-history'),api,onModel:model=>{observedModel=model;renderModelState();}});
const verifyHandoffPanel=createVerifyHandoffPanel({root:$('#workspace-verify-handoff'),api,onVerified:()=>{void simulationPanel.reload();void comparisonPanel.reload();}});
const notice = $('#notice');
const dialog = $('#project-dialog');
let tenant = null;
let authenticated = false;
let accountUserId = null;
let authenticationResolved = false;
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
let reconcilingMessageIntent = false;
let recoveredReceiptTurn = null;
let workspaceRefreshSequence = 0;
const recoveryId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const recoveryKey = workspaceId => `riffology:conversation:${tenant.id}:${workspaceId}`;
function readConversation(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!value || value.schemaVersion !== 1) return {};
    return {
      selectedSessionId: recoveryId(value.selectedSessionId) ? value.selectedSessionId : null,
      draft: typeof value.draft === 'string' ? value.draft : '',
      messageIntent: value.messageIntent && recoveryId(value.messageIntent.key) && recoveryId(value.messageIntent.sessionId) && typeof value.messageIntent.message === 'string' && (value.messageIntent.acceptedTurnId === undefined || recoveryId(value.messageIntent.acceptedTurnId)) ? {key:value.messageIntent.key,sessionId:value.messageIntent.sessionId,message:value.messageIntent.message,...(recoveryId(value.messageIntent.acceptedTurnId)?{acceptedTurnId:value.messageIntent.acceptedTurnId}:{})} : null,
      sessionIntent: value.sessionIntent && recoveryId(value.sessionIntent.key) && typeof value.sessionIntent.title === 'string' ? {key:value.sessionIntent.key,title:value.sessionIntent.title} : null,
    };
  } catch { return {}; }
}
function saveConversation(key, patch) {
  try { sessionStorage.setItem(key, JSON.stringify({schemaVersion:1,...readConversation(key),...patch})); }
  catch { throw uiError('workspace.error.storage'); }
}
function canCreateConversation() {
  return Boolean(activeProject?.status === 'ready' && !activeProject.archived_at && workspaceSnapshot && !workspaceSnapshot.piDeveloperState?.blocked && !['maintenance','unavailable'].includes(workspaceSnapshot.admission?.state));
}
function selectedSessionCanContinue() {
  return !selectedSessionId || workspaceSnapshot?.sessions?.[selectedSessionId]?.canContinue !== false;
}
function canSubmitConversation() { return canCreateConversation() && selectedSessionCanContinue(); }
function staleMessageIntent() { return Boolean(messageIntent && workspaceSnapshot?.sessions?.[messageIntent.sessionId]?.canContinue === false); }
function awaitingMessageVisibility() { return Boolean(messageIntent?.acceptedTurnId); }
function renderMessageAction() {
  const status=$('#message-status'),form=$('#message-form'),submit=$('#message-submit');
  const processing=sendingMessage||awaitingMessageVisibility();
  bindValue(submit, () => (reconcilingMessageIntent ? t('composer.confirming') : staleMessageIntent() ? t('composer.stale') : sendingMessage || awaitingMessageVisibility() ? t('composer.processing') : messageIntent ? t('composer.retry') : t('composer.send')));
  if(status)bindValue(status, () => (reconcilingMessageIntent?t('composer.confirmingStatus'):sendingMessage?t('composer.processingStatus'):awaitingMessageVisibility()?t('composer.awaitingStatus'):''));
  form?.setAttribute('aria-busy',String(processing||reconcilingMessageIntent));
}
function updateComposerState() {
  const input=$('#message-input'),submit=$('#message-submit'),newSession=$('#new-session'),edit=$('#message-edit');
  const admission=workspaceSnapshot?.admission;
  const unavailable=admission?.state==='unavailable',maintenance=admission?.state==='maintenance'||Boolean(workspaceSnapshot?.piDeveloperState?.blocked);
  input.readOnly=Boolean(messageIntent)||sendingMessage;
  input.disabled=maintenance||unavailable;
  submit.disabled=maintenance||unavailable||sendingMessage||reconcilingMessageIntent||awaitingMessageVisibility()||!canSubmitConversation();
  newSession.disabled=maintenance||unavailable||sendingMessage||reconcilingMessageIntent||creatingSession||Boolean(messageIntent)&&!staleMessageIntent();
  edit.hidden=!messageIntent||Boolean(messageIntent.acceptedTurnId)||workspaceSnapshot?.piDeveloperState?.privateBeta!==true;
  edit.disabled=edit.hidden||sendingMessage||reconcilingMessageIntent||maintenance||unavailable;
  renderMessageAction();
}
function acceptedTurnIsRendered() {
  const current=messageIntent,turnId=current?.acceptedTurnId;
  if(!recoveryId(turnId)||!recoveryId(current.sessionId))return false;
  const snapshotTurn=workspaceSnapshot?.turns?.[turnId];
  if(!snapshotTurn||snapshotTurn.sessionId!==current.sessionId||snapshotTurn.message!==current.message)return false;
  return [...document.querySelectorAll('#turns [data-turn-id]')].filter(node=>node.dataset.turnId===turnId).length===1;
}
function resolveVisibleMessageIntent(workspaceId) {
  const current=messageIntent;
  if(!current?.acceptedTurnId||!acceptedTurnIsRendered())return false;
  try{if(readConversation(recoveryKey(workspaceId)).messageIntent?.key===current.key)saveConversation(recoveryKey(workspaceId),{messageIntent:null,draft:'',selectedSessionId:current.sessionId});}catch{}
  messageIntent=null;$('#message-input').value='';updateComposerState();return true;
}

let eventSource = null;
let eventRetryTimer = null;
let visibilityRetryTimer = null;
let pendingVisibilityReads = 0;
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
  if (awaitingMessageVisibility()) return true;
  if (snapshot.activeTurnId || snapshot.resourceWait || snapshot.releaseHold || snapshot.recoveryHold) return true;
  return Object.values(snapshot.turns || {}).some(turn => turn?.status === 'queued');
}

function stopVisibilityRecovery() { clearTimeout(visibilityRetryTimer); visibilityRetryTimer=null; }
function scheduleVisibilityRecovery(workspaceId,generation) {
  stopVisibilityRecovery();
  if(!awaitingMessageVisibility()||generation!==viewGeneration||activeProject?.workspace_id!==workspaceId)return;
  if(pendingVisibilityReads>=3){bindValue($('#message-error'), () => (t('composer.refreshFailed')));return;}
  pendingVisibilityReads++;
  visibilityRetryTimer=setTimeout(()=>{
    visibilityRetryTimer=null;
    if(generation===viewGeneration&&activeProject?.workspace_id===workspaceId&&awaitingMessageVisibility())void refreshWorkspace(generation);
  },1200);
}

let projectNotice = null;
function show(message, error = false, action = null, project = null) {
  projectNotice = project ? {...project,tenantId:tenant?.id,kind:project.kind||'preparing'} : null;
  notice.replaceChildren();
  const text = document.createElement('span');
  bindValue(text, () => (message));
  notice.append(text);
  if (action) {
    const button = document.createElement('button');
    button.className = 'button';
    bindValue(button, () => (action.label));
    button.onclick = action.run;
    notice.append(button);
  }
  notice.className = `notice${error ? ' error' : ''}`;
  notice.hidden = !message;
}

const localeStatus = $('#locale-status');
const localePreferences = createLocalePreferenceController({
  read: () => api('/api/me/locale'),
  write: locale => api('/api/me/locale', {method:'PUT', body:JSON.stringify({locale})}),
  currentLocale: getLocale,
  applyLocale: locale => { setLocale(locale); applyTranslations(); },
  onSaveFailure: () => { if (localeStatus) bindValue(localeStatus, () => (t('locale.saveFailed'))); },
  onSaveSuccess: () => { if (localeStatus) bindValue(localeStatus, () => ('')); },
});
installLocaleSelector({onChange: locale => localePreferences.select(locale)});
subscribe(()=>renderMessageAction());

function syncProjectNotice(projects) {
  if (!projectNotice || projectNotice.tenantId !== tenant?.id || projectNotice.kind !== 'preparing') return;
  const project = projects.find(item => item.id === projectNotice.id);
  if (!project) return;
  if (project.status === 'ready') show('');
  else if (project.status === 'failed') show(msg('project.prepare.failed'), true, {label:msg('common.refresh'),run:()=>void renderProjects()});
}
function scheduleProjectRefresh(projects) {
  const preparing = projects.find(project => project.status === 'provisioning');
  if (!preparing) return;
  if (notice.hidden) show(msg('project.prepare.pending'),false,null,{id:preparing.id});
  if (Date.now() >= pollDeadline) {
    // A project timeout must not overwrite an unrelated error or notice.
    if (!projectNotice || projectNotice.tenantId !== tenant?.id || projectNotice.id !== preparing.id) return;
    show(msg('project.prepare.timeout'), false, {label:msg('common.refresh'),run:()=>{
      pollDeadline=Date.now()+POLL_WINDOW_MS;
      show(msg('project.prepare.pending'),false,null,{id:preparing.id});
      void renderProjects();
    }}, {id:preparing.id,kind:'timeout'});
  } else if (!document.hidden) pollTimer=setTimeout(renderProjects,3000);
}

function renderResearchStart() {
  const button = $('#start-queue'), status = $('#queue-start-status');
  if (!button || !status) return;
  const available = modelsStatus === 'ready' && models.some(model => model.model_id === 'queue-research');
  button.disabled = !available;
  bindValue(status, () => (modelsStatus === 'loading' ? msg('library.checking')
    : modelsStatus === 'error' ? msg('library.unavailable')
    : available ? msg('library.queue.published')
    : msg('library.queue.unpublished')));
}

function renderModels() {
  renderResearchStart();
  const box = $('#models');
  const status = $('#models-status');
  if (!box || !status) return;
  box.replaceChildren();
  if (modelsStatus === 'loading') { bindValue(status, () => (msg('library.loading'))); return; }
  if (modelsStatus === 'error') { bindValue(status, () => (msg('library.failed'))); return; }
  if (!models.length) { bindValue(status, () => (msg('library.empty'))); return; }
  bindValue(status, () => (msg('library.choose')));
  for (const model of models) {
    const card = document.createElement('article'); card.className = 'model-card'; card.dataset.modelId = model.model_id; card.tabIndex = -1;
    const title = document.createElement('h3'); bindValue(title, () => (model.title || model.model_id));
    const description = document.createElement('p'); bindValue(description, () => (model.description || msg('library.noDescription')));
    const version = document.createElement('small'); bindValue(version, () => (msg('library.version', () => ({p0: model.version}))));
    const use = document.createElement('button'); use.className = 'button compact'; use.type = 'button'; bindValue(use, () => (msg('library.useVersion'))); use.onclick = () => openProjectDialog(model);
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
      select.replaceChildren(bindValue(new Option('', ''), msg('project.blank')));
      for (const model of models) { const option = new Option(`${model.title || model.model_id} · ${model.version}`, `${model.model_id}@${model.version}`); option.dataset.modelId = model.model_id; option.dataset.modelVersion = model.version; select.append(option); }
      const frozen = intent?.payload?.modelId ? `${intent.payload.modelId}@${intent.payload.modelVersion}` : '';
      if (frozen && ![...select.options].some(option => option.value === frozen)) {
        const option = bindValue(new Option('', frozen), msg('project.frozenModel', {p0: intent.payload.modelId, p1: intent.payload.modelVersion}));
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
    if (select && !intent) select.replaceChildren(bindValue(new Option('', ''), msg('project.blank')));
  } finally {
    if (generation === modelsGeneration) $('#models-refresh').disabled = false;
  }
}

function managedBlockMessage(code) {
  const messages = {
    'private-beta-paused': msg('admission.betaPaused'),
    'private-beta-user-busy': msg('admission.userBusy'),
    'private-beta-capacity-full': msg('admission.capacityFull'),
    'private-beta-budget-limit': msg('admission.budgetHeld'),
    'private-beta-admission-denied': msg('admission.invitationInvalid'),
    'private-beta-policy-conflict': msg('admission.policyMismatch'),
    'private-beta-time-limit': msg('admission.timeout'),
    'private-beta-turn-denied': msg('admission.quarantined'),
    'private-beta-unconfigured': msg('admission.notReady'),
    'pi-developer-execution-unconfirmed': msg('admission.providerUnknown'),
    'pi-developer-execution-isolation-unconfirmed': msg('admission.isolationPending'),
    'pi-developer-historical-execution-unconfirmed': msg('admission.historyUnknown'),
    'pi-developer-historical-g5-denied': msg('admission.policyRetained'),
    'pi-developer-admission-denied': msg('admission.developerClosed'),
    'pi-developer-budget-unavailable': msg('admission.usageUnavailable'),
    'pi-developer-historical-ledger-unavailable': msg('admission.historyUnavailable'),
    'pi-developer-packet-limit': msg('admission.packetLimit'),
    'pi-developer-policy-conflict': msg('admission.packetMismatch'),
    'pi-developer-usage-missing': msg('admission.costIncomplete'),
    'pi-developer-usage-invalid': msg('admission.costInvalid'),
    'managed-execution-unknown': msg('admission.executionUnknown'),
    'managed-usage-unknown': msg('admission.usageUnknown'),
    'managed-original-unresolved': msg('admission.previousUnknown'),
    'managed-cleanup-unconfirmed': msg('admission.cleanupUnknown'),
    'managed-input-in-flight': msg('admission.previousBusy'),
    'managed-session-base-unavailable': msg('admission.sessionUnavailable'),
    'managed-session-limit-or-cleanup-pending': msg('admission.sessionLimit'),
    'managed-admission-denied': msg('admission.policyClosed'),
    'managed-policy-immutable': msg('admission.environmentMismatch'),
    'managed-route-existing-turn-history': msg('admission.legacyProject'),
    'managed-observation-failed': msg('admission.readFailed'),
  };
  if (messages[code]) return messages[code];
  if (['managed-window-expired','managed-turn-limit','managed-observed-cost-limit','managed-reservation-limit','managed-observed-cost-exceeds-hold'].includes(code)) return msg('admission.legacyStopped');
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
    const messages = { 400: msg('error.invalidRequest'), 401: msg('error.signIn'), 403: msg('error.accessChanged'), 404: msg('error.notInvited'), 409: msg('error.conflict'), 413: msg('error.requestTooLarge'), 429: projectLimit ? msg('error.projectLimit') : msg('error.rateLimit'), 503: msg('error.unavailable') };
    if(code==='project_archived')messages[409]=msg('project.archivedHelp');
    if(code==='project_busy')messages[409]=msg('project.archiveBlocked');
    if (code === 'g5_admission_disabled') messages[409] = msg('error.projectsPaused');
    if (code === 'turn_runtime_not_ready') messages[503] = msg('error.turnsPaused');
    const blocked = managedBlockMessage(code);
    const localizedMessage = blocked || messages[response.status] || msg('error.requestFailed');
    throw Object.assign(new Error(String(localizedMessage)), {localizedMessage, status: response.status, code, retryable: !blocked && code !== 'turn_runtime_not_ready' });
  }
  if(responseType==='bytes'){const length=Number(response.headers.get('content-length'));if(length>33554432)throw uiError('error.resourceTooLarge');if(typeof onProgress==='function'&&response.body){const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>33554432)throw uiError('error.resourceTooLarge');chunks.push(value);onProgress(size,length);}}catch(error){await reader.cancel().catch(()=>{});throw error;}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;}const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>33554432)throw uiError('error.resourceTooLarge');return bytes;}
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
  if(!authenticated||!tenant||!activeProject){servicePanel.close();previewPanel.leave();browserPreviewPanel.leave();simulationPanel.leave();comparisonPanel.leave();exportPanel.leave();publicationPanel.leave();evidencePanel.leave();verifyHandoffPanel.leave();}
  $('#login').hidden = !authenticationResolved || authenticated;
  const workspaceRoutePending = Boolean(workspaceProjectIdFromHash()) && !activeProject;
  $('#app').hidden = !tenant || Boolean(activeProject) || workspaceRoutePending;
  $('#workspace').hidden = !tenant || !activeProject;
  $('#invitation').hidden = !authenticated || Boolean(tenant);
  $('#sign-out').hidden = !authenticated;
}

function turnStatus(turn) {
  const labels = { queued: msg('turn.status.queued'), running: msg('turn.status.running'), cancelling: msg('turn.status.cancelling'), checkpointing: msg('turn.status.checkpointing'), completed: msg('turn.status.completed'), failed: msg('turn.status.failed'), cancelled: msg('turn.status.cancelled'), interrupted: msg('turn.status.interrupted') };
  if (turn.persistenceOutcome === 'failed') return msg('turn.save.failed', () => ({p0: labels[turn.status] || turn.status}));
  if (turn.persistenceOutcome === 'saved') return msg('turn.savedStatus', () => ({status: labels[turn.status] || turn.status, saved: turn.status === 'completed' ? msg('turn.save.saved') : msg('turn.save.recovery')}));
  return labels[turn.status] || turn.status;
}

function managedAccountingSummary(payload) {
  if (payload?.backend !== 'managed-agents') return null;
  const usage = payload.usage;
  const observed = usage?.status === 'observed' && ['inputTokens','outputTokens','totalTokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0) && usage.inputTokens + usage.outputTokens === usage.totalTokens;
  return {
    usage: observed ? msg('turn.usage.observed', () => ({p0: formatNumber(usage.inputTokens), p1: formatNumber(usage.outputTokens)})) : msg('turn.usage.unknown'),
    detail: msg('turn.accountingDetail', {cost: msg('turn.cost.unsettled'), resources: payload.resources === 'session-retained' ? msg('turn.resources.retained') : msg('turn.resources.unknown')}),
  };
}

function appendTurnCard(kind, text, detail = '') {
  const card = document.createElement('article');
  card.className = `turn-card ${kind}`;
  if(kind==='assistant'||kind==='user'){const origin=document.createElement('strong');bindValue(origin, () => (kind==='assistant'?msg('turn.origin.assistant'):msg('turn.origin.user')));card.append(origin);}
  const body = document.createElement('p');
  bindValue(body, () => (text));
  card.append(body);
  if (detail) {
    const meta = document.createElement('small');
    bindValue(meta, () => (detail));
    card.append(meta);
  }
  $('#turns').append(card);
  return card;
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
    const card = cards.get(key) || { name: msg('tool.defaultName'), status: 'running', summary: '', artifact: null };
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
    const summary = document.createElement('summary'); bindValue(summary, () => (`${card.name} · ${card.status === 'completed' ? msg('turn.status.completed') : card.status === 'failed' ? msg('turn.status.failed') : msg('tool.running')}`));
    const detail = document.createElement('p'); detail.className = 'tool-summary'; bindValue(detail, () => (card.summary || msg('tool.emptySummary')));
    details.append(summary, detail);
    if (card.artifact && activeProject?.workspace_id) {
      const link = document.createElement('a');
      link.className = 'tool-artifact-link';
      link.href = `/api/workspaces/${encodeURIComponent(activeProject.workspace_id)}/artifacts/${encodeURIComponent(card.artifact.artifactId)}`;
      link.target = '_blank'; link.rel = 'noopener';
      bindValue(link, () => (msg('tool.fullResult', () => ({p0: sizeLabel(card.artifact.bytes)}))));
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
    detail = msg('turn.streaming');
  }
  appendTurnCard('assistant', text, detail);
}

function renderWorkspace() {
  const box = $('#turns');
  box.replaceChildren();
  renderMessageAction();
  if (!workspaceSnapshot) {
    $('#message-submit').disabled = true; $('#new-session').disabled = true; $('#session-select').disabled = true;
    $('#message-input').readOnly = Boolean(messageIntent);
    const loading = document.createElement('p');
    loading.className = 'turn-empty';
    bindValue(loading, () => (msg('workspace.loading')));
    box.append(loading);
    return;
  }
  if(recoveredReceiptTurn&&workspaceSnapshot.turns?.[recoveredReceiptTurn.id]?.sessionId===recoveredReceiptTurn.sessionId&&workspaceSnapshot.turns[recoveredReceiptTurn.id]?.message===recoveredReceiptTurn.message)recoveredReceiptTurn=null;
  const admission = workspaceSnapshot.admission;
  const unavailable = admission?.state === 'unavailable';
  const maintenance = admission?.state === 'maintenance' || Boolean(workspaceSnapshot.piDeveloperState?.blocked);
  if (maintenance) appendTurnCard('system', msg('workspace.admission.paused'), msg('workspace.admission.retained'));
  if (unavailable) appendTurnCard('system', msg('workspace.runtime.unavailable'), msg('workspace.runtime.recovering'));
  if (workspaceHistoryTruncated) appendTurnCard('system', msg('workspace.history.recent'), msg('workspace.history.truncated'));
  const sessions = Object.values(workspaceSnapshot.sessions || {}).sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  if (messageIntent) selectedSessionId = messageIntent.sessionId;
  else if (!selectedSessionId || !workspaceSnapshot.sessions?.[selectedSessionId]) selectedSessionId = sessions[0]?.id || null;
  const staleIntent=staleMessageIntent();
  updateComposerState();
  $('#new-session').disabled = maintenance || unavailable || sendingMessage || reconcilingMessageIntent || creatingSession || Boolean(messageIntent) && !staleIntent;
  bindValue($('#new-session'), () => (staleIntent ? msg('session.move') : sessionIntent ? msg('session.retry') : msg('session.new')));
  $('#session-select').disabled = maintenance || unavailable || Boolean(messageIntent) || Boolean(sessionIntent);
  try { saveConversation(recoveryKey(activeProject.workspace_id), {selectedSessionId}); } catch (error) { bindValue($('#message-error'), () => (errorMessage(error))); }
  const sessionSelect = $('#session-select');
  if (sessionSelect) {
    sessionSelect.replaceChildren(...sessions.map(session => {
      const option = document.createElement('option'); option.value = session.id; bindValue(option, () => (session.title || session.id)); return option;
    }));
    sessionSelect.value = selectedSessionId || '';
    sessionSelect.disabled = !sessions.length || maintenance || unavailable || Boolean(messageIntent) || Boolean(sessionIntent);
  }
  if (workspaceSnapshot.piDeveloperState?.blocked) appendTurnCard('system', managedBlockMessage(workspaceSnapshot.piDeveloperState.blocked) || msg('workspace.statusUnavailable'));
  if (workspaceSnapshot.sessions?.[selectedSessionId]?.canContinue === false) appendTurnCard('system', msg('session.readOnly'), msg('session.moveHelp'));
  if (workspaceSnapshot.managedState?.stopped) {
    appendTurnCard('system', managedBlockMessage(workspaceSnapshot.managedState.stopped) || msg('workspace.previousFailure'));
  }
  if (workspaceSnapshot.releaseHold) {
    const detail = workspaceSnapshot.releaseHold.status === 'recovery-hold'
      ? msg('workspace.releaseUnknown')
      : msg('workspace.nextAfterRelease');
    appendTurnCard('system', msg('workspace.awaitRelease'), detail);
  } else if (workspaceSnapshot.resourceWait) {
    const cleanup = workspaceSnapshot.resourceWait.status === 'release-pending';
    appendTurnCard('system', cleanup ? msg('workspace.permitReleasing') : msg('workspace.awaitCapacity'), cleanup ? msg('workspace.queueResume') : msg('workspace.startAfterPermit'));
  }
  const turns = Object.values(workspaceSnapshot.turns || {}).filter(turn => turn.sessionId === selectedSessionId).sort((a, b) => a.createdAt - b.createdAt);
  const receiptTurn=recoveredReceiptTurn&&recoveredReceiptTurn.sessionId===selectedSessionId&&!workspaceSnapshot.turns?.[recoveredReceiptTurn.id]?recoveredReceiptTurn:null;
  if (!turns.length&&!receiptTurn) {
    const empty = document.createElement('p');
    empty.className = 'turn-empty';
    bindValue(empty, () => (msg('workspace.empty')));
    box.append(empty);
  }
  for (const turn of turns) {
    const card=appendTurnCard('user', turn.message, turnStatus(turn));card.dataset.turnId=turn.id;
    if(turn.timing){const labels={queuedMs:msg('turn.phase.queue'),preparingMs:msg('turn.phase.prepare'),executingMs:msg('turn.phase.execute'),savingMs:msg('turn.phase.save')};const durations=Object.entries(labels).filter(([k])=>turn.timing[k]!==null).map(([k,v])=>msg('turn.duration', () => ({p0: v, p1: formatNumber(turn.timing[k]/1000,{minimumFractionDigits:1,maximumFractionDigits:1})})));if(durations.length)appendTurnCard('system',msg('turn.durationSummary',()=>({durations:durations.join(' · ')})));}
    const events = workspaceEvents.filter(event => event.turnId === turn.id);
    appendAssistantMessage(events);
    appendToolCards(events, turn.id);
    const providerError = events.findLast?.(event => event.type === 'provider.status' && event.payload?.state === 'error');
    if (providerError) appendTurnCard('system', msg('turn.providerError', () => ({p0: providerError.payload?.status ? `（${providerError.payload.status}）` : ''})));
    const managedStatus = events.findLast?.(event => event.type === 'provider.status' && event.payload?.backend === 'managed-agents');
    const accounting = managedAccountingSummary(managedStatus?.payload);
    if (accounting) appendTurnCard('system', accounting.usage, accounting.detail);
    if (turn.errorCode && !events.some(event => event.type === 'assistant.message')) appendTurnCard('system', msg('turn.incomplete', () => ({p0: turn.errorCode})), turnStatus(turn));
  }
  if(receiptTurn){const card=appendTurnCard('user',receiptTurn.message,turnStatus(receiptTurn));card.dataset.turnId=receiptTurn.id;}
  const active = workspaceSnapshot.activeTurnId && workspaceSnapshot.turns?.[workspaceSnapshot.activeTurnId];
  $('#cancel-turn').hidden = !active || TERMINAL_TURNS.has(active.status);
  $('#cancel-turn').dataset.turnId = active?.id || '';
}

function sizeLabel(value) {
  if (!Number.isSafeInteger(value) || value < 0) return '—';
  if (value < 1024) return `${formatNumber(value)} B`;
  return `${formatNumber(value/1024,{minimumFractionDigits:value<10240?1:0,maximumFractionDigits:value<10240?1:0})} KB`;
}

function renderWorkspaceFiles() {
  const box = $('#workspace-files'), meta = $('#files-meta');
  if (!box || !meta) return;
  box.replaceChildren();
  if (workspaceFilesError) { bindValue(meta, () => (msg('files.readFailed'))); const error = document.createElement('p'); error.className = 'file-empty file-error'; bindValue(error, () => (workspaceFilesError)); box.append(error); return; }
  if (!workspaceFiles) { bindValue(meta, () => (msg('files.reading'))); const loading = document.createElement('p'); loading.className = 'file-empty'; bindValue(loading, () => (msg('files.loading'))); box.append(loading); return; }
  const files = Array.isArray(workspaceFiles.files) ? workspaceFiles.files : [];
  if (!workspaceFiles.revision) { bindValue(meta, () => (msg('files.noRevision'))); const empty = document.createElement('p'); empty.className = 'file-empty'; bindValue(empty, () => (msg('files.afterSave'))); box.append(empty); return; }
  bindValue(meta, () => (msg('files.revision', () => ({p0: workspaceFiles.revision.revisionId, p1: formatNumber(files.length), p2: formatDate(new Date(workspaceFiles.revision.committedAt),{dateStyle:'short',timeStyle:'medium',hour12:false})}))));
  for (const item of files) {
    if (!item || typeof item.path !== 'string' || !['file', 'directory'].includes(item.type)) continue;
    const row = document.createElement('div'); row.className = `file-entry ${item.type}`;
    const path = document.createElement('span'); bindValue(path, () => (`${item.type === 'directory' ? '▸ ' : ''}${item.path}`));
    const detail = document.createElement('small'); bindValue(detail, () => (item.type === 'directory' ? msg('files.directory') : sizeLabel(item.size)));
    row.append(path, detail); box.append(row);
  }
  if (!box.childElementCount) { const empty = document.createElement('p'); empty.className = 'file-empty'; bindValue(empty, () => (msg('files.empty'))); box.append(empty); }
}

async function refreshWorkspaceFiles(generation = viewGeneration) {
  if (!activeProject || generation !== viewGeneration) return;
  const workspaceId=activeProject.workspace_id,epoch=++filesReadEpoch,valid=()=>generation===viewGeneration&&activeProject?.workspace_id===workspaceId&&epoch===filesReadEpoch;
  workspaceFilesError='';renderWorkspaceFiles();
  try{const value=await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`);if(!valid())return;
    const changed=workspaceFiles?.revision?.filesSha256!==value.revision?.filesSha256||workspaceFiles?.revision?.revisionId!==value.revision?.revisionId;
    workspaceFiles=value;servicePanel.savedRevision(workspaceId,value.revision);
    if(changed){browserPreviewPanel.savedRevision();diffReadEpoch++;workspaceDiff=null;workspaceDiffError='';renderWorkspaceDiff();if(workspaceArtifactPanel==='diff')void refreshWorkspaceDiff(generation);void simulationPanel.reload();void comparisonPanel.reload();}
  }catch(error){if(!valid())return;workspaceFilesError=errorMessage(error);}
  if(valid())renderWorkspaceFiles();
}

function renderWorkspaceDiff() {
  const box=$('#workspace-diff'),meta=$('#diff-meta');if(!box||!meta)return;box.replaceChildren();
  if(workspaceDiffError){bindValue(meta, () => (msg('files.readFailed')));const error=document.createElement('p');error.className='file-empty file-error';bindValue(error, () => (workspaceDiffError));box.append(error);return;}
  if(!workspaceDiff){bindValue(meta, () => (msg('diff.select')));const empty=document.createElement('p');empty.className='file-empty';bindValue(empty, () => (msg('diff.unread')));box.append(empty);return;}
  if(!workspaceDiff.revision){bindValue(meta, () => (msg('files.noRevision')));const empty=document.createElement('p');empty.className='file-empty';bindValue(empty, () => (msg('diff.afterSave')));box.append(empty);return;}
  const summary=workspaceDiff.summary||{},changes=Array.isArray(workspaceDiff.changes)?workspaceDiff.changes:[];bindValue(meta, () => (msg('diff.summary', () => ({p0: formatNumber(summary.added||0), p1: formatNumber(summary.modified||0), p2: formatNumber(summary.deleted||0)}))));
  for(const item of changes){if(!item||typeof item.path!=='string'||!['added','modified','deleted'].includes(item.change))continue;const row=document.createElement('div');row.className=`file-entry ${item.change}`;const path=document.createElement('span'),mark=document.createElement('b');mark.className='diff-mark';bindValue(mark, () => (item.change==='added'?'+ ':item.change==='deleted'?'− ':'~ '));path.append(mark,document.createTextNode(item.path));const detail=document.createElement('small');bindValue(detail, () => (item.type==='directory'?msg('files.directory'):sizeLabel(item.size)));row.append(path,detail);box.append(row);}
  if(!box.childElementCount){const empty=document.createElement('p');empty.className='file-empty';bindValue(empty, () => (msg('diff.empty')));box.append(empty);}
}

async function refreshWorkspaceDiff(generation=viewGeneration){
  if(!activeProject||generation!==viewGeneration)return;const workspaceId=activeProject.workspace_id,epoch=++diffReadEpoch,valid=()=>generation===viewGeneration&&activeProject?.workspace_id===workspaceId&&epoch===diffReadEpoch;
  workspaceDiffError='';renderWorkspaceDiff();try{const value=await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/diff`);if(!valid())return;workspaceDiff=value;}catch(error){if(!valid())return;workspaceDiffError=errorMessage(error);}if(valid())renderWorkspaceDiff();
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
      if (!Number.isSafeInteger(page.oldestSequence) || page.oldestSequence < 1) throw uiError('error.eventWindow');
      const retainedCursor = page.oldestSequence - 1;
      if (retainedCursor <= cursor) throw uiError('error.eventWindowStalled');
      historyTruncated = true;
      oldestSequence = page.oldestSequence;
      cursor = retainedCursor;
      continue;
    }
    if (page.hasMore && Number(page.nextSequence) <= cursor) throw uiError('error.eventsStalled');
    events.push(...page.events);
    cursor = page.nextSequence;
    if (!page.hasMore) return { events, cursor, snapshotRequired: false, historyTruncated, oldestSequence };
    if (cursor <= lastCursor) throw uiError('error.eventsStalled');
    lastCursor = cursor;
  }
  throw uiError('error.eventsOverflow');
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
      if(resolveVisibleMessageIntent(workspaceId))stopVisibilityRecovery();
      if (['turn.completed', 'turn.failed', 'turn.cancelled', 'turn.interrupted'].includes(type)) void refreshWorkspace(generation);
    } catch { bindValue($('#message-error'), () => (msg('error.eventFormat'))); }
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

async function reconcileMessageRecovery(workspaceId,generation){
  const current=messageIntent;
  if(!current)return '';
  if(workspaceSnapshot?.sessions?.[current.sessionId]?.canContinue===false){reconcilingMessageIntent=false;updateComposerState();return msg('session.accessChanged');}
  reconcilingMessageIntent=true;updateComposerState();
  try{
    const receipt=await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(current.sessionId)}/turns/receipt`,{headers:{'Idempotency-Key':current.key}});
    if(generation!==viewGeneration||activeProject?.workspace_id!==workspaceId||messageIntent?.key!==current.key)return '';
    if(receipt?.accepted!==true||!recoveryId(receipt.turn?.id)||receipt.turn?.sessionId!==current.sessionId||receipt.turn?.message!==current.message)return msg('turn.receiptMismatch');
    messageIntent={...current,acceptedTurnId:receipt.turn.id};recoveredReceiptTurn=receipt.turn;selectedSessionId=current.sessionId;
    try{saveConversation(recoveryKey(workspaceId),{messageIntent,selectedSessionId:current.sessionId,draft:current.message});}catch{return t('composer.receiptStorageFailure');}
    return t('composer.receiptAccepted');
  }catch(error){
    if(generation!==viewGeneration||activeProject?.workspace_id!==workspaceId)return '';
    if(error.status===404&&workspaceSnapshot?.piDeveloperState?.privateBeta===true){
      try{
        const status=await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/private-beta-capacity`);
        const key={'available':'admission.betaStatus.available','admitting':'admission.betaStatus.admitting','running':'admission.betaStatus.running','release-pending':'admission.betaStatus.release','review-required':'admission.betaStatus.review','unknown':'admission.betaStatus.unknown'}[status?.state];
        return key?msg(key):'';
      }catch{return '';}
    }
    if(error.status===404)return '';
    return msg('turn.receiptUnavailable', () => ({p0: errorMessage(error)}));
  }finally{
    if(generation===viewGeneration&&activeProject?.workspace_id===workspaceId){reconcilingMessageIntent=false;updateComposerState();}
  }
}

async function refreshWorkspace(generation = viewGeneration) {
  if (!activeProject || generation !== viewGeneration) return;
  if(activeProject.status!=='ready')return;
  const workspaceId = activeProject.workspace_id;
  const refreshSequence=++workspaceRefreshSequence;
  try {
    const [snapshot, replay] = await Promise.all([api(`/api/workspaces/${encodeURIComponent(workspaceId)}`), readWorkspaceEvents(workspaceId)]);
    if (generation !== viewGeneration || refreshSequence!==workspaceRefreshSequence || activeProject?.workspace_id !== workspaceId) return;
    workspaceSnapshot = snapshot;
    workspaceEvents = replay.events;
    workspaceHistoryTruncated = replay.historyTruncated === true;
    const recoveryNotice=activeProject.archived_at||awaitingMessageVisibility()?'':await reconcileMessageRecovery(workspaceId,generation);
    if(generation !== viewGeneration || refreshSequence!==workspaceRefreshSequence || activeProject?.workspace_id !== workspaceId) return;
    renderWorkspace();renderModelState();
    if(resolveVisibleMessageIntent(workspaceId))stopVisibilityRecovery();
    else if(awaitingMessageVisibility())scheduleVisibilityRecovery(workspaceId,generation);
    if(recoveryNotice)bindValue($('#message-error'), () => (recoveryNotice));
    void refreshWorkspaceFiles(generation);
    workspaceDiff=null;workspaceDiffError='';renderWorkspaceDiff();if(workspaceArtifactPanel==='diff')void refreshWorkspaceDiff(generation);
    if(!activeProject.archived_at)connectEventStream(workspaceId, replay.cursor, generation);
  } catch (error) {
    if (generation !== viewGeneration || refreshSequence!==workspaceRefreshSequence || activeProject?.workspace_id !== workspaceId) return;
    reconcilingMessageIntent=false;updateComposerState();
    bindValue($('#message-error'), () => (errorMessage(error)));
    if(awaitingMessageVisibility())scheduleVisibilityRecovery(workspaceId,generation);
  } finally {
    if (generation === viewGeneration && refreshSequence===workspaceRefreshSequence && activeProject?.workspace_id === workspaceId) snapshotRecovery = false;
  }
}

function openWorkspace(project) {
  if (!project.workspace_id) return;
  stopPolling();
  stopEventStream();
  stopVisibilityRecovery();pendingVisibilityReads=0;sendingMessage=false;recoveredReceiptTurn=null;
  viewGeneration++;
  if (project.status === 'provisioning' && notice.hidden) show(msg('project.prepare.pending'),false,null,{id:project.id});
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
  reconcilingMessageIntent = Boolean(messageIntent&&!messageIntent.acceptedTurnId);
  $('#message-input').value = messageIntent?.message ?? recovery.draft ?? '';
  bindValue($('#new-session'), () => (sessionIntent ? msg('session.retry') : msg('session.new')));
  const browserRoute=browserPreviewRoute(location);
  const standalone=browserRoute?.projectId===project.id;
  $('#workspace').classList.toggle('browser-preview-standalone',standalone);
  if (!standalone&&location.hash !== `#/workspace/${encodeURIComponent(project.id)}`) history.replaceState(null, '', `#/workspace/${encodeURIComponent(project.id)}`);
  bindValue($('#workspace-title'), () => (project.title));
  $('#workspace-title').title = project.title;
  const ready=project.status==='ready'&&!project.archived_at,readable=project.status==='ready';
  $('#workspace').classList.toggle('archived',Boolean(project.archived_at));
  bindValue($('#workspace-meta'), () => (project.archived_at?msg('project.archivedHelp'):ready?msg('workspace.meta.ready'):project.status==='provisioning'?msg('workspace.meta.preparing'):msg('workspace.meta.recovering')));
  $('#message-input').disabled=!ready;$('#message-submit').disabled=true;$('#new-session').disabled=true;
  $('#session-select').disabled=!ready;$('#cancel-turn').hidden=true;
  $('#files-refresh').disabled=!readable;$('#files-tab').disabled=!readable;$('#diff-tab').disabled=!readable;
  bindValue($('#message-error'), () => (''));
  accountView();workspaceLayout.refresh();
  renderWorkspace();renderModelState();
  renderWorkspaceFiles();
  renderWorkspaceDiff();
  selectArtifactPanel('files');
  if(standalone)workspaceLayout.select('preview');
  verifyHandoffPanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id,projectId:project.id});
  void browserPreviewPanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id,projectId:project.id,canOpen:readable,standalone,...(standalone?browserRoute:{})});
  if(standalone){servicePanel.close();previewPanel.leave();simulationPanel.leave();comparisonPanel.leave();exportPanel.leave();publicationPanel.leave();evidencePanel.leave();return;}
  previewPanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id,canOpen:ready&&executionAvailability.preview,paused:!executionAvailability.preview});
  servicePanel.open({workspaceId:project.workspace_id,tenantId:tenant.id,canStart:ready&&executionAvailability.service});
  if(readable){void simulationPanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id});void comparisonPanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id});}else{simulationPanel.leave();comparisonPanel.leave();}
  exportPanel.enter({workspaceId:project.workspace_id});publicationPanel.enter({workspaceId:project.workspace_id,readOnly:Boolean(project.archived_at)});
  void evidencePanel.enter({workspaceId:project.workspace_id,tenantId:tenant.id,readOnly:Boolean(project.archived_at)});
  if(!readable){$('#turns').replaceChildren();appendTurnCard('system',msg('workspace.unreadyHelp'));bindValue($('#files-meta'), () => (msg('workspace.unready')));$('#workspace-files').replaceChildren();}
  void refreshWorkspace(viewGeneration);
}

const archiveRequestKeys=new Map();
let projectPageBefore=null;
let projectPageStack=[];
async function renderProjects() {
  stopPolling();
  if (!tenant || document.hidden) return;
  const generation = viewGeneration;
  const requestNumber = ++listGeneration;
  const box = $('#projects');
  box.setAttribute('aria-busy', 'true');
  try {
    const view=$('#project-filter')?.value==='archived'?'archived':'active';
    const query=new URLSearchParams({view});if(projectPageBefore)query.set('before',projectPageBefore);
    const data = await api(`/api/tenants/${encodeURIComponent(tenant.id)}/projects${view==='active'&&!projectPageBefore?'':'?'+query}`);
    if (generation !== viewGeneration || requestNumber !== listGeneration) return;
    const projects = [...data.projects];
    if (pendingProject && pendingProjectTenantId !== tenant.id) pendingProject = null;
    syncProjectNotice(projects);
    if (pendingProject && projects.some(project => project.id === pendingProject.id)) pendingProject = null;
    const requestedProjectId = workspaceProjectIdFromHash();
    if (requestedProjectId) {
      let requested = projects.find(project => project.id === requestedProjectId && project.workspace_id);
      if(!requested)requested=await api(`/api/tenants/${encodeURIComponent(tenant.id)}/projects/${encodeURIComponent(requestedProjectId)}`).then(value=>value.project??value).catch(()=>null);
      if(generation!==viewGeneration||requestNumber!==listGeneration)return;
      if(requested&&(requested.id!==requestedProjectId||!requested.workspace_id))requested=null;
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
        bindValue($('#new-session'), () => (msg('session.new')));
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
      bindValue(empty, () => (msg('project.empty')));
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
      bindAttribute(open, 'aria-label', () => String(project.status === 'ready' ? msg('project.open', {p0: project.title}) : msg('project.manage', {p0: project.title})));
      const title = document.createElement('h2');
      bindValue(title, () => (project.title));
      const status = document.createElement('span');
      const labels = { provisioning: msg('project.status.provisioning'), ready: msg('project.status.ready'), failed: msg('project.status.failed'), deleting: msg('project.status.deleting') };
      status.className = `status ${Object.hasOwn(labels, project.status) ? project.status : ''}`;
      bindValue(status, () => (project.archived_at?msg('project.archived'):labels[project.status] || msg('common.unknown')));
      const detail = document.createElement('p');
      detail.className = 'meta';
      bindValue(detail, () => (project.source_model_id && project.source_model_version ? msg('project.origin.official', () => ({p0: project.source_model_id, p1: project.source_model_version})) : msg('project.origin.blank')));
      open.append(title, status, detail);
      const summary=document.createElement('p');summary.className='meta';bindValue(summary, () => (msg('project.summary.loading')));open.append(summary);summaryJobs.push({project,card,summary});
      if(isAcceptanceProject(project.title)){const tag=document.createElement('span');tag.className='meta';bindValue(tag, () => (msg('project.acceptance')));open.append(tag);}
      if (!open.disabled) open.onclick = () => openWorkspace(project);
      card.append(open);
      const archive=document.createElement('button');archive.type='button';archive.className='button compact';bindValue(archive,()=>msg(project.archived_at?'project.restore':'project.archive'));archive.disabled=!['ready','failed'].includes(project.status);
      archive.onclick=async()=>{archive.disabled=true;const action=project.archived_at?'restore':'archive',path=`/api/tenants/${encodeURIComponent(tenant.id)}/projects/${encodeURIComponent(project.id)}/${action}`;
        const storageKey=`project-archive:${tenant.id}:${project.id}:${action}`;let key=archiveRequestKeys.get(storageKey);try{key=key||localStorage.getItem(storageKey);}catch{}if(!key){key=crypto.randomUUID();try{localStorage.setItem(storageKey,key);}catch{}}archiveRequestKeys.set(storageKey,key);
        try{const receipt=await api(path,{method:'POST',headers:{'Idempotency-Key':key},body:'{}'});archiveRequestKeys.delete(storageKey);try{localStorage.removeItem(storageKey);}catch{}if(receipt.outcome!=='completed')show(msg('project.archiveBlocked'),true);else show(msg(action==='archive'?'project.archiveDone':'project.restoreDone'));await renderProjects();}catch(error){show(errorMessage(error),true);archive.disabled=false;}
      };card.append(archive);
      box.append(card);
    }
    const pages=document.createElement('nav');pages.setAttribute('aria-label',String(msg('project.pagination')));
    if(projectPageStack.length){const previous=document.createElement('button');previous.type='button';previous.className='button';bindValue(previous,()=>msg('project.previous'));previous.onclick=()=>{projectPageBefore=projectPageStack.pop()??null;void renderProjects();};pages.append(previous);}
    if(data.nextCursor){const next=document.createElement('button');next.type='button';next.className='button';bindValue(next,()=>msg('project.next'));next.onclick=()=>{projectPageStack.push(projectPageBefore);projectPageBefore=data.nextCursor;void renderProjects();};pages.append(next);}box.append(pages);
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
    show(errorMessage(error), true);
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
  servicePanel.close();previewPanel.leave();browserPreviewPanel.leave();simulationPanel.leave();comparisonPanel.leave();exportPanel.leave();publicationPanel.leave();evidencePanel.leave();verifyHandoffPanel.leave();
  const generation = ++viewGeneration;
  const localeStart = localePreferences.begin();
  stopPolling();
  stopEventStream();
  activeProject = null;
  workspaceSnapshot = null;
  workspaceEvents = [];
  workspaceFiles = null;
  workspaceFilesError = '';
  authenticated = false;
  accountUserId = null;
  tenant = null;
  authenticationResolved = false;
  accountView();
  try {
    const user = await api('/api/me');
    if (generation !== viewGeneration) return;
    authenticated = true;
    accountUserId = user.userId;
    authenticationResolved = true;
    localePreferences.activate(accountUserId, generation, localeStart, {locale:user.locale});
    executionAvailability={service:user.execution?.service===true,preview:user.execution?.preview===true,simulation:user.execution?.simulation===true};
    tenant = user.tenants[0] || null;
    accountView();
    pollDeadline = Date.now() + POLL_WINDOW_MS;
    if (tenant) { await Promise.all([renderProjects(), loadModels()]); }
  } catch (error) {
    if (generation !== viewGeneration) return;
    if (error.status === 401) {
      authenticated = false;
      accountUserId = null;
      authenticationResolved = true;
      tenant = null;
    } else if (error.status === 404) {
      authenticated = true;
      authenticationResolved = true;
      tenant = null;
    }
    accountView();
    show(error.status === 404 && authenticated ? msg('invitation.prompt') : errorMessage(error), error.status !== 404);
  }
}

$('#google').onclick = async () => {
  try {
    const data = await api('/api/auth/sign-in/social', { method: 'POST', body: JSON.stringify({ provider: 'google', callbackURL: location.origin + '/' + (browserPreviewRoute(location)?location.hash:'') }) });
    if (data?.url) location.assign(data.url);
  } catch (error) { show(errorMessage(error), true); }
};

$('#sign-out').onclick = async () => {
  viewGeneration++;
  const localeStart=localePreferences.begin();
  servicePanel.close();previewPanel.leave();browserPreviewPanel.leave();simulationPanel.leave();comparisonPanel.leave();exportPanel.leave();publicationPanel.leave();evidencePanel.leave();verifyHandoffPanel.leave();
  stopEventStream();
  stopVisibilityRecovery();pendingVisibilityReads=0;sendingMessage=false;recoveredReceiptTurn=null;
  stopPolling();
  const button = $('#sign-out');
  button.disabled = true;
  try {
    await api('/api/auth/sign-out', { method: 'POST', body: '{}' });
    authenticated = false;
    accountUserId = null;
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
    bindValue($('#new-session'), () => (msg('session.new')));
    pendingProject = null;
    pollDeadline = 0;
    history.replaceState(null, '', location.pathname + location.search);
    $('#projects').replaceChildren();
    accountView();
    show(msg('account.signedOut'));
  } catch (error) { if(authenticated&&accountUserId)localePreferences.activate(accountUserId,viewGeneration,localeStart);if(authenticated&&tenant&&activeProject){previewPanel.enter({workspaceId:activeProject.workspace_id,tenantId:tenant.id,canOpen:activeProject.status==='ready'&&executionAvailability.preview,paused:!executionAvailability.preview});servicePanel.open({workspaceId:activeProject.workspace_id,tenantId:tenant.id,canStart:activeProject.status==='ready'&&executionAvailability.service});void refreshWorkspace(viewGeneration);}show(errorMessage(error), true); }
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
  stopVisibilityRecovery();pendingVisibilityReads=0;sendingMessage=false;recoveredReceiptTurn=null;
  activeProject = null;
  workspaceSnapshot = null;
  workspaceEvents = [];
  workspaceFiles = null;
  workspaceFilesError = '';
  selectedSessionId = null;
  sessionIntent = null;
  creatingSession = false;
  messageIntent = null;
  bindValue($('#new-session'), () => (msg('session.new')));
  history.replaceState(null, '', location.pathname + location.search);
  bindValue($('#message-error'), () => (''));
  accountView();
  pollDeadline = Date.now() + POLL_WINDOW_MS;
  void renderProjects();
};

$('#message-input').addEventListener('input', () => {
  if (!activeProject || !tenant || messageIntent) return;
  try { saveConversation(recoveryKey(activeProject.workspace_id), {draft:$('#message-input').value}); } catch (error) { bindValue($('#message-error'), () => (errorMessage(error))); }
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
  const migratingIntent=staleMessageIntent()?messageIntent:null;
  if (!canCreateConversation() || sendingMessage || reconcilingMessageIntent || creatingSession || messageIntent && !migratingIntent) return;
  const workspaceId = activeProject.workspace_id;
  sessionIntent ??= { key: crypto.randomUUID(), title: `Session ${Object.keys(workspaceSnapshot?.sessions || {}).length + 1}` };
  const current = sessionIntent, savedKey = recoveryKey(workspaceId);
  const button = $('#new-session'); creatingSession = true; button.disabled = true;
  bindValue($('#message-error'), () => (''));
  try {
    saveConversation(savedKey, {sessionIntent:current, draft:$('#message-input').value});
    const created = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`, { method: 'POST', headers: { 'Idempotency-Key': current.key }, body: JSON.stringify({ title: current.title }) });
    if (activeProject?.workspace_id !== workspaceId) return;
    saveConversation(savedKey, {selectedSessionId:created.session.id, sessionIntent:null,...(migratingIntent?{messageIntent:null,draft:migratingIntent.message}:{})});
    selectedSessionId = created.session.id; sessionIntent = null;
    if(migratingIntent){messageIntent=null;recoveredReceiptTurn=null;$('#message-input').value=migratingIntent.message;$('#message-input').readOnly=false;}
    bindValue(button, () => (msg('session.new')));
    await refreshWorkspace(viewGeneration);
  } catch (error) { if (activeProject?.workspace_id === workspaceId) { bindValue($('#message-error'), () => (errorMessage(error))); bindValue(button, () => (migratingIntent?msg('session.retryMove'):msg('session.retryCreate'))); } }
  finally { creatingSession = false; button.disabled = !canCreateConversation() || Boolean(messageIntent) && !staleMessageIntent(); }
};

$('#message-form').onsubmit = async event => {
  event.preventDefault();
  if (sendingMessage || reconcilingMessageIntent || awaitingMessageVisibility() || !canSubmitConversation()) return;
  const text = messageIntent?.message ?? $('#message-input').value.trim();
  if (!text) return;
  if (messageIntent && encodedTurnRequestBytes(text) > TURN_REQUEST_MAX_BYTES) {
    const oversized = messageIntent;
    saveConversation(recoveryKey(activeProject.workspace_id), {messageIntent:null, selectedSessionId:oversized.sessionId, draft:oversized.message});
    messageIntent = null;
    $('#message-input').value = oversized.message;
    $('#message-input').readOnly = false;
    bindValue($('#message-submit'), () => (msg('composer.send')));
    bindValue($('#message-error'), () => (msg('error.requestBytes', () => ({p0: TURN_REQUEST_MAX_BYTES}))));
    return;
  }
  if (encodedTurnRequestBytes(text) > TURN_REQUEST_MAX_BYTES) {
    bindValue($('#message-error'), () => (msg('error.requestBytes', () => ({p0: TURN_REQUEST_MAX_BYTES}))));
    return;
  }
  const generation = viewGeneration;
  const workspaceId = activeProject.workspace_id, savedKey = recoveryKey(workspaceId);
  let attemptedIntent = null;
  let turnAccepted = false;
  sendingMessage = true;
  updateComposerState();
  bindValue($('#message-error'), () => (''));
  try {
    saveConversation(savedKey, {draft:text});
    if (!messageIntent && (sessionIntent || !selectedSessionId)) {
      sessionIntent ??= { key: crypto.randomUUID(), title: t('session.defaultTitle') };
      saveConversation(savedKey, {sessionIntent});
      const created = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`, { method: 'POST', headers: { 'Idempotency-Key': sessionIntent.key }, body: JSON.stringify({ title: sessionIntent.title }) });
      if (generation !== viewGeneration || activeProject?.workspace_id!==workspaceId) return;
      saveConversation(savedKey, {selectedSessionId:created.session.id, sessionIntent:null});
      selectedSessionId = created.session.id;
      sessionIntent = null;
    }
    messageIntent ??= { key: crypto.randomUUID(), sessionId: selectedSessionId, message: text };
    const current = messageIntent;
    saveConversation(savedKey, {messageIntent:current, selectedSessionId:current.sessionId, draft:current.message});
    $('#message-input').readOnly = true;
    attemptedIntent = current;
    const submitted=await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(current.sessionId)}/turns`, { method: 'POST', headers: { 'Idempotency-Key': current.key }, body: JSON.stringify({ message: current.message }) });
    turnAccepted = true;
    if(!recoveryId(submitted?.turn?.id))throw Error(t('composer.invalidResponse'));
    if (generation !== viewGeneration || activeProject?.workspace_id!==workspaceId) return;
    messageIntent={...current,acceptedTurnId:submitted.turn.id};recoveredReceiptTurn=null;
    if (readConversation(savedKey).messageIntent?.key === current.key) saveConversation(savedKey,{messageIntent,selectedSessionId:current.sessionId,draft:current.message});
    pendingVisibilityReads=0;updateComposerState();
    await refreshWorkspace(generation);
  } catch (error) {
    if (generation !== viewGeneration) return;
    if (!turnAccepted && ((error.status === 400 && error.code === 'invalid_input') || (error.status === 413 && error.code === 'body_too_large')) && attemptedIntent && messageIntent?.key === attemptedIntent.key) {
      saveConversation(savedKey, {messageIntent:null, selectedSessionId:attemptedIntent.sessionId, draft:attemptedIntent.message});
      messageIntent = null;
    }
    const recoveryNotice=!awaitingMessageVisibility()&&messageIntent?await reconcileMessageRecovery(workspaceId,generation):'';
    if(generation!==viewGeneration||activeProject?.workspace_id!==workspaceId)return;
    if(recoveryNotice&&recoveredReceiptTurn){renderWorkspace();resolveVisibleMessageIntent(workspaceId);}
    bindValue($('#message-error'), () => (recoveryNotice||(awaitingMessageVisibility()?t('composer.awaitingRefreshError'):errorMessage(error))));
    updateComposerState();
  } finally {
    if(generation===viewGeneration&&activeProject?.workspace_id===workspaceId){sendingMessage=false;updateComposerState();}
  }
};

$('#message-edit').onclick = async () => {
  if(!messageIntent||messageIntent.acceptedTurnId||workspaceSnapshot?.piDeveloperState?.privateBeta!==true||sendingMessage||reconcilingMessageIntent||!activeProject)return;
  const current=messageIntent,workspaceId=activeProject.workspace_id,generation=viewGeneration;
  sendingMessage=true;updateComposerState();bindValue($('#message-error'), () => (''));
  try{
    const result=await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(current.sessionId)}/turns/withdraw`,{method:'POST',headers:{'Idempotency-Key':current.key},body:JSON.stringify({message:current.message})});
    if(generation!==viewGeneration||activeProject?.workspace_id!==workspaceId||messageIntent?.key!==current.key)return;
    if(result?.withdrawn!==true||result?.accepted!==false)throw Error(t('composer.invalidResponse'));
    saveConversation(recoveryKey(workspaceId),{messageIntent:null,selectedSessionId:current.sessionId,draft:current.message});
    messageIntent=null;recoveredReceiptTurn=null;$('#message-input').value=current.message;
    bindValue($('#message-error'), () => (t('composer.draftRestored')));
  }catch(error){
    if(generation===viewGeneration&&activeProject?.workspace_id===workspaceId&&messageIntent?.key===current.key){
      const recoveryNotice=error.code==='turn-intent-accepted'?await reconcileMessageRecovery(workspaceId,generation):'';
      bindValue($('#message-error'), () => (recoveryNotice||errorMessage(error)));
    }
  }finally{if(generation===viewGeneration&&activeProject?.workspace_id===workspaceId){sendingMessage=false;updateComposerState();}}
};

$('#cancel-turn').onclick = async () => {
  if (!activeProject || !$('#cancel-turn').dataset.turnId) return;
  const generation = viewGeneration;
  const button = $('#cancel-turn');
  button.disabled = true;
  bindValue($('#message-error'), () => (''));
  try {
    await api(`/api/workspaces/${encodeURIComponent(activeProject.workspace_id)}/turns/${encodeURIComponent(button.dataset.turnId)}/cancel`, { method: 'POST', body: '{}' });
    if (generation === viewGeneration) await refreshWorkspace(generation);
  } catch (error) { if (generation === viewGeneration) bindValue($('#message-error'), () => (errorMessage(error))); }
  finally { button.disabled = false; }
};

$('#invite-form').onsubmit = async event => {
  event.preventDefault();
  const token = $('#invite-token').value.trim();
  if (!token) return;
  try {
    const accepted = await api('/api/invitations/accept', { method: 'POST', body: JSON.stringify({ token }) });
    $('#invite-token').value = '';
    show(msg('invitation.accepted'));
    tenant = { id: accepted.tenantId };
    accountView();
    pollDeadline = Date.now() + POLL_WINDOW_MS;
    await Promise.all([renderProjects(), loadModels()]);
  } catch (error) { show(errorMessage(error), true); }
};

function openProjectDialog(model = null) {
  intent = null;
  $('#project-title').value = '';
  $('#project-title').disabled = false;
  bindValue($('#project-error'), () => (''));
  $('#project-model').disabled = false;
  $('#project-model').value = model?.model_id && model?.version ? `${model.model_id}@${model.version}` : '';
  bindValue($('#project-submit'), () => (msg('project.create')));
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
  bindValue($('#project-error'), () => (''));
  try {
    const result = await api(`/api/tenants/${encodeURIComponent(current.tenantId)}/projects`, {
      method: 'POST', headers: { 'Idempotency-Key': current.key }, body: JSON.stringify(current.payload),
    });
    if (generation !== viewGeneration) return;
    dialog.close();
    intent = null;
    pendingProject = result.project;
    pendingProjectTenantId = current.tenantId;
    show(result.project.status === 'provisioning' ? msg('project.prepare.pending') : msg('project.created'),false,null,result.project.status==='provisioning'?{id:result.project.id}:null);
    pollDeadline = Date.now() + POLL_WINDOW_MS;
    await renderProjects();
  } catch (error) {
    if (generation !== viewGeneration) return;
    bindValue($('#project-error'), () => (errorMessage(error)));
    bindValue($('#project-submit'), () => (msg('common.retry')));
  } finally {
    creating = false;
    $('#project-submit').disabled = false;
  }
};
$('#models-refresh').onclick = () => void loadModels();
void load();
