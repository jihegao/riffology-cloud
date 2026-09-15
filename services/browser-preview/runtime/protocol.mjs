// Browser output is untrusted visualization data, never a Research Run receipt.
export const MESSAGE_SCHEMA = 'riffology.browser-runtime/v1';
export const VISUAL_SCHEMA = 'riffology.visual/v0.1';
export const LIMITS = Object.freeze({inputBytes: 8192, resultBytes: 8388608, frames: 501, agentsPerFrame: 10000, gridCells: 1000000, deadlineMs: 30000});
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const fail = reason => { throw new Error(reason); };
const exact = (v, fields) => object(v) && Object.keys(v).sort().join(',') === [...fields].sort().join(',');
const finite = v => typeof v === 'number' && Number.isFinite(v);
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function size(v, maximum) {
  let bytes;
  try { bytes = new TextEncoder().encode(JSON.stringify(v)).byteLength; } catch { fail('runtime-json-invalid'); }
  if (bytes > maximum) fail('runtime-output-limit');
}
export function validateInput(input) {
  if (!exact(input, ['parameters', 'seed']) || !object(input.parameters)) fail('runtime-input-invalid');
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 4294967295) fail('runtime-seed-invalid');
  for (const [name, value] of Object.entries(input.parameters)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) || !(finite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER || typeof value === 'boolean' || typeof value === 'string' && value.length <= 1024)) fail('runtime-parameter-invalid');
  }
  size(input, LIMITS.inputBytes);
  return input;
}
export function validateRunRequest(request) {
  if (!exact(request, ['schema', 'type', 'requestId', 'packageIdentity', 'input']) || request.schema !== MESSAGE_SCHEMA || request.type !== 'run' || !/^[A-Za-z0-9_-]{1,128}$/.test(request.requestId) || !digest(request.packageIdentity)) fail('runtime-request-invalid');
  validateInput(request.input);
  return request;
}
export function validateTrace(trace) {
  if (!exact(trace, ['model', 'snapshots']) || typeof trace.model !== 'string' || trace.model.length < 1 || trace.model.length > 128 || !Array.isArray(trace.snapshots) || !trace.snapshots.length || trace.snapshots.length > LIMITS.frames) fail('runtime-trace-invalid');
  size(trace, LIMITS.resultBytes);
  let previousFrame = -1, previousTime = -1;
  for (const snapshot of trace.snapshots) {
    if (!exact(snapshot, ['schemaVersion', 'frame', 'time', 'space', 'agents', 'metrics']) || snapshot.schemaVersion !== VISUAL_SCHEMA || !Number.isInteger(snapshot.frame) || snapshot.frame <= previousFrame || !finite(snapshot.time) || snapshot.time < 0 || snapshot.time < previousTime || !object(snapshot.space) || !Array.isArray(snapshot.agents) || snapshot.agents.length > LIMITS.agentsPerFrame || !object(snapshot.metrics)) fail('runtime-snapshot-invalid');
    previousFrame = snapshot.frame; previousTime = snapshot.time;
    for (const [name, value] of Object.entries(snapshot.metrics)) if (name.length > 128 || !finite(value)) fail('runtime-metric-invalid');
    const space = snapshot.space;
    if (space.type === 'grid') {
      if (!exact(space, ['type', 'width', 'height']) || !Number.isInteger(space.width) || !Number.isInteger(space.height) || space.width < 1 || space.height < 1 || space.width * space.height > LIMITS.gridCells) fail('runtime-space-invalid');
    } else if (space.type === 'lane') {
      if (!exact(space, ['type', 'lanes']) || !Array.isArray(space.lanes) || !space.lanes.length || space.lanes.length > 128 || space.lanes.some(l => typeof l !== 'string' || !l.length || l.length > 128) || new Set(space.lanes).size !== space.lanes.length) fail('runtime-space-invalid');
    } else fail('runtime-space-invalid');
    const ids = new Set();
    for (const agent of snapshot.agents) {
      const fields = space.type === 'grid' ? ['id', 'type', 'state', 'x', 'y'] : ['id', 'type', 'state', 'lane', 'position'];
      if (!exact(agent, fields) || typeof agent.id !== 'string' || !agent.id.length || agent.id.length > 128 || ids.has(agent.id) || typeof agent.type !== 'string' || !agent.type.length || agent.type.length > 128 || typeof agent.state !== 'string' || !agent.state.length || agent.state.length > 128) fail('runtime-agent-invalid');
      ids.add(agent.id);
      if (space.type === 'grid' ? !Number.isInteger(agent.x) || !Number.isInteger(agent.y) || agent.x < 0 || agent.y < 0 || agent.x >= space.width || agent.y >= space.height : !space.lanes.includes(agent.lane) || !finite(agent.position) || agent.position < 0) fail('runtime-agent-invalid');
    }
  }
  return trace;
}
export function validateResult(message, pending) {
  if (!exact(message, ['schema', 'type', 'requestId', 'packageIdentity', 'trace']) || message.schema !== MESSAGE_SCHEMA || message.type !== 'result' || message.requestId !== pending.requestId || message.packageIdentity !== pending.packageIdentity) fail('runtime-result-unrelated');
  return validateTrace(message.trace);
}
