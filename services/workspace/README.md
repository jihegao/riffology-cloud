# M1 workspace initialization

`WorkspaceAgent` is a private SQLite Durable Object. The Gateway supplies an
already authorized D1 provisioning task, and the actor independently checks its
name and the complete immutable task against Catalog. `taskKnown` establishes
the stored task identity; `verifyTask` separately checks current authority. An
authentic expired or revoked task can therefore receive a failure projection,
while an invented task cannot pin the actor.

The actor accepts one task and one generation in M1. An identical `accept(task)`
returns the existing state; conflicting tasks fail. Its runtime UUID and public
marker nonce are generated once and persisted. Quota operation ID is always the
outbox task ID. `runtimeName(identity)` returns that same UUID; neither a caller
nor a recovery attempt can select a replacement runtime.

Initialization proceeds through:

1. Acquire the tenant's shared workspace-runtime lease.
2. Check current task authority, obtain the quota's single dispatch permission,
   check authority again and reserve one runtime initialization intent.
3. Initialize through the fixed `PROJECT_RUNTIME` binding. Its receipt must
   match the full identity, canonical marker digest and checkpoint digest.
4. Persist `runtime_ready`, request the runtime's stop fence, and observe a
   receipt containing `nativeRunning: false` and `fenced: true`.
5. Release exactly that lease using the native stop confirmation; only then
   project `ready` through Catalog. A ready M1 project has a recoverable initial
   workspace and a stopped runtime, rather than an indefinitely idle VM.

`DurableWorkspaceStore` uses the SQLite DO storage transaction API for **both
state and its next watchdog alarm**, then waits for `storage.sync()`. No external
RPC runs within a storage transaction. A persisted effect includes an owner and
deadline; a process restart does not recreate dispatch permission. All helper
methods use private JavaScript fields, and the actor has no `fetch` endpoint.

The public-to-the-platform RPCs are `accept(task)`, `report(task)`, `stop(task)`
and `reconcile(task)`. They require the complete original task. Binding names are
`WORKSPACE_AGENT`, `TENANT_QUOTA`, `PROJECT_RUNTIME` and `CATALOG`. Namespace
bindings must never be given to project code or exposed as a generic HTTP/RPC
forwarder. These interfaces do not implement user authentication; the Gateway
must authorize the caller and select its task from D1.

## Uncertain effects and bounds

Each runtime `initialize` and `stop`, and each quota `dispatch`, has one durable
intent. A timeout, response loss or eviction never replays those writes. The
actor observes the same runtime identity; stop-before-initialize must persist a
runtime tombstone so a late initialization cannot start after cleanup.

Only quota `acquire` and `confirmStopped` may be resubmitted: the existing quota
adapter atomically deduplicates the complete operation/lease and confirmation.
Every resubmission first performs a lookup, uses the identical payload or proof,
and consumes one of three persisted attempt slots. Reconciliation never resets
those slots. This covers an intent committed immediately before its RPC was
sent, without granting a second initialization. A null quota lookup alone never
proves that a possibly in-flight acquisition cannot commit. An unknown or expired
lease continues to count until the exact native stop proof is acknowledged.

D1's task deadline is fixed at claim (180 seconds). The coordinator allows a
60-second cleanup window, bounds each RPC wait at 10 seconds, polls at 2 seconds,
and bounds a window at 128 effects, reserving its last effects for cleanup. The
actual RPC promise remains observed through `waitUntil` after a local timeout;
the timeout is not presented as proof that remote execution stopped. Unresolved
work becomes an explicit `unknown` receipt, preserving its lease and all intents.
Alarm work then ends instead of displaying a fictional running/ready state.
An explicit trusted reconciliation opens one more bounded observation/cleanup
window; it cannot start another runtime.

Catalog projection has its own three-attempt bound, using the same persisted
receipt ID, sequence and payload. After a Catalog outage, another `accept` or
`reconcile` resumes an unacknowledged projection. Only an acknowledged terminal
projection stops that path permanently. An acknowledged `unknown` receipt may
later advance to a terminal receipt after independent cleanup evidence arrives.

## Validation scope

- `tests/m1/workspace.test.ts` uses actual disk SQLite and transactions for
  coordinator state and TenantQuota. It exercises response loss, intent/flush
  uncertainty, process reconstruction, revocation, stale scope, cancellation,
  deadlines, three-attempt limits and projection recovery. Catalog and native
  runtime observations are explicit contract doubles.
- `tests/m1/workspace-workerd.test.mjs` runs the production WorkspaceAgent,
  TenantQuota and Catalog code with actual local Workerd, SQLite DO storage, D1
  and alarm delivery. It exits and restarts Workerd after a lost runtime response,
  verifies a single initialization and stop, and independently reads the final
  D1 projection and quota. Its runtime is a named durable receipt fixture.

These tests do not establish cloud deployment, native Container file creation,
R2 persistence, end-user authentication or G1 acceptance. The real
`services/runtime` adapter and the platform's separate end-to-end diagnostic must
provide those observations. No provider credential, arbitrary URL, project code
or model invocation is part of this module.
