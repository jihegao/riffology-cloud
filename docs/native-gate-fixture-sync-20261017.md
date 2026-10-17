# Native gate fixture synchronization — 2026-10-17

[PR #237's actual CI failure](https://github.com/jihegao/riffology-cloud/actions/runs/39033087891/job/117397364971) occurred at test line57, before actor close: 40 `setImmediate` turns elapsed without preflight exec entry. The test ended in 6.360731ms; its unfinished `start()` later accessed the already-closed SQLite database. This was a real executed test failure, not a quota/zero-step failure. #237's documentation commit `05e94163485a7d3776b911ede2582e7009593039` remains unchanged.

The test, all 23 `services/project-views` files and lockfile match base `29da0349719dba23d5c9ce95b4b83b97ebf7091a`. Diagnostic invocations, each exactly once: unchanged local file passed 8/8; delaying completion of the real second SHA256 digest by 50ms reproduced both errors on #237; the identical selected test/preload on base reproduced both errors. Inputs and digest results were unchanged. This establishes an inherited synchronization/teardown defect; the hosted log does not establish its precise scheduling/crypto-worker delay.

Only `tests/m3/project-view-runtime-native-gate.test.mjs` changes executable behavior, within the synthetic fixture. It waits on explicit preflight/browser exec-entry promises with a two-second failure deadline, races early start settlement/rejection, and retains exact execution-count and all original safety assertions. Cleanup prevents further synthetic entry, releases synthetic gates, joins start before closing the runtime/database, and propagates rejection. If joining times out, it fails instead of closing a database still accessible by that operation. The normal revocation assertions run before teardown and still exercise actual production fences.

A new regression starts cleanup while real package, asset and identity digests are still completing (each delayed 50ms), then verifies all three completed, start did not become running and no native exec/private init occurred. This is fixture lifecycle verification, not cloud execution acceptance. Production files, policies and #236's worktree are unchanged.

## Validation

Existing Node25.3.0 (matching CI's version), macOS arm64, existing dependencies/esbuild; no installation. Exactly three repair-validation invocations, all first attempts:

1. `node --test --test-reporter=tap tests/m3/project-view-runtime-native-gate.test.mjs`: **9/9 passed**, including delayed teardown.
2. `node --import ./docs/evidence/native-gate-fixture-sync-20261017/pr237-delay-digest.mjs --test --test-reporter=tap --test-name-pattern='closing the original actor while preflight is pending' tests/m3/project-view-runtime-native-gate.test.mjs`: **1/1 passed** with the same diagnostic 50ms delay that failed both old trees. The actual invocation used the byte-identical preload at `/tmp/pr237-delay-digest.mjs`.
3. `node --test --test-reporter=tap --test-concurrency=2 tests/m3/project-view-runtime.test.ts tests/m3/project-view-runtime-preflight.test.mjs tests/m3/project-view-runtime-exec-deadline.test.ts`: **31/31 passed**.

[Source/log hashes and results](evidence/native-gate-fixture-sync-20261017/receipt.json) bind all three diagnostic and three repair logs plus the hosted failure excerpt. The two failing TAP logs are encoded as JSON strings to preserve their original whitespace without introducing trailing whitespace in the patch; decoded hashes remain recorded. JSON parsing and `git diff --check` passed. No full-suite claim, manual remote CI rerun, provider/cloud container, merge or deployment. A local first-pass success does not erase the original CI failure or prove the exact Linux scheduling cause. Independent PR publication is authorized; merge/deployment are not.
