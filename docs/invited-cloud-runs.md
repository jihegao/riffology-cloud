# Invited Cloud Runs — #136

Implementation candidate, 2026-10-01. Deployment and ordinary authenticated,
paid container acceptance are pending. This document describes the new route;
live status and ownership remain in [#136](https://github.com/jihegao/riffology-cloud/issues/136)
and the Delivery Project. Browser Preview remains local/unverified.

## Admission and identity

Ordinary Runs keep the existing `/api/workspaces/:workspace/model`,
`experiments`, `experiment-groups`, `simulation-runs/:run/cancel` and
Preview → Verify as Experiment contracts. The Workspace persists the exact
saved Revision, files/spec hashes, package/compiler Plan, parameter values, seed,
actor/auth version, idempotency key and each group child ID before scheduling.
A response-lost retry uses the same intent. Refresh reads existing records;
no automatic retry or provider fallback exists. A new Run is refused when its
browser request identity cannot be saved.

`INVITED_RUNS_POLICY_JSON` activates the separate `invited-runs` admission route.
The fixed SQLite DO `INVITED_RUN_CAPACITY` / `invited-run-capacity-v1` holds
resource reservations across users and projects. It does not replace, clear or
rename the original Private Beta, tenant quota, G5 or managed ledgers.
The original `private-beta-capacity-v1` must accept
`authorizeRunAdmission(scope, actor)` under #153's migrated v2 meter-only policy.
That RPC checks the original policy pin, invitation/ownership/auth version,
window, kill switch, quarantine and globally unresolved model execution. Credible
terminal execution with billing pending stays distinct from execution unknown.
It also rechecks the original Legacy and G5 actors against the exact historical
isolation manifests and quiet-execution proof; a new project cannot bypass an
unresolved old execution. Missing historical bindings fail closed.
Model-call proof is separate from resource release. Every reservation, dispatch
and native-start gate also reads the original `TENANT_QUOTA` actors for the
current tenant, all current accepted-invitation active personal-owner tenants
from D1 (without a page limit), frozen historical tenants, and tenants recorded
in every original G5 window. Any outstanding Simulation/Service lease, or an
unknown/expired Workspace lease, refuses the new Run. The original fixed G5
actor refuses any unconfirmed historical native start grant. These private RPCs
only SELECT existing metadata; empty original actors stay uninitialized, and no
policy is pinned, admission opened or release fabricated. Legacy M4, M3 Service
and G5 admission flags must stay closed. Beta actor/kill authorization is checked
again after all resource reads.

Authorization is checked at submit, each child scheduling attempt, reservation,
dispatch and immediately before native start. Archive integration #152 supplies
`assertWritableScope` inside the Run writable guard and holds its shared mutation
fence across submit/alarm work. Frozen old projects cannot admit a new execution.
Stopping, original lease lookup and release reconciliation remain available when
execution is closed; they never create a new native model intent.
The final native check occurs after archive upload and control-file preparation,
so a kill, actor revocation, cancellation, deadline or uncertain timed-out start
during preparation prevents the model process from launching.

The explicit `runAdmission` marker is persisted separately from historical G5
`budgetRoute`. Existing records keep their original ledger route. Managed and G5
flows retain their prior gates. Enabling Runs does not enable M4, M3, G5 or public
registration, or restore an expired controlled window.

## Resource limits and release

| Boundary | Candidate value | Basis |
|---|---:|---|
| Global active native Runs | 1 | Current phase1 Simulation container `max_instances: 1` |
| Active native Runs per user | 1 | Counts the same user across projects and tenants |
| Children per comparison group | 8 | Supports baseline/intervention × 2 seeds, within a small beta batch |
| Run deadline | 600 seconds | Existing `SimulationHost` default and root native runner deadline |
| Release assignment guard | 360 seconds | Existing finite-run/container release guard |
| Continuous quiet observation | 30 seconds | Existing `destroy` / running-state release checks |
| Release confirmation grace | 120 seconds | Bounded allowance for alarm/stop observation and release readback, after the full guard |

These are conservative resource bounds, not measured throughput. Groups freeze
all child IDs, then admit one child at a time. The next child's execution deadline
begins when that child is created after its predecessor is released. Planned
children do not occupy native slots. Workspace historical bounds (1,000 Run
records, 100 groups, eight active Workspace Run records) remain storage/backlog
bounds and are separate from global native capacity.

Cancellation before native start settles the original lease using the durable
no-start fence. A started Run requires trusted native stop proof, repeated destroy
and nonrunning observations through the guard, then original lease confirmation.
Neither a terminal result nor a single `running=false` probe returns capacity.
The UI exposes `released` / `releasePending` and continues GET polling until
release is confirmed. Eligible invited publication results must be completed,
metric-valid, current-model results with confirmed resource release authority.
The full reproducible artifact/export checks and human publication review remain.

An unconfirmed native start/observation/stop or release operation marks the
original Run lease unknown and pauses the global Run actor. Reconciliation only
observes/stops that original identity. A reservation still unsettled after its
600-second deadline plus the 360-second release guard and 120-second confirmation
grace is quarantined by the actor
alarm; its capacity remains held. It cannot be bypassed by another project,
user, policy ID or runtime provider. Trustworthy release can settle the original
lease, but does not automatically resume the paused actor. An operator resumes
only after zero occupied leases and review of the original receipts. The common
Private Beta kill switch also cancels pending children and requests stop for
accepted Runs. No new request is admitted while either route is paused.
The grace never extends the native 600-second execution deadline or shortens the
360-second guard measured from trusted stop observation. Continuous quiet runs
in parallel with that guard. Ordinary timeout followed by confirmed release
within the bounded grace can admit the next Run; missing proof still quarantines.

No call-count, money, daily or cumulative compute quota exists in this route.
The actor retains every reservation/denial/release receipt, dispatch timestamps,
release timestamps and `observed.supervisedMs`. That measure is supervised wall
occupancy, including preparation/release; it is not CPU time or a fabricated bill.
Cloudflare/container invoice observations must be recorded separately. Unknown
charges never become zero and historical reservations remain intact.

Python comparison groups use the existing parameter/seed contract. The merged
compiler v0.1 frozen bundle continues to support single Runs; its distinct
Business-IR revision comparison remains `compiler-group-unsupported`, as in
#155. No compiler or Python runtime is silently rebound.

## Release order and acceptance

1. Merge #153 and #152 with the shared Run writable guard. Archive the approved
   frozen old-project manifest only after quiescence; preserve restore and all
   historical models, Sessions, Revisions, experiments and billing evidence.
2. Deploy #153's v2 configuration and perform its guarded `removeQuotas` migration
   on the same original capacity actor. Independently read back configured/pinned
   digest, original rows, pause/quarantine and counters. A pin conflict keeps
   Runs closed. Do not change G5/managed gates to work around it.
3. Deploy the candidate Gateway with the additional `INVITED_RUN_CAPACITY`
   binding and `InvitedRunCapacity` SQLite declarative export. The current
   Wrangler config uses `exports`, which is mutually exclusive with legacy
   `migrations`; do not add a second migration mechanism. The checked-in Run
   policy is disabled. Build/pin/read back the Simulation image, including the
   merged compiler closure, and retain the one-instance limit and observability.
4. Only after those readbacks, enable the same Run policy (`enabled:true` only)
   and independently verify the binding, image, actor pin, limits and original
   Beta admission state. The configured Beta review window remains authoritative.
5. Use only new personal projects and an ordinary currently accepted invitee.
   Freeze a small Queue Revision and record all request/Revision/package identities.
   Complete a single Run, then baseline + a different parameter intervention with
   seeds 42 and 43. Read all four durable results after refresh/reentry, wait for
   confirmed release, and verify current-version baseline/comparison readiness.
6. Validate cross-user/project denial, shared capacity contention, cancellation,
   timeout/failure/release and same-identity lost-receipt recovery. Modify/save the
   model and show prior results cannot validate changed files/spec. Publication
   readiness grants no scientific correctness claim or bypass of human review.
7. Record date, deployment versions/image digest, actor policy pins, caller scope,
   frozen source/parameters/seeds, requests and result/release receipts, observed
   resources, results and uncovered cases in #136 / the PR and release index.
   Keep implementation, merge, deploy/static, authenticated and paid execution
   acceptance separate. Pending live evidence is not Done.

## Local validation

The new tests exercise actual Workerd/SQLite actor restart, invitation/auth-version
recheck at acquire/dispatch, persisted one-shot dispatch, cancel, release and global
unknown pause. SQLite fault tests cover lost acknowledgements, forged scopes,
policy replacement, disabled-route recovery and retained observations. Host/group
regressions cover exact frozen child plans, one-at-a-time scheduling, eight-child
admission, timeout and stop/release. Chromium checks cover read-only terminal
release polling, bilingual policy/capacity notices, storage failure before POST,
group limits and publication → Runs navigation.

Local candidate checks passed: typecheck, UI (21), M1 (277), M2 (846), and all
four M3 stages (876 passed / 12 conditional container tests skipped; Browser
Preview 16; release scripts 9; model scripts 90). Subsequent targeted tests cover
the final upload-time authorization fence and historical-group route guard.
The skipped container tests and authenticated paid acceptance remain pending.
Post-review checks additionally cover original Quota/G5 proofs without writes,
cross-identity old Service unknown, frozen old Simulation held, expired G5 native
start, missing authority and dispatch/final-check denial through actual
Workerd/D1/SQLite. Joint Host/capacity tests cover 2-second and 90-second stop
observation delays, the full guard, release and the next Run without a false pause.
The post-review targeted set passed 63 checks; original Quota/G5/Service
regressions passed another 46, including Workerd. Typecheck and UI were rerun.

Use the repository README asset preparation before full suites. On this macOS
host, set `M1_BROWSER_CHANNEL=chromium` and prepend
`/opt/homebrew/opt/openssl@3/bin` to PATH for existing certificate tests. Tests
contain no provider requests, live data writes or paid cloud executions.
