# Browser Preview orchestration

G2A freezes these authenticated Workspace routes. Reads never create builds or execute models.

- `GET /api/workspaces/:workspace/browser-preview?revisionId&profileId`: `{currentRevisionId,revisionId,build,stale,modelSpec,reasonCode,delivery}`. Optional identifiers are validated; omitted Revision selects the authoritative saved head. No saved head returns `preview-no-saved-revision`; unclassified durable discovery returns `preview-discovery-pending`, without inventing a profile. An old Revision remains read-only and its own build cannot update the new head.
- `GET /api/workspaces/:workspace/browser-preview/packages/:packageIdentity`: canonical UTF-8 envelope bytes, only through an authorized, durable server receipt. No client object keys or fallback to head.
- `POST /api/workspaces/:workspace/browser-preview/verify`: exactly `{revisionId,packageIdentity,parameters,seed,intent:'experiment',idempotencyKey}`; returns `{verificationId,experiment}`. The server loads the exact frozen saved source, checks the canonical platform adapter, and recomputes using existing SimulationHost. Browser results are not inputs or Evidence.
- `GET /api/workspaces/:workspace/browser-preview/verify/:key`: `{verificationId,status:'absent'|'accepted',captured,experiment}`. Captured intent contains Revision/package/input identity. Refresh does not mint a key or submit; absent recovery requires explicit retry of the original captured intent.

`delivery` contains `{executionOrigin,hostModule:{url,sha256,byteLength},rendererModule:{url,sha256,byteLength},assetBaseUrl,profile}`. Execution origin is a fixed platform configured independent HTTPS site. App assets are immutable digest/path whitelist bytes, with no credentials forwarded to the assets binding. Profile snapshots come only from verified platform registry and are retained with their immutable delivery identity; no client manifest is trusted. Unknown or unavailable historical runtime assets fail explicitly, never upgrade a package silently.

## Persistence and recovery

The saved checkpoint journal transaction writes a discovery record with the private exact Turn identity and receipt, the sixth logical build wake, and the merged physical alarm. This applies equally to completed, failed, cancelled and interrupted saved Turns. The journal operation remains synchronous with no external I/O; storage transaction operations are asynchronous. All legacy migrations and initial-base preservation checks remain enabled. `sync()` acknowledges durability; it does not repair a separately committed alarm gap.

Every alarm mutation preserves workspace, Turn, service, observer, simulation and browser build wakes. Maintenance finally blocks visit browser build even if an earlier domain throws. R2 packaging is separate, create-only, with durable source reference intent before PUT and digest/length readback before receipt. Retry attempts and per-delivery work are bounded. Model generation, Pi and release are not prerequisites for maintenance.

Historical source authority remains the saved journal row and its immutable RevisionStore manifest. RevisionStore orphan collection scans retained manifests and does not delete those references; browser package keys are outside the Turn orphan prefix. Build reference records supplement this inventory and must not be removed while a receipt is retained.

Library copies currently have a trusted initial-workspace archive but no saved Turn. Their browser build requires a separate initial-derived source identity and authorization contract in G3/G6; this phase does not fabricate a saved Revision. Existing server Run remains available.

## Validation status

Core persistence: 34 targeted journal/store/shared-alarm/router regressions pass. Real Workerd SQLite test passes an injected failure after physical setAlarm (journal/discovery/wake/alarm all roll back), then successfully saves, restarts Miniflare with persisted storage, and observes actual alarm delivery before any page/request opens the Object. This validates the storage primitive and discovery boundary; durable build host additionally passes six tests with real five-file tar archives for both production profiles, create-only PUT acknowledgement loss, receipt transaction rollback/restart same-key reconciliation, three-attempt termination, unknown dependencies, and an earlier retry preserved across a later save. Full Workspace binding, authenticated routes and browser acceptance are still in progress.
