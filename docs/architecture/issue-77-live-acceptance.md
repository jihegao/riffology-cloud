# Issue 77 bounded internal and production acceptance

The first sections preserve the original internal trial policy and outcome. The
additional production window and its stopped outcome are separate records below.

The user authorized reuse of the existing locally configured API key and accepted
the proposed bounded trial, including unknown actual charges. The policy is
US$5 as an observed stopping threshold, at most 6 Turn attempts and 2 hosted
Sessions, serial input, synthetic FCFS data only, and a non-resettable two-hour
clock starting at the first paid reservation. Each Turn has a five-minute
observation deadline followed by cancellation. No production routing is enabled
by this internal operator.

The public Agents API 7.17.0 types expose no caller-settable Turn token or dollar
ceiling. Usage is best effort. A local deadline does not prove remote termination;
this is explicitly not a hard billing cap. A terminal Turn gets up to 45 seconds
of read-only usage reconciliation. Missing usage, unresolved execution, a failed
candidate contract, costs above a Turn reservation, or unconfirmed cleanup stops
new input. Unknown records and reservations remain intact.

The independent ledger consumes US$0.75 per attempted Turn plus US$0.25 per
created Session and does not refund reservations. Thus six attempts and two
Sessions reserve exactly US$5. Observed token cost uses conservative standard
upper rates of US$0.50/M input and US$1.80/M output, including high-context input
cache-write pricing. This estimate is not billing settlement. See the
[official price table](https://developers.openai.com/api/docs/pricing).
Historical #73 and G5 funds, holds, windows, routing and gates are not modified.

## Implementation and evidence boundaries

`ManagedSdkTransport` uses the public SDK with zero automatic retries. Hosted
provisioning has an immutable creation correlation and local session scope in
metadata. The returned Session is durably attached before model input. Lost
creation responses recover the original Session by metadata; they never cause
resubmission of absent input. Input uses the supported idempotency header and an
opaque digest marker. Reconciliation requires an exact match to the persisted
original user message, not a newest-Turn heuristic. Canonical output items, with
stable IDs/timestamps, are read after terminal status; unobserved tools stay
unobserved. Scope checks also apply to cancellation, deletion and artifact bytes.

The operator's SQLite ledger and private evidence live in
`.local/issue77-internal-v1`, with owner-only files. The key is loaded only from
the explicitly approved local configuration, never sent into the sandbox or
written into evidence. No production credential is installed by this operator.

`node scripts/issue77/live.mjs` is a no-network preflight. `--execute` permits one
fresh run only, on a clean committed source tree. `--recover` performs original
observation/cancellation/cleanup, with no new input. A process lock excludes a
second operator; a crashed lock is retained for explicit process inspection.
State cannot be reset by merely changing a window ID or rerunning the command.

A known candidate-contract failure can be repaired within the same approved
window using `--execute --resume-known-candidate-failure`: only the first failed
candidate attempt is eligible, and only with a completed provider Turn, observed
usage below its hold, confirmed deletion/absence and the original unexpired
clock. The pause report is retained in SQLite; all counts and money reservations
remain consumed. Unknown execution/usage, excess cost, and unconfirmed cleanup
can never use this path. It creates the second and final allowed Session with
new explicit local identities, rather than replaying a prior Turn.

The planned sequence is model creation, same-Session default modification with
history preservation, then cancellation. Observation reconstructs the adapter
from durable bindings. Downloaded code is validated and packaged with the
reviewed platform runner; it is not executed directly on the operator machine.
Download artifacts before deleting the remote Session and verify absence via
readback. Remote deletion never supplies a Pi native-process fence. Private
local evidence is retained for review; provider cleanup does not erase unknown
billing records.

Candidate packaging and `simulationPlan` resolution are not persisted Revisions,
formal Experiments, evidence acceptance, or production browser E2E. At the original internal
checkpoint the dispatcher still required Pi-native termination/capacity receipts.
The subsequent product integration added reviewed backend-specific proofs and
project-scoped admission; the internal operator itself does not bypass them.

## Recorded outcome

The authorized internal run consumed four Turns and both Sessions. All usage
was observed, both Sessions were deleted with absence readback, and the model
token cost upper estimate was US$0.1169232 (not settled billing). The first
candidate failure had incomplete artifact preservation, documented without
assuming a model fault. Two later valid candidates, same-Session history
preservation and cancellation passed.

Actual downloaded bytes subsequently passed local RevisionStore/R2 publication
and restore, twelve native Docker oracle runs, and twelve matching real browser
Preview runs. These are component results, not authenticated production E2E.
See `docs/evidence/issue-77/live-acceptance.json` and its adjacent README.

At the original internal checkpoint, product integration was still unassembled.
The later product route now has backend-specific terminal/resource contracts,
immutable project opt-in and durable admission without synthesizing a native
fence. That implementation does not expand the original internal allowance: this
trial cannot admit a third Session.

## Additional production acceptance authorization (2026-09-18)

The user explicitly requested completion with subagents and authorized one
additional bounded plan. This is a new, separately auditable production trial,
not a reset/refund/reuse of the completed internal trial or historical G5 funds.
Policy `issue77-production-v1`: one exact synthetic Project/Workspace and user,
serial input; at most two new hosted Sessions, six Turn attempts, twelve native
Simulation Runs, and two hours from the first paid reservation. US$5 is the
observed model-cost stopping threshold, not a provider-enforced cap; the earlier
accepted actual-cost uncertainty remains applicable. Each Turn is observed for
at most five minutes before cancellation. Unknown execution/usage or unconfirmed
cleanup blocks new input. Reservations remain US$0.75/Turn + US$0.25/Session,
nonrefundable. No further automatic window or attempt renewal is allowed.

The ManagedProductRuntime uses a fixed project actor name, verifies the actor
identity, pins the policy immutably and reserves before provider side effects.
TurnJournal remains the business/head authority. Remote terminal receipts release
only the adapter input slot, while separately recorded hosted Sessions remain
retained for explicit same-Session continuation and later verified deletion.
No native process fence is inferred. Files-only Revisions use the normal
RevisionStore/CAS path. Existing Pi/G5 projects and global gates remain unchanged.

Release sequence: compile and test; upload a closed candidate preserving actual
resource IDs/assets/secrets; read back the candidate before activation; create
one idempotent blank synthetic project under an exact bootstrap request; disable
bootstrap and enable only its frozen Managed policy; use the authenticated user
UI for model -> Revision -> native Experiment -> Evidence/Preview -> continuation
-> cancellation/cleanup. Close the policy after acceptance and read back both
remote cleanup and native resource inventory. This section freezes authorization
and implementation intent; it is not evidence that production acceptance passed.

## Production trial outcome: stopped, incomplete

The separately authorized production window submitted its first paid Turn on
source `7b12505`. The runtime stopped admission with
`managed-execution-unknown`; no subsequent model input was submitted. Read-only
original-identity reconciliation eventually observed execution completed, saved
the candidate checkpoint and confirmed hosted Session deletion. Usage remains
unknown/missing and billing remains unsettled. These later observations neither
clear the stopped policy nor create a new paid allowance.

A late-accounting event timestamp conflict left Workspace checkpointing despite
the saved runtime checkpoint. The focused repair was verified and deployed with
admission closed; authenticated readback now shows completed/saved and readable
model/files. The initial policy closure used Worker version prefix `d3f40847` from
source `7b12505`; record the final closed repair source/version and reconciled
Workspace/resource readback in
[`production-acceptance.json`](../evidence/issue-77/production-acceptance.json).
The complete model → native Experiment/Evidence → Preview/Verify → continuation
path did not pass, and no production E2E or issue completion is claimed.

Separate offline revalidation added in `badbfe1` runs the candidate validators
against the preserved internal candidates and native receipts through
`scripts/issue77/verify-recorded-acceptance.mjs`. It checks default-only parsed
spec edits, byte-preserved history and numerical coverage with immutable source
bindings. Hosted command visibility remains unknown; shell recognition has
fixture evidence only. This does not modify #73's evaluator or change either
trial ledger.

Final original-identity recovery (2026-09-18): closed-policy Worker `ac0dd1f2-bce1-4b41-a25a-d7e811b9d0da`, source `9641f6546b099ad080ec00c2f7ba9e6b996a2fa7`, is independently confirmed at 100% traffic. Authenticated Workspace is completed/saved with no active Turn, release hold or recovery hold; model/files are readable. One unknown usage record and US$1 reservation remain, with zero live Sessions and no pending cleanup. No native Experiment, formal Evidence, Preview Verify or same-Session continuation was executed after the stop. See `docs/evidence/issue-77/production-acceptance.json` and `repair-validation.json`; issue #77 remains incomplete.
