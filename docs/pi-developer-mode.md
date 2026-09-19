# Pi 开发者模式与测试

## 发布状态（2026-09-20）

实现为现有测试账号提供 Pi 执行路径及独立、持久的费用观察账本。恢复验收使用 schema v2 的项目专属策略，持久执行 `maxTurns`、`maxCalls`、`maxNanodollars`、单次调用时限和绝对过期时间；同时保留单轮运行边界、身份校验、并发控制、取消与资源释放检查。

**#87 的有界线上验收已经完成；验收结束后 Agent 执行入口重新关闭。** PR #102 增加了不可伪造、追加式的执行隔离证明和持久 runtime tombstone。线上通过 Workspace 权威路径逐条证明 1 条 legacy OpenCode Go 与 6 条 G5 历史请求均为 `runtime-released`，并验证证明前后完整模型记录摘要不变。旧执行主体不能继续消费模型结果、调用工具、写项目或自动重试。

全部七条历史 usage、费用和原预留仍保持原值并继续标记待核对；没有清零、退款、结算、重试或重放。逐笔供应商账单核对由独立 P1 #101 承接，不再占用 #87 核心流程恢复的关键路径。

上述核对没有调用付费模型，没有清理、重置、结算、重试或重放历史记录。临时只读 Worker 已删除。

验收使用一个新建普通项目和 schema v2 的项目专属策略，只人工提交一次 Turn。Pi 实际生成并保存 Python 模型、Revision 和预览包；在浏览器中把 `service_rate` 从 `1.0` 改为 `1.2`、把 seed 从 `42` 改为 `43` 后，本地预览可运行，刷新后参数和继续输入能力保留。下载同一预览包复跑的最终结果从 `served=164, average_wait≈6.2114` 变为 `served=161, average_wait≈0.6938`。这只证明本地 Preview 和方法方向具有演示价值，不是 Verified Experiment/Evidence，也不是经过校准的业务结论。

本次 Turn 使用 8/8 个冻结的 provider dispatch、无自动重试或 fallback；因此没有提交第二个 Turn。结束时 Turn 为 `completed/saved`，Workspace 无 active Turn、release/recovery hold，五类容器应用均为 inactive。随后三个临时执行开关全部关闭，G5/M3/M4 始终保持关闭。

## 行为与边界

- `PI_DEVELOPER_POLICY_JSON` 严格限定一个 tenant/user，必须显式启用；私有 `PI_DEVELOPER_BUDGET` 绑定负责开发者 token 与费用观察记录。
- 新项目默认使用 Pi；已持久绑定 Managed 的项目保留 Managed。历史 G5 项目/回合不能被重新解释为开发者任务。
- Workspace 在提交时保存开发者标记。模型代理核对实际 Workspace 回合、身份、运行状态与取消状态，并在费用预留后再次核对。只有这个私有授权路径可以使用 `billingMode: observe`。
- 已完整接收 `response.completed` 或 `response.incomplete`，且有有效响应身份和匹配状态时，缺少 usage 只影响费用确认。原始预留金额与固定价格 profile 仍然保留，费用显示为未知而非零。
- 记录到的费用是按固定价格和 provider usage 计算的观察值，`invoiceVerified` 始终为 false，不是供应商账单结算。
- `execution-isolated` 与 `billing-pending` 是独立状态。只有能够证明旧调用已结束，或迟到结果已被可靠隔离于模型、工具、项目写入和重试路径，才满足执行恢复条件；HTTP 状态、deadline 经过或费用预留本身都不是隔离证明。
- 502/504、超时、断流、通用 provider failure、尚未结束且未隔离的调用继续阻止后续模型调用。限制覆盖账号所有开发者项目，并只读检查原 G4/G5 token 账本；新项目、policyId 或新账本不能绕过历史执行未知。已有可靠隔离证明但缺 usage 的记录保留 `billing-pending`，由独立 P1 对账处理，不再占用 P0 核心流程关键路径。
- 同一请求只能 dispatch 一次。持久化 ACK 丢失、服务重启或刷新页面不触发模型自动重试。费用投影从固定预留和持久终态生成，避免第二次写入丢失导致金额被错误清零。
- 原 G4/G5/Production Money 账本不迁移、不清零；历史窗口开关、Managed 策略、云端仿真/服务开关保持原值。

## 已完成的核心流程验收

1. 真实输入需求，Pi 创建单服务台 Queue Python 模型。
2. Turn 完成并保存 Revision；预览包与保存的文件摘要一致。
3. 本地预览运行基线参数，随后修改服务率和 seed 再运行。
4. 刷新页面，确认修改后的参数、模型、Revision 和继续输入能力保留。
5. 播放器从初始 frame 0 推进到后续帧；初始显示 `0/0` 不是最终指标。
6. 用下载的同一包直接复跑，核对基线与修改参数的最终指标。
7. 验收结束后确认运行主体 quiet/released，并恢复关闭全部执行门禁。

当前进入项目再次看到“当前环境暂停接收新任务”是验收后门禁关闭的预期状态，不代表已完成的有界验收失败。后续若要常态开放，必须作为新的发布决定明确身份、容量、费用与运行政策，不能沿用已过期的 #87 验收窗口。

## 维护与验证

主要回归覆盖：严格策略解析、Workspace 并发提交与重启、私有模型代理授权及中途撤销、缺失 usage 的完整 SSE 终态与畸形流、token/费用记录重启恢复、跨项目未知执行阻断、历史账本只读检查、G5 关闭时的 UI/提交一致性。原严格 provider 路径仍要求完整 usage。

私有 DO `snapshot(tenantId, identity)` 提供本轮 token 记录和费用观察值；它不是公共账单 API。部署时保留现有绑定、容器拓扑、secret 绑定与 observability，添加新 DO 导出/绑定和指定账号策略。执行开关的开放应以实际技术隔离证据为依据；历史逐笔 usage/billing 由独立 P1 对账跟踪，不能反向覆盖已经验证的执行安全事实。
