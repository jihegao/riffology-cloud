const bootstrapToken = new URLSearchParams(location.hash.slice(1)).get('token');
let token = bootstrapToken;
try {
  token ||= sessionStorage.getItem('riffoid-ir-token');
  if (bootstrapToken) { sessionStorage.setItem('riffoid-ir-token', bootstrapToken); history.replaceState(null, '', location.pathname); }
} catch { /* Riffoid's opaque project frame deliberately has no web storage. */ }
const clientId = crypto.randomUUID();
const riffoid = window.riffoid?.irRequest;
const $ = id => document.getElementById(id);
let records = [], sealedRef, artifactRef, worker, activeRun, selectedRunId = '', refreshBusy = false, heartbeatBusy = false;
let savedDraft = '', draftDirty = false, executionBlocked = false, selectionEpoch = 0;
const call = async (operation, input = {}) => {
  let result;
  if (riffoid) result = await riffoid(operation, input);
  else {
    const response = await fetch('/v1', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ operation, input }) });
    result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  }
  if (result.status === 'failed' && result.diagnostics?.length && !(['project_ir_result', 'submit'].includes(operation) && result.runId)) throw Object.assign(new Error(result.diagnostics.map(d => `${d.stage}: ${d.message} ${d.path || ''}${d.line ? `:${d.line}:${d.column}` : ''}`).join('\n')), { result });
  return result;
};
const report = value => { $('diagnostics').classList.remove('error'); $('diagnostics').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
function failure(error) {
  const extension = error.result?.capabilityGap && error.result.development
    ? '\n\n当前浏览器执行器需要扩展。可将上述能力诊断交给 Pi 继续开发领域包；本次尚未执行。' : '';
  $('diagnostics').textContent = error.message + extension; $('diagnostics').classList.add('error');
}
function button(id, callback) {
  $(id).onclick = async () => {
    $(id).disabled = true;
    try { await callback(); } catch (error) { failure(error); }
    finally { $(id).disabled = id === 'compile' ? !sealedRef : id === 'run' ? !artifactRef : false; }
  };
}
const text = (tag, value) => { const element = document.createElement(tag); element.textContent = String(value ?? ''); return element; };
function summaryCard(title, lines) {
  const div = document.createElement('div'); div.className = 'summary-item'; div.append(text('strong', title));
  lines.forEach(line => div.append(text('p', line))); return div;
}
async function loadDraft() {
  try { $('draft').value = (await call('draft')).draft; } catch { $('draft').value = ''; }
  savedDraft = $('draft').value; draftDirty = false;
  const state = await call('show');
  const model = state.currentModel?.summary;
  $('summary').replaceChildren();
  if (!model) { $('summary').append(text('p', '尚未创建 Business IR。创建 B1 草稿，或让 Agent 按需求建模。')); return; }
  const grid = document.createElement('div'); grid.className = 'summary-grid';
  grid.append(summaryCard('Aircraft / 飞机', model.aircraft.map(a => `${a.businessId} · ${a.initial_state}`)),
    summaryCard('Missions / 任务', model.tasks.map(t => `${t.id} · ${t.firstWaveTime}`)),
    summaryCard('Rules / 任务规则', model.missionRules.map(m => `${m.businessId}: ${m.taskDurationMinutes} 分钟，成功点 ${m.successPoint}`)),
    summaryCard('Resources / 资源', model.resources.map(r => `${r.businessId}: 人员 ${r.personnel_capacity} / 设备 ${r.equipment_capacity}`)),
    summaryCard('Support / 保障', model.support.map(a => `${a.businessId}: ${a.jobs.reduce((n, j) => n + j.durationMinutes, 0)} 分钟`)),
    summaryCard('Protocol / 时间与假设', [`时长 ${model.durationMinutes} 分钟`, model.profile, ...model.assumptions]));
  $('summary').append(grid);
}
function renderRecord() {
  const record = records.find(r => r.runId === selectedRunId);
  $('replay').disabled = !record;
  if (!record) return;
  $('run-status').textContent = `${record.runId} · ${record.status}${record.sourceRunId ? ` · 复跑自 ${record.sourceRunId}` : ''}`;
  $('identity').textContent = JSON.stringify({ modelRef: record.modelRef, bundleRef: record.bundleRef, browserArtifactRef: record.browserArtifactRef,
    businessFingerprint: record.businessFingerprint, planFingerprint: record.planFingerprint, inputs: record.inputs, execution: record.execution,
    toolchain: record.toolchain, recordRef: record.recordRef, diagnostics: record.diagnostics }, null, 2);
  $('metrics').replaceChildren();
  Object.entries(record.metrics || {}).forEach(([name, value]) => {
    const card = document.createElement('div'); card.className = 'metric'; card.append(text('span', name), text('strong', value)); $('metrics').append(card);
  });
  $('events').replaceChildren();
  (record.events || []).forEach(event => {
    const row = document.createElement('tr');
    [event.sequence, event.time, event.phase, `${event.kind}\n${event.entity}`, event.source_path || event.rule_id].forEach(value => row.append(text('td', value)));
    $('events').append(row);
  });
  compare();
}
function compare() {
  const a = records.find(r => r.runId === $('compare-runs').value), b = records.find(r => r.runId === selectedRunId);
  if (!a?.metrics || !b?.metrics) return;
  const metrics = Object.keys(b.metrics).map(key => `${key}: ${a.metrics[key]} → ${b.metrics[key]}`);
  const kinds = new Set(['mission_launched', 'mission_success_point_succeeded', 'mission_returned', 'postflight_completed']);
  const timeline = r => (r.events || []).filter(e => kinds.has(e.kind)).map(e => `${e.kind} ${e.entity} @ ${e.time}`).join('\n');
  $('comparison').textContent = `${a.runId} → ${b.runId}\n${metrics.join('\n')}\n\n对照事件\n${timeline(a)}\n\n当前事件\n${timeline(b)}`;
}
async function renderSelected() {
  const epoch = ++selectionEpoch, ids = [...new Set([selectedRunId, $('compare-runs').value].filter(Boolean))];
  if (riffoid) {
    const detail = await Promise.all(ids.map(runId => call('project_ir_result', { runId })));
    if (epoch !== selectionEpoch) return;
    for (const record of detail) {
      const index = records.findIndex(item => item.runId === record.runId);
      if (index >= 0) records[index] = record;
    }
  }
  renderRecord();
}
async function refreshRecords() {
  if (refreshBusy) return; refreshBusy = true;
  try {
    records = (await call('records')).records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!selectedRunId && records.length) selectedRunId = records.at(-1).runId;
    const oldCompare = $('compare-runs').value;
    for (const id of ['runs', 'compare-runs']) {
      $(id).replaceChildren(text('option', id === 'runs' ? '选择运行记录' : '选择对照记录')); $(id).firstChild.value = '';
      records.forEach(record => { const option = text('option', `${record.createdAt.slice(11, 19)} · ${record.status} · ${record.runId}`); option.value = record.runId; $(id).append(option); });
    }
    $('runs').value = selectedRunId; $('compare-runs').value = oldCompare;
    await renderSelected();
  } finally { refreshBusy = false; }
}
async function executeClaim(claim) {
  activeRun = claim.run.runId; selectedRunId = activeRun;
  $('run-status').textContent = `${activeRun} · running · 用户浏览器 Worker 执行中`;
  if (riffoid) {
    if (typeof claim.workerSource !== 'string' || !/^[a-f0-9]{64}$/.test(claim.run.workerSha256 || '')) throw new Error('缺少已冻结的浏览器 Worker 身份');
    const workerHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(claim.workerSource))), byte => byte.toString(16).padStart(2, '0')).join('');
    if (workerHash !== claim.run.workerSha256) throw new Error('已冻结的浏览器 Worker 校验失败');
  }
  const workerUrl = claim.workerSource ? URL.createObjectURL(new Blob([claim.workerSource], { type: 'text/javascript' })) : '/assets/worker.js';
  // Opaque project frames cannot load a Blob module Worker in Chromium. The
  // shared wrapper has no static imports and imports the same frozen ESM runtime.
  try { worker = new Worker(workerUrl, { type: riffoid ? 'classic' : 'module' }); }
  catch (error) { if (claim.workerSource) URL.revokeObjectURL(workerUrl); throw error; }
  const current = worker;
  const timeout = setTimeout(() => finish({ error: 'Browser execution exceeded 10 seconds' }), 10_000);
  let finished = false;
  async function finish(result) {
    if (finished) return; finished = true; clearTimeout(timeout); current.terminate();
    if (claim.workerSource) URL.revokeObjectURL(workerUrl);
    try { await call('submit', { runId: claim.run.runId, clientId, ...result }); }
    catch (error) { executionBlocked = true; failure(new Error(`结果未保存，执行器已暂停：${error.message}`));
      $('connection').textContent = '结果保存失败 · 执行器已暂停'; await call('detach', { clientId }).catch(() => {}); }
    finally { activeRun = undefined; worker = undefined; await refreshRecords().catch(failure); }
  }
  current.onmessage = event => { void finish(event.data); };
  current.onerror = event => { void finish({ error: event.message || 'Browser Worker failed' }); };
  current.postMessage({ ...claim, token });
}
async function heartbeat() {
  if (heartbeatBusy || executionBlocked) return; heartbeatBusy = true;
  try {
    const claim = await call('heartbeat', { clientId });
    $('connection').textContent = '● 浏览器执行器已连接';
    if (claim.run && !activeRun) void executeClaim(claim).catch(async error => {
      failure(error);
      try { await call('submit', { runId: claim.run.runId, clientId, error: String(error.message || error).slice(0, 4000) }); }
      catch (saveError) { executionBlocked = true; failure(new Error(`结果未保存，执行器已暂停：${saveError.message}`));
        $('connection').textContent = '结果保存失败 · 执行器已暂停'; await call('detach', { clientId }).catch(() => {}); }
      activeRun = undefined;
    });
  } catch (error) { $('connection').textContent = '连接中断'; failure(error); }
  finally { heartbeatBusy = false; }
}
button('example', async () => { report(await call('example')); await loadDraft(); });
button('reload', loadDraft);
button('save', async () => { await call('save-draft', { draft: $('draft').value }); sealedRef = artifactRef = undefined;
  $('compile').disabled = $('run').disabled = true; $('draft-status').textContent = '已保存；需重新检查和编译'; await loadDraft(); });
