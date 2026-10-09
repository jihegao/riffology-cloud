# Maintenance protocol validation — implementation only

The user authorized writing and reviewing temporary validation code on October 9
at 06:51:09 UTC, and allows the old application to be unavailable during a future
maintenance window. This supersedes the proposed old-canonical/alternate-audience
adapter and ephemeral-capability bootstrap. It does **not** authorize deployment,
Secret access, new Workers/domains, platform experiments, paid business execution
or normal application opening. Formal cutover T has not started; the formal
48-hour recovery requirement remains. Old domains, identities, history, ledger,
eight-hour sessions, December 31 trial and October 20 Shanghai M1 stay intact.

## Implemented scope

Both existing Workers use real `APP_ORIGIN=https://app.riffoid.com`, fixed
`APP_TRANSPORT_ORIGIN=https://riffoid-transport.gaojihe.cn` and `signed-entry-v1`.
The Gateway's original `appTopology` produces the verifier's canonical/transport;
there is no alternate audience or caller-supplied origin. The temporary
`RIFFOID_VALIDATION_CONFIG_JSON` contains only one run, two distinct actual native
public IPs and a UTC epoch interval of 45–120 seconds; its example deliberately
contains nulls. Config presence fences normal business routes with 503, even if
malformed or expired. It never opens the application automatically. An existing
explicit recovery pair, if present, retains the original recovery handler; this
pre-T protocol-only window must not invent T or start its future 48-hour clock.

The fixed route is `/__riffoid-validation/<run>/<A|B>/<ui|observe|run|cleanup>`;
query strings, nonempty body, Cookie, Authorization, Upgrade, supplied proof,
client-IP claims and supplied control headers are rejected at native entry.
Actual Host/Origin and `cf-connecting-ip`/absence of `cf-worker` are checked;
the existing upstream-zone WAF and native-header/Transforms preflight remain
mandatory. UI uses same-origin empty POST, credentials omit, no storage, no
OAuth/business handlers, no external assets and a hashed script CSP.

`observe` checks a real direct visitor against configured slot IP and consumes
one observation bit through the Gateway. `begin` atomically consumes a durable
slot lease **before** runtime `signEntry` can use the existing key. A/B each get
one batch across isolates and restarts. The original `signEntry` and `verifyEntry`
use their real clocks and unchanged proof/nonce semantics:

- A mints a primary and a separate unused proof from the exact real empty native
  request. Primary must return accepted and signed-IP matches A.
- Replay resends the original proof/signature, URL/method/body and all signed
  headers. Only the unsigned fixed case tag changes. It must receive the
  verifier's `403 entry_replay_denied`; a budget/WAF rejection does not pass.
- The unused proof is never sent early. After its actual expiry plus 100 ms,
  it must receive `403 entry_proof_denied`. No injected `now`, backdating,
  replacement proof or retry exists.
- B mints one primary from the second actual native exit and must match B.

A failure, lost receipt, deadline or cancellation stops the batch. The response
contains only fixed stage/case/status/error codes and booleans; it never returns
Request/headers, proof/signature, Cookie, token, IP or exception text. No logging
or persistent signing credential is added. Runtime still needs the existing
Secret, but this task neither reads it nor runs code against it.

## Budget, source and cleanup limits

`EntryReplayGuard.validationTake` uses existing fixed actor
`riffoid-entry-replay-v1:0` in the existing Replay namespace. The new security
table stores only `run_id, slot, mask, expires`; the original `claim` method and
`entry_replay_v1` are unchanged. Fixed bits are consumed before verification;
already spent/unknown cases are never reissued. Maximum authorized batch is
three fresh proofs, two primary nonce accepts, four verifier calls, two observes
and two begin leases. Each fetch is bounded to five seconds, budget RPC to two,
invocation to 45 and window to 120. Summary reads are at most 1024 bytes.

Normal complete protocol flow is **eight outgoing HTTPS requests**, plus one
optional cleanup. This is **not an aggregate HTTP hard cap**: additional denied
control lookups can occur from repeated/concurrent ingress. The offline test
deliberately observes 13 requests for normal eight plus five rejected duplicate
begin calls, while distinct signed proofs stay three. No retry is authorized.
Cloudflare requests/DO have normal platform usage; no model/tool/Turn/Run is called.

IP-only is a deliberate simplification: another client behind the same allowed
NAT can consume a slot if it knows the run path. The transport WAF identifies
`riffoid.com` zone, not the entry script; another controlled script in that zone
can spend unsigned control bits. This permits denial of the test, never a returned
signature or business access. The plan cannot claim individual tester identity,
entry-script authentication for control calls, or hard bounds over malicious
ingress. Requiring those stronger guarantees would need separately approved
capabilities or ingress enforcement; this implementation does not silently add them.

