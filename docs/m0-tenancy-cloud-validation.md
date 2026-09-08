# M0 多租户云验证

2026-09-06，[G0-T04 已签收](evidence/runs/m0-g0-t04-cloud-20260906/G0-T04-gate-summary.json)。本次证明固定合成 Workspace / Artifact 在真实 R2 与 SQLite Durable Object 上的并发读写和权限隔离原语；生产身份、项目生命周期和完整 Workspace 仍按 M1–M5 验收。

Worker `riffology-m0-tenancy-staging` 当前版本为 `00f869d8-8229-42d8-83e1-cb661f5cadfb`。[部署与源码](evidence/runs/m0-tenancy-cleanup-20260906/deployment-verified.json)绑定运行代码、配置与驱动摘要；[运行后版本查询](evidence/runs/m0-tenancy-cleanup-20260906/deployments-final.json)确认同版本承接全部流量。现有 SQLite namespace 为 `72efcc4896bc4a1396eaf76e3bdc3a32`，使用私有 `riffology-m0-checkpoints-staging` bucket，不启动 Container。

[完整矩阵](evidence/runs/m0-tenancy-cloud-1788669993268-0899e615/tenancy-cloud.json)完成 87 个业务请求和两路并发。alpha / bravo 各有 Workspace 与 Artifact；两轮写入从 revision 1 到 3，每轮从实际 R2 对象回读摘要，并与 SQLite 及固定内容核对。随后分别互换 tenant、run、kind、对象 ID、服务路径和 Artifact，测试 GET / POST，再测试追加签名段、过期凭据、缺失凭据及仅携带操作员凭据的请求。跨归属请求得到 401 或 403，攻击后的 owner revision / digest 未改变。服务端在分配 DO 前核验 capability。

首次清理成功删除四个固定 R2 对象、回读剩余 0，并删除资源表行。八条持有原有效 capability 的 GET / POST 均返回 `403 run-closed`。第 97 次幂等清理检查在 15 秒内没有收到响应，**原驱动 `passed=false` 保留**。其后一次[独立有界清理核对](evidence/runs/m0-tenancy-cleanup-20260906/final-cleanup-reconciliation.json)收到 200，结果与首次清理完全一致。签收依赖这组组合证据，不代表整轮请求没有传输故障。[主控检查](evidence/runs/m0-tenancy-cleanup-20260906/primary-review.json)和[独立复核](evidence/runs/m0-tenancy-cleanup-20260906/independent-review.json)明确记录此限制。

早期两轮因写入或读取传输失败而停止，均完成清理；[第三轮](evidence/runs/m0-tenancy-cloud-1788669563507-2719970e/tenancy-cloud.json)暴露初始化未到达时清理返回 502 的缺陷。修复后，即使运行未初始化，也先持久保存关闭标记，再删除固定资源，阻止迟到初始化创建新资源。[六请求云回归](evidence/runs/m0-tenancy-cleanup-20260906/reconciliation.json)覆盖该旧运行和一个全新空运行：清理、拒绝初始化、再次清理均符合预期。关闭标记会保留，不能把响应中的清理枚举解释成全部 SQLite 数据已删除。

四轮矩阵共 150 次请求，另有 6 次清理回归及 1 次最终清理核对；部署/API 查询另计。最终矩阵耗时 66.619 秒，收到 11,474 bytes，未使用 GET 重试额度。所有业务写入结果未知时均未重放。只读传输重试最多三次，总请求上限 100，业务期限 90 秒，清理期限 30 秒；单次请求最长 15 秒。没有新增模型调用或 VM 启动，实际账单仍须另行核对。

[T04 当轮本地全检](evidence/runs/m0-local-20260906044103630/local-checks.json)为 213 pass、1 skip、0 fail，源码在检查及最终云矩阵期间保持一致。当前[跨运行 G0 进度](evidence/runs/m0-g0-progress-live-20260906/progress.json)为 9/10，仍未形成完整共同发布候选。
