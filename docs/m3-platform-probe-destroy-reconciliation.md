# Issue #21：探针 destroy 传输失败的有界对账

2026-09-13 的受控重试在 `release-a` 收到 HTTP 响应前报 `fetch failed`。A 已确认启动，清理阶段随后取得 A 的连续 absent 证明，B 从未启动，临时 Worker 删除和主路由回退均确认。原始记录见 [release-result.json](evidence/runs/issues-1-6-21-20260913T031957554Z-7de0e641/release-result.json) 和 [gate-close.json](evidence/runs/issues-1-6-21-20260913T031957554Z-7de0e641/gate-close.json)。三个证据文件的 SHA256 本次复验通过。

代码中的直接问题是正常探针路径把一次 destroy 传输异常当作终局失败，未进入已有的连续释放观察；清理路径却能容忍暂时失败。现有证据不能确定原请求是否已执行，也不能定位断连发生在客户端、代理、边缘路由还是 RPC 链路。清理成功不等于原请求成功，也不证明顺序容量问题已解决。

## 本地修复

实现位于 [trusted-pi-platform-probe.mjs](../scripts/m3/trusted-pi-platform-probe.mjs)，仅调整探针客户端的请求分类与释放观察，不修改线上配置或用户 Turn 执行路径。

| 条件 | 验收路径行为 |
| --- | --- |
| destroy 在 HTTP 响应前发生已识别的网络错误或超时 | 内部状态记为 `unknown`；预算允许时继续读取精确 actor 的外部实例状态；重置连续 absent 窗口，退避后重发同一 destroy |
| destroy 收到非成功 HTTP、无效 JSON、非布尔 running、响应正文读取失败，或无法归类的请求错误 | 记录错误后阻断验收，进入独立清理；不在验收路径重试 |
| 内部 `running=false` 且外部精确实例不存在或 `inactive` | 开始或继续连续 absent 窗口；外部 `stopped` 不算释放确认 |
| 任一路为 running、unknown 或其他未释放状态 | 重置窗口；不生成 stop proof |
| 两路连续 absent 达到 30 秒，且观察仍在期限内 | A 才能生成 stop proof 并允许 B 启动；B 使用同一释放规则 |
| 传输重试耗尽或观察期限结束 | 保持 blocked，B 不得越过未完成的 A 释放证明；执行已有清理与 gate 关闭流程 |

每个 actor 最多容忍 3 次连续、需要重试的传输失败，第 4 次返回 `platform-probe-destroy-transport-retries-exhausted`；中间取得已确认 destroy 响应后，连续失败计数归零。释放阶段每个 actor 沿用 10 分钟总期限，最多 120 次观察；单次 destroy 默认 30 秒，请求、外部读取和退避均受剩余期限约束。传输重试延迟取轮询间隔与 1/2/4 秒退避的较大值；默认轮询为 5 秒。期限或观察次数耗尽返回 `platform-probe-release-deadline`。

重试固定使用原来的 URL、capability、actor 和完整 identity（scope、session、turn、dispatch、generation）。服务端已有 `TrustedPiSandbox.#assertActor` 和 `TurnSandboxFence.fence`：先校验身份并持久关闭启动入口，再串行销毁和读取原生 running 状态。客户端不会生成新 actor、重放 start，或将外部 absent 单独当作成功证明。

成功和失败结果都保存 `destroyAttempts`、`destroyPolicy`、A/B 的内外观察序列与阶段 timeline。尝试记录包含 actor、次数、时间、耗时、有效超时、结果分类、delivery、HTTP 错误状态和白名单 transport code；不记录 capability、原始异常正文或请求头。`httpStatus=null` 表示该尝试记录未保存 HTTP 状态，须结合 classification 解读。清理记录独立保留，不能替代验收证明。

## 验证与线上验收边界

本地故障注入覆盖执行前断连、执行后丢响应、超时、quiet 窗口中途断连、B 释放重试、连续重试耗尽、成功响应重置连续失败预算、HTTP 403/404/409/500、错误正文、重定向、未知错误、deadline，以及 start 不重试和原有清理规则。云端故障模式通过临时 `ProbeFaultReceipt` Durable Object 的私有 `fetch` 协议，在 destroy 返回 `running=false` 后先持久保存回执，再延迟 HTTP 响应；客户端只有同时取得该服务端回执和后续连续 absent 证明才接受故障恢复结果。

本次验证：探针测试 39/39 通过；`npm run typecheck` 通过；Wrangler 4.129.0 对生成的双 Durable Object Worker 执行 `deploy --dry-run` 通过；`npm run test:m3` 全部 502 项通过（含上述探针测试）；`git diff --check` 通过。

