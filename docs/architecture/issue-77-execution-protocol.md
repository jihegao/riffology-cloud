# ADR: execution bindings, recovery, and candidate evidence (#77)

Status: Pi remains the default. The project-scoped Managed product route is
implemented and locally verified. The first bounded production Turn was paid,
but unknown usage stopped further input and authenticated E2E did not pass.
The separately authorized production policy is documented in
`issue-77-live-acceptance.md`; authorization is not a passing execution record.
Original fault baseline: `40aee17`. Implementation rebased onto main
`08f7b727070a58484732fa56bdf7d7a448727db1` after safety checkpoint
`3f4bee9b3b8dd5211af669066dce8afd27a85b91`; cherry-pick `e7736aa`.
This ADR does not authorize a provider request, deployment, runtime switch,
settlement, or reopening an unknown/budget window.

## Authority and transitions

| Dimension | Authority / persisted record | Legal progress / timeout / visible result |
| --- | --- | --- |
| Identity and dispatch | Workspace TurnJournal, tenant/project/workspace/generation/session/turn/dispatch | queued → claimed once; replay uses the same dispatch; stale generation fails scope validation |
| Backend binding | Runtime SQLite `execution_bindings`, schema 1 | immutable backend + input digest, then append original remote references; one backend/remote Session per local session and generation; no input replay after reservation |
| Execution | ProductTurnRuntimeCore and backend observation | running/unknown → terminal only with adapter-appropriate evidence; existing Pi native fence remains mandatory; timeout uses existing original-identity fence/reconciliation |
| Events | TurnJournal `eventReceipts` and monotonic sequence | event ID + Turn identity + type + time + structurally equal JSON deduplicate; object member order is irrelevant, array order is significant; conflicts reject atomically |
| Checkpoint | RevisionStore prepare/commit/reconcile and immutable R2 | reserve → staged blobs → manifest/readback → Journal head CAS; ACK loss observes the existing operation; base mismatch never overwrites current files |
| Acceptance | formal Experiment/Evidence authorities | candidate → platform execution → validation; Agent completion or exported files alone cannot publish Evidence |
| Usage / billing | provider observation / existing ledger respectively | missing/invalid usage stays unknown; observed nonnegative integer totals remain settlement pending; this implementation never records a refund, zero substitute, or settled charge |
| Resources | existing Pi capacity/lease/retention authorities | stop requested ≠ fenced ≠ released; release-pending and recovery-hold keep their existing retry deadlines and block reuse |
| Managed resources | typed remote terminal receipt and separately persisted Session cleanup | a matching terminal observation releases the adapter input slot; the hosted Session remains retained for continuation until deletion/absence is confirmed; neither receipt produces a native fence or settles usage |

The new SQLite table contains adapter metadata, not another business Turn state
machine. Pi reserves its binding before native start. Managed's input-bearing
transport operation occurs only after the same durable reservation. Reopening
an adapter with the same store only observes that identity. A different backend
or input digest conflicts; a new Turn cannot bypass an unresolved local session
by creating another remote Session.

Pi's existing execution deadline, two-minute checkpoint recovery budget, native
Stop fence, release quiet period, resource leases, and alarms remain unchanged.
A checkpoint base conflict stays visible as `turn-checkpoint-base-conflict` and
leaves the current head intact. It requires resolving/reviewing that candidate;
retrying does not change its base or replay execution. An already committed
identical checkpoint remains idempotent even after newer work exists.

## Capability matrix

| Capability | Pi | Managed product route |
| --- | --- | --- |
| Default product runtime | yes | no; only an exact enabled project/user policy admits input |
| Native process stop/fence | existing native adapter | unsupported; dispatcher consumes a typed remote terminal proof instead |
| Create / continue | existing native adapter | SDK transport with durable reservation; same scoped Session and a terminal predecessor required |
| Unknown recovery | existing original-identity observe | original metadata/message correlation and retrieve; never newest-Turn heuristics or resubmission |
| Cancel | existing durable Stop intent | request then retrieve original Turn; natural completion can win; never-submitted cancellation persists a tombstone |
| Complete portable session restore | Pi session bytes | unsupported; remote reference and files-only state are not portable Session snapshots |
| Candidate file export/import | existing workspace snapshot | bounded artifact validation and canonical USTAR packaging, existing RevisionStore publication |
| UI events | existing Pi events | observable canonical text and usage; unobserved tool/Skill execution is not fabricated |
| Usage completeness | not guaranteed by this protocol | missing/invalid remains unknown; observed tokens do not settle billing |
| Resource release | Pi process/resource release authorities | terminal receipt releases input slot; retained Session deletion has separate confirmation |
| Automatic cross-backend failover | disabled | disabled |

