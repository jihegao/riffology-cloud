# Issue #199 read-only tool receipt release — 2026-10-14

[#199](https://github.com/jihegao/riffology-cloud/issues/199) adds an owner-scoped,
read-only lookup for the persisted terminal state of a tool request from its
original saved Turn. [PR #200](https://github.com/jihegao/riffology-cloud/pull/200)
merged as `f468bb06663e571d72d8a32f3c34dac10baa9eea`. The deployed composition is
`4d0995a57367ffbd5cf18e972936e1afd7372935`, based on the preserved live source
`3e9b97b6d8edeecddd8ce1c995c827dc225a8467`.

The Gateway deployment `1a8687ad-a7a5-42a8-a6e5-295ba1b1805f` serves Worker
version `3789df91-afc5-4e89-8ea7-1dbe7a88036f` at 100%. The downloaded module
SHA-256 `87560a85eac9b8ddb7fa113260777db938917745ad21442516be53075852ac27`
matches the upload candidate. Readback preserved 99 bindings, 23 SQLite exports,
five Worker container association configurations, the safe list metadata for all
15 account container applications, the compatibility settings and the existing
asset configuration. The five Worker associations and both safe application-list
snapshots were exactly equal before and after; full account application
configuration was not compared. Asset bytes were not freshly probed in this
release. No namespace or container image was added.

The first three ordinary-author reads returned 503 `temporarily_unavailable`.
At 06:48:03 UTC, the same three original bindings returned 200: two were explicitly
`not-admitted`, and the cleanup request had terminal ledger status `completed`
with exit code 0 and empty output. A different authenticated reviewer received
404. The workspace then reported no active Turn, resource wait, release hold or
recovery hold. This sequence is consistent with delayed Durable Object code
propagation, but does not prove that cause. No original tool request was replayed.

At 07:01:41 UTC, project-scoped compute-count snapshots taken before and after
three more receipt GETs were deeply equal. Their canonical JSON SHA-256 values
both equal `e94cfa2b581c1e55b6ae7971f74a72186d6a8d5720c4f898a7c332d8dbc664ee`.
All four sampled Turn dispatches reported supported, no-added-call counters for
project tools, Trusted Pi and the tool ledger. The original Turn's admitted and
dispatched ledger counts remained 1 and 1; the other Turn counts remained 2, 8
and 3. All three receipts again returned 200 with the same states. This proves
no added calls within those project-scoped counters. It is not a global-zero or
fee proof.

The production guard was restored from paused=true, active=1 and quarantined=1
to paused=false, active=0 and quarantined=0. Before and after readbacks have the
same meter-only policy SHA-256
`695cdd9ece91081e201a3dd03ba2ad7451931a0b588addc6454a1f6db9638031`,
the same review time `2026-12-31T23:59:59.999+08:00`, the same two-active-Turn
limit, and unchanged historical usage and alerts. This release made no policy
change; [#104](https://github.com/jihegao/riffology-cloud/issues/104) holds the
current review-time extension authority. The receipt API's usage and fees are
unknown; this record does not state zero cost or imply that the original author
Turns were unpaid.

Eighty focused risk checks, 19 independently reviewed receipt/Gateway checks,
and 26 signed-entry checks passed. A real Miniflare Durable Object regression
also proved that `createGatewayTurnServices` serializes the receipt input and
invokes `WorkspaceAgent.toolReceipt`. The full M2 attempt recorded 930 passed,
zero failed and one cancelled because the existing revision-store Workerd test
reached its fixed 60-second timeout. The full suite is therefore not reported as
passed, and hosted CI is not claimed green.

The independently running [#196](https://github.com/jihegao/riffology-cloud/issues/196)
six-Run group was accepted with HTTP 202 and had two completed Runs, one released,
at the latest read; Group release remains pending. It is outside #199's acceptance
and is not a publication or final Group result. The receipt endpoint itself
performs no paid execution. This release does not establish Fire Run/Group completion, model
publication or formal Experiment evidence.

[Sanitized machine-readable evidence](evidence/releases/issue199-tool-receipt-release-20261014.json)
contains the deployment, readback, capacity and validation boundaries without raw
logs, credentials, headers, user identities, command input, module bodies or source
archives.
