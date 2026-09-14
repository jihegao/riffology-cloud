# Reproducible project export

The normal workspace Export panel downloads `GET /api/workspaces/:workspaceId/research-export` as an attachment ZIP. The route uses Catalog maintenance authorization, so a saved failed workspace can still be inspected. The Workspace rechecks caller authorization before reading and after building. Export is read-only: it does not start a model, acquire simulation capacity, mutate a Run, or invoke the Agent. Only an explicit click requests a download; the client verifies the ZIP SHA-256 response header before saving it.

## Frozen selection and package layout

A single Workspace storage transaction selects the current saved source, all retained Run/group records, and all retained evidence claims/assessments. It uses ordered pages of 50 records. Later model edits, run completions or evidence rejections do not change that package. A model change during initial snapshot selection rejects the request instead of mixing heads.

The version-1 manifest contains export/project/workspace identity and time; current source/revision; each referenced saved source's original archive hash, exact Spec hash and revision aliases; every group and Run identity/status; result locations; and an inventory of packaged file hashes and sizes. It contains no tenant auth state, runtime capability, private Session checkpoint, or control-plane receipt. Evidence authors retain only user ID attribution, without auth versions.

- `sources/<files-sha>/source.tar`: exact canonical saved workspace archive, deduplicated by file hash.
- `sources/<files-sha>/model-spec.json`: exact original Spec bytes, not a reserialization.
- `environment/<files-sha>/requirements.lock` and `requirements.txt`: verified execution dependency lock and exact supported packages.
- `experiments/<group-id>.json`: frozen hypothesis, configurations, seeds, status and planned child identities, including children cancelled before admission.
- `runs/<run-id>/run.json`: public frozen Run, model identity, input parameters/seed, runtime image and release state.
- `results/<run-id>/result.json` and `outputs/`: original platform result-envelope and declared artifact bytes, checked against the selected Run's identity and hashes.
- `evidence/claims.json` and `assessments.json`: saved proof and rejection records. References must match the exported Runs, result hashes and versions.
- `README.md`, `replay.py`, `manifest.json`: offline instructions, portable verifier/replayer and complete inventory.

Every replayable source, including the current one, must pass the same `simulationPlan` validation as runtime admission. Invalid current Spec/files/locks produce an explicit error; unvalidated lock content never becomes installation instructions.

## Partial runs, privacy and bounds

Failed, cancelled and pending records are included unchanged. A Run with no produced result has `resultPath: null` and `resultAvailability: "not-produced-at-snapshot"`. A **completed** Run whose expected immutable result object is missing or corrupt blocks the complete export. No partial successful ZIP is returned. A result object's Run/experiment/version/parameter/seed/runtime identities, metric contract and output hashes must match its frozen record.

Preserving an original source archive means it cannot be silently filtered. The exporter rejects a referenced archive if any path component matches `.env` or `.env.*`, `.riffology`, `.ssh`, `credentials`/`credentials.*`, `cookie`/`cookies` and their suffixes, or a `.pem`, `.key`, `.p12` or `.pfx` filename. This applies to historical referenced sources too. Platform Session blobs, auth values, idempotency intents and runtime control fields are never selected. Source code and model parameters are user-authored research content; users should not place credentials in them.

ZIP output is store-only UTF-8, capped at 16 MiB and 8,192 entries. Snapshot inventory is capped at 4 MiB, 1,000 Runs, 100 groups and 500 claims plus 500 assessments. Exceeding a cap fails explicitly with `export-too-large`; pagination never silently drops old history. Saved source-object size is checked before buffering; original revision readers retain their existing default bound for non-export callers. Result envelopes are at most 64 KiB; each output is at most 16 KiB. One build per Workspace runs at a time.

## Replay and acceptance

The Python standard-library helper verifies packaged hashes before execution, checks recorded Run identity and dependency/Python versions, unpacks only regular source files/directories into a fresh temporary directory, and invokes the saved entrypoint with its recorded parameters and seed. Native result schema/metric/output declarations are checked. Metrics use absolute and relative tolerance `1e-9`; declared output files require identical SHA-256. An optional Python-version override is explicit and appears in the report. Replay proves the computation, not the validity of model assumptions or Agent regeneration.

Local core acceptance executes a real seeded Python reference model, publishes its computed metrics and CSV through the existing result publisher, exports the project, unpacks ZIP with Python `zipfile`, creates a clean virtual environment, and reproduces a reference Run. Additional tests cover multi-version history, partial groups, failure/cancellation, claims/rejections, missing/corrupt content, cross-scope rejection, revoked access, bounded reads and sensitive paths. Chrome checks cover a real ZIP download, digest verification, no background export, error display, and workspace switching without stale downloads. These local checks do not claim a deployed provider-backed user acceptance.

The local Workerd integration also exercises the actual Gateway, Workspace RPC, Catalog/D1 and RevisionStore/R2 path: it seeds a real saved source, publishes metrics computed by Python, creates an evidence claim through the real API, downloads the ZIP, replays its model, reopens the durable objects, and checks missing-result and revoked-membership denial. The original simulation count and wake remain unchanged throughout export.
