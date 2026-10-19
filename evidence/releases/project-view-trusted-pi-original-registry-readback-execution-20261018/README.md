# 原 c263 Registry 部分回读实际结果（2026-10-18）

获批的固定 3fd5a29 包已执行一次，结果为 **4 GET 尝试、3 项完整证明，完整 52 项验收未通过**。原 tag manifest、runnable digest manifest 与 config 均 HTTP200、完整 raw bytes/hash 匹配；slot3 第一层 HTTP200，但只捕获 11,337,728 / 30,649,033 B，未生成 proof。

slot3 读取耗时 710.843621 秒；同一远端时钟下，从首次 GET 开始到该中断为 720.000108 秒，对应冻结总 GET alarm 720 秒。原字段为 `ScopeGuard/readback-original-identity-interrupted`，只能说明在总期限附近中断；网络、代理、服务或权限根因未获证明。跨本机/AMD 的 UTC 时间不用于推断全局顺序。

远端于 13:25:05Z `unknown-stopped`；本机原 SSH 于 13:25:34Z exit1，唯一成功 ACK=false。这里的 SSH1 是本次回读终态，旧 wire-repair 发布批的 SSH255 及 push CLI0 原记录保持原样。没有补槽、重试、重新 push、export、Docker、合并、部署或真实 Turn。

一次新 pull-only、账户级、15 分钟 TTL 请求的凭据 POST201 成功，OAuth 未传 AMD；本机正常 identity/credential API 仍使用其 Authorization header。原归档仅新增一次只读完整复验（53 blobs/49 diffIDs），不导出。凭据不落文件；内存引用清除是原终态记录，不宣称 Python 物理擦除或服务端撤销/到期。原持续六 scope OAuth 权限不会因临时路径/路由消失而撤销。

独立 reader 验证 14 份原 JSON 的引用、部分 proof 链及原 supervisor、限定配置路径和 7897 路由均已不在；本机两原 PID 另证 absent。reader 的 exit0 表示安全观察完成，`all52ProofsAndTerminalVerified=false`、`registryReadbackRecordsAndCleanupVerified=false`、`publicationVerified=false`，不能替代成功 ACK。collector 又按 reader 原 bytes/SHA 收集这 14 份原件，共 10,670 B；远端 terminal、archive revalidation 与原本机 safe events 全 JSON 等值。额外一次只读进度观察未作为验收证明，也不属于 Registry GET 槽位。

入口：[结果 JSON](result.json) · [全部文件清单](inventory.json) · [实际结果独审](sources/actual-independent-review.json) · [第二份本地一致性核对](sources/second-local-evidence-audit-safe.json) · [一页结果文档](../../../docs/project-view-trusted-pi-original-registry-readback-result-20261018.md)。

`remote-records/` 保留 14 份原安全 JSON 逐字节副本；包含批准范围内固定仓库/digest、grant SHA 和原进程身份以供核对，不含 credential 值、原 body/header、Config/Env。`sources/` 保存本机/reader/collector 安全原件、静审与结果核对。authorization、preflight、normal CLI intent 和 progress 仅作显式白名单投影，保留各自原 bytes/SHA；可执行路径使用占位符。授权 receipt 的 `newRealExecutionStarted=false`、前置检查零调用/状态不存在，只表示执行前快照，本次真实执行以原终态为准。所有公开投影均不复制原 grant、人类答复、OAuth、配置或私有 stream。

collector 首版 9352 的 descriptor 可选字段校验缺口及其独审保留；最终 3457296f 仅要求 optional 三字段任一出现时三键齐全、固定 descriptor/hash，外层其他字节未变，AST 通过后单次使用。reader 原 ad6f、主 16 输入和 11+11 准备检查源未改、未重跑；本次本地取证/文档整理没有触发新的外部执行。

原 57a、a21、b093、c3e、9ec、fb99 各批原状态及 c263 两次先前停止结果与原 once 锁/归档/预留/费用历史分别保留；不将任何旧 unknown 提升为成功。695e 离线镜像通过仍成立；普通 T1/R1 失败及后续验收停止不变。usage/费用 unknown 不记零；原 runtime 窗口不延长，完整 JHG-46/56 未完成。此目录供 PR236 审阅，实际结果与后续准备分开记录。

附加公开路径诊断与主回读分开记录：[原分析及8份源码/记录](public-network-diagnosis/analysis.json)。root 另作4次有界公开 GET（3次 speedtest、1次固定已发布资产），speedtest body到 `/dev/null`、固定资产body不保存/执行，stderr只保长度/hash：本机既有 proxy 的1 MiB HTTP200/完整1,048,576 B/2.823732秒；AMD无proxy直连 exit6/http0/0 B；本机16 MiB请求 HTTP403/1 B，固定已发布14,029,768 B资产请求也HTTP403/捕获0 B、closed=true，无hash匹配或大体积吞吐结论。它们不是认证Registry路径或持续带宽证明，不证明本次中断根因、权限或欠费。没有新增Registry GET/token/credential/反向route，主回读4/3未改变，也没有重试。来源：[Cloudflare speedtest](https://github.com/cloudflare/speedtest)、[curl错误码文档](https://curl.se/libcurl/c/libcurl-errors.html)；不把公开路径的结果替代Registry验收。
