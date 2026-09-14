# Evidence-bound conclusions (#31)

Only the **Evidence** cards represent server-generated or checked numeric simulation measurements. Agent prose is always labeled interpretation; user messages are labeled user-provided content. Model assumptions and limitations remain declarations from the saved Spec. Neither successful execution nor arithmetic verification establishes scientific/model validity. The implementation does not classify arbitrary natural language or certify all chat sentences.

## Public interfaces

All routes derive workspace scope and user/auth identity through Catalog. Private Workspace methods recheck Catalog membership and workspace generation before/after I/O; writes recheck at the durable transaction boundary. Maintenance access preserves historical reads when a workspace is no longer ready.

- `POST /api/workspaces/:workspaceId/evidence` creates an immutable numeric claim. Body is `{schemaVersion:1,kind,metric,runId}` for `kind:"run"`; group kinds `mean`, `delta`, `percent-change` use `{schemaVersion:1,kind,metric,experimentId,armId}`. The group ID maps to the authoritative persisted Experiment grouping; arm IDs are its configuration IDs.
- Optional `expectedValue`, `expectedVersion:{revisionId,filesSha256,specSha256}` and (single Run only) `expectedArtifactSha256` are exact expectations, not data sources. Mismatches fail. Unknown fields such as a caller-provided `value`, source URL or interpretation are rejected.
- `GET /api/workspaces/:workspaceId/evidence[?before=claimId]` returns up to 20 saved records through a bounded chronological index, plus `nextCursor`; ordinary reads do not scan all claim payloads. These carry `evidenceValidity:"recorded"`: previously checked proof, without a current artifact-availability check. Explicit `GET .../evidence/:claimId` rechecks source archives and result artifacts and reports `verified`, `rejected` or `unavailable`.
- `POST /api/workspaces/:workspaceId/evidence-rejections` accepts `{scope:"run"|"model",runId,reason}`. The selected Run supplies the authoritative version. An attributed, timestamped, monotonic rejection is persisted separately; no Run result, execution status or old claim value is rewritten. Model rejection applies to **all Runs with the same files and Spec hashes**, including equivalent content saved under another Revision. Run rejection affects only the selected Run. Reversal is not part of this release; a corrected model should create new content.
- Private `WorkspaceAgent.researchEvidenceExport({scope,actor})` returns every bounded saved claim and assessment as `{schemaVersion:1,claims,assessments}` for #32. It strips `createdBy.authVersion`, preserves safe user attribution and original proof, and does not claim current availability. It must not be exposed without export authorization/redaction.

Creating an identical snapshot yields the same content-addressed claim ID, including after an acknowledgement loss. If a group advances, a new snapshot gets a new ID; the earlier partial snapshot remains unchanged. No inference or simulation runs are launched by evidence operations.

## Deterministic proof and validity

Each measured value is obtained from a completed, non-error Run whose entire saved model archive, exact Spec bytes, execution/dependency digests and result JSON digest verify. The result envelope must match its immutable Run/Experiment identity, model version, parameters, seed, runtime image, metrics and output descriptors. Group claims also verify frozen membership, role, configuration parameters, seed and model version; standalone legacy Run identities remain unchanged. Historical fields cannot be paired with a newer Spec merely because a metric name matches.

A `mean` uses eligible Runs of one selected configuration. `delta` is intervention mean minus baseline mean. `percent-change` is `(interventionMean - baselineMean) / abs(baselineMean) * 100`; zero baseline is rejected, and a negative value is a numerical decrease rather than an assertion of improvement. Means are descriptive, unpaired when failures remove different seeds; no confidence interval, causality or statistical significance is inferred. Nonfinite/overflow results fail closed.

Failed, pending, unknown, cancelled and explicitly rejected Runs do not contribute. Cards retain selected planned count, eligible count, baseline count, excluded Run IDs/reasons and Experiment status at creation. If no eligible data remains for a required side, creation fails. If a supposedly eligible source cannot be verified, the entire claim fails rather than silently dropping a suspicious sample.

Rejections invalidate existing cards on later reads and are checked again after awaited source verification. Group summaries and single-Run displays also carry rejection annotations; group means exclude rejected samples without changing completed execution status. `scientificValidity` at claim creation remains `unassessed`; `currentScientificValidity` can become `rejected` through a model assessment. Old content is explicitly stale when the current files digest differs; an older Revision with identical files is separately identified.

References retain claim → group/Experiment → Run → metric → result artifact digest. Full parameter payloads live once in each frozen Run/result rather than being duplicated per seed in claim references. Limits are 64 selected Runs, 96 KiB numeric payload per claim and 500 claims/500 assessments per Workspace; over-capacity writes return a bounded error before storage. There is no public deletion of evidence.

## UI, Agent and export behavior

The Evidence panel creates selectors without accepting editable measured values, exposes complete provenance/assumptions/exclusions, and offers explicit source rechecking. It supports exact scope-checked historical Run or group ID lookup beyond the recent source pages. Users can choose any referenced Run when recording a rejection. All project/user text uses DOM text APIs. Failed source rechecks remove the verified label; late responses from a previous workspace are ignored.

The existing trusted `researchContext` channel includes at most three whole saved evidence records with precise Experiment/Run/metric/artifact identifiers. It does not fetch artifacts per Turn. Context is bounded to 60 KiB and reports explicit truncation for evidence, Runs and groups; pruning removes whole records, never provenance fragments. Agent instructions distinguish recorded proof from current availability, preserve partial/old-version status, and direct the user to Evidence when the needed record is outside the bounded context. There is no unrestricted historical evidence tool in this batch.

The export inventory preserves immutable values and separate rejection annotations. #32 must include original model/Run/artifact data and apply the annotations when presenting current validity; a stored numeric value alone is not proof that its model remains accepted.

## Validation and limits of evidence

Regression coverage includes forged values, wrong metric/version/group/configuration, modified source Spec and result envelopes, missing artifacts, zero baselines, failed/unadmitted samples, late rejection races, storage acknowledgement loss/reopen, and export attribution redaction. Chrome tests cover provenance disclosure, old source lookup, non-first Run rejection, mobile overflow, stale workspace responses and failed rechecks. A workerd test runs the actual Workspace RPC, Gateway, D1 Catalog, RevisionStore and R2, verifies reopen, model rejection → group summary exclusion, and revoked access. Its executed model results are fixtures; it is not a new paid-Agent/live-production acceptance.
