# M0 evidence recorder

Actual runs: [development status](../development-status.md), [local checks with source hashes](runs/m0-local-20260905052440295/local-checks.json), [G0 incomplete summary](runs/m0-g0-20260905/artifacts/summary.json). No staging gate has passed.

`recorder.mjs` records one G0 gate result in a run-scoped directory using only Node built-ins. It does not assert that a gate actually passed; the operator must provide the observed result and a redacted evidence path.

```sh
node scripts/evidence/recorder.mjs record --input ./gate-result.json --root ./docs/evidence/runs --run 20260905-demo
node scripts/evidence/recorder.mjs summarize --root ./docs/evidence/runs --run 20260905-demo
```

Input fields are `gate_id` (`G0-T01` … `G0-T10`), `case_id`, `status` (`passed`, `failed`, `blocked`, `not_run`), timezone-qualified `observed_at`, `environment` (`local` or `staging`), hexadecimal `git_sha`, `versions` (dependency/image versions), `command`, `evidence_paths`, and `conclusion`. Evidence paths must point to existing regular files under the evidence root; symlinks, traversal, secret-like names, and missing files are rejected. The recorder stores SHA-256 digests and the summary rechecks them. Commands and conclusions must be redacted descriptions and must not contain credentials.

Records are created with exclusive writes, so a run record cannot be overwritten. `summarize` is accepted only when every gate has a `staging` record with `case_id: gate-summary` and `status: passed`, and no staging record for that gate is non-passing. It also requires consistent `git_sha`, `versions`, run ID, schema, and evidence hashes. Local results never satisfy the gate condition. `failed`, `blocked`, and `not_run` remain non-passing states.

No gate result is included by this tool. An accepted summary is evidence of recorded staging statuses only and requires the underlying test evidence to be independently reviewed.
