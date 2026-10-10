# Maintenance protocol validation — implementation only

October 11 continuation: [post-recovery preparation](evidence/riffoid-post-recovery-preparation-20261011.json) records fresh complete Gateway/Entry/Execution readbacks, current WAF/header-policy inventories, and seven offline fixed configuration-only formal cutover/restoration bodies. The three historical unknown journals and locks remain unchanged. The old protocol is not resumed; no new window or browser protocol operation has opened in this preparation. Targeted checks pass 52/52. Both actual native-IP/signature receipts and agreed authenticated acceptance remain required; T/recoveryUntil are null. Deployment/version-list metadata may use a strictly scoped decoded GET bridge; source/modules and other native evidence preserve their actual provenance. Neither asset-set byte coverage nor platform telemetry drain is claimed.


The fixed formal controller and dispatch authorizer now pass 19 offline FileJournal checks, including original PUT duplication, concurrent authorization, backend drift before opening entry, and acknowledgement loss without rollback/retry. This supplies implementation for exact three-step activation and known-failure close/forward restoration; it does not arm the formal transport session or provide authenticated acceptance capabilities. Domain/certificate inventories and script aliases are read back; the capacity snapshot's December31 deadline matches the authorized extension in Issue104, while M1 remains October20. No new maintenance/protocol operation or production PUT occurred.

October10 live recovery completed at15:45:27.679 UTC: [restored-state evidence](evidence/riffoid-original-write-restored-20261010.json). The user approved frozen recovery plan d99d92fd180ad9f7206200c8d4f38edc3d0e589ccaf765d909dd667527fda887, including original logs and late-telemetry risk. Each of its two PUTs was dispatched once. Complete independent GET evidence confirms the original module,95 bindings,23 exports,5 container associations and baseline observability, with temporary validation configuration removed. Gateway is now version a00f97bc-f0da-4e04-97b0-8f96f0a26a89 / deployment d78a6f03-2552-4076-8ad5-7abd1802654c.

All three durable unknown records and locks remain unchanged. The first recovery PUT timed out; the second returned success, then its version-list GET timed out. Independent readbacks establish current restored configuration without rewriting these request outcomes. No PUT is replayed, no protocol window is reopened, and no model/Turn/Run request is initiated. The logs-only continuation consumes the same explicit two-write approval and exact frozen second payload after full privacy readback; it cannot repeat the first write or authorize a third.52 live-adapter/recovery checks pass. Asset-set/byte auditing and telemetry drain remain unproven. Domain cutover and authenticated acceptance are pending; historical paragraphs below are superseded by this snapshot where they describe current recovery status.

October 10 offline integration: the reviewed v2 + v3-p2 repair uses a fixed 300-second single-round schedule, checks the marker before begin, and deduplicates the original A-page cleanup. See [current contract](riffoid-validation-offline-adapter-20261009.md) and [fresh integration evidence](evidence/riffoid-offline-integration-20261010/summary.json). The user approved PR173 push/deployment at 00:53 UTC; this task performs source integration and PR push only. Restoration and unknown-log decisions remain pending; no deployment or new live protocol request is made. The earlier preflight and authorization paragraphs below are dated history.

October 10 update: [fresh preflight evidence](evidence/riffoid-cutover-preflight-20261010.json)
rechecks the unchanged active Gateway/entry/Execution identities, exact code hashes,
95/5/4 binding digests, WAF and telemetry metadata. The existing targeted suite
passed 45 tests and typecheck; maintenance bundles and non-executable requests are
in `.local/riffoid-cutover-20261010/candidates/manifest.json`. Runtime source and
production configuration were unchanged. Actual visitor IPs, maintenance interval,
post-state guards and original rollback payload remain unresolved; this is not a
ready-to-publish manifest. The Mac is locked, so the existing authenticated browser
and original Google identity are presently unavailable. Formal T remains null.

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
public IPs and a UTC epoch interval of 45–300 seconds; its example deliberately
contains nulls. Config presence fences normal business routes with 503, even if
malformed or expired. It never opens the application automatically. An existing
explicit recovery pair, if present, retains the original recovery handler; this
pre-T protocol-only window must not invent T or start its future 48-hour clock.

