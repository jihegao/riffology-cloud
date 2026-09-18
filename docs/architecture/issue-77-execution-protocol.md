# ADR: execution bindings, recovery, and candidate evidence (#77)

Status: local implementation, offline verification; production routing remains Pi.
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
| Managed resources | remote deletion receipt | pending → remote-deleted only with matching reference; never produces a local native fence or settles usage |

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

| Capability | Pi | Managed offline adapter |
| --- | --- | --- |
| Default product runtime | yes | no; `selectProductBackend` rejects Managed |
| Native process stop/fence | existing native adapter | unsupported, always null |
| Create / continue | existing native adapter | injected synthetic transport; continuation requires same scoped Session and a terminal predecessor |
| Unknown recovery | existing original-identity observe | lookupOriginal / retrieve; never newest-Turn heuristics or resubmission |
| Cancel | existing durable Stop intent | request then retrieve original Turn; natural completion can win |
| Complete portable session restore | Pi session bytes | unsupported; remote reference is not a snapshot |
| Candidate file export/import | existing workspace snapshot | bounded canonical USTAR + per-file hashes, existing RevisionStore publication |
| UI events | existing Pi events | documented text delta/done mapping; unrecognized tool/Skill observations become visibility unknown |
| Usage completeness | not guaranteed by this protocol | missing/invalid remains unknown |
| Deletion | Pi process/resource release authorities | remote receipt only; no assertion about retention policy beyond that receipt |
| Automatic cross-backend failover | disabled | disabled |

`OfflineManagedAdapter` intentionally does not implement `TurnExecutionPort`:
that port's terminal contract requires a **native** stop fence. Casting a remote
terminal or delete response into it would invent evidence. The offline adapter
returns a versioned observation with independent execution, usage, checkpoint,
acceptance, and resource dimensions. No production assembly imports it. A live
SDK/HTTP transport and a remote-termination product contract remain prerequisites
for an internal route, to be reviewed before Phase 5; no credentials are needed
or consumed by the offline tests.

The public API shapes were checked against official documentation on 2026-09-18:
[session create/continue/cancel](https://developers.openai.com/api/docs/guides/agents-api/sessions)
and [events/items and recovery](https://developers.openai.com/api/docs/guides/agents-api/sessions/events).
The injected transport is a **normalized offline boundary**, not a claim that a
live SDK client or provider idempotency guarantee has been validated. In
particular, a transport unable to correlate an unknown create must return
unknown; it cannot infer the original Turn from list order.

## Snapshot migration and rollback

New immutable manifests use schema 4 with explicit backend state. Pi preserves
its real session bytes and declares `full-session` with files/pi-session
capabilities. Managed stores a scoped remote-reference JSON blob as
`sessionState`, never as placeholder `piSession` bytes. The shared receipt's
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

Latest main already supplies the independent
`mesa-3.5.1-cpython-3.14.2/v1` server profile, with a pinned interpreter and wheel
hashes, six-package source lock, native isolation/resource/timeout checks and
Docker boundary tests. #77 reuses it unchanged. Tests accept that exact profile
and reject a partial/arbitrary Mesa lock; this is not a widened SimPy whitelist.
The native Docker acceptance is distinct from offline schema/oracle tests and
must be reported separately when the required local image is unavailable.

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
verification commands. Phase 5 has not been authorized or run. No paid-model
request, deployment, production cutover, live E2E acceptance or issue closure is
part of the offline evidence.

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
