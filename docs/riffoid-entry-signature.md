# 入口专属签名与防重放（仅实现和本地验证）

2026-10-08 06:44:24 UTC用户批准继续实现签名方案，明确生产密钥创建/配置仍另确认。本次没有真实持久key、线上namespace、部署、权限或安全设置变更。PR173的新入口和双账号Gateway默认disabled，原单域现网保持。新`signed-entry-v1`模式必须完整配置才可用；shared-limited保留旧fixture回归用途，仍禁止部署。此前WAF-only草案的same-zone反例不能通过两条规则消除，本实现增加script持钥证明；部署与真实双账号验收尚未完成。

实现：[入口](../services/entry/index.ts)、[签名/验证](../services/entry/signature.ts)、[独立原子nonce DO](../services/entry/replay.ts)、[Gateway接线](../services/gateway/index.ts)、[原限流配置](../services/gateway/auth.ts)。使用平台[Web Crypto ECDSA P-256/SHA-256](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)与[SQLite DO transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)，没有新增依赖、安装或自制密码算法。

## 信任边界

新入口持独立私钥，原Gateway只存公钥pin（最多两个key ID）。同zone或外部Worker即使伪造CF-Worker、IP、签名头、真实入口hostname，也不能构造有效入口签名；入口私钥不共享给其他script，原BETTER_AUTH_SECRET/OAuth秘密不复制。新/旧账号能够编辑入口代码、密钥绑定、公钥pin或Gateway的管理员仍属信任边界，签名不能保护被恶意修改的受信代码。

**原生IP采集仍需要新zone入口来源门禁**：Cloudflare计算的`cf.worker.upstream_zone`非空请求必须在`app.riffoid.com`被Block，以拒绝同zoneWorker修改x-real-ip后调用入口。ENTRY_NATIVE_IP_BOUNDARY须在这一真实平台边界成立后才设为`cloudflare-direct-visitor-waf-v1`；它是管理员配置确认，**不是代码自行证明WAF有效**。入口缺该配置/有效原生CF-Connecting-IP则503/403，不取x-forwarded-for/CF-Connecting-IPv6/custom-IP回退；CF-Worker存在额外拒绝只作防御，不替代平台字段。PseudoIPv4必须Off、原生IP不可被Transform移除/覆盖；现新zoneOff已读，Transform开关及平台负向验收仍缺。

原zone精确transport仅允许riffoid.com Worker来源的WAF规则作为补充DoS边界；即使同zonepeer满足它，仍必须通过私钥签名及nonce。WAF规则没有执行。**签名有效仅证明入口请求完整性/IP限流输入，不证明用户身份、邀请或权限**。原Google/session/Catalog/authVersion/撤回、CSRF、G5 capability/scope/order/expiry、资源及执行门禁仍独立执行，不复用签名作为用户权限。

## 规范协议 v1

入口使用既有严格HTTPS canonical/固定transport URL路由，真实浏览器Origin保持。签名消息是UTF-8 `JSON.stringify`产生的固定顺序12元数组：

```text
["riffoid-entry-v1", keyId, canonicalOrigin, transportOrigin,
 method, originalPathAndQuery, issuedAtMs, expiresAtMs,
 nonceBase64url, canonicalClientIp, bodySha256Base64url, headersSha256Base64url]
```

`originalPathAndQuery`取平台Request.url中origin之后的原字符串，保留percent编码、重复参数和顺序，不用URLSearchParams重排；签名目标实际URL与固定transport精确匹配，方法/Host/upgrade独立检查。受信代码不能伪造Origin以绕过CSRF。12元数组/UTF8/JSON拼写必须完全canonical；两个协议头`x-riffoid-entry-proof`（无padding base64url、≤2048字符）与`x-riffoid-entry-signature`（Web Crypto64-byte signature、86字符）重复/合并/非canonical均拒绝。签名算法固定，来路不能选择算法；入口payload超过1536 bytes立即414、不fetch，确保proof符合接收上限。

