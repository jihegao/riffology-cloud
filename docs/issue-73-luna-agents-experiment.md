# Issue 73: Luna Agents API simulation experiment

This experiment tests whether one OpenAI-managed Agent Session can sustain the
Riffology modeling loop and whether a simulation-methodology skill produces a
repeatable gain with the model held at `gpt-5.6-luna`.

Completed bounded run and decision: [2026-09-17 ADR](issue-73-luna-agents-adr.md).

It is isolated from the production Pi runtime, Cloudflare runtime, and Workspace
flow. It uses only a synthetic Schelling fixture, one agent, no MCP, no
subagents, an OpenAI-hosted environment, and disabled sandbox network access.

## Experiment shape

- Condition A: Luna + Agents API.
- Condition B: Luna + Agents API + inline `riffology-simulation` skill.
- Three counterbalanced repetitions per condition by default.
- Three Turns per Session: initial model and threshold sweep, mobility-noise
  mechanism and comparison, then a minimum-change default-threshold edit.
- Every Turn must publish a project ZIP and a machine-readable manifest from
  `/workspace/outputs`.

The harness verifies the Turn outcome, command-execution items, package/runtime
versions, every workspace file hash, raw results, plot presence, old-result
retention, same-Session/same-environment continuity, and the Turn 3 change set.
Assistant prose is not counted as execution evidence.

## Offline validation

```bash
npm run issue73:validate
npm run issue73:plan -- --output .local/issue73/plan.json
```

These commands do not contact OpenAI or consume model/sandbox resources.

## Paid live gate

Copy `experiments/issue-73-luna-agents/budget-manifest.example.json` into
`.local/issue73/`, then replace every placeholder with an explicit approval
reference, timestamps, deadline, and frozen caps. The live command refuses a
stale rate card, expired deadline, model other than Luna, non-synthetic privacy
scope, inconsistent Session/Turn cap, insufficient reserved token headroom,
missing `--live`, or absent key. `maxTokensPerTurn` is a reservation used before
each request because the Agents API does not expose a hard per-Turn generation
limit; persisted Turn usage is retrieved after every terminal event and replaces
any missing usage in the event stream. A completed Turn with missing usage is
queried boundedly without replaying its input. Non-null usage must contain
internally consistent nonnegative integer totals; missing or malformed usage
stops the matrix before another Turn.

An explicitly authorized alternative is
`executionPolicy: "bounded-attempts-observed-thresholds"`, with
`acknowledgeUnknownActualSpend: true`. This policy permits a **completed** Turn
whose usage remains absent after 60 seconds of read-only reconciliation to
continue. Usage stays `null`/unknown; it is never fabricated as zero or replayed.
Malformed usage and unknown execution outcomes still stop. Session/Turn counts
are reserved before dispatch, including failed/interrupted attempts; execution is
serial with no replacement runs. This policy requires deletion after download,
at most four Sessions/twelve Turns, and at most three hours. Token and monetary
values are observed stopping thresholds, not actual spend caps; per-Turn token
headroom is not used in this mode. Model totals exclude unknown usage and cannot
be interpreted as complete costs. Historical unknown charges remain separate.

The 2026-09-17 authorized matrix uses two repetitions per condition, four
Sessions, twelve Turns, 4,800,000 observed tokens, USD 0.90 observed model cost,
and USD 0.90 estimated sandbox cost, ending no later than 17:36:18 UTC.
Unknown execution, cleanup failure, attempt/time limits, or a reached observed
threshold stop new input. Provider-side shutdown may finish asynchronously.

```bash
npm run issue73:run -- \
  --live \
  --manifest .local/issue73/budget-manifest.json
```

SDK retries are disabled. When delivery is uncertain, the harness reconciles
the known Session and Turn; it never starts a replacement run solely because an
observer stream ended. Raw events, provider identifiers, the authorization
manifest, and downloaded artifacts stay under ignored `.local/issue73/`.
The client uses Undici's environment-proxy dispatcher, so existing
`HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY` settings apply consistently instead
of bypassing the host's configured network path.

The first `SIGINT` or `SIGTERM` is graceful: it does not abandon the active
provider Turn. The harness waits for that Turn's terminal evidence, downloads
and verifies its artifacts and usage, sends no further input, and then applies
the configured Session cleanup policy.

After a completed run, promote only the generated sanitized bundle:

```bash
node experiments/issue-73-luna-agents/cli.mjs promote \
  --run-root .local/issue73/runs/<run-set> \
  --name <run-set>
```

The promoted bundle contains salted identifier pseudonyms, run-level metrics,
an A/B summary, the decision gate, and `SHA256SUMS`. It excludes credentials and
raw session/event data.

For a completed matrix with downloaded artifacts, an additional offline audit
checks every file hash, CSV physical row counts, result preservation (including
renames), passing-test log excerpts and default-value artifacts without replay:

```bash
node experiments/issue-73-luna-agents/audit-artifacts.mjs \
  .local/issue73/runs/<run-set> .local/issue73/artifact-audit.json
```

## Evidence interpretation

The generated report computes accepted-task rate, first-run success,
autonomous-debug success, execution verification, parameter-experiment
completion, fabricated-result incidents, tool calls, repairs, tokens, wall
time, artifact count, and cost per accepted task. Model cost uses observed Turn
tokens. Sandbox cost is a labeled conservative estimate using the frozen 1 GB
container rate and five-minute minimum because the Turn event is not a provider
invoice. The default cleanup deletes each Session only after all three Turns and
artifact downloads complete; a retained Session is costed as at least 60 minutes.
When usage is missing, `costDataComplete` is false and cost per accepted task is
`null`; functionality and A/B methodology can still be assessed. The rate-derived
sandbox estimate is not an independently reconciled provider invoice.

Possible decisions are `proceed-to-cloudflare-spike`,
`improve-simulation-skill`, `retain-current-runtime`, or `blocked`. No decision
from this experiment changes production routing by itself.

Metric limitations: the legacy `fabricatedResultIncidents` field counts evidence
integrity/matching flags, not proven fabricated numerical results. First-run
success is first-Turn contract acceptance; repair counts and methodology scores
are observable-command and lexical proxies. Strict exact command matching can
reject subcommands executed within a larger shell script. The final ADR separates
these contract scores from actual source/data review without silently rescoring.
