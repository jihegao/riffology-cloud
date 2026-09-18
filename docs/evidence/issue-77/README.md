# Issue 77 evidence: offline, internal paid and production acceptance

The safety checkpoint is `3f4bee9b3b8dd5211af669066dce8afd27a85b91` on
`codex/issue-77-safety-checkpoint`. It preserves the work made against `40aee17`.
The implementation was then cherry-picked onto main `08f7b72` as `e7736aa`, in
an independent worktree. The original worktree and its pre-existing documents
were left intact. This directory does not contain raw user sessions or credentials.

`baseline.json` records the two actually reproduced pre-fix failures.
`checkpoint.json` is a historical progress snapshot, not final acceptance.
`issue73-input-fingerprints.json` identifies local uncommitted context; it does
not turn that context into a released experiment. The final validation manifest
and SHA256SUMS distinguish the integrated source and verification results.

Reproduce current checks from the implementation worktree:

```sh
npm ci --ignore-scripts
mkdir -p .local
node services/browser-preview/runtime/prepare-assets.mjs
node scripts/m3/materialize-browser-preview-web.mjs
npm run check
node --test tests/m2/backend-shared-contract.test.ts
```

The `.local` directory is required by existing temporary-directory tests in
main. The first clean-worktree attempt failed with ENOENT before it was created;
this was an environment setup failure, not a waived assertion. The clean
worktree also needed the ignored Browser Preview bundles. Public upstream
assets were copied only after matching the committed inventory hashes; the
normal preparation/materialization scripts then verified the generated bundles
without changing the tracked manifests. M3 was rerun after this preparation.

For the specific before/after failure, create a disposable worktree at
`40aee17ed810430ee71fa4afb02af6fecf59b26a`, copy **only** the two test files from
the implementation into it, and run:

```sh
node --test --test-name-pattern='issue 77: reordered JSON|issue 77: journal replays' \
  tests/m2/product-turn-runtime.test.ts tests/m2/turn-journal.test.ts
```

That baseline rejects reordered JSON member keys. The same command against the
implementation passes. The baseline procedure must not replace runtime source
with the new code, or it would no longer be a before-test.

Managed tests use an injected synthetic transport, not the OpenAI service.
Its outputs are candidate observations with independent usage/save/acceptance
states. The real RevisionStore test runs in local Workerd with outbound access
disabled and verifies a Managed reference manifest without Pi placeholder data.
The shared Pi/Managed test runs both through the same TurnJournal receipt checks.

Formal Mesa execution uses latest main's pinned server profile. Schema tests
verify exact profile selection and arbitrary-lock rejection; native Docker
acceptance requires its explicit opt-in and image. Skipped Docker/live suites
must not be described as passing live execution.

At the original offline checkpoint, Phase 5 and production deployment had not
been authorized or run. The following live record supersedes only the internal
paid execution status; it does not establish production routing or close #77.

## 2026-09-18 live preflight

The original offline report is preserved as `offline-20260917.json`; verify its committed historical source with `node scripts/evidence/verify-issue77.mjs --historical`. `validation.json` binds integrated production source `7b12505` to 2,263 passed and 11 skipped tests. `repair-validation.json` separately binds the later `9641f65` recovery fix to 783 M2 tests, 107 focused tests and typecheck. Use `--committed` to verify the recorded source; this does not assert that the current worktree is identical to that historical full-check source. Authorization is distinct from execution: these are offline preflight results, not paid or production acceptance.

## 2026-09-18 authorized internal run and actual artifact acceptance

`live-acceptance.json` is separate from the offline preflight. The accepted
policy allowed at most two Sessions and six Turns in the original two-hour
window, with US$5 as an observation threshold rather than an enforceable cap.
Four paid Turns used both Sessions. All four have observed usage; the upper
model token cost estimate is US$0.1169232, conservative reservations US$3.50.
Billing remains unsettled. Both Sessions were deleted and absence read back.

The first candidate failed contract validation. A harness preservation defect
lost the rejected artifact before deletion, so that failure cannot reliably be
attributed to model output. The fixed harness retained artifacts before
validation, supplied the exact schema, and resumed under the unchanged budget
clock, counts and reservations. Two valid model versions then passed; the
same-Session modification preserved earlier result bytes. A separate fourth
Turn confirmed cancellation. No unknown was refunded, replayed or cleared.

After cleanup, actual candidate bytes exposed a files-only Revision defect;
publication/read/GC validation now accepts the documented recovery type while
retaining strict identity checks for live remote references. Final M2 regression:
729 passed, zero failures; typecheck passed. This follow-up is recorded separately
from the earlier complete check.

Local Workerd/R2 committed and restored both actual versions, retained history,
and proved replay idempotence. Twelve independent network-denied native Docker
runs matched a closed-form FCFS oracle. Twelve real Chrome/Pyodide Preview runs
matched those native traces exactly; playback and refresh passed. Every native
container was removed. An initial verifier attempt incorrectly reused one
container for two tokens and was rejected by its single-operation guard; the
verifier was corrected to use a fresh container per run without weakening the
guard. Raw private diagnostic reports remain local.

The committed `live-artifacts/` contains synthetic candidate JSON, converted
archives, Preview packages and actual native receipts. Source receipts refer to
the explicit converted-archive hash after adding platform presentation metadata;
they never claim that edited bytes are the original provider artifact. Provider
identifiers, credentials and account data are omitted.

