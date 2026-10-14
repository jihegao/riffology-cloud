# Validation logging privacy — review only, October 9

October 10 current boundary: [the integrated offline contract](riffoid-validation-offline-adapter-20261009.md) supersedes historical restoration assumptions below. The fixed maximum is 300 seconds; application terminal evidence cannot prove internal telemetry drain. User publication authorization does not resolve restorationStandard or unknownLogClosure; both remain pending, productionAuthorized:false. No logging or production configuration change is performed by this integration.

No production setting was changed, no real log/header/Secret value was queried,
and no real-time Tail subscription was started. Parent summaries establish the
entry's current settings; Gateway settings come from the historical frozen safety
baseline and still need a fresh read. Both have logs enabled, sampling 1,
`persist=true`, invocation logs enabled, traces disabled, no configured Tail
consumers and Workers `logpush=false`. These facts do **not** prove that full
protocol headers cannot be persisted. See [baseline evidence](evidence/riffoid-entry-baseline-and-log-privacy-20261009.json).

The parent's October 9 07:44 UTC metadata-only readback adds eight successful
GETs: account Logpush jobs, corresponding zone Logpush jobs, account observability
destinations and the relevant entry/Gateway script's tails, for both accounts.
All returned HTTP 200 with empty lists. These are instantaneous connector
observations, with no business logs read and no Tail opened; raw responses were
not received locally. Recheck before publication because jobs/subscriptions can
change. The snapshot does not change `persist=true`, enumerate every integration
or custom-field rule, or establish future proof privacy. The parent has requested
temporary publication, both persist=false changes and restoration, and a single
test of at most 120 seconds; user approval is still pending in this task.

## Official field contracts and limits

Workers Logs describes invocation records as request/response metadata alongside
custom/error logs. It does not promise an exhaustive header-free stored schema.
Consequently this review neither claims current Workers Logs stores every header
nor treats an undocumented omission as a privacy guarantee. Disabling
`invocation_logs` removes automatic invocation records, not every other sink.
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

Tail's request schema explicitly contains header names and values. Default
redaction covers Cookie/Set-Cookie and names containing auth, key, secret, token
or jwt; `getUnredacted()` can bypass it. `x-riffoid-entry-proof`,
`x-riffoid-entry-signature` and `cf-connecting-ip` match none of these documented
name rules. They therefore have no promised default redaction. This is a schema
risk assessment, not an observation of production events.
[Tail contract](https://developers.cloudflare.com/workers/runtime-apis/handlers/tail/).

Real-time logs include request headers, separately from persisted Workers Logs.
An empty `tail_consumers` array does not establish absence of live dashboard or
Wrangler subscriptions. Do not open either during validation or capture a HAR,
raw event stream or request dump.
[Real-time logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/).

`observability.logs.persist=false` turns off Cloudflare Observability storage;
configured OpenTelemetry destinations may still receive logs. The installed
Wrangler schema independently defines persist, destinations and invocation_logs;
`redact_query_string` only concerns URL queries, not these headers. No documented
per-path proof-header suppression was established by this review.
[OpenTelemetry configuration](https://developers.cloudflare.com/workers/observability/opentelemetry-export/),
[script settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/).

Zone HTTP Logpush can explicitly record custom request headers, including raw
values. Worker `logpush=false` does not establish that zone HTTP exports are off.
The applicable `http_log_custom_fields` rules and HTTP job field/filter metadata
must be checked in both actual zones. Absence of late-request-transform entrypoint
is unrelated to absence of this logging phase.
[HTTP custom fields](https://developers.cloudflare.com/logs/logpush/logpush-job/custom-fields/).

## Smallest conditional configuration difference for publication approval

For only `riffoid-entry` in account `3232ebc7e9bb0199b92e3d70b07825af` and
`riffology-m1-gateway-staging` in account `8b0d70250211aa10d89e20605a1c7e5e`,
the candidate is **`observability.logs.persist: true → false`**, once per Worker.
Keep all other observed fields, bindings, consumers, routes, assets, DO identities,
containers, triggers and policies at their exact baseline. This is a proposed
configuration difference, not a partial API body or an uploader.
The [non-executable overlay](artifacts/riffoid-validation-preparation-20261009/log-privacy-overlay.NON_EXECUTABLE.json)
leaves authorization, actual post-state and pipeline receipts null.

This removes these two Workers' persisted custom/error/invocation logs for the
entire approved window, including scheduled and in-flight DO work. Their HTTP
maintenance fence does not stop those tasks. The loss of those diagnostic records
and its duration must be explicitly accepted in publication approval. Keeping
sampling at 1 or merely hiding URL queries cannot substitute for the storage
change. Adding `invocation_logs=false` alone does not establish the stronger
all-sink privacy condition; renaming headers to trigger heuristic redaction is
also not a solution.

Before use, read only configuration metadata and return a strict whitelist:
observability fields/destination presence, Tail consumer IDs and active-live-tail
status, Workers Trace Logpush metadata, and both zones' HTTP job dataset/enabled
state/selected field names/filter plus custom-header rule names. Do not return
destination URLs, destination_conf, export credentials, real event values or
business logs. Metadata should be selected inside the connected tool before
output. Missing permissions/status/schema means **unknown**, not empty.

Proceed only if fresh full settings and guards prove no applicable external
destinations/consumers/active live Tail, and no applicable zone export capturing
full proof/signature. IP export must also be absent or expressly resolved before
an IP-private claim. Check other existing capture/integration configuration;
unknown capture prevents approval. Do not silently alter or disable account-wide
jobs, add a redaction Worker, expand permissions or start an experiment to discover
what was logged. The 07:44 empty-list snapshot supplies eight endpoint observations;
fresh publication-time settings/pipeline guards and explicit approval remain required.

## Verification, failure and restoration

After a separately approved publication, independently GET full actual settings,
version/deployment and exact module/config snapshots before any real signing.
Confirm persist=false on both, traces still disabled, known sinks remain excluded,
and the ordinary HTTP fence holds. A mismatch/unknown receipt stops the protocol;
do not retry a write blindly. Native-IP/WAF acceptance is separately pending,
so do not set the native-boundary marker from these logging facts.

At completion/failure, close entry and maintain the privacy overlay while any
validation invocation can still be in flight. Expired config continues to fence
business HTTP. Resolve unknown invocations using approved metadata only; do not
assume a 300-second wall-clock expiration itself drains all delivery. Restore
original entry code/five bindings and Gateway code/config through guarded forward
publication with original DO identities. Restore **persist=true** to each exact
captured baseline only after no validation invocation can emit a full proof into
the restored sink; other baseline fields must match, not defaults. GET and record
the restoration receipt. If the restore API is unavailable, report the remaining
privacy/diagnostic restriction and retain the closed ingress state.

The supportable conclusion is limited to the enumerated customer-configured
telemetry sinks under those checked guards. It is not a promise about all internal
Cloudflare processing, retention or every possible capture. This task provides
contract research and offline artifacts only; the actual two-account privacy,
native-IP, OAuth and browser acceptance remain pending user approval.
