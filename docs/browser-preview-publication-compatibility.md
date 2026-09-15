# Browser Preview publication and copied-project compatibility

Status: design from a read-only G6 compatibility audit on 2026-09-15. Ordinary-user G6 publication → approval → library copy → local run has not been executed. This document does not introduce a source grant, saved Turn, migration, deployment or acceptance claim.

## Current source and freeze boundaries

| Code or migration | Existing authority and limitation |
| --- | --- |
| `services/publication/readiness.ts`: `publicationContent`, `FrozenPublication`, `preparePublication` | Publication preserves every allowed `model`, `app`, `experiments`, `docs` file as original bytes; README is regenerated on copy. Thus the five preview sources survive. Freeze contains readiness, research export and content bytes/digests, with no browser runtime association. |
| `services/publication/artifacts.ts`: `StoredPublication`, `R2PublicationArtifacts` | Content-addressed create-only content/export artifacts, exact length/digest readback, and authorization around writes. No browser profile field exists. |
| `services/catalog/submissions.ts`: `ModelSubmission.snapshot_json`, approval/publishing | Freezes `StoredPublication`; approval creates the immutable catalog version and validates original content before publishing. A runtime association is not currently passed into a copy. |
| `services/catalog/models.ts`: `ModelVersion`, `contentReference` | Model versions expose immutable content reference/digest. Copy resolves this version rather than a mutable originating workspace. |
| `services/workspace/protocol.ts`: `ModelContentRef`, `WorkspaceTask` | `ModelContentRef` has exactly modelVersionId/modelId/version/contentRef/contentSha256. Provisioning freezes this reference. It has no browser profile metadata. |
| `services/catalog/provisioning.ts` | Projection checks copied model provenance against the frozen outbox source and verified content receipt. |
| `services/turn-runtime/initial-workspace.ts`: `InitialWorkspaceReference`, `ResolvedInitialWorkspace`, `InitialWorkspaceResolver` | A server-confirmed ready projection supplies task/runtime/marker/checkpoint authority. Resolver verifies the immutable initial checkpoint and original model content, then returns referenceSha256, filesArchive and filesSha256 for the copied workspace. Its type explicitly distinguishes initial provenance from an Agent Turn. |
| `services/turn-runtime/revision-store.ts`: `resolveInitial`, `serviceFiles`, `initialPreviewPlan` | Private scope-checked initial source resolution already exists; it requires no new HTTP source selector or live Pi process. |
| `services/workspace/durable.ts`: `#initialWorkspace`, `#simulationSource` | Existing server simulation uses an authoritative initial-workspace source when no saved Turn exists. Browser orchestration currently resolves only saved Turn snapshots. |
| `services/browser-preview/discovery.ts`, `build-host.ts`, `orchestrator.ts` | Saved journal discoveries and receipt/source checks are saved-Turn-specific. A copied workspace without a Turn currently has no browser build revision. |
| `services/browser-preview/execution/delivery.ts` and generated static index | Runtime asset identity selects its frozen host/renderer delivery version. Retained packages must retain their actual profile and delivery bytes; unknown historical versions fail explicitly. |

Relevant current migrations are `0006_model_catalog.sql` (immutable versions, project/outbox model source fields and consistency/immutability triggers), `0007_model_content_checks.sql` (immutable verified content receipt checks), and `0009_model_submissions.sql` (candidate snapshot and review lifecycle). The older provisioning tables originate in `0001_catalog.sql`/`0003_provisioning.sql`. None currently defines a browser runtime snapshot. In particular, the content-check trigger validates the exact current receipt shape; adding fields there casually would break that invariant.

## Minimal mandatory change: trusted initial browser source

Introduce a browser-owned discriminated source record, preserving the existing saved-Turn variant and adding an initial-workspace variant. The initial variant carries the validated InitialWorkspaceReference, referenceSha256 and verified filesSha256. Only the confirmed Workspace ready projection and private resolver may supply it. A request, project file or client package must never supply a runtime reference, R2 key or model-content authority.

