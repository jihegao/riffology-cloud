# Recoverable project archives — #152

Archival adds `archived_at` and a monotonic `archive_epoch`. Runtime/provisioning
status, project/Workspace IDs and generation do not change. No project, Revision,
package, Run, fee, reservation or conversation is deleted. Restore clears the
archive marker using the same identity and does not replay a request or arm work.

The Gateway rechecks current owner membership and auth-version for every
Workspace mutation. An archived project's historical GET links remain available.
Workspace holds a persisted fence and leases every mutation across external
awaits. Preparing archive fails if another mutation is in flight. It then proves
initial provisioning stopped and released, Turn journal quiet (including resource,
release and recovery holds), simulation Runs released, groups terminal, no
pending wakes or Preview WebSockets, warm runtime capacity released, and Observer
and Service execution released. Standing Beta also checks matching pending or
quarantined capacity slots and unresolved model calls without monitoring,
releasing or retrying them. Legacy, G5 and Pi ledgers also return an exact-scope
metadata proof; unresolved calls in any generation still block that project, without rewriting
historical isolation manifests or billing. Every started historical Turn must
have released native resources; a warm handoff requires its exact persisted
physical lease to be released. Missing authority stays blocked.

The original TenantQuota is read directly without initializing or upgrading its
ledger. Any held, dispatched or unknown workspace/simulation/service lease for
the project, including an orphan lease or earlier generation, blocks archival.
Original G5 native grants are also read without opening a window. Unconfirmed
grants correlated to the project block it; a grant whose project cannot be
proved conservatively blocks its own tenant. A proved different project retains
its isolation and does not block this archive. These checks never stop, release,
expire or rewrite historical execution and fee records.

Browser package reads on archived projects skip build rearming. New Sessions,
Turns, Runs, Services, Verify, publication freezes, evidence edits and callbacks
are denied by the same fence. Public history and read-only export remain
owner-scoped. Operators gain metadata archive capability only; these routes do
not grant model/file/conversation access.

## Deployment and owner use

Apply `services/catalog/migrations/0012_project_archives.sql` through the existing
Wrangler deployment migration workflow before deploying its Gateway/Workspace
bundle. Do not issue SQL metadata patches. The Gateway needs no new binding.
Deploy the updated ServiceRun class (read-only release proof) and
PrivateBetaCapacity, TenantModelBudget, G5TenantModelBudget and PiDeveloperBudget
classes (read-only scope proofs), plus TenantQuota and G5ControlledWindow
(read-only original native-resource proofs) with the Gateway.

Owner requests use a fresh `Idempotency-Key`, an origin-validated authenticated
session and body `{}`:

- `POST /api/tenants/:tenantId/projects/:projectId/archive`
- `POST /api/tenants/:tenantId/projects/:projectId/restore`

`GET /api/tenants/:tenantId/projects` returns active projects and `nextCursor`.
Use `?view=archived` for archive history; `view=all` is also supported. Pass
`before=<nextCursor>` for subsequent pages (default/max 100). The cursor uses
`created_at DESC,id ASC`; equal timestamps do not skip or duplicate identities.
Owner project detail links work outside the current list page. The bilingual
user interface offers page navigation, archive and restore, preserves the
original request key after an unconfirmed response, and disables editing an
archived Workspace.

## Controlled migration

After deployment verification, an operator freezes the current invited personal
project scope once:

1. `POST /api/admin/project-archives`, body `{"cutoffAt": <Unix milliseconds>}`,
   with a fresh `Idempotency-Key`. The server freezes all current active invited
   owners and projects at/before the cutoff in a single D1 transaction.
2. Save the returned `id`, metadata-only `items`, SHA256 `digest`, `total` and
   `ownerCount` in private operation evidence. Only a redacted summary belongs in
   public Issue/PR evidence. Later-created projects are outside this fixed scope.
3. For each exact frozen ID, call
   `POST /api/admin/project-archives/:manifestId/projects/:projectId` with body
   `{"dryRun":true}`. This records a metadata audit and returns blocker codes.
4. Select eligible items and send the same route with `{"dryRun":false}` and a
   new, retained per-item attempt key. Never start provider/Turn/Run work to make
   an item eligible. Every attempt rechecks operator and owner auth-version,
   invitation, frozen scope, runtime quiescence and provisioning/outbox. Final
   metadata/epoch, immutable receipt and audit commit in one D1 batch behind the
   Workspace fence.
5. `GET /api/admin/project-archives/:manifestId` returns the unchanged frozen
   items/digest plus immutable receipts and current `states`. Reconcile every
   frozen ID against its completed receipt and `archived_at`/`archive_epoch`.

