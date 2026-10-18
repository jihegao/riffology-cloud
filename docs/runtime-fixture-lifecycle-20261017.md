# Runtime fixture lifecycle follow-up — 2026-10-17

The first integrated [#243 run](https://github.com/jihegao/riffology-cloud/actions/runs/39039664499/job/117416378816), head `2a2111a0175195af43b056ddc0c4fb8da17fe8c2`, passed native-gate9, both M1 browser cases and runtime normal/50ms proof cases but failed the remaining native-entry 30-turn wait before close assertions. Original hosted timing cause is still unproven; this was a real failure, not quota failure.

The only new executable change is `tests/m3/project-view-runtime.test.ts`:

- Remove all remaining loop-count polling. Acquire/native-start entry promises resolve at the gate boundary, race the original start (including its actual rejection), retain exact invocation counts and have named two-second deadlines with timer cleanup.
- Pipe EOF/malformed/flood await the tracked terminal-close chain, then assert destroy occurred, status unknown, occupied capacity, cleanupConfirmed=false and only the original start. No production safety assertions were dropped.
- Every fixture-created core wraps start from invocation, before internal digest/registration, observing completion without replacing the original rejecting promise. Teardown prevents new synthetic admission/entry, releases gates and the synthetic session terminal, joins all starts, closes known sessions and drains work registered during the joins. It closes SQLite only after those joins succeed. A timeout fails rather than closing a database still reachable by pending work. Normal pending session.finished is explicitly settled for teardown, not blindly awaited forever.
- Regressions cover acquire/native entry after real digest delays, validation still pending at teardown, a real delayed invalid-package rejection, and teardown at each pending acquire/native gate. Late native gate release cannot set running after teardown begins.

No production files/timeouts, workflow, dependency installation, live provider/cloud container, #236 work or other PR changed. User authorized this fixture/evidence increment and one normal CI on updated #243, not merge/deployment.

## Local validation

Existing Node25.3.0/macOS and dependencies. Three development invocations, each once on different test contents: initial implementation19/19; added delayed-rejection/gate-teardown regressions21/21; final post-gate guard plus unchanged native-gate file30/30 (runtime21 + native-gate9). No failed run was retried to green. Typecheck passed once before the final one-line finishing guard; final diff and evidence/source hashes checked. The final command was `node --test --test-reporter=tap --test-concurrency=2 tests/m3/project-view-runtime.test.ts tests/m3/project-view-runtime-native-gate.test.mjs`.

[Actual logs and final source hash](evidence/runtime-fixture-lifecycle-20261017/receipt.json). The next automatic complete CI is separate evidence and must be recorded against its own head; no full-suite pass is claimed here.
