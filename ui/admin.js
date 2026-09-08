import { icon, esc, badge, money, pageHeader, emptyState } from './shared.js';

const filters = {
  models: { query: '', status: 'all' },
  tenants: { query: '', status: 'all' },
  runs: { query: '', status: 'all', kind: 'all' },
  billing: { query: '', status: 'all', kind: 'all' },
  audit: { query: '', kind: 'all' },
};
const modelLabels = { draft: '草稿', validated: '已验证', published: '已发布', withdrawn: '已撤回' };
const runLabels = { running: '运行中', queued: '排队中', completed: '已完成', failed: '失败', stopped: '已停止' };
const kindLabels = { experiment: '批量实验', preview: '交互预览', turn: 'Agent 回合' };
const ledgerLabels = { consumption: 'AI 消费', topup: '充值', compensation: '服务补偿', reservation: '额度预留' };
const billingLabels = { settled: '已入账', pending: '待核对', reserved: '预留中', released: '已释放' };
const auditLabels = { model: '模型版本', tenant: '租户管理', run: '运行干预', billing: '账务处理' };
const tones = { published: 'success', validated: 'info', draft: 'neutral', withdrawn: 'danger', running: 'success', queued: 'warning', completed: 'neutral', failed: 'danger', stopped: 'neutral', settled: 'success', pending: 'warning', reserved: 'info', released: 'neutral', active: 'success', suspended: 'danger' };
const dateTime = () => new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const number = value => Number(value).toLocaleString('zh-CN');
const cents = value => Math.round(Number(value) * 100);
const safeId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const btn = (label, action, id = '', style = 'secondary small', extra = '') => `<button class="btn ${style}" data-action="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;
const statusBadge = (status, dictionary) => badge(dictionary[status] || status, tones[status] || 'neutral');

function ensure(ctx) {
  if (ctx.state.admin?.schema === 1) return ctx.state.admin;
  ctx.state.admin = {
    schema: 1,
    models: [
      { id: 'airport-110', modelId: 'airport-support', name: '机场地面保障', category: '资源调度', version: '1.1.0', status: 'validated', updated: '09/05 09:20', copies: 0, digest: '7ae814c…91e2', description: '在航班到达、保障资源与离场时限之间，观察资源配置对延误的影响。', assumptions: '独立航班到达；保障时长使用配置分布；不包含天气与机场管制。', checks: 12, totalChecks: 12, license: 'MIT', parameters: '航班数量、保障车数量、到达间隔、服务时长', metrics: '平均周转时间、等待时间、资源利用率', changelog: '新增车辆利用率与资源瓶颈说明，保留默认参数和固定种子。' },
      { id: 'airport-100', modelId: 'airport-support', name: '机场地面保障', category: '资源调度', version: '1.0.0', status: 'published', updated: '09/02 16:40', copies: 18, digest: '1cd07a9…e541', description: '通过离散事件模拟理解机场保障资源与航班延误。', assumptions: '独立航班到达；不包含天气与机场管制。', checks: 10, totalChecks: 10, license: 'MIT', parameters: '航班数量、保障车数量、到达间隔、服务时长', metrics: '平均周转时间、等待时间', changelog: '初始版本：流程预览、资源参数与固定种子实验。' },
      { id: 'queue-100', modelId: 'service-queue', name: '服务窗口排队', category: '排队系统', version: '1.0.0', status: 'published', updated: '09/03 11:10', copies: 12, digest: '5fac902…390a', description: '比较不同服务窗口数量下的队长、等待时间与利用率。', assumptions: '先到先服务；泊松到达；不包含客户放弃排队。', checks: 8, totalChecks: 8, license: 'MIT', parameters: '到达率、服务时长、窗口数量', metrics: '平均等待时间、队长、窗口利用率', changelog: '单队列多窗口模型与重复实验示例。' },
      { id: 'inventory-100', modelId: 'inventory-control', name: '库存与补货', category: '库存管理', version: '1.0.0', status: 'draft', updated: '09/04 18:05', copies: 0, digest: '未生成', description: '探索补货点和交货时间对缺货与库存成本的影响。', assumptions: '单品库存；固定交货时间；需求独立。', checks: 0, totalChecks: 9, license: 'MIT', parameters: '补货点、补货量、交货时间、日需求', metrics: '缺货率、平均库存、订单数量', changelog: '首版草稿，等待执行发布包验证。' },
    ],
    tenants: [
      { id: 'tn_zhou', name: '周一的空间', owner: 'zhou@example.test', status: 'active', projects: 4, balance: 12680, reserved: 340, spent: 4320, runtime: 46, runtimeLimit: 180, storage: 0.8, storageLimit: 5, concurrency: 2, turnBudget: 1000, calls: 42, created: '09/01' },
      { id: 'tn_lin', name: '林可的空间', owner: 'lin@example.test', status: 'active', projects: 3, balance: 6840, reserved: 220, spent: 3160, runtime: 92, runtimeLimit: 120, storage: 1.2, storageLimit: 5, concurrency: 2, turnBudget: 1000, calls: 31, created: '09/01' },
      { id: 'tn_chen', name: '陈遥的空间', owner: 'chen@example.test', status: 'active', projects: 2, balance: 2380, reserved: 0, spent: 7620, runtime: 117, runtimeLimit: 120, storage: 0.4, storageLimit: 5, concurrency: 1, turnBudget: 500, calls: 26, created: '09/02' },
      { id: 'tn_xu', name: '许宁的空间', owner: 'xu@example.test', status: 'active', projects: 5, balance: 20000, reserved: 150, spent: 2240, runtime: 64, runtimeLimit: 180, storage: 2.1, storageLimit: 5, concurrency: 2, turnBudget: 2000, calls: 19, created: '09/02' },
      { id: 'tn_he', name: '何知的空间', owner: 'he@example.test', status: 'active', projects: 1, balance: 0, reserved: 0, spent: 5000, runtime: 18, runtimeLimit: 120, storage: 0.2, storageLimit: 5, concurrency: 1, turnBudget: 500, calls: 12, created: '09/03' },
      { id: 'tn_wang', name: '王澄的空间', owner: 'wang@example.test', status: 'suspended', projects: 2, balance: 4500, reserved: 0, spent: 500, runtime: 14, runtimeLimit: 120, storage: 0.3, storageLimit: 5, concurrency: 1, turnBudget: 500, calls: 8, created: '09/03', reason: '租户主动申请暂停新增计算' },
    ],
    runs: [
      { id: 'run_8042', tenantId: 'tn_zhou', project: 'prj_a91', kind: 'experiment', status: 'running', progress: 68, complete: 34, samples: 50, revision: 'rev_008', elapsed: '04:32', created: '09/05 10:26', cpu: '1 vCPU', memory: '512 MB', generation: 3 },
      { id: 'run_8041', tenantId: 'tn_lin', project: 'prj_b72', kind: 'preview', status: 'running', progress: 100, complete: 1, samples: 1, revision: 'rev_012', elapsed: '12:08', created: '09/05 10:18', cpu: '1 vCPU', memory: '256 MB', generation: 1 },
      { id: 'turn_3902', tenantId: 'tn_xu', project: 'prj_c16', kind: 'turn', status: 'running', progress: 45, complete: 3, samples: 7, revision: 'rev_004', elapsed: '00:42', created: '09/05 10:30', cpu: '1 vCPU', memory: '384 MB', generation: 2 },
      { id: 'run_8040', tenantId: 'tn_zhou', project: 'prj_a38', kind: 'experiment', status: 'queued', progress: 0, complete: 0, samples: 100, revision: 'rev_003', elapsed: '—', created: '09/05 10:29', cpu: '1 vCPU', memory: '512 MB', generation: 1 },
      { id: 'run_8039', tenantId: 'tn_chen', project: 'prj_d20', kind: 'experiment', status: 'failed', progress: 80, complete: 16, samples: 20, revision: 'rev_006', elapsed: '03:12', created: '09/05 10:15', cpu: '1 vCPU', memory: '512 MB', generation: 1, error: '执行环境超出内存限额；已保存 16 个样本。' },
      { id: 'run_8038', tenantId: 'tn_lin', project: 'prj_b72', kind: 'experiment', status: 'completed', progress: 100, complete: 30, samples: 30, revision: 'rev_011', elapsed: '02:46', created: '09/05 09:56', cpu: '1 vCPU', memory: '512 MB', generation: 1 },
      { id: 'run_8037', tenantId: 'tn_he', project: 'prj_e53', kind: 'experiment', status: 'completed', progress: 100, complete: 10, samples: 10, revision: 'rev_002', elapsed: '01:38', created: '09/05 09:42', cpu: '1 vCPU', memory: '256 MB', generation: 1 },
    ],
    ledger: [
      { id: 'led_2108', tenantId: 'tn_zhou', kind: 'consumption', status: 'pending', amount: null, reservation: 180, reference: 'req_8912', turn: 'turn_3898', project: 'prj_a91', time: '09/05 10:28', tokens: null, reason: '供应商响应缺少用量，等待对账。' },
      { id: 'led_2107', tenantId: 'tn_lin', kind: 'consumption', status: 'pending', amount: null, reservation: 120, reference: 'req_8910', turn: 'turn_3896', project: 'prj_b72', time: '09/05 10:24', tokens: null, reason: '请求已派发，连接中断后实际用量未知。' },
      { id: 'led_2106', tenantId: 'tn_xu', kind: 'reservation', status: 'reserved', amount: 150, reservation: 150, reference: 'req_8909', turn: 'turn_3902', project: 'prj_c16', time: '09/05 10:22', tokens: null },
      { id: 'led_2105', tenantId: 'tn_zhou', kind: 'consumption', status: 'settled', amount: -85, reservation: 0, reference: 'req_8908', turn: 'turn_3894', project: 'prj_a91', time: '09/05 10:18', tokens: 14250, inputTokens: 12500, outputTokens: 1750, priceVersion: 'demo-2026-09', reason: '已确认供应商用量并完成结算。' },
      { id: 'led_2104', tenantId: 'tn_chen', kind: 'consumption', status: 'settled', amount: -124, reservation: 0, reference: 'req_8906', turn: 'turn_3892', project: 'prj_d20', time: '09/05 10:10', tokens: 20600, inputTokens: 18000, outputTokens: 2600, priceVersion: 'demo-2026-09', reason: '平台重试产生重复消费，可按实际证据补偿。' },
      { id: 'led_2103', tenantId: 'tn_lin', kind: 'topup', status: 'settled', amount: 10000, reservation: 0, reference: 'pay_demo_121', time: '09/05 09:54', tokens: null, reason: '示例支付记录；没有发生真实支付。' },
      { id: 'led_2102', tenantId: 'tn_zhou', kind: 'consumption', status: 'settled', amount: -64, reservation: 0, reference: 'req_8901', turn: 'turn_3881', project: 'prj_a91', time: '09/05 09:36', tokens: 10400, inputTokens: 9000, outputTokens: 1400, priceVersion: 'demo-2026-09' },
    ],
    audit: [
      { id: 'evt_101', kind: 'model', action: '验证版本', target: 'airport-support / 1.1.0', detail: '发布包检查通过 12 / 12；验证记录为原型示例。', actor: '平台管理员', time: '09/05 09:20' },
      { id: 'evt_100', kind: 'tenant', action: '暂停新增工作', target: 'tn_wang', detail: '租户主动申请暂停新增计算', actor: '平台管理员', time: '09/04 17:42' },
      { id: 'evt_099', kind: 'model', action: '发布版本', target: 'service-queue / 1.0.0', detail: '工程检查、许可与模型假设已确认。', actor: '平台管理员', time: '09/03 11:10' },
    ],
  };
  ctx.save();
  return ctx.state.admin;
}

function log(ctx, kind, action, target, detail) {
  ctx.state.admin.audit.unshift({ id: safeId('evt'), kind, action, target, detail, actor: '平台管理员', time: dateTime() });
}
function finish(ctx, message) { ctx.save(); ctx.closeModal(); ctx.render(); ctx.toast(message); }
function tenantName(a, id) { return a.tenants.find(t => t.id === id)?.name || id; }
function metric(label, value, note, glyph, extra = '') {
  return `<article class="stat-card admin-stat ${extra}"><div class="admin-stat-top"><span>${label}</span>${icon(glyph)}</div><strong>${value}</strong><span class="admin-stat-note">${note}</span></article>`;
}
function options(labels, current, all = '全部状态') {
  return `<option value="all">${all}</option>${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`).join('')}`;
}
function searchBox(value, placeholder) {
  return `<label class="admin-search">${icon('search', 17)}<span class="admin-sr-only">${placeholder}</span><input class="input" data-filter="query" value="${esc(value)}" placeholder="${placeholder}" type="search"></label>`;
}
function detailGrid(items) { return `<dl class="admin-detail-grid">${items.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`; }
function help(text, tone = '') { return `<div class="admin-note ${tone}">${icon('info', 17)}<p>${text}</p></div>`; }
function reasonField(label = '操作原因', placeholder = '填写原因，便于后续追溯') {
  return `<label class="field admin-modal-field"><span>${label}<span class="admin-required"> *</span></span><textarea class="input admin-textarea" name="reason" placeholder="${placeholder}" maxlength="300" required></textarea></label><p class="admin-form-error" data-form-error role="alert"></p>`;
}
function getReason(root) {
  const field = root.querySelector('[name="reason"]');
  const value = field?.value.trim();
  if (!value) { root.querySelector('[data-form-error]').textContent = '请填写操作原因。'; field?.focus(); return null; }
  return value;
}
function modalButtons(primary, danger = false) { return `<button class="btn secondary" data-modal-cancel>取消</button><button class="btn ${danger ? 'danger' : 'primary'}" data-modal-confirm>${primary}</button>`; }
function bindCancel(root, ctx) { root.querySelector('[data-modal-cancel]')?.addEventListener('click', () => ctx.closeModal()); }