This is an **HTTP business-entry fence**, not a platform shutdown. The unchanged
Gateway scheduled handler still dispatches provisioning via `sweep(10)` and runs
Revision GC concurrently; existing in-flight DO/runtime work, alarms and other
delivery paths are not cancelled or paused. Consequently the test's own zero
model/tool/Turn/Run calls do not prove zero account activity or zero platform cost.
Before a future window, check existing in-flight work through previously available,
semantically read-only observation only. `recoveryTurnSnapshot` is a pure journal
view, while ordinary `turnSnapshot` performs preparation/admission/budget work and
is not an interchangeable read. Constructor/actor activation and authoritative
coverage also need review before RPC use. No recovery pair is currently configured;
do not invent T, add an access path/helper Worker, start a session, invoke GC or
reconciliation, or pause cron/background work to obtain a clean-looking result.
If an authoritative read-only inventory is unavailable, report that gap and defer
the maintenance publication decision; no current in-flight-zero claim is made.

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
invocation to 45 and window to 300. Summary reads are at most 1024 bytes.

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

The [isolated offline repair](riffoid-validation-isolated-repair-20261009.md)
aligns the maximum with the recorded 300-second approval ceiling, moves the marker
check before begin consumption, and supplies an offline stage/receipt validator.
Historical readbacks below remain dated evidence. Actual publication, native
browser coordination and both risk decisions are still pending. Application terminal evidence does not prove platform drain.

The original account (`8b0d70250211aa10d89e20605a1c7e5e`) retains Gateway
`riffology-m1-gateway-staging`, all D1/R2/DO and Browser Execution. The new account
(`3232ebc7e9bb0199b92e3d70b07825af`) retains entry `riffoid-entry` and the app domain.
These IDs are historical frozen evidence, not a fresh read in this task.

Parent connector readbacks at 07:26–07:27 UTC are now recorded in
[entry/rule evidence](evidence/riffoid-entry-baseline-and-log-privacy-20261009.json).
The entry remains disabled with five bindings, actual latest/active version
`c110d7a7-fc81-4bb1-b27a-4ca8147a7fff` and deployment
`5e920993-ee9d-4a7e-b6fe-39ef494f35fd`. Original delivered 16198-byte SHA256
`856eb92c777ee04a569dfe53f5bec44d90566341e9c2d3632bf7f4c75de9a0eb`
becomes the parent's extracted 16197-byte SHA256
`7a71a528d3ee7014621848e16801aeddd12c8f39edd3431720d089f337bb7dc4`
by removing exactly one final LF; original bytes are preserved. This proves that
byte comparison, not whether the API or extraction caused the LF difference.
Full raw multipart/settings/bindings receipts remain required before publication.
Both WAF IDs/expressions are attested; new-zone pseudo IPv4 is off and the supplied
six managed transforms are disabled. Only late-request-transform entrypoint
absence was observed, not all phases/snippets. Native IP is still unobserved and
the native-boundary marker remains unset.

Before any deployment, the user must approve the reviewed exact bundles and full
configuration, a quiet single-publisher maintenance interval, one run/two actual
IPs, native/WAF/header preflight, the three security rows/tombstone and the exact
protocol requests above. Confirm the IP/NAT/zone-control and HTTP-budget limitations.
Also approve fail-closed shutdown and guarded forward restoration. Existing logs,
Logpush/tails must be read-only checked for proof/header/body persistence; otherwise
stop, without global logging changes. No persistent credential or new resource
is required. Independent peer coverage is pending because no peer Worker is allowed.

The [official logging-contract review](riffoid-validation-privacy-window-20261009.md)
does not establish privacy under the current `logs.persist=true` settings. It
provides a separately approvable, conditional one-field change per existing
entry/Gateway Worker, plus exact restoration and metadata-only pipeline guards.
It has not been applied or authorized by this document. HTTP fencing does not
stop background work, whose persisted logs would also be unavailable temporarily.

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
across DO lifecycle or delete/reset the namespace. Entry baseline digest is now
matched; full raw baseline receipts, privacy checks and actual future post-state
remain required blockers. API outages mean pending cleanup,
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

## 2026-10-10 12:22 UTC continuation: baselines retained, writer pending

This dated follow-up supersedes the earlier locked-Mac/original-login/two-exit gaps. Original-account Safari login and two distinct desktop/mobile visitor exits were confirmed. Raw visitor IPs stay in an ignored private file. The original application authenticated as the existing Google identity; comparison at the new origin remains pending.

Exact complete rollback modules for Gateway `6edef49b`, Entry `c110d7a7` and Execution `c94df077` are retained privately with API-matching lengths/SHA-256. Fresh complete settings and 95/5/4 bindings match the previous freeze. Actual Gateway version JSON exposes all 23 SQLite exports, five current container associations and asset routing configuration; retention must keep that observed configuration. Eight scoped pipeline/tail inventories returned empty and both relevant WAF blocks enabled. Fifteen unfiltered container reads returned eight inactive instances, with no other states in those records; this is not a global activity/drain assertion. The dashboard code editor automatically issued two GET `/` previews returning `503/assets_not_configured` and connected its console; it was closed, and subsequent relevant tail lists were empty. No production configuration, capacity, instance, model/tool/Turn/Run write was submitted.

