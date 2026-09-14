# C local native acceptance preparation

This is a prepared acceptance script, not a passing acceptance record. It must be integrated with the C Workspace settlement, warm routing, native staging/reset and retention changes before execution.

Run from a clean, integrated source revision with isolated dependencies:

```sh
RIFFOLOGY_DOCKER_SOCKET=unix:///absolute/path/docker.sock node scripts/m2/check-runtime-reuse-local.mjs --run-ten-turns
```

The only accepted profile is ten sequential Turns with the existing deterministic in-process provider fixture. Turn 1 performs the existing 21 tool operations; subsequent Turns read and verify the saved files. Turn 6 starts a different Session. No provider credentials or network calls are needed. Native execution, supervision, ledgers, checkpoints and capacity are real product code; validation routes expose observations only, except explicit normal retirement/drain.

The script builds production Project and TrustedPi base images; only the TrustedPi provider adapter is replaced by the fixture. It rejects image/guard/native bypass flags and probes `pidfd_open` in both real target images. The current ARM guest running translated amd64 may fail this probe. That is a recorded failure, not permission to bypass pidfd or seccomp. Native process samples record UID 10002 Node PID/start-time pairs and the corresponding supervisor epoch/token; a missing sample fails acceptance rather than inferring a process from parent completion.

Each Turn must be completed and saved, with matching R2 hashes, successful tool events, closed model/money/tool ledgers without pending or unknown operations, exact Runtime handoff and idle pair, a growing binding epoch and unchanged physical Project/Pi container IDs. A new Pi token and observed process identity are required each round. The Session transition must have no prior Session checkpoint while retaining the Workspace checkpoint. After Turn 10 the script requests normal retirement and waits up to eight minutes for real drain and the unchanged physical guard. Emergency final cleanup removes only task-created containers; emergency cleanup cannot make the acceptance pass.

Evidence is written under `docs/evidence/runs/m2-runtime-reuse-*`, including source/image identities, per-Turn manifests, capacity/ledger receipts, native samples, and cleanup. Two argument-contract tests and syntax validation are preparation checks only. A target native x86 kernel, the integrated source and an exclusive Docker window remain prerequisites. No deployment, live account changes or paid model evaluation are part of this run.
