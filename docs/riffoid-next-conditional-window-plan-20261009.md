# 下一短发布窗口：真实签名验证、条件切流与前向回退

本文件为只读研究与不可直接执行的计划。编制时没有生产GET/PUT、启用入口、读取Secret、发起认证/模型/tool/Turn/Run、创建测试Worker或改WAF/Origin。引用的是已完成的生产回读、04:35公开检查及当前源码；动作前必须重新核对，不能把历史快照当成新回读。本计划不修改原固定批准包，也不替代窗口或执行授权。

## 父线程可作的有限决策

建议先完成窗口外的**原生来源/IP实测、入口完整版本冻结、切流专用回退申请派生**。之后有两种明确的窗口目的：

- **匿名签名验证后回退**：可以按原批准的精确配置差异，短暂协调Gateway/Execution/入口，做首次真实匿名hop，然后无论hop成功与否都回退旧站；不记成功切流T，不开始48h。这是收集真实桥接证据，不是豁免其余正式验收。
- **正式条件切流**：只有原批准包列出的必要安全/真实用户测试能力已安排好，才在同一窗口启用、完成验收并决定保留新入口；缺少能力或必需证据即回退。当前精确重放/peer通道等仍缺，不能宣称这条路径已Ready。

不要求“所有启用后测试在启用前已通过”。要求**启用前所有安全前置成立、测试能力已就位、可执行回退已审阅**；启用后运行真实测试，再作保留/回退决定。现代码没有测试者allowlist、仅首页模式或canary admission。入口signed期间该域对真实访客开放，原邀请/身份/容量门禁继续生效；不能称为只有测试者能访问。若必须旧站全程不中断或只有测试者能进入，需另行设计/评审额外接线，本轮不实现。

## 1. 实际基线与要冻结的缺项

| 对象 | 本任务最近已核实值 | 下次窗口要求 |
| --- | --- | --- |
| 原账号 | `8b0d70250211aa10d89e20605a1c7e5e` | 沿原隔离Wrangler认证，不新login/grant/scope |
| Gateway | `riffology-m1-gateway-staging`；version `6edef49b-ca5c-4c97-bcec-5c141b079bb1`；deployment `57ea9670-0fef-420b-8bd2-cd044c89fd2d`，100%；模块SHA `0e882e02295d9e8630593f93e1fada65dd7d3a04a3361b8a2f20c70d2dae8290` | latest=active=该基线；完整非秘密settings/bindings、代码/资产配置和23namespace快照重核 |
| Replay | `ENTRY_REPLAY` / `EntryReplayGuard` / SQLite namespace `3cfeafa707c5491fba4ead3f0954bc8e`；retry.max_attempts=0；固定64shards | 保持同namespace、原22及新增1共23现代exports/完整metadata；不migration/重建/清表/灌满测试 |
| transport | `riffoid-transport.gaojihe.cn`，原zone `c97b548800561fada1a912c234696db1`；domain `9f0e5e9924f4c95948932d5fab37621a1075ddb5`；certificate `7c91ea00-d3d8-41f3-9cdb-7e6071170066` | 仅GET确认仍指向同Gateway；原11条其他domain对象保留，不再PUT绑定 |
| Execution | `riffology-browser-execution`；version `c94df077-02a1-460f-8158-e47a338e68af`；deployment `a6fdeb9f-d885-4c72-9e02-968315351edb`；原模块SHA `b76b05f96d345a0ecf280cdb4414c1dd0c56bf71041dc3c72199db8e8c6c07c1`，49,003 bytes | 原4bindings、09-05和两nodejs flags、assets/代码不变；只拟改APP_ORIGIN |
| 新账号入口 | 账号 `3232ebc7e9bb0199b92e3d70b07825af` / zone `b0b0079990e13eb20a17a2d3c41403b8`；`riffoid-entry`，`app.riffoid.com`；04:35实际503/two_account_auth_disabled | 父在现有连接器/用户控制台冻结**实际**active/latest version/deployment、入口bundle SHA、非秘密vars、09-06及global_fetch_strictly_public/enable_request_signal、workers.dev/preview关闭；这些version/hash未提供给本任务，不填假值 |
| Public pin | key ID `riffoid-entry-20261008-a`；public ring文件SHA `a1bb7476581887d50c2ffb441946e6672b1aca1135c735a0dc2b7111daccf1ff` | 原公钥四字段不变；不访问/导出/注入私钥。Secret存在/import通过不等于密钥匹配 |

