# 双账号迁移最小决策与具体差异

2026-10-08：候选已获推送及推进部署授权；本文件列出尚需事实核验和行动时批准的具体差异。尚无 Cloudflare/Google/安全配置变更或真实双账号验收。新应用默认关闭；不部署 shared-limited 的共享限流 DoS 版本。完整当前版本/账号元数据见[只读核验](evidence/riffoid-two-account-publish-readback-20261008.json)。

## 只读浏览器访问事实和最小用户动作

本线程实际可调用工具清单已检查：没有 CUA、图形桌面、屏幕观察、现有浏览器 tab 控制或其工具发现入口。Figma 截图与网页检索不提供本机浏览器会话。测试用 Playwright 使用全新隔离 profile，不能冒充现有 Cloudflare 登录，也没有附着现有浏览器/CDP、读取 profile/cookie。

只读进程名称确认 Safari 和 Google Chrome for Testing 正在运行，不能据此推断 Cloudflare 登录身份。用 CoreServices `AEDeterminePermissionToAutomateTarget(...,'core','getd',false)` 检查现有权限，无提示、无授予：Safari (`com.apple.Safari`) 和 Google Chrome for Testing (`com.google.chrome.for.testing`) 均返回 -1744 `errAEEventWouldRequireUserConsent`。这仅证明当前 Codex 执行路径读取这些应用的 Apple Events 需要 Automation 用户许可，不证明图形访问或登录不可用；没有尝试弹出授权，也没有遇到拒绝后绕过。

若选择 Apple Events 路径，精确首次操作是让 Codex 对 **Safari** 执行 `get URL of current tab of front window`（例如 AppleScript `tell application "Safari" to get URL of current tab of front window`）；这会请求 macOS **Automation / Apple Events** 的请求方→Safari 权限。用户须先明确允许触发该操作，并在系统弹窗允许；已列出的项目可在 System Settings → Privacy & Security → Automation 中允许实际请求方控制 Safari。仅 URL/标题读取不要求 Safari “Allow JavaScript from Apple Events”；若进一步用页面 JS 读取账号资料，该额外 Safari 设置要另说明，不自行启用。Chrome for Testing 的类似事件权限也未获授予；不操作正在被其他任务使用的实例。未验证 Accessibility/Screen Recording 权限，也无可调用 CUA 消费这些权限。

