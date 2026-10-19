class RiffoidIrPanel extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); this._generation = 0; }
  set panelContext(value) {
    const changed = this._context?.workspace?.id !== value?.workspace?.id;
    this._context = value;
    if (changed && this.isConnected) void this.connect();
  }
  connectedCallback() { void this.connect(); }
  disconnectedCallback() { this._generation++; clearInterval(this._timer); this._timer = undefined; }
  async connect() {
    const generation = ++this._generation;
    clearInterval(this._timer);
    this.shadowRoot.innerHTML = '<style>:host{display:block;height:100%;font:13px system-ui;color:var(--text-color,#dce4ef)}iframe{width:100%;height:100%;border:0}p{padding:18px}button{margin:0 18px;padding:8px;cursor:pointer}</style><p>正在连接建模工作区…</p>';
    if (!this._context) return;
    const refresh = async () => {
      try {
        const file = await this._context.files.readFile('.riffoid-ir/connection.json');
        const connection = JSON.parse(file.content);
        const origin = new URL(connection.origin);
        if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || !/^[a-f0-9]{64}$/.test(connection.token)) throw new Error('Invalid local IR connection');
        if (!this.isConnected || generation !== this._generation) return;
        const src = `${origin.origin}/#token=${connection.token}`;
        let frame = this.shadowRoot.querySelector('iframe');
        if (!frame) { this.shadowRoot.querySelector('p')?.remove(); this.shadowRoot.querySelector('button')?.remove(); frame = document.createElement('iframe'); frame.title = 'IR Model'; this.shadowRoot.append(frame); }
        if (frame.src !== src) frame.src = src;
      } catch {
        if (generation !== this._generation || this.shadowRoot.querySelector('iframe')) return;
        this.shadowRoot.querySelector('p').textContent = '先在本会话执行 /sim show 启动本地桥接，再打开此面板。';
      }
    };
    await refresh();
    if (this.isConnected && generation === this._generation) this._timer = setInterval(refresh, 2500);
  }
}
if (!customElements.get('riffoid-ir-panel')) customElements.define('riffoid-ir-panel', RiffoidIrPanel);

export default {
  apiVersion: 4, name: 'Riffoid IR',
  activate: ({ runtimePluginId, html, svg }) => ({ contributions: {
    actions: [{ id: 'workspace.open-ir', title: 'Open IR Model', group: 'Riffoid IR',
      enabled: ({ state }) => Boolean(state.selectedWorkspace), run: ({ selectWorkspaceTool }) => selectWorkspaceTool(`${runtimePluginId}:workspace.ir`) }],
    workspacePanels: [{ id: 'workspace.ir', title: 'IR Model', order: 31,
      icon: svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 2 10 6-10 6L2 8zM2 12l10 6 10-6M2 16l10 6 10-6"/></svg>`,
      visible: ({ machine }) => machine.kind === 'local', render: context => html`<riffoid-ir-panel .panelContext=${context}></riffoid-ir-panel>` }],
  } }),
};
