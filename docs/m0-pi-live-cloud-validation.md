# M0 真实 Pi 与出口云验证

本次范围是原计划 G0-T01 与 G0-T09。真实模型请求只允许固定 Go / DeepSeek V4 Flash，最多两次；不增加供应商余额、不自动补发第三次请求。项目执行域、可信 Pi 执行域和持有供应商密钥的代理 Worker 分离。

## 已部署的候选

- 模型代理：`riffology-m0-model-proxy-go-live-staging`，版本 `8ff337aa-a548-4779-b1f7-d1053fc3939c`。供应商 Key 通过进程标准输入写入 Worker Secret，没有写入新的明文凭据文件。
- 初版监督器：`riffology-m0-pi-live-staging`，版本 `a8282e5b-a887-4976-a0cb-b3b57d12ebbb`。两个 Container application 各最多一个 basic 实例，执行顺序限定同时一个测试 VM。
- [部署核验](evidence/runs/m0-pi-live-deploy-20260906/deployment-verified.json)核对了 Worker 100% 版本、服务绑定、私有 R2、镜像 digest、打包字节和源码清单。
- [本地全检](evidence/runs/m0-local-20260906074036943/local-checks.json)：301 通过、1 跳过、0 失败，源码在检查期间不变。

## 首次云运行：保留失败结果

[原始运行](evidence/runs/m0-pi-live-cloud-1788680852306/summary.json)执行 7 次监督器请求，耗时 29.670 秒，源码未变、清理确认。项目实例已[独立核对 inactive](evidence/runs/m0-pi-live-cloud-1788680852306/instances-after.json)，可信 Pi 实例尚未创建。

实际通过的项目侧检查包括：任意域名、Go 直连、元数据 IP、模型代理和充值/改价/结算入口被 SDK 主机白名单拒绝；同一依赖主机的路径、查询、方法和改址头被固定 handler 拒绝；SimPy 4.1.1 wheel 的 27,224 字节及 SHA256 匹配，离线安装与导入成功；十个固定平台密钥/绑定名称在 VM 环境中均不存在。

停止原因是 DNS 探针错误地将“设置解析器地址为 8.8.8.8 后收到答案”等同于“请求实际抵达该外部服务器”。这次结果不验证解析器的实际目的地。原始失败记录不修改；[诊断记录](evidence/runs/m0-pi-live-cloud-1788680852306/diagnosis.json)另行说明修正原因。

Cloudflare 文档明确保留平台 DNS，HTTP 出口 handler 不处理 DNS/TCP。因此补充 TEST-NET 地址解析对照，分别记录请求的解析器、是否收到答案、实际目的地是否得到验证；不把收到答案直接认定为外部服务器可达，也不把超时认定为策略拒绝。真实非 HTTP TCP 连接成功仍判为边界异常。参见[官方出口说明](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)。

[代理独立回读](evidence/runs/m0-pi-live-cloud-1788680852306/proxy-after.json)确认 `initialized=false`、`ledger=null`、`upstreamDispatchIntents=0`、`activeRequests=0`。本次未进入真实模型调用。后续修正使用新的监督器 attempt，保持同一模型 run 与账本，不能重置已消耗的预算。

## 真实调用签收条件

第一次调用须完成并形成包含供应商响应 ID 的代理终态收据；完整 Pi Session 保存至 R2，经摘要校验后销毁 g1。g2 从同一快照恢复，新提示不重复随机记忆标记；真实文本流出现标记后请求取消，并核对代理 `cancelled` 终态、请求 ID 和 payload 摘要。仅客户端显示 aborted 不足以签收。

订阅额度变化与现金扣款保持未知字段。两次公共 token 价格保守预留合计最多 923,424 microUSD，实际不代表扣费。Go 的限额、峰谷价格和 Use balance 语义按[官方说明](https://opencode.ai/docs/go/#usage-limits)复核；Use balance 关闭为用户已确认的账户设置。

## 修正后的云运行与签收

监督器更新为 `7bb43caa-bc64-4d91-801f-b9d2758cff3a`，模型代理仍为原版本。[新版部署核验](evidence/runs/m0-pi-live-v2-deploy-20260906/deployment-verified.json)确认固定两份镜像与代理账本未变；[全检](evidence/runs/m0-local-20260906075740546/local-checks.json)为 303 通过、1 跳过、0 失败。一次执行前只读网络错误保留在[独立记录](evidence/runs/m0-pi-live-cloud-1788681978378/summary.json)，该次没有发送 accept。

[成功运行](evidence/runs/m0-pi-live-cloud-1788682207606/summary.json)耗时 **49.443 秒、10 次监督器请求、99,686 响应字节**，源码稳定；只有一次 accept，模型派发恰好两次。两执行域合计 33 条网络/安装观察，HTTP 必验全部通过；DNS 的 8.8.8.8 与 TEST-NET 对照均收到答案，实际解析器目的地仍未验证，TCP 8443 超时仍为 unknown。

首次回复正确复述随机 marker，Session 保存为 1,416 字节 R2 对象；销毁 g1 后 g2 从该对象恢复，新 prompt 未再次包含 marker，真实文本流复述 marker 后触发取消。供应商 HTTP 请求头 ID 均为 null；实际使用两条供应商 SSE 响应 ID `334a0284-0d81-4eb8-8132-fff02c269441`、`03fe7be4-f019-4116-b317-9270ae627d1f`，分别与平台请求 ID、wire SHA 和代理 `completed` / `cancelled` 收据关联。这是原 T01 的最小关联适配，不冒充 HTTP 头 ID。

[R2 独立下载](evidence/runs/m0-pi-live-cloud-1788682207606/r2-independent-verification.json)复核 Session 与 manifest 的大小、摘要和实际内容；[代理回读](evidence/runs/m0-pi-live-cloud-1788682207606/proxy-after.json)确认账本未变、已撤权、active=0。成功运行的三个实例及此前失败项目实例[全部 inactive](evidence/runs/m0-pi-live-cloud-1788682207606/instances-after.json)，审计记录与 R2 对象保留。

首轮供应商最终 usage 为 **81 输入 + 24 输出**；取消轮最终用量未知。两次标价预留合计 US$0.923424 是保守预留，不是实际扣款，现金金额和 Go 额度变化均不填零。该结果不证明供应商内部尝试次数或取消后计算立即停止。

[T01](evidence/runs/m0-g0-t01-cloud-20260906/G0-T01-gate-summary.json)与[T09](evidence/runs/m0-g0-t09-cloud-20260906/G0-T09-gate-summary.json)均已由主控和独立审查签收。[G0 当前为 9/10](evidence/runs/m0-g0-progress-live-20260906/progress.json)，仅 T10 云发布/回退及共同候选复核待完成，整个 M0 和产品仍未完成。