headers摘要是固定allowlist顺序`[[name, value-or-null], ...]`的UTF8 JSON SHA256；绑定Accept/Accept-Language/Content-Type/Cookie/Origin/Referer/Fetch Metadata/Idempotency-Key/Last-Event-ID/Range/条件请求/User-Agent及两个原G5 read proof字段。区分缺失和空值；以平台已解析Headers的同一语义表示签名和交给应用。禁止签名后再做有意义的header规范化/改写；其他客户端头被丢弃，proof头在验证后删除，任何来路custom-IP都被覆盖。真实HTTP平台不得改动已绑定值，若改动只会拒绝，不放宽验签。

body摘要绑定完整原始字节；不parse/stringify JSON、不改请求key或body。签名时间在入口读取完整body后才取当前UTC毫秒，expiry精确+30000ms；Gateway只允许issued≤自身now+5000ms且now<expiry，RPC/上传等待后再检查时间和取消。DO再次检查时间。过期/未来超差/非整数/任意更长TTL失败关闭。

nonce为平台crypto.getRandomValues产生的256bit随机值（43字符canonical base64url）；Gateway验签和header摘要成功后先消耗nonce，再读取/核对body，最后进入原应用。body篡改/取消会烧掉nonce；无法靠反复提交同proof读取大body或耗auth桶。捕获有效请求者若能抢先交付可能消耗其nonce（TLS/禁止敏感日志是边界），nonce不是抗合法签名泄露的保密通道。本实现不会重新签名、补nonce或retry；应用原key/只读receipt处理未知执行，不能推断未接受。

## 原子持久防重放与故障

拟新增原Gateway绑定ENTRY_REPLAY → EntryReplayGuard的**独立SQLite namespace**，不借用原身份/历史/容量DO。固定64 actors：`riffoid-entry-replay-v1:0..63`，由nonce首6bits确定；DO复核ctx.id与固定shard，内部RPC无公开fetch。SQL事务内清理、查重、容量检查、insert，nonce primary key唯一；无await事务、无内存-only cache、无跨shard查重。平台持久输出门禁在RPC答复前确认写入；并发同nonce只一个accepted，重启仍拒绝。

每shard最多4096行，总计≤262144；每次仅清最多64个已到expiry+5秒的nonce，expiry索引限制查询。满则503，不能提前删有效nonce放行。无alarms/network/background tasks；闲置shard最后一批**已逻辑过期**行留到下次请求再清，仍有行数上界，不能宣称自动物理TTL删除。只保存随机nonce/expiry，不存Cookie、用户、IP、请求body或密钥。不能在开启期间清空、更换namespace或从旧快照恢复，否则活跃proof可能重放。

RPC最长2秒；超时、binding缺失、写入失败、容量满、取消均失败关闭，零auth执行、无retry。超时RPC可能稍后落盘：将nonce视为未知/已消耗，不能恢复或给同proof补尝试。重放403，配置/存储故障503。DO只接受被Gateway验证后的值；绑定不能暴露给不受信worker/project/runtime。

## Body、SSE与容量限制

一般请求body≤32768 bytes、5秒、8192 chunks；原精确`POST /api/admin/models/<id>/content`保持8MiB/30秒上限。下游原8KiB JSON、12/32KiB专用route及operator/draft权限限制仍在，不扩大业务准入。完整摘要需要有限缓冲，不能处理无限/未验证流上传；超限413。拒绝压缩/stacked transfer、重复或非法Content-Length、Length+Transfer-Encoding并存、声明长度不匹配。平台已解chunk framing的单一chunked可以有限读取但不转发framing头。

每isolate在读body至响应headers期间最多32个普通有body请求、一个8MiB上传；读取阶段另有同上限守卫，无排队/扩容/重试，满则503。字节拷贝和buffer内存有固定上界，但真实CPU/latency/平台配额仍需平台负载验收。无body GET/HEAD不分配上传buffer；SSE响应不整流读取/clone/text/arrayBuffer；仅在下游pull时逐块读取，保持原cursor和取消传播、cache-control no-store,no-transform。nonce只在打开HTTP响应前确认，长SSE不持RPC/上传slot。断线后的新观察由原客户端协议发起新HTTP请求/新签名，不能重放Turn/Run。