Derive a browser-domain opaque initial source ID from the canonical reference digest, for example `initial-<referenceSha256>`. This can occupy the existing package's opaque revision identifier after contract review, but is explicitly initial provenance in source records and UI. It is not a Turn checkpoint receipt, session checkpoint or fabricated saved journal row. Copied project identity and its regenerated README produce a new scoped archive/package identity; do not reuse the originating workspace's package or receipt.

Persist an initial discovery/source intent and merged browser wake from a trusted ready-projection transaction, or a bounded existing maintenance step whose intent is rearmed before private resolution. GET must remain read-only, including the first page open. Persist source identity before packaging/R2 PUT; read back immutable bytes before a ready receipt. Recheck scope and the confirmed initial reference after asynchronous resolution. Missing/corrupt original content fails closed, without an empty starter or current-head fallback.

Generalize browser view/package/Verify resolution through this discriminated source. Verify should reuse the existing initial-workspace PreviewSource and SimulationHost path for the same frozen copied source. It must never mint a fake saved Turn to satisfy a saved-only branch. A later real saved Turn becomes a separately identified current source; the initial package remains historical and scoped to its original reference.

## Runtime choice: two valid product policies

The minimal policy may deterministically generate a new package from the frozen copied source using a currently verified platform profile. This does **not** require inheriting the publication's original runtime. It requires clearly recording and displaying the new runtime/profile/adapter/dependency/asset identity, binding it into the new package identity, and retaining that exact snapshot and delivery version once built. A later registry update must not silently upgrade an existing initial package or rebuild receipt. Unsupported source locks or unavailable assets produce an explicit compatibility reason. Source provenance and runtime provenance are separate, auditable identities.

Under that policy, no catalog schema expansion is required solely to obtain browser execution. The current immutable ModelContentRef plus trusted initial reference provides source authority. Browser-domain build records freeze the newly selected runtime. Add only the source variant and orchestration needed to build it; preserve catalog/model-content receipt validators.

If the product instead promises that a library copy inherits the publication's exact browser runtime, frozen runtime metadata becomes necessary. Freeze a verified compatible runtime association from the authoritative publication source and durable browser row, digest-bind it to the immutable publication/catalog version, carry that association through provisioning, and resolve its retained platform delivery on copy. This is an optional stronger promise, not implicit in retaining five source files. It would require a narrowly scoped migration and updates to StoredPublication/catalog version selectors/copy reference validators and their immutability checks. A caller-provided manifest is never enough. Do not add these fields or change the exact content receipt shape until that policy is chosen.

Both policies require the same immutable five-source checks, canonical server adapter, fixed source lock, explicitly identified profile, private package receipt, historical delivery retention and independent server Verify. Neither policy treats browser metrics as trusted results or implies scientific validity.

## Required acceptance

- Publish through the ordinary authenticated readiness/freeze/review/approval path, then copy through the library UI; no direct D1 seed or fabricated journal state substitutes for this flow.
- Compare all five copied source bytes/digests with the approved immutable content. Prove the initial checkpoint/reference and copied project scope resolve before any model run.
- Confirm discovery/wake survive transaction failure and object restart, and actual maintenance builds before any page GET. GET restoration must not write, build, invoke Pi or create an Experiment.
- Run both supported copied models in the real browser runtime, then Verify the exact initial source through the native server path and export. Check package/source/runtime identities, not only UI text or healthy endpoints.
- Save a real later Turn and confirm initial/history packages cannot mutate its head or inherit its runtime silently. Exercise unknown R2 acknowledgement/receipt restart reconciliation and bounded exhausted retry.
- Tamper model content, initial reference, scope, source digest, canonical wrapper, lock and profile/delivery version separately; each must fail without fallback or source authority expansion.
- For the new-runtime policy, update the platform registry and prove an existing copied package keeps its frozen version while an explicitly new package gets a distinct declared runtime identity. For the inherited-runtime policy, prove the catalog association is immutable and a missing old delivery fails rather than upgrading it.
- Preserve evidence linking approved catalog version/content digest → copied initial reference/files digest → package/runtime asset identity → independent server experiment/export. Existing server Preview remains available.

These checks remain required and unexecuted for the ordinary-user G6 loop. Earlier isolated publication/content fixtures or G1 browser cases do not constitute that loop's acceptance.
