# G5 有界待核对费用规则（2026-09-19）

本次按用户“放宽费用结算要求，完成修改”的授权修改代码与验收口径。交付是本地实现与验证；没有部署、开启门禁、增加预算、修改历史账本或执行付费请求。

## 新的准入条件

费用核对与执行安全分开处理：

| 事实 | 新行为 |
| --- | --- |
| 请求成功且有可信 usage | 沿用冻结费率的保守费用估算，不等待最终 invoice。原实现已经支持这条路径。 |
| 请求有已持久化的终态和 provider request ID，但 usage 未知；金额保留完整最坏预留；工具无 active/pending/unknown | 已显式冻结 bounded-pending 策略时，Guard Call 记为 `billing-held`。不退款、不伪造 usage，不把原 Money unknown 或 Token pending 改成 recorded。 |
| 三个账本均关闭该 Turn 的新准入，所有未结项都能逐条归属到上述费用预留，工具无不确定执行 | Guard Turn 记为 `billing-held`，表示执行准入已关闭而费用待核对。剩余预算和未知风险限额内允许新的独立任务。 |
| 请求可能仍在执行、传输中断、超时、取消或缺少终态/请求 ID | 保持原执行阻断。工具状态不确定、身份不一致、未绑定创建、start ACK 未确认也不放宽。 |
| 未知请求数量或未知金额达到硬限 | 停止新任务。下一次调用的最坏预留会提前计入风险容量检查，不能先发请求再发现无容量。 |

当前生产 provider 对成功的 Responses 流仍要求有效终态和 usage；此修改不接受缺失 usage 的畸形成功流。最直接覆盖的是有终态/request ID 的 HTTP 拒绝，其费用仍未知。一次拒绝仍是失败任务，不会因此变成建模成功。

## 冻结配置

`G5_CONTROLLED_WINDOW_JSON` 新增可选 `billingPolicy`。未设置时保持旧行为，不存在隐式开启或默认额度。示例：

```json
{
  "billingPolicy": {
    "mode": "bounded-pending",
    "maxUnknownCalls": 3,
    "maxUnknownNanodollars": 1000000000
  }
}
```

示例代表最多 3 个未知请求、US$1 未知预留；它是配置示例，不是已写入生产的额度。数量必须为 1–32 的整数，金额必须为正整数且不超过当前窗口总预算。冻结 compiler 接收此字段，将它写入 A/B policy、关闭态 patch、脱敏 manifest 和整体摘要。没有改变 money period、总预算、单 Turn 预算、模型费率、调用次数、任务数或截止时间。

限额在全局 Guard 内按所有历史窗口累计，包含已有 unknown 记录及新的 billing-held 记录；切换 windowId 不清零。旧 rollover 隔离项也不能逃过新模式的未知风险限额。各账本原费用占用继续保留，不能把示例的 US$1 当作新增资金。

既有窗口政策不可变；不能给已开始的窗口直接补字段或抬高风险上限。历史 unknown 不会自动转换为 billing-held，也不自动获得新窗口授权。新模式需要新的、明确冻结的配置；当前线上历史阻断是否满足迁移条件仍须实际读回证据。

## 持久化与防重复

- Call 与 Turn 的新状态、证据摘要都在现有 SQLite 表中持久化，不增加 namespace，也不更改 G4。
- 分类只由私有 Guard 从固定 Token/Money/Tool actor 读取事实后进行；公网调用方不能提交“已安全结束”的布尔值来放行。
- Guard 和 Money 保留完整最坏预留；Token 保留原 pending 状态。分类不是退款或结算。
- 重启和分类/关闭回执丢失允许核对同一记录，不能重复 dispatch。原 Turn intent 不得换 key 再提交。
- `billing-held` 不能通过普通 `recordUsage` 覆盖为已结算。后续权威费用核对需要独立的对账流程；本次没有新增自动退款或账本修正入口。
- 暖环境复用仍按真实账本 pending 状态处理，可能选择销毁/冷恢复；本次没有降低资源释放或暖复用的安全要求。

## 运维与验收口径

原始 `tokenPending`、`moneyPending`、`moneyUnknown` 继续如实报告。新增的 billing 摘要记录全局未知数量/预留以及当前窗口中已确认属于费用核对的数量/预留。

`assessG5AState` 仅在冻结政策与权威摘要一致时，计算独立的 `executionUnknown`、`executionPending` 和 `billingLimitReached`。`safeForNewAdmission` 使用这些执行状态及原预算/时间边界；不把原始 unknown 计数改成零。该字段是运维判断，最终准入仍由服务端 Guard 执行。

私有 operator 新增只读 `billingSnapshot`，给出按 usage 估算费用、未知预留、逐调用索引和独立账单状态；未验证 invoice 不冒称已验证或零费用。

产品功能验收与计费完整性分开签收：

1. 产品验收仍须提供实际建模、保存、运行、回放及释放证据；允许附带受控费用待核对清单，HTTP 失败不能算成功样本。
2. 费用风险验收要求完整保守预留、两项未知上限、原资金上限和禁止重放生效。
3. 精确计费验收在权威费用确认前保持未完成。原严格 benchmark 的结算/账本证明接口继续表示“完整计费验收”，不将其返回值悄悄重定义为产品通过；严格 benchmark 失败与新的任务准入判断是不同结论。

## 验证

新增 SQLite 和真实本地 Workerd 用例覆盖：终态费用未知后的新 Turn、执行仍未知的阻断、工具 pending 拒绝、三账本关闭校验、完整费用保留、重启、ACK 丢失、原请求防重放、跨窗口累计、金额/数量上限、政策不可变，以及 freeze/operator 的新旧兼容。

验证结果：`npm run typecheck` 与 `git diff --check` 通过。G5 Guard、authority、Workspace、项目准入、模型代理及 freeze/operator/driver 的定向套件 157/157 通过；随后补充 operator HTTP 只读入口用例，并连同强化后的 Workerd 超时终态负例复测 7/7 通过。去重共 158 项，0 失败、0 跳过。

这些都是本地合成 fixture，未执行生产推理或生产账本迁移。

## 本轮独立工作树复核（2026-09-19）

候选从原 `codex/g5-bounded-unsettled` 的 14 个修改文件复制到
`codex/invited-queue-delivery`，原工作树保持原样。类型检查及 Guard、真实本地
Workerd、authority、freeze/operator/live-driver 的 74 项定向检查通过，0 跳过。
这次复核不将历史窗口补写为新政策，不开启任何生产门禁。
后续完整检查结果统一见 [本轮验证记录](invited-queue-delivery-validation.md)。
