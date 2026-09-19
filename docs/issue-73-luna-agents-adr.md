# Issue 73 decision: retain-current-runtime

Date: 2026-09-17. Status: bounded experiment completed; production adoption gate
not passed. No production runtime, Cloudflare deployment, or GitHub issue state
was changed.

## Decision questions

**Does an Agent Session approximate the Project work loop?** Yes, for the narrow
short-lived modeling loop tested here. Four independent hosted Sessions each
completed three Turns: create and execute a Mesa model, extend it with mobility
noise, then inspect and minimally change the default threshold. All twelve Turns
have terminal records, passing-test output, downloaded project ZIPs and matching
file hashes. Each third Turn has an executed default-value artifact showing
0.45; code changes are one file in the first baseline and two in the other three
runs. Previous raw results remain available, sometimes under renamed paths.

This does not establish long-term workspace durability, restoration after a
process crash or Session deletion, cross-Session migration, concurrent editing,
production isolation, or integration with authoritative Riffology Evidence.
The controller reattached streams and retrieved the same Session/environment
between Turns; the observer-failure recovery path has local tests, not a live
crash-recovery demonstration. Downloaded revisions outlive the deleted Sessions.

**Does simulation-skill produce repeatable gains?** Not established. Both skill
runs used a 36-row threshold-by-noise-by-seed experiment, while both baselines
added nine noise rows at one threshold plus twelve threshold rows. That is a
repeatable descriptive difference in experiment breadth, not causal or
statistically significant evidence of skill benefit. There are only two runs per
condition, and skill content reads were not visible in the captured command
items. Installed skill names and assistant claims of skill use do not close that
observability gap; absence of a visible read is not proof that no skill context
was used. Both conditions have model-quality defects.

**Proceed to a Cloudflare vertical slice?** No. Keep the current runtime. A
follow-up should improve skill activation evidence, the evaluator's command and
default-change contract, and numerical model oracles before another comparison.
Any new paid experiment or Cloudflare work is separate from this exhausted
allocation.

## Frozen experiment and results

The actual returned model was `gpt-5.6-luna`, using Agents API `agents-v1`, OpenAI
SDK 7.17.0, hosted Python 3.12.12/Mesa 3.5.1, disabled network, no MCP and no
subagents. The order was A1, B1, B2, A2. Prompts, inline skill archive and fixture
were identical within conditions and frozen under definition SHA-256
`104790fe9ae11ee9ef4b1f7d1a98067989f0661bcf2284590b2a46338579b3fa`.

| Observation | Baseline, two Sessions | Skill installed, two Sessions |
|---|---:|---:|
| Completed Turns / downloaded ZIPs | 6 / 6 | 6 / 6 |
| Frozen strict accepted tasks | 0 / 2 | 0 / 2 |
| Frozen strict accepted Turns | 2 / 6 | 3 / 6 |
| Turn 1 raw rows per repetition | 12, 12 | 12, 12 |
| Turn 2 new rows per repetition | 21, 21 | 36, 36 |
| Third-Turn default 0.45 artifacts | 2 | 2 |
| Observed tokens, incomplete | 597,947 | 1,137,731 |
| Turns with unknown usage | 1 | 1 |
| Known-usage model cost, incomplete USD | 0.04906754 | 0.05815910 |
| Estimated sandbox cost, USD | 0.018 | 0.018 |

The 21 baseline rows comprise twelve rerun threshold rows and nine noise rows;
they are not a full crossed threshold/noise design. Each initial sweep used three
seeds and four thresholds. Requested horizon was 50 steps, but code review found
step-accounting defects, so that request must not be represented as 50 verified
updates in every model. Total Session lifecycle time was about 21 minutes.

Frozen scores were **not rewritten after seeing the results**. Their important
limitations are:

- A1/B1 Turn 3 verified the constructor default but left historical sweep values
  in the manifest's parameter list, triggering a metadata false negative.
- A2 declared subcommands such as `python -m unittest -v`, while the provider
  recorded larger shell commands. The strict exact matcher rejected them even
  though captured output shows passing tests and experiments.
- B2 Turn 2 used an abbreviated command containing `...`; this is a real
  manifest defect. Its Turn 3 declared an `&&` combination instead of the
  observed larger newline-separated shell script.
