# Lazy Project Sandbox — issue #37, milestone B

This milestone implements on-demand ProjectToolSandbox preparation. It does not
implement workspace reuse or change online configuration. `M2_LAZY_PROJECT_ENABLED`
is enabled only by the exact string `true`; the default remains the cold path.
The Runtime persists its selection before native admission. Existing runtime rows
remain cold; a selected lazy runtime retains its protocol after gate rollback.

A conversation that calls no project tool verifies the saved archive in R2 and
creates a new Session/Revision manifest referencing the same content-addressed v3
files blob. It does not restore, freeze or destroy a Project Sandbox. Files, Diff,
model inspection and export keep using immutable saved data.

The private ToolBridge → Workspace → Runtime → Project preparation path validates
current authorization, execution identity, cancellation and both deadlines. The
first tool reserves one durable preparation operation and concurrent requests
join it. Subsequent observations cannot repeat restore. A lost acknowledgement
can recover an existing receipt; an interrupted restore remains unknown and the
original tool command is never replayed. Cancellation writes a receiver tombstone
even if preparation has not arrived. Native absence prevents a new SDK read from
silently reconstructing an empty project. Snapshot and release continue to use
the existing full release protocol, including its 360-second assignment guard.

`project_prepare_result` and `project_skipped_count` are bounded lifecycle samples
through TurnOperationTrace. Durations measure individual in-process stages with
`performance.now()`; retries can produce additional samples and they must not be
summed as unique Turn counts. Native calls and observed container counts are
recorded separately by the local acceptance fixture. No performance improvement
has been inferred from provider-disabled timing.

## Local validation

- Typecheck and 74 targeted tests passed: real SQLite once-only preparation,
  cancellation before dispatch and during restore, unknown outcome, reconstruction,
  rollback, actual release assembly, existing Runtime regression and real Workerd
  storage/RPC response-loss recovery.
- [Provider-disabled native evidence](evidence/runs/m2-product-turn-lazy-provider-disabled-20260914080938293/primary-review.json): actual Gateway, Workspace, Runtime, ToolBridge bindings, D1/DO/R2 and Docker.
  Two Turns saved different Session/Revision data with the same files object key;
  Project preparation/restore/freeze/SDK calls were zero and no ProjectToolSandbox
  container was created. Two TrustedPi containers were observed. The corrupt-base
  Turn failed without creating another Sandbox, queued cancellation survived
  reopening, and Workerd restart retained the saved identities. External Worker
  fetches and model-budget dispatches were zero.
- That raw record predates a report-field correction: its legacy
  `restoreAssertions.freshProjectAndTrustedPiContainers: true` is not evidence of
  Project creation. Use the explicit `firstProjectNativeCalls`,
  `restoredProjectNativeCalls` and `resourceCounts` fields. Future reports use
  `freshTrustedPiContainer` and `projectContainerExpected` separately.
- The fixture initially required repairs for a missing capacity binding/export,
  obsolete terminal-container-presence assumptions, an insufficient 120-second
  wait for the unchanged 360-second release guard, and Docker list/inspect races.
  Failed attempt records remain under `.local/lazy-native-attempts`; none is a
  successful acceptance record. Cleanup now targets only this run's worker names.

Run `node scripts/m2/check-product-turn-local.mjs --lazy` for provider-disabled
persistence/recovery, or add `--crud` for the deterministic native file-tool path.
These are local runtime checks, not cloud acceptance or real-model quality tests.
The completed CRUD acceptance is recorded below.

On an arm64 Docker VM translating the amd64 SDK image, use the explicit
`--vertical-project` local fixture option. It selects the existing
`Dockerfile.vertical` and records that image's Workerd deny-all egress boundary;
the production image and default fixture still require the child seccomp fence.
The image marker is checked after building. This option does not establish that
the production native isolation primitives work on the target kernel.

The first CRUD attempt exhausted the local 4 GiB Docker VM. A serial attempt
with 8 GiB completed Project preparation, then failed its tool-success assertions.
A separate no-network probe of that exact Project image identified
`project-network-seccomp-load-failed:-125`, the existing translated-amd64
limitation. Both failed raw records remain preserved; neither proves successful
CRUD or authorizes replaying its unknown tool operations. The local fixture
option above changes only the environment for a new acceptance run.


## Final milestone B review

The [final native CRUD record](evidence/runs/m2-product-turn-lazy-crud-fixture-20260914090031764/primary-review.json)
passed on code commit `4a67f28342f95a49d75558179cac9d07b1a4088b` with identical
before/after source digest. Its 21 first-turn tool operations (directory setup
plus 20 mutations) and four restored reads succeeded. Each Turn prepared Project
exactly once; two Project and two TrustedPi containers were observed across the
intentional container-loss recovery. Saved file hashes matched, Session hashes
advanced, and actual Workerd restart preserved both checkpoints. Corrupt-base
rejection, queued cancellation, tenant separation and seven identity mutations
passed. External fetches and model dispatches were zero; cleanup left no running
containers. This used the explicitly recorded local vertical image boundary and
an 8 GiB Docker VM, not production-kernel or model-quality acceptance.

The preceding vertical-image attempt completed both tool/save paths but exposed
a release race: sealing during destroy could restart a container already removed
by the recovery fixture. Project teardown now relies on the durable admission
fence and SDK destroy/absence checks without launching a sealing process.
Snapshot freeze still requires the native seal. Independent actual-class Workerd
review covered teardown acknowledgement loss, restart, rejected late preparation
and unchanged snapshot sealing. The full `npm run check` on the frozen final code
passed with 1,748 tests passed and 6 skipped. This final evidence-only update does
not change that tested code. Earlier failed records are retained locally and are
not counted as successful acceptance. Workspace reuse remains a separate stage;
no online gate was changed.
