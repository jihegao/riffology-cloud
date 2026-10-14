# PR173 isolated offline repair and review

October 10 integration note: this document records frozen v2 history. Its drain/inventory and restoration table is superseded by [the current offline adapter contract](riffoid-validation-offline-adapter-20261009.md) and [integration evidence](evidence/riffoid-offline-integration-20261010/summary.json). The current coordinator accepts application-scope terminal receipts only and rejects restoration while both decisions are pending. Historical review failures below remain evidence, not current production approval.

This repair is made in an independent `/tmp` copy of the exact local code
snapshot. `SOURCE-SNAPSHOT.json` records every copied file hash, the source path,
and source HEAD. The source checkout, branch, index and private preparation files
are not modified. No software is installed, no push or production operation is
performed. This document and the fixture receipts are not production evidence.

The previous local PR publication receipt records head
`29e4ed6e45282c856ee2678d0fd2a27d66ffd8d2`, with the source checkout deliberately
left at `a2dc861`. That is historical local provenance, not a fresh GitHub read.
At 22:13 UTC the parent received the original task's stopped/not-deployed report:
production writes zero, no deployment/signature test sent, countdown not started.
Its final hanging pure source-hash call was interrupted without an executor
termination receipt; that script had no `cloudflare.request`. This is a relayed
task report, not a fresh production read. This repair remains isolated; source
hash comparison and review are still required before any later integration.

## Runtime change

`validationEntry` checks the native-boundary marker before sending `begin`.
Missing/wrong marker returns `503 validation_not_ready` without consuming the
durable lease, forwarding a request, or touching the signing key. `observe`
continues to work without that marker or a signing key. The UI's Run control is
not an authority: the server guard is effective even for an early click.

The maximum config interval is 300 seconds, matching the recorded approval
ceiling; the actual frozen interval cannot be extended or moved during the run.
Proof lifetime remains 30 seconds; invocation/fetch/RPC limits remain 45/5/2
seconds. No real signing clock is replaced. Budgets remain three new proofs,
two primary accepts, four verifier calls, two observations, two begins, eight
normal outgoing protocol requests and at most one planned cleanup request.
As in the original implementation, denied/concurrent ingress is not an aggregate
HTTP hard cap. No resources, credentials, namespace, run rotation or fallback
are introduced.

## Offline package and receipt tool

`scripts/m1/riffoid-validation-coordinator.mjs` has no network or publisher adapter.
Its default CLI verifies supplied module byte counts/hashes and derives complete
metadata plus module inventories for review. It never executes these packages.
Its `--audit` CLI replays a supplied receipt journal and reports consistency only.
It cannot authenticate supplied receipts or turn fixture receipts into evidence.

Inputs require both complete, independently captured baselines, original code
inventories and reviewed validation inventories. Plaintext Secret payloads are
rejected; existing Secret references are preserved. Every phase preserves the
original DO identities, exports, containers, compatibility settings and other
metadata, except the explicitly derived topology/config/marker/log changes.
Final restoration derives from the complete original metadata, never a partial
settings PATCH or lifecycle rollback. Actual source-bound production inputs are
not included: sensitive local preparation records were not copied into this repair.

| Phase | Allowed change / required evidence |
| --- | --- |
| `gatewayObserve`, then `entryObserve` | Fixed run/time/IP config and validation code; ordinary HTTP fenced, marker absent, both log sinks remain `persist=false`; independent complete state/pipeline readbacks |
| Native A/B observations | Two fixed successful observe receipts, same config; no signature is minted |
| `entryReady` | Add marker only after both observations, preserve the same config; independent complete marker/state readback |
| Operator cue and single A/B batch | Native browser actions; original lease/mask enforces per-slot single use; unknown result means no retry |
| `entryStop` before expiry, or hard expiry | Stop **new signing**; retain temporary code/config and cleanup route; ordinary HTTP stays closed and logs stay private |
| Cleanup, then drain | One existing A cleanup after expiry; positive authorized read-only inventory establishes terminal original invocations, no unknown/active validation work and runtime release |
| `gatewayRestorePrivacy`, `entryRestorePrivacy` | Exact original modules/config, entry disabled, original Gateway origin and resources; keep `persist=false`, independently verify |
| `gatewayRestoreLogs`, `entryRestoreLogs` | Only after cleanup/drain and exact privacy-stage restoration readbacks, restore original `persist=true` and independently verify |

The `entryStop` package removes the marker while retaining signed-entry topology
and temporary config. Setting mode to disabled or deleting config at that point
would break the existing cleanup route. Removing a marker does not cancel an
already running invocation. A clock deadline establishes neither physical cleanup
nor remote drain, so it cannot authorize log restoration.