**无需新增系统权限的最小替代**：用户在已有 Safari Cloudflare 标签页打开 [Cloudflare Dashboard](https://dash.cloudflare.com/)，手工确认当前 profile email；若已是 `jihe.gao@theidsa.org`，打开 riffoid.com Overview，只提供公开 account ID、zone ID、plan 与当前角色，以及 Workers Domains & Routes、DNS/TLS、Security/WAF 自定义规则的配置元数据。页面不存在现有新账号 session 时，明确指出需用户自行在独立 profile [登录](https://dash.cloudflare.com/login)，保持旧 session；本任务不代为新登录/切账号，不创建 API token 或扩大 OAuth scopes。API/CLI 已只读确认原账号 `jihe.gao@gmail.com` / `8b0d70250211aa10d89e20605a1c7e5e`；新账号 ID 未知。

## 共享 auth 限流的首选候选：不新增持久秘密

实际 BetterAuth 1.7.3 仍是数据库限流基本 30/60秒、sign-in 更严格 3/10秒；当前代理不信任任何 IP header，因此不同访客共享每路径桶，匿名 transport 请求可阻断其他人的登录。提高/关闭限流或随意采纳 forwarded IP 均不解决本任务的信任问题。

根据官方 [Worker 请求 IP 行为](https://developers.cloudflare.com/fundamentals/reference/http-headers/)，跨 zone fetch 的 CF-Connecting-IP 变成统一 Worker IP；同 zone Worker 可改变 x-real-ip。应在 WAF 使用 Cloudflare 计算的 [`cf.worker.upstream_zone`](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/cf.worker.upstream_zone/)，不能以访客可自行填入的 CF-Worker 字符串作为 WAF 来源证明。以下是由官方行为推导的**待核验设计**，不是已经可上线的保证：

1. 在原账号自有、代理启用的 zone 建独立 transport hostname，原 Gateway/绑定不变。首选候选 `riffoid-transport.gaojihe.cn`，备选 `m1-transport.riff-demo.gaojihe.cn`；账号/zone 归属、hostname 可用性、路由、证书和套餐须先回读，不将它们当成已存在地址。
2. 原 zone 的 WAF Block 规则：`http.host eq "<精确 transport host>" and cf.worker.upstream_zone ne "riffoid.com"`。新 zone 入口的 WAF Block 规则：`http.host eq "app.riffoid.com" and cf.worker.upstream_zone ne ""`，防止 Worker 上游流量把可更改的同 zone IP 当成直接浏览器 IP。规则属于安全配置差异，行动时另批准；不是建立额外身份权限。
3. 新入口先删除所有访客 IP/forwarded/自定义 IP 声明，仅从 Cloudflare 原生直接请求元数据提取并严格验证 IP，设置唯一 `x-riffoid-client-ip`。Gateway 仅在上述固定 transport 的有效平台来源边界下用它划分原 auth rate bucket；不用于身份、Catalog、CSRF 或 G5 权威。无有效 IP/来源时拒绝，不退回共享桶或信任任意头。完整原限流、origin、cookie、账号映射和撤回逻辑保留。
4. 核验双方套餐/规则容量/字段可用性、所有 Skip/Transform 规则顺序、IP-header 移除/Pseudo-IPv4 设置，以及整个新 zone 的 Workers/路由控制权。upstream_zone 证明的是 **zone**，不是具体 script；新 zone 其他脚本的写权限属于信任边界。CF-Worker header 在应用端只能作防御检查，不能替代 WAF 的计算字段证明。检查 workers.dev/default aliases 和其他路由无绕过；Gateway topology 对非固定 transport/canonical/recovery 来源仍严格拒绝。
5. 上线前做真实无费用负向验收：直达 transport、伪造 CF-Worker/IP、外部 zone Worker、同 zone Worker 调用 app、未配置别名必须拒绝；两个独立访客/IP 的 sign-in 桶不得互相耗尽，单一 IP 更严格限额仍生效。不能只用离线自填 headers 证明 WAF 来源成立。[WAF 自定义规则](https://developers.cloudflare.com/waf/custom-rules/) 的实际可用性/权限尚未回读。

若不能在现有角色和套餐建立这个来源边界，继续关闭，不降级。较大的备选是新入口私有签名 Secret、旧 Gateway 公钥/key ID pin、短时签名（method/固定 target/path+query/time/nonce/client IP/body digest/cookie hash）及原账号原子 nonce 防重放存储；新持久私钥、public-key 配置和 replay-state 资源/模式需逐项批准后才能生成/配置。绝不把原 BETTER_AUTH_SECRET 复制到入口。本轮没有生成秘密、增加权限或实现任何未经批准的 IP 信任机制。

## 行动时最小决策清单

| 决策 | 明确范围与当前阻碍 |
| --- | --- |
| A：确认 transport 候选及首选 WAF 来源方案 | 先只读确认两账号/zone/现有角色；随后批准精确旧账号 hostname/route、两条 WAF Block、仅用于原 auth 限流的可信 IP 接线及真实负向测试。套餐/字段/现有角色不足时先交具体阻碍，不申请付费升级或新权限。 |
| B：Google 与 Gateway/Execution 同步差异 | 原 Google OAuth client 只添加 `https://app.riffoid.com/api/auth/callback/google`，保留旧 callback 供回退；现 console list 待回读。authorized domain `riffoid.com`、JS origin/consent links 仅在现配置实际需要时列精确差异再批准；不换 client/secret/scopes。Gateway APP_ORIGIN 从 `https://m1.riff-demo.gaojihe.cn` 变为新 canonical，并增加经核验 transport、原 recovery origin/截止时间；Execution APP_ORIGIN 与唯一 frame-ancestors 同步新 canonical，原 `https://riffology-browser-execution.jihe-gao.workers.dev`、Worker/固定资产/摘要不变，不加双 ancestor。以上是认证/CSP/配置动作，须批准具体包。 |
| C：旧域服务端恢复期限 | 提议切换后 **48小时**，确认后按实际切换 UTC 时间计算 LEGACY_RECOVERY_UNTIL；当前未写死时间。原会话 8小时有效期不延长/复制，过期后在新 canonical 用原身份重新登录。期限只关闭服务端恢复 API；静态指南和本机只读 Runs 导出保持，不删除旧入口或数据。 |

已经授权的推送和部署准备不再重复请批；需要上述决策是用户最新限制指定的安全配置/恢复期限边界。浏览器元数据可用手工只读提供，不必批准系统 Automation 或新登录。

## 历史与 G5 边界

旧域 `/legacy-local-runs/` 仅用户显式点击后枚举原 `riffology:local-runs:v1:<tenant>:<project>:<workspace>` keys，再显式选择读取。原 JSON/raw text 按原字节导出；状态不改为 interrupted、不修复损坏、不导入/上传新域、不 replay pending intent，也不恢复执行。它没有 full App/runtime/import，CSP connect-src 'none'，不需要 server auth/session；浏览器仍只允许当前 profile/旧 origin 的 localStorage。恶意 label 作为 text/textarea value 显示，不执行 HTML。原页静态 root/script/CSS 在 server 截止后仍200；服务端 API410且不读 auth/数据库。此本机历史仍是 local / unverified，不成为服务器身份或 Evidence。

Beta/G5 的 legacy 精确 turn receipt 因权威 DO 冷启动纯读未准备而503 `recovery_authority_unprepared`；影响的是旧域恢复那条权威回执读取，不能据此判定原任务未接受/失败，更不能自动重交/消耗新 request key。普通 canonical `turnReceipt` 原权威 binding 核验、读会话/Guard/attestation/reopen 原协议不变，用户新域登录原身份后可走原正常路径。新域 default-disabled 期间自然仍不可用，必须先解除 auth 可用性阻碍。旧域 snapshot 是经身份/权限核验的记录查看，不替代 G5 proof。

入口与 Gateway 现在仅精确保留 `x-riffology-g5-read-session`、`x-riffology-g5-read-capability` 两个客户端 proof 输入，其他转发/IP/internal-authority header 仍删除。这两项不变成可信身份，原 Catalog/Workspace/G5 Guard 验证 capability、scope、authVersion、顺序和期限。legacy API 遇到任一 proof header 返回403 `legacy_g5_read_session_unavailable`，绝不返回未计入证明的普通200。

## 验收和回退

批准并完成核验后先保持新应用关闭，冻结当前 Gateway/Execution 完整版本、bindings/vars/assets/container pins 和原 routes/security config 的回退组合；当前可回退版本是 Gateway `aeddf112-a2be-45da-868c-ed576c55d5ec` / Execution `c94df077-02a1-460f-8158-e47a338e68af`，发布前须再次回读是否变化。建立并负向验证精确 transport/WAF 后，再联动 OAuth/Gateway/Execution 与新入口；不得把旧完整 App 同时暴露为 transport。

真实验收包括：Google state/callback/query 验证与 Secure host-only cookie、同一原 subject/Catalog user/tenant/project/history、新旧 origin 隔离、撤回/跨 scope 负向、双访客 auth bucket、SSE cursor/逐块/取消和无重交、Execution 唯一新 ancestor/站点隔离、G5 proof 和原权威门禁、旧 server 期限及本机原字节导出。真实付费 Turn/Run 另按 identity/project/provider/时限/费用授权，本轮没有运行。

失败时关闭新入口流量，恢复冻结的原 Gateway/Execution origin/config/assets/versions 与原域完整入口，并回读原 Google callback 仍在、原权限/身份/历史无变更。不要使用早于 PR172 的版本单独回退；不恢复数据库快照覆盖新数据，不清账、不重建 DO/身份/namespace，不删除新域/旧域数据。48小时后保留旧静态导出能力，是否解除/删除线路须另行安排。

## 本轮离线验证

typecheck 通过；最终生产代码的完整 M1 **323/323**、完整 M3 四组 **945通过/12条件跳过 +20+13+92**，合计1070通过、12跳过、0失败。随后增强现有生产 Gateway Workerd 测试（无 auth/Catalog/DO/assets bindings 的过期静态分支）2/2通过，没有再改生产代码。定向16项与这2项均重叠完整回归，不累计。新浏览器测试只用合成 local Runs，验证原始/损坏文本导出、运行状态与 pending intent 不变、零存储写、零身份读取、无 API/上传/运行/重交、新域没有自动迁移数据。G5 原 proof GET/attestation/reopen 与负向在实际本地 D1/Workspace/Guard 链通过；该 fixture 的身份/authority snapshot 为显式测试夹具，不替代真实 Google、跨账号平台/WAF 或付费验收。

详细日志 SHA256、阶段和访问边界见[本轮证据](evidence/riffoid-two-account-review-fixes-20261008.json)。上一已推送整合基线的全仓 `npm run check` 曾退出0，本轮按修改范围运行 M1/M3，不把上一 M0/M2/研究质量结果冒充新一轮重跑。远端历史 CI151/152未获得 runner/steps；最终新 head CI 状态另在 PR 回读记录，不能宣称离线回归即远端 CI 或上线验收通过。