function overview(a) {
  const running = a.runs.filter(r => r.status === 'running').length;
  const queued = a.runs.filter(r => r.status === 'queued').length;
  const pending = a.ledger.filter(e => e.status === 'pending').length;
  const validated = a.models.filter(m => m.status === 'validated').length;
  const nearLimit = a.tenants.filter(t => t.runtime / t.runtimeLimit >= 0.9 && t.status === 'active').length;
  const recentExpense = a.ledger.filter(e => e.kind === 'consumption' && e.status === 'settled').reduce((sum, e) => sum + Math.abs(e.amount), 0);
  const rows = a.runs.filter(r => ['running', 'queued', 'failed'].includes(r.status)).slice(0, 4);
  const bars = [26, 38, 30, 44, 40, 54, 68, 58, 64, 78, 72, 90];
  return `${pageHeader('平台管理 / 总览', '让每一次建模顺畅发生。', '关注运行健康、待处理事项与服务用量。', `<span class="admin-date">${icon('clock', 16)}2026 年 9 月 5 日 · 示例快照</span>`)}
    <div class="stats-grid admin-stats">${metric('活跃租户', a.tenants.filter(t => t.status === 'active').length, `共 ${a.tenants.length} 个个人空间`, 'users')}${metric('正在执行', running, `${queued} 个任务排队中`, 'activity')}${metric('已确认 AI 消费', money(recentExpense), '本页示例账本 · 未含待核对', 'wallet')}${metric('需要处理', pending + validated + nearLimit, '账务、版本与运行额度', 'alert', 'admin-stat-accent')}</div>
    <div class="admin-overview-grid"><section class="card admin-chart-card"><div class="admin-section-head"><div><p class="eyebrow">服务用量</p><h2>建模活动</h2></div><span class="admin-chart-legend"><i></i>运行占用示意</span></div><div class="admin-chart" role="img" aria-label="示例运行占用趋势：凌晨较低，上午逐步升高，非实时数据"><div class="admin-chart-guide"><span>高</span><span>中</span><span>低</span></div><div class="admin-bars">${bars.map((v, i) => `<div class="admin-bar-col"><div class="admin-bar ${i === 11 ? 'admin-bar-current' : ''}" style="height:${v}%" title="${i * 2}:00 · 示意值 ${v}"></div><span>${i % 2 === 0 ? String(i * 2).padStart(2, '0') + ':00' : ''}</span></div>`).join('')}</div></div><div class="admin-chart-caption"><span>趋势图仅用于展示视觉与交互结构</span><span>UTC+8</span></div></section>
    <section class="card admin-todo-card"><div class="admin-section-head"><h2>待处理</h2>${badge('按影响排序', 'neutral')}</div><button class="admin-todo" data-action="go-pending"><span class="admin-todo-icon admin-todo-amber">${icon('wallet', 19)}</span><span><strong>${pending} 笔用量待核对</strong><small>保留预留，核实后结算或释放</small></span>${icon('chevronRight', 17)}</button><button class="admin-todo" data-action="go-models"><span class="admin-todo-icon">${icon('library', 19)}</span><span><strong>${validated} 个版本待发布</strong><small>检查假设、许可与验证证据</small></span>${icon('chevronRight', 17)}</button><button class="admin-todo" data-action="go-tenants"><span class="admin-todo-icon admin-todo-amber">${icon('users', 19)}</span><span><strong>${nearLimit} 个租户接近运行限额</strong><small>仅限制新增工作，已保存内容可读</small></span>${icon('chevronRight', 17)}</button><div class="admin-system-line"><span class="admin-live-dot"></span>控制面状态展示正常 <span>示例</span></div></section></div>
    <section class="card admin-table-card"><div class="admin-section-head"><div><h2>运行中的工作</h2><p>仅展示运行元数据，用户项目内容保持隔离。</p></div>${btn('查看全部 ' + icon('arrowRight', 15), 'go-runs', '', 'ghost small')}</div><div class="table-wrap"><table class="data-table"><thead><tr><th>任务 / 归属空间</th><th>类型</th><th>进度</th><th>状态</th><th>已运行</th><th></th></tr></thead><tbody>${rows.map(r => runRow(a, r, true)).join('') || `<tr><td colspan="6">${emptyState('当前没有活动任务', '新运行将在这里出现。')}</td></tr>`}</tbody></table></div></section>`;
}

