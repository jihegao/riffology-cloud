// services/browser-preview/runtime/protocol.mjs
var VISUAL_SCHEMA = "riffology.visual/v0.1";
var LIMITS = Object.freeze({ inputBytes: 8192, resultBytes: 8388608, frames: 501, agentsPerFrame: 1e4, gridCells: 1e6, deadlineMs: 3e4, maxSteps: 500, cacheBytes: 8388608, sourceBytes: 1048576, bundleBytes: 5242880 });
var object = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
var fail = (reason) => {
  throw new Error(reason);
};
var exact = (v, fields) => object(v) && Object.keys(v).sort().join(",") === [...fields].sort().join(",");
var finite = (v) => typeof v === "number" && Number.isFinite(v);
function size(v, maximum) {
  let bytes;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(v)).byteLength;
  } catch {
    fail("runtime-json-invalid");
  }
  if (bytes > maximum) fail("runtime-output-limit");
}
function validateTrace(trace) {
  if (!exact(trace, ["model", "snapshots"]) || typeof trace.model !== "string" || trace.model.length < 1 || trace.model.length > 128 || !Array.isArray(trace.snapshots) || !trace.snapshots.length || trace.snapshots.length > LIMITS.frames) fail("runtime-trace-invalid");
  size(trace, LIMITS.resultBytes);
  let previousFrame = -1, previousTime = -1;
  for (const snapshot of trace.snapshots) {
    if (!exact(snapshot, ["schemaVersion", "frame", "time", "space", "agents", "metrics"]) || snapshot.schemaVersion !== VISUAL_SCHEMA || !Number.isInteger(snapshot.frame) || snapshot.frame <= previousFrame || !finite(snapshot.time) || snapshot.time < 0 || snapshot.time < previousTime || !object(snapshot.space) || !Array.isArray(snapshot.agents) || snapshot.agents.length > LIMITS.agentsPerFrame || !object(snapshot.metrics)) fail("runtime-snapshot-invalid");
    previousFrame = snapshot.frame;
    previousTime = snapshot.time;
    for (const [name, value] of Object.entries(snapshot.metrics)) if (name.length > 128 || !finite(value)) fail("runtime-metric-invalid");
    const space = snapshot.space;
    if (space.type === "grid") {
      if (!exact(space, ["type", "width", "height"]) || !Number.isInteger(space.width) || !Number.isInteger(space.height) || space.width < 1 || space.height < 1 || space.width * space.height > LIMITS.gridCells) fail("runtime-space-invalid");
    } else if (space.type === "lane") {
      if (!exact(space, ["type", "lanes"]) || !Array.isArray(space.lanes) || !space.lanes.length || space.lanes.length > 128 || space.lanes.some((l) => typeof l !== "string" || !l.length || l.length > 128) || new Set(space.lanes).size !== space.lanes.length) fail("runtime-space-invalid");
    } else fail("runtime-space-invalid");
    const ids = /* @__PURE__ */ new Set();
    for (const agent of snapshot.agents) {
      const fields = space.type === "grid" ? ["id", "type", "state", "x", "y"] : ["id", "type", "state", "lane", "position"];
      if (!exact(agent, fields) || typeof agent.id !== "string" || !agent.id.length || agent.id.length > 128 || ids.has(agent.id) || typeof agent.type !== "string" || !agent.type.length || agent.type.length > 128 || typeof agent.state !== "string" || !agent.state.length || agent.state.length > 128) fail("runtime-agent-invalid");
      ids.add(agent.id);
      if (space.type === "grid" ? !Number.isInteger(agent.x) || !Number.isInteger(agent.y) || agent.x < 0 || agent.y < 0 || agent.x >= space.width || agent.y >= space.height : !space.lanes.includes(agent.lane) || !finite(agent.position) || agent.position < 0) fail("runtime-agent-invalid");
    }
  }
  return trace;
}

// services/browser-preview/runtime/renderer.mjs
var PreviewPlayer = class {
  constructor(container, metricContainer) {
    this.container = container;
    this.metricContainer = metricContainer;
    this.index = 0;
  }
  load(trace, visualization, paint = null) {
    this.pause();
    validateTrace(trace);
    if (new TextEncoder().encode(JSON.stringify(trace)).length > LIMITS.cacheBytes) throw Error("runtime-cache-limit");
    if (visualization.renderer === "python-canvas" && typeof paint !== "function") throw Error("runtime-canvas-paint-missing");
    this.trace = trace;
    this.visualization = visualization;
    this.paint = paint;
    this.index = 0;
    this.render();
  }
  clear() {
    this.pause();
    this.trace = null;
    this.container.replaceChildren();
    this.metricContainer.replaceChildren();
  }
  pause() {
    clearInterval(this.timer);
    this.timer = null;
  }
  play(speed = 5) {
    this.pause();
    if (!Number.isFinite(speed) || speed < 1 || speed > 60) throw Error("runtime-playback-speed-invalid");
    this.timer = setInterval(() => this.step(), 1e3 / speed);
  }
  step() {
    if (!this.trace) return;
    if (this.index + 1 >= this.trace.snapshots.length) {
      this.pause();
      return;
    }
    this.index++;
    this.render();
  }
  restart() {
    this.pause();
    this.index = 0;
    this.render();
  }
  render() {
    if (!this.trace) return;
    const snapshot = this.trace.snapshots[this.index];
    if (this.visualization.renderer !== "python-canvas") this.container.replaceChildren();
    this.metricContainer.replaceChildren();
    this.container.dataset.frame = String(snapshot.frame);
    if (this.visualization.renderer === "python-canvas") {
      this.paint(this.index);
    } else if (snapshot.space.type === "grid") {
      this.container.style.display = "block";
      const canvas = document.createElement("canvas");
      canvas.className = "preview-grid";
      canvas.width = 600;
      canvas.height = 420;
      canvas.style.maxWidth = "100%";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Frame ${snapshot.frame}: ${snapshot.agents.length} agents on ${snapshot.space.width} by ${snapshot.space.height} grid`);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#f1f5f9";
      ctx.fillRect(0, 0, 600, 420);
      const cellWidth = 600 / snapshot.space.width, cellHeight = 420 / snapshot.space.height;
      for (const agent of snapshot.agents) {
        ctx.fillStyle = agent.state === "group-b" ? "#f97316" : "#2563eb";
        ctx.fillRect(agent.x * cellWidth, agent.y * cellHeight, Math.max(0.5, cellWidth), Math.max(0.5, cellHeight));
      }
      this.container.append(canvas);
    } else {
      this.container.style.display = "block";
      const lanes = new Map(snapshot.space.lanes.map((lane) => [lane, []]));
      for (const agent of snapshot.agents) lanes.get(agent.lane).push(agent);
      for (const [lane, agents] of lanes) {
        const row = document.createElement("div");
        row.className = "preview-lane";
        row.textContent = lane + ": ";
        for (const agent of agents.sort((a, b) => a.position - b.position)) {
          const span = document.createElement("span");
          span.textContent = ` \u25CF ${agent.id}`;
          span.title = agent.state;
          row.append(span);
        }
        this.container.append(row);
      }
    }
    for (const key of this.visualization.metricKeys) {
      const row = document.createElement("div");
      row.textContent = `${key}: ${snapshot.metrics[key] ?? "\u2014"}`;
      this.metricContainer.append(row);
    }
  }
};
export {
  PreviewPlayer
};
