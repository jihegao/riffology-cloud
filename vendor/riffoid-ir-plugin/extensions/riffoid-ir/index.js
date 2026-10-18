import { Type } from 'typebox';
import { realpathSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Pi's jiti loader may keep the global extension symlink as import.meta.url.
// Resolve it once so sibling package modules work for symlink and npm installs.
const root = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), '../..');
const brokerPath = resolve(root, 'src/broker.mjs');
const broker = await import(`${pathToFileURL(brokerPath).href}?revision=${statSync(brokerPath).mtimeMs}`);
// A long-lived Pi daemon can retain the previous module even across /reload.
// Reuse that bridge until its process exits; new processes use reference-counted cleanup.
const acquireProject = typeof broker.acquireProject === 'function' ? broker.acquireProject : async workspace => ({
  ...await broker.connectProject(workspace), release: async () => {},
});
const { descriptions } = await import(pathToFileURL(resolve(root, 'src/tools.mjs')).href);
const { domainAgentContext, domainDevelopment } = await import(pathToFileURL(resolve(root, 'src/domain-pack.mjs')).href);
const { liveProject } = await import(pathToFileURL(resolve(root, 'src/live-connection.mjs')).href);

export default function riffoidIr(pi) {
  const connections = new Map();
  async function project(workspace) {
    if (!connections.has(workspace)) connections.set(workspace, acquireProject(workspace).then(acquired => liveProject(workspace, acquired)));
    try { return await connections.get(workspace); } catch (error) { connections.delete(workspace); throw error; }
  }
  pi.on('session_shutdown', async () => {
    await Promise.all([...connections.values()].map(async value => (await value).release())); connections.clear();
  });
  const schemas = {
    project_ir_check: Type.Object({ draftRef: Type.String() }, { additionalProperties: false }),
    project_ir_compile: Type.Object({ sealedRef: Type.String() }, { additionalProperties: false }),
    project_ir_run: Type.Object({ browserArtifactRef: Type.Optional(Type.String()), sourceRunId: Type.Optional(Type.String()),
      runOptions: Type.Optional(Type.Object({ seed: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false })) }, { additionalProperties: false }),
    project_ir_result: Type.Object({ runId: Type.String() }, { additionalProperties: false }),
  };
  for (const [name, parameters] of Object.entries(schemas)) {
    pi.registerTool({ name, label: name.replace('project_ir_', 'IR '), description: descriptions[name], parameters,
      promptGuidelines: ['Use the riffoid-ir skill for IR modeling and domain-pack development. Respect generate-only requests. Business edits require reseal and recompile. Browser results remain local/unverified.',
        domainAgentContext()],
      async execute(_id, input, signal, _update, context) {
        const bridge = await project(context.cwd);
        const result = await bridge.call(name, input, signal);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result,
          isError: result.status === 'failed' || result.accepted === false };
      },
    });
  }
  pi.registerCommand('sim', { description: 'IR simulation project default: ir, code, show',
    handler: async (args, context) => {
      const action = args.trim() || 'show';
      if (!['ir', 'code', 'show'].includes(action)) { context.ui.notify('Usage: /sim ir | /sim code | /sim show', 'error'); return; }
      const bridge = await project(context.cwd);
      if (action !== 'show') await bridge.call('mode', { mode: action });
      const state = await bridge.call('show');
      const text = `后续建模默认：${state.defaultMode}\n当前模型：${state.currentModel?.type || '尚未创建'} ${state.currentModel?.ref || ''}\n领域：${state.domains?.join(', ')}\n执行位置：${state.execution}\n编译器：${state.compiler?.ready ? 'ready (0.1.0)' : '未就绪'}\n浏览器：${state.browserConnected ? 'connected' : '打开 IR Model 面板连接'}\n领域开发：可用；当前执行范围不限制扩展开发\n开发指南：${domainDevelopment().guide}`;
      pi.sendMessage({ customType: 'riffoid-ir-status', content: text, display: true }, { triggerTurn: false });
    },
  });
  pi.on('before_agent_start', async (_event, context) => {
    const bridge = await project(context.cwd);
    const state = await bridge.call('show');
    return { message: { customType: 'riffoid-ir-context', content: `IR project default=${state.defaultMode}; current model=${state.currentModel?.type || 'none'}. Explicit user instructions take priority. For IR use model/business-ir.draft.json and the riffoid-ir skill; for ordinary code keep the code workflow. Never run a generate-only request. ${domainAgentContext()}`, display: false } };
  });
}
