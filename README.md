# Riffology Cloud

Riffology Cloud 是一个多租户、持久化的 AI 仿真建模工作台。
用户围绕 Project 和 Pi Agent Session 工作，Workspace 提供文件、运行与插件能力，
Browser 作为可选内置插件提供交互预览和 Agent 观察。

截至 2026-09-18，正式 Browser Preview、Workspace UI 和 G4/G5 控制逻辑已在集成分支实现；PR #76 的发布记录见[线上验收说明](docs/browser-preview-online-acceptance-20260917.md)。登录用户的最新线上预览仍有兼容故障，由 [Issue #78](https://github.com/jihegao/riffology-cloud/issues/78) 跟踪。合入主分支不表示该故障已修复、完整线上验收通过或付费执行已开放。下方早期里程碑保留历史状态，当前整合与检查结果见[主分支整合记录](docs/integration-main-review-20260918.md)。

MVP 采用极简 Session 界面，以 Cloudflare Workers、Agents SDK / Durable Objects、
Sandbox、D1 和 R2 构成云端服务；本地候选支持 Python 标准库 Queue 与固定 Mesa profile，保留历史 SimPy 路径。

## 文档

- [当前发布与验收状态](docs/release-readiness.md)：源码、部署记录、真实验收边界及后续负责人。
- [Queue 受邀用户研究指南](docs/invited-queue-research.md)与[本轮本地验证](docs/invited-queue-delivery-validation.md)：首个官方案例、三人研究验收及未冻结的生产执行条件。
- [#73 实验结论](docs/issue-73-luna-agents-adr.md)与[质量回归](docs/research-quality-regression.md)：保留当前运行时，复用已有负面实验发现。
- [当前多阶段开发计划](docs/issues-subagent-plan-20260915.md)与[实施验收记录](docs/issues-development-log-20260915.md)：#64 浏览器 Preview、#65 UI、#46/#37 生产验收及 #35 官方模型。
- [研究闭环 Issues 执行顺序](docs/research-loop-execution-plan.md)：第一阶段签收后的 8 个交付批次、依赖、接口兼容和验收门槛。
- [MVP 系统概要设计](docs/mvp-system-design.md)：产品范围、功能模块、架构、核心流程、持久化与验收标准。
- [官方模型库、多租户与 Token 付费设计](docs/model-library-tenancy-billing-design.md)：官方模型版本、项目与账单归属、充值余额、Token 结算和运行额度。
- [用户端与管理端 UI 设计](docs/ui-design.md)：信息架构、页面、控件、状态、响应式与权限边界。
- [平台与项目内 Pi 构建边界](docs/platform-project-boundary.md)：固定开发提示、三层归属、Browser 与领域状态、可编辑内容及平台权威收据。
- [开发过程推演与风险登记](docs/development-tabletop.md)：12 步工程交付推演、16 个产品与故障场景、18 项风险及应对和验证要求。
- [开发与部署完整计划](docs/development-deployment-plan.md)：M0–M5 / C1–C3、两端页面验收、负责人、CI/CD、11 步部署、灰度、回退与恢复。
- [开发执行状态](docs/development-status.md)：M0 实际结果、风险、环境缺口和后续门禁。
- [受控 Pi 与模型代理接线](docs/m0-proxy-pi-bridge.md)：单次凭据、完整 Session 历史、显式取消和本地验证。
- [M1 本地运行手册](docs/m1-local-runbook.md)：身份、邀请、项目与配额的本地实现、迁移、验证和剩余接线。
- [M2 持久 Turn 与文件版本执行清单](docs/m2-execution-plan.md)：Session/Turn/Event 原子账本、Gateway 接口、运行恢复与后续验收顺序。
- [M0 本地运行手册](docs/m0-local-runbook.md)：受控 Pi、保存协议和 Sandbox 探针的运行方式。
- [M0 云端下一步](docs/m0-cloud-next-steps.md)：镜像仓库、Preview 域名及模型账户前置条件。
- [Pi 代理诊断镜像](docs/m0-pi-proxy-image.md)：当前 Linux 构建、离线 SDK 检查、公开范围和待接入的云执行链路。
- [镜像替代发布方案](docs/m0-registry-alternative.md)：已构建的两份镜像、公开范围和待确定的 Docker Hub 仓库。
- [M0 剩余工作](docs/m0-remaining-work.md)：逐项列出本地证据、云前置及 G0 验收缺口。
- [M0 中断恢复探针](spikes/m0-recovery/README.md)：真实 Pi、持久协调、断线、杀进程与容器销毁后的本地恢复。
- [M0 发布策略探针](spikes/m0-release/README.md)：本地子进程版本准入、候选失败回退与未知副作用不重放。
- [M0 本地发布清单](docs/m0-release-manifest.md)：当前源码、检查与构建产物的摘要复验，保持云发布门禁关闭。
- [UI 验证清单与结果](docs/ui-qa-inventory.md)：浏览器实际交互、视口截图与未接入能力。

## 本地 UI 原型

```sh
npm run dev
```

打开 [用户工作台](http://127.0.0.1:4173/#/workspace) 或 [管理控制台](http://127.0.0.1:4173/#/admin)。
静态服务仅使用 Node.js 内置模块，无需安装依赖即可预览；`npm ci` 安装锁定的 M0 开发、运行时和浏览器验证依赖。

用户端覆盖 Session、Browser / Files / Changes / Runs、项目、官方模型库、账单、空间设置和邀请登录。
管理端覆盖运营概览、模型版本、租户与额度、运行、用量结算和审计。
顶部可切换评审视角，工作台底部可切换故障示例；修改保存在当前浏览器，可通过右上角重置按钮恢复。

## 状态

已形成基础 MVP 与首个付费版本的设计基线，并完成可交互的 UI 原型。
原型使用本地示例数据，尚未接入生产后端。M0 已实现受控 Pi 宿主、保存协议、独立 Sandbox、Preview、中断恢复与发布策略探针；T02 本地边界 10 case 和 T07 本地 Chrome 14 case 已有证据，另有本地真实模型调用、取消与恢复子集证据，最新范围见执行状态。T02 的成功写入仅限独立 project 文件，Session 不是安全边界；T07 使用 server-owned synthetic fixture，不等于生产登录或云验收。
机场 Starter 提供完整的工作台示例；其他模型展示目录、固定版本复制和独立项目上下文。

云端 G0 仍为 1/10 staging passed，仅 Storage T06 云 fault 原语已单项签收：[gate summary](docs/evidence/runs/m0-g0-t06-cloud-20260905/G0-T06-gate-summary.json)。完整 G0 尚未通过，暂不进入 M1。

模型代理已部署为独立 staging Worker / SQLite DO，[23 项云端 fixture 检查](docs/evidence/runs/m0-model-proxy-cloud-1788613210899-49e0a3db/model-proxy-cloud.json)通过，覆盖显式取消、提前取消、撤权、崩溃后保留额度和拒绝重放；四个 run 最终均撤权且 active=0。本次 50 次业务请求、50,210 响应字节、34.347 秒，没有真实模型调用。[最新本地全检](docs/evidence/runs/m0-local-20260905155634615/local-checks.json)为 192 项通过、1 项 opt-in Python 跳过、2 个自检通过。当前入口只有模拟 SSE；真实云 Pi/供应商、输入 token 上界与账户核验仍待完成，T01/T09 未通过。单纯断线的本地取消缺口保留，当前使用显式 `/v1/cancel`。

[Registry 上传](docs/evidence/runs/m0-registry-chunked-trusted-20260905111316067/result.json)在单层 120 秒期限内失败，随后 HEAD 404，镜像 manifest 未发布；[复核和清理](docs/evidence/runs/m0-registry-chunked-trusted-20260905111316067/cleanup-verification.json)确认 Container 应用为空、无遗留上传进程。Preview 尚无专用域名，T07 云 runner 未执行；其[本地 14 用例回归](docs/evidence/runs/preview-browser-1788605434924/artifacts/preview-browser.json)保留为局部证据。

[受控 Pi 代理客户端](docs/m0-proxy-pi-bridge.md)已通过 13 项本地集成检查，覆盖完整 Session 历史、每调用独立 capability、显式取消、超时和凭据脱敏；另完成真实 Pi 子进程到 Workerd/SQLite DO 的 [10 项本地联调](docs/evidence/runs/m0-proxy-pi-local-1788622591199-4e3a43ff/proxy-pi-local.json)，包括落盘恢复、DO 重启与取消收据；该客户端已进入[新本地镜像](docs/m0-pi-proxy-image.md)，尚未上传或部署；此前冻结镜像保留为历史。

用户登录、生产多租户链路、持久 Turn、项目应用、真实 Run 和计费尚未交付。当前源码未整体部署，候选清单仍禁止推广。详见[开发执行状态](docs/development-status.md)。


Browser Preview 按[多阶段计划](docs/issues-subagent-plan-20260915.md)实施；历史验收见[实施记录](docs/issues-development-log-20260915.md)，最近发布边界见[线上验收说明](docs/browser-preview-online-acceptance-20260917.md)。干净工作树执行 `npm ci` 后创建 `.local`，依次运行 `node services/browser-preview/runtime/prepare-assets.mjs`、`node services/browser-preview/execution/materialize.mjs`、`node scripts/m3/materialize-browser-preview-web.mjs`，再运行 `npm run check`。固定资产必须通过收据核验；这些本地检查不能替代登录用户的线上验收。
