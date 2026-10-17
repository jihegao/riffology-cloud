# 本地确定性 provider：真实受邀隔离验收方案（待审阅，未执行）

日期：2026-10-16（Asia/Shanghai）。本文件只提出方案；没有实现测试桩、构建镜像、启动服务、发起 Turn、写项目、登录、调用 provider 或修改环境。用户目前授权仅为准备方案供审阅。

## 源码与证据边界

只读检查 `/private/tmp/riffology-pages-split-20261016`。检查时 HEAD `413e5a9d07b0d63087d430c31906d8950867762c`，HEAD tree `dc74f7879e022da9f31cf0de25eb949a3663d350`；root 正在调整文档/证据，故执行前必须重新冻结最终 #221 HEAD、tree、干净源码以及构建输入摘要。本文件不是该最终 HEAD 的验收结果。

目标只证明真实 Google 受邀身份、真实 Pi/ToolBridge/Revision 写入之后的页面/只读 broker/隔离/撤权链路。provider 为进程内确定性协议测试桩，不证明线上模型、智能任务表现、实际费用/模型 budget 路径、Managed backend 或生产部署可用。`productionEligible=false`、`productionEnabled=false`、`deployed=false`；不得凭这份方案或测试桩成功撤掉生产禁用。

## 最小复用与 backend 选择

选择已有 native Pi backend：`services/turn-runtime/durable.ts` 的 ProductTurnRuntime → `release-gated.ts` / `release.ts` → TrustedPiSandbox + ProjectToolSandbox。本地新环境不提供 MANAGED_ACCEPTANCE_JSON / MANAGED_TESTING_JSON 路由，不绑定外部 Managed 服务，不用 Managed 响应 fixture 代替原生工具执行。

可复用以下代码模式，但不能整脚本直接运行：

- `scripts/m2/crud-validation-release.mjs`：调用原 `createProductTrustedPiRelease().resolveOptions()`，保留真实 bridge、research context、权限、deadline；只替换 providerDefinitions、resolveCredential、onProviderPayload、providerFetch，采用进程内 completions SSE。
- `scripts/m2/crud-validation-fixture.mjs`：请求协议断言、固定工具调用和 tool-result 后终止模式。新增独立验收 profile，不更改已有 CRUD profile。新 profile 必须验证固定 prompt、输入模型 ID、工具名/参数、逐步结果及总请求计数；未知输入立即失败，无网络 fallback。
- `scripts/m2/crud-validation-image.mjs`：构建专用 Trusted Pi 测试镜像时替换 release-unconfigured 模块的明确模式，保留 candidate 原码并标注 validation profile。记录候选源码 SHA、覆盖文件 SHA、Dockerfile diff、镜像 ID。此镜像绝不能推送或作为生产镜像。
- `scripts/m2/check-product-turn-local.mjs`：仅借鉴 Miniflare5/原生 Docker bindings、停止/释放证据。它直接创建 fixture Google users/sessions、邀请和模型 Catalog 数据，这些段落不得复用。`tests/m3/project-view-artifact-fixture.mjs` 的 seed/materialize 也不得用于正式验收。
- 现有 `services/project-views/local-host.mjs` 和已审阅隔离 Chromium 镜像继续原样使用，网络隔离不得降级。

本地配置仅在新的独立环境开启 M2_TURNS_ENABLED=true；M2_MODEL_PROVIDER_ENABLED=false，provider 真凭据完全不装载。保留邀请准入、Origin、Catalog scope、容量、超时、停止和 ledger 约束。如普通 native Turn 仍被现有 admission 拒绝，先报告具体阻碍，不能改为管理员直写、内部 RPC seed 或静默放宽策略。产品所选 model ID 只用于协议匹配，证据必须显示 providerTransport=deterministic-local-fixture，不能声称调用了该模型。

## 固定输入与真实工具回执

待实现并离线审阅后冻结 fixture manifest：固定文件路径、UTF-8 字节与 SHA256；所有内容仅含非敏感验收 canary。推荐 6 文件：`app/views.json`、`app/home.html`、`app/details.html`、`app/main.mjs`、`app/style.css`、`docs/data.json`。manifest 声明两个入口和全部资产，页面通过既有 SDK 调 files/read、artifacts/list/read 和包内 navigate。页面无保存按钮、不能发起 Turn。

普通账号在产品 UI 创建空白项目 A，提交固定 prompt `LOCAL-IDENTITY-V1:<fixture-manifest-sha256>`。fixture 逐个返回工具调用（前一 tool result 已成功且绑定正确 call ID 才发下一步）：

1. `project_bash` 固定 `mkdir -p app docs`，timeoutMs=5000。
2. 按固定顺序 6 次 `project_write({path,content})`。
3. `project_read({path:'docs/data.json'})`：文件预先设计为约 24 KiB 的有效 JSON；完整 read 的序列化结果须实际超过 16384 bytes，且低于产品读取上限。不得用最多 8192 bytes 的 read_page 充当这项。
4. fixture 收到所有成功工具结果后只输出固定终止文本；产品正常结束 Turn、冻结 archive/session、提交 Revision。不能直接调用 commit、append event 或写 R2。

真实 artifact 来源是 `services/artifacts/materializer.ts`：成功 read/list/search 的 terminal ToolEffectReceipt，JSON 结果 >16384 bytes 后由 ToolArtifactStore materialize/reconcile；`pi-execution.ts` 产生工具事件，Workspace 仅交付已提交 tool.completed/replay receipt 对应 artifact。artifact ID 不写死、不伪造；页面运行时列举并读取，逐块还原后与真实 tool result 摘要比对。若 read 被截断或未产生真实 artifact，停止修正 fixture 设计，再审阅，不能伪造大结果。