原BetterAuth数据库30/60秒及sign-in3/10秒保持。只有经实际签名/nonce/body验证的request会由Gateway设置x-riffoid-client-ip，并将其选为唯一auth IP header；内部IPv6统一规范化。单域和旧只读恢复不采纳custom-IP，未验证请求在auth创建/写rate rows之前拒绝。

这不是公共流量DoS或费用保证：入口可为匿名直接访客签名，匿名请求会消耗crypto/DO操作，静态GET也需nonce；原auth限流不是整个transport的流量预算。每shard满可能影响合法访客；64shard不是吞吐SLA。上线前需核验套餐/预算、告警和无付费压力验收，不自行扩容或加付费产品。WAF旧规则减少外部无签名请求进入Gateway的成本；入口洪泛仍需后续明确边界。

## 生产配置申请（未批准、未执行）

1. 新账号`3232ebc7e9bb0199b92e3d70b07825af` / riffoid.com zone `b0b0079990e13eb20a17a2d3c41403b8`：指定单一riffoid-entry Worker新增**Secret ENTRY_SIGNING_PRIVATE_JWK**，仅五字段`kty=EC,crv=P-256,x,y,d`；普通var ENTRY_SIGNING_KEY_ID为唯一公开ID。创建/保存/注入真实私钥动作须行动时确认，本次没有生成生产key，也不把key值写入文件/PR/日志。新入口无原auth/provider秘密及应用数据绑定。
2. 原账号`8b0d70250211aa10d89e20605a1c7e5e` / Gateway riffology-m1-gateway-staging：新增公开var ENTRY_SIGNING_PUBLIC_KEYS_JSON，严格`{keyId:{kty,crv,x,y}}`，最多2个ID，禁止d/私钥。公钥来自上述获准生成动作，先核对pin及算法，不能让请求指定或自动下载公钥。
3. 同原Gateway新增ENTRY_REPLAY绑定，class EntryReplayGuard及**新SQLite namespace**；申请新的migration tag `entry-replay-v1` / new_sqlite_classes `[EntryReplayGuard]`，实际namespace ID待批准后创建回读。这是独立安全资源，原93 bindings/DO namespaces/class/actor/budgets不改；从完整live configuration做加法overlay，不能部署精简模板。无新D1/R2/container/service binding。
4. 两侧都显式新增`enable_request_signal`；新入口fixture/template日期为2026-09-06；原Gateway及前向回退保持已核验live日期2026-09-09，两者不能混用。新入口flags精确为`[global_fetch_strictly_public,enable_request_signal]`；原Gateway从`[nodejs_compat,nodejs_compat_do_not_populate_process_env]`变为该两项加`enable_request_signal`。原Gateway staging线上配置未编辑，此处仅完整overlay申请。不能假定兼容日期会启用该flag，不使用隐藏`request_signal_passthrough`。
5. 完成原zone/Google现配置缺口及精确transport/两条WAF规则批准、原生IP平台验收后才设ENTRY_NATIVE_IP_BOUNDARY。两边TWO_ACCOUNT_AUTH_MODE仍disabled直到完整公钥/Secret/DO/URL/Google/CSP包审阅并获准启用`signed-entry-v1`。canonical/transport/recovery/Execution现差异沿[配置包](riffoid-two-account-configuration-package.md)；此实现授权不包含线上更改。

### 轮换、撤回与回退

首次上线/轮换先冻结完整旧Gateway/Execution/入口版本及所有配置、公钥pin和nonce namespace。轮换先向Gateway完整100%部署加入新公钥（最多旧+新），再单独获准更新指定入口私钥Secret/active key ID；观察成功后从Gateway移除旧公钥。移除即时对新请求撤回，需确认所有active版本都使用新ring；不得长期混用不同ring的流量。已打开SSE保留原用户权限/时限，不因传输key轮换扩大观察窗口。

泄露/撤回时关闭新准入并移除相应公钥，冻结原key状态/观察未知请求；不为可用性回加已撤回key。nonce namespace持续保留，不能轮换时顺手重建或deleteAll。