Relevant source and required fixtures from PR head `6ed830a17f2321de27446758074aff47550c99ea` were verified in an isolated directory. Seven offline suites passed **127/127**, typecheck passed, and latest Entry/Gateway bundles plus eight **non-executable** publication/restoration templates were prepared. Two initial omitted-dependency failures are retained; the final complete run passed. This is relevant-source verification, not a full checkout/tree certification or production acceptance. The old `04f00d6` candidate is marked superseded and must not deploy. No run/window/native marker was armed.

Current blocker: the existing MCP proxy may replay PUT and the reviewed non-dry-run adapter rejects writes before dispatch. The original local Wrangler OAuth expired on 2026-10-09; existing credentials do not supply a usable non-replaying writer for both accounts. Supplemental authorization for two native OAuth logins is pending; no grant or credential-value export was initiated. Previously approved application-terminal/late-telemetry log handling remains accepted; no absolute platform drain prerequisite is added. A native writer still needs independently checked all-layer non-replay, fresh complete raw readback, quiet-publisher/resource guards and actual A/B browser receipts before publication. New origin last observed `503/two_account_auth_disabled`; `T` and `recoveryUntil` remain null. Formal authentication/Execution/48-hour recovery acceptance is still separate.

Evidence: [browser and control-plane follow-up](evidence/riffoid-browser-followup-20261010.json). PR remains draft/unmerged; no Issue closure or Done transition.


## 2026-10-10 本机授权与完整发布读回

原、新账号的最小权限 Wrangler 本机 OAuth 均已完成，凭据仅保存在权限 0600 的本机命名配置。独立 Node HTTPS 通道使用一次新 HTTP/1.1/TLS 连接，不自动重试、跳转、代理或 fallback；PUT 保持 15 秒，GET 可明确采用 30 秒且完整读回仍限 120 秒。生产写入还必须绑定原始 durable intent、账号、body hash、阶段和批准窗口。原 MCP PUT 继续禁用；缺少的日志/容器元数据使用现有连接器只读获取。

7 组 preservation 检查 **135/135**、本机 HTTP 故障检查 **20/20** 通过。真实 Gateway/Entry 完整源码及全部资源读回均通过前后部署/latest/settings 括号校验，版本仍为 `6edef49b` / `c110d7a7`。原始 API 的 `use_containers`、实际资产路由字段及 nullable Tail 表示已纳入校验；Gateway 接受已批准的 keep_assets 保留合同，完整资产字节/集合审计仍未执行。无 DO 绑定、runtime/container exports 关联的 Entry 可确认没有本 Worker 的容器关联；这不宣称账号全局没有容器活动。

[本轮证据](evidence/riffoid-native-publisher-20261010.json)记录实际读回、测试范围及限制。先前字段差异和超时保留为失败证据。此快照没有生产 PUT、维护窗口、模型/tool/Turn/Run、正式切换或 T/recoveryUntil；双出口原始浏览器回执、排他协调和正式认证验收仍待完成。PR 保持 draft/unmerged，CI 不伪称通过，未关闭 Issue 或设置 Done。


## 2026-10-10 14:56 UTC — original Gateway write held for recovery approval

One native Gateway Observe PUT was acknowledged at version `a5ddd8f0-628b-4c90-8fa4-10177ffee906` / deployment `855e041d-5daa-42c4-b582-6a80b70fd3ed`. Its first readback rejected Cloudflare's changed binding array order, so the original intent remains unknown and its lock remains retained. Full subsequent GET-only readback passed after aligning bindings by their unique names: all 98 binding values, source modules, 23 exports, five container configurations and the observed asset retention contract match. Entry remains at `c110d7a7`; Execution received no write. Gateway log persistence is off; Entry logs remain at baseline. No A/B Observe, Run or cleanup operation was initiated, and this interrupted round is not an acceptance pass.

The comparer now accepts only binding order changes and still rejects duplicate/missing/extra names and value/resource drift. A separate recovery adapter requires a new exact approval for two original Gateway restoration writes, keeps the original unknown and lock, and cannot resume the validation protocol. The exact offline recovery package passed zero-network/zero-write checks; 49 related checks passed. Recovery is **prepared, not executed**, pending the user's additional approval under the existing unknown-log agreement. Late telemetry risk and platform drain remain unproven. Formal cutover, new-domain authenticated acceptance, T and recoveryUntil remain pending/null. [Evidence](evidence/riffoid-original-write-recovery-pending-20261010.json).