后续固定请求：V2 修改同组文件并再次真实 read；RESTORE 只读固定文件以检查冷恢复；SECOND 在第二真实 Google 身份下的项目 B 写入另一 canary；九个 EGRESS 请求分别只替换固定攻击入口为 href/assign/replace/fetch/beacon/image/form/window.open/WebSocket 之一。每个请求具有唯一 prompt digest、UI idempotency identity 和预期工具列表。禁止重试未知执行，也不自动再发同内容新 Turn。

两个身份必须真实 Google 登录，邀请由本地真实 operator 通过产品正式接口/UI签发并接受；新项目通过普通路径创建。operator 自己的 project 若不满足相同普通路径条件，不能冒充普通第二账号。第二身份/跨项目矩阵必须明确权限角色，验证 A/B 相互 package 拒绝以及旧 broker 撤权后拒绝。

## 新环境与原 pending 保留

原 `/tmp/riffology-amd-real-identity-20261015/manual-auth-state/v3` 已有 schema9 manual journal/pending。精简 #221 的 `services/turn/store.ts` 接受 schema7；绝不能把精简代码指向该旧状态、删 pending、降级 schema、替换 checkpoint、重置账本或复用旧 operationId。原状态和服务版本作为独立失败证据封存；原请求收敛由独立 manual Draft PR 处理，不将新环境视为旧请求完成证明。

新建唯一空 Miniflare persistence 目录、D1/DO/R2 namespace 和 worker 名，运行精简 HEAD 自带迁移。不要复制旧 DB、auth session、项目、journal。新的真实 Google OAuth 登录重新生成会话；只复用现有私密 OAuth 配置入口。若必须复用已允许的 8795 callback，先确认旧服务及全部原容器终止/释放，保留旧目录只读，再切换 loopback tunnel；不得抢端口或停止不明进程。旧 pending 的数据未结案不等于有活执行，二者分别核对。

新环境 operator 初始化必须复用现有正规本地 bootstrap 流程，随后由真人接受邀请；不得写假 auth rows。冷恢复只允许重启该新环境同一持久目录，不能另建项目绕过 unknown。

## 网络、资源、停止、清理

Google OAuth 例外只允许现有 Google-only 出站 handler 的 token POST/JWKS GET，无 redirect；其他 worker 外发 deny 并计数。fixture providerFetch 不调用 fetch，固定 `.invalid` URL 只做协议值。真实工具桥沿既有受限内部通道；Project Tools 无 Internet。Chromium 保持独立 `network=none` 及现有 capability/seccomp/resource 限制；不赋 privileged/host network。AMD 的 Docker API helper 修复若仍需要，只沿用已审阅精确镜像/容器名过滤和 namespace 内 sysctl，不动宿主 sysctl、防火墙、Tailscale。

loopback collector 8837 记录九个唯一 canary，攻击前后宿主正对照各一次；页面必须先从 broker 得到本项目 canary，再尝试外发。按每次实际协议调用、浏览器状态/错误及 collector 轨迹证明，不能将“未收到请求”单独判成功。记录原容器 ID、image ID、network mode、命令、生命周期；UI 切页/撤权后验证原浏览器容器不存在，不能只看替代容器或端口。任何未知 execution、工具失败、意外外发、权限泄漏、释放不明立即停止后续请求；保持本地 admission 关闭，按原 ID 对账/清理，不自动 fallback/retry。

结束：撤权通过正式 operator 路径，旧 broker 拒绝、会话关闭；逐个检查 scope 内原 runtime/tools/trusted-pi/browser/helper 容器。仅删除明确属于本轮且已停止的原 helper；Miniflare dispose 不等于 helper 已清理。关闭 collector、host、Gateway、隧道，确认 listener/socket/容器释放。保留有权限控制的原始状态与脱敏证据；不删除历史。

## 待批准的执行预算（批准前不执行）

- 仅现有 AMD128 本地 Docker/Miniflare，0 线上模型请求、0 云端计算请求、0 镜像发布、0 生产配置变更。
- 最多 2 个新本地项目、2 个真实 Google 身份；本地 operator 邀请/撤权只作用新 Catalog。
- 最多 13 个串行 Turn：V1、V2、RESTORE、SECOND、9 EGRESS。每 Turn 最多 10 次真实工具调用、11 次进程内 provider 响应；总计最多 130 工具调用、143 fixture 响应，执行前按最终 manifest 收紧。现有产品限制优先，不为满足额度提高产品上限。
- 单 active Turn，全局 capacity1；每 Turn 最多120秒且不超过现有 deadline，bash 最多5秒；整个主动执行窗口90分钟（真人登录等待不计执行时间）。最多一个隔离页面容器；每个退出/撤权后确认释放。测试镜像仅从本地已缓存基础镜像构建，不拉取依赖；缺依赖或预计构建超时即报告。
- 任一失败保留证据并停；修复后的新批次/预算另报，不能用剩余额度无界重试。具体脚本、fixture manifests、配置 diff、资源约束及停止命令准备好后供最终审阅，再请求执行批准。

## 最终证据要求

`evidence/releases/` 保存最终 PR HEAD/tree、专用 fixture overlay SHA、所有镜像 digest、真实身份类型与脱敏映射、项目/Turn/Revision/package/artifact/event IDs 与摘要、状态迁移、九种矩阵、collector 正负对照、原容器释放、productionEligible=false/未部署。分别列：真实 OAuth/Catalog、真实本地工具/ledger/Revision、合成 provider、真实隔离 Chromium；不得合并描述成“全线上真实模型 E2E”。同时报告本轮 ModelProxy provider dispatch 权威计数为零和受限出站日志，fixture provider 响应数量单列；不以已有云计数推断本轮为零。更新 #221/#214/#85/JHG-46，并明确 Preview 退役和 Observer/WebGL 不在本轮。
