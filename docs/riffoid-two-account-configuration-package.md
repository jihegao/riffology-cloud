# 双账号入口配置审阅包（2026-10-08）

**签名资源回退补充**：创建防重放DO class迁移后不能直接rollback旧Gateway version，必须准备保留class/namespace的前向单域回退包；以[签名生产申请及回退](riffoid-entry-signature.md#轮换撤回与回退)为当前准据。旧版本ID仍为冻结基线，不是跨migration回退证明。

**后续06:44:24 UTC授权更新**：用户批准入口专属签名/原子防重放实现与离线测试、推送；生产密钥创建配置仍另确认。当前已增加默认disabled的signed-entry-v1代码；WAF-only同zone反例由新script持钥验证处理，但原生IP入口WAF/Transform平台证明仍缺。精确协议/容量/生产Secret与新SQLite namespace申请见[签名配置与回退](riffoid-entry-signature.md)。下列“签名尚未实现”属于先前配置收敛基线，不能当成当前代码状态；真实生产key/pin/resource/安全设置仍未创建，缺现Google/旧zone字段不阻塞本地实现。

**状态：准备与只读核验完成到下列边界；不可部署、不可切流。** 当前生产代码未改，新应用模式仍默认 disabled。共享 auth bucket 的可用性阻碍未解除；下列 WAF 方案也不证明特定入口 script 的身份。此包是具体事实、拟议差异、缺值和验收步骤，不是执行授权或完整 live overlay。[只读证据](evidence/riffoid-two-account-configuration-readback-20261008.json)冻结本轮结果；05:45的旧证据保留为历史，不覆盖。

## 账号、资源与通道

| 范围 | 已实际读取 | 尚缺 / 不能推断 |
| --- | --- | --- |
| 原账号 | `8b0d70250211aa10d89e20605a1c7e5e`，Jihe.gao@gmail.com；memberships返回 accepted / `Super Administrator - All Privileges` | 账号角色不等于当前 OAuth/token 能读取或写入每个 endpoint |
| 原 zone | gaojihe.cn，`c97b548800561fada1a912c234696db1`，active/full，Free Website；NS abdullah/isla.ns.cloudflare.com | WAF规则及顺序/Skip、内部DNS记录、TLS/Network/Transforms当前值未读出 |
| 原 Gateway | `riffology-m1-gateway-staging`；现 active版本 `aeddf112-a2be-45da-868c-ed576c55d5ec`，100%；workers.dev=false、previews=false | 发布前重新冻结完整93 bindings/vars/assets/config，不能用精简模板部署 |
| 原 Execution | `riffology-browser-execution`；现 active版本 `c94df077-02a1-460f-8158-e47a338e68af`，100% | 发布前重读完整4 bindings/固定资产/摘要/CSP，原独立 origin不变 |
| 新账号 / zone | `3232ebc7e9bb0199b92e3d70b07825af` / riffoid.com `b0b0079990e13eb20a17a2d3c41403b8`，Free；现Safari session可读；唯一active成员，DNS0、zone routes0、Worker项目0、custom rules表空、SSL Full、Pseudo IPv4 Off | 成员角色图标/API scopes与 managed-transform开关的状态没有文本读值；不能当作写入通道已验证 |
| 新账号发布 | 当前 CLI accounts只返回原账号；Safari原已打开的新账号tab读配置成功 | 未执行任何部署表单。现native text可读但不能操作表单；最小通道是用户使用既有新账号console手工执行获准包，或提供已存在的新账号授权CLI/CI通道供核验；不创建token/login |
| Google | 既有Google session成功；Default Gemini Project（`gen-lang-client-0139341395`）→ Google Auth Platform客户端，`Riffology M1 staging`，Web应用，创建2026-09-06，client ID仅显示`316292203808-3s6i...` | 完整client ID、现redirect URI / JS origins / Branding authorized domains及链接未读；原生URL/text接口没有client详情link或表单值，不猜完整ID，不读secret视图 |

原 Gateway两个Custom Domains实际为 `m1.riff-demo.gaojihe.cn`、`preview.m1.riff-demo.gaojihe.cn`，均属上述原zone和production environment。原zone四条Workers路由实际为 `riffology.gaojihe.cn/*`、`share.gaojihe.cn/api/assignments*`、`*.preview.riff-demo.gaojihe.cn/*`、`*.preview.m1.riff-demo.gaojihe.cn/*`；保持它们与原Worker对应关系，不迁移、替换或删除。

## 推荐 transport 与精确差异

推荐 **`https://riffoid-transport.gaojihe.cn`**，备选 **`https://m1-transport.riff-demo.gaojihe.cn`**。两者属于已核验原账号zone的命名空间，没有匹配上面四条路由或两个Gateway Custom Domains；公开DNS读值均NXDOMAIN。推荐一级hostname便于精确审计、不混入旧App/preview前缀。但DNS API未读取成功，不能宣称内部记录不存在或可直接创建。

拟在**原账号**给现Gateway增加一个精确Custom Domain，保留原两个domain/四条路由，Gateway仍用原绑定；**新账号**拟创建轻量`riffoid-entry`，精确Custom Domain `app.riffoid.com`，固定public HTTPS目标，`global_fetch_strictly_public`，无D1/R2/DO/container/service-binding/auth-secret。两边均关闭未批准的workers.dev/preview aliases，按精确topology拒绝其他host。[官方Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)会创建DNS并签发对应证书，包括多级subdomain；必须核验目标没有冲突CNAME、具体证书/TLS成功，不能假定wildcard覆盖。无跨账号CNAME/SaaS/service binding。

Gateway拟议配置差异：APP_ORIGIN从 `https://m1.riff-demo.gaojihe.cn` 改为 `https://app.riffoid.com`；APP_TRANSPORT_ORIGIN拟为经批准且创建验收后的首选地址；LEGACY_RECOVERY_ORIGIN为原App域；LEGACY_RECOVERY_UNTIL为**真实成功切流UTC +48小时**。当前尚无成功切流，时间字段为空。TWO_ACCOUNT_AUTH_MODE仍disabled，没有可部署的可信IP mode，不可把shared-limited用作替代。

现列表中的`Riffology M1 staging`只是待匹配候选；完整公开client ID与原Gateway OAuth绑定的对应关系未确认，不能仅凭名称断言就是正在使用的client。Google拟只向经确认的原client增补 `https://app.riffoid.com/api/auth/callback/google`，保留旧callback供回退；具体现清单必须先读。只有实际需要时才增加 `riffoid.com` authorized domain / 新JS origin / consent links，列出逐项from/to后按行动时批准，不换client/secret/scopes。Execution只联动APP_ORIGIN与唯一frame-ancestors为新canonical；固定独立 `https://riffology-browser-execution.jihe-gao.workers.dev`、assets/摘要/门禁保持，不添加双ancestor。

可审阅表达式/配置字段见[非执行安全草案](riffoid-two-account-security-overlay.example.jsonc)。Free方案官方有5条custom rules容量，但原zone现用量/顺序未知；新表空不等于两条表达式已编译或有效。没有付款升级、新凭据或权限授权。

## WAF 与可信 IP 的成立条件和反例

待批准的新zone规则（Block，`http_request_firewall_custom`，先于可能Skip来源门禁的规则）：

```text
http.host eq "app.riffoid.com" and cf.worker.upstream_zone ne ""
```

待批准的原zone首选transport规则（同phase/action/order要求）：

```text
http.host eq "riffoid-transport.gaojihe.cn" and cf.worker.upstream_zone ne "riffoid.com"
```

[`cf.worker.upstream_zone`](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/cf.worker.upstream_zone/)是Cloudflare计算的来源zone字段，未经过Worker时为空，**不是script ID**。[官方请求头说明](https://developers.cloudflare.com/fundamentals/reference/http-headers/)说明跨zone CF-Connecting-IP为统一Worker IP，同zone x-real-ip可被Worker改变；CF-Worker header不能替代该字段作WAF证明。因此两条规则仅是zone边界候选。

拟议接线只从通过新zone直接访客来源门禁的原生 `CF-Connecting-IP` 验证单个IPv4/IPv6，先删除client forwarded/IP/custom claims，再写唯一`x-riffoid-client-ip`；原Gateway仅在精确transport与已成立的来源边界上用它作**原BetterAuth限流桶**。原1.7.3基本30/60秒和sign-in3/10秒保留，不用于身份/Catalog/CSRF/G5 proof。缺失/无效原生IP或来源失败立即拒绝，不回退共享桶。新zone Pseudo IPv4 Off已读；Remove visitor IP headers/Add True Client IP开关未读，若原生头缺失只能关闭。不可因访客填写CF-Connecting-IPv6就把它当成真实IP。

| 请求 / 攻击 | 规则推导 | 当前证明状态 |
| --- | --- | --- |
| 直接浏览器→transport | upstream_zone为空，旧规则Block | 待真实平台测试；没有已创建transport |
| 任意访客伪造CF-Worker/IP头 | header不构成计算字段证明；入口须清理并覆盖IP | 待真实平台负向测试；本地自填header不是WAF证据 |
| 外部zone Worker→transport | 实际来源zone不等于riffoid.com，旧规则Block | 由官方定义推导；待外部Worker真实测试 |
| 任意Worker→app.riffoid.com | 来源字段非空，新规则Block | 待平台测试，含同zone可改x-real-ip情形 |
| **riffoid.com同zone其他Worker→transport直连** | **来源zone相等，旧规则允许；不经过app，新规则无效，可自填custom IP** | **明确反例，不能标为已防住** |
| 未批准alias / route / default host | 精确origin校验应拒绝；公共入口前置route必须盘点 | 旧Gateway别名关闭已读；新部署后的完整盘点/平台测试待做 |

无新secret方案只在**整个riffoid.com zone的所有Worker、路由、forwarder路径及写权限都纳入可信边界**时可作为候选。当前空Worker项目/单成员只是现状，不能证明未来没有同zone其他脚本或平台字段绕过。若验收要求“任意同zone其他Worker也不能伪造入口IP”，此WAF-only设计**本身不满足**，不能只补一个header测试通过。

**建议开放认证前采用更强的script来源校验**。若验收要求仅指定入口可信并拒绝同zone其他Worker，这一步是必须项；不能把整zone信任作为相同安全保证。可能设计是script专属私钥（新entry Secret）、旧Gateway public-key/key-ID pin、method/固定target/path+query/time/短expiry/nonce/client-IP/body digest/cookie hash签名以及原子nonce防重放状态。它需要新的持久key及replay-state设计、代码审阅/离线测试和逐项批准，未生成、未实现、未配置；不是可直接执行的最小接线。WAF仍作补充边界，不能复用或复制BETTER_AUTH_SECRET。当前继续disabled；若用户改为接受整zone信任，必须明确记录这是不同安全边界，仍需真实平台验收。

## 精确读取缺口与权限

现原账号SDK GET读取WAF entrypoint及DNS/managed_headers/header-transforms返回10000，SSL与pseudo_ipv4返回9109；不是ruleset不存在的404，也不是没有账号角色。官方[WAF entrypoint读取](https://developers.cloudflare.com/waf/custom-rules/custom-rulesets/)要求Zone WAF Read或Write；没有为此申请新grant、创建token、扩scope或反复尝试拒绝endpoint。

1. **Google非秘密字段**：已优先使用现Safari原生URL/text接口，客户端list只有截断ID，未提供详情link或input值；到此停止，不申请启用JavaScript/新系统权限。当前实际页面是[客户端列表](https://console.cloud.google.com/auth/clients?pli=1&project=gen-lang-client-0139341395)，请在`Riffology M1 staging`详情手工提供**完整公开client ID、Authorized redirect URIs全部条目、Authorized JavaScript origins全部条目**；[Branding入口](https://console.cloud.google.com/auth/branding?project=gen-lang-client-0139341395)提供**Authorized domains及主页/隐私/条款链接**（此详情页尚未读取）。不要提供client secret/token/code/cookie。原生文本没有其他表单值接口，本轮不引入Accessibility或抓取source。现callback清单未读，不能把拟增补callback当成已验证diff。
2. **原Cloudflare只读权限/元数据**：目标明确为原账号`8b0d70250211aa10d89e20605a1c7e5e` / gaojihe.cn zone `c97b548800561fada1a912c234696db1`。现认证拒绝WAF与DNS/Transforms读取、设置读取；所需读取权限分别是该zone的**Zone WAF Read、DNS Read、Zone Settings Read**，Transforms/rulesets还须对应现产品read权限核验。只列缺项，不授予、扩scope或创建token，也不绕过API拒绝去获取同一受限数据。用户可在[既有原账号zone入口](https://dash.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/gaojihe.cn)自行提供Security Rules规则顺序/action/Skip、DNS两候选hostname冲突、SSL/TLS与Network/PseudoIPv4、Managed/Request Header Transform现值；这是用户手工清单，不是本代理另取会话突破权限。
3. **新账号最小发布通道选项**：优先用户在[现新账号Workers & Pages入口](https://dash.cloudflare.com/3232ebc7e9bb0199b92e3d70b07825af/workers-and-pages)和[riffoid.com zone入口](https://dash.cloudflare.com/3232ebc7e9bb0199b92e3d70b07825af/riffoid.com)手工执行逐项批准的Worker/Custom Domain/安全差异；不需要给代理新token。若已有新账号授权CLI/CI通道，可以先提供其存在/账号归属和权限元数据供只读核验，不提供秘密。没有现通道时停止；新OAuth登录/grant/token必须另有精确范围批准，当前不生成。本包尚有来源校验和现配置缺值，**现在不能执行部署**。

原Cloudflaretab已恢复account home；本任务新开的Google客户端list只读tab保留便于手工提供清单，其他用户tab保持。没有读取私有项目内容、浏览器历史、profile、cookie或secret。

## 继承基线、验证与后续验收

PR172/174已整合，main基线 `25609953f5c3b69dcb44e520d7e7ed1253d18fe4`。[Issue171冻结发布证据](https://github.com/jihegao/riffology-cloud/blob/25609953f5c3b69dcb44e520d7e7ed1253d18fe4/docs/evidence/releases/issue171-local-runs-release-20261008.json)源merged commit `abcc406d6e8ec5a6f68932db7e30906cb70e3de2`，Gateway现版本与其一致。本次不重复实现本机Runs修复；原single/four-task comparison、refresh/history download/cancel语义需在迁移验收保留。其单身份/局部发布证据不能充当整个M1/本次迁移通过；其已知CI billing问题不能移植为本PR CI根因。

本PR代码此前typecheck/M1 **323/323**、M3 **1070通过/12条件跳过/0失败**，含实际本地D1/G5 proof链、SSE和synthetic browser local Runs；本阶段仅metadata/docs，不改代码、不重复或加总测试。原资源05:45完整比对未变化，本轮再GET active部署IDs/版本仍一致。当前本PR CI154 runner_id=0、steps=[]，未执行；确切原因未读出，不能宣称CI通过或归因账单。

批准后的顺序：先再次冻结原完整Gateway/Execution+两zone路由/安全配置+原Google清单；保持新入口关闭；选择成立的来源/IP通道并离线审阅实现；批准精确新增hostname、规则、OAuth/canonical/CSP差异；创建候选后先完成上表真实负向/双IP限流验收，再联动新canonical并核对同一原Google subject/Catalog user/tenant/project/history、Cookie/Location/CSRF、权限撤回/跨scope、SSE cursor/取消/无重交、Execution独立站点/唯一ancestor、G5权威proof。实时Turn/Run/付费测试另按明确范围授权，本包不安排执行。

成功切流才记录UTC和48小时server恢复截止。原session8小时不延长/复制；期限后API410，静态指南与`/legacy-local-runs/`原字节导出继续保留，无自动迁移/import/replay。legacy G5权威receipt仍503 recovery_authority_unprepared，不推断原执行失败；新canonical原权限路径与proof不变。

失败则关闭新准入、原key只读观察并确认释放，恢复**整组**被冻结的原Gateway/Execution版本、origin/assets/config及旧domain入口，保留原Googlecallback；不回退到早于PR172的版本，不恢复数据库覆盖新数据，不清账/搬库/重建身份或DO，不删除原入口/新域数据。内部名称/历史资源/meter-only/策略pin/12月31trial及10月20M1全部保持；48小时不是删除域名授权。

### 取消信号与前向回退的精确追加申请（离线、未执行）

入口fixture/template日期2026-09-06；Gateway及前向回退保留实际live日期2026-09-09（2026-10-08T08:40:44.103Z现授权GET回读），不得从入口fixture继承日期；新入口flags `[global_fetch_strictly_public,enable_request_signal]`，原Gateway从`[nodejs_compat,nodejs_compat_do_not_populate_process_env]`追加`enable_request_signal`。不使用隐藏request_signal_passthrough；signed两层标准AbortController桥接仅在真实原生信号到达时传播。实际TCP reset/已开SSE本地链通过，响应头前普通FIN即时取消未证明；准确承诺为平台abort到达后停止尚未进入业务的验证/流观察，无回执按原key核对未知结果，已提交操作走原业务cancel，不承诺FIN撤销。FIN不是禁止所有部署的独立阻断。原Gateway staging config没有被改为该overlay。

[前向回退源入口](../services/gateway/forward-rollback.ts)与[非可执行配置申请](../infra/riffoid-forward-rollback.request.jsonc)已可本地build/test；保留全部DO exports/实际既有ENTRY_REPLAY namespace/migration，恢复原APP_ORIGIN且整组移除transport/mode/recovery4 vars。实际生产namespace ID、完整配置/migration/assets freeze和平台验证仍缺，本地artifact状态LOCAL_BUILD_NOT_PRODUCTION_FROZEN，不能用旧Gateway version跨DO lifecycle迁移回滚。详见[评审实现与边界](riffoid-entry-signature.md)。

日期及当前取消语义以[日期专项证据](evidence/riffoid-entry-date-correction-20261008.json)为准；09-06普通local/staging简化文件不代表live Gateway date。

### 精简生产配置与资源批准清单（本轮仅准备）

- 新账号`3232ebc7e9bb0199b92e3d70b07825af` / riffoid.com zone`b0b0079990e13eb20a17a2d3c41403b8`：指定入口Worker/name与`app.riffoid.com`绑定、入口09-06及`global_fetch_strictly_public,enable_request_signal`；单独创建并仅绑定入口的`ENTRY_SIGNING_PRIVATE_JWK` Secret、公开key ID（真实值未生成/待批准），不复制原auth/provider秘密或绑定应用数据。
- 原账号`8b0d70250211aa10d89e20605a1c7e5e` / Gateway：保留live09-09并追加`enable_request_signal`；完整93原bindings/config上增加公开`ENTRY_SIGNING_PUBLIC_KEYS_JSON`（public pin待获准生成并核验）及独立SQLite`ENTRY_REPLAY / EntryReplayGuard`、拟migration tag`entry-replay-v1`（实际namespace ID/完整migration history待创建后核验）。两侧canonical/transport/mode应作为同一完整包，transport拟`riffoid-transport.gaojihe.cn`，不能跨账号CNAME或假定service binding；Googleclient完整公开ID和现callback/origins/domains仍缺。
- 精确DNS/route/TLS、两zone所需WAF/native-IP/Transform边界、Google新canonical callback/origins/domain和原Execution单一ancestor/APP_ORIGIN/CSP差异：仅批准核验过的完整值，保留原Googlecallback、身份/历史/assets/actor/namespace/pins/ledger，不打开M3/G5/付费执行。新zonePseudoIPv4应保持Off；平台来源/IP/已绑定header稳定性和真实原用户验收待后续获准执行，不能以fixture替代。
- 上线前冻结当前Gateway/Execution/入口完整config、assets hashes/version及保留同一replay namespace/migration的前向回退包；本地build仍LOCAL_BUILD_NOT_PRODUCTION_FROZEN，缺实际namespace ID/完整migration/config/assets snapshot/平台验证。回退恢复原APP_ORIGIN、整组删除4个topology vars并保留所有原资源及replay数据；不以旧version跨DO lifecycle raw rollback。
- 仅真实成功切流时记录UTC并启动已批准48h服务端恢复（现在cutover/until仍空）；旧静态指南与本机原字节Runs导出继续保留，原8h session不延长。平台abort到达时停止尚未进入业务的验证/流观察；无回执结果未知按原key核，已提交操作用原业务cancel，不承诺FIN撤销，FIN不列为独立部署阻断。
