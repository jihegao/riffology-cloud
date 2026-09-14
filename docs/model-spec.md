# Model Spec

`model/model-spec.json` is the project-owned, versioned semantic description of a Python simulation. Its `schemaVersion` is `1`; the required top-level fields are `researchQuestion`, `scope`, `entities`, `mechanisms`, `assumptions`, `parameters`, `metrics`, `limitations`, and `execution`.

`execution.entrypoint` must be a relative `.py` path rooted at `model/`. `execution.dependencyLock` must be a relative `.lock` path rooted at `app/`. The parser rejects traversal, control characters, unsafe numeric values, unknown fields, and unknown parameter or metric names.

Parameters are keyed definitions with `type` `number`, `integer`, `enum`, or `boolean`, and a `default`. Numeric definitions may declare `unit`, `minimum`, and `maximum`; enum definitions must declare unique string `values`. `resolveParameters` merges an override object with defaults and validates the complete result. `validateMetrics` accepts the declared metric keys only, requires every declared metric, and accepts finite numeric values.

This module is deliberately independent of the Agent and runtime. A future parameter control or batch Run can read the saved Revision, parse the spec, resolve values, and invoke the Python runner without an LLM call.

## Saved model read interface

`GET /api/workspaces/:workspaceId/model` reads the authorized workspace's saved archive through `WorkspaceAgent.modelSpec`. The stable response is `ModelInspection` from `services/simulation/source.ts`:

```ts
{
  version: {revisionId: string | null, filesSha256: string, specSha256: string} | null,
  spec: ModelSpec | null,
  reasonCode: string | null,
  canRun: boolean
}
```

The read never starts a model process. `version` and `spec` come from the same verified archive. `specSha256` hashes the exact stored JSON bytes, not reserialized JSON. A null `revisionId` denotes the initial model; it does not mean an absent model. Saved checkpoints can have different revision IDs while keeping identical file and Spec hashes, for example after a read-only conversation. Consumers retain the revision for provenance and use file/Spec digests to distinguish changed model content.

If the Spec is missing or invalid, both `spec` and `version` are null with `model-spec-missing` or `model-spec-invalid`. A valid Spec remains readable with its version if its declared execution files are absent or dependency lock is invalid/unsupported; `canRun` is false and `reasonCode` is respectively `model-contract-mismatch`, `model-dependencies-invalid`, or `model-dependencies-unsupported`. Other failures, including archive integrity errors, remain errors. A valid model with its experiment runtime disabled has `reasonCode: null` and `canRun: false`. `canRun` is availability, not scientific validation.

The Model view displays persisted research question, boundaries, entities, mechanisms, assumptions, limitations, parameter definitions and output metrics. The raw disclosure includes the full version identity and Spec. Reads and refreshes do not create experiments or change saved pending submission identities. Existing `simulation-result-invalid` failures are surfaced as result-contract warnings, associated with the current Model only when both file and Spec hashes match. These checks do not infer semantic equivalence between Python code and natural-language assumptions; an execution success does not validate a scientific model.

## Downstream boundary and validation

Experiment and export consumers should retain the frozen `version` alongside `spec`; they must not join historical Run metrics to a newer Spec. Export must retrieve the original saved Spec bytes to preserve `specSha256`; the JSON representation in this read response alone is insufficient to recreate the exact archive. Full package export and official-model promotion are subsequent issues, not delivered by this read interface.

Local validation covers schema and archive integrity, dependency and file contract failures, runtime-disabled reads, same-content checkpoint identity, DOM-safe project text, raw disclosure, persisted parameter retry behavior, and current-versus-historical failure warnings. Browser fixture checks run the actual web module with Chrome at desktop and 390px mobile widths; they are local UI evidence, not a new live Agent or production acceptance.

Current Model warnings summarize the loaded experiment page (currently the most recent 20 Runs), not an exhaustive history audit. Older failure records remain persisted and must be retrieved by downstream experiment/history flows before claiming full-version validation.
