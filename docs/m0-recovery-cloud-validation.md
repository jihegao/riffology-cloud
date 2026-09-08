# M0 云中断与恢复验证

更新：2026-09-06。[G0-T08 已正式签收](evidence/runs/m0-g0-t08-cloud-20260906/G0-T08-gate-summary.json)，[当前 G0 进度为 9/10](evidence/runs/m0-g0-progress-live-20260906/progress.json)。本次使用真实 Pi SDK 与容器内固定 SSE provider，没有调用 Go；结论覆盖原 T08 固定恢复原语，生产 durable Turn 和整个 M0 仍待完成；真实供应商 T01 已另行[签收](m0-pi-live-cloud-validation.md)。

## 三组实际云验证

[最终矩阵](evidence/runs/m0-recovery-cloud-1788674001745-a5f7ad/summary.json)三场景均通过，共 76 次请求、130.153 秒、192,966 bytes 应用读取响应。业务顺序执行，最大一个活跃业务实例，共五次运行时生命周期；一条 GET 超时后有界重试，没有未知写操作重放。

| 场景 | 实际观察 | 结论 |
|---|---|---|
| [浏览器关闭](evidence/runs/m0-recovery-cloud-1788674001745-a5f7ad/disconnect.json) | Chrome 页面及浏览器于 05:53:31.605 UTC 关闭，后续独立 GET 仍显示 ready-wait；回合于 05:53:51.674 UTC 完成 | 浏览器连接只观察，关闭后 DO alarm 继续推进 |
| [杀 Pi](evidence/runs/m0-recovery-cloud-1788674001745-a5f7ad/process.json) | 首个流式文本后 2,395 ms 确认故障；此前 process running、runtime streaming 且 final 不存在；SDK kill 后状态 killed | 进入 interrupted；新 g2 物理 Sandbox 从已提交的同一 seed Session 恢复，只有一次新 fixture 请求 |
| [销毁容器](evidence/runs/m0-recovery-cloud-1788674001745-a5f7ad/container.json) | 首个流式文本后 2,407 ms 确认 destroy；此前仍 running / streaming，final 不存在 | 进入 interrupted；新 g2 物理 Sandbox 恢复已确认上下文，只有一次新 fixture 请求 |

两个故障场景在恢复前后各验证一次旧 generation 事件与 Authority 保存写入，四次均精确返回 `409 / stale-generation`。请求使用当前合法 phase，独立回读确认当前状态、保存指针和收据事件不变。SSE 游标重放亦与持久事件一致。

信号证据有明确边界：安装的 Sandbox SDK 忽略 `killProcess` 的 signal 参数，回执中的 `SIGKILL` 只代表请求意图。本次证明 SDK kill 后进程为 killed，未独立证明具体 OS 信号；这满足原文“杀 Pi”，不扩写为 SIGKILL 已验证。

## 部署与收尾

Worker `riffology-m0-recovery-staging` 当前版本为 `5fef2b3a-a064-4162-b1c3-6b0ce25c098d`，[部署回执](evidence/runs/m0-recovery-prearmed-deploy-20260906/deploy-result.json)及[运行后版本](evidence/runs/m0-recovery-prearmed-deploy-20260906/deployments-final.json)确认 100% 流量。bundle SHA 为 `a43b5e8ab4bc2d1ad05130d870cc8284f3f55c0e52023dc2a244c52ed0b066f3`，运行源码、驱动与检查摘要绑定于[冻结清单](evidence/runs/m0-recovery-prearmed-deploy-20260906/deployment-verified.json)。

[应用](evidence/runs/m0-recovery-prearmed-deploy-20260906/apps-final.json) `a036b418-dcce-4d2f-bd3d-6debf982ea6f` 为 ready、basic/max 2，沿用已批准的可信镜像 digest，没有新镜像发布。[绑定](evidence/runs/m0-recovery-prearmed-deploy-20260906/settings-final.json)为协调者 namespace `a682f665b7004214bc5a27ef24b231b7`、Sandbox namespace `e17c13abe5474cd0bbb673c6ce58a2a0` 及私有 R2 bucket。独立操作员凭据只保存在本机 0600 文件并注入 Worker，未进入镜像或项目运行时。

三个运行均 closed、无待定 effect、destroy 已确认；[最终实例查询](evidence/runs/m0-recovery-prearmed-deploy-20260906/instances-final.json)的七条历史记录全部 inactive，包含最终运行的五次生命周期和前轮的两次。R2 checkpoint 与 DO 审计记录保留，实例 inactive 不表示持久存储已删除。实际云账单待对账；应用读取字节不代表全部网络流量或费用。

[最新完整检查](evidence/runs/m0-local-20260906055058440/local-checks.json)为 232 pass、1 skip、0 fail，检查期间源码稳定；[主控复核](evidence/runs/m0-recovery-prearmed-deploy-20260906/primary-review.json)与[独立复核](evidence/runs/m0-recovery-prearmed-deploy-20260906/independent-review.json)完成后才签收。主控记录中的 pending 字段保留当时状态，最终决定以正式门禁记录为准。

## 修复与失败记录

清理未初始化运行也保存关闭标记，迟到 accept 不得创建实例。每个 SDK / R2 操作在派发前持久保存意图，单操作等待最多 45 秒并受回合期限限制；超时停止后续调用，实际操作结束后才处理旧实例清理。DO 重启后若只剩未知操作意图，明确进入 interrupted / cleanup_not_confirmed，等待独立核对，不自动重放未知操作。

首次部署网络失败后，[独立核对](evidence/runs/m0-recovery-deploy-20260906/first-failure-reconciliation.json)确认 Worker 与应用均未创建，才重试成功至版本 `612a2e93-04cd-4184-a803-bee0a47e0f3a`。该历史部署已由当前版本替代。

[首轮云驱动](evidence/runs/m0-recovery-cloud-1788672864378-3927b0/summary.json)在 Chrome 直连导航阶段失败，未 accept、未分配 VM。[网络诊断](evidence/runs/m0-recovery-deploy-20260906/browser-network.json)确认配置现有无凭据本机 HTTP 代理后可获得预期 401；驱动只允许这种 loopback 代理配置。

[第二轮](evidence/runs/m0-recovery-cloud-1788673108798-b7dc68/summary.json)浏览器场景通过，但外部 kill POST 未收到响应，不能证明命中短流窗口；该进程场景保留失败，完成清理后停止。当前版本把固定故障计划与 accept 一起持久保存，由 alarm 在实际 streaming 后触发，故障确认仍必须命中真实 12 秒窗口。不同计划不能覆盖已有运行，旧代与已消费计划不能再次触发；这是改变故障派发位置，未放宽故障或恢复断言。

三轮驱动共记录 188 次请求，另有两次未授权浏览器导航诊断；部署和 API 查询另计。两轮失败证据均保持原状态，没有用最终成功覆盖它们。
