# G5 Luna cache compatibility repair (local only)

Status: local implementation and offline verification; not deployed or accepted
in a live browser. Existing credentials are reused without reading or rewriting
their values. No provider inference request, gate change, rollover, budget
increase, or settlement of an unknown hold is part of this repair.

## Request policy

For the exact `gpt-5.6-luna` model and dated snapshots, the adapter sends
`prompt_cache_options: {mode: "explicit"}` without cache breakpoints, a cache key,
or `prompt_cache_retention`. All caller-supplied cache options, explicit retention
requirements, and recursively nested cache breakpoints are rejected before fetch.
The legacy adapter behavior for other models is unchanged; this is not a general
model-family compatibility resolver.

The [official caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
states that explicit mode without breakpoints does not use prompt caching or
create cache writes. This does not assert Zero Data Retention for all provider
processing. `store:false`, standard service tier, Gateway cache bypass, disabled
payload logging, single attempt, model, limits, and conservative prices remain
unchanged. No automatic switch to 24-hour retention is made.

## Private failure evidence

Non-2xx responses are read with a 16 KiB bound and the existing request deadline.
Only finite allowlisted error-code/cache-parameter pairs survive; messages,
arbitrary fields, prompts and credentials do not. Invalid, oversized or stalled
bodies preserve HTTP status with no hint. Body content never supplies billing
usage. The normalized result carries the safe hint into the existing bounded
private G5 failure receipt when settlement fails; public responses stay generic.
Unrecognized hints are dropped. This cannot reconstruct earlier discarded errors.

## Verification and release boundary

Focused offline suites cover provider request shape, nested-breakpoint rejection,
error-body redaction/limits/deadline, private receipt propagation, no replay,
unknown money holds, real local Workerd restart, and the controlled Pi protocol.
46 tests passed; TypeScript and whitespace validation passed.

Before any deployment or new paid attempt, refresh the privacy/release evidence
for this changed request policy. Historical unknown holds and the current closed
admission remain in force. A local passing test does not resolve the old provider
outcome or constitute G5 browser acceptance.