**新增DO class迁移之后不能直接回滚旧Gateway版本**：[Cloudflare限制](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)禁止跨DO class生命周期迁移回滚。在创建资源前应冻结并核验前向回退包：保留EntryReplayGuard export、ENTRY_REPLAY绑定/namespace和迁移历史；用已评审Gateway代码的原单域路径恢复原APP_ORIGIN，整组移除APP_TRANSPORT_ORIGIN、TWO_ACCOUNT_AUTH_MODE、LEGACY_RECOVERY_ORIGIN、LEGACY_RECOVERY_UNTIL（不能留下半组）。入口设disabled/停止新准入；Execution恢复原ancestor/origin及冻结assets/config。原93绑定/资源及PR172/174资产/业务语义保持，额外security class休眠不写应用数据。实际可部署回退artifact和平台验证须在上线批准前准备并冻结，不能只拿旧version ID作回退证明。不回滚数据库/历史或清账，原Googlecallback保留；删除Secret/namespace需另批准。

真实成功切流才启动已批准48h服务端恢复；现在无cutoverUTC/until。server过期API410，旧静态指南及本机原字节Runs导出继续保留；内部身份/历史/12月31trial/10月20M1不变。线上验收必须覆盖实际平台IP/来源、原Google主体/权限撤回/CSRF/G5/SSE/跨账号TLS与fail-close，不能以本地合成IP/身份/临时key替代。

## 取消链与回退评审补充

