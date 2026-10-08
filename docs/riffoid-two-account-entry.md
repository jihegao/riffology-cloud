# riffoid 双账号入口准备 — 更新至 2026-10-08

**2026-10-08 已完成本地入口/Gateway 接线与离线验证，尚不具备线上切换条件。** 新代码以显式配置进入双账号模式，但新应用默认返回 503；共享限流 DoS 尚未解决，禁止部署 shared-limited 版本。无新配置时保持单域行为。推送/推进部署及利用既有浏览器会话只读核验已有后续授权；新登录、持久凭据/权限和具体安全配置变更仍按行动时边界处理。参见[最新最小决策与配置差异](riffoid-two-account-decisions.md)。2026-10-07 的透明代理阻碍及早期授权记录保留为历史基线。

**05:32:17 UTC后续确认**：Safari Automation提示和实际切流成功后48小时server恢复已批准，不再重复请批。原生Safari可见文本读取成功：新account `3232ebc7e9bb0199b92e3d70b07825af`、riffoid.com zone `b0b0079990e13eb20a17a2d3c41403b8`、Free，DNS0/Worker Routes0/Worker项目0；规则表空，SSL/TLS Full。原Gateway/Execution部署及完整resources再读未变化。下文未知ID/8小时或48小时提议属于早期记录，当前以[最新只读证据](evidence/riffoid-two-account-browser-readback-20261008.json)及[明确不可执行的安全差异草案](riffoid-two-account-security-overlay.example.jsonc)为准。尚无切流成功时刻，因此没有计算或开始LEGACY_RECOVERY_UNTIL；静态指南/本机导出继续保留。

用户已确认域名在新 Cloudflare 账号 `jihe.gao@theidsa.org` 购入；应用、Workers、D1、R2、DO 留在原账号。14:48 的“好”授权双账号入口离线方案与测试，不授权线上资源/认证变更。本任务未登录新账号、查看 Safari、安装、部署、绑定域名、改 DNS/OAuth/CSP、改权限/凭据、付费运行或合并。Cloudflare for SaaS 仅为另行评估的备选，未启用。

