# 研究闭环分批交付记录

日期：2026-09-14。执行顺序见[计划](research-loop-execution-plan.md)。本记录区分代码合并、本地验证和普通用户线上验收；合并不自动关闭对应 issue。

## 已合并批次

| 批次 | 交付 | 合并与验证 |
| --- | --- | --- |
| 执行准备 | 固定依赖顺序、兼容要求与阶段门槛 | [PR #47](https://github.com/jihegao/riffology-cloud/pull/47)；文档差异与链接检查、独立评审通过。 |
| #46 / #37 提前准备 | 生产通道候选评估与运行环境租约 ADR | [PR #48](https://github.com/jihegao/riffology-cloud/pull/48)、[PR #49](https://github.com/jihegao/riffology-cloud/pull/49)；代码与官方文档核对、独立评审通过。ADR 不代表通道启用或运行性能验收。 |
| 1 · #29 | 非程序员 Model 视图；冻结版本读取接口；契约错误与旧 Run 提示 | [PR #50](https://github.com/jihegao/riffology-cloud/pull/50)；候选 `9d74199` 完整 `npm run check`：1,642 通过、6 跳过、0 失败。Chrome 桌面与手机检查、独立评审通过。 |
| 2 · #30 / #33 | 持久实验分组、基线/干预、多种子有界调度；直接参数比较、逐 Run 状态和未知提交恢复 | [PR #51](https://github.com/jihegao/riffology-cloud/pull/51) 后合并 [PR #52](https://github.com/jihegao/riffology-cloud/pull/52)；组合候选 `58b1945` 完整检查：1,661 通过、6 跳过、0 失败。合并后源码树与候选一致；后端 Workerd/SQLite 与 Chrome 定向检查通过。 |
| 3 · #31 | 持久数值证据、来源核验、历史来源查询；独立模型/Run 否定与汇总排除 | [PR #53](https://github.com/jihegao/riffology-cloud/pull/53)；候选 `1e985d6` 完整检查：1,684 通过、6 跳过、0 失败。独立评审和最终 Workerd 集成复跑通过；合并 `d0d8f59` 的源码树与候选一致。 |
| 4 · #32 | 完整冻结研究 ZIP、历史源版本与证据、离线校验和 Python 重放 | [PR #54](https://github.com/jihegao/riffology-cloud/pull/54)；候选 `d34b556` 完整检查：1,698 通过、6 跳过、0 失败。主控独立评审通过；合并 `d39e3dd` 的源码树与候选一致。 |
| 5 · #45 / #34 | 持续双栏工作台、Preview / Model / Runs 与渐进信息层级；恢复不重跑、停止目标与预览身份一致 | [PR #56](https://github.com/jihegao/riffology-cloud/pull/56)；候选 `408608c` 完整检查：1,710 通过、6 跳过、0 失败。独立真实 Gateway 资源图与 Chrome 竞态检查 12 项通过；合并 `f8fc7bb` 的源码树与候选一致。 |
| 6 · #46 代码候选 | 固定 OpenAI Responses 通道、版本化服务端配置、持久金额预算与未知计费保留；离线有界评估清单 | [PR #57](https://github.com/jihegao/riffology-cloud/pull/57)；候选 `001b317` 完整检查：1,738 通过、6 跳过、0 失败。独立代码评审、实际 Workerd 双预算故障窗口与 Pi SDK 协议检查通过；合并 `2b967da` 的源码树与候选一致。通道默认关闭，未完成真实供应商验收。 |
| 7a · #37 按需启动 | 首次工具才启动 Project；无工具对话复用冻结文件，持久一次性准备与取消；销毁不重新启动容器 | [PR #58](https://github.com/jihegao/riffology-cloud/pull/58)；代码 `4a67f28` 完整检查：1,748 通过、6 跳过、0 失败；最终 `dc8fa3c` 仅补证据与文档。独立实际 Workerd 评审及本地原生 CRUD/恢复通过，合并 `98b6453` 源码树与最终候选一致。默认关闭，Workspace 复用单独交付。 |

所有完整检查均在独立工作树执行。本仓库这些 PR 未报告 GitHub CI checks；上表是实际本地检查结果。新增工作树首次运行 #29、#32 完整检查时，因缺少测试所需 `.local` 目录失败，创建目录后完整复跑通过。#32 定向检查还暴露既有 Session 选择测试的就绪竞态：改为等待已恢复的选项后断言原选中值，不改变产品行为，最终完整复跑通过。

#45 在评审中修复了 Gateway 未放行新模块、停止后晚到请求恢复旧 iframe、提交后旧轮询覆盖新 Run、Files/Diff 旧响应覆盖新版本及历史选择改变 Stop 目标的问题。较早候选的通过记录或中断检查不替代上表最终候选的全检。

## 待交付批次（2026-09-14 状态快照）

以下候选不计入已合并批次；后续修复、原生复跑和 PR 状态须由主控补充最终记录。

### 7b · #37 同 Workspace 安全复用

[PR #59](https://github.com/jihegao/riffology-cloud/pull/59) 仍为 draft。候选实现和本地协议测试不等于原生验收通过：首次真实 Sandbox SDK / Linux 10-Turn 验收在第一 Turn 失败，尚未完成 10 Turn，也未合并。

- Workerd 组合候选 `dcdeec82` 与测试提交 `330812a` 源码树一致；实际 Workspace、Runtime、SQLite、D1、R2、三份操作账本与容量账本的 16 项检查全部通过，0 跳过、0 失败。覆盖 checkpoint 提交响应丢失但 Journal 未保存、handoff 响应丢失、旧能力拒绝、未结算操作阻止复用、双域部分释放与 FIFO，以及 configure、写入、pair.bind 的迟到或未知响应。此处 native façade 是可注入故障的测试替身，不证明 Linux 隔离或真实 10-Turn 运行。日志：`/tmp/riffology-warm-workerd-16-final.log`。
- 首轮原生失败源码为 `9df08b6`，使用镜像 `riffology-m2-trusted-pi-provider-disabled:18c0d8e55137`。Pi 启动后退出码为 1，未产生预期事件，Turn 实际为 `failed` 而非 `completed`。日志：`/tmp/riffology-runtime-reuse-native-ten-turns.log`；原始证据目录：`/Users/gaojihe/apps/riffology-cloud-runtime-reuse/docs/evidence/runs/m2-runtime-reuse-lazy-crud-fixture-20260914094821838`。该次记录显示 `sourceStable: true`、`externalWorkerFetches: 0`；失败记录不得被后续通过结果覆盖。
- 独立本地网络诊断使用同一镜像与实际 SDK 拦截 HTTPS，只返回受控的空 research context。root 与 UID 10002 继承证书环境时均返回 200；采用 supervisor 的最小环境时均报 `SELF_SIGNED_CERT_IN_CHAIN`。继承环境中的 `NODE_EXTRA_CA_CERTS` 指向 `/etc/cloudflare/certs/cloudflare-containers-ca.crt`；SDK 写入的控制文件为 root 所有、0644，四种组合均可读取。这将故障定位到最小环境丢失拦截 CA 信任，不能据此宣称产品 Turn 已修复。诊断 JSON：`/tmp/riffology-native-first-turn-ca-diagnosis.json`；日志：`/tmp/riffology-sandbox-tls-probe-esm.log`。
- 独立非 root Pi SDK 初始化探针完成真实 Session、4 次本地读取及 2 次受控 provider 调用，无付费调用；它仅排除该初始化路径，不能替代完整 Turn。日志：`/tmp/riffology-pi-nonroot-sdk-diagnostic-stdin.log`。诊断 actor 已由 SDK 销毁，剩余代理容器由主控清理；这些清理不构成产品 Turn 的容量释放证明。

上述 `/tmp` 日志和工作树证据路径是本机诊断位置，尚非本交付文档提交内的永久归档。仍需完成证书修复评审、修复后完整原生 10-Turn 与释放证据、最终候选验证及 PR 合并；不得用 Workerd 替身测试或独立网络探针替代这些退出条件。

### 8 · #35 官方模型晋升

候选 `9d91312` 已在独立 publication 工作树整合冻结的 #37 C 候选 `dcdeec82`，但尚未运行该组合候选的完整 `npm run check`，也未合并。交付顺序仍为 #37 完成后再合并 #35。

- `npm run typecheck` 通过；readiness、冻结产物、Catalog 审核、Gateway 与实际 Workspace/Python 发布后独立目录运行共 16 项通过；真实 Gateway 静态资源图 1 项通过；Chrome 发布恢复与双栏布局 14 项通过。合计 31 项定向检查通过，0 跳过、0 失败。
- 对应日志为 `/tmp/riffology-publication-C-core.log`、`/tmp/riffology-publication-C-assets.log`、`/tmp/riffology-publication-C-browser.log`。这些是本地验证，未执行线上发布或真实供应商调用。
- 普通用户提交冻结当前模型及完整研究历史供管理员审核；私有研究包仅 owner/operator 授权读取，公共 catalog 只包含审定模型内容。管理员权限由服务端 Catalog 核验；审批响应丢失后保留原身份恢复，不因候选已发布或翻页而丢失重试入口。

仍需整合 #37 最终主线、运行完整检查、最终评审及合并。前三个模型从真实普通用户路径创建、审核发布并验证复制后独立运行的验收尚未完成；本地 fixture 不能充当这三项真实交付。

## 已建立的接口与保护

- [Model 接口](model-spec.md)与[实验分组接口](experiment-groups-api.md)保留历史单次 Run；研究分组在其上建立关联，不修改历史身份。分组先持久化全部子 Run 计划，再有界准入；上一执行终态不替代实际容量释放证明。
- [证据契约](evidence-bound-conclusions.md)校验冻结源文件、Spec、Run 输入与结果产物。Agent 解释、用户内容和模型假设与数值证据分开呈现。否定记录单独持久化，保留原始结果和执行完成状态。
- 页面重新进入只读取已有状态。未知实验提交保留原请求身份；生成证据或导出不授权重新运行实验。
- [导出契约](research-export.md)选择完整持久历史，核验原始源文件与结果摘要，超限或完整性不符时明确失败。独立 Python 环境实际重放了种子参考模型的数值和 CSV 摘要；Workerd 中实际 Workspace/Gateway/D1/RevisionStore/R2 接口导出的包也已离线重放，导出前后实验数量和调度状态未变。
- [工作台](workspace-research-layout.md)复用同一组持久面板；界面偏好不构成运行身份。真实 Gateway 入口检查覆盖静态资源白名单，浏览器拦截式场景只作为 UI 证据。
- [生产通道](production-model-path.md)在原 token 预算之外保存全局金额约束；响应丢失、取消及缺失计费记录保留预留，不能自动重试或按超时释放。真实账号、默认模型、价格与隐私核验、Gateway 单次请求证明以及普通用户任务评估仍待完成。

- [按需启动](lazy-project-runtime.md)原生记录核对了无工具对话零 Project 调用、21 次文件工具操作、4 次恢复读取、每 Turn 一次准备及 Workerd 重开后的保存身份。CRUD 使用本地 vertical 镜像与临时 8 GiB Docker VM；不替代生产内核隔离或线上验收。临时 VM 内存已恢复原 4 GiB，配置文件摘要和 Docker context 均核对一致。

前四批的**代码与本地集成验证已完成**。上述参考模型与浏览器场景属于本地测试；不能据此把下述完整普通用户线上阶段标为签收。

## 完整研究闭环验收门槛

代码与本地组件测试不能替代一个普通用户项目贯穿全流程的验收。阶段完成仍需逐项记录：

- 普通用户建模、检查假设、基线与干预、多种子重复；逐个核对 UI、持久状态和真实结果产物。
- 追问数值证据，验证精确 Experiment/Run/指标来源；部分失败、取消、被否定模型不混入有效结论。
- 结构修改后旧结果保持标记；刷新继续不重复执行；提交响应丢失后沿原身份恢复。
- 从保存的冻结版本导出，独立环境重放参考实验，并对照记录的数值容差和输出摘要。

本轮尚未部署这些合并、切换线上门禁或运行新的付费供应商验收。原[第一阶段签收](phase1-user-preview-acceptance.md)不构成新增研究能力的线上验收。#28 Epic 与仍有下游或线上验收要求的 issues 保持开放。
