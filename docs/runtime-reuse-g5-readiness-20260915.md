# G5 / #37 execution readiness — 2026-09-15

This is a source review and an executable acceptance proposal, not a new native or cloud acceptance result. Reviewed integration source: `0393f220051adc13fe4e3ba64cd51a5eb2ad0bd2`. No deployment, provider request or container acceptance was run for this review. Current production configuration and active deployment must be frozen and reread before execution; older local records in `runtime-reuse-native-acceptance.md` are historical only.

## Current admission and recovery contract

`WorkspaceRuntimeLeases` selects warm execution only with both exact-string gates `M2_LAZY_PROJECT_ENABLED=true` and `M2_WORKSPACE_RUNTIME_REUSE_ENABLED=true`, a 64-character hexadecimal `M2_WORKSPACE_RUNTIME_VERSION`, and no accepted legacy cold ticket. The version is an operator-supplied identity, not an attestation of the actual image. Existing selections do not change interpretation after gate rollback. A version change retires the previous pair; exact accepted bindings can reconcile, while fresh bindings are denied.

No checked `infra/*.jsonc` currently declares those three settings. In particular, the selected phase1 configuration is paused (`M2_TURNS_ENABLED=false`) and remains on the default cold path. Enabling warm admission requires a separately reviewed release overlay across Workspace and capacity actors, matching immutable Project/Pi images, and the actual deployed version readback. The existing ten-Turn cloud driver does not enable or prove reuse.

The paired capacity policy in `services/capacity/durable.ts` is fixed: idle expiry 60 seconds, maximum lease age 30 minutes, assignment guard 360 seconds and continuous quiet interval 30 seconds. `WorkspaceRuntimeLeases` caps a lease at 16 bindings. Idle pairs occupy both slots; queued work retires an idle pair and marks an active pair for retirement without preempting its Turn. Cold and paired requests share FIFO ordering. A failure, cancellation, unresolved native operation or unclosed/unknown ledger cannot hand off mutable files.

Only an exact completed checkpoint saved by both RevisionStore and Workspace admits reuse. The three handoff receipts must all be closed with zero active, pending and unknown entries: tenant model tokens, production money and ToolBridge operations. UID-wide Project/Pi native seals, the per-binding epoch and genuine physical absence/guard proofs are separate requirements. `trusted-pi-release-deadline-exceeded` remains a recovery hold with subsequent bounded-cadence observation, not success or an instruction to replay execution.

## Commands available now

Run the preparation checks from a checkout with its own lockfile dependencies (`npm ci` if absent):

```sh
node --test scripts/m2/runtime-reuse-acceptance-contract.test.mjs \
  tests/m2/workspace-runtime-leases.test.ts \
  tests/m2/workspace-runtime-handoff.test.ts \
  tests/m2/workspace-paired-capacity.test.ts \
  tests/m2/product-turn-runtime-binding.test.ts \
  tests/m2/product-turn-runtime.test.ts
```

This review ran that command against the stated integration source: **88 passed, zero skipped**. It covers durable selection/rollback, FIFO SQLite reopening, exact binding epochs, cancelled-before-arrival tombstones, handoff acknowledgement loss, unknown ledgers, partial release, cold observations, delayed acceptance, start/checkpoint acknowledgement loss, and release-deadline recovery. These tests use local fixture ports/SQLite; they do not prove current cloud native behavior.

The existing paid-call-free native drivers, which must run serially in an exclusive Docker window, are:

```sh
# Deterministic provider transport; ten saved Turns, Session switch before Turn 6.
RIFFOLOGY_DOCKER_SOCKET=unix:///absolute/path/docker.sock \
  node scripts/m2/check-runtime-reuse-local.mjs --run-ten-turns

# Disabled provider: lazy Project-tool zero-start, corrupt source, queued cancellation,
# deliberate container loss, exact checkpoint reopening. This is not successful real chat.
RIFFOLOGY_DOCKER_SOCKET=unix:///absolute/path/docker.sock \
  node scripts/m2/check-product-turn-local.mjs --lazy

# Deterministic native CRUD and restoration, not a latency comparison.
RIFFOLOGY_DOCKER_SOCKET=unix:///absolute/path/docker.sock \
  node scripts/m2/check-product-turn-local.mjs --lazy --crud
```

The reuse driver accepts only `--run-ten-turns`; image, count, guard and native bypass flags are rejected. It builds the production Project image and a Pi image whose release/model transport is replaced by the deterministic fixture, probes actual `pidfd_open`, requires at least 3 GiB Docker engine memory, observes UID 10002 PID/start-tick identities, and requires one physical Project/Pi pair, epochs 1–10, R2 archive/Session hashes, all three closed ledgers and normal retirement within an eight-minute wait. It performs 21 tool operations on Turn 1 and four reads on each remaining Turn: **57 tool operations**, normally **20 in-process fixture completions and zero paid upstream requests**. Fixture completions are not production provider usage proof.

A native x86 Linux kernel supporting production pidfd/seccomp supervision is required. The translated-arm `--vertical-project` option on the other driver is diagnostic and cannot substitute for production native reuse. Neither can G3's separately labeled ARM test bridge. These scripts currently hardcode `/opt/homebrew/bin/docker`; execution on a Linux host such as AMD128 needs a reviewed launcher/CLI portability change before presenting the existing command as directly runnable there. The absolute socket path above is an input example, not a configured resource.