A blocked receipt remains blocked when replayed under its original key. Resolve
its original execution/release identity separately, then use an explicitly new
attempt key for that same frozen item. An unknown/lost response must retain the
original key: replay reconciles its committed receipt/fence without executing
work. If Catalog remains unavailable, the persisted fence stays closed.

Declare full migration only when all frozen IDs have matching completed
receipts/current archived metadata and there are zero unexplained exclusions or
blockers. A revoked identity, unknown execution or unreleased warm capacity is a
real blocker. Do not create a new project/window/policy to bypass it.

## Temporary deployment-only operator

`scripts/model/project-archive-operator.ts` provides the same metadata workflow
when the operator UI has no archive controls. It is a separate, removable Worker,
never imported into the product Gateway. Its checked-in Wrangler config is inert
with `PROJECT_ARCHIVE_OPERATOR_SCOPE_JSON="{}"`. It binds only the existing
Catalog D1 and the existing Gateway's WorkspaceAgent namespace, with no new actor
class, migration, provider, runtime, content or billing binding. The release
coordinator deploys and removes it after review; this implementation does not
authorize or perform deployment itself.

Keep a random capability secret of at least 48 characters in
`PROJECT_ARCHIVE_OPERATOR_CAPABILITY`. In a private local config, freeze:

```json
{
  "schemaVersion": 1,
  "expiresAt": 1790800000000,
  "operator": {"userId": "existing-operator-id", "authVersion": 1},
  "cutoffAt": 1790799900000,
  "freezeRequestKey": "retained-freeze-key"
}
```

Replace the example timestamps with the selected cutoff and an expiry at most
30 minutes in the future. Every request rechecks the exact operator's current
role/auth-version through ProjectArchives. Use only `POST /operate`, with
`Authorization: Bearer <capability>`, `Content-Type: application/json` and the
exact header/body below. The input cannot supply a tenant, new key, owner or
execution arguments.

| Action | Body | `X-Project-Archive-Mutation` |
| --- | --- | --- |
| Freeze | `{"action":"freeze","confirmation":"freeze-invited-project-metadata"}` | retained freeze key |
| Read | `{"action":"read-manifest","confirmation":"read-frozen-project-metadata"}` | frozen manifest digest |
| Dry-run | `{"action":"dry-run","confirmation":"check-frozen-project-archive","projectId":"frozen-id"}` | frozen manifest digest |
| Archive | `{"action":"archive","confirmation":"archive-frozen-project","projectId":"frozen-id"}` | frozen manifest digest |

Freeze is available only before a manifest is added to the scope. Save its
metadata response privately, review every item, then add:

```json
{
  "manifest": {
    "id": "archive-retained-freeze-key",
    "digest": "exact-returned-sha256",
    "items": ["copy the complete returned metadata item objects in order"],
    "attempts": [
      {
        "projectId": "first-frozen-id",
        "dryRunRequestKey": "retained-first-check-key",
        "archiveRequestKey": "retained-first-archive-key"
      }
    ]
  }
}
```

This snippet illustrates the additional field; `items` must contain the real
objects, not the placeholder string. Its fields are `project_id`, `tenant_id`,
`owner_user_id`, `workspace_id`, `generation`, `auth_version`, `created_at`.
The full item list must match the immutable server manifest/digest exactly,
sorted by project ID. `attempts` has one matching item in that same order; every
dry-run/archive key is fixed and unique. The helper derives tenant, Workspace,
owner and keys from this scope. It rejects any project outside it. A blocked
attempt remains blocked under its retained key; a reviewed new attempt requires
an explicitly revised private scope after resolving the original blocker.

Expiry is checked after reads/proofs and immediately before Catalog batches and
Workspace prepare/finish. If expiry interrupts preparation, only the original
held operation's business-path abort may clean up its fence. A committed unknown
response still uses its original key for reconciliation in a newly reviewed
short scope. All responses contain metadata only, use `no-store`, and are capped
at 256 KiB. Neither the scope nor capability is logged or returned. Revoke the
capability and remove the temporary Worker after independent receipt/marker
readback, retaining the private manifest and keys as operation evidence.

## Evidence boundary

2026-10-01 implementation verification is local: Catalog/SQLite owner,
revocation, frozen-manifest and pagination tests; production Workspace/D1
Workerd archive/blocked-Run/restart/late-callback/restore tests; browser history,
page navigation and original-key retry tests; existing project/runtime suites.
These fixtures use no provider calls and do not establish current authenticated
production acceptance. Deployment readback, frozen production manifest and the
actual per-item migration remain required and belong in #152/#148 and the release
index when executed by the root release coordinator.
