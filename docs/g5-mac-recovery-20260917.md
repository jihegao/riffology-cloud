# G5 Mac recovery: upstream failure evidence

Status: user authorized the exact v4 failed/pending rollover; implementation and
fresh authority readback complete. Closed deployment and controlled execution
are pending. Live G5 model/browser acceptance is not yet passed.

## Revalidated deployment and historical evidence

On 2026-09-17, independent Cloudflare readback returned deployment
`0a75f0e8-2493-4169-9c61-0517978e5276`, version
`9a113e37-e3e1-439a-918c-b50b8a7969de` at 100%, with all six gates false.
The Mac integration branch contains source commit `305c38c` and the native-fetch
fix `353d0ad`; AMD128's earlier inability to resolve the source commit was a
Git-object availability issue, not proof of a mismatched deployment.

AMD128's v4 report at commit `6b2e40eb` records a failed/saved Turn, an upstream
failure response with a request ID and unknown usage, and subsequent settlement
refusal. The native-fetch TypeError did not recur. The durable failure says
`budget-finish / g5-authority-settlement-unconfirmed`; that is not the initial
upstream cause. The original upstream HTTP code was discarded.

Existing AMD128 credentials still return 403/code 10000 for Workers history.
The Mac Cloudflare connector can query that history (HTTP 200), but found no
`vertical-model` diagnostic event during 08:59:50–09:00:20 UTC. The deployed
telemetry binding was absent. The dedicated AI Gateway
`riffology-g5-20260916` returned `collect_logs=false`; metadata queries for both
the v4 interval and all of September 17 returned zero records (HTTP 200).
Enabling logs now would not recover the old response. No logging configuration
was changed and no prompt/response payload was retrieved or recorded.

## Local repair

The proxy now retains the validated non-2xx production HTTP status when a later
budget or Guard operation fails. Its existing bounded, private failure receipt
uses `upstream-http-400:g5-authority-settlement-unconfirmed`, for example. This
preserves both the upstream status and settlement error without changing the
receipt schema, ledger state machine, costs, retry behavior, or rollover policy.
Transport errors and successful HTTP responses retain their previous evidence.
No raw upstream body, request ID, prompt, or credential enters the failure code.

This is an observability repair. It cannot reconstruct historical status or
guarantee the underlying provider request will succeed. It is not deployed.

Validation: TypeScript and diff whitespace checks passed; proxy suites 13/13,
operator inspector suite 14/14, and real Workerd money/token crash, response-loss,
stop and restart regression 1/1 passed. The new case exercises seven HTTP error
statuses, preserves unknown usage/holds, and rejects a repeated signed dispatch.

## Authorized recovery

The v4 report retains Guard/Money unknown and token failed with reconciliation
pending. Existing rollover requires token unknown with no terminal, so v4 cannot
be replayed or admitted to a new window through the current contract. Reported
residual caps are 61 Tasks, 143 dispatches, 39 Simulation Runs, 0 Service Runs,
and 29,950,447,750 nanodollars; these require fresh authoritative readback before
execution. The v4 hold is 9,910,450 nanodollars, not verified provider billing.

Preferred path: recover an authoritative provider receipt matched to the exact
existing call and settle through the existing three-ledger protocol. Available
platform history cannot currently supply it.

Alternative requiring explicit policy authorization: add a one-time quarantine
for precisely the v4 failed/pending-token call, preserving all historical holds,
namespaces, period and ancestral quarantines, with a fresh snapshot-bound receipt
and no extra money. This changes the previous admissibility predicate and must
not be inferred from permission to transfer browser acceptance or diagnose 503.
Only after that contract is decided and verified can an instrumented bounded
model attempt produce the G5 Revision needed for browser acceptance.

The user subsequently confirmed authorization to execute this alternative.
The optional `sourceTokenState: failed-pending` is receipt-bound in V2 only;
without it the existing unknown/nonterminal token predicate is unchanged.
The exception requires failed/provider-failure, pending reconciliation, unknown
usage and a provider request ID. Exact identity, fresh authority receipt,
unchanged unknown money hold, empty tools, original period, ancestral quarantines
and all cap-conservation checks remain mandatory. Real Workerd restart tests
reject the unflagged state, permit the flagged registration idempotently, retain
the old hold, and reject subsequent ancestor terminal drift.

Fresh private readback on AMD128 confirmed v4: 2 Tasks, 1 dispatch, 0 Simulation,
0 Service, Guard unknown/open 1, token failed/pending 1, Money unknown/pending 1,
Tools 0 and hold 9,910,450 nanodollars. Failure receipt SHA256:
`c8d5992ce1dd4bda3b2b0700152c24c6e74d499cafa82909155eb8756051c1bd`.
The initial workers.dev connection failed on AMD128 with unexpected DNS results;
using the Mac's existing proxy through a loopback-only SSH forward allowed the
readback. Credentials remained on AMD128. Both temporary read operators were
deleted and absence verified. No model dispatch was caused by these reads.

Remaining caps are 61 Tasks, 143 dispatches, 39 Simulation, 0 Service and
29,950,447,750 nanodollars. No top-up is authorized. This supports the scoped
single model recovery, not the full 63-Task benchmark admission contract.

Browser acceptance remains pending for actual G5 local Run, trajectory,
opaque-origin frame, playback and browser-side request counting. Earlier empty
Worker Tail output is an observation, not complete proof of zero browser POSTs.
