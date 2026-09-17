# Staging Worker 出口只读诊断（2026-09-16）

用户授权将地区403诊断放到 `riffology-m1-gateway-staging`。主控采用内部 `ModelProxyService.probeProductionModels()` RPC，由临时 operator 调用器调用；该方法在目标 Worker 内使用现有生产绑定请求固定 Gateway `GET /openai/models`。没有公共探针路由、推理 POST、Project/Turn/Run admission、预算账本操作或门禁变更。实现及检查见[探针说明](g5-production-models-probe-implementation.md)。

最终实际结果：`2026-09-16T05:18:06.256Z` 收到目标 Worker 版本 `6f0472b6-0303-4f08-96e2-94a878630447` 的 RPC 返回，HTTP 200、`modelAvailable=true`、`inferenceCalls=0`；固定模型 `gpt-5.6-luna` 存在。由此确认 staging Worker 出口可以通过已鉴权的 Cloudflare AI Gateway 读取 OpenAI 模型列表，本机观察到的地区403没有在这次 Worker 出口请求中复现。

诊断配置加入 Cloudflare 文档要求的 `global_fetch_strictly_public`，并将探针重定向策略从 `error` 改为 `manual`：仍不跟随重定向，但可以显式拒绝3xx而不是把 Fetch 的 `TypeError` 混为传输异常。此前依次出现一次调用器 delivery unknown 和两次 Worker `transport-unknown`；最后一次才取得200。由于两项配置变化和网络波动均存在，不能单独归因某一项。生产 Responses 路径尚未调用，模型列表200只证明只读通道、模型可见性和两层鉴权，不证明付费推理、费用账本或普通用户闭环。

诊断完成后已用原冻结构建产物、关闭门禁 overlay 和 `containers-rollout=none` 恢复 staging。当前版本为 `75d4b354-0943-4278-961f-b07738752106`，独立 `versions view` 读取的源码 etag `5b52761213c519d9c6a83cb1d601b793b1fecad5d4df7aaee48bb3ac076884ef` 与原冻结版本一致，全部冻结 vars 逐项一致，生产密钥绑定保留；首页200。恢复版本不含临时 `global_fetch_strictly_public` 或探针RPC，范围、预算、window/profile/source pin 未变，首次任务计时未启动。下一步若要从 staging 执行 G5，须将 Worker 出口配置正式纳入新的可审查 release overlay 和 source proof，再按冻结门禁执行，不能把临时诊断配置直接冒充已冻结生产版本。

临时调用器已删除，独立查询得到 Worker 不存在 `10007`；本地临时 operator capability 文件已精确删除，原项目 `.dev.vars` 保持不变。总计4次只读调用器尝试，无推理重试、无上游 Responses 请求。

[脱敏结果及恢复证明](g5-worker-origin-probe-20260916.json)记录实际返回与复原核对。该JSON写入 MODEL_CONTENT `g5-acceptance/g5-20260916-wiring-v1/diagnostics/worker-origin-probe-20260916.json`，使用原已核对的专属7天前缀；平台保留边界见[隐私冻结](g5-privacy-freeze-20260916.md)。原[范围预算冻结](g5-scope-budget-freeze-20260916.md)、[首次生产 readback](g5-closed-production-readback-20260916.json)保留为历史证据，当前 Worker 版本以本记录为准。
