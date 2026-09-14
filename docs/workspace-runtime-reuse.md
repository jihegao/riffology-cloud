# Workspace runtime reuse implementation and validation boundaries

Issue #37 C adds an opt-in warm runtime after B's lazy Project preparation. The default cold path remains available. New admission requires both `M2_LAZY_PROJECT_ENABLED` and `M2_WORKSPACE_RUNTIME_REUSE_ENABLED` to equal the string `true`, plus a pinned 64-character hexadecimal `M2_WORKSPACE_RUNTIME_VERSION`. The latter is an operator-supplied release/image identity, not an automatically verified image attestation; changing it retires the previous lease. This change does not enable any deployed gate.

## Ownership and admission

`services/workspace/runtime-leases.ts` persists the selected protocol, full Workspace lease identity and per-Turn binding intent before dispatch. A long-lived lease includes Workspace generation, lease ID/epoch and runtime version. Each Turn has an independent monotonically increasing binding epoch, Session, dispatch ID and execution deadline. The physical Project and TrustedPi actor names include the complete lease identity. A new Session restores its own Session checkpoint and the shared saved Workspace files.

`services/capacity/paired.ts` and `durable.ts` reserve both physical resources through the same SQLite admission order used by legacy cold tickets. Idle leases retain both slots. Queued work, maximum age and rollback request retirement without preempting an active Turn. Existing accepted bindings can reconcile after rollback; unaccepted work cannot become a new warm execution. Native start claims precede every SDK call that could create an environment, including staging reads/writes. Cancellation before request delivery leaves a durable receiver-side tombstone.

## Saving and handing off

Workspace closes outbound admission and all three real operation ledgers: model token budget, production money budget, and ToolBridge. Reuse requires each closed ledger to have zero active, pending and unknown operations. Closing does not settle unknown usage, refund an in-flight provider call, or certify a pending tool.

TrustedPi's complete non-root process domain is sealed before its Session output is read; Project is sealed before files are frozen. Native proofs use a root-owned epoch fence and pidfd-backed whole-UID quiescence. A parent process exit or timeout is insufficient. Unsupported native supervision quarantines and destroys the environment through the cold recovery boundary.

Only a completed Turn with the exact checkpoint saved by both RevisionStore and Workspace can hand off. RevisionStore commit alone does not permit pruning or another binding. The fixed handoff proof is durable before capacity confirmation; a lost acknowledgement replays the same proof and epoch. Failed, cancelled, interrupted or unresolved execution never reuses mutable files. Explicit unresolved retirement carries no invented native stop proof and cannot prepare or commit a checkpoint; physical destruction and capacity release remain independently reconciled.

Pure chat does not start Project to manufacture a proof. Capacity distinguishes never-started Project from a retained sealed Project using its durable allocation history and prior genuine seal anchor. Any later Project start claim invalidates that anchor until a new real seal is confirmed.

## Native boundary and cleanup

`services/sandbox/workspace-native-host.ts` checks current Workspace authority for each forwarded RPC, including cached controllers. New writes/effects/starts are rejected after admission closes; read-only persisted reconciliation and cleanup remain available. `workspace-native.ts` persists unknown SDK operations and fails closed after actor restart. Destroy uses the authoritative lease directly and never configures, seals or starts an absent container merely to clean it up.

Before a subsequent binding, Project stages and verifies the saved files before activation; matching immediately prior files may be adopted without unpacking after canonical digest verification. TrustedPi clears the prior Session/control/output files while sealed, stages the next Session, then activates. Pruning follows confirmed checkpoint commit. Only known native files are pruned; SDK metadata and unknown files are not claimed to be completely cleaned. A lease is capped at 16 bindings, bounding accumulation before retirement.

Both resource domains must independently satisfy the existing assignment guard and quiet absence observation before slots are released. Partial absence or an unknown SDK result retains capacity. The production 360-second assignment guard and 30-second quiet interval are unchanged.

## Evidence status

Implementation tests exercise SQLite reopening, lost acknowledgements, real Workerd RPC routing, the three ledgers, RevisionStore/Workspace commit ordering, gate rollback and partial release. Native supervisor tests separately exercise actual Linux processes. These are separate proofs: neither fake SDK tests nor local native tests establish Cloudflare deployment acceptance or model quality.

The reproducible ten-Turn entry point and passing local x86-kernel acceptance are documented in [runtime-reuse-native-acceptance.md](runtime-reuse-native-acceptance.md). Ten saved Turns across two Sessions retain one physical Project/Pi pair and complete normal capacity release. This is not a controlled latency comparison or deployed Cloudflare acceptance. Existing low-cardinality operation traces record local monotonic durations and resource counts; cross-actor wall-clock intervals are not presented as precise local durations.