button('check', async () => { sealedRef = artifactRef = undefined; $('compile').disabled = $('run').disabled = true;
  const result = await call('project_ir_check', { draftRef: 'model/business-ir.draft.json' }); sealedRef = result.sealedRef;
  $('compile').disabled = false; report(result); });
button('compile', async () => { artifactRef = undefined; $('run').disabled = true; const result = await call('project_ir_compile', { sealedRef });
  artifactRef = result.browserArtifactRef; $('run').disabled = false; report(result); });
async function requestRun(input) { const result = await call('project_ir_run', input); report(result); if (result.runId) selectedRunId = result.runId; await refreshRecords(); }
button('run', () => requestRun({ browserArtifactRef: artifactRef }));
button('replay', () => requestRun({ sourceRunId: selectedRunId }));
button('refresh', refreshRecords);
$('runs').onchange = () => { selectedRunId = $('runs').value; void renderSelected().catch(failure); };
$('compare-runs').onchange = () => { void renderSelected().catch(failure); };
$('draft').oninput = () => { draftDirty = true; $('draft-status').textContent = '未保存的修改'; };
if (riffoid) {
  $('draft').readOnly = true;
  $('draft-status').textContent = '请在对话中让 Pi 修改模型；此处显示已保存的草稿。';
  const guidance = {
    example: '请在对话中让 Pi 创建 B1 模型；也可以要求只生成、暂不运行。',
    save: '请在对话中说明要修改的业务规则，Pi 会修改并保存模型。',
    check: '请在对话中让 Pi 检查当前 IR 模型。',
    compile: '请在对话中让 Pi 编译当前 IR 模型。',
    run: '请在对话中让 Pi 运行当前 IR 模型，并保持此页面打开。',
    replay: () => selectedRunId ? `请在对话中让 Pi 按原条件复跑 ${selectedRunId}，并保持此页面打开。` : '请先选择已保存的运行。',
  };
  for (const [id, instruction] of Object.entries(guidance)) {
    $(id).disabled = false;
    $(id).onclick = () => report(typeof instruction === 'function' ? instruction() : instruction);
  }
}
window.addEventListener('pagehide', () => {
  worker?.terminate();
  if (riffoid) { void riffoid('detach', { clientId }).catch(() => {}); return; }
  void fetch('/v1', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ operation: 'detach', input: { clientId } }) }).catch(() => {});
});
if (!token && !riffoid) { failure(new Error('缺少工作区连接。请从 PI WEB 的 IR Model 面板打开。')); }
else {
  // Native project-frame installation waits for module evaluation. Remote
  // workspace reads must finish independently of that short script deadline.
  void (async () => {
    await Promise.all([heartbeat(), loadDraft().catch(failure), refreshRecords().catch(failure)]);
    setInterval(heartbeat, 1000); setInterval(() => void refreshRecords().catch(failure), 2000);
    setInterval(async () => {
      if (draftDirty || document.activeElement === $('draft')) return;
      try { const { draft } = await call('draft'); if (draft !== savedDraft) await loadDraft(); }
      catch (error) { if (riffoid) failure(error); }
    }, 2500);
  })().catch(failure);
}