04:35已通过transport两个403、旧首页200/session200-null、新入口503的正常TLS匿名检查。[最新生产证据](evidence/riffoid-transport-bound-public-checks-20261009.json)与[安全阶段完整回读](evidence/riffoid-safety-stage-production-20261009.json)分开引用。

## 2. 可在入口disabled、旧canonical下先做的真实来源/IP证据

由用户使用已登录的新账号控制台，只查看指定Worker/zone；原zone既有规则截图及无改动确认保留，**不重复索要**。若存在当前可用的既有审计能力，补充精确rule ID/表达式/Block/顺序即可，不扩scope读一个已拒绝的API。两条表达式保持：

```text
app:       http.host eq "app.riffoid.com" and cf.worker.upstream_zone ne ""
transport: http.host eq "riffoid-transport.gaojihe.cn" and cf.worker.upstream_zone ne "riffoid.com"
```

窗口外依次完成，任何缺项保持disabled：

1. 从现有控制台只读核对新zone实际Block在Skip之前、PseudoIPv4为Off、Managed Transform未移除访客IP、request-header transforms/规则/snippets没有影响入口原生IP或绑定签名headers。发现差异即停，修正差异不包含在“只读核验”中；尤其不得临时放宽WAF/Host/Origin。
2. 用户打开**现有**`riffoid-entry` Dashboard Logs → Live，从真实浏览器/客户端A、B（两个确实不同公网出口，例如现有宽带与手机网络）各做一次无Cookie实际GET到disabled首页。预期各503；选取实际调用事件，检查入口收到的`cf-connecting-ip`为各自真实出口、两者不同、`cf-worker`缺失。用户仅回报时间/Ray、version、IP匹配/不同/IPv4或IPv6等布尔结果；不导出原始headers、Cookie、proof、OAuth URL或Secret。若现有日志红acted/采样缺失/根本无这些字段，就明确记录“未观察到”，不能用一张配置截图或他站IP检测冒充入口实测。
3. 如已有可用Security Events，以实际Ray/时间核对来源/Block事件；请求通过的日志并不保证Security Events有记录。已有规则配置+实际入口IP观察可建立前置；**未做peer请求仍不能宣称真实peer负测通过**。来源字段是平台的zone身份，不是指定Worker身份，签名仍必需。
4. 只有这些实际前置成立后，才可把原已批准的`ENTRY_NATIVE_IP_BOUNDARY=cloudflare-direct-visitor-waf-v1`作为**真实已验证**声明，保持mode disabled。绝不为让signEntry成功而仅填marker。若现有只读渠道不足，选择保持关闭，或让用户决定一个另行评审的最小非秘密观测补丁；本轮没有补丁/新route/新日志产品/Logpush/tail Worker。