function modelsPage(a) {
  const f = filters.models;
  const rows = a.models.filter(m => (f.status === 'all' || m.status === f.status) && `${m.name} ${m.modelId} ${m.version}`.toLowerCase().includes(f.query.toLowerCase()));
  return `${pageHeader('平台管理 / 官方模型', '把可靠的起点交给用户。', '管理仿真模型版本、验证证据和发布状态。', btn(icon('plus', 17) + ' 新建版本', 'model-create', '', 'primary'))}
    <div class="admin-summary-strip"><div><span class="admin-mini-symbol">${icon('library', 20)}</span><strong>${new Set(a.models.map(m => m.modelId)).size}</strong><span>个模型</span></div><div><strong>${a.models.filter(m => m.status === 'published').length}</strong><span>个已发布版本</span></div><div><strong>${a.models.reduce((s, m) => s + m.copies, 0)}</strong><span>次独立项目创建</span></div><span class="admin-strip-note">新版本发布后，已有项目保持原版本</span></div>
    <section class="card admin-table-card"><div class="toolbar admin-toolbar">${searchBox(f.query, '搜索模型名称、标识或版本')}<label class="admin-select-label"><span class="admin-sr-only">版本状态</span><select class="select" data-filter="status">${options(modelLabels, f.status)}</select></label><span class="admin-count">${rows.length} 个版本</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>模型</th><th>版本</th><th>状态</th><th>验证</th><th>创建项目</th><th>最近更新</th><th>操作</th></tr></thead><tbody>${rows.map(m => `<tr><td><button class="admin-name-link" data-action="model-detail" data-id="${m.id}">${esc(m.name)}</button><span class="admin-cell-sub">${esc(m.category)} · Python / SimPy</span></td><td><span class="admin-mono">v${esc(m.version)}</span></td><td>${statusBadge(m.status, modelLabels)}</td><td>${m.checks === m.totalChecks ? `<span class="admin-check-text">${icon('checkCircle', 15)} ${m.checks}/${m.totalChecks}</span>` : '<span class="muted">尚未验证</span>'}</td><td>${m.copies}</td><td class="admin-time">${m.updated}</td><td><div class="admin-row-actions">${btn('详情', 'model-detail', m.id, 'ghost small')}${m.status === 'validated' ? btn('发布', 'model-publish', m.id, 'secondary small') : m.status === 'published' ? btn('撤回', 'model-withdraw', m.id, 'ghost small') : m.status === 'draft' ? btn('验证', 'model-validate', m.id, 'secondary small') : ''}</div></td></tr>`).join('') || `<tr><td colspan="7">${emptyState('没有匹配的版本', '调整搜索条件或创建一个新版本。')}</td></tr>`}</tbody></table></div></section>${help('已发布内容不可覆盖。发布修订需创建新版本；撤回仅阻止新项目使用，已有用户项目不会被删除。')}`;
}

function tenantsPage(a) {
  const f = filters.tenants;
  const rows = a.tenants.filter(t => (f.status === 'all' || t.status === f.status) && `${t.id} ${t.name} ${t.owner}`.toLowerCase().includes(f.query.toLowerCase()));
  return `${pageHeader('平台管理 / 租户', '清晰归属，独立边界。', '管理个人空间的状态和服务额度。团队与教学空间将在后续开放。')}
    <div class="stats-grid admin-stats">${metric('个人租户', a.tenants.length, `${a.tenants.reduce((s, t) => s + t.projects, 0)} 个独立项目`, 'users')}${metric('可用余额合计', money(a.tenants.reduce((s, t) => s + t.balance - t.reserved, 0)), '已入账余额减去有效预留', 'wallet')}${metric('运行额度使用', number(a.tenants.reduce((s, t) => s + t.runtime, 0)) + '<small> 分钟</small>', '当前示例周期', 'clock')}${metric('暂停新增工作', a.tenants.filter(t => t.status === 'suspended').length, '已保存内容仍可查看与导出', 'pause')}</div>
    <section class="card admin-table-card"><div class="toolbar admin-toolbar">${searchBox(f.query, '搜索空间名称、租户 ID 或邮箱')}<select class="select" data-filter="status" aria-label="租户状态">${options({ active: '正常', suspended: '已暂停' }, f.status)}</select><span class="admin-count">${rows.length} 个租户</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>空间 / 所有者</th><th>状态</th><th>项目</th><th>可用余额</th><th>运行分钟</th><th>存储</th><th>操作</th></tr></thead><tbody>${rows.map(t => `<tr><td><button class="admin-name-link" data-action="tenant-detail" data-id="${t.id}">${esc(t.name)}</button><span class="admin-cell-sub">${esc(t.owner)}</span></td><td>${statusBadge(t.status, { active: '正常', suspended: '已暂停' })}</td><td>${t.projects}</td><td><strong class="admin-amount">${money(t.balance - t.reserved)}</strong>${t.reserved ? `<span class="admin-cell-sub">${money(t.reserved)} 预留中</span>` : ''}</td><td><div class="admin-quota"><span class="${t.runtime / t.runtimeLimit >= 0.9 ? 'admin-warning-text' : ''}">${t.runtime} <span class="muted">/ ${t.runtimeLimit}</span></span><div class="admin-meter"><i class="${t.runtime / t.runtimeLimit >= 0.9 ? 'admin-meter-amber' : ''}" style="width:${Math.min(t.runtime / t.runtimeLimit * 100, 100)}%"></i></div></div></td><td>${t.storage} <span class="muted">/ ${t.storageLimit} GB</span></td><td><div class="admin-row-actions">${btn('额度', 'tenant-quota', t.id, 'secondary small')}${btn(t.status === 'active' ? '暂停' : '恢复', 'tenant-toggle', t.id, 'ghost small')}</div></td></tr>`).join('') || `<tr><td colspan="7">${emptyState('没有匹配的租户', '尝试调整状态筛选或搜索词。')}</td></tr>`}</tbody></table></div></section>${help('平台管理端只查看身份、配额、账务与运行元数据。租户项目文件、会话正文与 Preview 不提供直接访问入口。')}`;
}

