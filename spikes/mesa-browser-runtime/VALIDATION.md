# Browser runtime fix acceptance — 2026-09-15

The four findings from PR #63's initial review are fixed. Both checked-in model paths passed real browser acceptance without Worker/model/CDN/package response overrides. This is acceptance of the isolated spike, not production Workspace integration or server Research Evidence.

## Fixes

- A module Worker dynamically imports the pinned Pyodide ES module.
- Mesa installation explicitly loads Pyodide's pinned `networkx` package and verifies imports before marking Mesa ready.
- Schelling snapshots recalculate unhappy residents after movement, without using Mesa's public `step()` return value. Empty populations have happy_fraction=1. Vacancy sorting removes native/wasm set-order differences in seeded sampling.
- Runs capture model/config/request ID together before source fetch, lock model/parameters/seed until completion, and reject unrelated or late results. Model changes clear the trace and playback state. Fatal Worker errors release the form and cause the next run to create a fresh Worker. The Worker rejects overlapping runs before they can share Python globals.

## Checks passed

- Protocol assertions and three Playwright UI regression tests: **4 Node tests passed**. The UI regression tests use a fixture Worker to isolate delayed source fetch, immutable config, stale result rejection, source HTTP failure recovery, and Worker failure/retry.
- Real Mesa model regressions: **3 Python tests passed**, including an independent reconstruction of unhappy counts from emitted positions across seeds 1, 7, 19 and homophily 0.2, 0.5, 0.8.
- Worker/acceptance-script syntax and Git diff whitespace checks passed.
- `browser-acceptance.mjs`: **9 real browser runs passed**, plus playback, invalid-input recovery, model reset, required desktop region bounds, screenshot review, and network checks.

The real browser run used installed Google Chrome on macOS, a 1440×1080 viewport, a local HTTP server, and the configured local proxy for external downloads. Runtime pins were Pyodide 314.0.6 and Mesa 3.5.1. No uncaught page error occurred. Observed requests were GETs to local static files, jsDelivr, PyPI, and Python wheel hosting; no Riffology simulation API request was observed. The local-only/non-Evidence statement was visible.

| Model/config | Snapshots | Final check |
| --- | ---: | --- |
| Mesa, seed 7, homophily 0.5 | 8 | population=234, unhappy=0, happy_fraction=1 |
| Mesa, seed 8, homophily 0.5 | 24 | population=229, unhappy=0, happy_fraction=1 |
| Mesa, seed 7, homophily 0.8 | 41 | unhappy=209, happy_fraction=0.1068376068 |
| Queue, seed 7, 2 servers | 61 | completed=30, mean_wait=0.0507972334 |
| Queue, seed 7, 1 server | 61 | completed=30, mean_wait=0.7425250467 |
| Queue, seed 8, 1 server | 61 | completed=30, mean_wait=5.3192699661 |

Both default configurations reproduced identically with the same seed and parameters. All three listed Mesa traces also matched native Python with Mesa 3.5.1, frame by frame. These checks establish repeatability for the tested examples and runtimes; they are not a general model-validity or cross-version guarantee. The high-homophily run reaching its configured horizon is not a claim of convergence.

Queue started in a separate browser context with a fresh Worker and did not request micropip, networkx, or Mesa installation. Both models passed Play, stable Pause, Step, Restart, and speed controls. The screenshots show a populated grid and Queue server customers; required controls, status, stage, and metrics fit the tested desktop viewport. Mobile acceptance was not performed.

## Reproduce

Use the commands in [README.md](./README.md), including `node --test protocol.test.mjs browser.test.mjs`, `python test_models.py`, and `SPIKE_URL=http://127.0.0.1:8080/ node browser-acceptance.mjs` with the HTTP server running.

Local raw evidence was retained under `.local/mesa-browser-runtime-20260915/` in the fix worktree: `automated/acceptance.json`, four browser screenshots, native Mesa traces, and interactive acceptance traces. Raw evidence is untracked; the executable acceptance script and this record are committed.

The spike remains isolated from Workspace/runtime/release code. External CDN/PyPI availability and production package/origin policy remain integration considerations documented in README.md. No deployment or server Evidence acceptance was performed.
