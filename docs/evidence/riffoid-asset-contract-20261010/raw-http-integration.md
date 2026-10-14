# Existing authorized HTTP capability — 2026-10-10

The original Cloudflare connector's primary and Personal links each successfully returned authenticated `whoami` during this diagnostic. Only authentication-success booleans were reported. Existing scoped GET authorization is retained; no credential, private key, environment token, browser data or Codex session was read, exported, copied or created. This is not a fresh verification of every resource permission or OAuth scope.

The exposed `cloudflare_execute` interface accepts request method/path/query/body/content type and optional request `rawBody`. Its documented response contains `success`, `status`, decoded `result`, errors/messages and pagination. It does not expose original response bytes, a response header map or an authenticated SDK client. Request `rawBody` does not request a raw response. Source inspection found only the caller-injected bridge in the reviewed repository, not an instantiated authenticated client; the existing dependency tree did not contain the Cloudflare SDK package. These are capability-exposure findings, not evidence that permission is missing. No new SDK installation or alternative credential route was attempted.

## Exact requirements of the reviewed GET-only SDK bridge

The [official SDK raw-response interface](https://github.com/cloudflare/cloudflare-typescript#accessing-raw-response-data-eg-headers) offers `.asResponse()` without first consuming the body. The reviewed `sdkReadOnlyFetch(client)` needs an already authenticated caller-owned client in the original authorized scope:

1. `client.get(path, options)` returns an API promise exposing `.asResponse()`.
2. Input URLs are GET only under `https://api.cloudflare.com/client/v4`, constrained by the existing control-plane path/query allowlist. Integration must also verify that the injected client's actual base URL and authenticated origin are the original Cloudflare API; the bridge validates input URLs but cannot certify the caller's client configuration.
3. Per-request retries are disabled (`maxRetries:0`), timeout is 15 seconds, redirects are errors, cache is `no-store`, and the abort signal is preserved.
4. The unconsumed Response supplies a body stream and headers. Location-bearing responses are rejected; only Content-Type and cf-entrypoint are forwarded into evidence.
5. The outer transport bounds the body at 16 MiB, limits configured timeout to at most 30 seconds and rejects redirects and statuses other than the reviewed 200/404 cases. Module parsing requires authoritative content type, exact module names/bytes and entrypoint identity. The bridge supplies no PUT channel.

## Which gates need raw module bytes

| Evidence | Decoded metadata can establish | Additional requirement |
| --- | --- | --- |
| Settings/version/bindings, namespaces, container configuration and pipeline inventories | Typed complete fields, authoritative status/pagination, canonical semantic digests and identity associations | Account/Worker scope, complete authoritative API shape and drift checks; JSON whitespace/order is not a preservation property |
| Worker multipart/module contents | Module response schema explains the representation | Lossless original bytes plus Content-Type/boundary and entrypoint, or a reviewed complete per-part names/exact-byte representation with authoritative entrypoint |
| Full asset bytes/asset-set identity | Neither decoded settings nor keep-assets retention provides this | Separate complete authoritative manifest and byte proof, unperformed here |

The official [Download Worker Script contract](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/get/) returns original script content, not JSON encoding; multipart responses contain modules and no metadata part. Its binary module schema does not promise that this connector's arbitrary decoded `result` is a lossless serialization. The content/v2 script-only string cannot establish every module, part name and entrypoint. Text re-encoding cannot be promoted to original bytes without a documented complete UTF-8/no-normalization/no-truncation contract. An opaque ETag does not replace per-module SHA256 verification.

Two valid integration options remain: expose raw status/allowlisted headers/body bytes or lossless base64 through the original authenticated connector; or inject an already authenticated equivalent-scope SDK client without moving credentials. A future reviewed hybrid adapter can use structured JSON for semantic configuration gates and lossless module responses for content gates. Current narrow metadata transport already supports configuration inventories, but the hybrid module bridge is not implemented in this round. No synthetic JSON-body hash is claimed as an original HTTP hash, and no current content guard is weakened.

No fresh production baseline was collected for this diagnostic. The version API's reviewed runtime schema also omits `containers`; current code conservatively requires an authoritative association list. Positive fixtures therefore do not prove that actual Gateway container association readback is wired. A typed authoritative source must be integrated before real publication. Operational quiet-publisher coordination and deployment-time baseline checks remain separate from the user-approved application terminal/late-telemetry policy.

There is no newly requested sensitive action to approve at this point. If platform capability integration would require a new credential, permission expansion or different authenticated principal, stop at that exact action and target instead of creating or exporting credentials. The already authorized original connector path should be extended or exposed first.
