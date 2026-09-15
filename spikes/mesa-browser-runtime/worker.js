const PYODIDE_VERSION = "314.0.6";
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const MESA_VERSION = "3.5.1";

let pyodide;
let runtimePromise;
let mesaReady = false;
let running = false;

async function ensureRuntime(needsMesa) {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const { loadPyodide } = await import(`${PYODIDE_INDEX}pyodide.mjs`);
      pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX });
      return pyodide;
    })().catch(error => {
      runtimePromise = undefined;
      throw error;
    });
  }
  await runtimePromise;
  if (needsMesa && !mesaReady) {
    // Mesa 3.5.1 imports networkx even though its wheel lists it as an extra.
    // Use the package pinned by this Pyodide distribution.
    await pyodide.loadPackage(["micropip", "networkx"]);
    const micropip = pyodide.pyimport("micropip");
    try {
      await micropip.install(`mesa==${MESA_VERSION}`);
      await pyodide.runPythonAsync("import mesa\nimport networkx");
      mesaReady = true;
    } finally {
      micropip.destroy();
    }
  }
}

self.addEventListener("message", async (event) => {
  const message = event.data;
  if (!message || message.type !== "run") return;
  if (running) {
    self.postMessage({ type: "error", requestId: message.requestId, error: "A local run is already in progress" });
    return;
  }
  running = true;
  const startedAt = performance.now();
  try {
    await ensureRuntime(Boolean(message.needsMesa));
    pyodide.globals.set("riffology_config_json", JSON.stringify(message.config ?? {}));
    await pyodide.runPythonAsync(message.source);
    const result = pyodide.globals.get("riffology_result_json");
    const trace = JSON.parse(String(result));
    if (result && typeof result.destroy === "function") result.destroy();
    self.postMessage({
      type: "result",
      requestId: message.requestId,
      trace,
      runtime: {
        pyodideVersion: PYODIDE_VERSION,
        mesaVersion: message.needsMesa ? MESA_VERSION : null,
        elapsedMs: performance.now() - startedAt,
      },
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: message.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    try {
      pyodide?.globals.delete("riffology_config_json");
      pyodide?.globals.delete("riffology_result_json");
    } catch {
      // A failed Python import can leave the runtime partially initialized; the
      // next request should still surface the original error instead of failing cleanup.
    }
    running = false;
  }
});
