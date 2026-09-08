# M0 云发布与回退验证

2026-09-06：**G0-T10 已签收**，见[正式门禁](evidence/runs/m0-g0-t10-cloud-20260906/G0-T10-gate-summary.json)及[共同候选复核](evidence/runs/m0-candidate-review-20260906/final-review.json)。使用独立 `riffology-m0-release-staging` Worker、单实例 Container application 和私有 R2 前缀；没有模型绑定或模型请求。旧 `riffology-demo` 及旧路由维持退役。

## 独立补验结果

2026-09-06 10:14 UTC，[completion 固定运行](evidence/runs/m0-release-completion-1788689659147/summary.json)通过：5 次监督器请求、7.390 秒、无模型派发，闭合且清理确认。新增独立 completion Worker 复用批准的 I1 镜像；原 release Worker 与其 Sandbox namespace 没有重新部署或重置。

原生 `ctx.container.monitor()` 观察到实际 entrypoint 退出码 42，原生 running=false、端口 readiness 被拒绝。退出结果在无参 destroy 之前持久化，清理后的回执与先前结果一致。这补齐启动失败取证，原 SDK 缓存状态无法确认退出的失败记录保持不变。

恢复经跨脚本绑定调用已回退的原 W1 `ReleaseSandbox`。新实例读取 v3 的已确认 R2 revision，initialize=2、increment=3、read=3，均非重放。新 checkpoint 使用独立前缀；[四次远端下载及摘要核对](evidence/runs/m0-release-completion-1788689659147/independent-cloud-verification.json)确认源 counter=2 未变化、新 counter=3 已保存。[发布后 API](evidence/runs/m0-release-completion-1788689659147/api-after.json)确认原 W1 version 与 app5/I1 未变；[实例 API](evidence/runs/m0-release-completion-1788689659147/instances-after.json)确认两个应用共七条实例记录均 inactive。

[全检](evidence/runs/m0-local-20260906100509505/local-checks.json)为 348 pass、1 skip、0 fail，187 个源文件摘要与部署和云运行一致。以下保留原三轮历史证据，不能把旧失败改成成功；总体签收已合并各阶段、两份独立审查与主控远端核对。

## 已执行的第一轮

固定运行 `release-g0-20260906` 的[基线](evidence/runs/m0-release-baseline-1788685542377/summary.json)、[兼容检查](evidence/runs/m0-release-compatibility-1788685624236/summary.json)和[活动任务](evidence/runs/m0-release-hold-1788685652291/summary.json)均成功。W1/I1 实际写入 counter=1 并保存 R2；W2 使用 `--containers-rollout none` 后仍读取同一 I1 实例。两个实际只读子进程分别返回未知协议和格式，控制器拒绝，counter 保持不变。

首次部署在 Worker 上传后网络失败，[回读](evidence/runs/m0-release-deploy-w1-1788685105667/after-failure-api.json)确认 Worker 已存在但 application 未创建。保留该失败记录后补全部署，未启动重复业务任务。

[镜像更新](evidence/runs/m0-release-deploy-w2-rollout-1788685658684/deploy.json)命令在 09:08:29 UTC 成功；初次 API 仍返回 I1，[收敛后回读](evidence/runs/m0-release-deploy-w2-rollout-1788685658684/api-converged.json)才确认 application version=2、I2。与此同时，探针的 180 秒阶段清理期限到达，[升级前置读取](evidence/runs/m0-release-upgrade-1788685843685/report-after.json)已 closed=true、cleanup=confirmed。升级恢复阶段没有 POST，因此没有执行 I2 恢复、启动失败或回退后写读，不能签收 T10。

[实际 Worker 回退](evidence/runs/m0-release-v1-worker-rollback-20260906/api.json)确认 W1 `cafb1c33-c559-4245-9fdf-707dd28120f0` 恢复 100% 流量，镜像仍为 I2。该记录说明 Worker 回退不会自动恢复 Container image。旧测试实例 inactive，已确认 R2 checkpoint 保留。

## 修正后的第二轮

新的固定运行 `release-g0-v2-20260906` 保留第一轮证据与关闭状态。阶段间清理窗口延长到 600 秒，为真实 rollout 收敛和独立 API 核验留出时间；单次 RPC 45 秒、子进程 10 秒、hold 120 秒、容器闲置 180 秒的界限保持。未知操作仍不重放，丢失 RPC 所有者时要求独立对账。

