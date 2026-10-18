import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRiffoidAdapter } from '../adapters/riffoid/index.mjs';
import { digest } from '../src/project.mjs';

const MAX_RESULT_BYTES = 1_000_000;
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = message => { throw new Error(message); };
const operations = new Set(['project_ir_check', 'project_ir_compile', 'mode', 'show', 'install']);

/** One bounded Project Tools invocation. Browser run admission and result
 * persistence belong to the host Workspace authority, never this temporary fs. */
export async function runRiffoidOperation({ workspace, operation, input, signal, compiler }) {
  if (!operations.has(operation) || !plain(input)) fail('invalid-riffoid-ir-operation');
  if (operation === 'project_ir_check' && (!exact(input, ['draftRef']) || typeof input.draftRef !== 'string')
    || operation === 'project_ir_compile' && (!exact(input, ['sealedRef']) || typeof input.sealedRef !== 'string')
    || operation === 'mode' && (!exact(input, ['mode']) || !['ir', 'code'].includes(input.mode))
    || ['show', 'install'].includes(operation) && !exact(input, [])) fail('invalid-riffoid-ir-input');
  const adapter = await createRiffoidAdapter({ workspace, authorize: async () => { signal?.throwIfAborted(); }, compiler });
  if (['project_ir_check', 'project_ir_compile', 'install'].includes(operation)) await adapter.installView();
  const result = operation === 'install' ? { installed: true, viewRef: 'app/views.json', entrypoint: 'app/ir/app.html' }
    : operation === 'mode' ? await adapter.project.setMode(input.mode)
    : await adapter.project.operation(operation, input, signal);
  const shown = operation === 'show' ? result : await adapter.project.show(signal);
  const draft = await readFile(await adapter.project.path('model/business-ir.draft.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (draft !== null && Buffer.byteLength(draft) > 1024 * 1024) fail('riffoid-ir-draft-too-large');
  const files = [];
  async function add(path, directory, name) {
    await adapter.project.assertBlob(path, directory, name);
    const bytes = await readFile(await adapter.project.path(path));
    files.push({ path, base64: bytes.toString('base64'), sha256: digest(bytes) });
  }
  let workerSource = null;
  if (operation === 'project_ir_compile' && result.status === 'succeeded') {
    const artifact = await adapter.project.read(result.browserArtifactRef);
    await add(result.browserArtifactRef, 'artifacts', 'browser.json');
    await add(artifact.modelRef, 'models', 'business.json');
    await add(artifact.bundleRef, 'bundles', 'model.simpack');
    await add(artifact.runtimeRef, 'runtimes', 'runtime.js');
    workerSource = await readFile(new URL('../browser/worker.js', import.meta.url), 'utf8');
  } else if (operation === 'project_ir_check' && result.status === 'passed') {
    await add(result.sealedRef, 'models', 'business.json');
  }
  const registration = { schema: 'riffoid-ir.registration/v1', files, state: {
    draft, modelMode: shown.defaultMode, currentModel: shown.currentModel, toolchain: result.toolchain ?? null,
  }, workerSource };
  const output = { ...result, registration };
  if (Buffer.byteLength(JSON.stringify(output)) > MAX_RESULT_BYTES) fail('riffoid-ir-registration-too-large');
  return output;
}

async function main() {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) { size += chunk.length; if (size > 64 * 1024) fail('riffoid-ir-request-too-large'); chunks.push(chunk); }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!exact(request, ['operation', 'input'])) fail('invalid-riffoid-ir-request');
  const result = await runRiffoidOperation({ workspace: process.cwd(), ...request });
  process.stdout.write(JSON.stringify(result) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const result = { status: 'failed', diagnostics: error.diagnostics ?? [{ code: 'riffoid_ir_error', stage: 'host', message: String(error.message).slice(0, 4000) }] };
    process.stdout.write(JSON.stringify(result) + '\n');
  });
}
