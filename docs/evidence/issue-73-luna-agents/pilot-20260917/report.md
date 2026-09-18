# Issue 73 bounded pilot — 2026-09-17

Decision: `blocked` for this pilot only. This is not the Phase D A/B decision.

The live baseline used OpenAI Agents API SDK `7.17.0`, the returned model
identifier `gpt-5.6-luna`, one OpenAI-hosted environment, disabled sandbox
network access, and no skill or multi-agent configuration.

The provider completed all three Turns in one Session. Turn 1 and Turn 2
artifacts were downloaded and independently reverified after correcting the
local verifier for the released SDK's hosted-command shape. Both downloaded
Turns contain real Python/Mesa execution, machine-readable run-level results,
plots, file hashes, parameter experiments, and command evidence. Turn 2 retained
five prior code/config/test files and the old result set while adding the
mobility-noise experiment.

The pilot cannot count as an accepted run. Persisted Turn usage showed 958,013
tokens after Turn 3, exceeding the approved 360,000-token aggregate cap. The
stream terminal events had reported `usage: null`, so the original harness had
temporarily treated usage as zero. The matrix was stopped before a second
Session, and Turn 3 artifacts were not downloaded before the stop.

Observed model cost was `$0.05199474`. The 1 GB sandbox lifecycle was under ten
minutes, giving a conservative `$0.015` sandbox-cost upper bound at the frozen
rate; this is an estimate, not a provider invoice. The known idle Session was
deleted, and a subsequent list query found zero live Sessions carrying this
run-set marker.

The harness now uses the configured environment proxy, retrieves persisted Turn
usage, understands `status` when hosted command `exit_code` is null, and reserves
per-Turn token headroom before dispatch. It also removes the simulation
methodology checklist from the common artifact prompt, so the skill is the only
A/B methodology intervention and dimensions are scored independently from
inspectable reports and execution evidence. A fresh A/B matrix still requires a
new explicit token authorization and must not reuse this pilot as an accepted
replication.
