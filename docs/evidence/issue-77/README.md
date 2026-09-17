# Issue 77 offline evidence

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

The original offline report is preserved as `offline-20260917.json`; verify its committed historical source with `node scripts/evidence/verify-issue77.mjs --historical`. Current `validation.json` binds the latest main integration, SDK client, bounded operator and ledger to a committed source. Full check: 2,205 passed, 11 skipped. The subsequent focused 21-test run includes six new operator/ledger cases. Authorization is distinct from execution: these are offline preflight results, not paid or production acceptance.

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
node scripts/evidence/verify-issue77.mjs
node scripts/evidence/verify-issue77-live.mjs
shasum -a 256 -c docs/evidence/issue-77/SHA256SUMS
```

The live verifier only checks recorded bytes, hashes and numeric receipts; it
makes no model calls and does not re-execute the browser. Re-execution scripts
are `scripts/issue77/verify-downloaded.mjs` and
`scripts/issue77/verify-downloaded-browser.mjs`; they require the preserved private
operator evidence, pinned native Docker image and materialized Preview assets.

**Production remains incomplete.** The product dispatcher, native capacity
release and Workspace routing still require a Pi-specific proof. Managed
backend-specific termination/resource receipts, project opt-in, durable product
admission and the authenticated formal Experiment/Evidence path have not been
assembled. No production deployment or authenticated production E2E is claimed.
The two authorized Sessions are consumed; another paid production Session would
require a separately authorized policy amendment, retaining this ledger intact.
