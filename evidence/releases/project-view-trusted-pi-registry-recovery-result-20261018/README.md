# 9ec Registry 恢复批次：本机 CLI 失败后停止（实际结果）

用户已授权 `14d2a2a5e03166ddba5167523127aeae0edd8832` 中清单 `3779af353a82fa334fc805a54ff02fe91a2f905d2cc9daf4733b1fd92189589c` 的冻结批次。本批请求为 `9ec39434-0856-4ee7-af30-adf3dd5b5df4`，已实际单次启动；本机 CLI 返回 exit 1，执行入口随即停止，没有重试。**本批未发布镜像，JHG-46 尚未完成。**

[结构化实际结果](result.json) 与 [授权事实安全投影](sources/human-authorization.safe.json) 仅保留授权事实及哈希，不含私有 grant 或人类答复正文。授权绑定记录早于执行，其中当时的 `newExecutionStarted=false` 不代表本批从未启动。

## 实际行为与停止证据

- 入口 intent：`2026-10-18T01:34:19.307606+00:00`；原 CLI PID `27665` 于 `01:34:19.314710+00:00` 启动；驱动终态时间为 `01:34:19.666328+00:00`。
- [CLI 终态原件](sources/consent-cli-terminal.json) 记录 exit `1`、`originalReaped=true`、`stopErrors=[]`。原始 CLI stdout `4,345 B`、stderr `354 B` 仅在内存中，未持久化，当前没有可复查的内容或输出哈希；失败原因尚未确认。
- [独立本地停止核对](sources/independent-local-stop.safe.json) 于 `01:36:43.981480+00:00` 对原 PID 执行 `kill(pid, 0)` 得到 `ProcessLookupError`；核对五份原记录及其哈希，确认固定的 11 份后序记录缺席。本次独立核对没有读取 OAuth、进程 argv、浏览器或远端状态。
- [驱动终态原件](sources/driver-terminal.json) 保留原 errorCode `normal-oauth-cli-unconfirmed-no-fallback`、`credentialPostAttempted=false`、`credentialStdinSent=false`、`safeRemoteEvents=[]`、`finalPublicationAckVerified=false`。SSH 尚未创建，所以 `originalSshReaped=false` 表示没有该子进程；它不构成“存在未回收 SSH”的证据。原终态的通用 cleanup-required 字段也保留，本结果不据此声称做过远端清理。

## 后序范围与证据边界

依据冻结驱动控制流、原终态及后序记录缺席，本批驱动没有到达 `auth token`、OAuth 元数据读取、用户/账户身份 API、SSH 配置或启动、AMD bootstrap/7897 路由、Registry 凭据 POST、credential stdin 或镜像发布阶段。也未到达部署、门禁修改或真实用户执行流程。这里描述的是本次驱动的阶段边界；没有查询账户或服务的权威计数，不能提升为全局零活动证明。

原 CLI 本身在退出前是否打开浏览器、访问网络或修改本机 OAuth 状态，仍未核对，不能宣称没有这些副作用。原驱动终态中的空 stdout/stderr SHA256 只属于尚未启动的 SSH 传输流，不能当作 CLI 的 4,345/354 B 输出哈希。当前也未确认 OAuth scope 是否变化、是否撤销或降权。

旧 `c3e04c41-72da-409b-a2b1-f924e6cc67fa` 的唯一凭据 POST HTTP `403` 及其独立收尾证据保持原样，原因仍未知。本批 CLI exit `1` 不能解释旧 `403`，也不能证明权限不足或欠费。本批未重新核验原 OCI 归档或远端镜像。原 57a、a21、b093 和 c3e 历史继续保留。

本结果不包含尚未发生的修复版验证、新授权、第二次执行、PR #239/#246 合并、rollout、Gateway/应用/门禁更新、容器启动或真实模型/Turn/Run；普通受邀用户线上验收及 JHG-46 完成条件没有被本结果满足。

## 可公开来源

[入口 intent](sources/attempt-intent.json)、[原 CLI 身份](sources/consent-cli-original.json)、[CLI 终态](sources/consent-cli-terminal.json) 和 [驱动终态](sources/driver-terminal.json) 四份来源逐字节复制。第五份 [CLI intent 安全投影](sources/consent-cli-intent.safe.json) 只将两个本机绝对路径替换为占位符，保留原件字节数、SHA256 和其余实际 argv，未改动原件。

[独立停止回执安全投影](sources/independent-local-stop.safe.json) 将绝对路径换为文件名并去掉本机所有者元数据；保留原回执哈希、观察方法、范围与限制。[清单](inventory.json) 绑定本目录除清单自身外的全部文件。没有复制私有 grant、原人类回复、OAuth 文件或 CLI 原始输出。该目录供 PR236 审阅，实际结果与后续准备分开记录。
