# IR publication recovery — 2026-10-28

The two October 19 Worker PUT failures returned HTTP 400 / Cloudflare 10021. The retained evidence records a 321-byte body hash, but the original full response body and error chain are unavailable. On October 28 the integrated caller reproduced the response and retained all 321 bytes. Its SHA256 exactly matches both historical records: `aff5f6922ad14176a471fa96dca63264c46b53cc5c996f52905abf6f096c5bd3`. The error says `serve_directly and run_worker_first must not be simultaneously specified`. This identifies the rejected parameter combination; the old bodies themselves have not been reconstructed or relabeled.

The integrated caller now uses one owner entry, one credential channel and the actual publication core. It captures complete available Worker response bytes before interpreting status or JSON, retains private files with restrictive permissions, and exposes only safe receipt metadata. Truncated bodies, transport failures and late responses cannot produce success acknowledgements.

Maintenance receipts are requested at specific publication boundaries with a unique nonce and expiry. The browser produces one matching GET response per demand. There is no periodic browser download loop and no preliminary duplicate full collector. Unknown requests stop further writes; the original identity, maintenance hold and evidence remain intact.

Repository execution bindings remain disabled. A deployment needs a separate sealed local binding to the user's current grant, current source closure, fresh maintenance proof and full preservation baseline. Historical grants are not enabled by importing these modules.

## Current source and preservation

The deployment candidate uses main `2dc5e7ce113a007a238d32eea732a29fb703745e`, including the later GaoAgent changes. The observed serving version is v239 (`191e6d4a-b893-4490-ae37-e2751d9d08ba`). The collector supports its two-module source and preserves all 107 bindings, 11 secrets, 26 runtime exports, six container associations, 17 applications, 52 namespaces and five routes.

The fixed candidate bundle SHA256 is `7cc5fdbeda4d406a2c36e29aef3d578cb0428b06acfb2ca404bdb78d735d402e`; it binds 578 Git source files, 1,131 build graph inputs and 96 static assets. The generated browser frame is bound by complete bytes in the source closure. With the browser-policy binding absent, its public route must return an empty 503; this verifies the closed gate, not browser acceptance. Both fixed image source closures and seven release-authority source pins match current main.

Application version verification follows the user's accepted platform behavior: the new current version and the previous current version must remain, and all retained historical configurations must match. Older inactive versions may disappear from the API list; their predeployment responses remain in the evidence archive.

## Validation and remaining boundary

`node --test tests/ir-publication/*.test.mjs`: 56 passed, zero failed. Coverage includes actual owner/core integration, native response capture, 400/10021, unknown writes, stale/active receipts, source and baseline drift, current multi-module source, rolling application versions, cancellation and default-disabled execution. Local Wrangler startup profiling passed. These are offline checks, not authenticated product acceptance.

Deployment and current online readback are recorded separately when completed. Report, cold recovery and the third Turn remain outside this deployment-only validation; no successful user acceptance is claimed by this patch.

## Observed 10021 repair

The runtime readback includes both legacy `serve_directly` and `raw_run_worker_first`. The previous adapter copied the legacy field and translated the current field, producing an invalid upload combination. The corrected adapter sends only `run_worker_first`, retaining base path and HTML/not-found behavior. Post-PUT readback still compares the complete runtime configuration. The integration fixture now rejects the exact mutually exclusive field combination, so the previously passing test path reproduces this known API failure. See the [official upload schema](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) for the current field and deprecated legacy field.

## Continue after a known successful Gateway PUT

The integrated core can reconcile a sealed original intent, full 200 response, ACK, multipart hash and predeployment baseline against a fresh complete serving snapshot. Only after those checks does it continue to the two original application rollouts. It sends no asset session or Gateway PUT on this path. Missing, changed or mismatching evidence stops before further writes. Offline tests cover successful continuation with zero repeated Gateway writes and rejection of altered original response evidence.

The actual Gateway was deployed at 2026-10-28T13:08:05Z as v240 (`94ac237c-1615-4acb-80a1-a8216b8c23c7`), deployment `5a9217d6-688f-46a3-a36b-68d6678266a4`, at 100%. Complete source/resource readback passed; 96 public static assets matched. The postdeployment check stopped before rollout. Subsequent per-path receipts identified Analytics script injection in HTML returned to the native client without Fetch headers; the standard Fetch profile returns the exact frozen bytes. Separately, the frame check now verifies empty 503 while the policy binding is absent; no gate is opened.

The public reader sends an explicit Node/Fetch request profile (`User-Agent: node`, `Accept: */*`, `Accept-Language: *`, `Sec-Fetch-Mode: cors`) and compares the complete response bytes without stripping or rewriting HTML. The navigation-style response and its additional Cloudflare Analytics script remain retained as diagnostic evidence. Four independent public GETs may run concurrently; this does not repeat publication writes or resume a periodic download loop.

A ProjectTools rollout completed as v4, but a subsequent GET connection failure stopped the publisher before the TrustedPi POST. The native API reader now repeats that same GET once on the observed connection-failure code within its original deadline; POST/PUT requests are never repeated. The native transport integration test injects this read failure and verifies completion without repeating writes.

Fresh ProjectTools readback also established that the new version API row contains only the submitted `{image}` delta, while the full application API preserves all prior non-image configuration. The classifier accepts this exact delta representation only while verifying the full application configuration. Offline replay of the actual captured physical evidence passed (explicitly not a fresh live gate); regression tests reject hidden CPU/memory/configuration changes.
