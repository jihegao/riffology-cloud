# Pi 开发者模式与测试

## 发布状态（2026-09-19）

实现为现有测试账号提供 Pi 执行路径及独立、持久的费用观察账本。恢复验收使用 schema v2 的项目专属策略，持久执行 `maxTurns`、`maxCalls`、`maxNanodollars`、单次调用时限和绝对过期时间；同时保留单轮运行边界、身份校验、并发控制、取消与资源释放检查。

**当前仍保持 Agent 执行入口暂停。** 发布前对线上原始 G5 token 账本进行了只读检查：同一测试账号有 4 条 `unknown / pending` 且没有 provider 终态的调用，还有 2 条 `failed / provider-failure / pending`，有 request ID 但用量未知。后续精确核对已独立确认这六条记录对应的 ProductTurnRuntime 全部 terminal/released，并将六个匹配 Workspace 的 `release-pending` hold 清除为 `releaseHold=null`；这证明旧运行时与写入者已释放，但不结算它们的 provider usage 或费用。

另有一条 legacy OpenCode Go `unknown / pending` 调用，目前只有 client request ID，尚未取得同等级的技术隔离证据。必须先证明它的迟到响应不能再被本地执行主体消费、不能调用工具或写项目、也不能由 alarm、队列、刷新、重启或客户端行为重新 dispatch，才可解除 P0 执行阻塞。全部七条历史 usage/费用继续保留为待核对，转入独立 P1 工作；逐笔供应商账单结论不是核心流程恢复的前置。

上述核对没有调用付费模型，没有清理、重置、结算、重试或重放历史记录。临时只读 Worker 已删除。

本地模型预览仍可使用。此前用户已报告 Queue、Mesa 预览能运行、修改参数影响预览、刷新后参数保留；这属于用户手动确认，不能替代新的 Agent 端到端验收，也不能证明云端 Experiment/Evidence 已通过。

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

## 当前可测试的步骤

1. 打开现有 Queue 或 Mesa 项目，进入“模型预览”，运行一次。
2. 修改一个可见参数，重新运行；确认结果相应变化。
3. 刷新页面；确认参数保留，预览仍能运行。
4. 回到项目列表，再进入同一个项目；确认模型与参数仍在。
5. 查看对话区：在第七条历史调用仍未取得隔离证明时，Pi Agent 入口应保持暂停。适用开发者模式的项目会显示“执行结果尚未确认”提示；刷新或新建项目不应解除阻断。不要为测试此状态发送或重复发送模型请求。

遇到问题，保留项目链接、步骤、可见错误文字和大致时间即可。

## 确认历史执行隔离后才执行的 Agent 验收

必须先对全部七条原始记录证明：旧执行已经结束，或迟到结果已被可靠隔离，不能继续触发模型消费、工具调用、项目写入或任何自动重试。不要把时间经过、HTTP 超时、费用预留、门禁关闭或新 policyId 当作隔离证明。六条 G5 记录已有 runtime/release-hold 证据；第七条 OpenCode Go 记录取得等价证据前不得放行。历史 usage/费用可以继续 `billing-pending`，不得清零、退款或伪造结算。

隔离成立后，冻结一个可复查的私有验收包：策略中的唯一测试身份和新建 blank 普通项目，固定 `openai/gpt-5.6-luna` 与已发布 profile；最多 3 次人工提交的 Agent Turn、全包最多 8 次 provider dispatch、单次最长 360 秒、30 分钟绝对窗口、新增保守费用上限 US$0.60，禁止自动重试与 provider fallback。schema v2 策略必须把项目、7 条隔离证明的 manifest、这些次数/费用/时间上限一并固定到持久准入层，而不是只写在操作说明里。之后才可单独启用 `M2_TURNS_ENABLED`、`M2_MODEL_PROVIDER_ENABLED`、`PRODUCTION_MODEL_ENABLED`；`G5_ADMISSION_ENABLED` 保持 false。开关状态不等于真实 Agent 验收。

随后使用同一测试账号新建“Pi 开发者验收”项目，按顺序操作：

1. 发一条请求：“创建一个简单的单服务台排队模型，提供到达率、服务率、随机种子参数和可运行的模型预览。”只发送一次；确认 Agent 实际读取并修改 Python 文件，而不是只返回说明。
2. 等待 Agent 明确结束、文件保存和 Revision 出现；确认预览来自该 Revision 且可以运行。
3. 在同一对话追加：“增加平均等待时间输出，保留现有参数。”确认基于原模型修改，生成新的可追溯 Revision，保存后可预览。
4. 不调用模型，改一个可见参数或 seed 并运行，刷新后再运行；确认结果随参数变化，参数、模型及 Revision 均保留。
5. 离开项目再返回，完成一次有界的小修改；确认历史对话、文件、保存 head 和预览来源一致，旧 Turn 没有恢复执行或重复写入。
6. 核对实际 provider dispatch 不超过冻结上限，没有自动重试或 fallback；验收结束后 Workspace、runtime、tool actor 和 capacity 均 quiet/released。
7. 若出现执行未确认、资源释放未确认或错误，立即停止后续请求、重新关闭门禁并保留原 identity 与项目链接。只缺费用但执行已经可信结束或隔离时，保留费用待核对，不应凭空填零，也不应重放原请求。

此验收由用户主动触发真实模型请求，产生正常 provider 费用。本次自动验证只使用合成 provider 响应与本地 Workerd/SQLite。

## 维护与验证

主要回归覆盖：严格策略解析、Workspace 并发提交与重启、私有模型代理授权及中途撤销、缺失 usage 的完整 SSE 终态与畸形流、token/费用记录重启恢复、跨项目未知执行阻断、历史账本只读检查、G5 关闭时的 UI/提交一致性。原严格 provider 路径仍要求完整 usage。

私有 DO `snapshot(tenantId, identity)` 提供本轮 token 记录和费用观察值；它不是公共账单 API。部署时保留现有绑定、容器拓扑、secret 绑定与 observability，添加新 DO 导出/绑定和指定账号策略。执行开关的开放应以实际技术隔离证据为依据；历史逐笔 usage/billing 由独立 P1 对账跟踪，不能反向覆盖已经验证的执行安全事实。