function runRow(a, r, compact = false) {
  const progressText = r.kind === 'experiment' ? `${r.complete} / ${r.samples} 个样本` : r.kind === 'preview' ? (r.status === 'running' ? '服务已就绪' : '服务已结束') : `${r.complete} 次工具操作`;
  return `<tr><td><button class="admin-name-link admin-mono" data-action="run-detail" data-id="${r.id}">${r.id}</button><span class="admin-cell-sub">${esc(tenantName(a, r.tenantId))}</span></td><td>${kindLabels[r.kind]}</td><td><div class="admin-run-progress"><span>${progressText}</span>${r.kind === 'experiment' ? `<div class="admin-meter"><i style="width:${r.progress}%"></i></div>` : ''}</div></td><td>${statusBadge(r.status, runLabels)}</td><td class="admin-mono">${r.elapsed}</td>${compact ? '' : `<td class="admin-time">${r.created}</td>`}<td><div class="admin-row-actions">${btn('详情', 'run-detail', r.id, 'ghost small')}${['running', 'queued'].includes(r.status) ? btn(r.status === 'queued' ? '取消' : '停止', 'run-stop', r.id, 'secondary small') : ''}</div></td></tr>`;
}
function runsPage(a) {
  const f = filters.runs;
  const rows = a.runs.filter(r => (f.status === 'all' || r.status === f.status) && (f.kind === 'all' || r.kind === f.kind) && `${r.id} ${r.project} ${tenantName(a, r.tenantId)}`.toLowerCase().includes(f.query.toLowerCase()));
  return `${pageHeader('平台管理 / 运行', '每个任务都有明确状态。', '观察任务队列与资源占用，按具体任务处理异常。')}
    <div class="admin-run-summary">${['running', 'queued', 'failed', 'completed'].map(s => `<button class="admin-summary-button ${f.status === s ? 'admin-selected' : ''}" data-action="run-filter" data-id="${s}"><span class="admin-status-dot admin-status-${s}"></span><span>${runLabels[s]}</span><strong>${a.runs.filter(r => r.status === s).length}</strong></button>`).join('')}</div>
    <section class="card admin-table-card"><div class="toolbar admin-toolbar">${searchBox(f.query, '搜索任务、项目 ID 或空间')}<select class="select" data-filter="kind" aria-label="任务类型">${options(kindLabels, f.kind, '全部类型')}</select><select class="select" data-filter="status" aria-label="任务状态">${options(runLabels, f.status)}</select><span class="admin-count">${rows.length} 个任务</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>任务 / 归属空间</th><th>类型</th><th>完成情况</th><th>状态</th><th>已运行</th><th>开始时间</th><th>操作</th></tr></thead><tbody>${rows.map(r => runRow(a, r)).join('') || `<tr><td colspan="7">${emptyState('没有匹配的任务', '切换任务类型或状态，查看其他运行。')}</td></tr>`}</tbody></table></div></section>${help('停止只作用于选中的任务。已完成样本与已确认文件版本保留，其他租户及同项目的独立任务继续运行。')}`;
}

function billingPage(a) {
  const f = filters.billing;
  const rows = a.ledger.filter(e => (f.status === 'all' || e.status === f.status) && (f.kind === 'all' || e.kind === f.kind) && `${e.id} ${e.reference} ${e.turn || ''} ${tenantName(a, e.tenantId)}`.toLowerCase().includes(f.query.toLowerCase()));
  const pending = a.ledger.filter(e => e.status === 'pending');
  const consumption = a.ledger.filter(e => e.kind === 'consumption' && e.status === 'settled').reduce((s, e) => s - e.amount, 0);
  const compensation = a.ledger.filter(e => e.kind === 'compensation').reduce((s, e) => s + e.amount, 0);
  return `${pageHeader('平台管理 / 账务', '每笔变化，都有来由。', '按用量证据结算，保留预留、原始消费与调整记录。', btn('示例价目表', 'billing-prices', '', 'secondary') + btn(icon('download', 16) + ' 导出当前记录', 'billing-export', '', 'secondary'))}
    <div class="stats-grid admin-stats">${metric('已确认 AI 消费', money(consumption), '当前示例记录', 'wallet')}${metric('服务补偿', money(compensation), '追加调整，不覆盖原消费', 'refresh')}${metric('待核对', pending.length + '<small> 笔</small>', `${money(pending.reduce((s, e) => s + e.reservation, 0))} 必要预留`, 'clock', 'admin-stat-accent')}${metric('当前净费用', money(consumption - compensation), '已确认消费减去服务补偿', 'chart')}</div>
    ${pending.length ? `<div class="admin-reconcile-banner"><span class="admin-todo-icon admin-todo-amber">${icon('alert', 20)}</span><div><strong>${pending.length} 笔请求缺少完整结算证据</strong><p>未知用量不按零收费、不自动重放。核对后追加处理记录。</p></div>${btn('只看待核对', 'billing-pending', '', 'secondary small')}</div>` : ''}
    <section class="card admin-table-card"><div class="toolbar admin-toolbar">${searchBox(f.query, '搜索流水、请求 ID 或空间')}<select class="select" data-filter="kind" aria-label="账目类型">${options(ledgerLabels, f.kind, '全部类型')}</select><select class="select" data-filter="status" aria-label="账目状态">${options(billingLabels, f.status)}</select><span class="admin-count">${rows.length} 条记录</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>账目 / 关联请求</th><th>归属空间</th><th>类型</th><th>金额</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>${rows.map(e => `<tr><td><button class="admin-name-link admin-mono" data-action="billing-detail" data-id="${e.id}">${esc(e.id)}</button><span class="admin-cell-sub admin-mono">${esc(e.reference)}</span></td><td>${esc(tenantName(a, e.tenantId))}</td><td>${ledgerLabels[e.kind]}</td><td>${e.amount == null ? `<span class="muted">待核对</span><span class="admin-cell-sub">预留 ${money(e.reservation)}</span>` : e.status === 'released' ? '<span class="muted">未入账</span>' : `<strong class="admin-amount ${e.amount > 0 && e.kind !== 'reservation' ? 'admin-positive' : ''}">${e.kind === 'reservation' ? '' : e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount))}</strong>`}</td><td>${statusBadge(e.status, billingLabels)}</td><td class="admin-time">${e.time}</td><td><div class="admin-row-actions">${e.status === 'pending' ? btn('核对', 'billing-reconcile', e.id, 'secondary small') : btn('详情', 'billing-detail', e.id, 'ghost small')}${e.kind === 'consumption' && e.status === 'settled' && !e.compensated ? btn('补偿', 'billing-compensate', e.id, 'ghost small') : e.compensated ? badge('已补偿', 'neutral') : ''}</div></td></tr>`).join('') || `<tr><td colspan="7">${emptyState('没有匹配的账目', '调整类型、状态或搜索条件。')}</td></tr>`}</tbody></table></div></section>${help('所有金额、单价和支付记录均为设计示例。财务数据以整数最小货币单位记录；真实支付渠道、计价与处理时限将在上线前确认。')}`;
}

