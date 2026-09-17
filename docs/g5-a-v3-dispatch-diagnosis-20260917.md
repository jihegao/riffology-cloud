# G5-A v3 dispatch diagnosis and next-window proposal

Status: G5-A B2 stopped; G5 is not accepted. No new window is authorized by this document.

## Observed execution

The first-principal browser identity and frozen source/configuration passed live preflight. The v3 window created one Project and one Turn (2 admission Tasks), dispatched once, and created no Simulation or Service Runs. Guard, Token and Money each report one unknown/pending entry. The final independent readback confirms the window closed and all six gates false. The temporary operator was deleted; independent lookup returned absence code 10007.

The diagnostic receipt identifies `provider-dispatch / provider-fetch-typeerror`. The reserved/accounted amount is 9,910,450 nanodollars ($0.00991045), not a verified provider charge. Keep this reservation and all earlier quarantine records; do not infer a refund or replay the Turn.

Private evidence remains in `/home/g/.private/riffology-cloud/g5-a/rollover-20260917-v6/`: `attempt3-b2-result.json`, `attempt3-b2-execution-evidence.json`, and `diagnostic-close-1789634023364.json`. No credentials or raw session are included here.

## Local fix and verification

The provider stored native Worker `fetch` in a class field, then invoked it as a method. Under the production compatibility date (2026-09-09) and flags, local Workerd reproduces `TypeError: Illegal invocation` before the synthetic outbound handler is called. Binding the default fetch to `globalThis` fixes the receiver. Production telemetry retains only a redacted TypeError category, so the precise remote exception text is not available; the default production code path contains the reproduced defect.

The provider now uses `globalThis.fetch.bind(globalThis)` for its default. Injected test fetch functions and dispatch-once, deadline, usage and unknown-stop behavior are unchanged. A new real Workerd regression exercises the actual provider without injecting fetch, intercepts all outbound traffic locally, checks one dispatch and verified terminal usage. Provider and durable budget regressions passed 18/18 with no skipped tests; TypeScript and diff checks passed.

The local schedule compiler now accepts 144 or 145 dispatches for the 63-Task normal-only suite. It still rejects 143, rejects an optional probe under 144, and enforces the corresponding conservative cost. This corrects the v3 pre-admission rejection without changing server limits.

A dry-run build containing the provider fix succeeded. Candidate main module SHA256: `f7d0938234cdb90f0462fbea302de7af37cebea0e00fdf1ac6128fa0e4c0359c`. This is a local candidate, not a deployed release; source-version metadata and final frozen configuration must be regenerated before deployment.

## Concrete continuation requiring scope adjustment

v3 now has 61 remaining Tasks and 143 dispatches. The complete normal suite needs 63 Tasks and a worst-case 144 dispatches, so it cannot run under the current residual caps.

Propose a new closed-gate release of the fetch fix, quarantine the latest unknown at its full 9,910,450-nanodollar reservation, and retain the complete previous quarantine chain. For a subsequent rollover, authorize **2 additional Tasks, 1 additional dispatch, and zero additional money**. Target caps would be 63 Tasks, 144 dispatches, 39 Simulation Runs, 0 Service Runs, 29,960,358,200 nanodollars ($29.96035820), and $5 per Turn. Keep synthetic-only data, concurrency one, no probes, and a two-hour window from first admission.

The current chained-rollover schema supports explicit Task/money adjustments but no positive dispatch adjustment. This proposal therefore also requires a narrow schema/conservation extension for the single authorized dispatch, with regression coverage and a fresh freeze/registration/readback. It must not be implemented by silently changing source caps or releasing old unknowns. Only then can a new B2 attempt proceed. G5-B remains blocked behind G5-A acceptance and its own frozen identity/budget checks.
