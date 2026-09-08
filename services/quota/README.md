# TenantQuota — internal runtime capacity coordinator

Each Tenant has one SQLite Durable Object, named with `tenantQuotaName(tenantId)` (`tenant-quota:<id>`). This module is a platform coordination primitive. It has no public HTTP handler, login substitute, model call or container dispatcher.

`TenantQuota` in `durable.ts` requires the private self namespace binding `TENANT_QUOTA` and server bindings `TENANT_QUOTA_CAPACITY` (decimal 1–64) and `TENANT_QUOTA_POLICY_VERSION` (identifier). Every RPC independently compares its actor ID with the self namespace's `idFromName`. The SQLite metadata row then pins Tenant, capacity and policy version. A different configured capacity/version cannot silently reset or increase the saved quota. It blocks new acquisitions/dispatch, while read, reconciliation and confirmed cleanup remain available under the pinned policy. Policy migration is a separate future operation.

Use SQLite class exports/migrations when integrating this class. No deployment configuration is added here.

## Private interface

`LeaseRequest` contains exactly `tenantId`, `projectId`, `workspaceId`, `generation`, `operation: 'workspace-runtime'`, `operationId`, and absolute `deadlineAt`. An independent service Run uses the same fields with `operation: 'service-run'` and an additional required `runId`; it must retain its real workspace identity. IDs are bounded platform identifiers. The fixed lease limit is 15 minutes; there is no heartbeat extension in this first module. Tenant, immutable ownership, generation, operation ID and deadline must come from the platform, not a project request body.

| Method | Result and meaning |
| --- | --- |
| `acquire(request)` | Atomic last-slot admission. `acquired` allocates one slot, `replayed` returns the saved decision, `denied` saves `quota-exhausted`, `workspace-held` or `run-held`. Allocation alone does not authorize a runtime dispatch. |
| `lookup(tenantId, operationId)` | Read the original acquisition decision and current lease, including after an uncertain RPC. A denied operation stays denied; a deliberate later attempt needs a new operation ID. |
| `dispatch(leaseReference(lease))` | Exactly one `authorized: true` result for the held lease's durable dispatch transition. A failed/unknown RPC is never replayed as a new dispatch permission. It checks state and deadline again after persistence. |
| `markUnknown(reference)` | Persist a lost/uncertain runtime outcome immediately; retain the occupied slot. |
| `reconcile(tenantId)` | Persist expired held/dispatched leases as unknown; return bounded occupied leases. It neither starts nor stops anything and never releases by TTL. |
| `snapshot(tenantId)` | Read-only quota/lease view. `expired` and the unknown count expose expired leases even before reconciliation runs. |
| `confirmStopped(reference, confirmation)` | Release only with the full matching lease ID, scope, generation, operation and deadline. A duplicate identical confirmation has `released: false`. |

`confirmation` has exactly `{ kind: 'runtime-stopped' | 'never-started', confirmationId, observedAt }`. `runtime-stopped` is accepted only from the trusted supervisor after it has verified the exact resource is stopped and fenced delayed work. `never-started` is limited to an unexpired `held` lease that has never dispatched; stopping and release are one transaction. Unknown or previously dispatched leases cannot use this shortcut. Observation timestamps are positive safe integers between allocation and the coordinator's current time. The platform constructs and correlates these receipts; a browser's `stopped: true` or arbitrary runtime output is not evidence.

The Workspace's Project binding is immutable. Workspace runtime generations and service Run generations are separate: a workspace runtime and multiple distinct service Runs may coexist, each occupying one tenant slot. Each Run ID is permanently bound to its workspace/project, with at most one occupied lease. A service generation never advances or fences its workspace runtime generation. The SQLite upgrade backfills workspace resource identities and preserves legacy lease JSON, stopped confirmations, and denied/acquired operation history in one transaction; reopening with coexisting services remains safe. A replacement lease requires a newer generation and the previous occupied lease to be confirmed stopped. Old lease confirmations remain idempotent and cannot touch replacement leases; confirmation IDs cannot be reused across leases. Acquisition decisions and stopped leases are retained to keep these fences. Retention/compaction is not implemented and must not simply delete idempotency history.

## Integration obligations and limits

Gateway derives the Tenant from real authenticated membership and checks Project ownership. Only the trusted WorkspaceAgent and runtime supervisor receive the namespace binding. `acquire` and a caller-supplied confirmation do not themselves implement authentication or prove a cloud process has stopped.

The dispatch receiver must validate the lease scope, generation and deadline immediately before the actual side effect and reject a stop fence. A stop confirmation must cover both the runtime and any delayed accepted command; checking only that a process is absent at one instant is insufficient. If acquisition or dispatch acknowledgement is lost, call `lookup` and reconcile the same operation. Never manufacture another generation or operation ID to evade an unknown occupied lease.

The controlling platform schedules reconciliation after expiry or a lost connection; this DO does not poll external resources or run an alarm loop. Unknown work deliberately holds quota until independent stop confirmation. This is concurrency allocation only, not token billing, cash accounting, an OS resource limiter or a claim that G1 has passed.

Transactions use synchronous `sql.exec` under `storage.transactionSync`, with explicit `storage.sync()` before successful mutation replies. SQL cursor results are fully consumed before awaiting. This follows the [current SQLite DO storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync), verified 2026-09-06 against installed workers types 5.20260905.1. SQL exceptions roll back; a failed persistence acknowledgement is unknown and never causes an automatic replay.

## Local verification

Run `node --test tests/m1/quota.test.ts tests/m1/quota-workerd.test.mjs tests/m3/service-quota.test.ts tests/m3/service-quota-workerd.test.mjs` and the repository TypeScript check. The existing root `test:m0` command does not include these M1 tests yet; the parent integrator owns that script change.

The first file uses actual on-disk `node:sqlite`, a real SQLite abort trigger, transaction rollback, reopen and controlled clocks. Its injected sync failures are contract doubles, not a Cloudflare durability claim. The second uses the existing Wrangler-locked Miniflare/esbuild packages and real local Workerd/SQLite DO RPC, including a two-project last-slot race, actor scope rejection, Workerd process recreation with the same storage directory, policy drift and stale-generation release. It has a test-only in-process dispatch adapter for internal RPC; other paths return 404. It disables outbound service traffic, uses no credentials and removes its private temporary state. No new dependencies are installed. These tests do not prove deployed namespace permissions, real user login, live runtime stop receipts or cloud G1 acceptance.
