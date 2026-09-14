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

所有完整检查均在独立工作树执行。本仓库这些 PR 未报告 GitHub CI checks；上表是实际本地检查结果。新增工作树首次运行 #29、#32 完整检查时，因缺少测试所需 `.local` 目录失败，创建目录后完整复跑通过。#32 定向检查还暴露既有 Session 选择测试的就绪竞态：改为等待已恢复的选项后断言原选中值，不改变产品行为，最终完整复跑通过。

#45 在评审中修复了 Gateway 未放行新模块、停止后晚到请求恢复旧 iframe、提交后旧轮询覆盖新 Run、Files/Diff 旧响应覆盖新版本及历史选择改变 Stop 目标的问题。较早候选的通过记录或中断检查不替代上表最终候选的全检。

## 已建立的接口与保护

- [Model 接口](model-spec.md)与[实验分组接口](experiment-groups-api.md)保留历史单次 Run；研究分组在其上建立关联，不修改历史身份。分组先持久化全部子 Run 计划，再有界准入；上一执行终态不替代实际容量释放证明。
- [证据契约](evidence-bound-conclusions.md)校验冻结源文件、Spec、Run 输入与结果产物。Agent 解释、用户内容和模型假设与数值证据分开呈现。否定记录单独持久化，保留原始结果和执行完成状态。
- 页面重新进入只读取已有状态。未知实验提交保留原请求身份；生成证据或导出不授权重新运行实验。
- [导出契约](research-export.md)选择完整持久历史，核验原始源文件与结果摘要，超限或完整性不符时明确失败。独立 Python 环境实际重放了种子参考模型的数值和 CSV 摘要；Workerd 中实际 Workspace/Gateway/D1/RevisionStore/R2 接口导出的包也已离线重放，导出前后实验数量和调度状态未变。
- [工作台](workspace-research-layout.md)复用同一组持久面板；界面偏好不构成运行身份。真实 Gateway 入口检查覆盖静态资源白名单，浏览器拦截式场景只作为 UI 证据。
- [生产通道](production-model-path.md)在原 token 预算之外保存全局金额约束；响应丢失、取消及缺失计费记录保留预留，不能自动重试或按超时释放。真实账号、默认模型、价格与隐私核验、Gateway 单次请求证明以及普通用户任务评估仍待完成。

前四批的**代码与本地集成验证已完成**。上述参考模型与浏览器场景属于本地测试；不能据此把下述完整普通用户线上阶段标为签收。

## 完整研究闭环验收门槛

代码与本地组件测试不能替代一个普通用户项目贯穿全流程的验收。阶段完成仍需逐项记录：

- 普通用户建模、检查假设、基线与干预、多种子重复；逐个核对 UI、持久状态和真实结果产物。
- 追问数值证据，验证精确 Experiment/Run/指标来源；部分失败、取消、被否定模型不混入有效结论。
- 结构修改后旧结果保持标记；刷新继续不重复执行；提交响应丢失后沿原身份恢复。
- 从保存的冻结版本导出，独立环境重放参考实验，并对照记录的数值容差和输出摘要。

本轮尚未部署这些合并、切换线上门禁或运行新的付费供应商验收。原[第一阶段签收](phase1-user-preview-acceptance.md)不构成新增研究能力的线上验收。#28 Epic 与仍有下游或线上验收要求的 issues 保持开放。