function auditPage(a) {
  const f = filters.audit;
  const rows = a.audit.filter(e => (f.kind === 'all' || e.kind === f.kind) && `${e.action} ${e.target} ${e.detail} ${e.actor}`.toLowerCase().includes(f.query.toLowerCase()));
  return `${pageHeader('平台管理 / 操作日志', '关键操作，留下完整记录。', '追溯操作者、影响对象与处理原因。记录仅追加，原始事件保持可查。', btn(icon('download', 16) + ' 导出当前记录', 'audit-export', '', 'secondary'))}
    <section class="card admin-table-card"><div class="toolbar admin-toolbar">${searchBox(f.query, '搜索操作、对象或原因')}<select class="select" data-filter="kind" aria-label="操作类型">${options(auditLabels, f.kind, '全部操作')}</select><span class="admin-count">${rows.length} 条记录</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>时间</th><th>操作</th><th>影响对象</th><th>操作者</th><th>原因 / 变更摘要</th></tr></thead><tbody>${rows.map(e => `<tr><td class="admin-time">${esc(e.time)}</td><td><strong>${esc(e.action)}</strong><span class="admin-cell-sub">${auditLabels[e.kind]}</span></td><td class="admin-mono">${esc(e.target)}</td><td><span class="admin-actor">${icon('shield', 14)}${esc(e.actor)}</span></td><td class="admin-audit-detail">${esc(e.detail)}<span class="admin-cell-sub admin-mono">${esc(e.id)}</span></td></tr>`).join('') || `<tr><td colspan="5">${emptyState('没有匹配的操作记录', '尝试搜索对象标识或切换操作类型。')}</td></tr>`}</tbody></table></div></section>${help('原型中的操作会保存在当前浏览器。生产环境的管理权限、不可篡改日志和服务端审批需独立实现。')}`;
}

