# Issue 73 completion audit

Audited against the live GitHub issue on 2026-09-17. This file distinguishes
implemented harness behavior from evidence that satisfies the experiment exit
criteria. A passing local verifier is not a substitute for a completed live A/B.

## Current conclusion

Updated after the explicitly authorized limited-attempt experiment: the route
and four-Session/twelve-Turn A/B execution are now complete, with decision
`retain-current-runtime`. All twelve Turns completed and all ZIP hashes pass;
strict task acceptance remained 0/2 in each condition. Two current Turns have
unknown usage, separately from two historical unknown Turns. All four new
Sessions were deleted and a fresh inventory read found zero live Sessions.

The [final ADR](issue-73-luna-agents-adr.md) and
[limited-run evidence](evidence/issue-73-luna-agents/limited-20260917/report.md)
supersede the pre-authorization status below. Completion means delivery of the
bounded experiment and negative decision, not proof of model correctness, skill
gain, production readiness, or automatic closure of the GitHub issue.

## Historical audit before limited-attempt authorization (superseded)

Issue 73 is **not complete**. The isolated implementation and its local tests are
complete, and live evidence now proves the full three-Turn baseline modeling,
execution, experiment, artifact, and same-Session modification loop. The required
repeated baseline-versus-skill matrix did not complete because the provider
returned `null` usage for the completed third Turn. The fail-closed token budget
gate stopped before a second Session.

The evidence bundle's `blocked` value is the outcome of this incomplete attempt;
it is not a Phase D architecture decision derived from a complete A/B.

## Requirement matrix

| Issue requirement | Status | Authoritative evidence |
|---|---|---|
| New isolated branch/worktree, no production runtime or Workspace changes | implemented | Branch `codex/issue-73-luna-agents-experiment`; changes are confined to experiment code, tests, docs, package metadata, and ignored local evidence. |
| Fixed `gpt-5.6-luna`; hosted environment; multi-agent, MCP, custom skill off for baseline | implemented and live-observed | Experiment definition plus `retry-usage-gated-20260917/run-level.json` records returned Luna model, hosted environment, and no installed baseline skill. |
| Real Python/Mesa Schelling model, execution, threshold sweep, machine-readable results and plot | live-proven for baseline Turn 1 | `retry-usage-gated-20260917/post-run-reverification.json` records accepted Turn 1, 12 executed runs over three seeds, and artifact hashes. Raw artifacts stay under ignored `.local/`. |
| Preserve session, turn, usage and tool evidence with run metrics | partial | Sanitized run-level evidence includes pseudonyms, observed usage, tools, wall time, cost and hashes. Turn 3 usage is explicitly unknown rather than recorded as zero. |
| Turn 2: same Session, add `mobility_noise` values 0.0/0.1/0.3 and retain prior work | live-proven | The second controlled attempt accepted Turn 2 with 36 runs, three seeds, retained Turn 1 results, valid source classifications, artifacts, and observed usage. |
| Turn 3: inspect project, change default threshold to 0.45 with minimum changes, rerun verification | artifact and continuity proven; usage incomplete | Post-run verification proves an executed default-value check, retained history, and two changed code files. Provider usage remained unavailable after 22 bounded observations, so it is not an accepted A/B repetition. |
| First `riffology-simulation` skill and observable skill activation | implemented, not live-compared | The skill, inline archive, digest, content-read activation check, and local tests are present. No accepted live skill-condition Session exists. |
| Same-model, same-fixture, same-budget A/B with multiple repetitions | missing | Planned matrix is two repetitions per condition, counterbalanced. The live attempt stopped in the first baseline Session. |
| Score methodology, execution, sensitivity, fabrication, debug, cost and artifact consumability from inspectable evidence | implemented, partially populated | Sanitized report derives scores from manifests, archives, command items and reports. Incomplete conditions remain zero/unknown and cannot support a comparative conclusion. |
| Repository-visible sanitized run-level evidence and checksums | partial but valid | `pilot-20260917/`, `usage-gated-20260917/`, and `retry-usage-gated-20260917/`; `SHA256SUMS` verifies, raw provider identifiers and authorization data remain local. |
| One of the four Phase D decisions after Phase A-C | missing | Current `blocked` is a run-stop result, not a completed Phase D decision. |

## Fail-closed incident and repair

The first controlled A/B attempt completed two baseline Turns. Turn 1 reported
97,179 tokens and approximately USD 0.011224 in model cost. Turn 2 completed and
emitted artifacts, but both the terminal event and canonical Turn retrieval
returned `usage: null`.

After the bounded usage-retrieval and artifact-contract repairs, a separately
authorized fresh attempt completed all three baseline Turns. Turns 1 and 2
reported 115,973 and 93,773 tokens; observed model cost was approximately USD
0.019838 and estimated sandbox cost was USD 0.0105. Turn 3 completed, produced
verified artifacts, retained prior results, and changed the default threshold to
0.45 with two code-file changes. Its usage remained `null` through 22 observations
over approximately 59 seconds. The harness deleted the Session and did not start
another Session. A read-only provider inventory check again reported zero live
Issue 73 Sessions.

The repaired harness now polls only that same terminal Turn for bounded delayed
usage; it never resubmits input as part of usage reconciliation. If usage remains
unknown, it still stops. The artifact contract also requires Python model and
runner files to retain the `source` classification across Turns, and provider
model matching is exact rather than prefix-based. Non-null usage must pass an
internally consistent integer schema before it can affect budget accounting.

## Evidence references

- `docs/evidence/issue-73-luna-agents/pilot-20260917/`
- `docs/evidence/issue-73-luna-agents/usage-gated-20260917/`
- `docs/evidence/issue-73-luna-agents/retry-usage-gated-20260917/`
- `docs/issue-73-luna-agents-experiment.md`

The usage-policy authorization subsequently allowed a fresh limited-attempt
matrix, documented above. These historical partial runs were not counted as
its repetitions. That new allocation is now exhausted; no additional provider
experiment is authorized by unused monetary observations.
