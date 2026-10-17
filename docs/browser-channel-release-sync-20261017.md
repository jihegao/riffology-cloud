# Browser channel and runtime-release test synchronization — 2026-10-17

The [actual #240 CI run](https://github.com/jihegao/riffology-cloud/actions/runs/39034860204/job/117402520688) used head `bb7b7d9d34682d4c10fe975be4bac6f1560d9c82`. Its native-gate tests passed, but two M1 tests ignored `M1_BROWSER_CHANNEL=chrome` and attempted to launch an absent Chromium headless shell despite CI installing Chrome. A separate runtime test failed after approximately 3.8ms waiting for `occupied` to clear. These were actual executed failures, not CI quota failures. This independent branch starts at main `29da034`; it does not alter #237/#240 or the Pi image work.

## Exact scope

- `tests/m1/riffoid-cookie-browser.test.mjs` and `tests/m1/riffoid-local-history-browser.test.mjs`: pass `channel: process.env.M1_BROWSER_CHANNEL || undefined` to Playwright. CI selects its installed Chrome; unset/empty retains Playwright's local Chromium default. No assertions, auth semantics, interception, sandbox flags or product code change.
- `tests/m3/project-view-runtime.test.ts`: capture the existing runtime `waitUntil` promises in the fixture. For browser-failure cleanup, join the registered terminal→close→SHA256 proof→capacity-release chain with a two-second failure deadline, then explicitly assert unoccupied, closed, one original start and not running. Add the same case with real digest completion delayed 50ms. No production runtime behavior changes; the file's other existing waits are not broadened into this fix.

## Diagnosis and verification

Existing Node25.3.0/macOS and existing Playwright browsers/dependencies only. Each invocation listed below ran once; no retry-to-green.

Two diagnostic invocations on unmodified base:

1. Selected `browser failure closes` test: 1/1 passed.
2. Same selected test with real cleanup-proof SHA256 completion delayed 50ms: failed at the original 30-turn `until`, after 4.3095ms. Trace shows the proof digest began delaying before the assertion failed and completed afterwards. This establishes a sufficient inherited test race; CI did not trace digest completion, so its precise scheduler/crypto-worker cause is still unproven.

Four repair test invocations:

1. Full `tests/m3/project-view-runtime.test.ts`: **15/15 passed**, including the new delayed-digest case.
2. Selected `browser failure closes` cases with the same external 50ms preload: **2/2 passed**; the builtin-delay variant adds its own 50ms.
3. Both M1 browser files with `M1_BROWSER_CHANNEL` unset: **2/2 passed** using installed Chromium headless shell.
4. Both M1 browser files with `M1_BROWSER_CHANNEL=chromium`: **2/2 passed** using installed full Chromium. Google Chrome is not installed locally; this is not Chrome-channel or hosted Linux acceptance.

Typecheck ran once and passed. Diff/JSON/source and log hash checks passed. No full-suite claim or manual remote CI rerun, installation, real OAuth/provider/cloud container, merge or deployment.

Reproduction from repository root: use Node25.3.0 with `--test --test-reporter=tap`; select the runtime case via `--test-name-pattern='browser failure closes'`, adding `--import ./docs/evidence/browser-channel-release-sync-20261017/release-proof-delay50.mjs` for the diagnostic delay. The actual invocations used the byte-identical `/tmp/release-proof-delay50.mjs`. Browser invocations select the two named M1 files, with the environment unset or set to `chromium`. Typecheck command: `node node_modules/typescript/bin/tsc --noEmit`.

[Receipt and exact source hashes](evidence/browser-channel-release-sync-20261017/receipt.json) bind the logs and preload. Logs use lossless JSON strings to preserve original whitespace. Future hosted results must be reported separately; these local passes do not erase #240's original CI failures.