Readback receipts bind the original request ID, prior version/deployment, derived
metadata/module hashes, exact new version/deployment, full-state match, quiet
publisher and pipeline guard. Unknown write/cleanup results freeze that original
request identity. Read-only reconciliation must be completed outside this offline
tool; it has no retry or recovery path that substitutes a new request/run.

The independent static review identified two P2 consistency defects, reproduced
by failing offline fixtures before repair. The journal now records nondecreasing
event time and marker/cue/stop/cleanup/drain/private-restore/log-restore times.
A Run's declared start cannot precede the marker or operator cue. Publication
receipts require `startedAt` and `readbackAt`: the write must begin after its
prerequisite evidence, the readback cannot precede that write or be in the future,
and the next Worker write cannot precede the previous Worker's readback. Thus a
late-delivered receipt cannot hide a restore initiated before drain, or logs
restoration initiated before private restoration. These are consistency checks
on declared UTC epoch milliseconds; authenticity still requires the missing adapter.

Baseline complete metadata/module-inventory hashes seed a per-Worker immutable
version-to-content and deployment-to-version ledger. Every seen version must keep
both hashes; every seen deployment must keep its version. Reusing a baseline UUID
while declaring changed contents is rejected. Consistent identity reuse is not
blanket-rejected, but does not authorize lifecycle rollback or any production
operation. The whole packet hash is frozen into initial journal state, so a
baseline or phase template cannot be replaced during replay. Earlier journal
receipts lacking the new publication timestamps are rejected rather than guessed.

## Fixed 300-second schedule and failure branches

Both observation-stage packages may be prepared and published before the chosen
`notBefore`, with their complete independent readbacks. UI/observe/signing are
not usable before `notBefore`. There is no circular dependency: observation code
is installed without marker; actual observations precede marker publication.

| Relative time | Required operation / cutoff |
| --- | --- |
| Before t0 | Exact packages, baselines, authorization, quiet publisher and pipeline guards ready; initial deployments/readbacks completed |
| t0 through t0+180s | A/B observations and marker publication/readback; a late marker means stop, not a new config |
| Before t0+225s | Operator's bounded ready cue; do not rely on an unbounded parent/agent chat roundtrip |
| Before t0+255s / t0+290s | A / B actual start; runtime requires at least 45s / 10s remaining |
| t0+300s | Config rejects new protocol activity; ordinary business remains fenced |
| t0+300s through t0+330s | Existing A cleanup route's separate 30-second safety interval; exactly one planned attempt, no retry |
| After positive cleanup/drain | Guarded original code/config restoration with private logs, followed by original log persistence and independent readbacks |

The 300 seconds bound the protocol admission interval. They do not promise that
deployment APIs, drain verification or restoration finish within 300 seconds.
If the approval's ceiling is meant to include the entire log-pause/maintenance
duration rather than protocol admission, this exact packet is not ready for use:
the parent must resolve that interpretation before a production window.

The local state validator enforces the earlier 180/225-second readiness cutoffs,
unchanged run/time hashes and fail-closed progression. It is not a running watchdog.
Actual deadline supervision needs an explicitly reviewed production adapter and
an available operator. Missing those capabilities means pending, not success.

## Acceptance and remaining gaps

Offline acceptance covers marker-before-begin, observations without marker,
unchanged request/proof budgets, complete derived metadata preservation, fixed
time/run, stale readbacks, late cue, duplicate batch, missing/unknown cleanup or
drain, privacy-before-logs ordering, and code hash drift. Workerd uses only local
runtime/SQLite, fixture native-header adapters and ephemeral fixture keys; external
outbound is rejected. Real proof expiry and real replay verification are retained.

Remaining production blockers are concrete:

1. The parent's stopped report resolves the earlier unknown production-write
   concern, but does not substitute for current production guards or the missing
   executor termination receipt. This patch remains isolated and unintegrated.
2. Exact current production baseline inputs and final timestamp-derived packages
   need review. This tool provides derivation, not an authenticated multipart
   uploader or an independent Cloudflare readback adapter.
3. Both real browsers must have an available bounded operator cue. Current UI
   cleanup is still an explicit A action in the +30-second interval. Page closure,
   sleep, lost connectivity or a delayed chat can miss it; this repair does not
   claim to guarantee that action or add automatic HTTP requests.
4. An existing authorized, semantically read-only, authoritative validation
   invocation inventory/drain source has not been established. Browser receipts,
   `AbortController`, expiry and fixture assertions are not substitutes. Do not
   add a diagnostic resource/RPC or silently restore logs to resolve this gap.

If cleanup/drain or a restore readback remains unknown, preserve the closed
ingress/privacy restriction, retain history and original request identity, and
report pending recovery. Do not say that expiry itself restored the service.