`OfflineManagedAdapter` remains a synthetic transport contract fixture and does
not implement Pi's native-fence `TurnExecutionPort`. The production assembly uses
`ManagedProductRuntime` and explicitly typed backend receipts; it never casts
remote termination or deletion into a native fence. `ManagedSdkTransport` has
zero automatic SDK retries. Durable bindings precede input, and unresolved
execution, usage or cleanup blocks new paid input. Local Workerd tests exercise
the actual runtime and stores with a synthetic provider boundary; they consume
no provider credentials and do not prove a live provider outcome.

The public API shapes were checked against official documentation on 2026-09-18:
[session create/continue/cancel](https://developers.openai.com/api/docs/guides/agents-api/sessions)
and [events/items and recovery](https://developers.openai.com/api/docs/guides/agents-api/sessions/events).
The injected transport remains a **normalized offline boundary**. Separate
internal paid evidence exercises the SDK client; this does not prove a general
provider idempotency guarantee or production acceptance. A transport unable to
correlate an unknown create must return unknown; it cannot infer the original
Turn from list order.

## Snapshot migration and rollback

New immutable manifests use schema 4 with explicit backend state. Pi preserves
its real session bytes and declares `full-session` with files/pi-session
capabilities. Managed stores a scoped remote-reference JSON blob as
`sessionState`, never as placeholder `piSession` bytes. The production candidate
import uses typed `files-only` backend state; continuation consults the original
runtime binding rather than treating a Revision as a remote Session snapshot.
The shared receipt's
historical `sessionSha256` field hashes the actual state blob for either backend.

Readers support v3 and v4. A v3 manifest is interpreted as Pi without rewriting
its bytes or hash. Managed files are readable for inspection and formal
experiments; Pi `load` rejects a Managed session (`turn-revision-backend-mismatch`).
Staging, descriptor recovery, hash readback, and GC understand both formats.

Roll out readers/GC before accepting v4 writes. A writer-only rollback can use
`R2TurnRevisionPort(..., modelBucket, 3)` for new Pi revisions while preserving
v4 readers and existing manifests. **An old binary that understands only v3 is
not a supported rollback after v4 data exists.** Do not rewrite immutable
manifests, discard bindings, or move an unknown Turn to another backend. The
rollback test writes v3 after a v4 parent and reads both unchanged.

Recovery policies: Pi full-session restore; Managed original-reference observe;
files-only state proposes a separately authorized new execution; no files/state
means unrecoverable. An unavailable Managed Session never triggers an implicit
new Session or consumes a fresh budget.

## Candidate model and result boundary

`packageCandidateModel` combines explicitly provided model-spec v1, entrypoint,
and dependency lock with validated workspace paths. It does not infer a model
spec from arbitrary Python or invent a lock. `managedCandidateSnapshot` produces
an input for the existing RevisionStoreCheckpointPort. Immutable publication is
separate from Journal head advancement and formal Evidence acceptance.

Import profile v1 accepts uncompressed canonical USTAR only: <= 8 MiB archive,
<= 512 files, <= 1 MiB per file, complete file inventory, individual and archive
SHA-256. The existing archive reader rejects traversal, symlinks, duplicate
paths, control files, malformed headers and oversized entries. ZIP/gzip and
other formats are unsupported, not decompressed with unbounded expansion.
A provider ZIP therefore requires a separately validated conversion before this
import profile; a #73 ZIP cannot be directly submitted as an Experiment.

`result-oracle.ts` checks explicit uint32 seed, parameter ranges, actual update
count, all before/after metrics, row coverage, preserved result hashes, and
matching Revision/files/dependencies/platform execution receipt. Expected rows
must come from an independent oracle or trusted replay. Its result is
`validated-candidate`, not authoritative Evidence. The regression oracle is a
small deterministic counter; it proves these rejection checks, not the
correctness of every Mesa model or any #73 live result.

`command-evidence.ts` understands literal quoting, shell `-lc`, `cd` and
successful Python `&&` sequences with exact argv and cwd. Unsupported shell
control flow/expansion is `harness:unverifiable`; mismatched commands are
`harness:not-observed`, never a numerical fabrication finding. Actual default
changes compare parsed model specs, not source-text substrings.

Both validators are now used by the actual offline recorded-acceptance entrypoint
`scripts/issue77/verify-recorded-acceptance.mjs` (added in `badbfe1`), in addition
to their focused regression tests. It revalidates the preserved internal trial's
two candidates and twelve native receipts: parsed-spec default-only changes,
prior result bytes, exact row coverage, seed/parameters, actual trace update
counts and before/after metrics, archive/lock hashes and native control binding.
Its report is `docs/evidence/issue-77/recorded-acceptance.json`, with content
hashes distinguishing this later verifier from the deployed `7b12505` source.

The same acceptance entrypoint exercises combined-shell command recognition in
fixtures. The hosted trial exposes no command trace, so its actual command result
is unknown, not matched and not a numerical-fabrication finding. This does not
modify #73's neighboring evaluator or wire these helpers into production
Managed execution. Production authority remains the platform's independent
native Simulation Run and immutable, version-bound Experiment/Evidence
validation; Agent text, exported result JSON and browser Preview are candidates.

Latest main already supplies the independent
`mesa-3.5.1-cpython-3.14.2/v1` server profile, with a pinned interpreter and wheel
hashes, six-package source lock, native isolation/resource/timeout checks and
Docker boundary tests. #77 reuses it unchanged. Tests accept that exact profile
and reject a partial/arbitrary Mesa lock; this is not a widened SimPy whitelist.
The native Docker acceptance is distinct from offline schema/oracle tests and
must be reported separately when the required local image is unavailable. A new
live Mesa trial is conditional on claiming that path; the bounded stdlib FCFS
production acceptance does not require a paid Mesa run.

## Baseline and verification

Two current failures were reproduced at the baseline: runtime and journal
rejected identical nested JSON events after member-order changes. The new tests
first failed with `product-turn-runtime-event-conflict` and `turn-event-conflict`
and pass after the structural comparison fix. Changed values/timestamps still
fail. This is a specific replay correction, not a general reliability claim.

Historical lost-ACK, cancellation, checkpoint and cleanup reports are classified
as **existing regression coverage**, not newly reproduced production incidents.
The existing Pi suites verify lost start response/no second start, checkpoint
reconcile after reopen, stop race, unknown native start, release ACK loss and
stale identities. New tests cover binding reconstruction, usage unknown, remote
delete vs native fence, branch isolation, stale base CAS, typed snapshots, legacy
read/rollback, artifact validation and numeric oracles.

#73's report and evaluator currently exist in an uncommitted neighboring
worktree at the baseline commit. Evidence fingerprints record the local inputs;
this change does not publish those experiments, modify that worktree, reuse its
allowance, or present it as merged delivery. Its reported retain-current-runtime
decision is context only, not acceptance of this implementation.

See `docs/evidence/issue-77/` for source fingerprints, baseline results and
verification commands. The original offline evidence does not establish paid
execution, deployment, production cutover, authenticated E2E or issue closure.
The internal paid trial and the separately authorized production trial must be
reported independently; the former does not consume or reset the latter.

## Production integration follow-up (2026-09-18)

The preceding offline-only status is historical. The production candidate now
assembles ManagedProductRuntime behind an immutable project/user policy while
retaining TurnJournal as the sole business Turn/head authority. Dispatcher
accepts explicitly typed remote terminal proofs and never treats remote deletion
as a Pi native fence. A cancelled, provably unsubmitted input has a durable
no-input tombstone; prepared-but-unreserved original inputs can resume, while
reserved inputs reconcile only. Checkpoint ACK loss recovers the original
Revision and retained artifact bytes; concurrent fresh inputs cannot queue.

The additional trial limits, bootstrap scope and rollout/cleanup sequence are
frozen in `issue-77-live-acceptance.md`. Runtime restart, cancellation, unknown
usage, counter exhaustion, actor/policy substitution, cleanup response loss and
checkpoint response loss are covered by actual local Workerd tests. This
implementation status does not by itself assert deployment or live acceptance.

## Production acceptance record (stopped; E2E incomplete)

The additional production window submitted one paid Turn from source `7b12505`.
The durable stop `managed-execution-unknown` blocked further input. Subsequent
original-identity reconciliation observed execution completed, saved the candidate
checkpoint and confirmed remote Session deletion. Usage remains unknown/missing;
completion and deletion do not settle billing or authorize another input.

Workspace reconciliation exposed a separate late-accounting event timestamp
conflict that left the business Turn in checkpointing despite the runtime
checkpoint. The targeted closed-policy repair has now reconciled the original
Workspace Turn as completed/saved, with its original Revision and no active hold.
This recovered saved version is not an accepted formal Experiment. The model → native Experiment/Evidence → Preview/
Verify → continuation sequence did not pass and #77 is not complete.

The policy was closed in Worker version prefix `d3f40847`, from source `7b12505`.
The final closed repair version, its source, Workspace reconciliation outcome and
resource readbacks belong in
[`production-acceptance.json`](../evidence/issue-77/production-acceptance.json).
That record must distinguish the enabled trial, initial closure and later closed
repair; this ADR does not substitute an unverified repair-version value.

The bounded driver `scripts/issue77/production-acceptance.mjs` still defaults to
no-network preflight and requires explicit `--execute` plus frozen policy and
release checks. The stopped window is not reset by repair, cleanup or a new
worker version. Checkpoint conflicts and dropped-ACK tests remain local Workerd
fault-injection evidence, not production fault-injection claims.

Rollback closes new scoped admissions while preserving readers, bindings,
original-identity reconciliation and cleanup. It neither switches in-flight
Managed Turns to Pi nor changes global G5 gates. Native Simulation release
proofs, where applicable, and tenant quota inventory remain separate from remote
Session deletion. Unknown usage and unsettled billing remain visible after the
policy is closed.

Final original-identity recovery (2026-09-18): closed-policy Worker `ac0dd1f2-bce1-4b41-a25a-d7e811b9d0da`, source `9641f6546b099ad080ec00c2f7ba9e6b996a2fa7`, is independently confirmed at 100% traffic. Authenticated Workspace is completed/saved with no active Turn, release hold or recovery hold; model/files are readable. One unknown usage record and US$1 reservation remain, with zero live Sessions and no pending cleanup. No native Experiment, formal Evidence, Preview Verify or same-Session continuation was executed after the stop. See `docs/evidence/issue-77/production-acceptance.json` and `repair-validation.json`; issue #77 remains incomplete.


## PR #80 cleanup review corrections

Source `a0b6451` addresses the two cleanup/recovery review findings. Cleanup groups
Turns by the actual bound remote Session and requires every associated Turn to
have a terminal persistence receipt before deletion. The narrow exception is a
new durable `inputAttempted:false` record proving that model input was never
attempted; the flag is synced before an input POST and missing legacy fields do
not grant this exception. An artifact or RevisionStore outage therefore leaves
the remote source and cleanup pending, with new input still blocked. A permanent
storage outage may retain the Session until publication can recover; it is not
reported as successful cleanup.

Resource `closed` and `checkpointRecoveryPending` are independent. Alarms keep
recovering incomplete saved-state receipts even for legacy resource-closed rows.
A scope-verified, idle/failed Session deletion intent is persisted before DELETE,
including its original binding digest and verification time. DELETE ACK and
confirmed absence are recorded separately. Restart may GET the original bound
Session to establish 404 without first requiring another successful DELETE.
Other HTTP errors, changed scope or mismatched intent cannot establish absence.

Every Turn sharing a Session reuses its intent owner's original binding, even
if that owner was already closed by an older partial write. Final sibling closure
is one SQLite transaction. None of these resource proofs is a native fence,
usage settlement, refund, reservation reset or authorization for another input.
See `docs/evidence/issue-77/review-validation.json` for the source-bound offline
regression record. This code review revision does not update the previously
recorded production Worker or claim that the production E2E chain has passed.
