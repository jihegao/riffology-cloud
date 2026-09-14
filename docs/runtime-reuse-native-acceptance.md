# C local native acceptance

The integrated opt-in runtime passed the local native acceptance below. Deployment acceptance remains separate.

Run from a clean, integrated source revision with isolated dependencies:

```sh
RIFFOLOGY_DOCKER_SOCKET=unix:///absolute/path/docker.sock node scripts/m2/check-runtime-reuse-local.mjs --run-ten-turns
```

The only accepted profile is ten sequential Turns with the existing deterministic in-process provider fixture. Turn 1 performs the existing 21 tool operations; subsequent Turns read and verify the saved files. Turn 6 starts a different Session. No provider credentials or network calls are needed. Native execution, supervision, ledgers, checkpoints and capacity are real product code; validation routes expose observations only, except explicit normal retirement/drain.

The script builds production Project and TrustedPi base images; only the TrustedPi provider adapter is replaced by the fixture. It rejects image/guard/native bypass flags and probes `pidfd_open` in both real target images. The current ARM guest running translated amd64 may fail this probe. That is a recorded failure, not permission to bypass pidfd or seccomp. Native process samples record UID 10002 Node PID/start-time pairs and the corresponding supervisor epoch/token; a missing sample fails acceptance rather than inferring a process from parent completion.

Each Turn must be completed and saved, with matching R2 hashes, successful tool events, closed model/money/tool ledgers without pending or unknown operations, exact Runtime handoff and idle pair, a growing binding epoch and unchanged physical Project/Pi container IDs. A new Pi token and observed process identity are required each round. The Session transition must have no prior Session checkpoint while retaining the Workspace checkpoint. After Turn 10 the script requests normal retirement and waits up to eight minutes for real drain and the unchanged physical guard. Emergency final cleanup removes only task-created containers; emergency cleanup cannot make the acceptance pass.

Evidence is written under `docs/evidence/runs/m2-runtime-reuse-*`, including source/image identities, per-Turn manifests, capacity/ledger receipts, native samples, and cleanup. Argument-contract tests and syntax validation remain preparation checks only. A target native x86 kernel, the integrated source and an exclusive Docker window are prerequisites. No deployment, live account changes or paid model evaluation are part of this run.

## Recorded local native acceptance — 2026-09-14

The final runtime source was `7b6b05394f1ce41d03d3863ee7d042817c026158`. Complete `npm run check` passed with 1,850 passes and 6 explicit skips. Independent review covered the runtime integration and the final platform-CA correction. Separate native Linux suites passed 15 CA boundary cases, 14 Pi supervisor cases and 13 Project epoch cases; the Project cases were run against the production Project image.

The first target-kernel attempt, at source `9df08b6`, failed during Pi initialization. Its evidence is retained rather than replaced. An isolated actual SDK comparison proved that clearing `NODE_EXTRA_CA_CERTS` caused `SELF_SIGNED_CERT_IN_CHAIN`; the same UID and image could read the SDK-created 0644 control file and complete a real SDK/host session with local transports. The fix admits only the fixed, root-controlled platform CA after ownership, permissions and no-symlink checks. It neither inherits arbitrary environment variables nor disables TLS verification.

The acceptance used a task-owned x86_64 QEMU Linux kernel with 4 GiB memory and production Project/Pi sandbox images, changing only the Pi release's model transport to the deterministic fixture. It was not Cloudflare deployment acceptance or a paid model-quality evaluation. The original default Docker context/configuration was preserved.

The [passing record](evidence/runs/m2-runtime-reuse-lazy-crud-fixture-20260914100801472/primary-review.json) contains ten completed, saved Turns across two Sessions, matching R2 file/Session hashes, binding epochs 1–10, fresh observed Pi process identities and one unchanged physical Project/Pi pair. All three operation ledgers are closed, with zero active, pending or unknown entries at every handoff; completed tool history remains present. Normal retirement finishes with both occupied counts zero and no active lease or queue. Only the two local proxy containers are removed by final emergency cleanup; that cleanup is not the normal capacity proof. Source remained stable and external Worker fetches were zero.

An [independent read of the final capacity database](evidence/runs/m2-runtime-reuse-lazy-crud-fixture-20260914100801472/capacity-release-review.json) retains the exact released lease: both resource observations occurred more than 363 seconds after retirement began, with more than 361 seconds of recorded continuous absence. Both exceed the unchanged 360-second assignment guard and 30-second quiet interval. The [environment cleanup record](evidence/runs/m2-runtime-reuse-lazy-crud-fixture-20260914100801472/environment-cleanup.json) confirms removal of the task-owned VM and preservation of the default configuration.

The [failed first attempt](evidence/runs/m2-runtime-reuse-lazy-crud-fixture-20260914094821838/primary-review.json) and [isolated CA diagnosis](evidence/runs/m2-runtime-reuse-lazy-crud-fixture-20260914100801472/ca-diagnosis.json) are retained alongside the passing evidence. This establishes bounded local native reuse, not a controlled production latency comparison or general Cloudflare reliability.