2026-09-13 随后在 `M2_TURNS_ENABLED=false` 下执行了单独的 provider-free 平台探针。开始前先恢复更早遗留的 `e76b…` 探针：两个精确 actor 均取得 7 次内外 absent 观察，Worker 删除和主路由回退持续 31.7 秒，私有恢复文件随成功清理删除；证据见 [recovery.json](evidence/runs/issues-probe-recovery-20260913T034947036Z-7de0e641/recovery.json)。

新探针绑定主 Worker 版本 `8c895424-3253-45f1-aa22-14a016332d24` 和源 `7de0e6418b2e4066ef4fe0f791ff4e8c8ea48566`，A、B 均通过实际启动、内部 `running=false` 与外部 `inactive` 的连续释放观察。A 和 B 各记录 5 次已确认 destroy，没有发生 transport retry；A 释放证明先于 B 启动。临时 Worker 已删除，路由回退持续 32.7 秒，最终两个实例均为 `inactive`。完整结果见 [isolation-result.json](evidence/runs/issues-platform-probe-20260913T035202000Z-7de0e641/isolation-result.json)、[platform-probe.json](evidence/runs/issues-platform-probe-20260913T035202000Z-7de0e641/platform-probe.json) 和 [final-inventory.json](evidence/runs/issues-platform-probe-20260913T035202000Z-7de0e641/final-inventory.json)。最终再次读回 gate 为 false；未提交用户 Turn、未调用模型、未修改主 Worker 部署。

完整发布预检仍报告两项预期阻断：工作树包含尚未提交的探针修复，不能满足 exact-SHA clean-worktree 发布条件；本次 provider-free 运行没有传入模型供应商凭据文件。与隔离探针相关的 gate、dry-run、云资源、镜像、迁移、DNS 和 TLS 检查均通过。详见 [preflight.json](evidence/runs/issues-platform-probe-20260913T035202000Z-7de0e641/preflight.json)。

随后执行了带服务端回执的受控云端故障注入。中间两次未形成有效证明：一次暴露 receipt 类未继承 Cloudflare `DurableObject` 导致 HTTP 500，修正为私有 `stub.fetch()` 后，另一次在 destroy 前因单次 start 180 秒未获确认而安全终止；两次 cleanup 均通过，B 均未启动，证据分别保存在 [HTTP 500 运行](evidence/runs/issues-platform-probe-fault-receipt-20260913T043652Z-7de0e641/platform-probe.json) 和 [start 超时运行](evidence/runs/issues-platform-probe-fault-receipt-20260913T044710Z-7de0e641/platform-probe.json)，对应目录均包含独立关闭清单与 SHA256SUMS。

最终运行在一次性 start 等待窗口扩至 300 秒、仍不重放 start 的条件下通过。A 的首个注入 destroy 先在服务端记录 `running=false` receipt，再因 45 秒响应延迟于客户端 30.007 秒超时，记录为 delivery unknown；第 2 次同身份 destroy 在 856 毫秒内明确返回 absent。之后 A 又遇到连续 2 次自然 `UND_ERR_CONNECT_TIMEOUT`，B 遇到 2 次分散的同类错误，已确认响应会重置连续失败预算，两者仍分别完成新的连续 absent 窗口，且 A 的 stop proof 先于 B 启动。完整结果见 [platform-probe.json](evidence/runs/issues-platform-probe-fault-receipt-20260913T045648Z-7de0e641/platform-probe.json) 和 [isolation-result.json](evidence/runs/issues-platform-probe-fault-receipt-20260913T045648Z-7de0e641/isolation-result.json)。

独立收尾核验确认两个 actor 均为 `inactive`，临时 Worker 不存在，随机路由回退到主 Worker 的 JSON 404，恢复目录为空；主 Worker 仍是版本 `8c895424-3253-45f1-aa22-14a016332d24`、源 `7de0e6418b2e4066ef4fe0f791ff4e8c8ea48566`，`M2_TURNS_ENABLED=false`。详见 [final-inventory.json](evidence/runs/issues-platform-probe-fault-receipt-20260913T045648Z-7de0e641/final-inventory.json) 和 [gate-after.json](evidence/runs/issues-platform-probe-fault-receipt-20260913T045648Z-7de0e641/gate-after.json)，目录内全部 JSON 的 SHA256 已验证，权限为 0600。该结果证明 destroy 的“服务端已执行、响应丢失、同身份有界对账恢复”分支可在实际云端成立。它仍未重新验收用户 Turn 的顺序可靠性，也没有打开 Turn gate，因此 Issue #21 保持开放；下一阶段应先形成可审查提交，再单独授权用户 Turn 验收窗口。