`ReleaseSandbox.onStop` 保存有界停止回调记录，`releaseLifecycle()` 只读取状态、不会启动实例。回调时间仅表示观察时刻，实际镜像替换仍需关联 Cloudflare 实例记录。原有正常结束的任务保留进程记录，不将 `getProcess(null)` 单独解释为中断。

[第二轮本地全检](evidence/runs/m0-local-20260906091620833/local-checks.json)通过：327 pass、1 skip、0 fail。两种镜像均复用已批准 digest；没有重新发布镜像。后续必须完成新实例 I2 恢复、真实 exit 42 启动失败、W1/I1 双回退、回退恢复写读和所有实例清理，再独立签收。

## 第二轮观察失败与第三轮

[第二轮基线](evidence/runs/m0-release-baseline-1788686332563/summary.json)在服务端完成 counter=1 与 R2 保存，但客户端两次连续 GET 网络失败后启动清理，最终 cleanup=confirmed。该轮未继续升级。只读重试函数此前仅处理第一层失败，第二次失败直接逃出，未用完固定三次重试预算；已改为有界循环并增加两项反例测试。第三轮固定运行 `release-g0-v3-20260906`；[全检](evidence/runs/m0-local-20260906092132818/local-checks.json)为 329 pass、1 skip、0 fail。没有提高写请求次数或开启模型。

## 第三轮结果与最终回退

[第三轮基线](evidence/runs/m0-release-baseline-1788686607924/summary.json)、[兼容检查](evidence/runs/m0-release-compatibility-1788686798887/summary.json)、[活动任务](evidence/runs/m0-release-hold-1788686803553/summary.json)以及[升级恢复](evidence/runs/m0-release-upgrade-1788687064356/summary.json)均通过。I2 application version=4 已独立回读，新实例从已确认 counter=1 恢复，执行 increment/read 得到 2，再保存 sequence=2 checkpoint。

[独立 R2 GET](evidence/runs/m0-release-upgrade-1788687064356/r2-independent-verification.json)核对 manifest 220 字节、state 24 字节及其 SHA256，state 为 `{"schema":1,"counter":2}`。hold 观察为活动 PID 96；升级后 Container 状态 stopped 的 lastChange 早于 120 秒 hold 理论完成，进程记录缺失，onStop 记录为 null。停止原因仍需结合实际 rollout/实例记录独立判定，不能声称已捕获具体 OS 信号。

[启动故障](evidence/runs/m0-release-startup-failure-1788687076308/summary.json)返回 startupIssued=true、readinessConfirmed=false，但 observedExitCode=null、状态 running，因此结果为 unconfirmed，测试未签收。随后关闭运行并完成清理；没有执行原定的 rollback 恢复阶段。

先[回退原 W1 version](evidence/runs/m0-release-v3-worker-rollback-20260906/api.json)，再[部署相同 W1 bundle 和 I1](evidence/runs/m0-release-deploy-rollback-1788687343387/deployment-verified.json)。09:37:06 UTC [API](evidence/runs/m0-release-deploy-rollback-1788687343387/api.json)确认 Worker `e6a57b3f-a5fb-47e6-abbd-cedbc568c822` 100%、application version=5 / I1、五条历史实例全部 inactive。回退后的 bundle SHA 与第三轮 W1 完全一致；镜像回退已确认，回退后恢复写读仍未执行。

[共同候选初审](evidence/runs/m0-candidate-review-20260906/preliminary.json)确认九项签收记录的 110 条证据摘要一致，未发现需重跑 T01–T09 的运行代码漂移。G0 仍为 9/10，T10 完整签收、最终共同候选及 M1–M5 尚未完成。全程没有新增模型调用；实际现金扣款没有独立结算记录，不以执行时长代替账单。

[第三轮独立部分复核](evidence/runs/m0-release-upgrade-1788687064356/independent-partial-review.json)确认上述局部结果、回退和清理有证据支持；T10 仍为 failed / 未签收。[当前进度快照](evidence/runs/m0-release-progress-20260906/progress.json)保持 G0 9/10、accepted=false、fullGoalComplete=false。

[启动故障独立诊断](evidence/runs/m0-release-startup-failure-1788687076308/independent-diagnosis.json)记录 SDK 健康检查、缓存状态与 native monitor 的取证差异；不补写原故障退出码。后续只做新的独立补验。
