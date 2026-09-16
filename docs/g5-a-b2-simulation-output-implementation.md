# G5-A B2 simulation output implementation

Date: 2026-09-16. Status: implemented and tested locally on the isolated B2 branch; not integrated, deployed, or executed against cloud services.

This slice keeps the frozen G5-A admission and budget envelope unchanged: three Projects, 18 ordinary-user Turns, 39 Simulation Runs, three Group tasks, 63 normal admissions, up to three terminal probes, 66 maximum tasks, and 147 maximum upstream dispatches. It changes two existing Run inputs without adding work: the mechanism-change Run uses `max_wait=0`, while the reopen comparison uses `queue_capacity=120` and `queue_capacity=0`.

Every successful server Run now emits `summary.json` and `trace-audit.json`. The audit is canonical compact JSON with this closed shape:

```json
{
  "schemaVersion": 1,
  "columns": ["frame", "time", "queue_length", "completed", "abandoned", "rejected", "active", "waiting"],
  "rows": [[0, 0, 0, 0, 0, 0, 0, 0]]
}
```

Each row has exactly eight values in the declared order. Missing `abandoned` and `rejected` metrics are represented as zero. `active` is the number of agents in the snapshot, and `waiting` is the number whose state is `waiting`. JSON serialization rejects non-finite values. The file is mandatory and capped at 16,384 bytes; an oversized audit fails the Run instead of being omitted or truncated. A complete `trace.json` remains optional and is emitted only when each output remains within 16 KiB and all outputs together remain within 32 KiB.

The existing Simulation publication boundary binds the audit to the immutable result. The sealed process collector computes its byte length and SHA-256, `publishOutputs` reads the object back before success, and the result envelope records `{path, sha256, size, mediaType}` before its own `artifactSha256` is computed. Research export subsequently reads result envelopes with a 65,536-byte bound and each output with a 16,384-byte bound.

The B2 fixture is canonical JSON at `scripts/model/benchmark-task-fixtures/fixtures.json`, with SHA-256 `673d0cbe930990602649aaa9d746e16ad29280981f5f7be336b368388ceee753`. Its platform adapter SHA-256 is `b0c785d8c08838d9e416eb87aba1c6b5ce9d8b1d6d233cf2fec32de99a0ec7f5`. The client schedule, live driver, two-stage fixture adapter, server fixture manifest, Trusted Pi adapter snapshot, Browser Preview validator and runtime loader all pin the corresponding new digest.

Local deterministic checks cover every frozen seed, the 120-customer declared upper bound, both B2 boundary scenarios, audit schema and size, optional full-trace behavior, fail-closed audit overflow, the 39-Run server manifest, and unchanged task/dispatch arithmetic. Natural-language interpretation is recorded as `unassessed`; only artifact-derived numeric assertions are candidates for machine verification by the separate authority slice.
