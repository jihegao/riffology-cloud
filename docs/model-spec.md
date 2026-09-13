# Model Spec

`model/model-spec.json` is the project-owned, versioned semantic description of a Python simulation. Its `schemaVersion` is `1`; the required top-level fields are `researchQuestion`, `scope`, `entities`, `mechanisms`, `assumptions`, `parameters`, `metrics`, `limitations`, and `execution`.

`execution.entrypoint` must be a relative `.py` path rooted at `model/`. `execution.dependencyLock` must be a relative `.lock` path rooted at `app/`. The parser rejects traversal, control characters, unsafe numeric values, unknown fields, and unknown parameter or metric names.

Parameters are keyed definitions with `type` `number`, `integer`, `enum`, or `boolean`, and a `default`. Numeric definitions may declare `unit`, `minimum`, and `maximum`; enum definitions must declare unique string `values`. `resolveParameters` merges an override object with defaults and validates the complete result. `validateMetrics` accepts the declared metric keys only, requires every declared metric, and accepts finite numeric values.

This module is deliberately independent of the Agent and runtime. A future parameter control or batch Run can read the saved Revision, parse the spec, resolve values, and invoke the Python runner without an LLM call.
