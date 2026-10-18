# Private Beta admission maintenance hold (#248)

This change prepares a durable admission barrier for the existing
`private-beta-capacity-v1` actor. It does not execute maintenance or a rollout.
The original policy, actor, namespace, limits, kill switch, pause/resume,
quarantine, usage reservations and release authorities remain in use. Neither
configured review date is changed; human authorization remains bounded by
2026-10-20 23:59:59.999 Asia/Shanghai.

## Contract

The existing authenticated operator boundary exposes
`/api/admin/private-beta/maintenance`. GET accepts only optional `requestId`;
POST accepts exactly `action` (`begin` or `end`), `requestId`,
`expectedRevision` (nonnegative safe integer) and `expectedPolicySha256`
(lowercase SHA-256). Mutations require the existing same-origin check. The
Gateway derives the current user ID/auth version after checking the active
operator role; callers cannot supply an actor. Normal, anonymous and revoked
operators cannot inspect or mutate this resource.

The state has a monotonic revision and either a hold or null. A hold records
its request, operator/auth version, policy digest and the persisted pause/resume
operation revision. Begin and admission share the original serial queue. An
already admitted exact key recovers its receipt before the hold check; a new
key is rejected. Bind, model/tool authorization, checkpoint/save and the
original release path have no maintenance rejection added. Existing execution
limits and kill/pause/quarantine rules still apply.

Begin checks the state revision, enabled/unpaused current policy and original
pin before atomically recording the hold and begin receipt. End requires the
same request/operator/auth version, state revision, policy pin/digest and
pause/resume revision. It requires zero original Beta unresolved slots/calls
and the original TrustedPiCapacity cold and retained-pair terminal proofs.
Idle, queued, held, dispatched, bound, releasing or partially released resource
records cannot become positive proof. End never reconciles/releases resources
or changes pause, quarantine, usage or reservations. Missing, malformed,
conflicting or unavailable authorities fail closed. There is no timer-based
resume and no new recovery/owner-transfer operation.

The native proof RPC runs only against `trusted-pi-capacity:application`, with
the current native policy version checked. It bypasses allocator constructors,
the mutating snapshot wrapper, promotion, pair retirement and alarms. Archive
readers retain their scoped contract and share the same terminal validators.
An entirely uninitialized cold ledger is missing proof, not a positive empty
pool. An absent optional paired family is allowed; a partial family is refused.

Both mutations return the original `receipt`, `replayed`, and **current**
`{revision, hold}`. Replaying a historical begin after end does not begin again;
replaying a historical end cannot clear a later hold. A caller must compare
current state with its exact original identity and revision. A historical ACK
alone is never evidence that its barrier currently exists. GET with the
original request ID recovers receipts after an unknown response without writing
or replaying the mutation. Request/input/actor conflicts are refused.

## Evidence and limits

`maintenanceStatus` reads the maintenance KV records, original policy/pin,
pause/resume audit revision and Beta ledger only. It does not pin, reconcile,
schedule alarms, release or call native/provider services. Existing Beta
constructor `CREATE TABLE IF NOT EXISTS` statements are separate initialization;
this is a method-level read-only claim, not a claim that every DO construction
performs zero writes. Native `maintenanceQuiescence` uses only original SQLite
reads and never initializes either allocator. Tests compare persisted tables,
KV and alarms across repeated reads and failed end requests.

These proofs describe original application ledgers and immutable release
receipts. They do not prove actual Cloudflare instances are absent, a rollout
completed, every other writer is fenced, or Legacy/G5/M3/M4 configuration is
closed. `actualContainerReleaseVerified` is explicitly false. Current kill
rejects end; pause/resume changes are durably detectable even if resumed.
The enabled boolean has no independent deployment epoch, so an unobserved
configuration off/on sequence cannot be inferred from its final value. A future
authorized runner must freeze/recheck deployment/configuration identities and
all execution gates, drain the original requests through existing authorities,
verify actual app/instance state, and stop on an unknown result. Cross-DO reads
are not a global lock; the Beta hold remains active while end awaits native
proof. This source change grants no maintenance, model, container, rollout,
deployment or payment permission.

Local tests use real Workerd SQLite/D1 and the production capacity classes;
Workspace/model/release outcomes are synthetic authorities and outbound network
is denied. They cover active work under hold, serialized admit/begin, strict
CAS/actor/policy conflicts, current kill and persisted pause/resume priority,
lost ACK/restart recovery, historical receipts, missing/corrupt state, retained
idle/partial release, inert reads and Gateway permissions. Existing Beta,
archive/native and paired regressions are run with typechecking. This is local
source validation, not deployment or authenticated/paid execution acceptance.

The implementation follows the installed Workers/Workerd versions and current
Cloudflare [SQLite and synchronous KV API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[storage synchronization](https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/#sync),
and [Durable Object rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).
