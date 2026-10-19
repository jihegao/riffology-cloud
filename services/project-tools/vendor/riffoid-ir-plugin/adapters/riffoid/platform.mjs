import { readFile } from 'node:fs/promises';
import { toolSchemas, descriptions } from '../../src/tools.mjs';
import { VERSION } from '../../src/compiler.mjs';

export const IR_PLUGIN_VERSION = VERSION;
export const IR_OPERATION_NAMES = Object.freeze({
  project_ir_check: 'project_ir_check', project_ir_compile: 'project_ir_compile',
  project_ir_run: 'project_ir_run', project_ir_result: 'project_ir_result',
  project_ir_mode: 'mode', project_ir_show: 'show', project_ir_install: 'install',
});
const closed = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const irToolDefinitions = Object.freeze([
  ...Object.entries(toolSchemas).map(([name, parameters]) => ({ name, label: name, description: descriptions[name], parameters })),
  { name: 'project_ir_mode', label: 'Set project modeling default', description: 'Set this project default for subsequent new models. Existing models are preserved; an explicit user request wins.', parameters: closed({ mode: { type: 'string', enum: ['ir', 'code'] } }) },
  { name: 'project_ir_show', label: 'Show IR capabilities', description: 'Read this project modeling default, model summary, fixed package versions, browser execution location and readiness.', parameters: closed({}) },
  { name: 'project_ir_install', label: 'Install the IR project page', description: 'Install the pinned IR Model project page and preserve other declared project views. This starts no simulation.', parameters: closed({}) },
].map(definition => Object.freeze(definition)));

export async function irFixedSkill() {
  const content = await readFile(new URL('../../skills/riffoid-ir/SKILL.md', import.meta.url), 'utf8');
  return { name: 'riffoid-ir', content: `${content}\n\nRiffoid host integration (plugin ${IR_PLUGIN_VERSION}): use project_ir_mode/project_ir_show for the same project defaults as /sim ir, /sim code and /sim show. The four project_ir_* pipeline tools invoke this pinned package. Compilation installs app/views.json and the IR Model page. Open that page before project_ir_run; accepted/pending is not success. Use project_ir_result to read the actual persisted run. IR computation takes place in the user browser and is local/unverified; describe its observed metrics as browser results, never as a verified Experiment or cloud Research Run. Do not call sim-engine run or start a cloud Run to complete this browser workflow. A request to generate only must stop before check/compile/run. After writing or editing model/business-ir.draft.json, call project_ir_show to synchronize the displayed current model, including generate-only requests; this starts no check, compilation or run. Existing project file tools remain available to author or repair Business IR. Package references in this skill resolve under the fixed Project Tools package /opt/riffology/riffoid-ir-plugin/: use bounded project_bash to read acceptance/b1/business-ir.json, docs/model-fields.md or docs/domain-development.md there, then write an editable copy with project_write in model/business-ir.draft.json. The package source is platform-owned; do not pass its absolute paths to project_read or use a saved example bundle as the finished model.\n` };
}