- The frozen `fabricatedResultIncidents` values (A=3, B=2) are **five
  command/evidence-match flags, not five proven fabricated simulation results**.
  No claim of fabricated numeric results is supported by those flags alone.
- First-run success means first-Turn contract acceptance, repair counts are
  failed-command-item counts, and methodology dimensions are lexical proxies.
  They are not independent scientific validation or a complete tool trace.

## Content review, separate from the frozen score

Review used actual archived Python, raw tables, reports and command outputs;
it did not execute extra provider Turns or repair the generated models.

| Run | Concrete limitation found |
|---|---|
| A1 | `unhappy` is measured before relocation but used as final unhappy/happy fraction after relocation; the two metrics describe different instants on non-converged runs. Turn 2 retains the old raw CSV but overwrites its old summary. |
| B1 | The report claims shuffled agent activation, but `step()` iterates `list(self.agents)` without shuffling it. Better seed/uncertainty reporting does not remove this rule/report mismatch. |
| B2 | `self.steps += 1` duplicates Mesa's own increment; raw rows report 100 steps for a 50-iteration loop. A real Mesa API misuse was repaired during Turn 1. |
| A2 | CSV seed values are bound-method descriptions from `self.random.seed`, not numeric seeds. Duplicate step increments also make the `steps < 50` termination occur after at most 25 updates. |

Mesa's own step increment is confirmed in the
[versioned Mesa 3.5.1 Model source](https://raw.githubusercontent.com/projectmesa/mesa/v3.5.1/mesa/model.py).
These are implementation and evidence-quality findings, not claims about
real-world segregation. Different generated boundary and movement rules also
prevent direct scientific comparison of output levels across conditions.

CSV/JSON/PNG packaging is a useful candidate input format for Preview/Experiment,
but no actual Riffology pipeline import was performed. The malformed seed column
shows why file presence and hashes alone do not establish consumability.

## Accounting and cleanup

The authorized limited-attempt policy was applied: four Sessions, twelve Turns,
serial execution, three-hour deadline; no replacement or replay for missing
usage. Confirmed completed Turns were reconciled through a 60-second read-only
window. B2 Turn 1 remained unknown and the controller continued; A2 Turn 3 also
remained unknown at completion. All four Session deletions returned confirmation;
a separate inventory read at 14:59:43 UTC found zero live Issue 73 Sessions.
Hosted sandbox shutdown is provider-managed and asynchronous, not a reconciled
invoice.

**Cost data is incomplete.** New observed usage totals 1,735,678 tokens and
USD 0.10722664 at the frozen model rates, plus USD 0.036 estimated sandbox cost.
Actual totals include two unknown Turns and may exceed observed thresholds;
there is no valid total-cost or cost-per-accepted-task conclusion. The 4.8M token,
USD 0.90 model and USD 0.90 sandbox thresholds were not observed to be reached.
The four-Session/twelve-Turn allocation is exhausted.

Historical costs remain separate: 1,264,938 observed tokens, USD 0.08305618 known
model cost, up to USD 0.033 historical sandbox estimates, **plus two still-unknown
historical Turns** (`usage-gated-20260917` Turn 2 and
`retry-usage-gated-20260917` Turn 3). Nothing was refunded, zeroed or retrospectively
counted as an accepted repetition. The historical pilot's cap breach remains in
its original evidence.

## Evidence and validation

- [Frozen run-level data](evidence/issue-73-luna-agents/limited-20260917/run-level.json),
  [annotated frozen report](evidence/issue-73-luna-agents/limited-20260917/report.md),
  [offline artifact audit](evidence/issue-73-luna-agents/limited-20260917/artifact-audit.json),
  [execution ledger](evidence/issue-73-luna-agents/limited-20260917/execution-ledger.json).
- Raw events, canonical Turns, items and ZIPs remain in ignored
  `.local/issue73/runs/limited-20260917T143618Z/`; provider identifiers and the key
  are not included in the promoted bundle.
- `npm run issue73:validate`: 29 passing tests, including unknown-usage continuation,
  no replay, attempt limits, unknown outcomes, cleanup confirmation and offline
  archive audit. `npm run typecheck` passes. All twelve archives pass hash checks.

The experiment route and the authorized matrix are delivered with a negative
adoption decision. This is not a claim that all acceptance checks passed or that
skill benefit was proven, and it does not close the GitHub issue automatically.
