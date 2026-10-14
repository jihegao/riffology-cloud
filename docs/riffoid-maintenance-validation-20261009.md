# Maintenance protocol validation — acceptance pending

2026-10-11 18:08 Asia/Shanghai：[正式配置切换及最小登录/项目检查](evidence/riffoid-direct-cutover-completed-20261011.json)。用户批准固定继续包 `22dfc77d…0991` 并保持独占发布后，仅发出 entry、Gateway 恢复配置两次各一次 PUT；196 次调用端配置 GET 全部完成，发布后 entry 22 GET、Gateway 36 GET 完整读回通过。entry 当前 `668e19e6-6f23-49e0-b4f6-06459790a496`（6绑定），Gateway `2227852e-2802-40e9-92e4-0a1b4ff8aab9`（99绑定），Execution 保持已独立确认的 `3e96532e-dbeb-4c8c-b147-7e71939b0472`（4绑定），三者原代码和原日志配置保留。实际入口发布读回时间 T 为 `2026-10-11T10:03:41.535Z`，旧入口只读原记录恢复截止 `2026-10-13T10:03:41.535Z`（北京时间10月13日18:03:41），并非自动回退旧业务。

新入口 https://app.riffoid.com 已开放；原有 Google 身份在原生 Safari 完成一次正常登录，项目列表及现有项目「22」/原 Session 1 读取成功，随后返回项目列表。没有点击 Send/Run、创建身份/项目/Session 或恢复归档；没有收集账号级权威执行计数，故不宣称全局零执行/费用。该项目原模型显示尚未通过运行检查，未运行模型。这只是单一身份/项目的最小 UI 检查，身份角色/邀请路径、完整 A/B、第二身份/权限隔离、SSE、Browser Execution、付费执行、实际48小时到期与旧记录访问均未验收。上线状态 **尚未验收**；PR #173保持 draft/open、Project Acceptance/P1、M1、负责人jihegao，不标Done、不关Issue。原待决定阻塞已解除；#175最小源码修复继续 In review/P1，未合并/未部署。

本轮控制器正常 exit0、pending为空，未使用回退、无新未知；原五份历史未知及原停止会话锁经哈希核对保留，原 PUT/A/B/Observe/Run/cleanup 均未重试。完整资产字节/集合、平台遥测排空及代理内部 HTTP 尝试次数仍不作成功声明。本条为当前状态，下方按时间保留历史记录。

2026-10-11 17:30:27 Asia/Shanghai：[直接切换中止及独立确认](evidence/riffoid-direct-cutover-partial-20261011.json)。用户取消完整 A/B 并选择直接切换，状态“尚未验收”。Gateway97绑定已发布/完整读回；Browser Execution一次PUT收到响应，但原严格检查因平台只读 `annotations.workers/triggered_by` 从 `version_upload` 变为 `upload` 停止，控制器已退出，原未知记录和锁保留。随后5原生GET定位注释差异，再78个GET完整独立确认三个当前Worker的代码、可写配置、namespace/容器及资产保留合同。Gateway当前 `34969c4a-d82c-4092-b026-33491dea789c`；Execution `3e96532e-dbeb-4c8c-b147-7e71939b0472`；entry `7c04a21d-c95a-4a4c-a6b8-e21282fdc1f0` 仍disabled。新业务未开放，旧完整应用中断，T/recoveryUntil仍空，登录/项目最小检查未启动。原5份历史未知保留；平台注释确认不代表业务健康。

当前阻塞是用户此前保留的“未知后另行批准”决定：固定继续包已准备，仅需entry与实际T+48h的Gateway两次发布；或两次恢复旧Gateway/Execution。20项离线发布边界及实际99绑定multipart/只读注释处理检查通过；新scope尚未执行。不会重试原PUT、重跑A/B或清理记录。PR #173保持blocked，#175源码修复In review/P1；不标Done、不关Issue。

2026-10-11 17:00:55 Asia/Shanghai：[两份 Observe 403 与完整恢复证据](evidence/riffoid-origin-denied-recovery-20261011-66559c.json)。本轮两次维护发布后，电脑 Safari 与手机各一次 Observe 明确返回 `403/origin_denied`，Run/entryReady/cleanup 均未发起；单独批准后的四次各一次恢复全部通过完整读回，原 Gateway/entry 代码、95/5 绑定和日志已恢复。Gateway 当前版本 `7467fa4a-dc57-4178-aae0-ee5fa00db6be`，entry `7c04a21d-c95a-4a4c-a6b8-e21282fdc1f0`；Browser Execution 本轮未发布或重读。四份历史未知记录保留，没有新未知发布。403 定位于验收页 `no-referrer` 在 Safari 的同源 POST 将原生 Origin 变为 null；最小 `same-origin` 修复与夹具校正进入 PR #173/#175，19 项相关测试、类型检查及 2 项本地 Workerd 回归通过，尚未部署或完成线上验收。

