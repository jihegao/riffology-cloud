IR publication owner — integrated source tree, default CLOSED

This tree consolidates the preserved R17 owner and publisher. It replaces the
temporary parent/materializer/collect/reseal/execute stack with this fixed path:

bounded-owner-caller.py → node-startup-gate.mjs → owner-caller.mjs
  → owner-runtime.mjs → core/publication.mjs → core/io-boundary.mjs
  → core/worker-response-evidence.mjs

The Python caller is the existing owned-process deadline boundary, not a retry
parent. The startup gate imports the caller in the same Node PID. Historical
scripts and receipts are preserved; no scheduled job is redirected or resumed.

The checked-in owner-bindings.mjs has executionEnabled=false and no facts,
window, credentials, receipt stream or physical evaluator. Both the Node caller
and the bounded caller refuse --execute before auth. --collect is removed.
Historical request/hold/image/source pins are NOT current authorization.

Source validation and the local build closure finish first. The owner requests
one fresh logical maintenance receipt before the existing credential helper's
GET-only identity/bootstrap mode. It then keeps that vault for the single run.
There is no second credential pass and no full outer bootstrap snapshot.
The precredential receipt is not reused after a potentially long auth check;
the next phase obtains a new receipt with the same hold/control binding.
At the core's before-baseline gate the owner captures current physical GETs,
combines them with a fresh logical receipt and the bound evaluator, and retains
that initial native baseline for later rollout comparisons. Core writes remain
behind successful logical/process/lease/physical phase checks. Active work,
stale receipts, unknown execution or failed preservation stops without release.

The core owns before/immediate/post-write full snapshots and independent GET
readbacks. These purposeful checks remain. A second physical/receipt collection
before local multipart construction was removed; the fresh before-worker-put
gate still runs after construction and immediately before the PUT.
The on-demand receipt consumer is retained, including exact nonce/body pins and
bounded waits. There is no periodic browser exporter or download loop here.
The 100 ms local wait checks for the one requested receipt; it issues no GETs.

Gateway response bodies are saved before HTTP/envelope parsing, with the
original intent SHA, byte length and full/partial marker. Private files use
0600 in 0700 directories and are independently reopened and verified. The native
HTTP adapter now forwards allowlisted correlation headers to that writer.
Raw bodies/headers never enter safe logs. Asset session JWTs remain in memory.
A response that fails before the transport returns bytes cannot be reconstructed.
No original historical 321-byte error body is recreated by this change.

R17's API representation and empty-placement adapter are retained. The approved
preservation SHA is an explicit facts.baselineProjectionSha256 instead of a
hardcoded historical snapshot. A mismatch still stops before the asset POST.
This is not a diagnosis or proof that empty placement caused HTTP 400.

source-manifest.json pins executable code. owner-bindings.mjs is separate runtime
configuration because it references that manifest: including it would create a
circular hash. Its exact SHA and full facts hash are saved in the owner intent;
any future approved execution packet must freeze BOTH code and bindings.
This checkout has no execution packet or current authorization bound.

Safe local inspection:
  node scripts/ir-publication/owner-caller.mjs --inspect

Offline verification (Node with test module-mock support; verified on v26.10.0):
  npm run test:ir-publication

Tests replace external auth/HTTP/browser/local-main boundaries with explicit
synthetic fixtures. They exercise the actual owner, publisher, full baseline and
native collectors, preservation checks, response writer and bounded launcher.
The native400 case also uses the actual native HTTPS transport with an in-memory
HTTPS peer. No TCP service, OAuth configuration or production build is used.
The physical evaluator is a synthetic capability in those integration cases;
this is not a fresh proof of the retained classifier's production pins.

Publishing still requires a newly authorized target/window and fresh owner,
maintenance, source, Registry and resource evidence. Old main/hold/image pins,
the retired October 20 window and old grants must not be silently reused.
There is no deployment, maintenance release or user acceptance in this patch.

A facts.gatewayResume record can bind the original before snapshot, PUT intent,
full successful response, ACK and multipart binding. The core verifies these
against a fresh complete serving baseline and frozen source before continuing
the original two application rollouts. It never repeats assets or Gateway PUT
on that path. Altered/unknown original response evidence stops before writes.
An absent browser-policy binding requires an empty public-frame 503; regular
assets must still return 200 with their complete expected bytes. Per-path status,
length and SHA receipts are retained even when this check fails.

After an observed native GET connection failure, the transport may repeat that
same GET once inside the original request deadline. No POST/PUT retry is added.
The version API can return the submitted image-only delta; the full application
configuration must still preserve every non-image field. Captured old full
version records remain archived, and the previous current version must remain.