export function renderAdmin(route, ctx) {
  const a = ensure(ctx);
  const key = String(route).replace(/^#/, '').split('?')[0].replace(/\/$/, '').split('/')[2] || '';
  const pages = { models: modelsPage, tenants: tenantsPage, runs: runsPage, billing: billingPage, audit: auditPage };
  return `<div data-admin-root class="admin-root">${(pages[key] || overview)(a)}</div>`;
}

function modelDetail(ctx, m) {
  ctx.modal({ title: `${m.name} · v${m.version}`, body: `<div class="admin-modal-top">${statusBadge(m.status, modelLabels)}<span class="muted">${esc(m.category)} · Python / SimPy</span></div><p class="admin-modal-lead">${esc(m.description)}</p>${detailGrid([['模型标识', `<span class="admin-mono">${esc(m.modelId)}</span>`], ['许可证', m.license], ['内容摘要', `<span class="admin-mono">${m.digest}</span>`], ['验证结果', `${m.checks} / ${m.totalChecks} 项 · 示例记录`]])}<div class="admin-detail-section"><h3>假设与边界</h3><p>${esc(m.assumptions)}</p><h3>可调参数</h3><p>${esc(m.parameters)}</p><h3>输出指标</h3><p>${esc(m.metrics)}</p><h3>版本说明</h3><p>${esc(m.changelog)}</p></div>${help('工程检查只能验证发布包能运行，不能替代模型校准与科学有效性判断。当前验证记录为设计示例。')}`, footer: `<button class="btn secondary" data-modal-cancel>关闭</button>${m.status === 'validated' ? '<button class="btn primary" data-next-action="publish">审核并发布</button>' : m.status === 'draft' ? '<button class="btn primary" data-next-action="validate">验证版本</button>' : m.status === 'published' ? '<button class="btn secondary" data-next-action="new">创建后续版本</button>' : ''}`, onOpen(root) { bindCancel(root, ctx); root.querySelector('[data-next-action]')?.addEventListener('click', event => { const action = event.currentTarget.dataset.nextAction; if (action === 'publish') publishModel(ctx, m); else if (action === 'validate') validateModel(ctx, m); else createModel(ctx, m); }); } });
}
function createModel(ctx, base) {
  const a = ensure(ctx);
  const distinct = [...new Map(a.models.map(m => [m.modelId, m])).values()];
  const selected = base || distinct[0];
  const nextVersion = m => { const versions = a.models.filter(x => x.modelId === m.modelId).map(x => x.version.split('.').map(Number)).sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2]); const parts = versions[0]; return `${parts[0]}.${parts[1] + 1}.0`; };
  ctx.modal({ title: '创建官方模型新版本', body: `<p class="admin-modal-lead">从现有模型创建独立草稿。已发布版本和用户项目保持不变。</p><label class="field admin-modal-field"><span>模型</span><select class="select" name="model">${distinct.map(m => `<option value="${m.modelId}" ${m.modelId === selected.modelId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label><label class="field admin-modal-field"><span>新版本号</span><input class="input" name="version" value="${nextVersion(selected)}" placeholder="例如 1.2.0" inputmode="decimal"></label><label class="field admin-modal-field"><span>版本说明</span><textarea class="input admin-textarea" name="changelog" placeholder="说明本版本的改动与验证重点" maxlength="500"></textarea></label><p class="admin-form-error" data-form-error role="alert"></p>${help('此处创建可交互的版本元数据示例。发布包上传、依赖锁定与真实验证由后续后台实现。')}`, footer: modalButtons('创建草稿'), onOpen(root) { bindCancel(root, ctx); root.querySelector('[name="model"]').addEventListener('change', e => { root.querySelector('[name="version"]').value = nextVersion(a.models.find(m => m.modelId === e.target.value)); }); root.querySelector('[data-modal-confirm]').addEventListener('click', () => { const modelId = root.querySelector('[name="model"]').value; const version = root.querySelector('[name="version"]').value.trim(); const changelog = root.querySelector('[name="changelog"]').value.trim(); const error = root.querySelector('[data-form-error]'); if (!/^\d+\.\d+\.\d+$/.test(version)) { error.textContent = '请使用 1.2.0 这样的三段版本号。'; return; } if (a.models.some(m => m.modelId === modelId && m.version === version)) { error.textContent = '该版本已存在，请使用新的版本号。'; return; } if (!changelog) { error.textContent = '请填写版本说明。'; return; } const original = a.models.find(m => m.modelId === modelId); a.models.unshift({ ...original, id: safeId('model'), version, changelog, status: 'draft', copies: 0, checks: 0, digest: '未生成', updated: dateTime() }); log(ctx, 'model', '创建版本草稿', `${modelId} / ${version}`, changelog); finish(ctx, `已创建 v${version} 草稿`); }); } });
}
function validateModel(ctx, m) {
  ctx.modal({ title: '验证模型版本', body: `<p class="admin-modal-lead">${esc(m.name)} <strong>v${esc(m.version)}</strong></p><ul class="admin-checklist"><li>${icon('check', 16)}最小运行与固定种子</li><li>${icon('check', 16)}参数、单位、指标与基本不变量</li><li>${icon('check', 16)}许可证与发布包敏感内容检查</li><li>${icon('check', 16)}依赖与模型入口契约</li></ul>${help('点击后将载入“全部检查通过”的示例结果，不运行代码，也不证明模型科学有效。')}`, footer: modalButtons('载入验证通过示例'), onOpen(root) { bindCancel(root, ctx); root.querySelector('[data-modal-confirm]').addEventListener('click', () => { if (m.status !== 'draft') return; m.status = 'validated'; m.checks = m.totalChecks; m.digest = 'demo-' + m.id.slice(-8); m.updated = dateTime(); log(ctx, 'model', '验证版本', `${m.modelId} / ${m.version}`, `原型示例检查通过 ${m.totalChecks} / ${m.totalChecks}；未实际执行代码。`); finish(ctx, '已载入验证结果，版本等待审核发布'); }); } });
}
function publishModel(ctx, m) {
  ctx.modal({ title: '审核并发布此版本', body: `<p class="admin-modal-lead">${esc(m.name)} <strong>v${esc(m.version)}</strong> 将出现在官方模型目录，供用户创建独立项目。</p>${detailGrid([['工程验证', `${m.checks} / ${m.totalChecks} 项`], ['许可证', m.license], ['内容摘要', m.digest], ['已有项目', '版本与文件保持不变']])}<label class="admin-checkbox"><input type="checkbox" name="reviewed"><span>已确认场景假设、许可和发布证据；示例检查不代表科学校准。</span></label>${reasonField('发布说明', '例如：补充资源指标说明，完成许可与验证审核')}`, footer: modalButtons('确认发布'), onOpen(root) { bindCancel(root, ctx); root.querySelector('[data-modal-confirm]').addEventListener('click', () => { const reason = getReason(root); if (!reason) return; if (!root.querySelector('[name="reviewed"]').checked) { root.querySelector('[data-form-error]').textContent = '请先确认已审阅发布内容与证据。'; return; } if (m.status !== 'validated') return; m.status = 'published'; m.updated = dateTime(); log(ctx, 'model', '发布版本', `${m.modelId} / ${m.version}`, reason); finish(ctx, `v${m.version} 已在本地原型中发布`); }); } });
}
function withdrawModel(ctx, m) {
  ctx.modal({ title: '撤回官方模型版本', body: `<p class="admin-modal-lead">${esc(m.name)} <strong>v${esc(m.version)}</strong> 将停止接受新项目创建。</p>${help(`已有 ${m.copies} 个用户项目继续保留自己的代码与版本。此操作不删除用户内容。`, 'admin-note-warning')}${reasonField('撤回原因', '说明已发现的问题和受影响范围')}`, footer: modalButtons('确认撤回', true), onOpen(root) { bindCancel(root, ctx); root.querySelector('[data-modal-confirm]').addEventListener('click', () => { const reason = getReason(root); if (!reason || m.status !== 'published') return; m.status = 'withdrawn'; m.updated = dateTime(); m.withdrawReason = reason; log(ctx, 'model', '撤回版本', `${m.modelId} / ${m.version}`, reason); finish(ctx, '已撤回此版本，已有用户项目保留'); }); } });
}

function tenantDetail(ctx, t) {
  ctx.modal({ title: t.name, body: `<div class="admin-modal-top">${statusBadge(t.status, { active: '正常', suspended: '已暂停' })}${badge('个人空间', 'neutral')}</div>${detailGrid([['租户标识', `<span class="admin-mono">${t.id}</span>`], ['所有者', esc(t.owner)], ['项目数量', `${t.projects} 个`], ['可用余额', money(t.balance - t.reserved)], ['已入账余额', money(t.balance)], ['有效预留', money(t.reserved)], ['运行额度', `${t.runtime} / ${t.runtimeLimit} 分钟`], ['存储额度', `${t.storage} / ${t.storageLimit} GB`], ['任务并发', t.concurrency], ['每回合预算上限', money(t.turnBudget)]])}${t.reason ? `<div class="admin-detail-section"><h3>最近状态变更原因</h3><p>${esc(t.reason)}</p></div>` : ''}${help('共享账单不隐含共享项目权限。此页面仅展示租户元数据，不读取文件、对话或项目 Preview。')}`, footer: `<button class="btn secondary" data-modal-cancel>关闭</button><button class="btn primary" data-quota>调整额度</button>`, onOpen(root) { bindCancel(root, ctx); root.querySelector('[data-quota]').addEventListener('click', () => quotaModal(ctx, t)); } });
}
function quotaModal(ctx, t) {
  ctx.modal({ title: `调整 ${t.name} 的额度`, body: `<p class="admin-modal-lead">新额度用于限制后续任务，不追溯更改已发生的消费。</p><div class="admin-form-grid"><label class="field"><span>周期运行额度（分钟）</span><input class="input" type="number" min="1" max="100000" step="1" name="runtimeLimit" value="${t.runtimeLimit}"></label><label class="field"><span>存储上限（GB）</span><input class="input" type="number" min="1" max="1000" step="1" name="storageLimit" value="${t.storageLimit}"></label><label class="field"><span>任务并发上限</span><input class="input" type="number" min="1" max="20" step="1" name="concurrency" value="${t.concurrency}"></label><label class="field"><span>每回合预算上限（示例 ¥）</span><input class="input" type="number" min="0.01" max="10000" step="0.01" name="turnBudget" value="${(t.turnBudget / 100).toFixed(2)}"></label></div>${reasonField('调整原因')}${help('额度低于当前使用量时，将限制新增工作。不会删除已存内容，也不会自动停止已授权运行。')}`, footer: modalButtons('保存额度'), onOpen(root) { bindCancel(root, ctx); root.querySelector('[data-modal-confirm]').addEventListener('click', () => { const fields = ['runtimeLimit', 'storageLimit', 'concurrency', 'turnBudget']; const invalid = fields.map(name => root.querySelector(`[name="${name}"]`)).find(el => !el.checkValidity() || !el.value); if (invalid) { root.querySelector('[data-form-error]').textContent = '请填写范围内的有效额度。'; invalid.focus(); return; } const reason = getReason(root); if (!reason) return; const old = `${t.runtimeLimit} 分钟 / ${t.storageLimit} GB / ${t.concurrency} 并发 / ${money(t.turnBudget)}`; fields.forEach(name => { const value = Number(root.querySelector(`[name="${name}"]`).value); t[name] = name === 'turnBudget' ? cents(value) : value; }); log(ctx, 'tenant', '调整服务额度', t.id, `${reason}；${old} → ${t.runtimeLimit} 分钟 / ${t.storageLimit} GB / ${t.concurrency} 并发 / ${money(t.turnBudget)}`); finish(ctx, '租户额度已更新'); }); } });
}
function toggleTenant(ctx, t) {
  const pausing = t.status === 'active';
  ctx.modal({ title: `${pausing ? '暂停' : '恢复'}租户新增工作`, body: `<p class="admin-modal-lead">${esc(t.name)} · <span class="admin-mono">${t.id}</span></p>${help(pausing ? '暂停后不再接受新增 Agent 回合和计算任务。已授权任务遵守原有上限；用户仍可查看和导出已保存内容。' : '恢复后，租户可在现有余额与资源额度范围内创建任务。', pausing ? 'admin-note-warning' : '')}${reasonField(pausing ? '暂停原因' : '恢复原因')}`, footer: modalButtons(pausing ? '确认暂停新增工作' : '确认恢复', pausing), onOpen(root) { bindCancel(root, ctx); root.querySelector('[data-modal-confirm]').addEventListener('click', () => { const reason = getReason(root); if (!reason) return; t.status = pausing ? 'suspended' : 'active'; t.reason = reason; log(ctx, 'tenant', pausing ? '暂停新增工作' : '恢复新增工作', t.id, reason); finish(ctx, pausing ? '已暂停该租户的新增工作' : '已恢复该租户的新增工作'); }); } });
}

function runDetail(ctx, r) {
  const a = ensure(ctx);
  ctx.modal({ title: '任务运行详情', body: `<div class="admin-modal-top">${statusBadge(r.status, runLabels)}<span class="admin-mono">${r.id}</span></div>${detailGrid([['归属空间', esc(tenantName(a, r.tenantId))], ['任务类型', kindLabels[r.kind]], ['项目标识', `<span class="admin-mono">${r.project}</span>`], ['输入版本', r.revision], ['运行规格', `${r.cpu} / ${r.memory}`], ['Runtime 代次', r.generation], ['已运行', r.elapsed], ['已完成', r.kind === 'experiment' ? `${r.complete} / ${r.samples} 个样本` : r.kind === 'turn' ? `${r.complete} 次工具操作` : '交互服务']])}<div class="admin-detail-section"><h3>运行事件</h3><div class="admin-event"><i></i><span>任务已登记，归属与额度检查完成</span></div><div class="admin-event"><i></i><span>从 ${r.revision} 创建独立工作副本</span></div><div class="admin-event"><i class="${r.status === 'failed' ? 'admin-event-error' : ''}"></i><span>${r.error ? esc(r.error) : r.status === 'stopped' ? `任务已停止。${r.stopReason ? '原因：' + esc(r.stopReason) : ''}` : r.status === 'queued' ? '等待可用并发额度' : r.status === 'completed' ? '所有子任务完成，结果已保存' : '收到执行进度，等待后续事件'}</span></div></div>${help('此处仅展示运行元数据和脱敏状态事件。管理端不查看模型文件、原始对话或用户实验结果。')}`, footer: `<button class="btn secondary" data-modal-cancel>关闭</button>${['running', 'queued'].includes(r.status) ? `<button class="btn danger" data-stop>${r.status === 'queued' ? '取消排队' : '停止任务'}</button>` : ''}`, onOpen(root) { bindCancel(root, ctx); root.querySelector('[data-stop]')?.addEventListener('click', () => stopRun(ctx, r)); } });
}
function stopRun(ctx, r) {
  ctx.modal({ title: r.status === 'queued' ? '取消排队任务' : '停止此任务', body: `<p class="admin-modal-lead"><span class="admin-mono">${r.id}</span> · ${kindLabels[r.kind]}</p>${help(r.kind === 'experiment' ? `将停止剩余样本，保留已完成的 ${r.complete} / ${r.samples} 个样本及其输入版本。` : r.kind === 'turn' ? '终止当前回合并保留已确认修改。已实际发生的用量仍需结算，未知用量进入待核对。' : '停止当前 Preview 服务，已保存模型文件和独立实验任务不受影响。', 'admin-note-warning')}${reasonField('停止原因', '说明停止原因，便于用户与运营追溯')}`, footer: modalButtons('确认停止', true), onOpen(root) { bindCancel(root, ctx); root.querySelector('[data-modal-confirm]').addEventListener('click', () => { const reason = getReason(root); if (!reason || !['running', 'queued'].includes(r.status)) return; r.status = 'stopped'; r.stopReason = reason; log(ctx, 'run', '停止任务', r.id, `${reason}；保留 ${r.complete} 个已完成步骤或样本。`); finish(ctx, '示例任务已停止，已保存内容保留'); }); } });
}

function billingDetail(ctx, e) {
  const a = ensure(ctx);
  const adjustments = a.ledger.filter(x => x.originalId === e.id);
  ctx.modal({ title: '账目明细', body: `<div class="admin-modal-top">${statusBadge(e.status, billingLabels)}<span>${ledgerLabels[e.kind]}</span></div><div class="admin-ledger-hero"><span>${e.amount == null ? '实际用量待核对' : `${e.amount < 0 ? '−' : e.amount > 0 ? '+' : ''}${money(Math.abs(e.amount))}`}</span><small>${esc(e.id)}</small></div>${detailGrid([['归属空间', esc(tenantName(a, e.tenantId))], ['关联请求', `<span class="admin-mono">${esc(e.reference)}</span>`], ['关联回合', esc(e.turn || '—')], ['项目标识', esc(e.project || '—')], ['发生时间', e.time], ['价目表版本', esc(e.priceVersion || '—')], ['Token 用量', e.tokens == null ? '未知 / 不适用' : number(e.tokens)], ['必要预留', money(e.reservation || 0)]])}${e.inputTokens != null ? `<div class="admin-detail-section"><h3>模型调用用量</h3><div class="admin-token-line"><span>输入 Token</span><strong>${number(e.inputTokens)}</strong></div><div class="admin-token-line"><span>输出 Token</span><strong>${number(e.outputTokens)}</strong></div><p class="muted">供应商、单价与 Token 分类为示例。生产账单按调用发生时的不可变价目表结算。</p></div>` : ''}${e.reason ? `<div class="admin-detail-section"><h3>处理说明</h3><p>${esc(e.reason)}</p></div>` : ''}${adjustments.length ? `<div class="admin-detail-section"><h3>关联调整</h3>${adjustments.map(x => `<div class="admin-token-line"><span>${esc(x.id)} · 服务补偿</span><strong>+${money(x.amount)}</strong></div>`).join('')}</div>` : ''}${help('消费、补偿与充值分别记录。原始流水不删除，支付成功跳转也不能作为入账依据。')}`, footer: `<button class="btn secondary" data-modal-cancel>关闭</button>${e.status === 'pending' ? '<button class="btn primary" data-next="reconcile">核对用量</button>' : e.kind === 'consumption' && e.status === 'settled' && !e.compensated ? '<button class="btn secondary" data-next="compensate">创建补偿</button>' : ''}`, onOpen(root) { bindCancel(root, ctx); root.querySelector('[data-next]')?.addEventListener('click', event => { if (event.currentTarget.dataset.next === 'reconcile') reconcile(ctx, e); else compensate(ctx, e); }); } });
}
function compensate(ctx, e) {
  ctx.modal({ title: '创建服务补偿', body: `<p class="admin-modal-lead">为 <strong>${esc(tenantName(ensure(ctx), e.tenantId))}</strong> 关联消费 <span class="admin-mono">${e.id}</span> 创建追加调整。</p>${detailGrid([['原消费', money(Math.abs(e.amount))], ['关联请求', esc(e.reference)]])}<label class="field admin-modal-field"><span>补偿金额（示例 ¥）</span><input class="input" name="amount" type="number" min="0.01" max="${Math.abs(e.amount) / 100}" step="0.01" value="${(Math.abs(e.amount) / 100).toFixed(2)}"></label>${reasonField('补偿原因', '例如：平台错误导致重复调用，经核对退回重复费用')}${help('补偿回到租户服务余额，追加独立账目并关联原消费；不等同于支付渠道原路退款。')}`, footer: modalButtons('确认追加补偿'), onOpen(root) { bindCancel(root, ctx); root.querySelector('[data-modal-confirm]').addEventListener('click', () => { const amountField = root.querySelector('[name="amount"]'); if (!amountField.checkValidity() || !amountField.value) { root.querySelector('[data-form-error]').textContent = '补偿金额必须大于 0 且不超过原消费。'; amountField.focus(); return; } const reason = getReason(root); if (!reason || e.compensated) return; const a = ensure(ctx); const amount = cents(amountField.value); const adjustment = { id: safeId('adj'), tenantId: e.tenantId, kind: 'compensation', status: 'settled', amount, reservation: 0, reference: e.reference, originalId: e.id, turn: e.turn, project: e.project, time: dateTime(), tokens: null, reason }; a.ledger.unshift(adjustment); e.compensated = true; a.tenants.find(t => t.id === e.tenantId).balance += amount; log(ctx, 'billing', '追加服务补偿', adjustment.id, `${reason}；原消费 ${e.id}，补偿 ${money(amount)}。`); finish(ctx, '已追加本地补偿记录，原消费保留'); }); } });
}
function reconcile(ctx, e) {
  ctx.modal({ title: '核对未知用量', body: `<p class="admin-modal-lead"><span class="admin-mono">${e.reference}</span> · ${esc(tenantName(ensure(ctx), e.tenantId))}</p>${help(`${esc(e.reason)} 当前保留 ${money(e.reservation)}，没有按未知用量扣款。`, 'admin-note-warning')}<label class="field admin-modal-field"><span>核对结论</span><select class="select" name="outcome"><option value="release">证据确认未执行，释放预留</option><option value="settle">获得实际用量，结算并释放剩余预留</option><option value="platform">平台承担未知成本，释放用户预留</option></select></label><div class="admin-form-grid" data-usage-fields hidden><label class="field"><span>已确认费用（示例 ¥）</span><input class="input" name="amount" type="number" min="0" max="${e.reservation / 100}" step="0.01" placeholder="0.00"></label><label class="field"><span>已确认总 Token</span><input class="input" name="tokens" type="number" min="1" step="1" max="10000000" placeholder="例如 12500"></label></div><label class="field admin-modal-field"><span>证据编号 <span class="admin-required">*</span></span><input class="input" name="evidence" placeholder="供应商记录或内部调查编号" maxlength="100"></label>${reasonField('处理原因', '说明核对依据；原型可填写示例证据')}`, footer: modalButtons('确认处理'), onOpen(root) { bindCancel(root, ctx); root.querySelector('[name="outcome"]').addEventListener('change', event => { root.querySelector('[data-usage-fields]').hidden = event.target.value !== 'settle'; }); root.querySelector('[data-modal-confirm]').addEventListener('click', () => { const outcome = root.querySelector('[name="outcome"]').value; const evidence = root.querySelector('[name="evidence"]').value.trim(); const error = root.querySelector('[data-form-error]'); if (!evidence) { error.textContent = '请填写证据编号，不能凭估计处理未知用量。'; return; } let amount = 0; let tokens = null; if (outcome === 'settle') { const amountField = root.querySelector('[name="amount"]'); const tokenField = root.querySelector('[name="tokens"]'); if (!amountField.value || !tokenField.value || !amountField.checkValidity() || !tokenField.checkValidity()) { error.textContent = '请填写已确认用量与预留范围内的实际费用。'; return; } amount = cents(amountField.value); tokens = Number(tokenField.value); } const reason = getReason(root); if (!reason || e.status !== 'pending') return; const a = ensure(ctx); const t = a.tenants.find(x => x.id === e.tenantId); t.reserved = Math.max(0, t.reserved - e.reservation); t.balance -= amount; e.resolution = outcome; e.evidence = evidence; e.reason = `${reason}；证据：${evidence}。`;
        // The pending usage record is updated; monetary effects are appended as a separate ledger record.
        e.status = 'released'; e.amount = 0; const originalReservation = e.reservation; e.reservation = 0;
        if (outcome === 'settle') a.ledger.unshift({ id: safeId('led'), tenantId: e.tenantId, kind: 'consumption', status: 'settled', amount: -amount, reservation: 0, reference: e.reference, originalPendingId: e.id, turn: e.turn, project: e.project, time: dateTime(), tokens, priceVersion: 'demo-2026-09', reason: e.reason });
        log(ctx, 'billing', outcome === 'settle' ? '核对并结算' : '核对并释放预留', e.id, `${e.reason} 原预留 ${money(originalReservation)}，实际结算 ${money(amount)}${outcome === 'platform' ? '；未知成本由平台承担' : ''}。`); finish(ctx, outcome === 'settle' ? '已追加结算记录并释放剩余预留' : '已释放预留并保留核对记录'); }); } });
}

function showPrices(ctx) {
  ctx.modal({ title: '示例价目表版本', body: `<div class="admin-modal-top">${badge('不可变版本', 'info')}<span class="admin-mono">demo-2026-09</span></div><p class="admin-modal-lead">本版本仅说明计费结构，金额为设计示例，不是已上线报价。</p>${detailGrid([['结算币种', '人民币（示例）'], ['计量单位', '每百万 Token'], ['生效时间', '2026-09-01 00:00（示例）'], ['适用模型', '主供应商模型（示例）']])}<div class="admin-token-line"><span>普通输入</span><strong>¥40.00 / 百万 Token</strong></div><div class="admin-token-line"><span>缓存输入（与普通输入互斥）</span><strong>¥4.00 / 百万 Token</strong></div><div class="admin-token-line"><span>输出</span><strong>¥200.00 / 百万 Token</strong></div><div class="admin-detail-section"><h3>计算示例</h3><p>12,500 输入 + 1,750 输出：0.50 + 0.35 = ¥0.85。</p><h3>版本与舍入</h3><p>按请求固定价目版本；以整数精度累计后四舍五入至分。不同模型与计费类别分别计量，推理等子集不得重复相加。</p><h3>调整价格</h3><p>未来调价应另建版本并指定生效时间；已执行调用保留原价。本原型提供只读版本查看。</p></div>${help('普通输入与缓存输入分别计量，不重复计费。其他分类仅在供应商语义可验证且正式价目表已定义时开放。未知用量进入待核对，不按零用量推断。')}`, footer: '<button class="btn secondary" data-modal-cancel>关闭</button>', onOpen(root) { bindCancel(root, ctx); } });
}

function exportCsv(ctx, kind) {
  const a = ensure(ctx);
  let rows;
  if (kind === 'audit') {
    const f = filters.audit;
    rows = [['事件标识', '时间', '操作', '对象', '操作者', '原因'], ...a.audit.filter(e => (f.kind === 'all' || e.kind === f.kind) && `${e.action} ${e.target} ${e.detail} ${e.actor}`.toLowerCase().includes(f.query.toLowerCase())).map(e => [e.id, e.time, e.action, e.target, e.actor, e.detail])];
  } else {
    const f = filters.billing;
    rows = [['流水标识', '时间', '租户', '类型', '状态', '金额分', '请求标识', '说明'], ...a.ledger.filter(e => (f.status === 'all' || e.status === f.status) && (f.kind === 'all' || e.kind === f.kind) && `${e.id} ${e.reference} ${e.turn || ''} ${tenantName(a, e.tenantId)}`.toLowerCase().includes(f.query.toLowerCase())).map(e => [e.id, e.time, e.tenantId, ledgerLabels[e.kind], billingLabels[e.status], e.amount ?? '', e.reference, e.reason || ''])];
  }
  const csv = '\uFEFF' + rows.map(row => row.map(value => { const s = String(value); const safe = /^[=+\-@]/.test(s) ? "'" + s : s; return '"' + safe.replace(/"/g, '""') + '"'; }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = `riffology-${kind}-design-demo.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); ctx.toast('已导出当前筛选下的示例记录');
}

export function bindAdmin(route, ctx) {
  const root = document.querySelector('[data-admin-root]');
  if (!root) return;
  const a = ensure(ctx);
  const key = String(route).replace(/^#/, '').split('?')[0].replace(/\/$/, '').split('/')[2] || '';
  root.querySelectorAll('[data-filter]').forEach(field => {
    field.addEventListener(field.tagName === 'INPUT' ? 'input' : 'change', () => {
      const name = field.dataset.filter;
      const position = field.selectionStart;
      filters[key][name] = field.value;
      ctx.render();
      if (field.tagName === 'INPUT') { const next = document.querySelector(`[data-admin-root] [data-filter="${name}"]`); next?.focus(); if (typeof position === 'number') next?.setSelectionRange(position, position); }
    });
  });
  root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    const { action, id } = button.dataset;
    const m = a.models.find(x => x.id === id);
    const t = a.tenants.find(x => x.id === id);
    const r = a.runs.find(x => x.id === id);
    const e = a.ledger.find(x => x.id === id);
    if (action === 'model-create') createModel(ctx);
    else if (action === 'model-detail' && m) modelDetail(ctx, m);
    else if (action === 'model-publish' && m) publishModel(ctx, m);
    else if (action === 'model-withdraw' && m) withdrawModel(ctx, m);
    else if (action === 'model-validate' && m) validateModel(ctx, m);
    else if (action === 'tenant-detail' && t) tenantDetail(ctx, t);
    else if (action === 'tenant-quota' && t) quotaModal(ctx, t);
    else if (action === 'tenant-toggle' && t) toggleTenant(ctx, t);
    else if (action === 'run-detail' && r) runDetail(ctx, r);
    else if (action === 'run-stop' && r) stopRun(ctx, r);
    else if (action === 'billing-detail' && e) billingDetail(ctx, e);
    else if (action === 'billing-reconcile' && e) reconcile(ctx, e);
    else if (action === 'billing-compensate' && e) compensate(ctx, e);
    else if (action === 'billing-prices') showPrices(ctx);
    else if (action === 'billing-export') exportCsv(ctx, 'billing');
    else if (action === 'audit-export') exportCsv(ctx, 'audit');
    else if (action === 'billing-pending') { filters.billing.status = 'pending'; filters.billing.kind = 'all'; filters.billing.query = ''; ctx.render(); }
    else if (action === 'run-filter') { filters.runs.status = filters.runs.status === id ? 'all' : id; ctx.render(); }
    else if (action === 'go-pending') { filters.billing.status = 'pending'; ctx.navigate('/admin/billing'); }
    else if (action === 'go-models') { filters.models.status = 'validated'; ctx.navigate('/admin/models'); }
    else if (action === 'go-tenants') { filters.tenants.status = 'active'; ctx.navigate('/admin/tenants'); }
    else if (action === 'go-runs') ctx.navigate('/admin/runs');
  }));
}