官方[HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip)说明直接访客与Worker子请求的IP语义不同，跨zone接收侧可能是固定Worker地址；所以**只比较新入口的native IP，Gateway使用验签后的签名IP，不拿接收侧cf-connecting-ip认作访客IP**。[upstream_zone](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/cf.worker.upstream_zone/)为平台字段；[request transform约束](https://developers.cloudflare.com/rules/transform/request-header-modification/)与[Managed Transforms](https://developers.cloudflare.com/rules/transform/managed-transforms/reference/)必须核对实际状态。[Live logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/)提供请求事件但可能采样/缺字段，文档不证明本账号已有完整可见性。本计划未开启日志/新订阅/新增权限。

## 3. 窗口前必须派生切流专用回退申请

现冻结manifest SHA `166edc28179125b796a6afbc0d4ca7a06c7cf4309dcab78db2b93688b7fa8c1f`明确为`Old single-origin safety stage only`，`rollbackOnlyFromVersion=6edef49b-...`；APP_ORIGIN采用`inherit/latest`。它是可信字节/资源基底，**不是可在切到新canonical后原样执行的申请**：照搬会继承新canonical，且旧guard拒绝新版本。不要删除guard绕过。

在离线审阅中从原包派生新的申请（本次仅列要求，没有生成可执行上传文件）：

- 三模块原字节不变：index.js 129 bytes/SHA `c65a69bdfb2c0d18bd5fb2022b04aa0f8f36028132692ec41eac809a7fe6efc8`；original-live.mjs 2,956,059 bytes/SHA `6c058d14c7ba114152ba62682768e61c835307e16e2fa75795c2b71fce5fb98b`；replay.mjs 3,046 bytes/SHA `0db416dedcb4dbfe77783903d7b9342dda88bc53fb8938a228a82d9df97a0ff6`。实际包为保留原Gateway模块+re-export ReplayGuard，不冒称它有未部署的wrapper策略。
- `APP_ORIGIN`**显式plain_text**恢复`https://m1.riff-demo.gaojihe.cn`，不能inherit/latest。bindings申请整组不包含`APP_TRANSPORT_ORIGIN/TWO_ACCOUNT_AUTH_MODE/LEGACY_RECOVERY_ORIGIN/LEGACY_RECOVERY_UNTIL`；不用keep_vars保留它们。保持完整95安全bindings、23现代exports/namespace、replay retry=0、public pin、5容器声明和keep_assets原配置；Secret仅保留原引用/keep_bindings，不读取值。
- 基线不能提前填一个未产生的新version。模板列出允许的已审阅配置阶段/完整差异白名单；每次成功发布后把**真实**version/deployment/full snapshot填入对应回退guard，经独立比较后才可执行。不对任意latest授权，不把UUID冒充classic API的服务端CAS；inherit/latest需持续无并发发布窗口。
- Execution回退也从实际已确认的候选配置核对，只恢复旧APP_ORIGIN，保留原4bindings/同代码/同assets/date/flags。入口关闭申请仅改mode=disabled，保留Secret/key/native marker和其他已验证设置。
- 删除domain/WAF/OAuth callback/Secret、namespace或业务数据不属于普通回退。transport绑定与两条Block可以保留，新入口继续503。

**回退执行必须在下一窗口的明确授权中一并包含**。原包覆盖回退方向/资源保留，不意味着此前10分钟窗口仍有效或当前guard可直接使用。先准备具体完整申请让父审阅，再确定带回退预算的UTC起止/单一publisher；不在上线失败后临时发明包。

## 4. 下一短窗口的配置顺序

建议窗口内只做已准备好的序列；若只做匿名hop，建议留至少一半窗口预算给关闭/回退。具体起止与截止由用户/父确认，**本计划没有自动执行器/TTL，也不能保证API故障时准时回退**。例如10分钟窗口可在前5分钟内完成发布和最多2分钟入口验证，后5分钟专供关闭/回退；若API健康/回退预算不满足则不启动。完整OAuth/peer/replay/SSE不硬塞进匿名短窗口。

| 顺序 | 精确动作和回读 | 对外状态/停止条件 |
| --- | --- | --- |
| 0 | 新入口仍disabled；重核表1完整基线、两方操作人在线、无并发publisher、实际来源/IP前置和派生回退包。窗口授权覆盖序列及失败关闭/前向回退 | 旧应用继续；任一前置未知不开始 |
| 1 | 原Gateway一次完整配置发布，**同安全代码SHA**：APP_ORIGIN→`https://app.riffoid.com`；新增APP_TRANSPORT_ORIGIN=`https://riffoid-transport.gaojihe.cn`、TWO_ACCOUNT_AUTH_MODE=`signed-entry-v1`；recovery两vars暂不设置。原95bindings除APP_ORIGIN外不变，新增2项→97，namespace/exports/assets保持。完整独立回读并冻结真实新version/deployment供guard | 新入口仍503；旧域此时不再提供完整应用，也还没有48h recovery。不要假称旧应用无中断。失败/回执未知不进入下一步 |
| 2 | 原Execution只改APP_ORIGIN→新App，原代码/4bindings/date/flags/assets不变；独立回读。对既有固定frame URL匿名GET/HEAD，确认唯一frame-ancestors=`https://app.riffoid.com` | 新入口仍503；旧已加载iframe可能失效，属于协调维护。失败即走回退 |
| 3 | 新账号父/用户用现有通道核对私钥**元数据存在**而不读取值，公开key ID匹配，真正完成native前置后marker已就位；仅mode→signed-entry-v1，完整非秘密回读/实际版本固定 | 入口开始真实signed验证；这是公开候选阶段，尚非全验收成功。Gateway前置未就绪不启用 |
| 4 | 真实直接匿名客户端仅一次GET新首页（可用无敏感参数的唯一query关联日志），正常TLS，不发送Cookie/伪造Origin/Host/IP，不跟随跳转。预期200、严格CSP/no-store、host-only Cookie/Location合同、实际两端版本与固定路由。可按已准备范围做一次匿名get-session→200/null | Gateway已回读源码中verifyEntry和ReplayGuard.claim在ASSETS前，且资产worker-first保持，所以200是该路径的正向验证证据；无独立RPC审计不能称观察到了claim日志。403/502/503/不安全响应/超时或预算耗尽立即停止，不自动重放 |
| 5A | 匿名验证目的：无论结果都关闭入口，按第6节回退 | 记录正向结果或真实失败，**T=null/until=null**；其余验收pending |
| 5B | 正式切流目的：执行已就位的必需真人/负向测试，第5节明确能力。缺项/失败按第6节回退；不把pending当通过 | 只有全部当前必需接受条件满足才作成功决策；未来实际48h过期检查仍单列pending |
| 6（仅5B成功） | 实际新域验收成功时刻记录T；随后同一完整Gateway申请成对加LEGACY_RECOVERY_ORIGIN=`https://m1.riff-demo.gaojihe.cn`、LEGACY_RECOVERY_UNTIL=`new Date(T+48h).toISOString()`，bindings97→99；回读并立即验证旧静态只读页/本机导出及选定原8h session读回 | 新域保持；旧域是只读恢复，不是完整旧App/OAuth/Execution。写入或恢复验收失败，撤销“本次成功”状态并关闭/回退；保留尝试T历史，不延长计时重新找成功 |

Gateway canonical、auth trustedOrigins、transport和签名mode不能跨步骤拆成可接客的半组配置；Execution和entry是跨服务顺序发布，不原子事务。不要用百分比分流混合canonical。entry disabled是后端准备期的安全闸；enabled后的fail-closed是验签/来源/nonce/响应合同，**不是**仍返回disabled503。

## 5. 测试能力、账号与授权界线

| 测试 | 最小实际能力/操作者 | 原批准或缺项 | 不能替代的证据 |
| --- | --- | --- | --- |
| native来源/IP前置 | 用户现有新账号Live/zone控制台，两个真实公网出口；入口disabled | 原来源/IP验收范围；无读取能力则停，新增观测补丁/权限/日志资源另决定 | 他站IP/curl本机地址、marker字符串、官方文档不是入口实际header观察 |
| 正向签名/密钥匹配/replay首次claim | 配置就绪的两个真实Worker；单次匿名新首页；公开metadata/代码/资产guard及实际请求关联 | 原有条件激活/验证范围；准备好前置后可做，无需私钥值 | Secret存在/import、transport403、直接调用claim或fixture都不替代真实hop |
| 缺proof、无效proof、同zone peer | 获准的真实riffoid.com zone发起请求通道；当前唯一入口不能给用户自由构造proof | 原验收场景已列，但**没有现成合法通道**。另一个既有Worker只有在明确获准时可用；若无须额外测试资源/代码授权 | 外部客户端403被WAF提前挡住，不能称Gateway验证失败；不伪造cf-worker/Origin |
| 精确nonce重放/过期proof | 在原30s proof生命周期内，让同一个已验签匿名GET的相同proof/signature/被签名headers/path/body从合法来源再到Gateway，观察entry_replay_denied；过期>30s应proof denied。需要独立评审的内存内、非秘密有限测试通道 | 原测试目的已批准，但捕获/重送生产proof、新peer/新route能力**未具备且不由原配置批准自动授权**；本轮不实现 | 普通第二次页面访问生成新nonce；同一URL/同一IP/重发浏览器请求不等于同proof。不能保存完整生产proof/Cookie/私钥或公开一个签名转发接口 |
| Replay故障/full/取消 | 既有获准故障注入能力或后续精确实验范围；观察原nonce/请求终态，不灌满4096shard、改namespace/retry或清表 | 当前生产故障注入未授权，必须另决定；离线测试/源码不替代真实平台fault覆盖 | 不破坏真实安全存储来造503；TCP FIN不承诺撤销已进入业务的操作 |
| 原Google主体/session/Cookie/Location | 用户本人现有受邀账号，在真实浏览器选定新域一次OAuth，原callback保留；只回报已知原user/Catalog身份一致、cookie属性/合法跳转与8h结果，原值不导出 | 原包明确真实原Google验收，需用户在线配合与一次具体身份/既有资源范围；会写OAuth state/session/security数据，不能称全只读 | curl匿名session-null不证明登录；不新建身份、使用他人Cookie、导出完整OAuth URL/code/state |
| CSRF/真实两IP限流 | 同一合法浏览器会话/已有拒绝身份、实际Origin及两个真实出口；预先选择无付费/无业务变更的精确请求和上限 | 原验收目标；“填满30/60桶”影响该用户，具体有限请求数/冷却要事先给用户确认，不打未限定负载 | 只看不同IP或root200不证明限流键正确；不改限流阈值、不伪造IP/Origin |
| Catalog拒绝/撤权 | 已有合法拒绝身份与实际已撤权记录，或用户明确批准哪一项临时状态操作 | 原“验收撤权”目标不授权任意真实权限变更；需要选定对象，不能为了测试顺手撤权/恢复 | 不新建身份/重置Catalog/DB；没有实际用例保持pending |
| SSE cursor/取消 | 真实原用户，明确现有合法idle Session/只读事件流、已存在非秘密cursor；真实入口→transport，不启动/继续任何Turn/Run/tool | 原验收目标；若没有现有可读流，创建新业务对象/执行/付费不在当前范围，须另授权 | 本地流fixture/静态200不证明平台SSE。多次GET新nonce正常，不作为replay。取消只观测已进入流阶段，不重放业务写 |
| Execution隔离 | 固定frame资源的HEAD/GET可先查CSP；真实新App浏览器iframe正向+已允许旧origin环境负向，用户查看浏览器拒绝原因 | 原Execution差异/验收范围；只能使用现有合法只读页面/资源。实际Browser Preview仍local/unverified | curl看到frame-ancestors不是浏览器已执行隔离；旧恢复页自身default-src拒绝iframe不能冒充Execution祖先负测。需要实际允许发起frame但被Execution CSP拒绝的已授权环境，不新建测试站 |
| 旧48h恢复/原记录/本机导出 | 用户既有旧域Cookie尚未自然到期、选定原已获准只读workspace/receipt；浏览器本机导出原字节 | 原批准范围；不恢复/重放已归档业务，不碰ledger；server可用48h不延长8h session，旧session可能先到期 | 新域新Cookie不能读旧host-onlyCookie；匿名401不说明恢复坏；实际截止410需T+48后正常时钟验证，不能改生产时钟/提前期限伪造 |

**能力缺失是具体阻碍**，不是借口自动增加Worker/Secret/权限。当前推荐匿名桥接验证后回退；若父要求正式条件切流，就先安排表中必需的真实渠道，或向用户提交明确剩余缺口与可审阅的补充测试设计。取消一项原定必需验收、接受未验风险也是用户决定，不能由代理悄悄缩小成功标准。

## 6. 失败触发与顺序（须在窗口中预授权）

触发条件：任一配置/namespace/assets/版本非白名单漂移、native来源/IP前置不成立、正常TLS失败、正向hop非预期、unsafe Cookie/Location/CSP、transport直访意外200/302、WAF/签名/重放失效、真实身份/CSRF/权限/限流/Execution/SSE必需项失败、原记录/恢复异常，或短窗口入口验证截止前未取得足够结果。

1. 停止新增测试与业务admission；按审阅关闭申请令**现有entry mode=disabled**，不删/读/换Secret，不继续发请求来“试到成功”。独立回读并确认新入口503；关闭unknown只GET对账，不能盲目循环PUT。
2. 对Gateway当前**真实已确认**active/latest/version/full snapshot做对应阶段guard；使用第3节派生前向回退三模块和同一23namespace，显式旧APP_ORIGIN、整组移除4topology vars；保持95安全bindings/原容器/资产/ReplayGuard/public pin。真实回读后旧首页恢复原应用，不是旧read-only页面。
3. Execution只恢复旧APP_ORIGIN与旧唯一frame ancestor，原代码/4bindings/资源不动。确认新入口仍503、transport外部403、旧首页200/原匿名session200/null、旧frame CSP及实际namespace全部保留。恢复顺序中旧预览可能短暂不可用，不承诺零中断。
4. 保留失败、已消费的nonce及所有业务/身份/历史/ledger；不重放OAuth/业务请求，不deleteAll，不旧版本raw rollback，不删domain/WAF/OAuthcallback/Secret。记录各实际回退version/deployment/time/hash。没有成功切流则T/until均无最终值。

“失败自动回退”在这里是**先获准的有限处置流程**，没有自动化程序部署。API写回执未知先只读核对原操作、不要以旧snapshot盲目覆盖；实际状态未定或外部publisher漂移，停止继承写。若API/控制台不可达，不能保证关闭/回退完成；报告未知状态、由已约定在线操作者按既有明确授权核查，不能虚报恢复成功，也不能通过替代工具绕过安全审核拒绝。经典inherit/latest不能提供全配置CAS，窗口无人发布是硬前置。

## 7. 成功T、48h与不扩展授权

仅正式条件切流，全部**当前可完成且必须完成**的新域验收真实通过，父/用户接受保留新入口时记录UTC成功T；同时单列实际入口首次enabled时间t_enable、首次hop时间t_hop，不能把验证阶段暴露时长隐藏。T既不是资料批准/域名绑定/发布开始时间，也不能因后续观察重新延长。

随后成对写旧recovery两vars并完整回读、立即验收只读旧页和选定原session读回。该动作失败则撤销本次“成功”状态、保留attempted T历史并回退，最终成功T/until为null；不把失败日期当新T。真正保留新入口时保存T、T+48h精确ISO UTC、两端/Gateway/Execution实际version、23namespace和pubkey ID、回退包SHA、当前pass/pending清单。48h截止之后再以真实时钟检查旧server API410、静态指南和本机导出仍可用，未来检查不假称已完成；不为其创建未获要求的automation。8h session不延长，trial `2026-12-31T15:59:59.999Z`及M1 `2026-10-20 Asia/Shanghai`不改。

| 父可沿原批准安排的事 | 真正超出原精确范围、须用户决定的事 |
| --- | --- |
| 原账号/新账号既有公开配置只读核验；现有用户控制台Live/实际来源IP检查（能力需核实）；派生保持原字节/namespace的完整切流及回退申请；选择新无并发窗口并一并批准失败关闭/前向回退；原包精确Gateway/Execution/entry差异及原真人验收 | 新测试Worker/peer/路由/诊断代码；读取/存储完整生产proof或新增转发能力；新日志资源/Logpush/权限/凭据；生产故障注入/灌满安全存储；新身份/新业务对象/任意撤权；付费执行/升级；接受未验风险而降低原必需标准；要求零中断/仅测试者模式而改变架构 |

原[固定批准包](riffoid-production-approval-packet.md)blob `14468622c168a96238fa27b55eb36d26b50cf247`保持原样，历史待完成文字不当成今天的实际状态。本计划在原范围内澄清运行顺序及具体缺项，当前仍只交方案。
