# Restricted manual-save release preparation — 2026-10-16

This is a production preparation candidate on top of [PR #221](https://github.com/jihegao/riffology-cloud/pull/221), owned by jihegao under [#214](https://github.com/jihegao/riffology-cloud/issues/214). The user authorized implementation, checks and direct deployment of a bounded manual-save slice. This record does not claim a deployment or an authenticated acceptance result.

The implementation commit is `482522f352aea2c747497a659eb8d879637e78c2`, based on PR #221 HEAD `814d206a42c1ae77914fe470691135b8581e0c9e`. All work is in an independent checkout. The original stopped task's patch and other dirty work are untouched.

## Scope and authority

`MANUAL_SAVE_POLICY_JSON` independently controls production manual saves. With no policy, production is denied. Existing distinct loopback origins retain the original local candidate behavior. A configured policy never falls back to loopback admission when malformed.

The exact policy shape is `{schema:"manual-save-policy/v1", enabled:boolean, startsAt:integer, endsAt:integer, scope:{tenantId,projectId,workspaceId,workspaceGeneration}, actor:{userId,authVersion}}`. All fields are required; the bounded interval is at most 24 hours. The approved release must use only the user's designated ordinary identity and one newly created owned project/workspace, with an explicitly frozen start/end. No enabling policy is included in this candidate or applied to production.

Gateway and Workspace both enforce scope before manual storage access. An operator role is not a bypass. Production requests are UTF-8 text only, at most 8 KiB per file, 8 changes/deletions and 24 KiB for the JSON request. This fits the unchanged signed Entry limit of 32,768 bytes. Binary/base64 changes and NUL-containing text are rejected. The UI reads the server capability and displays the same limits; unready, archived and standalone workspaces do not initiate the editor capability request.

Disabling or expiring a retained exact policy stops **new operation keys**. Authorized reads and explicit recovery of an existing original key/body remain available. Recovery still checks the current Catalog identity and membership, exact request digest and original durable fence. It cannot migrate to a different user, authVersion, generation or project. Do not delete the scoped policy as a substitute for stopping it, since that also removes receipt recovery access. Unknown writes keep their journal/fence state. There is no automatic provider invocation or fallback.

Production generic project pages remain closed by their independent dual-loopback gate. OAuth, invitations, roles, Entry, provider gates, G5/M3/M4, existing project data, ledgers and purge behavior are outside this release's mutation scope.

## Storage compatibility and retained-data stop path

The v9 in-memory reader supports historical journals. Normal workspaces serialize back to the exact v7 fields while they have no manual operation/rejection history and have never persisted v8/v9. A manual reservation or rejection selects v9 permanently; subsequent ordinary writes do not erase or downgrade it.

The production main v7 validator and its original protocol were exercised offline against new ordinary session, cancellation and saved-checkpoint writes. Those states remain readable. That validator correctly rejects manual v9 history; the candidate reader retains it. The actual Workerd cold-recovery test also proves a denied manual RPC produces no SQLite changes or outbound requests and ordinary maintenance persists v7.

After any manual history has been written, a raw rollback to the current production Worker is **not** an acceptable stop path. Deploy a forward-compatible build retaining this reader, manual receipts, canonical head and fence logic, with the same exact policy changed to `enabled:false`. Keep R2 manual revisions/blobs, journal operations/rejections, immutable assets, namespaces and migration 0013. Do not delete fences, downgrade journals, remove the trigger or clear unknown operations. A production-frozen fallback version/readback is still required before enabling the scope.

## Migration and release sequence

`0013_manual_save_fence.sql` adds one strict table, two indexes and three triggers. It prevents revocation/auth-version changes while the same user's manual publication is pending, including a race with the old handler; released fences are immutable and retained. No existing rows are rewritten by the migration. Local SQL tests cover missing schema, migration detection races, revocation races, lost acquire/release ACKs and immutable tombstones.

Before a production write, compare the fresh deployment/version and complete settings digest with the frozen snapshot. Preserve all 99 bindings (secret references only), 23 SQLite exports, five Worker container associations and all 15 account application configurations. Preserve the 92 prior assets, including 68 immutable assets and their historical runtime profiles; the prepared merged asset set has 95 files. The local archive was checked against its release manifest. New live byte readback remains a release step.

Apply 0013 only after the release candidate and fallback are reviewed. Read its schema and migration ledger back, preserve a D1 recovery bookmark and verify retained row counts. Do not infer successful migration from a lost response or rerun it blindly. Upload the exact frozen source/assets with production manual admission absent/disabled, read back bindings/runtime/module and static asset hashes, then deploy only that verified version. Do not deploy from the repository staging template: it is not the authoritative live configuration.

Enable only after the real theidsa browser session identifies the intended ordinary owner and a newly created project/workspace through normal application paths. Record its exact IDs, generation, authVersion, time window, initial revision/hash and operation key. Perform one small explicit save, compare returned immutable identity and canonical Files state, refresh/reopen, verify original-key recovery, and use the separate Gmail account for a denied cross-owner read/save. Confirm the original scope has no pending manual operation/fence or runtime/tool/container residue before ending the window. Do not start a model Turn or simulation to manufacture evidence; stop for any extra fee or new credential/security requirement.

## Current evidence and remaining conditions

At 2026-10-16 00:52:40 UTC, production Catalog reads show `jihe.gao@theidsa.org` is an active ordinary owner with authVersion **2**, and `jihe.gao@gmail.com` is an active operator owner with authVersion **1**. Both personal tenants and memberships are active. This proves existing roles, not a current browser session. The production application entry is the observed `https://app.riffoid.com`; no new URL is invented.

The active Gateway remains version `d9ceec61-1e5f-48cc-8a51-3abdb4b06614`, deployment `54f253dd-c7b3-4407-867d-b9856642c1ff`, 100%. The live Catalog migration ledger still ends at 0012; neither manual fence table nor trigger exists. Production settings contain no manual policy. The current execution origin remains the existing Browser Preview service, not the local isolated Chromium host.

All applicable check components pass after the recorded corrections: UI 21; M0 353 plus 1 conditional skip; M1 561; M2 1011; M3 1030 plus 12 conditional skips; runtime/execution 20; phase checks 13; model checks 92; archived experiment checks 30; Python 8; typecheck and diff checks. This totals 3131 Node passes and 13 skips. The initial aggregate invocation failed on the new i18n key guard, then on stale journal-format expectations and strict browser fixtures missing the new read-only capability endpoint. The failed invocations are not relabeled as passes; corrected complete affected suites passed. The new focused policy/recovery/UI checks and original v7 validator proof do not replace real-user acceptance.

Remaining before production execution: independent review of this new delta, production-frozen forward-compatible fallback, the genuine ordinary browser session and one new authorized project/workspace. The local Wrangler OAuth expired on October 14 and was not renewed; the existing Cloudflare connector remains usable for metadata reads, but no source/asset upload has been attempted. No production migration, upload, deployment, role/invitation change, login, project creation, provider call or paid execution was performed in this preparation.

[Sanitized evidence](../evidence/releases/manual-save-restricted-production-20261016.json) records hashes and checks. Project fields cannot be synchronized with the current GitHub CLI token because it lacks Project scopes; no additional scopes were requested.
