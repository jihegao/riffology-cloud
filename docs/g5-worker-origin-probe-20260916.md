# Staging Worker 出口只读诊断（2026-09-16）

用户授权将地区403诊断放到 `riffology-m1-gateway-staging`。主控采用内部 `ModelProxyService.probeProductionModels()` RPC，由临时 operator 调用器调用；该方法在目标 Worker 内使用现有生产绑定请求固定 Gateway `GET /openai/models`。没有公共探针路由、推理 POST、Project/Turn/Run admission、预算账本操作或门禁变更。实现及三项检查见[探针说明](g5-production-models-probe-implementation.md)。

实际结果：`2026-09-16T01:26:44.979Z` 收到目标 Worker 版本 `9cd4fc3d-5350-49d4-9b65-be91d1235932` 的 RPC 返回，`status=null`、`errorCode=transport-unknown`、`modelAvailable=null`、`inferenceCalls=0`。第一次调用器请求发生传输失败、只读 delivery unknown；第二次取得上述返回，未再请求上游。异常没有取得上游 HTTP 状态，也没有输出原始异常、响应、模型清单或凭据。

因此，本机原生 models GET 的地区403仍是已观察到的历史结果；Worker 的本次请求异常无法确认地区限制是否解除，亦不能证明推理可用。不得据此打开 G5 付费验收。后续应先查明 Worker 请求异常，再完成只读通道验证；模型列表200仍只证明该入口的访问结果，付费 Responses 与普通用户验收须按冻结范围执行。[Cloudflare 内部 RPC 官方说明](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)解释目标方法的服务调用机制。

诊断完成后已用原冻结构建产物、关闭门禁 overlay 和 `containers-rollout=none` 恢复 staging。当前版本为 `6ad4aed7-5e29-4d50-8e35-df97ec0201d0`，独立 `versions view` 读取的源码 etag `5b52761213c519d9c6a83cb1d601b793b1fecad5d4df7aaee48bb3ac076884ef` 与原冻结版本一致，全部冻结 vars 逐项一致，生产密钥绑定保留；首页200。范围、预算、window/profile/source pin 未变，首次任务计时未启动。本地 integration 的新增探针代码为后续诊断候选，恢复后的线上冻结代码不含该新增方法。

临时调用器的首次 DELETE 超时；只读查询确认仍存在后完成第二次删除，并独立查询得到 Worker 不存在 `10007`。本地临时 operator capability 文件已精确删除，原项目 `.dev.vars` 保持不变。部署首次失败停在服务 GET、没有上传；确认日志阶段后才重试。无推理重试。

[脱敏结果及恢复证明](g5-worker-origin-probe-20260916.json)记录实际返回与复原核对。诊断 R2 对象使用原已核对的专属7天前缀，验收证据30天规则与原冻结证据不变；平台保留边界见[隐私冻结](g5-privacy-freeze-20260916.md)。原[范围预算冻结](g5-scope-budget-freeze-20260916.md)、[首次生产 readback](g5-closed-production-readback-20260916.json)保留为历史证据，当前 Worker 版本以本记录为准。
