# G5 Mac recovery: upstream failure evidence

Status: authorized v4 rollover implemented, deployed and registered. One Mac UI
recovery Turn executed and failed with proven upstream HTTP 400. All active
gates and Guard admission are closed. G5 browser acceptance remains blocked.

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
guarantee the underlying provider request will succeed. It is now deployed in
source commit `e346e6f4a56dfb97b27c4d24b10bb4f2c05f8a09`.

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

## Executed v5 result

- Target window: `g5-20260917-mac-v5-A`.
- Registered rollover receipt:
  `dff8846150223b1f4cf59efd2ede13b84b774bb51bfa8b4bffcffd12d9f59e3c`.
- Main module SHA256:
  `c14e7bf0dc6f8d95035906ee26deb065876c4c608611df25a3df539171541807`.
- Closed version: `2ba2ede5-a7f7-4647-af88-373a14bfae00`.
- One-model open version: `fa800704-88f1-4045-88e2-da348859a804`.
- Final deployment: `baefea69-cb3d-4cdb-a998-3ec6792ae474`, 100% closed version.
- Existing app assets were retained. Public root SHA256 remained
  `d70a95d14dc298babd4eb414a38aff3bbe4e04fd4899cdd56a3ead24b521315b`.
- All DO namespace IDs were independently preserved; no migrations, container
  image changes, model/profile changes, retention changes or budget top-up.
- Gateway remained authenticated, payload logging disabled, cache TTL zero.
  All five named container apps were enumerated through complete instance pages
  and every instance was inactive before admission.
- Safari `/api/me` matched the frozen principal. Project
  `21a176c7-b244-4e68-a39a-3d8617092a72`, workspace
  `7865d8fa-0f43-4aec-8f6a-13b9e94046ef`, Turn
  `4a2590c3-6961-484a-90a5-bb3681fca792`.
- Browser submitted one inspected synthetic FCFS prompt. Native paste inserted
  unrelated clipboard content and native typing dropped some punctuation during
  drafting; neither draft was submitted. Both were replaced, and the final
  plain-English model request was inspected before the sole Send action.
- Final counts: 2 Tasks, 1 Project, 1 Turn, 1 upstream dispatch, 0 Simulation,
  0 Service, 0 active/pending/unknown tools.
- Browser terminal event sequence 7: `turn.failed`, saved=true, revision
  `a36e7ea2d1dca4206ddae08dab55bb1c4284c55a956caa20e22d8126d1160896`.
  This saved failure revision is not a valid Model Spec or ready Browser Preview.
- New failure code:
  `upstream-http-400:g5-authority-settlement-unconfirmed`.
  Failure authority receipt:
  `11e08f9549533395e10015b397aafa4100342aac1eb502220dd52687cdb6386a`.
- Token failed/pending, usage unknown, provider request ID present; Guard and
  Money unknown. New conservative hold: 9,978,200 nanodollars ($0.0099782), not
  verified billing. It was not refunded, settled, replayed or quarantined again.
- All five prior authority receipts and each 9,910,450-nanodollar hold were
  re-read after v5 and remained unchanged.
- Final Guard closed=true. Final Guard summary receipt:
  `8d82dbdb3097e9432c318d6ae2c18161d5897372364bea08bc3ab8be5b2b181b`.
- Temporary v5 operator deleted; API absence verified. Credentials and raw
  operational evidence remain private on AMD128 under
  `/home/g/.private/riffology-cloud/g5-a/mac-v5-recovery-20260917-frozen`.

The watch restored the closed version on detecting the new unknown, but its
initial confirmation incorrectly queried `/settings`, which reflected the
latest uploaded open configuration rather than the selected traffic version.
Three bounded close-to-the-same-version submissions occurred; no model request
was repeated. Independent deployment plus exact version-resource readback
confirmed all six gates false and money.enabled=false. Guard was then explicitly
closed and read back. The operational helper now verifies active deployment plus
version resources, not `/settings`, for rollback confirmation.

Final checks: TypeScript and diff whitespace checks passed; 35 focused tests and
the separate real Workerd production-path regression passed. No push or merge
was performed in either user's main worktree.

## Read-only HTTP 400 follow-up and boundary

`openai-gateway-responses.ts` pins `prompt_cache_retention: in_memory` for the
frozen `gpt-5.6-luna` profile. Current
[OpenAI prompt caching documentation](https://developers.openai.com/api/docs/guides/prompt-caching)
describes GPT-5.6-and-later controls through `prompt_cache_options.ttl` with `30m`,
and a 1.25x input-rate cache-write charge. This exposes a concrete compatibility,
retention and conservative-pricing review item in the older frozen profile.
It is a suspected contributor to HTTP 400, not a proved error-field diagnosis:
the adapter cancels non-2xx bodies and retained no structured provider error
`code` or `param`. Do not claim invalid credentials, quota exhaustion or a
specific bad field solely from HTTP 400.

No parameter, model, retention period or price card was changed to make the
request succeed. Next work requires a reviewed provider contract and sanitized
error-code/parameter capture; any new paid attempt also needs a separate decision
for v5's now-unknown outcome. This v4-only authorization is exhausted. The Mac
browser transfer worked, but cannot repair a server-side provider rejection.
