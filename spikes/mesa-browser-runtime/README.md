# Mesa browser runtime spike

This isolated spike tests whether Riffology can run single interactive simulations entirely in the browser while keeping the verified Research Run path on the server.

## What it proves

- Python executes in a dedicated module Web Worker through Pyodide `314.0.6`.
- Mesa `3.5.1` is installed inside the browser runtime only for Mesa models.
- Mesa/Schelling and a non-Mesa queue simulation emit the same `riffology.visual/v0.1` snapshot protocol.
- The browser renderer consumes only protocol snapshots; it does not import Mesa or understand model internals.
- Local interactive output is explicitly non-authoritative. It is not a Run/Experiment/Evidence record.

Mesa remains a preferred modeling framework, not a mandatory simulation framework. The stable product boundary is the visualization protocol.

## Run the spike

Serve the repository over HTTP; Workers and model-source loading will not work reliably from `file://`.

```bash
cd spikes/mesa-browser-runtime
python3 -m http.server 8080
```

Open `http://localhost:8080/`.

The first Mesa run downloads Pyodide and installs Mesa from PyPI, so it is intentionally slower than subsequent runs. The queue example uses Pyodide but does not install Mesa.

Mesa's import path also requires `networkx`; the Worker explicitly loads the version pinned by the Pyodide distribution. Schelling metrics are calculated from the emitted agent positions after each step, rather than from Mesa's public `step()` return value. Vacancy ordering is stable so seeded choices agree between native Python and Pyodide.

Model, parameters, and seed are locked while a run is pending. Each request captures its configuration before downloading model source; only the matching request's result can update the visualization. Changing models after a run clears the trace, status, and playback controls.

For a production integration, self-host/pin the Pyodide assets and approved Python wheels behind Riffology's static asset origin rather than depending on third-party CDN/PyPI availability at runtime.

## Protocol

Each model returns:

```json
{
  "model": "model-id",
  "snapshots": [
    {
      "schemaVersion": "riffology.visual/v0.1",
      "frame": 0,
      "time": 0,
      "space": { "type": "grid" },
      "agents": [],
      "metrics": {}
    }
  ]
}
```

The spike supports two space adapters:

- `grid`: Mesa-style `(x, y)` agents.
- `lane`: event-trace models such as queues/resources.

This intentionally separates simulation semantics from rendering semantics. Future adapters can add network and continuous-space renderers without changing how the browser runtime executes Python.

## Safety / product boundary

The browser runtime must never be an Evidence authority. A user can alter browser memory, source, or results.

The intended production transition is:

```text
Interactive local run
  -> user chooses Save as Experiment / Verify
  -> submit immutable revision + parameters + seed
  -> cloud Research Run executes independently
  -> persisted result artifacts
  -> Evidence
```

Generated model code should eventually run in a dedicated simulation origin/worker with a restrictive CSP and no Riffology authentication material. The production version should use an allowlist of supported packages rather than arbitrary `micropip.install()` calls.

## Checks

Protocol tests do not require Pyodide or a browser:

```bash
node --test protocol.test.mjs
```

Focused UI lifecycle regressions use the repository's Playwright development dependency and a fixture Worker; they do not count as Python runtime acceptance:

```bash
# Install the repository's dependencies with npm ci first.
node --test browser.test.mjs
```

Use `CHROMIUM_PATH=/path/to/chrome` to select an existing Chrome executable, or install Playwright Chromium with `npx playwright install chromium`.

Model regressions require a Python environment with `mesa==3.5.1` and its import dependencies (including `networkx`). They independently verify that snapshot metrics match the emitted grid across three seeds and three homophily values:

```bash
python test_models.py
```

With the HTTP server running, execute the real browser acceptance without any Worker/model/package response overrides:

```bash
SPIKE_URL=http://127.0.0.1:8080/ node browser-acceptance.mjs
```

This checks both models, seeded replay, parameter changes, playback, invalid-input recovery, desktop viewport fit, and the local-only Evidence boundary. The Queue path starts in a separate browser context and must not request Mesa installation. JSON traces, request logs, and screenshots are saved under `.local/mesa-browser-runtime-acceptance/`; `OUTPUT_DIR` can select another directory. If external downloads need a browser proxy, set `BROWSER_PROXY` to that proxy URL.

See [VALIDATION.md](./VALIDATION.md) for the completed 2026-09-15 fix acceptance and its scope.

Manual browser acceptance:

1. Run Mesa Schelling; verify a populated grid renders and playback advances.
2. Change homophily and seed; verify a new local trace is produced without any Riffology API simulation call.
3. Run Python queue trace; verify queue/server lanes render using the same UI and protocol.
4. Play, pause, step and restart both traces.
5. Confirm the UI describes results as local-only/non-Evidence.

## Deliberate non-goals

- No Solara/SolaraViz.
- No production Workspace integration.
- No arbitrary Python packages or network access policy.
- No browser-generated Evidence.
- No claim that all Riffology models should be rewritten in Mesa.
