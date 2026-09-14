# ADR 0006: Lazy Project Sandbox and same-Workspace runtime leases

Status: Proposed implementation contract, 2026-09-14. Preparation for [#37](https://github.com/jihegao/riffology-cloud/issues/37); no runtime change, deployment, feature enablement or performance acceptance is delivered by this ADR. Implementation follows the research loop (#29 → #30/#33 → #31 → #32) and its review gates.

Code baseline: `d5d53de1a4ceebd128b2e887ad0378e9ee962215`. This supplements [ADR 0005](0005-m2-runtime-topology.md); the trusted Pi/project execution boundary remains mandatory. Phase 1's signed source and measurements are older, separately identified below.

## Current constraints and decision

`WorkspacePreparedExecutionPort.start()` in `services/turn-runtime/workspace.ts` restores the Project Sandbox before starting Pi. `ProductTurnSnapshotPort.freeze()` subsequently requests project files even when the conversation made no project changes. `IdentityBoundTrustedPiSandbox` in `services/turn-runtime/release.ts` and `sandboxActorIds()` bind resources to the immutable Turn/dispatch. `TurnSandboxFence` in `services/sandbox/turn-fence.ts` persists a single dispatch and a monotonic fence; it deliberately cannot be reset for a different Turn. Replacing actor IDs alone would invalidate this authorization and stop protocol.

Revision manifests are already **schema v3**, with scoped content-addressed files and Session blobs (`services/turn-runtime/revision.ts`). ADR 0005's historical v2 description is not the current schema. `RevisionStore` serializes commit and GC and retains uncertain commit operations; `revision-gc.ts` traces direct v3 manifest references. These are the foundation for unchanged-file saves, not a reason to introduce mutable parent-directory pointers.

Deliver two independently gated changes:

1. **B: lazy Project preparation**, retaining per-Turn runtime identity and the existing cold Trusted Pi path. Pure discussion never creates, restores, freezes or destroys a Project Sandbox. Session and new Revision commit remain durable.
2. **C: same-Workspace environment retention**, after B and the new supervisor/capacity protocol pass review. Pi remains a fresh subprocess each Turn. Environment retention is an optimization over durable state, never a new source of truth.

Keep cold execution available. Reject cross-tenant pools, a shared mutable Pi process, longer capability lifetimes, removal of release guards, and using container backup/disk as the only saved version. Compared with a shared pool, same-Workspace retention avoids cross-tenant cleanup and ownership transfer; it still requires real process fencing and scheduling work.

## B: lazy preparation and immutable save

Add an internal `ensureProject(identity, base, operationId)` operation to ProductTurnRuntime's persisted execution state. It records `unrequested`, `reserved`, `ready`, `unknown` or `closed`, the server-derived actor ID, fixed base digest, operation ID and preparation receipt. There is exactly one preparation operation per dispatch. Existing rows decode as legacy eager mode; they finish under that protocol.

- Pi startup verifies the frozen Workspace/Session bases from durable storage but does not resolve the Project actor. Missing/corrupt bases still fail closed before execution. Initial projects use the existing verified initial archive resolver.
- Tool Bridge performs existing scope/capability/command-ledger checks before asking for preparation. An authorized project tool joins the same persisted preparation operation. No ledger terminal replay, historical read, cleanup, cancellation or observer lookup may request preparation.
- Persist preparation intent before native work. Concurrent tools coalesce; a DO restart reads the same operation. The Project actor observes its original restore marker and immutable base digest to resolve an unknown response. An unresolved native start/restore never authorizes a second actor or a second command. Expiry enters reconciliation/cleanup, not replay.
- Cancellation closes preparation admission atomically. If nothing was requested, cleanup records `not-created` without resolving a Sandbox. If preparation may have started, reconcile that original actor, fence it and retain release uncertainty until confirmed. Race tests must cover a preparation RPC arriving after cancellation.
- Every actual project tool uses the prepared actor. Initially classify **any dispatched project tool** as requiring a frozen filesystem snapshot, including reads: project processes may have affected state and tool names are not a reliable no-write proof. Only `unrequested` plus no possible writer qualifies for unchanged-file save.

For an unchanged-file save, obtain the file archive from the verified durable base through `R2TurnRevisionReader.files()` (or the initial resolver), and freeze only the trusted Session. The initial B implementation can pass these bytes through the existing snapshot/RevisionStore APIs: it avoids native project operations while retaining existing staging limits and hash readback. A new v3 manifest references the same scoped files blob and the new Session blob. This may still read/verify archive bytes and attempt an immutable conditional put; it is not zero-I/O saving.

Do not add a manifest parent-reference schema in B. A later reference-only staging optimization must accept only a server-resolved `{objectKey, sha256, size}` from the frozen base, verify it inside RevisionStore's serialized commit boundary, and preserve the same v3 manifest shape. It is not required for B acceptance.

GC must continue marking the files key from **every** committed manifest, including old Revisions and unchanged-file descendants. Pending commits remain mutually exclusive with GC in the same RevisionStore shard. If future manifest deletion is introduced, exported/frozen-version references must become explicit GC roots before enabling deletion. Do not derive reachability only from the latest Workspace head. Files, Diff, result reads and exports resolve committed manifests/blobs without runtime leases. A missing parent archive is a restore/save failure, never an empty replacement.

## C: identities, handoff and release

Use WorkspaceAgent as the only lease owner and project-writer arbiter; persist lease state beside its current Turn state and include lease deadlines in its existing minimum-deadline alarm calculation. ProductTurnRuntime remains the per-execution coordinator. Do not repurpose the existing Turn capacity `leaseId` as a reusable runtime identity.

| Identity | Frozen fields and owner |
| --- | --- |
| Runtime lease | `tenantId`, `projectId`, `workspaceId`, `workspaceGeneration`, role (`trusted-pi` or `project`), monotonic `leaseGeneration`, pinned `runtimeVersion` (reviewed image/release digest). WorkspaceAgent allocates it; role separates actors. |
| Execution | Existing complete `TurnRuntimeIdentity`, including `sessionId`, `turnId`, `dispatchId` and generation; immutable for the lifetime of that execution. |
| Binding | Lease identity plus monotonic `bindingEpoch`, execution identity, frozen Workspace/Session base receipts, deadline and budget-policy identity. Persisted before native binding. |
| Native operation | Binding plus existing immutable command/call operation ID and digest. Every supervisor write, model/tool authorization, receipt and observer request validates it. |

Actor names for C derive only from the complete lease identity, never browser or Pi fields. Do not overload the legacy actor-name parser: add an explicit lease protocol version and keep the old namespace. New private RPCs carry both lease and execution identities. The Tool Bridge resolves a lease only from the authoritative binding; capability validation and Trusted Pi outbound authentication bind the actual actor plus binding epoch and complete execution. Stable Turn model-budget accounting and existing command/call idempotency remain unchanged. Old capabilities cannot be accepted merely because their expiry has not passed.

Lease states are `allocating → bound → draining → idle → bound`, with `quarantined → releasing → released` from uncertain or unusable states. Persist operations and observations independently; `saved`, `writersStopped`, `reusable` and `allocationReleased` are separate receipts. Retained environments continue occupying capacity.

A handoff must perform this sequence:

1. Atomically close old command/model admission and increment the fence for its binding. Drain already admitted operations; keep late-result tombstones and reject receipts for the next binding. Unknown admitted operations prevent reuse.
2. A trusted supervisor proves the old execution's entire process group/cgroup and project writers are stopped and all admitted native operations settled. Parent process exit, terminal JSON, capability expiry and elapsed lease time are insufficient. A native process-tree isolation primitive must be verified in the actual image before C can be enabled; if unavailable, destroy the environment and retain the cold path.
3. Freeze project files and trusted Session under that binding; reconcile the original checkpoint commit until it is known saved or conclusively abandoned. Do not hand off during `checkpoint_pending` or checkpoint unknown.
4. On a saved checkpoint, retain only a workspace directory verified against the authoritative new files digest. Before the next bind, clear prior Turn control/output files and trusted Session working files; restore the next execution's own Session explicitly, including when switching Sessions. Recheck the files digest after quiescence. No old execution may still hold a write-capable descriptor into the next directory.
5. Cancelled/failed/abandoned execution is never eligible to retain mutable project state for the next Turn. Destroy its environments and restore the next accepted Turn from the authoritative saved head. Historical failure Revisions remain readable; they do not silently become a healthy warm baseline.
6. Bind the next execution only with a new epoch and fresh authorization. Changed Workspace generation, image/release digest, missing files, corrupted markers or unexpected processes require quarantine and cold restore. An idle lease with unknown health is not an available lease.

Retiring an environment invokes the existing idempotent destruction and external assignment-release reconciliation. Keep #21's independent stopped/absent observation, guard timing and releaseHold semantics. A same-lease handoff has a **handoff receipt**, not a `runtime-released` proof; existing capacity code must reject substitution. An expired lease is quarantined until stop/release is proved. Never clear an unknown hold to make the UI progress.

## Capacity, rollout and failure policy

Current `services/capacity/core.ts` is a single-slot Trusted Pi admission ledger with Turn-specific tickets; it cannot represent retained environments or paired reservations. Before enabling C, extend the existing capacity service with versioned runtime-allocation rows and distinct execution tickets, without deleting legacy rows or their release proofs.

Use conservative **paired reservation before native allocation**: one Trusted Pi slot plus one Project Tools slot reserved atomically for an admitted Turn in the existing capacity coordinator. Reserving a Project slot does not create a Project Sandbox; B's zero-creation criterion still holds. Reservation capacities must match the actual managed applications, and every consumer of either application must participate. Independently funded Run/Service applications retain their own ledgers; no blanket claim that their quota covers Project Tools.

This sacrifices some discussion-only concurrency to avoid a Pi-holds-slot/waits-for-project cycle. Admission never starts Pi while waiting for its second reservation. A persisted partial external reservation is released without native work and reconciled before trying the same admission again; no in-memory semaphore or cross-DO assumed transaction is allowed. Shared-ledger ownership of the two application counters is an enablement requirement.

Keep FIFO execution tickets. An idle retained pair can be reassigned only to its own Workspace and only when no older eligible ticket from another Workspace waits. Otherwise immediately retire the idle pair, preserve release guards, and admit the oldest ticket after actual release. Do not preempt an active execution or count a separately running Service as idle. At most one retained pair per Workspace. Set initial candidate idle retention to **60 seconds**, configurable by deployment policy; this is a test default, not a latency target. Deadline expiry or capacity pressure can shorten retention. If physical release stays unknown, the queue must show the existing wait reason and use its existing bounded cancellation/failure policy; safety does not imply a guaranteed hardware-release deadline.

Add exact-string default-off gates `M2_LAZY_PROJECT_ENABLED` and `M2_WORKSPACE_RUNTIME_REUSE_ENABLED`; reuse requires lazy mode and reviewed compatible supervisor/capacity versions. Persist the selected protocol with each dispatch/lease. A gate change affects new admission only: active or uncertain old operations finish/reconcile with their selected protocol. Turning gates off retires idle leases, drains active leases and continues cold admission only when actual capacity allows. It must not reissue an unknown model/tool request or discard operation records. No browser feature flag grants execution authority.

Implementation/review batches: B persistence and preparation → B unchanged-file save/GC compatibility → B local acceptance → C identity/capability/supervisor → C capacity and lease handoff → C failure injection → separately authorized bounded cloud validation. Review each batch independently. No live gate changes, paid calls or deployments are authorized by this ADR preparation.

## Measurement baseline and acceptance

The [Phase 1 user-preview record](../phase1-user-preview-acceptance.md) records deployed source `2c464df88286506a37b1f84139600286bdfc8b48` and two ordinary-user smoke Turns after cleanup. These are historical selected samples, not measurements of this ADR or current production:

| Sample | Queued | Preparing | Executing | Saving | Sum of recorded stages |
| --- | ---: | ---: | ---: | ---: | ---: |
| `191005b8…` | 129 ms | 21,058 ms | 20,645 ms | 145 ms | 41,977 ms |
| `b1c54d19…` | 317,047 ms | 31,438 ms | 20,490 ms | 179 ms | 369,154 ms |

Second-sample queuing is 85.9% of that recorded stage sum, and the record attributes the wait to the preceding assignment-release guard. Preparing does **not** isolate container cold start: it includes other preparation/restoration. The two samples do not measure reusable environments, expose startup subspans, prove a latency SLO or explain the separate first-open Preview 503. The same record's 25.3-second retained-history recovery is a browser read/replay sample, not runtime startup. Report these limitations with any performance comparison.

Extend `services/turn/operation-telemetry.ts` with bounded enum stages/reasons for accepted, queue exit, native create/start, application ready, Session restore, file restore, first model event, first tool event, project preparation, writer stop, snapshot, checkpoint acknowledgement, handoff and external release. Keep operation IDs for deduplication in restricted evidence; aggregate metrics must not include messages, filenames, secrets or free-form tenant labels. Record missing spans as unavailable. Use monotonic durations inside a process and correlated wall-clock events between actors; do not subtract unrelated clocks as precise timings.

For each Turn record protocol, cold/retained/idle-recovery classification, resource create/destroy counts by role, restored bytes, occupied/reserved milliseconds and disposition. Preserve failures, queue waits and incomplete runs in denominators. Collect matched baseline/B/C sequences under identical image, model, resource limits, model input size and seed/tool workload. Report sample count, all raw stage records, median/range initially, and quantiles only with sufficient samples. Cost estimates use observed resource time and separately verified billing rates; reservation time is reported separately from actual billed runtime. Product latency targets remain to be selected after this baseline; no fabricated numeric target blocks the research loop.

Required validation before enabling the respective feature:

- Pure discussion, including initial base, saved base, failure before tools and cancel before first tool: zero Project native create/restore/freeze/destroy; new Session/Revision persists and files digest stays fixed. Viewing old Files/Diff/results/export causes no native start.
- Concurrent first tools, lost preparation response, DO reconstruction, cancellation before/after dispatch and late restore: one original preparation and no duplicate command/model effect; missing/corrupt or wrong-scope bases fail closed.
- Shared files blob across multiple v3 Revisions: restore/export all versions; GC during commit/unknown commit, orphan staging, restart during GC, and initial-base conversion retain required blobs and do not cross Workspace scope.
- C clean ten-Turn sequence within retention, with a project tool each Turn: one environment per role absent failures/version changes, fresh Pi subprocesses and authorization per Turn, ten distinct durable Session/Revision records, no full file restore after the first verified baseline. Verify counters against independent inventory, not actor names alone.
- C adversarial handoff: surviving child process, detached writer, delayed native RPC, old epoch/capability, delayed result, nonzero exit, cancel/completion race, checkpoint unknown, image change and Session switch. Unsafe cases quarantine/destroy, preserve original unknown operations and recover only from saved state.
- Low capacity with two Workspaces, continuously queued work, idle expiry and a running Service: older eligible work is not starved by warm reacquisition, resource counters include retained/unknown allocations, no acquisition cycle, and guard release is never bypassed. Missing stop evidence yields explicit unresolved state rather than a false bounded-success claim.
- Feature rollback during ready/active/draining/unknown states and worker restart preserve protocol selection and tombstones. Existing cold path and #21 release tests still pass. Run relevant suites per batch and complete `npm run check` for the integrated candidate.

Cloud acceptance remains pending: reviewer approval of this protocol, actual supervisor isolation proof, same-configuration measurements and separately authorized bounded real runs are required before enabling reuse. This ADR completes design preparation only; it does not close #37.
