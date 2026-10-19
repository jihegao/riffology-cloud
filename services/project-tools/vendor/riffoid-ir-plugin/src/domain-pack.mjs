import { resolve } from 'node:path';
import { packageRoot } from './compiler.mjs';
import { RUNTIME_VERSION } from '../browser/runtime.js';

// This describes implemented execution semantics, not a limit on development.
export const domainPack = {
  id: 'aircraft-support-pack/v0.1',
  browserRuntime: RUNTIME_VERSION,
  semanticProfile: 'legacy-minute-v1',
  implemented: ['daily support through 7 days', 'serial support jobs', 'personnel/equipment reservations',
    'mission notice, dispatch, cancellation, success and return', 'flight-exposure exponential failure and fixed repair',
    'immutable run replay'],
  notImplemented: ['calendar-time or non-exponential failure sampling', 'per-tail sortie assignment', 'multi-aircraft mission waves',
    'preventive maintenance', 'spares and transport', 'natural completion'],
  bounds: { durationMinutes: [1, 10080], aircraftPerMission: 1 },
};

export function domainDevelopment() {
  const root = resolve(packageRoot);
  return {
    kind: 'domain-pack-development', sourceRoot: root,
    guide: resolve(root, 'docs/domain-development.md'),
    paths: Object.fromEntries(Object.entries({
      modelFields: 'docs/model-fields.md', skill: 'skills/riffoid-ir/SKILL.md',
      compilerAdapter: 'scripts/compiler.py', browserRuntime: 'browser/runtime.js',
      capabilityDeclaration: 'src/domain-pack.mjs', project: 'src/project.mjs', tests: 'tests/conformance.test.mjs',
    }).map(([key, path]) => [key, resolve(root, path)])),
    nextStep: 'Inspect the requested semantics in the compiler SDK and browser runtime, implement the missing layers with the host development tools, then validate and return to the requested model. A capability diagnostic is not a development prohibition.',
  };
}

export function domainAgentContext() {
  const development = domainDevelopment();
  return `The installed browser runtime currently implements the B1 subset. This is an execution boundary, not a prohibition on domain-pack development. A user request to add capabilities or extend the IR pack uses the host read/edit/bash tools even in IR mode. Inspect the actual gap and continue implementation and validation within the user's scope; do not refuse solely because B1 lacks a feature. Read ${JSON.stringify(development.guide)}; installed plugin source: ${JSON.stringify(development.sourceRoot)}. Ask only for missing business values or actual host permission limits. Never claim new semantics work by adding ignored JSON fields or bypassing runtime checks.`;
}
