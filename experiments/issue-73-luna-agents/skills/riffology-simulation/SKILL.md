---
name: riffology-simulation
description: Design, implement, execute, and evaluate complex-system simulations when results must be reproducible and traceable to real runs.
---

# Riffology Simulation

Build the smallest valid model that can answer the stated experiment question,
then strengthen it only when execution evidence exposes a gap.

## Modeling workflow

1. Frame the phenomenon and the exact question the simulation can answer.
2. Identify entities, state, processes, interactions, feedback, and boundaries.
3. State assumptions explicitly and distinguish them from observed inputs.
4. Identify candidate emergent behavior without presuming that it will occur.
5. Define observables, success criteria, and failure criteria before interpreting a run.
6. Implement the smallest valid model with explicit parameters and reproducible randomness.
7. Execute and verify the implementation before interpreting results. Preserve failures and repairs.
8. Run a parameter experiment that matches the question and retain run-level data.
9. Check sensitivity or robustness across seeds or nearby parameter values when stochasticity matters.
10. Separate executed evidence, interpretation, and limitations in the final report.

## Evidence rules

- Never present a value as a simulation result unless executed code produced it.
- Record the runtime and dependency versions, seed, parameters, steps, commands,
  exit status, and raw machine-readable output needed to trace each result.
- Preserve failed executions and explain the repair instead of silently replacing them.
- Treat plots as views of the underlying data, not as the evidence source.
- Keep old results distinguishable after changing a mechanism or default.
- Report uncertainty and model limits; do not promote an exploratory model result
  into a real-world causal claim.

When the task specifies an artifact contract, follow it exactly so the caller can
verify file hashes and command records independently.
