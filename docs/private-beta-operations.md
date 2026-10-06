# Private Beta operation — #104

The authoritative operating packet and delivery status are in [#104](https://github.com/jihegao/riffology-cloud/issues/104). Owner: @jihegao. The 2026-10-01 same-actor v2 migration preserves the original ledger, usage and reservations while removing call/fee quotas; its [migration proof](evidence/releases/private-beta-meter-only-20261001.json) remains a historical paused snapshot. Current pause/open state and ordinary authenticated acceptance are separately recorded in [release readiness](release-readiness.md).

For an explicitly authorized review-date extension, deploy the same policy with
only `reviewAt` increased, then invoke the deployment-only `extendReview` RPC
with the previous deadline and its exact pinned policy digest. Admission remains
blocked by the old pin until that step succeeds. The RPC reconstructs the prior
digest from the new configuration, requires no occupied slots and no
reserved/dispatched/unknown calls, then atomically updates only the policy pin
and appends an audit record. It preserves pause, all slot/call/fee records,
alerts, limits, policy/actor identity and start time. Repeating the same accepted
transition is idempotent. A mismatched deployment or unresolved execution stays
blocked; this operation does not reconcile, release resources or dispatch work.
Rolling configuration back to the old deadline after acceptance fails closed
with a policy conflict; retain the accepted deadline during any code rollback.

The authorized 2026-10-07 same-actor extension sets the current review deadline
to **2026-12-31 23:59:59.999 Asia/Shanghai**
(`2026-12-31T15:59:59.999Z`). Independent readback confirms the v2 pin, Open
capacity and unchanged original slot/call/alert hashes and usage; only one
extend-review audit was appended. The temporary maintenance Worker and capability
were removed. See [the release record](evidence/releases/beta-review-extension-20261007.json).
The [September 27 extension](evidence/releases/beta-review-extension-20260927.json)
and original seven-day observation remain historical evidence, not completed
standing-capacity acceptance.

## #153 meter-only policy and guarded migration

[#153](https://github.com/jihegao/riffology-cloud/issues/153) implements the
2026-09-28 decision to remove call and monetary quotas. Schema v2 explicitly sets
`quotaMode: "meter-only"` and **omits** every daily/user/Turn/pending call and
nanodollar ceiling, plus `alertPercent`. Increasing v1 limits or changing actor,
policy ID, epoch, review deadline or price is not this migration. v1 remains
supported and retains its original behavior until the original actor accepts v2.
This source change does not claim that v2 is deployed or authenticated acceptance
has passed.

Retain v1's admission, day boundary, policy ID, profile digest, start/review time,
concurrency, call/tool/Turn/release timeouts, monitor interval and historical
isolation manifests exactly. Add `warningCallsPerMinute`,
`warningNanodollarsPerMinute` and `billingPendingWarningMs` as positive integer
observation thresholds (the latter at least 60 seconds). They trigger alerts,
never quota refusals. Freeze operational warning values with the deployment
packet; 60 calls/minute, US$1/minute and one hour of missing usage are reasonable
initial warning values for owner review. Changes to these pinned values require
a separately reviewed evolution; they are not a mutable quota workaround.

The migration release sequence is:

1. Preserve the original live settings, policy JSON, actor identity, secrets,
   container images and private authoritative ledger export. Pause new work
   through the existing kill switch, and record the resulting pause/audit state.
   Do not replay any unknown request or release a held slot to prepare migration.
2. First deploy the code with **unchanged v1 JSON**, so the original pause and
   authority reads are available before configuration evolution. Then deploy the
   reviewed v2 JSON on the **same**
   `PRIVATE_BETA_CAPACITY_ACTOR = private-beta-capacity-v1`. No namespace/actor or
   model-budget policy-version reset is needed. Mismatched configured/persisted
   digests keep new Pi/provider/tool admission closed. A fresh unpinned v2 actor
   cannot silently initialize an empty replacement ledger.
3. Invoke deployment-only `migrationState()` and retain its redacted
   `ledgerSha256`, original pin, slot/call/alert/audit counts and pause state.
   Retain the corresponding `snapshot()` usage-by-status and conservative
   reservations. The checksum covers full original slots, calls, alerts, audits,
   metering and pause, including immutable request identities; public evidence
   contains only hashes and aggregate statistics.
4. Invoke deployment-only `removeQuotas({previousPolicy, expectedPolicySha256,
   expectedLedgerSha256}, operator)` with the full frozen v1 policy and those
   exact original checksums. The RPC verifies unchanged execution gates, checks
   that authoritative rows did not change since the snapshot, then atomically
   updates only the pin and writes one migration/audit. Original occupied,
   quarantined, unknown, billing-pending, cost and historical audit rows remain.
   It never reconciles, releases, requests a provider/tool or resumes capacity.
5. Independently reread the original authority. Configured/persisted digests must
   match the expected v2 digest; every prior slot/call/reservation/status and pause
   must match, with exactly one migration/audit appended. A stale state checksum
   requires diagnosis and a fresh authority read; do not replay a model request.
   A lost RPC acknowledgement can be checked and the **same** migration arguments
   safely repeated: the committed transition returns `replayed: true` without a
   second audit. A failed SQLite transaction leaves the original pin and rows.
6. Resume only through the existing guarded operator path after authoritative
   release of all held resources. Then complete invited-identity and bounded
   live request acceptance with current deployment/Revision/Turn/call identities.
   Record #153/#104 and the release index truthfully. A code rollback must retain
   accepted v2 configuration and understand its ledger; restoring v1 JSON after
   migration fails closed with a policy conflict. Never recreate the actor.

The offline operator preparation entry point is
`scripts/model/private-beta-quota-migration.mjs`:

```sh
node scripts/model/private-beta-quota-migration.mjs \
  .local/issue-153/v1-policy.json \
  .local/issue-153/migration-state.json \
  .local/issue-153/snapshot.json \
  .local/issue-153/private-plan.json
```

It binds the exact paused original pin/counters, generates the v2 JSON, expected
next digest and `removeQuotas` arguments, and writes a new file mode 0600. It
performs **no** remote operation. Keep full policies, snapshots and private
exports in controlled `.local` evidence; publish only source/version identities,
redacted hashes and aggregates. `migrationState()` supplies independent
`slotSha256`, `callSha256`, `alertSha256` and `operationSha256` as well as the
whole-ledger hash. After migration the first three and pause must match; audit
count increases by exactly one, and the original audit prefix remains intact.

For a capability-protected deployment-only RPC bridge, use
`scripts/model/private-beta-quota-operator.ts` and the **separate**
`infra/wrangler.private-beta-quota-operator.jsonc` template. Set the actual
existing Gateway `script_name`/account from its live configuration in a private
local overlay; never import this entry point into the product Gateway. Set a new
`PRIVATE_BETA_QUOTA_OPERATOR_CAPABILITY` secret and a private
`PRIVATE_BETA_QUOTA_OPERATOR_SCOPE_JSON` with exactly:

- `schemaVersion: 1`, original `actor`, `operator: {userId, authVersion}` and
  `expiresAt` no more than 30 minutes after scope preparation;
- `policySha256s: [originalV1Digest, reviewedV2Digest]`;
- optional `migration` equal to `private-plan.json`'s `rpc.arguments`.

With no `migration` property it cannot migrate. POST `/operate` with its separate
Bearer capability and `{action: "snapshot"}` returns the redacted
`{state, snapshot}` required by the prepare CLI. `{action: "pause",
confirmation: "pause-original-pool"}` also requires `X-Beta-Mutation: pause`.
After freezing the plan, redeploy only the temporary scope with its exact
`migration` arguments. `{action: "remove-quotas", confirmation:
"remove-only-call-fee-quotas"}` requires `X-Beta-Mutation` equal to the v2
policy digest, actual v2 configuration and persisted pause. The bridge only
forwards the frozen arguments; callers cannot supply another policy/checksum.
There is no resume, replay, call, tool or ledger-write action. Errors are redacted,
expired scope fails closed and the default template's empty scope is inert.
Delete the temporary operator Worker and its capability after independent
readback; keep its frozen source/config checksums in controlled operation evidence.
Normal resume, if authorized and justified by independent original resource
release, continues through the existing operator path.

Pi retains original `model_budget_meta`, call records, dispatch fencing and
conservative unknown-usage accounting. Only the v2 Beta route stops enforcing
aggregate per-Turn attempts/dispatch/token budgets; snapshots mark
`turnQuotasEnforced: false` while preserving old metadata for inspection. Per-call
input/output token bounds, safe-integer overflow checks, one live model call,
identity/digest checks, time limits and historical execution isolation remain.
There is no automatic retry or provider fallback. v2 also removes the daily
rollover dispatch restriction; rollover does not clear uncertainty or reservations.

The operator panel distinguishes meter-only operation from a monetary maximum;
null limits are never displayed as zero. `policyReady` shows whether deployment
and stored pin agree. Trend warnings use precise timestamps for new calls:
`call-rate-anomaly` and `fee-rate-anomaly`. `billing-pending-stale` retains the
original missing-usage cost and alerts after its first durable observation ages
past the configured threshold. Historical missing usage starts this observation
clock at first monitor, with no invented historical timestamp or zero amount.
The monitor continues while billing-pending records exist, even after resource
release. Existing execution/release alerts remain. The owner inspects the
original provider/Turn identity and fee trend in `/admin`, pauses immediately
for unexplained activity or execution uncertainty, and records the incident and
next safe read-only action in #104/#153. Billing-only investigation stays separate
under #101; neither a warning nor absent usage is settlement evidence. Logs/panel
are the implemented alert channels; no external notifications are claimed.

[#136](https://github.com/jihegao/riffology-cloud/issues/136) has a separate Runs
resource actor and its own compute-release proof. `authorizeRunAdmission(scope,
actor)` is a read-only guard that requires migrated v2, current invitation/owner,
valid window, matching original pin and an unpaused Beta pool. It rejects global
quarantine or reserved/dispatched/unknown model execution; credible terminal
billing-pending records alone do not block it. Runs must call this guard at
admission and immediately before native start, retain their own concurrency,
per-run duration and group-size bounds. The shared guard itself verifies original
legacy/G5 execution isolation against the same authorities and frozen exact proofs
as Pi; absent proofs require execution-quiet original ledgers. A fresh Run project
cannot bypass an old unknown in either ledger. It does not reserve or release a Pi slot and does not open M3/M4 gates
by itself. The independent Invited Runs policy was enabled on 2026-10-02 after
explicit user authorization and ordinary owner/local preview confirmation;
its [opening evidence](evidence/releases/invited-runs-open-20261002.json) records
original pins, unchanged ledgers and enabled authenticated UI. Actual execution
and full acceptance remain separate under #136.

Local evidence: strict v1/v2 parsing; real Workerd/SQLite migration with rollback
injection, stale snapshot refusal, unchanged gate checks, occupied/unknown/fee
preservation and restart/replay; real D1 invitation/revocation tests; 65 serial
credible terminal calls on one v2 Turn crossing v1 daily/Turn/pending/money and
hidden 64-dispatch ceilings; conservative missing usage; anomaly/stale warnings;
metering overflow refusal; retained per-call/time/pause/unknown/new-project/day
boundaries. These are local fixtures with outbound network disabled, not live
paid or authenticated production acceptance.

## Historical v1 packet (effective until explicit migration)

The user confirmed accepted ordinary administrator invitations plus active user, personal tenant and owner membership. All owned personal projects inherit admission; no new project-count limit is imposed. Each request rechecks current D1 identity and project scope. Bootstrap operator status alone does not grant Beta admission.

One active Turn per user across projects and Sessions, two globally, including preparation, queueing, stopping and release holds. Existing native Pi capacity and each existing container application remain capped at one; the second admitted Turn can wait. This is a ceiling, not a promise of two simultaneous model executions.

UTC daily ceilings: 80 provider calls / US$2 per user, 240 calls / US$5 globally; US$20 cumulative exposure. Admission reserves a call and worst-case token cost before dispatch. Reservations count conservatively even when never dispatched or when verified usage is lower. Therefore usable call count can be below 80/240 when the cost limit is reached. Actual billing remains separate, and unknown usage is never recorded as zero.

Call deadline is at most 360 seconds; Turn admission-to-completion at most 15 minutes (existing native execution cap is stricter at 10 minutes). The proposed ancillary policy stays inside that packet: 32 calls / US$2 per Turn, 240 pending calls / US$20 pending exposure, tool deadline 120 seconds, release confirmation 120 seconds, monitor every 60 seconds, daily and cumulative fee warning at 80%. Existing fixed OpenAI `gpt-5.6-luna` profile and input/output token maxima remain unchanged. Exact start and review timestamps are frozen at controlled opening; review is seven days later.

## Authority and recovery

`PRIVATE_BETA_CAPACITY` uses the fixed actor `private-beta-capacity-v1`; policy identity, limits, time range and price digest are pinned. Only `enabled` is mutable without a policy conflict. Daily rollover, new projects, policy IDs and restarts do not clear prior calls, pending reservations or occupancy. The existing tenant Pi budget retains the one-dispatch grant and historical records. G4/G5 proof manifests must still match their original authorities; #101 is not reset or settled.

A completed/failed UI Turn does not release capacity. The original Workspace must report a terminal Turn, no active Turn, no release/recovery hold and no resource wait; all original model records must have credible execution terminal evidence or a durable not-dispatched proof. Capacity reads the original tenant record to repair a lost completion notification. Unresolved or missing records remain occupied. Provider failures without terminal evidence quarantine the user’s slot immediately. No mechanism here dispatches a provider request, retries a tool or switches provider.

The existing native release protocol includes a six-minute assignment guard and a quiet check. For the original Turn's exact `release-pending` assignment-guard or quiet-window state, Beta keeps the slot occupied until release is confirmed, bounded by the original admission plus 15 minutes. This is not a rolling deadline or a release proof. The ordinary 120-second timeout still applies to other unconfirmed release states. Existing quarantines remain quarantined until explicit operator reconciliation; the guard exception never clears model uncertainty or changes frozen limits.

For [#137](https://github.com/jihegao/riffology-cloud/issues/137), **Edit draft** fences only the original Private Beta Workspace, Session and idempotency key after the Workspace confirms no matching Turn. The fence is durable across restart and prevents a late POST under that key from creating a Turn. It does not dispatch a provider or clear any other user's occupancy. A Beta slot associated with the fenced key is returned only when it has no bound Turn or call and the original Workspace is quiet; the original slot and a release audit remain. If the Turn exists or the result cannot be confirmed, the browser retains the original request for receipt recovery. A caller-scoped capacity read exposes only `available`, `admitting`, `running`, `release-pending`, `review-required` or `unknown`, with no other user's project or request identity. A restored draft may still be unable to send while another original slot is occupied or quarantined; operators must inspect that slot and its release evidence.

At `/admin`, an active operator can read the Beta panel and pause capacity. Pause is persisted, audited, blocks new Turns/calls/tools, and the monitor requests cancellation of original running Turns. It does not assert those executions ended. Resume performs read-only reconciliation and is rejected until **every** occupied slot has authoritative execution and release evidence; quarantined slots require this explicit operator action. Late terminal evidence is recorded against the original call through the existing trusted model path, never by editing a browser result or resetting a ledger. If that evidence cannot be obtained, remain paused and document the original identity in #104.

The panel exposes redacted capacity, conservative fee exposure, monitor time and persistent alerts. Worker logs emit `private-beta-alert`; no email/Slack alert delivery is claimed. The owner checks the panel during operation and handles warnings before further capacity is approved. Hard limits do not depend on that manual check. On unavailable authority, unknown execution, release timeout, revocation or review expiry, affected capacity is held. Use the global pause immediately for an unbounded incident; also close `M2_TURNS_ENABLED`, `M2_MODEL_PROVIDER_ENABLED` and `PRODUCTION_MODEL_ENABLED` when needed. Keep cancellation, read-only reconciliation and release paths available.

## Release and observation

Deploy with execution gates closed first, preserving live bindings, secrets, container images, namespaces, policy manifests and static asset identities. The checked-in phase1 configuration is a template and does not contain every current live binding; derive the release overlay from the current Worker version/settings rather than replacing live configuration with the template. Add only the new SQLite DO binding/export and the reviewed Beta policy. Independently read back the resulting version and all execution flags.

Open only Pi/M2 paths after scope-specific checks. Keep G5 admission, all M3 cloud paths and M4 disabled. Verify actual invited authentication, project creation, Python edits, saved Revision, Browser Preview, parameter persistence and continued conversation. Include a real second identity and cross-project negative checks; fixtures are not that evidence. Record original Turn/call/Revision identities, budgets before/after, request traces and release proofs. Browser Preview remains local/unverified.

The separately authorized #136 opening uses `INVITED_RUNS_POLICY_JSON`, retaining
those closed legacy flags. Its standing route stays within this original Beta
window and kill switch, with global/user concurrency 1, 600-second Runs and at
most eight sequential group children. See [Invited Cloud Runs](invited-cloud-runs.md)
for its distinct admission, release and remaining acceptance contract.

During the seven-day observation, record meaningful failures, revisits, budget warnings, pause/resume events and unresolved resources in #104. Review expiry automatically prevents new admission; extension requires an explicit reviewed policy evolution preserving all cumulative exposure, not a new actor or ledger. Do not mark #104 Done or reopen #87 merely because code is merged, a homepage returns 200, or one account succeeds. Close only after its documented acceptance and observation exit conditions are satisfied.
