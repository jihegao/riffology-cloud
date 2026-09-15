export const PROTOCOL_VERSION = "riffology.visual/v0.1";

const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value);

export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") throw new Error("snapshot must be an object");
  if (snapshot.schemaVersion !== PROTOCOL_VERSION) throw new Error(`unsupported schemaVersion: ${snapshot.schemaVersion}`);
  if (!Number.isInteger(snapshot.frame) || snapshot.frame < 0) throw new Error("frame must be a non-negative integer");
  if (!finiteNumber(snapshot.time) || snapshot.time < 0) throw new Error("time must be a non-negative finite number");
  if (!snapshot.space || typeof snapshot.space !== "object") throw new Error("space is required");
  if (!Array.isArray(snapshot.agents)) throw new Error("agents must be an array");
  if (!snapshot.metrics || typeof snapshot.metrics !== "object") throw new Error("metrics must be an object");

  if (snapshot.space.type === "grid") {
    if (!Number.isInteger(snapshot.space.width) || snapshot.space.width < 1) throw new Error("grid width must be a positive integer");
    if (!Number.isInteger(snapshot.space.height) || snapshot.space.height < 1) throw new Error("grid height must be a positive integer");
    for (const agent of snapshot.agents) {
      if (!Number.isInteger(agent.x) || !Number.isInteger(agent.y)) throw new Error("grid agents require integer x/y");
      if (agent.x < 0 || agent.x >= snapshot.space.width || agent.y < 0 || agent.y >= snapshot.space.height) {
        throw new Error(`agent ${agent.id} is outside the grid`);
      }
    }
  } else if (snapshot.space.type !== "lane") {
    throw new Error(`unsupported space type: ${snapshot.space.type}`);
  }

  const ids = new Set();
  for (const agent of snapshot.agents) {
    if (agent.id === undefined || agent.id === null) throw new Error("agent id is required");
    const key = String(agent.id);
    if (ids.has(key)) throw new Error(`duplicate agent id: ${key}`);
    ids.add(key);
    if (typeof agent.type !== "string" || !agent.type) throw new Error(`agent ${key} requires type`);
    if (typeof agent.state !== "string" || !agent.state) throw new Error(`agent ${key} requires state`);
  }

  return snapshot;
}

export function validateTrace(trace) {
  if (!trace || typeof trace !== "object") throw new Error("trace must be an object");
  if (!Array.isArray(trace.snapshots) || trace.snapshots.length === 0) throw new Error("trace must contain snapshots");
  trace.snapshots.forEach(validateSnapshot);
  for (let index = 1; index < trace.snapshots.length; index += 1) {
    if (trace.snapshots[index].frame <= trace.snapshots[index - 1].frame) throw new Error("frames must increase strictly");
    if (trace.snapshots[index].time < trace.snapshots[index - 1].time) throw new Error("time must not move backwards");
  }
  return trace;
}

export function metricEntries(snapshot) {
  return Object.entries(snapshot.metrics)
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    .sort(([left], [right]) => left.localeCompare(right));
}