用户随后明确允许取消完整 A/B 验证、改为直接切换；后续发布状态必须标为**尚未验收**，先准备正式配置及旧入口回退，切换后至少确认一次现有登录和项目访问。此前双网络协议和第二身份/空闲 Session 不再作为直接切换前提，其未覆盖范围保留。当前尚未正式切换，T/recoveryUntil 仍为空；普通业务健康仍未知。完整资产集合、平台遥测排空、账号全局零执行/费用均不作成功声明。

2026-10-11 16:03:42 Asia/Shanghai：[零发布预检停止与完整只读核对](evidence/riffoid-native-preflight-20261011-c100.json)。`80e5ed67…b0c10` 获批时已不足以完成预检，未启动；获明确批准的 `6a6c6069…7eefd` 在第二次原生 Worker 清单 GET 超时后停止，32 次 GET 发出、31 次完成，首次 PUT 前失败，无 intent/unknown 写入，进程已确认退出。独立诊断随后完成 Gateway 36 次 GET（约 87 秒）及 entry 22 次 GET（约 59 秒），前后原生部署/版本、源码、完整配置、资源和日志管道核对通过；仍为原恢复版 `6d580077…202135` 和原 entry `c110d7a7…7fff`。本轮 PUT／A/B Observe／Run／cleanup 均为零；原四份 unknown、历史数据及日志设置保持。超时原因未确定，keep-assets 不代表完整资产审计，不宣称平台遥测排空或全局零执行/费用。取消的包与配合时段不复用；后续必须留足逐阶段完整读取时间。协议及真实第二身份／已有空闲 Session 验收仍 pending，正式 T/recoveryUntil=null。

2026-10-11 15:07:51 Asia/Shanghai：本轮新恢复批准已执行。原 Gateway 代码、95 个绑定和原日志已恢复，版本 `6d580077-1042-4242-9ca5-665008202135` / deployment `be951946-ead9-4da9-814f-d493d2d13520`。两次原生 PUT 分别应答 5.127 秒和 6.104 秒，各一次、零自动重试/重定向；前后完整独立读回通过，临时维护配置已移除。原四个 unknown 及锁保留，本轮验收不重跑。后续部署/版本身份列表已限定为原生 GET，6 项边界检查及八阶段零网络模板检查通过；配置清单仍使用原严格解码范围，未扩大写入或权限范围。最初读回不一致的传播/读取原因仍未确定。资产字节与平台内部遥测排空未证明，用户接受恢复日志后可能保存迟到遥测。域名切换及真实 A/B 协议尚未验收，正式第二身份和既有空闲 Session 仍缺失；T/recoveryUntil=null。[本轮恢复与读取修复证据](evidence/riffoid-native-maintenance-20261011-5599.json)。

2026-10-11 14:56 Asia/Shanghai 本轮记录：Gateway 单次原生 PUT 在 6.294 秒应答，随后 deployments 的 active 与 versions 的 latest 不一致，控制器立即停止并保留原 intent、unknown 和锁。另一次仅 GET 的完整核对确认临时维护版本 `ef94e323` / `2461c5da` 已生效、日志持久化关闭，既有资源保持。Entry 与 Browser Execution 未发布；A/B Observe、Run、cleanup 均未发起。本轮不重跑。两次各一次的原 Gateway 恢复载荷已冻结并离线核对，计划 SHA `ee5ce9366d1ddf5c902184e92f2fe1b037ae4f99b078051819a9bc8d88688276`，恢复尚未发出 HTTP，需本轮新批准。平台内部遥测排空及资产字节未证明；恢复日志可能保存迟到遥测。[本轮停止、只读核对与恢复包证据](evidence/riffoid-native-maintenance-20261011-5599.json)。正式切换未开始，T/recoveryUntil=null；第二受邀身份与既有空闲 Session 仍缺失。

Earlier October 11 preflight (before the 14:56 record above): the frozen five-minute round stopped before durable intent or PUT because the native Zone-ownership GET exceeded30 seconds. The original Gateway and logging remain restored; no server maintenance configuration or browser protocol operation was published. The exact configuration/identity GET router is repaired, with6 boundary checks and two actual decoded Zone-ownership readbacks passing. Source/module evidence and every PUT remain native. See [preflight and routing repair](evidence/riffoid-zone-reader-preflight-20261011.json). The user currently has no second invited identity without target-project permission or existing idle Session for the agreed formal acceptance; these observations remain pending. Fresh phone cooperation is requested before another window. T/recoveryUntil remain null.


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
