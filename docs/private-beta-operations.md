# Private Beta operation — #104

The authoritative operating packet and delivery status are in [#104](https://github.com/jihegao/riffology-cloud/issues/104). This note describes implementation and verification, not a second task board. Owner: @jihegao. No standing paid capacity is declared open by this source change.

## Confirmed limits

The user confirmed accepted ordinary administrator invitations plus active user, personal tenant and owner membership. All owned personal projects inherit admission; no new project-count limit is imposed. Each request rechecks current D1 identity and project scope. Bootstrap operator status alone does not grant Beta admission.

One active Turn per user across projects and Sessions, two globally, including preparation, queueing, stopping and release holds. Existing native Pi capacity and each existing container application remain capped at one; the second admitted Turn can wait. This is a ceiling, not a promise of two simultaneous model executions.

UTC daily ceilings: 80 provider calls / US$2 per user, 240 calls / US$5 globally; US$20 cumulative exposure. Admission reserves a call and worst-case token cost before dispatch. Reservations count conservatively even when never dispatched or when verified usage is lower. Therefore usable call count can be below 80/240 when the cost limit is reached. Actual billing remains separate, and unknown usage is never recorded as zero.

Call deadline is at most 360 seconds; Turn admission-to-completion at most 15 minutes (existing native execution cap is stricter at 10 minutes). The proposed ancillary policy stays inside that packet: 32 calls / US$2 per Turn, 240 pending calls / US$20 pending exposure, tool deadline 120 seconds, release confirmation 120 seconds, monitor every 60 seconds, daily and cumulative fee warning at 80%. Existing fixed OpenAI `gpt-5.6-luna` profile and input/output token maxima remain unchanged. Exact start and review timestamps are frozen at controlled opening; review is seven days later.

## Authority and recovery

`PRIVATE_BETA_CAPACITY` uses the fixed actor `private-beta-capacity-v1`; policy identity, limits, time range and price digest are pinned. Only `enabled` is mutable without a policy conflict. Daily rollover, new projects, policy IDs and restarts do not clear prior calls, pending reservations or occupancy. The existing tenant Pi budget retains the one-dispatch grant and historical records. G4/G5 proof manifests must still match their original authorities; #101 is not reset or settled.

A completed/failed UI Turn does not release capacity. The original Workspace must report a terminal Turn, no active Turn, no release/recovery hold and no resource wait; all original model records must have credible execution terminal evidence or a durable not-dispatched proof. Capacity reads the original tenant record to repair a lost completion notification. Unresolved or missing records remain occupied. Provider failures without terminal evidence quarantine the user’s slot immediately. No mechanism here dispatches a provider request, retries a tool or switches provider.

At `/admin`, an active operator can read the Beta panel and pause capacity. Pause is persisted, audited, blocks new Turns/calls/tools, and the monitor requests cancellation of original running Turns. It does not assert those executions ended. Resume performs read-only reconciliation and is rejected until **every** occupied slot has authoritative execution and release evidence; quarantined slots require this explicit operator action. Late terminal evidence is recorded against the original call through the existing trusted model path, never by editing a browser result or resetting a ledger. If that evidence cannot be obtained, remain paused and document the original identity in #104.

The panel exposes redacted capacity, conservative fee exposure, monitor time and persistent alerts. Worker logs emit `private-beta-alert`; no email/Slack alert delivery is claimed. The owner checks the panel during operation and handles warnings before further capacity is approved. Hard limits do not depend on that manual check. On unavailable authority, unknown execution, release timeout, revocation or review expiry, affected capacity is held. Use the global pause immediately for an unbounded incident; also close `M2_TURNS_ENABLED`, `M2_MODEL_PROVIDER_ENABLED` and `PRODUCTION_MODEL_ENABLED` when needed. Keep cancellation, read-only reconciliation and release paths available.

## Release and observation

Deploy with execution gates closed first, preserving live bindings, secrets, container images, namespaces, policy manifests and static asset identities. The checked-in phase1 configuration is a template and does not contain every current live binding; derive the release overlay from the current Worker version/settings rather than replacing live configuration with the template. Add only the new SQLite DO binding/export and the reviewed Beta policy. Independently read back the resulting version and all execution flags.

Open only Pi/M2 paths after scope-specific checks. Keep G5 admission, all M3 cloud paths and M4 disabled. Verify actual invited authentication, project creation, Python edits, saved Revision, Browser Preview, parameter persistence and continued conversation. Include a real second identity and cross-project negative checks; fixtures are not that evidence. Record original Turn/call/Revision identities, budgets before/after, request traces and release proofs. Browser Preview remains local/unverified.

During the seven-day observation, record meaningful failures, revisits, budget warnings, pause/resume events and unresolved resources in #104. Review expiry automatically prevents new admission; extension requires an explicit reviewed policy evolution preserving all cumulative exposure, not a new actor or ledger. Do not mark #104 Done or reopen #87 merely because code is merged, a homepage returns 200, or one account succeeds. Close only after its documented acceptance and observation exit conditions are satisfied.
