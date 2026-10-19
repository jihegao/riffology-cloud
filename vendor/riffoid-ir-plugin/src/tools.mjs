export const toolSchemas = {
  project_ir_check: { type: 'object', properties: { draftRef: { type: 'string' } }, required: ['draftRef'], additionalProperties: false },
  project_ir_compile: { type: 'object', properties: { sealedRef: { type: 'string' } }, required: ['sealedRef'], additionalProperties: false },
  project_ir_run: { type: 'object', properties: { browserArtifactRef: { type: 'string' }, sourceRunId: { type: 'string' },
    runOptions: { type: 'object', properties: { seed: { type: 'integer', minimum: 0 } }, additionalProperties: false } }, additionalProperties: false },
  project_ir_result: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'], additionalProperties: false },
};
export const descriptions = {
  project_ir_check: 'Seal and validate the editable aircraft Business IR draft using sim-engine-compiler 0.1.0. Return an immutable sealedRef or actionable diagnostics.',
  project_ir_compile: 'Compile and inspect the immutable sealedRef, then export a capability-checked Plan for the user browser. Return saved model bundle and browserArtifactRef. A browser capability gap includes source paths and a development guide; when the user requests an extension, use the host development tools to implement it and validate before running.',
  project_ir_run: 'Create a new browser run from browserArtifactRef, or replay sourceRunId with its saved original Plan, runtime and inputs. Only seed may be a run option. Accepted/pending is not execution success. Open IR Model before running.',
  project_ir_result: 'Read the persisted status, actual metrics and ordered events of one runId. If pending/running, wait briefly and query again; report success only when succeeded. Quote this runId and observed events in explanations.',
};