Cleanup is available only to A after hard expiry, for at most 30 additional
seconds. One transaction inserts a closed-run tombstone and deletes only this
run's already-expired A/B control rows. One nonsecret tombstone remains to prevent
reopening/repeating cleanup; at most three rows exist. It blocks later runs until
separate explicit operator handling, rather than silently rotating run IDs or
erasing security state. Original replay nonces and their lifecycle are preserved.
No alarms, namespace migration/reset or new Worker/domain/Secret is introduced.

## Future exact approval and guards

The original account (`8b0d70250211aa10d89e20605a1c7e5e`) retains Gateway
`riffology-m1-gateway-staging`, all D1/R2/DO and Browser Execution. The new account
(`3232ebc7e9bb0199b92e3d70b07825af`) retains entry `riffoid-entry` and the app domain.
These IDs are historical frozen evidence, not a fresh read in this task.

Before any deployment, the user must approve the reviewed exact bundles and full
configuration, a quiet single-publisher maintenance interval, one run/two actual
IPs, native/WAF/header preflight, the three security rows/tombstone and the exact
protocol requests above. Confirm the IP/NAT/zone-control and HTTP-budget limitations.
Also approve fail-closed shutdown and guarded forward restoration. Existing logs,
Logpush/tails must be read-only checked for proof/header/body persistence; otherwise
stop, without global logging changes. No persistent credential or new resource
is required. Independent peer coverage is pending because no peer Worker is allowed.

Protocol-only temporary Gateway metadata has 98 bindings: historical 95 with
explicit new APP_ORIGIN, transport/mode and one config; no invented pre-T recovery
deadline. Execution stays unchanged because all ordinary app/frame paths are
closed and this test never visits it. Full normal application opening later still
requires the coordinated Execution ancestor/canonical/auth configuration and actual
browser acceptance; this protocol test does not replace that step.

The [non-executable guard](artifacts/riffoid-validation-preparation-20261009/post-change-guard.TEMPLATE.json)
has real future active/latest/version/deployment/code/full snapshots and approval
fields null. No historical stage UUID may substitute for post-test/post-cutover
state. Reconcile unknown receipts using GET; never retry a write blindly. Classic
`inherit/latest` has no proven full-configuration server CAS, so exact read guards
and a quiet publisher window are mandatory.

Failure restoration order is close entry first, confirm actual mode/config, then
forward-publish reviewed original Gateway modules with **explicit old APP_ORIGIN**,
four topology vars removed and temporary config omitted, same 95 bindings/23
SQLite exports/namespaces/assets/containers. Restore Execution's explicit old
origin only if it was actually changed in an approved later cutover; restore entry
original bundle/config, keeping its Secret reference. For protocol-only adapter
removal use the frozen exact safety-stage Gateway bundle. Do not raw-roll back
across DO lifecycle or delete/reset the namespace. Entry baseline bundle/hash and
actual future post-state remain required blockers. API outages mean pending cleanup,
not claimed physical removal. T remains unset; formal successful cutover will
separately set accepted T and real T+48h recovery.

The [rollback request](artifacts/riffoid-validation-preparation-20261009/gateway-cutover-forward-rollback.NON_EXECUTABLE.json)
and [namespace freeze](artifacts/riffoid-validation-preparation-20261009/namespace-identity.FROZEN.json)
preserve actual historical IDs, modules, public pin, Secret references, five
containers and asset routing. Local module paths are review references, not
uploaded assets or a complete deploy payload. No uploader is included.

## Offline evidence and remaining acceptance

See [implementation evidence](evidence/riffoid-maintenance-validation-offline-20261009.json).
The new Workerd integration uses two local runtimes, ephemeral fixture keys and
explicit fixture native-IP/Host adapters; outbound goes only to the local Gateway,
and all other external fetches are denied. It waits about 30.5 real seconds for
unused-proof expiry and uses actual Gateway verification/SQLite nonce storage.
The separate SQL boundary test uses a clearly test-only clock for deterministic
window/cleanup assertions. Neither is real Cloudflare WAF/native-IP acceptance.

Later two real egresses require the user to open the fixed UI in a clean browser
and click observe/run once. Real Google OAuth requires the user and original
identity under a separately specified scope. Cookie/Location, CSRF, auth rate
limits, SSE, Browser Execution isolation, 48-hour recovery and peer provenance
remain independent platform acceptance; none follows from local protocol success.

References: [public HTTPS fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/),
[zone provenance](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/cf.worker.upstream_zone/),
[native IP semantics](https://developers.cloudflare.com/fundamentals/reference/http-headers/),
[SQLite transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[Workers practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