The cloud ten-Turn runner is `scripts/m3/issues-controlled-release-acceptance.mjs`. It changes the shared release and gate and therefore is **not run during preparation**. Its explicit invocation requires `--execute`, `--worker-sha=<frozen 40-hex SHA>`, `--auth-input=<private JSON>`, the private secrets file(s), optional private opencode auth and a new output path. The auth JSON must bind the runner's fixed control origin, actual workspace and Session IDs, and a private signed cookie. The runner already preserves unknown submission intent, nonce write/read order, ten distinct saved revisions, Files/Diff refresh, final inventory and gate-close reconciliation. It is currently one Session and does **not** collect warm lease epochs, physical pair IDs or Pi PID/start-tick identities. Do not claim #37 acceptance merely from its `ten-turns.json`.

## Proposed bounded live scenario

Keep source, release tag, provider/model, per-call limits, task text and images identical across cold/warm/recovery windows. Exclude project provisioning and account setup from timed Turn windows, but record them separately. Use task-owned projects under two actual tenant identities and an explicit capacity-one window. Each mutation has one persisted client intent key; an unknown acknowledgement is reconciled against durable state before any new submission.

| Window | Accepted Turn submissions | Required behavior and measured identities |
| --- | ---: | --- |
| Ten-Turn warm chain | 10 | Turn 1 prepares a pair; Turns 2–10 reuse it. New Session before Turn 6. Each Turn gets new turn/dispatch/token/PID-start identity and monotonic binding epoch, while pair/physical IDs stay unchanged. Every checkpoint and all three ledgers match the Turn. |
| Pure conversation | 1 | On a ready blank project, ask for a finite greeting with no tools. Successful real LLM response and saved Session/Revision; zero ProjectToolSandbox preparation/restore/freeze/start calls in this Turn window. Prior ProjectRuntime provisioning is separately counted, not erased. |
| Cold control | 2 | Identical nonce write-then-read task in a separate cold-profile run, lazy gate unchanged. Distinct Project/Pi environments and exact saves. Compare stage timings only after both task outcomes qualify. |
| Idle recovery | 1 | After a recorded warm idle state, wait beyond 60 seconds and observe real retirement/guard release; submit only after authoritative admission permits. Restore the frozen saved archive/Session into a new pair and verify its hashes. No user page should be necessary to drive maintenance. |
| Cancellation | 3 | One queued Turn cancelled before dispatch (zero new upstream/native execution); one active Turn cancelled after a confirmed start; one explicit continuation after stop/guard completion. A late tool/start reply must not reopen admission or change the saved head. |
| Container loss | 2 | Remove only the identified task-owned active container after persisting its execution intent; retain the interrupted/unknown record and its actual checkpoint outcome. One new explicit Turn recovers from the authoritative frozen base after cold drain. Never replay an unknown tool mutation. |
| Low-capacity fairness | 2 | A owns a sealed idle pair; B's queued request causes A retirement. Include both cold and warm request types in recorded FIFO order, with two tenant scopes. B cannot start until both domain guards release; A cannot bypass B by resubmitting. |
| Cold fallback | 1 | After a bounded gate/version retirement has released the old pair, submit one explicit cold-profile Turn. Saved results/identity remain correct; old exact binding reconciliation remains available. The overlay and gate changes are controlled by the main agent. |
| Total | **22** | **21 may execute**, plus one explicitly queued never-started cancellation. Failed/unknown active cancellation or loss are preserved, not counted as qualified task successes. |

Use a nonce file task requiring a successful write, then a successful read, then the nonce in the final response. A minimal sequential provider/tool loop normally needs three upstream completions per tool Turn; pure chat normally needs one. For the proposal above, that gives a planning target of **61 upstream requests**, not a contractual count or an observed result. The selected configuration currently permits up to eight dispatched calls and 532,480 reserved tokens per Turn. Its conservative 21-executing-Turn bounds are therefore **168 dispatched calls and 11,182,080 reserved tokens**. The queued cancellation must consume zero dispatches. Inspect reservation attempts and missing/unknown usage independently; do not infer actual cost from reserved tokens or assume that a cancelled upstream request was refunded.

Before execution, freeze an account-specific money ceiling and current provider price/data/logging evidence with #46's owner. The target task loop is a readiness estimate; lowering the release to three calls requires a separately reviewed budget overlay and may reject legitimate model behavior. No monetary amount is invented here. Stop the window on an unknown ledger, identity conflict, exhausted budget or release uncertainty, preserve the first failure and reconcile cleanup without new model requests.

## Evidence and remaining automation gaps

For every window retain the actual Worker ID/version/100-percent deployment/tag, profile and gate readbacks; immutable app/image identities; tenant/project/workspace/generation; Session/Turn/dispatch; Workspace lease/leaseEpoch/runtimeVersion; bindingEpoch; native UID/token/PID/startTicks; R2 manifest/object keys and hashes; three ledger identities and operation counts; paired FIFO/lease rows; both domain destroy/absence/guard proofs; monotonic per-process operation samples and raw failure records. Secrets and Session archives stay private. A public summary keeps only required hashes/identities and `SHA256SUMS`.

There is no current executable single driver for this complete scenario. The required gaps are: real completed no-tool chat; controlled same-task cold/warm timing; real idle-expiry/alarm recovery; active cancel and container-loss during warm execution; low-capacity competing cold/warm tenants with physical release proof; warm-gate rollback/cold fallback; and production native/ledger/capacity observations attached to the existing cloud ten-Turn record. Unit coverage already exists for several failure boundaries, but it does not cover those current live windows. The production gate/version overlay and current resource/account inputs are also absent.

Final acceptance compares UI/event state with exact persisted sources and ledgers, independently rereads cloud instances and capacity, preserves all unknown/failed runs and proves normal release before removing test resources. Ten qualified Turns establish this bounded scenario only; they do not establish a long-term SLO, production latency improvement, model quality or #46 closure.