品牌由 [PR #170](https://github.com/jihegao/riffology-cloud/pull/170) 负责，其 head 为 `9799c5c80c2c980a4c34ea446ce800dd1139f880`。本地品牌快照 tree `9d3169fad9dfffdd9e805faa91e026f45ed81e61` 与 GitHub head 的 tree 相同；本机旧提交 SHA 不冒充远端 head。本 PR 最初从 main `e55104bec3966a2c6f096ba9910712732979f055` 单独分支，后续整合最新 main 的 PR172/174；没有复制品牌 PR170 修改。原 checkout 保持原状、未中断其他任务。详见 PR170 的[既有迁移设计](https://github.com/jihegao/riffology-cloud/blob/9799c5c80c2c980a4c34ea446ce800dd1139f880/docs/riffoid-domain-migration.md)。

[Issue #104](https://github.com/jihegao/riffology-cloud/issues/104) / [PR #169](https://github.com/jihegao/riffology-cloud/pull/169) 是试用续期的证据：reviewAt 保留 `2026-12-31T15:59:59.999Z`，M1 截止仍为 10 月 20 日。内部名称、原 auth/Catalog 身份、邀请、项目、Revision、Run、归档、DO namespace/class/actor、D1/R2/bindings、镜像、策略 pin、meter-only 计量、历史费用/预留和审计均保留；不重建账户、补发邀请、搬库或清账。#104 维持其实际 Acceptance/open，不把本准备当作退出验收。

## 传输结论与具体阻碍

[Cloudflare Fetch 官方文档](https://developers.cloudflare.com/workers/runtime-apis/fetch/) 明确 Worker 间可以使用 public fetch；[`global_fetch_strictly_public`](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public) 让请求走公开入口及其安全规则。计划在新账号轻量 Worker 显式开启该 flag，固定请求旧账号的已核验 HTTPS 地址；不用跨账号 CNAME，不假定跨账号 service binding，不依靠 resolveOverride/Host 伪装。真实 Cloudflare 网络、TLS、WAF/Access、循环/路由及性能没有通过离线 fixture 验收。

2026-10-07 未接线基线（新配置缺省模式仍保留此行为）：

- [Gateway index](../services/gateway/index.ts) 先以 `request.url.origin === env.APP_ORIGIN` 选择 App，其他来源进入仍关闭的严格 Preview 分支。
- [Gateway app](../services/gateway/app.ts) 再检查 URL origin，写请求通过 [requireOrigin](../services/gateway/http.ts) 严格检查浏览器 Origin 和 cross-site 元数据；SSE 也有来源限制。
- [authOptions](../services/gateway/auth.ts) 固定 `baseURL` 和单个 `trustedOrigins`，没有开启动态 forwarded-host 信任。
- [Execution](../services/browser-preview/execution/index.ts) 固定单 APP_ORIGIN 与 frame-ancestors，并按 hostname 最后两级强制独立站点。

请求 `app.riffoid.com/api/...` 经 fetch 到旧 `m1.riff-demo.gaojihe.cn` 后，URL origin 是旧域，浏览器 Origin 仍应是新域。保留现配置则新域写入被拒绝；仅把 APP_ORIGIN 改成新域又会在入口 URL 检查被拒绝。离线 Node 和实际 Workerd 均证明这一阻碍。改写 Origin 为旧域、放宽任意 Host、追加通配 trustedOrigins 或禁用 CSRF 都不是解除方式。

旧域同时承担完整 App 和新域 transport 时，GET 页面、OAuth callback 与无 Origin 请求无法靠浏览器 Origin 区分“旧恢复入口”和“新主域传输”。这是接线阻碍：不能凭一个可伪造的 `x-forwarded-host` 或 `x-canonical-origin` 选择认证模式。当前透明转发 probe 仅用于证明阻碍，不能上线。

## 本地接线与后续配置设计

建议使用**原账号内一个明确、独立的公开 HTTPS transport hostname**，仍指向原 Gateway Worker 和原 bindings，不新建应用数据资源。精确 hostname 与存在性待回读；不凭空填写 workers.dev 地址，也不自行启用原配置中关闭的 workers.dev。新账号 App Custom Domain 绑定轻量入口 Worker，DNS 不跨账号 CNAME。是否新增该旧账号 hostname/route 属后续明确批准项。

| 轴 | 固定配置与检查 | 用途 |
| --- | --- | --- |
| 浏览器规范来源 | APP_ORIGIN = `https://app.riffoid.com` | CSRF、BetterAuth baseURL/trustedOrigins、callback、公开链接、Execution ancestor |
| 公网传输地址 | 拟新增 APP_TRANSPORT_ORIGIN = 精确已回读的原账号 HTTPS origin | 新 Worker 的单一 fetch 目标；Gateway 精确 URL 路由 |
| 旧恢复来源 | LEGACY_RECOVERY_ORIGIN = `https://m1.riff-demo.gaojihe.cn` | 独立只读恢复页面/路径/旧 session reader |

这些字段已接入本地源码，未配置到线上。Gateway index/app 显式识别 transport 和恢复来源；各分支的 `requireOrigin`、SSE、Preview、asset request 等仍须在候选部署包中独立审阅。transport URL 保留实际值，不通过合成一个“来自新域的 Request”绕过既有 URL 校验；浏览器 Origin/Referer/Fetch Metadata 保留实际来源，不反射或生成。鉴权仍使用原 session 与 Catalog，`services.origin` 的路由/安全含义必须拆开；不能只改一处比较。

公开 transport 本身不是代理身份认证：直接访问也不能得到特权，不靠入口 Worker 的过滤或“请求经过代理”授予用户权限。Backend 必须独立执行同一认证、邀请/归档/项目权限、CSRF、并发、kill switch、限时与释放门禁。若实际部署必须保证“只有入口 Worker 可访问”，或要求可信转发 IP，需另行选定经过认证的通道与防重放设计；本准备没有新增共享 secret/token/mTLS/Access 凭据，不能声称已具备这个保证。

新入口 Worker 只接受精确 App HTTPS origin；官网/www、相似域、HTTP、非预期端口及 Host 不一致拒绝。固定配置构造上游 URL，保持原 pathname/query，绝不将 client path 作为新 URL 的基址。移除客户端提供的 forwarded/身份/内部 capability headers，按审阅过的请求头清单转发 Cookie、Origin、Content-Type、idempotency-key、Last-Event-ID 等。API 仍为相对 /api，不增加跨域 CORS。

全程 `redirect: manual`，不自动跟随跨域重定向，不重试 POST/Turn/Run/provider/tool，不改变请求 key 或 body。失败保留原身份/原 key，通过既有只读 receipt 核对；未知执行隔离、暂停，不能换域/项目后重发。按原 Gateway 大小和时限约束处理输入，不把代理当成新的执行容器或资金准入点。

## 认证、Cookie、Location 和旧域恢复

[BetterAuth 安全说明](https://better-auth.com/docs/reference/security) 支持固定 baseURL、明确 trustedOrigins 及 host-only Cookie。本地安装版本为 1.7.3；测试使用仓库真实 authOptions/库，未升级依赖。官网文档当前版本与本地可能不同，行为证据以该本地测试为准。

规范 auth 实例固定新 APP_ORIGIN，trustedOrigins 仅新域；不打开 trustedProxyHeaders、disableCSRFCheck、disableOriginCheck 或跨子域 Cookie。原 BETTER_AUTH_SECRET、Google client/secret、OAuth egress、cookiePrefix `riffology` 与数据库全部留原账号；轻量入口不复制这些秘密。

真实库的离线 sign-in/social 在 transport URL 下、固定新 baseURL 配置中生成新域 callback、state/PKCE 和 Secure host-only Cookie；恶意 forwarded-host 不改变 callback。**这是 2026-10-07 方案阶段的库级证据**：当时未拆 transport/canonical 的 Gateway 在 Workerd 中拒绝该组合。2026-10-08 本地接线已通过双 Workerd 联合 fixture；真实 Google token exchange、code/state 与跨账号回程仍未验收。

- Set-Cookie 每条原样独立转发；不合并，不改 Domain/SameSite/Secure/HttpOnly/Path。现有 host-only Cookie 经入口响应由浏览器归属 app.riffoid.com；原旧域 Cookie 不会自动迁移。新域重新登录同一 Google 身份，真实验收再比对原 auth subject/Catalog user/tenant/project/Run，不能仅因登录成功而宣称身份保留。
- Location 必须由 canonical auth/路由正确生成；若发现旧域 Location，修正源逻辑并重测，不能盲目字符串替换。保留 Google callback query/state 到固定传输端点供服务器验证；禁止把旧域 callback 的 code/state 用 302/307/308 搬到新域。未完成的旧登录先结束或过期。
- 当前库 sign-in/social 返回 JSON 内的 Google授权 URL；2026-10-07 的离线 response probe 只允许相对/规范 App Location。2026-10-08 入口实现另逐路径允许 sign-in 的精确 Google authorization URL 与精确 canonical callback；没有追加任意外域 redirect。
- 旧恢复模式仅开放经原 session/Catalog 权限检查的明确 GET 路径（session、workspace snapshot、原 receipt、必要状态），逐条确认读不触发 reconciliation/执行或危险数据库副作用。禁止开放所有 GET；get-session 的默认 session 刷新也要按只读承诺明确处理和验证。
- 旧入口不加载现有可自动恢复/发送的完整 App 启动流程，不 sign-in/sign-out/accept invitation、建项目、改参数、Turn/Run 或升级 WS。安全导航仅固定静态路径到新域临时 302；query 私密文本不随导航搬迁。遗留 API 返回明确迁移提示/拒绝写，不使用会重发 body 的 307/308。
- 未提交草稿手工保存；不迁移 sessionStorage/localStorage 的 pending intent/请求 key，不把私有内容放入 URL。服务端已保存内容保持原身份恢复；新提交由用户明确新动作发起。

## SSE、WebSocket、Browser Execution

[SSE/响应流转发](https://developers.cloudflare.com/workers/runtime-apis/streams/) 可保持上游 body stream，禁止先 text()/json()/arrayBuffer() 再返回。保留 event id、after_sequence、Last-Event-ID、no-store/no-transform 和原有观察/鉴权窗口。取消或断流只结束观察，不取消/重放 Turn；重新连接原 cursor，权限每轮仍由后端核对。本地 fixture 已验证逐块读取与取消传播；跨账号 CF 流首包、持续连接、断线、释放行为仍待真实验收。

[WebSocket 官方能力](https://developers.cloudflare.com/workers/runtime-apis/websockets/) 不等于本应用迁移许可。M3/Preview/WS 当前关闭；probe 明确拒绝 upgrade，线上门禁保持关闭。不为迁移打开 M3/G5/legacy M4。若日后单独授权 WS，需要原路径权限/Origin/subprotocol、101 的 webSocket 对象传递、双向关闭/错误/时限和真实跨账号验收；当前不做。

Browser Execution 保持原独立 workers.dev origin、Worker、固定 frame/脚本/摘要及本地 unverified 边界。不能代理其 runtime 到 app.riffoid.com，也不改到 preview.riffoid.com；二者会触犯当前同站隔离。新 Gateway CSP 保留 connect-src/form-action 'self'、frame-ancestors 'none'，frame-src 仅原已核验 Execution（及原允许的、仍受门禁控制的 M3 来源）。Execution APP_ORIGIN/frame-ancestors 改新域属于另行批准配置动作；建议旧恢复页冻结预览，避免此次引入双 ancestor 新代码。不能改变固定资产/容器摘要或将 Preview 提升为权威 Evidence。

## 两账号配置变更清单（尚未执行）

| 所有者 | 已知角色 | 候选变更与上线前核验 |
| --- | --- | --- |
| 新账号 jihe.gao@theidsa.org | 已购买 riffoid.com | account ID、zone ID、nameservers、DNS、TLS、WAF/Access/redirects **均待实际只读核验**；邮箱不等于 account ID |
| 新账号 | App 轻量入口，尚未创建 | Worker 名称/ID/version 待定，flag global_fetch_strictly_public；App Custom Domain 精确 app.riffoid.com；无 D1/R2/DO/container/service binding/应用 auth secret |
| 新账号 | 官网/www | 官网独立静态内容/隐私条款/TLS、固定 www → 官网 redirect 单列；本次未制作或发布，不承载 API |
| 原账号 | 原 Gateway 与所有数据/执行资源 | 模板候选 account ID `8b0d70250211aa10d89e20605a1c7e5e`、Worker `riffology-m1-gateway-staging` **不是本次 live 证明**；核验原 active script/version、完整 settings/assets/bindings 和新旧精确 route |
| 原账号 | 拟独立 public transport hostname | 精确 URL/zone/route/TLS 待核验和批准；仍指向原 Gateway，不跨账号 CNAME；现有模板 workers_dev=false，不自行开启 |
| 原账号 | canonical/恢复分流及原 auth | 从实时完整配置做 overlay；新 APP_ORIGIN、拟议 APP_TRANSPORT_ORIGIN、旧恢复来源/路径/期限。原秘钥、OAuth egress、邀请/账本/门禁保留；新增 TWO_ACCOUNT_AUTH_MODE 默认 disabled，shared-limited 的共享限流风险需单独决策 |
| 原账号 | Browser Execution | 精确 execution URL/Worker/version/hash 待回读；只调整批准的 APP_ORIGIN/ancestor，固定资产、独立站点与执行开关保留 |
| 原 Google OAuth client | 原身份/provider/scopes | 增补精确新 callback，按实际需要登记 JS origin/authorized domain/consent links；不换 client、scopes/secret。旧 callback 有界结束后撤除另批准 |
| 两账号 | 安全/可观测性 | 不削弱原 WAF/Access；若公共 Worker 请求被阻挡，记录阻碍，另审确切策略，不变换 UA/IP/headers 绕过。rate-limit/IP来源、日志脱敏、SSE缓存/限时需验证 |

历史 #169 Gateway version `76380e93-a2ab-4cd8-9340-e3587d3956f6` / deployment `b0d46e8a-77bb-42cf-93d6-0d36d756b537`、93 bindings、15 容器应用、33 slots/129 observed calls/6 released Run leases 是既有证据，**本次没有重新核验线上现值**。不把模板部署到线上；[现有操作规程](private-beta-operations.md#release-and-observation) 要求完整 live overlay，不能遗漏 bindings/assets/container 配置。

## 后续批准点与验收

1. 先只读核验两账号/zone/Worker/route/TLS/安全策略、原完整 deployment/资产/镜像/namespace/策略 pin/12月31期限/账本摘要，以及 Google callback 清单。使用已有授权访问；本次不登录新账号或新建凭据。
2. 接线实现经过独立 review 和离线联合测试后，先决定认证可用性策略：保持关闭、明确限定的受控共享限流，或经过批准的新认证传输/可信 IP 方案。再提交精确的入口 Worker/flag、原 public transport route、新旧 URL 分支、TWO_ACCOUNT_AUTH_MODE、canonical/auth、Execution/CSP 的配置 diff 与完整 live overlay。**本地接线已有；实际账号/transport/DNS/OAuth/Execution 的完整批准配置包仍缺，不能请求立即切换。**
3. 单独批准该具体 Cloudflare 资源/DNS/TLS/路由/安全配置及现 Google OAuth callback/domain/consent diff。若需权限/凭据变化，给出方案和风险另批准；本准备不包含这种授权。
4. 冻结切换与恢复窗口、旧域只读期限、原 active versions/hashes/traffic 以及回退动作，再批准真实双账号网络/指定身份认证验收。任何付费 Turn/Run 另明确身份/原项目/请求/费用与时限，不由入口测试扩权。

批准后的分阶段验收：

- 候选阶段：核验固定 HTTPS上游、公网 Worker 路由、TLS、安全策略、无循环/自动重定向；精确域/端口/Host/forwarded/相似域拒绝。官网和执行站点不能进入 API。记录两账号 ID、exact URLs、active versions/hashes。
- 切换前停止新提交，等待原 active Turn/Run 与 runtime/tool/container 释放确认；未知保持隔离和原-key观察，不重放。保存未提交文本，等待旧 OAuth state 结束/过期。
- 新域 Google登录：核对 callback/state/PKCE/不扩大scope、每条 Cookie 的 host-only/secure属性、Location及CSRF拒绝。登录同一身份比对原 subject/Catalog user/tenant/项目/Revision/历史Run/账本。第二真实身份检查跨项目/运行越权拒绝及邀请撤权；fixture 不能替代。
- SSE：真实首包/持续增量、原cursor恢复、权限撤回/断线/限时、无缓冲或重放。WS保持拒绝；Execution只原独立站点、正确ancestor/固定摘要、跨站/跨身份负向边界与local/unverified展示。
- 旧域只读：逐路径核验授权、数据副作用、无执行、无callback搬运/自动启动/写入/upgrade，安全跳转不携带旧 query。完整观测与非此次配置/身份保持后，才按批准范围开放新域写入；旧callback/入口撤除另按批准窗口。
- 对任何执行行为分别记录请求轨迹与作用域权威计数；本次仅离线 outbound 0，不以此声称生产调用计数已核验或云费用为零。

## 按整组回退

冻结 A（现旧域可恢复基线）、B（两账号候选）、C（新域完成）的准确资源/版本/配置组合：新入口 Worker/version/flag/上游、两边routes/DNS/TLS、原Gateway代码/hash/完整vars/assets/bindings、Execution版本/CSP/ancestor、Google callbacks 与安全规则。不要混合不同canonical的版本分流。恢复单域代码/配置时，将 APP_TRANSPORT_ORIGIN、TWO_ACCOUNT_AUTH_MODE、LEGACY_RECOVERY_ORIGIN、LEGACY_RECOVERY_UNTIL 作为同组移除，并恢复原 APP_ORIGIN；遗留半组配置会失败关闭。

异常时停止新准入并保留原请求观察/释放；按已批准组合恢复 Gateway/Execution、入口路由和 Google callbacks。恢复原旧域可登录方案与12月31策略时，已保存新域会话不跨域复制，用户重新登录原同一身份；未确认请求保持原key核对，不自动提交。入口可先返回无执行的维护响应，避免流量落到不匹配组合。新入口或transport的解绑/删除只在回退明确授权和观察完成后进行。

数据、meter-only、原容量actor/pin、12月31 reviewAt、历史计量/预留/审计保持现值；不能回到仅10月20配置的旧Worker。Worker rollback 不恢复外部数据库/资源状态，[Cloudflare rollback限制](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) 应在冻结版本前核对。本准备未实施任何回退或暂停线上容量。

## 2026-10-07 方案阶段证据

- [离线 probe](../scripts/m1/riffoid-public-hop.ts)：无 fetch、无 Worker export、无配置文件、生产模块不导入；固定旧 HTTPS transport、保留真实 Origin，故意证明当前拒绝。
- [Node 边界测试](../tests/m1/riffoid-two-account.test.ts)：12项；含真实 BetterAuth 1.7.3、Gateway、Execution拒绝、Cookie/Location/SSE、CSRF/Host/upgrade。
- [Workerd 边界测试](../tests/m1/riffoid-two-account-workerd.test.mjs)：1项；构建真实Gateway，在本地D1中初始化schema，outbound handler拒绝所有请求并核对调用数0。它不模拟跨账号网络成功。
- 既有 auth-gateway 3项、google-oauth-egress 2项回归与上述Node 12项共17项通过；Workerd另1项通过；typecheck通过。未运行全仓/远端CI，不重复使用PR170测试总数。
- [脱敏证据记录](evidence/riffoid-two-account-preparation-20261007.json) 保存环境、命令、结果、失败修正与范围。没有 Cloudflare API/应用/OAuth线上请求；官方文档与GitHub读取不算应用执行。

```sh
node --test tests/m1/riffoid-two-account.test.ts tests/m1/auth-gateway.test.ts tests/m1/google-oauth-egress.test.ts
node --test tests/m1/riffoid-two-account-workerd.test.mjs
npm run typecheck
git diff --check
```

本机Workerd需临时loopback端口，沙箱首次EPERM后仅本地测试获准。初次fixture缺auth schema时session读503，已初始化原schema后复验通过；Node初次邀请hash fixture不合schema，已修正。工具连接曾临时中断，恢复后继续完成验证；没有把失败尝试算通过。GitHub SSH/HTTPS拉取无法认证，采用连接器读取PR元数据并核对已存在本地tree，发布草稿使用GitHub连接器，不读取凭据。Delivery Project网页读取失败，未改状态；PR记录离线范围及未覆盖项。上述缺口是 2026-10-07 阶段结论。2026-10-08 已补本地接线、合成 Google/全新浏览器 Cookie 和流边界测试；真实两账号资源 ID、公网路由、真实 Google 身份及线上流/隔离验收仍缺。

## 2026-10-08 本地实现与证据边界

入口实现为 [services/entry/index.ts](../services/entry/index.ts)，配置边界为 [origins.ts](../services/gateway/origins.ts)。仅从固定 APP_TRANSPORT_ORIGIN 构造公网 HTTPS 请求，保持真实 transport URL 与浏览器 Origin，单次 fetch、manual redirect、原 body/key/cursor、无缓冲 SSE；WebSocket/Upgrade 拒绝。出口不携带转发身份或内部 capability。Cookie 要求原 `__Secure-riffology.*`、host-only、Secure/HttpOnly/SameSite=Lax/Path=/；Location 只允许新 canonical，或 sign-in 响应的精确 Google authorization URL/精确 callback。没有 D1/R2/DO/容器/service binding 或认证 secret。

Gateway 把 URL 路由 origin 与 canonical 安全 origin 分开。代理模式剥离转发/IP/内部能力声明；canonical 直达旧 Gateway 拒绝。公开 transport 直接请求仍需原身份与 Catalog 权限，不能宣称入口专属。BetterAuth 保留原秘钥、表、cookiePrefix、Google主体映射、邀请/撤回门禁、固定 trustedOrigins 和 CSRF。代理模式不信任 IP 头，使用原数据库限流的共享 per-path 桶；原 60秒/30 次配置及 BetterAuth 更严格 endpoint 规则保留。本地 1.7.3 的 `/sign-in*`、`/sign-up*` 等规则为 **10秒/3次**。匿名直接 transport 请求可耗尽共享桶，阻断其他人的登录；这是未解决的公开可用性阻碍，不能靠扩大限额、关闭限流或信任任意 forwarded IP 通过验收。

`TWO_ACCOUNT_AUTH_MODE` 在双账号模式默认 `disabled`，新应用/transport 全部返回 `503 two_account_auth_disabled`，在认证、存储及外网调用之前拒绝；旧域恢复独立保留。只接受 `disabled` 与 `shared-limited`，其他值失败关闭。离线联合测试显式选用 `shared-limited`，仅说明原保护在共享模式仍生效。最新指令禁止部署共享桶可用性阻碍版本；不再将接受该风险作为上线选项。无新增秘密的 WAF 来源核验候选、适用条件和失败回退见最新决策文档；本次未实现该新信任机制，默认仍关闭。

[legacyRecovery](../services/gateway/recovery.ts) 的服务端恢复页面没有完整 App 启动、自动请求、草稿复制、SSE、Preview 或写入。用户显式填写原 workspace（或原 session/key）后才 GET 原记录。仅允许无 query 的 GET `/api/me`、`/api/auth/get-session`、`/api/workspaces/:id`、`/api/workspaces/:id/sessions/:sid/turns/receipt`，前两者返回安全的身份/session摘要；认证/授权仍来自原会话与 Catalog。POST、旧 callback、其他读路由、Upgrade 均拒绝；期限到达服务端读请求返回410。静态指南和单独的 `/legacy-local-runs/` 本地查看/原文导出仍可用，后者仅在用户点击后读取匹配原 native key 的本机 localStorage，不引入旧 App/local-runs.js、restore、运行或存储写入，不跨域传输，也不携带 code/state/draft 跨域跳转。原域和浏览器 profile 必须保留。

只读 auth 使用 `deferSessionRefresh` 与服务端 `disableRefresh`，绕开 auth handler 的数据库 rate-limit 写入；离线验证有效旧会话不刷新，过期会话不删除。新 `recoveryTurnSnapshot` RPC 只读原 journal 并保留原 actor/scope/name，不调用原 snapshot 的 `assertQuiet`、budgetStatus、运行协调或 admission。首版 hot fixture 仅证明已启动实例的恢复读取不写；后续审查发现原 constructor 会持久化 journal 迁移、创建 Preview discovery/index 并设置 alarm。现 constructor 仅在内存读取/校验，原迁移事务延后到正常应用 RPC/handler/alarm 的一次性准备边界；原迁移与 discovery 算法未改。新增真实 Workerd 重启测试分别从缺 discovery index 的 v7 与历史 v1 journal 恢复：constructor 加恢复 snapshot/receipt 的 SQLite `total_changes()` 为 **0**，KV/journal/alarm 原样保留、outbound 为0。随后正常 receipt RPC 确认迁移到 v7、创建原 discovery/index 并保留正常 alarm 维护。已有到期 alarm 属于正常执行路径，本改动不取消既有任务，不能把恢复读取零写扩展为全局无后台活动。

恢复专用 `recoveryTurnReceipt` 保留原 scope/session/actor/authVersion/key 检查；需要 Beta/G5 外部权威 binding 核验的旧回执返回 `503 recovery_authority_unprepared`，因为相关权威 DO 冷启动会初始化持久化表，尚没有验证为纯读的接线。不得用本地 journal 取代权威检查；普通应用 `turnReceipt` 仍按原 Beta/G5 binding 核验。旧会话身份与授权 workspace snapshot 仍可读取；Beta/G5 精确旧回执恢复暂不可用是明确限制。

[入口模板](../infra/wrangler.riffoid-entry.template.jsonc) 与 [原账号 overlay 示例](riffoid-two-account-gateway-overlay.example.jsonc) 仅供审阅。实际两账号 ID、zone ID、transport hostname/route、恢复截止时间、完整 Gateway/Execution 版本/vars/bindings/assets 与 Google console readback 均待批准后核验；不得直接用空模板发布。原线上 Wrangler 配置、schema/migrations、namespace/class/actor、容量策略与 December31 trial/October20 M1 截止没有改动。Execution 代码及资产没有改动，后续只在批准完整包内调整其 APP_ORIGIN/ancestor，仍保留原独立站点。

首版本地证据见 [2026-10-08 JSON](evidence/riffoid-two-account-local-20261008.json)，其中 constructor unchanged 的陈述只适用于首版。后续修复以 [冷启动/认证门禁证据](evidence/riffoid-two-account-fixes-20261008.json) 为准。双 Worker 测试运行两个独立本机 Workerd；global fetch 仍构造固定公网 HTTPS，测试 harness 将其送到另一本机实例，不使用生产 service binding。Miniflare HTTP bridge 会带入 loopback Host，测试专用 adapter 恢复为 URL Host；生产无此 adapter，Host负向边界由 Node 测试覆盖。Google token/JWKS 使用本地签名 fixture，不是真实 Google；全新离线 Chromium 仅使用已有缓存，无现有浏览器 profile/Safari，所有请求拦截。最终离线测试没有未拦截的外部请求；没有部署、付费执行或完整产品验收。

下一次批准应针对完整可回退配置包分别覆盖：①只读核验两账号/zone/完整原绑定和账本；②创建/绑定新账号无状态入口及旧账号独立公网 transport；③原 Gateway、Google 精确 callback 与原 Execution/CSP 联动变更和明确恢复期限；④指定真实受邀身份的新域登录/旧域恢复/权限负向/SSE/Preview验收；⑤若需 Turn/Run 付费验收，再单独明确 identity/project/provider/时限/费用与释放观察。后续新增推送授权与实际只读核验见下节；本节测试证据仍不代表真实上线验收。

首版本地回归：M1 **317/317**、M2 **869/869**，补充 **5个文件的所选 M3 10/10**，均零失败、零跳过。三组共 **1196 次测试执行**，文件不重复但覆盖有重叠，不能称为1196个独立验收场景或完整 M3。首版新14项已包含在M1，单独定向11项也与M1重复，不累计。初次 Chrome/资产前置失败与修复过程记录在首版 JSON。后续冷启动与门禁修复的完整回归结果记录于修复证据；没有远端 CI 或真实双账号验收。


本轮修复最终回归：M1 **321/321**、M2 **869/869**，均零失败/跳过；完整 `test:m3` 命令四组分别为 926通过/12跳过、20通过、13通过、92通过，合计 **1051通过、12跳过、0失败**（1063项登记）。跳过项需要真实 compiler/Mesa/Docker运行产物，本次未启用这些验收，不计为通过。首轮 M3 的 TLS fixture 因系统 LibreSSL 不支持 `pkey -check` 失败；用本机已安装 OpenSSL 3.6.4 复验15项通过，再重跑完整 M3 成功。最终 typecheck、RPC AST 核对、diff 与本地文档链接/JSON 校验通过。4项新增测试（模式默认关闭、实际Gateway拒绝、v7/v1真实冷启动）已包含在321中，定向复验不累计。没有运行远端 CI、全仓 M0/其余研究套件或真实双账号验收。


## 2026-10-08 推送授权与部署只读核验

用户在 02:53:25 UTC 新增“授权推送上线”。该授权允许推送候选和推进既定部署，但新登录、持久凭据/权限、安全配置差异与恢复期限仍须按最新指令明确处理。本任务已用现有 GitHub 连接器更新独立草稿 PR173；Git CLI 缺认证，未读取或配置凭据。首个远端 commit `cd60b89c94b1ecc3a0a08554a0c8f662fad0820d` 的 tree `f734e4c30ee3dca6f35519b19a63d219ebcf54e3` 与本地修复 commit `938248a284f2ec3eff64d4d5178ec8f36b401f00` 完全相同。随后核验发现线上已部署 PR172，因此整合最新 main `25609953f5c3b69dcb44e520d7e7ed1253d18fe4`（PR172/174），保留浏览器本地 Runs 及既有上线证据；原 e55104b 基线不可直接覆盖当前服务。整合后验证与发布证据见 [只读核验/推送记录](evidence/riffoid-two-account-publish-readback-20261008.json)。

CLI `whoami` 实际确认现有 OAuth 登录为原账号 `jihe.gao@gmail.com`、account ID `8b0d70250211aa10d89e20605a1c7e5e`；不读取或输出其 token。新账号 `jihe.gao@theidsa.org` 的认证、account/zone ID 和角色仍未核验。公开 DNS 仅确认 riffoid.com 使用 Cloudflare nameservers，不能据此认定账号/zone 归属。

当前可回退基线是 Gateway deployment `c6ff55e4-2364-4920-94e0-b8784a1824b5` / version `aeddf112-a2be-45da-868c-ed576c55d5ec`，93 bindings，2026-10-08 PR172 发布；其 APP_ORIGIN 仍为 `https://m1.riff-demo.gaojihe.cn`，Execution 为 `https://riffology-browser-execution.jihe-gao.workers.dev`。Execution deployment `a6fdeb9f-d885-4c72-9e02-968315351edb` / version `c94df077-02a1-460f-8158-e47a338e68af`，4 bindings，APP_ORIGIN 仍为旧域。原账号只读列表确认15个 container 应用；没有启动/停止/更新。Gateway 非秘密 policy 的 reviewAt 确认为 `2026-12-31T15:59:59.999Z`。历史 #169 版本不能单独作为本次回退目标，必须保留 PR172 的当前功能与完整配置。版本 API 不返回 secret_text 的值；本次仅回读元数据、非秘密绑定与白名单 origin/policy 字段，没有读取应用用户库或调用运行/容量 DO。

尚缺完整 live settings/routes/zones/TLS/WAF/资产版本、镜像与账本摘要的冻结组合，以及两个账号的实际配置权限。原账号当前没有配置 APP_TRANSPORT_ORIGIN 或恢复模式；不能把旧恢复 hostname 同时当作新 transport，也不能假定未核验的 workers.dev 地址已启用。若需要启用 workers.dev、添加 Access/mTLS 或可信 IP 通道，应列精确安全差异并另确认，不能绕过原账号已知注册限制或用跨账号 CNAME 代替。

必须确认的安全/恢复差异：

- 认证模式：目前保持 `disabled`。选 `shared-limited` 须明确接受匿名访客可耗尽全站 3次/10秒登录桶的受控可用性风险；可信转发通道需要另审认证/防重放/凭据与运维方案。
- Google：拟在原 client 增补 `https://app.riffoid.com/api/auth/callback/google`，不替换 client/secret/scopes；旧 `https://m1.riff-demo.gaojihe.cn/api/auth/callback/google` 的撤除时间另定。当前 Google console 清单未回读；若需 authorized domain `riffoid.com`、JS origin 或 consent links，再按实际现值列 diff，不能直接改。
- 原 Gateway：APP_ORIGIN 从旧域改为 `https://app.riffoid.com`，增加精确已核验的 APP_TRANSPORT_ORIGIN、TWO_ACCOUNT_AUTH_MODE、旧恢复 origin 与 UTC 截止；仍使用原秘密、身份、库与 bindings。
- 原 Execution：APP_ORIGIN 从旧域改为新 canonical，使 frame-ancestors 切到新域；EXECUTION_ORIGIN 和固定资产保持原值，不增加同站执行、不扩为双 ancestor。该安全差异尚未执行。
- 恢复窗口建议：新域正式切流后48小时，须确认确切 UTC 起止。原 Cookie/session 沿用既有8小时会话有效期，不延长、不跨域复制；过期旧会话在新域重新登录原同一身份。期满合法恢复 API 返回410，旧静态引导可继续保留，删除入口/数据不在本方案中。

上线顺序仍为：冻结当前完整配置/代码/资产/绑定与回退版本 → 核验新账号/zone/权限和独立 transport → 确认上述安全差异与恢复期限 → 保持新应用关闭准备候选 → 真实受邀身份的固定路由/认证/CSRF/Cookie/SSE/隔离负向验收 → 按批准范围切流。未知请求继续按原key观察，禁重放。异常时维护入口并整组恢复当前 Gateway/Execution、routes 与 Google 清单；不覆盖新域产生的原库数据，不清理旧账本/预留，不撤原域或更换 namespace。


整合最新 main 后，全仓 `npm run check` 退出0：UI21、M0 350通过/1条件跳过、M1 321、M2 869、M3四组945通过/12条件跳过 +20+13+92、Issue73 30、Python质量8，typecheck及M0证据/预检自测通过。M3合计1070通过、12跳过；各阶段覆盖会重叠，不汇总为独立验收场景。现 live Gateway compatibility_date 为2026-09-09，临时副本只替换本地 fixture 日期的4项复验也通过，未修改生产日期。测试环境是macOS/Node26.10/Python3.9，CI是Ubuntu/Node25.3/Python3.12。首个远端 CI [#151](https://github.com/jihegao/riffology-cloud/actions/runs/37720443885) 失败，实际 runner_id=0、steps=[]，没有执行验证；具体失败注释的连接器端点不开放，不能断言该次根因。历史PR172的#146账户账单/限额故障仅作旁证。本地完整检查足以继续源码审阅与候选准备，不能宣称远端CI通过或代替真实双账号上线验收。没有执行Cloudflare部署/切流或Google/安全变更。
