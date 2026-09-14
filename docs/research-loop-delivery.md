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
| 7b · #37 同 Workspace 安全复用 | 长期双资源租约、逐 Turn 绑定、原生封存、三账本关闭及独立释放证明 | [PR #59](https://github.com/jihegao/riffology-cloud/pull/59)；最终候选 `ce0b6a0`，运行时代码 `7b6b053` 完整检查：1,850 通过、6 跳过、0 失败。真实本地原生 10-Turn 与独立容量账本评审通过；合并 `7611ec1`。默认关闭，未完成 Cloudflare 线上验收或受控延迟对照。 |
| 8 · #35 官方模型晋升 | 普通用户冻结提交、服务端管理员审核、不可变版本发布；私有审核包与公共模型分离 | [PR #60](https://github.com/jihegao/riffology-cloud/pull/60)；候选 `3e1bb35` 完整检查：1,869 通过、6 跳过、0 失败，独立评审签收。最终 `4ce6332` 仅整合 C 的证据文档，合并 `7569c08`。前三个真实普通用户模型仍待验收。 |

所有完整检查均在独立工作树执行。本仓库这些 PR 未报告 GitHub CI checks；上表是实际本地检查结果。新增工作树首次运行 #29、#32 完整检查时，因缺少测试所需 `.local` 目录失败，创建目录后完整复跑通过。#32 定向检查还暴露既有 Session 选择测试的就绪竞态：改为等待已恢复的选项后断言原选中值，不改变产品行为，最终完整复跑通过。

#45 在评审中修复了 Gateway 未放行新模块、停止后晚到请求恢复旧 iframe、提交后旧轮询覆盖新 Run、Files/Diff 旧响应覆盖新版本及历史选择改变 Stop 目标的问题。较早候选的通过记录或中断检查不替代上表最终候选的全检。

## 最终本地验收与失败记录

#37 的实际 Workerd 集成检查覆盖 checkpoint 已提交但 Journal 未保存、handoff 响应丢失、旧能力拒绝、三账本未结算操作阻止复用、双域部分释放与 FIFO，以及 configure、写入、pair.bind 的未知响应。其注入 native façade 的测试不替代原生验收。

[原生验收记录](runtime-reuse-native-acceptance.md)保留了首次失败、修复诊断与最终通过证据：

- 首次 `9df08b6` 在第一 Turn 的 Pi 初始化失败，未完成 10 Turn。[失败记录](evidence/runs/m2-runtime-reuse-lazy-crud-fixture-20260914094821838/primary-review.json)保留原结果；实际 SDK 的[独立 CA 诊断](evidence/runs/m2-runtime-reuse-lazy-crud-fixture-20260914100801472/ca-diagnosis.json)显示，root 与 UID 10002 继承平台证书时均返回 200，最小环境均报 `SELF_SIGNED_CERT_IN_CHAIN`，SDK 写入的 root 所有 0644 控制文件均可读取。修复仅接受经所有者、权限及非符号链接核验的固定平台 CA，不继承任意环境或关闭 TLS 校验。
- 最终 `7b6b053` 的[真实原生记录](evidence/runs/m2-runtime-reuse-lazy-crud-fixture-20260914100801472/primary-review.json)完成 10 个 saved Turn、2 个 Session，使用同一物理 Project/Pi pair，绑定 epoch 为 1–10。逐轮核对 R2 文件和 Session 摘要、新 Pi 进程身份，以及三账本 closed 且无 active/pending/unknown；保留已完成工具历史。该验收使用任务专属 x86_64 Linux VM 和生产 Sandbox 镜像，仅 provider transport 替换为确定性 fixture，无付费模型调用。
- 正常退休后双资源占用归零。[独立 SQLite 容量复核](evidence/runs/m2-runtime-reuse-lazy-crud-fixture-20260914100801472/capacity-release-review.json)显示，两域最终观察均晚于退休起点 363 秒，连续 absence 超过 361 秒，满足未缩短的 360 秒 assignment guard 与 30 秒 quiet interval。最终应急清理只删除两个本地代理容器，不作为产品容量释放证明。

#35 的[发布契约](model-publication.md)在实际本地 Workspace/Gateway/D1/RevisionStore/R2 测试中计算 Python 基线和干预结果、冻结审核 ZIP、重放并发布审定源码，再从独立目录运行。Chrome 核对 Model 入口、完整历史披露与管理员响应丢失恢复；这些使用本地身份与研究 fixture，不等同三个真实普通用户模型。

#35 最终全检前保留两次失败及修复：staging 预检的固定迁移清单遗漏 `0009_model_submissions.sql`，补入已审定迁移并保留未知迁移拒绝；预览测试仅等 iframe 可见便读取目标 Frame，改为等待真实导航及监听器就绪，旧、新 Frame 身份与迟到 ticket 拒绝断言不变。两项均经独立评审。最终完整检查日志为 `/tmp/riffology-publication-final-full-check-3.log`；前两轮分别保留于 `/tmp/riffology-publication-final-full-check.log` 和 `/tmp/riffology-publication-final-full-check-2.log`，这些路径为本机日志而非仓库永久归档。

[环境清理记录](evidence/runs/m2-runtime-reuse-lazy-crud-fixture-20260914100801472/environment-cleanup.json)确认任务 VM 已停止并删除，默认 Docker context 为 `colima`，默认配置 SHA-256 与验收前备份一致，原 4 GiB 配置保留，其他 profile 未改。主工作树原有 stash 与 untracked 内容保留。此次工作未部署、修改远程配置或执行付费供应商验收。

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

全部计划批次的代码现已按顺序合并，但以下交付要求仍待完成：

- 第 4 步完整研究闭环：按以上清单完成一个真实普通用户项目的线上 UI、持久状态和结果产物核对，并独立导出重放后记录阶段签收。
- #46：真实付费供应商、默认通道与模型、价格和隐私核验，以及普通用户建模任务评估；默认关闭的代码不能代表生产通道验收。
- #37：Cloudflare 真实运行验收及冷路径/复用路径的受控延迟对照；本地原生 10-Turn 通过不构成线上性能或一般可靠性结论。
- #35：前三个模型由普通用户从建模、实验、提交、审核到发布全程创建，并由新用户复制后独立运行；不得用仓库特制包或直接插入 catalog 的 fixture 替代。

本轮未部署这些合并或切换线上门禁。原[第一阶段签收](phase1-user-preview-acceptance.md)不构成新增研究能力的线上验收。全部 11 个 issues（#28、#29、#30、#31、#32、#33、#34、#35、#37、#45、#46）保持开放；完成上述对应验收后再逐项评定关闭。
