# IR publication recovery — 2026-10-28

The two October 19 Worker PUT failures returned HTTP 400 / Cloudflare 10021. The retained evidence records a 321-byte body hash, but the original full response body and error chain are unavailable. The historical cause remains unproven; 10021 alone does not identify it.

The integrated caller now uses one owner entry, one credential channel and the actual publication core. It captures complete available Worker response bytes before interpreting status or JSON, retains private files with restrictive permissions, and exposes only safe receipt metadata. Truncated bodies, transport failures and late responses cannot produce success acknowledgements.

Maintenance receipts are requested at specific publication boundaries with a unique nonce and expiry. The browser produces one matching GET response per demand. There is no periodic browser download loop and no preliminary duplicate full collector. Unknown requests stop further writes; the original identity, maintenance hold and evidence remain intact.

Repository execution bindings remain disabled. A deployment needs a separate sealed local binding to the user's current grant, current source closure, fresh maintenance proof and full preservation baseline. Historical grants are not enabled by importing these modules.

## Current source and preservation

The deployment candidate uses main `2dc5e7ce113a007a238d32eea732a29fb703745e`, including the later GaoAgent changes. The observed serving version is v239 (`191e6d4a-b893-4490-ae37-e2751d9d08ba`). The collector supports its two-module source and preserves all 107 bindings, 11 secrets, 26 runtime exports, six container associations, 17 applications, 52 namespaces and five routes.

The fixed candidate bundle SHA256 is `7cc5fdbeda4d406a2c36e29aef3d578cb0428b06acfb2ca404bdb78d735d402e`; it binds 578 Git source files, 1,131 build graph inputs and 96 static assets. The generated browser frame is separately verified by complete bytes. Both fixed image source closures and seven release-authority source pins match current main.

Application version verification follows the user's accepted platform behavior: the new current version and the previous current version must remain, and all retained historical configurations must match. Older inactive versions may disappear from the API list; their predeployment responses remain in the evidence archive.

## Validation and remaining boundary

`node --test tests/ir-publication/*.test.mjs`: 42 passed, zero failed. Coverage includes actual owner/core integration, native response capture, 400/10021, unknown writes, stale/active receipts, source and baseline drift, current multi-module source, rolling application versions, cancellation and default-disabled execution. Local Wrangler startup profiling passed. These are offline checks, not authenticated product acceptance.

Deployment and current online readback are recorded separately when completed. Report, cold recovery and the third Turn remain outside this deployment-only validation; no successful user acceptance is claimed by this patch.
