# Account-scoped online testing

The user authorized online testing without application quota limits on
2026-09-18. `MANAGED_TESTING_JSON` enables this route for one exact catalog owner
and tenant. It uses the existing Managed runtime and credential; it does not
reopen or erase historical G4/G5 or issue-77 acceptance records.

Configuration has exactly `schemaVersion: 2`, `policyId`, `tenantId`, `userId`
and `enabled`. The derived, project-scoped policy has null money, Turn, Session,
Simulation and total-duration limits. The old schema-1 policy remains exact and
immutable. Its matching project takes precedence over the account testing route.
Existing project backend pins and Pi Turn history cannot be reinterpreted.

The test owner can create ordinary projects without a controlled-window budget
route. Normal catalog ownership, idempotency, provisioning and outbox checks
still apply. New eligible workspaces select Managed execution and pin that
selection durably before input. Closing `enabled` prevents new inputs while
retaining observation and cleanup. Changing the policy identity does not reset
a pinned project's accounting.

This removes application quotas, not infrastructure constraints. Provider limits,
five-minute per-Turn observation/cancellation, one active input, retained Session
cleanup requirements remain. Transient reads keep the original input unresolved and block concurrent input while observation continues; they do not immediately cancel it. Terminal proof and completed checkpoint publication allow the account testing route to recover from historical observation stops. Unknown usage is retained independently of admission on this quota-free route; bounded schema-1 trials remain fail-closed. Actual usage is
recorded; existing unknowns are not converted into zero usage or refunds.

The Managed test route packages standard-library Python lane models using the
existing candidate artifact contract. Its model instructions supply that contract
so users can enter modelling requests rather than the old acceptance prompt.
Hosted Service execution and historical trial reopening are outside this route.

Validation includes actual local Workerd/D1/R2 execution with an intercepted SDK
transport: ten Turns, three Sessions, fourteen Simulations, observed cost above
the old US$5 threshold, and elapsed time beyond the old two-hour window. Separate
cases verify unknown-usage retention, exact original replay, owner isolation,
immutable prior policy and concurrent submission rejection. These are local
regression results, not evidence of successful paid production model execution.

Recovery after verified hosted Session deletion recreates a Session only for a new user input, carrying verified saved model files and bounded user-request history. It never replays the old input or resets old usage, holds, or receipts.

Account testing retransmits an unbound original input only to its verified idle Session, using the exact persisted payload and the same provider Idempotency-Key. This does not create a new reservation or identity. Automatic delivery attempts are bounded and remain under the observation deadline. An owner-scoped operator repair can renew observation of that exact original, retaining all accounting and an audit record; bounded trials do not use this path.
