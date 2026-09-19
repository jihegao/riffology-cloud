# Issue 73 Luna Agents experiment

Interpretation note added after offline review: the metrics below are the
unchanged frozen scorer output. Its `fabricated result incidents` row counts
command/evidence matching flags, **not proven fabricated numerical results**.
Strict default-metadata and whole-shell matching also produced false negatives.
See [the ADR](../../../issue-73-luna-agents-adr.md) for the separate source/data
review. This annotation does not rescore the runs; the original unannotated
report remains in the ignored raw run directory. Cost data is incomplete.

Decision: `retain-current-runtime`

Definition SHA-256: `104790fe9ae11ee9ef4b1f7d1a98067989f0661bcf2284590b2a46338579b3fa`

Costs are observed model usage plus estimated sandbox charges, not billing reconciliation. Missing usage remains unknown, never zero; when incomplete, totals are partial observations and cost-efficiency conclusions are unavailable. Historical runs are separate, not refunded or reset by this matrix.

Provider/API/SDK: `openai` / `agents-v1` / `7.17.0`

| Metric | Luna baseline | Luna + simulation-skill |
|---|---:|---:|
| accepted task rate | 0.000 | 0.000 |
| first-run success | 0.500 | 1.000 |
| autonomous debug success | 0.000 | 0.000 |
| model execution verified | 0.333 | 0.500 |
| parameter experiment completed | 0.500 | 1.000 |
| simulation skill read | 0.000 | 0.000 |
| fabricated result incidents | 3 | 2 |
| mean tool calls | 3.83 | 5.50 |
| mean repair iterations | 0.17 | 0.33 |
| observed usage/tokens | 597947 | 1137731 |
| Turns with unknown usage | 1 | 1 |
| wall time (ms) | 481998 | 523936 |
| model cost (USD) | 0.04906754 | 0.058159100000000005 |
| estimated sandbox cost (USD) | 0.018 | 0.018 |
| cost per accepted task (USD) | n/a | n/a |
| artifact count | 12 | 12 |
| explicit entities/state/interactions | 0.000 | 0.000 |
| emergent quantity defined | 0.333 | 0.500 |
| verification before interpretation | 0.000 | 0.500 |
| sensitivity analysis | 0.333 | 0.500 |

Session and Turn identifiers are salted SHA-256 pseudonyms. Raw events and identifiers remain under `.local/` and are not part of this evidence bundle.
