import {icon,esc,badge} from './shared.js';

const PANELS={
  browser:{label:'Browser',icon:'globe',title:'Browser 尚未接通',detail:'平台尚未提供当前项目的 Preview URL 或观察状态。'},
  files:{label:'Files',icon:'file',title:'Files 尚未接通',detail:'平台尚未提供当前项目的文件清单与只读内容。'},
  diff:{label:'Diff',icon:'code',title:'Diff 尚未接通',detail:'平台尚未提供当前 Turn 的已保存文件差异。'},
  runs:{label:'Runs',icon:'play',title:'Runs 尚未接通',detail:'平台尚未提供 Preview、单次仿真或实验运行记录。'},
};

function get(ctx){
  ctx.state.workspaces??={};
  const id=ctx.state.activeProject||'unselected';
  const saved=ctx.state.workspaces[id]??{};
  saved.runtimeConnected=false;
  saved.panel=Object.hasOwn(PANELS,saved.panel)?saved.panel:'files';
  saved.panelOpen=saved.panelOpen!==false;
  saved.mobileTab=saved.mobileTab==='workspace'?'workspace':'session';
  ctx.state.workspaces[id]=saved;
  return saved;
}

function unavailablePanel(panel){
  const item=PANELS[panel];
  return `<div class="empty-state workspace-unavailable">${icon(item.icon,32)}<h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p><span class="workspace-unavailable-note">平台功能尚未接通</span></div>`;
}

function responsibility(project){
  return `<div class="empty-state workspace-unavailable responsibility-empty">
    <span class="chat-avatar agent">${icon('sparkles',22)}</span>
    <h3>平台产品功能 / 项目内 Pi Agent</h3>
    <p><strong>平台产品功能</strong>负责身份、租户隔离、Session、Turn、预算、文件版本、运行调度与恢复。</p>
    <p><strong>项目内 Pi Agent</strong>在连接后通过受控工具读取和修改「${esc(project?.name||'当前项目')}」的文件，并请求 Preview 或仿真运行。</p>
    <p>平台功能尚未接通；当前没有真实对话、文件、Diff、Runs 或 Browser 观察结果。</p>
  </div>`;
}

export function renderWorkspace(ctx){
  const w=get(ctx),project=ctx.state.projects.find(item=>item.id===ctx.state.activeProject);
  return `<div class="ws-toolbar">
    <div class="ws-title"><h2>${esc(project?.name||'工作台')}</h2>${badge('运行时未接通','warning')}</div>
    <div class="ws-toolbar-actions"><span class="badge warning">Workspace 已创建 · 运行时未接通</span><button class="icon-btn" aria-label="Session 尚未接通" disabled>${icon('message',16)}</button><button class="btn secondary small" data-action="toggle-panel">${icon('panel',14)}${w.panelOpen?'收起面板':'工作区面板'}</button></div>
  </div>
  <div class="status-banner">${icon('alert',15)}<span><strong>平台功能尚未接通</strong> · 页面只展示能力边界和真实空态，不生成模型、版本、运行或用量数据。</span></div>
  <div class="ws-mobile-tabs"><button data-mobile-tab="session" class="${w.mobileTab==='session'?'active':''}">Session</button><button data-mobile-tab="workspace" class="${w.mobileTab==='workspace'?'active':''}">Workspace</button></div>
  <div class="ws-body ${!w.panelOpen?'panel-hidden':''} ${w.mobileTab==='workspace'?'ws-mobile-workspace':''}">
    <section class="conversation" aria-label="Agent 对话"><div class="conversation-scroll">${responsibility(project)}</div>
      <div class="composer-wrap"><form class="composer" id="message-form"><textarea id="message-input" aria-label="发送给 Agent 的消息" placeholder="Pi Agent 运行时接通后可发送消息" rows="2" maxlength="2000" disabled></textarea><div class="composer-tools"><button type="button" class="icon-btn" data-action="attach" aria-label="附加文件" disabled>${icon('attach',15)}</button><span class="badge">${icon('sparkles',9)}Pi Agent</span><button type="button" class="budget-button" data-action="budget" disabled>预算尚未接通</button><button type="submit" class="send-button" aria-label="发送消息" disabled>${icon('arrowUp',15)}</button></div></form><div class="composer-caption"><span>等待真实 Workspace API</span><span>不会发起模型调用或项目操作</span></div></div>
    </section>
    ${w.panelOpen?`<aside class="workspace-panel" aria-label="Workspace 面板"><div class="panel-tabs" role="tablist" aria-label="工作区工具">${Object.entries(PANELS).map(([key,item])=>`<button role="tab" id="workspace-tab-${key}" aria-controls="workspace-panel-content" tabindex="${w.panel===key?0:-1}" aria-selected="${w.panel===key}" data-panel="${key}" class="panel-tab ${w.panel===key?'active':''}">${icon(item.icon,12)}${item.label}</button>`).join('')}<button class="icon-btn" data-action="toggle-panel" aria-label="关闭 Workspace 面板">${icon('close',13)}</button></div><div class="panel-content" id="workspace-panel-content" role="tabpanel" aria-labelledby="workspace-tab-${w.panel}">${unavailablePanel(w.panel)}</div></aside>`:''}
  </div>
  <div class="ws-bottom-bar"><span>${icon('shield',9)} 私有项目 · 尚无已保存 Revision</span><span class="ws-scenario">平台功能尚未接通</span></div>`;
}

export function bindWorkspace(ctx){
  const w=get(ctx),render=()=>{ctx.save();ctx.render();};
  document.querySelectorAll('[data-action="attach"],[data-action="budget"],#message-input,.send-button').forEach(node=>{node.disabled=true;});
  document.querySelector('#message-form')?.addEventListener('submit',event=>event.preventDefault(),{capture:true});
  document.querySelectorAll('[data-action="toggle-panel"]').forEach(button=>button.onclick=()=>{w.panelOpen=!w.panelOpen;if(!w.panelOpen)w.mobileTab='session';render();});
  document.querySelectorAll('[data-panel]').forEach(button=>{
    button.onclick=()=>{w.panel=button.dataset.panel;render();};
    button.onkeydown=event=>{const keys=Object.keys(PANELS),current=keys.indexOf(w.panel);let next=current;if(event.key==='ArrowRight')next=(current+1)%keys.length;else if(event.key==='ArrowLeft')next=(current+keys.length-1)%keys.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=keys.length-1;else return;event.preventDefault();w.panel=keys[next];render();document.getElementById('workspace-tab-'+w.panel)?.focus();};
  });
  document.querySelectorAll('[data-mobile-tab]').forEach(button=>button.onclick=()=>{w.mobileTab=button.dataset.mobileTab;if(w.mobileTab==='workspace')w.panelOpen=true;render();});
}
