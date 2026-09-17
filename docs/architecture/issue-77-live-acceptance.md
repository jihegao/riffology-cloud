# Issue 77 bounded internal acceptance

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
formal Experiments, evidence acceptance, or production browser E2E. The product
dispatcher still requires Pi-native termination and capacity receipts. A separate
reviewed backend-specific termination/resource contract and project-scoped
admission assembly must precede enabling Managed product routing. The SDK client
and this bounded operator do not bypass those contracts.