```sh
node scripts/evidence/verify-issue77.mjs --committed
node scripts/evidence/verify-issue77-live.mjs
shasum -a 256 -c docs/evidence/issue-77/SHA256SUMS
```

The live verifier only checks recorded bytes, hashes and numeric receipts; it
makes no model calls and does not re-execute the browser. Re-execution scripts
are `scripts/issue77/verify-downloaded.mjs` and
`scripts/issue77/verify-downloaded-browser.mjs`; they require the preserved private
operator evidence, pinned native Docker image and materialized Preview assets.

## Product integration and stopped production acceptance

The earlier Pi-only integration boundary has been resolved in code. The product
assembly now includes `ManagedProductRuntime`, typed remote terminal/resource
receipts, immutable project/user opt-in, durable paid admission, the normal
RevisionStore/CAS path, and authenticated formal Experiment/Evidence routes.
The `7b12505` UI checkpoint exposes observed versus unknown token usage,
unsettled billing, saving failures and the separate Session cleanup boundary.
These implementation results are not a passing production execution record.

The original internal ledger above remains intact. The user separately authorized
one additional bounded production policy, `issue77-production-v1`, under the
limits in `docs/architecture/issue-77-live-acceptance.md`. This authorization does
not reopen historical G5 or internal-trial funds and is not a hard billing cap.

The recorded acceptance entrypoint added in `badbfe1`,
`scripts/issue77/verify-recorded-acceptance.mjs`, actually calls
`result-oracle.ts`, `verifyDefaultChange` and the optional command-evidence path.
It revalidates both preserved internal candidates and twelve native receipts,
including parsed-spec default-only changes, original history bytes, exact six-row
coverage per version, seed/parameters, actual trace step counts, before/after
metrics and source/receipt hashes. Nine focused tests passed. This is a later
offline revalidation; it makes no paid request and does not change the source
that ran in production. Its report binds the input and verifier bytes separately
in [`recorded-acceptance.json`](recorded-acceptance.json).

The hosted command trace is unavailable, so the actual command result is unknown.
Combined-shell handling is tested through the same entrypoint using fixtures;
it is not a claim that a hosted command was observed. These helpers do not patch
#73's neighboring evaluator or replace production native Simulation Run and
Experiment/Evidence authority. The retained Mesa profile is optional for this
stdlib FCFS trial; no new live Mesa result is claimed. Browser Preview and
Agent-reported results alone never establish formal Evidence.

The driver `scripts/issue77/production-acceptance.mjs` defaults to no-network
preflight. Paid actions require `--execute`, an authenticated existing user
session and frozen scope/source/release/policy checks. Local Workerd tests cover
ACK loss, stale checkpoint bases, unknowns, cancellation and cleanup failures.
The live driver includes refresh/recovery but does not inject production
checkpoint conflicts or dropped ACKs; those proof categories stay separate.

**Production result: stopped; E2E incomplete.** The first production Turn was
paid under the separate bounded policy. `managed-execution-unknown` stopped new
input; original-identity reconciliation later observed execution completed,
saved its candidate checkpoint and confirmed Session deletion. Usage remains
unknown/missing, billing unsettled. No further input is authorized by that
recovery, cleanup or deployment repair.

A late-accounting event timestamp conflict left Workspace in checkpointing while
the runtime checkpoint was already saved. The targeted repair was deployed
with the policy closed. The final authenticated readback confirms completed and
saved, the original Revision retained, no active Turn or release/recovery hold,
and readable model/files. Unknown usage and its reservation remain unchanged. The initial closure was Worker version
prefix `d3f40847` from source `7b12505`. Exact enabled, closure and final repair
versions belong in [`production-acceptance.json`](production-acceptance.json).

| Required record | Current evidence status |
| --- | --- |
| Integrated offline source and checks | `validation.json`: source `7b12505`, 2,263 passed and 11 skipped; later verifier/repair sources remain separately identified |
| Active enabled Worker and scoped policy | Actual paid trial occurred; exact release proof is recorded in `production-acceptance.json` |
| Ordinary-user model → saved Revision → native Experiment → accepted Evidence | Original business Turn completed/saved after closed-policy repair; model/files readable; full path did not pass |
| Actual browser Preview and Verify | Not completed in this production window |
| Same-Session continuation and preserved history | Not executed after the unknown stop; internal recorded evidence remains separate |
| Cancellation, refresh and durable final business Turn | Original-identity recovery confirmed; deadline cancel returned already-terminal; no production cancellation acceptance claimed |
| Usage, reservations and billing | Usage unknown/missing; reservation retained, billing unsettled |
| Remote Session cleanup | Deletion confirmed; does not remove the unknown usage record |
| Native Run release and tenant quota | No native Run dispatched; quota occupied=0 and unknown=0; no native cleanup claimed |
| Final closed-policy repair Worker | Active `ac0dd1f2` / source `9641f65`, 100% traffic; Managed/bootstrap and all legacy money gates closed |

Revalidate the preserved internal record without new execution:

```sh
node scripts/issue77/verify-recorded-acceptance.mjs
node --test scripts/issue77/verify-recorded-acceptance.test.mjs
```

#77 completion is not claimed. The production report must retain each failed,
unknown or unexecuted step and distinguish saved runtime artifacts from formal
acceptance. Captured evidence omits credentials, raw provider IDs and account
identifiers; private originals remain separate. Final fingerprints bind actual
bytes and source without rewriting historical baseline or internal-trial records.
