import { readFile } from 'node:fs/promises';
import { IrProject, IrError } from '../../src/project.mjs';
import { toolSchemas, descriptions } from '../../src/tools.mjs';
import { domainAgentContext } from '../../src/domain-pack.mjs';

export const definitions = Object.entries(toolSchemas).map(([name, parameters]) => ({ name, label: name, description: descriptions[name], parameters }));
const pageOperations = new Set(['show', 'mode', 'draft', 'save-draft', 'example', 'records', 'heartbeat', 'submit', 'detach', ...Object.keys(toolSchemas)]);

/** Install inside Project Tools. The caller resolves scope using current host
 * authority, never a path or tenant ID supplied by the browser. Keep one shared
 * instance per materialized project workspace for its page and tools.
 */
export async function createRiffoidAdapter({ workspace, authorize, compiler, now }) {
  if (typeof authorize !== 'function') throw new Error('Riffoid host authorization callback required');
  const project = new IrProject(workspace, { host: 'riffoid', compiler, now });
  const content = await readFile(new URL('../../skills/riffoid-ir/SKILL.md', import.meta.url), 'utf8');
  const workerSource = await readFile(new URL('../../browser/worker.js', import.meta.url), 'utf8');
  return {
    definitions, fixedSkills: [{ name: 'riffoid-ir', content: `${content}\n\n${domainAgentContext()}\n` }], project,
    async executeTool({ name, args, signal, scope }) {
      if (!Object.hasOwn(toolSchemas, name)) throw new IrError('unknown_tool', 'bridge', name);
      await authorize({ scope, operation: name, input: args, signal, source: 'agent' });
      const result = await project.operation(name, args, signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result, isError: result.status === 'failed' || result.accepted === false };
    },
    // Add one `ir.request` action to the current host's MessagePort protocol.
    // The host must persist the workspace/Artifact version before acknowledging
    // submit; this hook is part of the host's existing admission/save transaction.
    async browserRequest({ scope, operation, input = {}, signal }) {
      if (!pageOperations.has(operation)) throw new IrError('unknown_operation', 'page', operation);
      await authorize({ scope, operation, input, signal, source: 'user-browser' });
      const result = await project.operation(operation, input, signal);
      if (operation === 'heartbeat' && result.run) {
        await project.assertBlob(result.run.runtimeRef, 'runtimes', 'runtime.js');
        result.runtimeSource = await readFile(await project.path(result.run.runtimeRef), 'utf8');
        result.workerSource = workerSource;
      }
      return result;
    },
    async installView() {
      const files = ['app.html', 'app.js', 'app.css'];
      for (const file of files) {
        let source = await readFile(new URL(`../../browser/${file}`, import.meta.url), 'utf8');
        if (file === 'app.html') source = source.replace('src="http://127.0.0.1:8514/v1/bridge.js"', 'type="application/json"')
          .replaceAll('/assets/', './');
        await project.write(`app/ir/${file}`, source);
      }
      const ref = 'app/views.json';
      const manifest = await project.read(ref).catch(() => ({ schema: 'project.views/v1', files: [], views: [] }));
      if (manifest.schema !== 'project.views/v1') throw new IrError('unsupported_views', 'install', 'project.views/v1 required', ref);
      manifest.files = [...new Set([...manifest.files, ...files.map(file => `app/ir/${file}`)])];
      manifest.views = [...manifest.views.filter(view => view.id !== 'riffoid-ir'), { id: 'riffoid-ir', title: 'IR Model', entrypoint: 'app/ir/app.html' }];
      await project.write(ref, manifest); return { viewRef: ref, entrypoint: 'app/ir/app.html' };
    },
  };
}

/** Extend the frozen frame API where the existing bootstrap creates window.riffoid. */
export function irFrameApi(request) {
  return { irRequest: (operation, input = {}) => request('ir.request', { operation, input }) };
}
