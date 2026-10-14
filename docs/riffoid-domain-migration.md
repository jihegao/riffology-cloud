# riffoid 品牌与域名迁移准备 — 2026-10-07（历史设计）

2026-10-14 整合说明：PR #169 已合并；应用域名已切换到 `app.riffoid.com`，官网实际位于 `www.riffoid.com`，apex 跳转到 www。下文是 10 月 7 日的原始离线方案，不是重新切域或回滚指令。当前部署与验收依据[发布索引](release-readiness.md)及 [PR #173](https://github.com/jihegao/riffology-cloud/pull/173)；不复用过期窗口或重放历史请求。

本次只提交品牌源码和离线准备，未合并、部署或修改 Cloudflare / Google 配置。
域名购买由另一任务处理；费用、OAuth／安全配置变更和正式切换仍须分别批准。
这是迁移设计与验收清单，当前任务状态仍由 Delivery Project / 相关 Issue 管理。

## 已确认事实与保留范围

- 最新 main 为 `e55104bec3966a2c6f096ba9910712732979f055`（#168）；#165 已有指定受邀作者参数草稿及真实单次／对照 Runs 验收。README 的旧 pending 不能替代该证据。
- [#104](https://github.com/jihegao/riffology-cloud/issues/104) 和未合并 [PR #169](https://github.com/jihegao/riffology-cloud/pull/169) 记录已执行续期：Gateway `76380e93-a2ab-4cd8-9340-e3587d3956f6`，deployment `b0d46e8a-77bb-42cf-93d6-0d36d756b537`，100%；reviewAt 为 `2026-12-31T15:59:59.999Z`（北京时间 12 月 31 日 23:59:59.999）。M1 验收截止仍是 10 月 20 日。保守预留、计量／费用历史、原 pin 和审计保留，#101 不因此结算。
- #169 的既有回读为 93 个 bindings、15 个容器应用、33 slots、129 observed calls、6 条已释放 Run leases；这是此前证据，**本任务未重新核验线上现值**。PR #169 的任务 capability 删除证据还有评审意见，不能代其证明凭据清理。
- 保留仓库／包名 `riffology-cloud`、Worker / DO class / actor、D1 / R2 名称和 ID、bindings、镜像 digest、cookiePrefix `riffology`、所有 storage keys、`x-riffology-*`、`.riffology`、schema／消息协议及历史证据。原用户、邀请、项目、Revision、Run 和归档身份不迁移、不重建。
- R 字形标记兼容新名称，继续使用；可见字标移除 cloud 后缀。Browser Execution 固定／留存资产中的旧 JS frame 标题及固定容器内旧提示保持原字节，避免品牌修改改变冻结资产摘要或镜像；后续有明确独立发布授权再处理这些低优先级标识。

## 目标与来源边界

| 入口 | 目标行为 |
| --- | --- |
| `https://riffoid.com` | 独立静态官网；此次没有制作或发布官网 |
| `https://www.riffoid.com` | 固定跳至官网，拒绝开放跳转参数；不承载 API |
| `https://app.riffoid.com` | 应用规范主域，API 始终相对 `/api` |
| `https://m1.riff-demo.gaojihe.cn` | 有界过渡恢复入口；随后仅安全导航到规范主域 |
| 现有 Browser Execution `workers.dev` origin | 保持原 Worker、资源和资产身份；实际精确 URL 待线上回读 |

当前 `services/gateway/index.ts` / `app.ts` 严格检查单个 `APP_ORIGIN`，
`auth.ts` 的 baseURL / trustedOrigins 也是单值；仅新增 DNS／route 不能支持新旧域并行。
此 PR **没有**放宽这些检查，也没有把准备模块接入请求路径。

离线模块 `scripts/m1/riffoid-domain-preflight.mjs` 只接受两个固定 App origin，
输出规范 auth baseURL、单个 trustedOrigin、精确 Google callback、同域 API 和明确 frame ancestor 列表。
它不发网络请求、不修改配置。测试覆盖恶意 Host／forwarded-host、相似域、路径、凭据、跨站 POST、旧域写入与 WebSocket、Execution 同站拒绝，以及切换／回退组合。

```sh
node --test tests/m1/riffoid-domain-preflight.test.mjs
# 输入仅两个非秘密字段，executionOrigin 必须来自实际线上回读：
# {"canonicalOrigin":"https://app.riffoid.com","executionOrigin":"<原 Execution HTTPS origin>"}
node scripts/m1/riffoid-domain-preflight.mjs /path/to/non-secret-input.json
```

正式切换前还必须实现、审阅并离线测试以下接线；准备测试通过不表示接线已完成：

1. Gateway 按固定配置 allowlist 匹配 `request.url.origin`，不反射 Host／forwarded headers。官网／www 与 API 不互通；非 allowlist 保持原 Preview 路由严格校验／拒绝。规范主域使用现有严格 `requireOrigin`；不给旧／新域互相发跨域写请求的权利，不增加 CORS wildcard。
2. 旧域仅经认证的恢复读：会话、原 Workspace snapshot、原请求 receipt 与必要静态页面。逐条 GET 路径白名单，禁止新 Turn、项目、Run、参数或邀请写入，禁止 upgrade。旧域鉴权只使用固定旧域实例的 get-session；规范域 sign-in / callback 的 auth 实例固定新域 baseURL / trustedOrigins。恢复页必须替换现有可自动恢复／发送请求的 App 启动流程；不能仅把现有页面放在旧域。
3. 切换前停止新的用户提交并等待原 Turn / Run 确认释放；未确认执行按原身份继续只读核对，保持暂停／隔离，不为了切域重试。旧 cookie 是 host-only；新域重新登录同一 Google 身份，保留原 issuer/subject 与 Catalog 映射，不补发邀请、不创建第二账户或新账本。cookiePrefix 不变，不设置共享 Domain。
4. `sessionStorage` 的对话草稿、pending intent，以及其他浏览器 locale／参数存储均不会跨域自动继承。切换提示要求用户手工保存未提交文本；不能导入 pending idempotency key、自动重发或携带私有文本到 URL。原请求先在旧域观察回执；新域从服务端恢复已保存数据和原 Run 后，只有用户明确的新操作才生成新请求。
5. 老 GET 页面跳转只对明确静态导航路径使用临时 302，目标是固定新域安全路径。POST、callback、WebSocket 和未知 pending 不使用 307/308 跨域重发；不要把旧 callback 的 code/state/query 转发到新域。过渡期间先让原登录流程结束／过期，再调整 callback；API 返回明确切换提示和拒绝写入，而非重定向写请求。

## Browser Execution / CSP / OAuth 同步

Execution 当前实现和 host 固定资产按 hostname **最后两级**比较隔离站点；
`app.riffoid.com` 与 `preview.riffoid.com` 都属于 `riffoid.com`，后者会被拒绝。
继续使用现有独立 `workers.dev` 域，不修改这一校验来适配同站子域。

- Gateway CSP 保持 `connect-src 'self'`、`form-action 'self'` 和 `frame-ancestors 'none'`；`frame-src` 只列原 Execution 精确 origin 及原有经校验的 M3 Preview origin。不得为迁移打开 M3/G5/legacy M4。
- Execution 的 `APP_ORIGIN` 与 `frame-ancestors` 当前也是单值。过渡若需要旧／新 App 同时预览，须增加**显式两个 origin**的 frame ancestor 配置并测试，保留同站隔离和固定资产；或者冻结旧域预览，仅新域生效。不能只改 Gateway 而漏改 Execution。
- Google 同一 OAuth client 增补 `https://app.riffoid.com/api/auth/callback/google`，按实际需要登记 JavaScript origin / authorized domain；保留原 callback 到有界登录过渡结束。Consent screen 显示名改 riffoid 是独立 Google 配置动作，`appName` 改名不会替代它。官网、隐私／条款链接和域验证须先可用，不扩 OAuth scopes、不新增 secret、不改变 egress / Access / WAF 安全策略。

## 上线前盘点与按组合回退

本机 Wrangler 4.129.0 `whoami --json` 返回登录过期且无法非交互刷新。
没有可用的本次只读 Cloudflare API 访问；不重新登录、不读取或输出 credential、不新增 token。
Delivery Project 页面也无法通过本次网页读取；已读取 #104 和 #169，未更改 Project 状态。
以下均待具备既有只读访问后核验：

- 当前 Gateway / Execution active deployment、version IDs、traffic、下载代码哈希、兼容日期／flags、完整 settings／assets、93 bindings 的真实身份和所有 secrets **名称**（不读值）。
- 15 个容器应用 identity / version / image digest / limits，DO namespace / class / actor identity、D1 / R2 identity、Beta pin / reviewAt、所有执行开关、原账本摘要与已接受请求／释放状态。
- 原及新域 zone / DNS / Worker route 或 Custom Domain、TLS、Access / WAF / redirects、实际 Browser Execution origin / CSP；Google 已登记 callback / origin 和 consent domain。

[`private-beta-operations.md` 的 Release and observation](private-beta-operations.md#release-and-observation)
明确仓库 phase1 配置只是模板、缺少线上 bindings。发布候选必须从实际 active version / settings
导出完整 overlay，逐字段保留所有身份和非此次参数；禁止拿模板重建线上。#169 的版本是回退候选证据，不能当作已完成本次回读。

| 配置组合 | Gateway / auth | Execution / CSP | routes / OAuth | 回退条件 |
| --- | --- | --- | --- | --- |
| A：已知旧域基线 | 已回读代码＋完整 live vars，单个旧 APP_ORIGIN | 原 Execution / 旧 frame ancestor | 原域路由 / 原 callback | 保留 12/31 reviewAt 和当前原 actor pin |
| B：过渡候选 | 审阅后的固定 allowlist；新域 canonical、旧域恢复只读 | 两个明确 ancestors 或旧预览冻结 | 新／旧路由和 callbacks 有界共存 | 所有 active version IDs / hashes / vars 记录为一组 |
| C：切换完成 | 新域 canonical；旧域安全导航／恢复窗口结束 | 新单域 ancestor，原执行站点 | 旧 callback / route 按批准窗口撤除 | 保留恢复窗口与组合 A，不重放 pending |

正式切换前从实时盘点冻结 A/B/C 的**准确** Gateway 与 Execution version IDs、代码哈希、
APP_ORIGIN／CSP／auth 值、DNS/routes 和 OAuth callback 清单。不要新旧 origin 不同的版本混合分流。
批准后顺序为：准备官网与 TLS → 增补 OAuth callback → 验证候选代码和完整 overlay →
停止新提交并核对释放 → 同步 Gateway / Execution 配置 → 核验新域登录、原身份／项目／Run、
两身份隔离和恶意来源拒绝 → 开放新域写入 → 有界观察 → 按批准窗口移除旧入口。
切换失败按冻结的整组恢复 routes / OAuth / Gateway / Execution；现有数据、计量、pin、
费用预留和 `2026-12-31T15:59:59.999Z` reviewAt 不回滚。
不得直接回退到 10/20 策略的旧版本；DO 数据变更／缺失资源也会限制 Worker rollback。
见 [Cloudflare rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
与 [部署 vars 保留规则](https://developers.cloudflare.com/workers/wrangler/commands/workers/)。

## 后续确切批准项

1. 域名购买任务确认实际总价／续费、归属账户与 DNS 接入；本任务不重复购买。
2. 批准指定 Cloudflare zone 的 DNS／TLS／固定 www redirect 和现有 Worker 新域 routes，及上述完整 overlay 中明确的 APP_ORIGIN / CSP / Execution ancestor 变更。Access / WAF 等安全策略若需修改，单列变更和理由再批准。
3. 批准现有 Google OAuth client 的 callback／origin／authorized-domain／consent 展示与官网链接变更，保持 scopes / credentials 不变。
4. 在接线实现、完整回读、候选验证及恢复组合均可审阅后，批准正式切换窗口、旧域保留期限和回退动作；认证验收／任何付费 Turn 或 Run 的身份、请求和费用范围单独明确，不由品牌 PR 授权。

## 本次验证记录

[脱敏准备记录](evidence/riffoid-brand-preparation-20261007.json) 保存检查范围和本地日志摘要。
既有 CI suites 已逐项在本地运行：按主检查阶段汇总为 2,614 次 Node 测试通过、13 次 opt-in 跳过，Python 研究质量 8 项通过。
此口径把 TLS 单项初次失败替换为 OpenSSL 3 复验通过，包含 `check:ui` 的 21 次执行在 `test:m1` 通配中重复计入；不代表独立唯一测试数，额外专项复验另列。
本地 Node 为 26.10.0；现有 CI 配置为 25.3.0，不能把本地结果当作该 CI 环境已通过。
最初 `npm run check` 在未改动的 TLS fixture 失败：系统 LibreSSL 不支持 `pkey -check`；
使用已有 OpenSSL 3 后整个 15 项 preflight 文件通过，并显式完成被中断的其余 suites。
因此不宣称最初整条命令退出成功。导出研究包最后一次文字修改后的 16 项 ACL／摘要／回执回归与 typecheck 通过。
新增迁移检查 3 项均通过，四个品牌页面离线截图无脚本错误；编辑文档本地链接与 diff 检查通过。
已观察到品牌代码 head `d09596fea7ef718c029f1e9ee1ac0a672beed7a5` 的 [GitHub CI run 37620856225](https://github.com/jihegao/riffology-cloud/actions/runs/37620856225) / job `112790470041` 在执行测试前失败。独立复核返回耗时 2 秒、`runner_id=0`、runner name 为空；连接器返回 `steps=[]`，日志读取为 404。两条 annotations 暂未取到，原因未知；不能称为测试失败或推断账单原因。本次未请求重跑 CI。线上配置、新域认证、真实普通用户与付费执行均未验收。
