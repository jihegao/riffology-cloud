const PYODIDE_VERSION = "314.0.6";
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const MESA_VERSION = "3.5.1";

let pyodide;
let runtimePromise;

async function ensureRuntime(needsMesa) {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      importScripts(`${PYODIDE_INDEX}pyodide.js`);
      pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX });
      return pyodide;
    })();
  }
  await runtimePromise;
  if (needsMesa && !self.__mesaReady) {
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip");
    try {
      await micropip.install(`mesa==${MESA_VERSION}`);
      self.__mesaReady = true;
    } finally {
      micropip.destroy();
    }
  }
}

self.addEventListener("message", async (event) => {
  const message = event.data;
  if (!message || message.type !== "run") return;
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
  }
});