原生Incoming Request.signal在Workerd中默认带IGNORE_FOR_SUBREQUESTS，直接传给fetch不保证取消。两侧signed路径现在使用[标准AbortController桥接](../services/entry/abort.ts)，将原生abort转换为普通signal，body重建保持该signal；监听延续至响应body结束/取消，按pull逐块读取，取消上游reader，无预读/整流buffer/重试/隐藏flag。Gateway原单域路径仍使用原handler，新增flag对整个Worker生效；本地原单域session、CSRF、assets和真实SSE断开已另验证。参考[Cloudflare Request.signal文档](https://developers.cloudflare.com/workers/runtime-apis/request/#properties)与[Workerd明确IGNORE_FOR_SUBREQUESTS代码](https://github.com/cloudflare/workerd/blob/cb61e82b35bf4cac7fc69821743337b8ca498bd5/src/workerd/io/worker-entrypoint.c%2B%2B#L463-L472)。

新[真实HTTP测试](../tests/m1/riffoid-cancellation-workerd.test.mjs)使用直接Workerd loopback sockets；普通Miniflare dispatch/proxy和fetcher会掩盖断开/增加header，故网络适配器用保留全部签名头的Node HTTP转发。客户实际TCP reset触发入口原生abort，标准桥接取消出站fetch；适配器在真实出站连接取消后reset下游socket，Gateway原生abort再经普通桥接停止验证/观察。关闭flag对照不会产生原生abort。不是手动AbortController取消，也不是生产TLS/DNS/跨账号证据。

晚提交分开两类：[模拟store单测](../tests/m1/riffoid-signature.test.ts)证明RPC已发起后超时/取消→晚persist→同proof replay拒绝/零auth/no retry；真实本地Workerd测试注入DO首次RPC2300ms延迟，并以**仅fixture的ctx.waitUntil**确保延迟RPC活到真实SQLite commit（生产claim是同步事务，无该延迟/后台任务）。先查询真实DO issued表确认已收到RPC，再断开/超时；最终原nonce真实落盘，精确同proof重放返回`entry_replay_denied`且第二claim仅来自明确负向重放；auth入口probe=0、原D1 auth_rate_limit=0。不能把本测试延迟机制声称为生产DO调度/持久化时延保证。

真实SSE串起生产entry/Gateway handler、同SQLite replay和生产turnEventStream；producer位于测试asset adapter、authorize/replay和身份是fixture，不是完整真实Catalog用户的应用SSE验收。实际下游首chunk、Last-Event-ID=12、两侧native abort、observer polls停止、单fetch/claim和零auth均验证；原单域Gateway增加flag后也真实断流停止观察。原应用身份/G5/SSE行为另由已有本地回归支持，不合并宣称真实用户验收。

**响应头前普通TCP FIN仍未证明即时取消**：直接HTTP延迟fixture实际观察两侧native abort=0，Gateway2秒timeout使该fixture零auth、nonce晚落盘、无重试；这不证明较快RPC/认证路径在FIN后一定不会继续。TCP reset和已开SSE证据不能替代该缺口。准确承诺是：平台abort实际到达时，停止尚未进入业务的验证和流观察；没有回执的结果仍未知，按原业务request key核对、不自动重试；已经提交的操作使用原业务cancel，不承诺TCP FIN撤销或事务回滚。该FIN观察不是禁止所有部署的独立阻断，真实平台取消/未知结果语义仍属后续获准验收范围，不能伪造signal/Origin或放宽验签。

前向回退交付[源entrypoint](../services/gateway/forward-rollback.ts)、[非可执行配置申请](../infra/riffoid-forward-rollback.request.jsonc)、[本地构建器](../scripts/m1/build-riffoid-forward-rollback.mjs)和[实际Workerd验证](../tests/m1/riffoid-forward-rollback-workerd.test.mjs)。源入口export集合与Gateway完全一致、保留所有原DO和EntryReplayGuard；要求原canonical、整组删除4个topology vars且保留ENTRY_REPLAY绑定，半配置503。相同本地namespace/SQLite数据经worker重建后仍拒绝原nonce；原session ID/user ID/expiry原样、wrong Origin403且session不变、原资产/CSP与单域SSE保持。构建输出`.local/riffoid-forward-rollback/worker.mjs`及manifest明确LOCAL_BUILD_NOT_PRODUCTION_FROZEN；namespace ID、完整migration history、93+1 bindings/secret references、assets hashes、生产版本/routes/security/Google完整列表及平台验证仍缺，不能把此template/本地build当作冻结生产artifact。保留数据、不清namespace、不用旧版本跨migration raw rollback。

## 完成的本地验证（历史阶段与当前评审阶段分开）

全仓npm run check退出0，含UI21、M0350通过/1条件跳过、M2869、Issue7330、Python8及M1/M3。自审补proof大小和原始URI（保留空尾问号）守卫后，最终typecheck通过、完整M1 **341/341**、完整M3 **1070通过/12条件跳过/0失败**；这是取消链评审前的历史阶段；当前新增桥接与回退源入口后再次运行affected完整回归，最新结果见下述评审证据。定向17项和Workerd集成项重叠完整回归，不叠加总数。

实际本地双Workerd测试含原Google/PKCE/Catalog、被撤回身份拒绝、无效/重放proof零auth-rate写、两个原生IP fixture独立限流及sign-in3/10限制；实际SQLiteDO24并发只accept1、重启持久拒绝、满容量/限量清理/写失败事务回滚；签名后的实际G5 GET/attestation/reopen/权限与顺序期限负向/重启通过。SSE逐块/cancel、local Runs原文零写与过期静态/API边界通过。所有native-IP/identity/key均synthetic，真实平台/Google/付费执行未运行。命令阶段、源代码/日志SHA256、自审发现和未覆盖边界见[冻结证据](evidence/riffoid-entry-signature-offline-20261008.json)。

当前取消链/晚提交/前向回退阶段、准确命令/源代码和日志hash、旧证据纠正及FIN边界见[评审证据](evidence/riffoid-entry-review-offline-20261008.json)。

当前评审后typecheck通过；完整M1 **348/348**；完整M3 **1070通过/12条件跳过/0失败**，这三项命令退出0。未重复未受影响的UI/M0/M2/Issue73/Python；其全仓check结果仅保持为上一阶段证据。当前生产源入口没有在上述完整回归后再编辑。

日期专项更正：2026-10-08T08:40:44.103Z以现有授权对原Gateway deployment/active version做GET，只回读非敏感metadata。当前100%版本`aeddf112-a2be-45da-868c-ed576c55d5ec`、deployment`c6ff55e4-2364-4920-94e0-b8784a1824b5`的live compatibility_date为**2026-09-09**，flags仍为原两项，bindings93。之前把09-06入口fixture日期写为Gateway继承日期，已纠正模板/build manifest/overlay和对应本地Gateway fixtures；入口09-06保持独立。仓库旧简化staging config和一般本地config的09-06不是完整live配置来源，未改线上日期或资源。新日期证据及针对性测试见[日期专项证据](evidence/riffoid-entry-date-correction-20261008.json)。
