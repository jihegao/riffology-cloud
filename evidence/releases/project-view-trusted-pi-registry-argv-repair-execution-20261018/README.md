# TrustedPi Registry 参数顺序修复批次：实际发布与独立清理

2026-10-18，同一 JHG-46 Goal。用户已授权 `abd265e503c77a5fb2a9256dd8365f5849d2df05` 的修复版，request `fb99c7e4-21a7-4215-8261-c17dd7c148aa`，固定清单 `89f2f285f5f732a6f3c9b8705a47fde4b5f073970e585e779371fb20ac2680fa`。本批已实际完成一次登录、一次 Registry 凭据 POST、一次固定平台 push、完整 raw 回读和原身份独立清理。**Registry 阶段完成；尚未合并 #239/#246、部署应用或完成普通受邀用户流程，JHG-46 未完成。**

[结构化结果](result.json) · [清单](inventory.json) · [本批结果文档](../../../docs/project-view-trusted-pi-registry-argv-repair-result-20261018.md) · [原冻结修复包](../../../docs/project-view-trusted-pi-registry-argv-repair-packet-20261018.md)。

## 实际发布身份

目的地为 `registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-issue165-trusted-pi:jhg46-pi-resource-compat-20261017-a946b164`。

- Registry 的 linux/amd64 manifest 为 `sha256:f18a826d40b2fd60e2cf8c49d7f7b8f595fa609fe2be4c28593479ae846960ea`（9396 B），config 为 `sha256:07c199e17490cc4fdf3e8027770f8a7413090d4e7c3a1f44aa9064e115641059`（18775 B）。
- `sha256:a946b164d10d074fcc9859f6c54c3b65d1901b41696c5ee8d8e31e275ddd1593`（856 B）继续表示原本地 Engine/index；未把此 index 或 attestation 上传为发布对象，也未验证发布者签名。
- 只读复用原 c3e OCI 归档，407955456 B / SHA256 `83b81e553a9c4e885299650c31cd179e126168c4da50b2dfd3ed1d8ffe5e0b51`。52 个原 blob、48 个运行层槽位的解压 diffID 全部匹配；本批 **0 export、1 次完整归档校验、1 次 Docker push CLI**。一条 CLI 不保证 Docker daemon 内部没有 HTTP 重试。[原归档验证](sources/remote/raw-verification.json)。

[发布后 raw 回读](sources/remote/registry-readback.json) 共 **51 次**：按 tag 和 digest 的 2 次 manifest、1 次 config、48 个 layer 槽位，所有 body/hash/字节数及必要 digest header 匹配。48 是槽位数，包含重复 digest，不能称为 48 个唯一 layer；51 也不是本批全部 API 请求数。发布前 [tag 不存在见证](sources/remote/remote-tag-absence.json) 为 404，不计入上述 51 次。

## 终态与独立释放

本机入口于 `2026-10-18T01:59:10.480353+00:00` 启动。[远端原终态](sources/remote/terminal.json) 结束于 `02:03:05.358823+00:00`；[本机原终态](sources/local/terminal.json) 于 `02:03:09.756144+00:00` 记录唯一完整 ACK 校验通过、SSH exit0/回收，原 session88202 exit0。保留各主机原时间，未证明跨主机时钟同步，不以时间差推导额外因果。

[冻结独立只读 reader 结果](sources/independent/independent-remote-cleanup.json)（5274 B / SHA256 `d3f0af3ea58cd8d9049a25fbd1fcd7cfdbe8b5a7e4ce4e82cd45c6c89b9d3632`）核对 27 份固定记录的有界字节/哈希、5 个原 CLI 的 PID/startTicks/终态、原 supervisor、临时认证目录和 7897 路由。5 个原 CLI 均已记录回收且原进程不存在；`new-local-tag-before` 的 exit1 是新 tag 不存在的预检，不是 push 失败。原 supervisor 不存在、认证副本不存在、7897 连接拒绝 errno111。该 reader 没有再次请求 Registry、生成凭据、运行 Docker/provider 或写远端。[只读调用安全投影](sources/independent/readonly-invocation.safe.json)。

[独立本机停止核对](sources/independent/independent-local-stop-review.json) 与 [root 交叉核对](sources/independent/root-terminal-and-input-review.json) 分别确认原 PID30182（consent）、30207（auth token）、30219（SSH）回收且当前不存在；root 使用 `kill(pid,0)` 的 ProcessLookupError，未发送信号或读取 argv。没有推测未记录的其它进程身份。

## OAuth、凭据和费用边界

[身份安全见证](sources/local/normal-login-identity-safe.json) 确认同用户哈希、目标账户以及精确六 scope：user:read、offline_access、account:read、workers:write、workers_scripts:write、containers:write。OAuth 留在本机；[唯一凭据 POST 元数据](sources/local/credential-http-response.json) 为 HTTP201/success通过，只有临时 Registry username/password 经 SSH stdin 发送。请求的 Registry TTL 为15分钟，凭据为账户 Registry push/pull 权限，不能缩成单仓库；执行器才限制目标。

持续 OAuth `containers:write` 没有本任务账户/仓库资源过滤，不随15分钟 Registry JWT失效，正常同 scope refresh 仍可延长。删除临时 Docker 配置不撤销 OAuth、不恢复原五 scope，也不证明 Registry JWT 已撤销或自然到期。身份元数据的 access-token expiresAt 不能当作持续授权终止时间。本次 HTTP201 或成功发布不解释旧 c3e HTTP403 的原因，也不证明权限最小性。

[授权绑定安全原件](sources/authorization/grant-binding-safe.json) 在执行前写入，其中 `realAuthOrDriverStarted=false` 是当时快照；不能用它否认后来发生的真实执行。没有复制或读取私有 grant、人类答复、OAuth/token、Docker config 或原认证 CLI 输出；两个 CLI intent 仅将本机路径换为占位符，同时保留原件字节数与 SHA256。

原来源中的 `cloudflareApplicationChanges=0` 等字段仅描述批准执行器/复核的作用域；root 回执的 `newAuthCredentialOrPushAttempts=0` 指其只读复核没有新增尝试，不否认本批已发生的 POST/push。未读取应用、Gateway、模型或费用的权威作用域计数，不能声称全账户零活动或零费用。本批未对 a036 应用 rollout，它尚未使用本次发布的新镜像；native DOM v3 的既有 Gateway 发布保留。未做应用/Gateway/门禁 rollout、容器验收、真实项目/模型/Turn/Run或普通用户验收；不借本批自动合并 PR、改变容量或标记整体 Done。费用结算与欠费状态没有由本证据确认。原57a、a21、b093、c3e及9ec失败/未知、锁、归档、费用与冻结准备输入保持原样。

## 前提交 CI 与来源映射

[原自动 CI 安全回执](sources/ci/prior-abd-original-run-terminal.json) 绑定 **前提交 abd265e503c77a5fb2a9256dd8365f5849d2df05** / base638a366d…，run39088048795、attempt1，2026-10-18T02:04:05Z成功，返回14步成功。保留原 workflow 的条件 skip；未读完整日志或测试计数，未手动重跑。它不能套用到新增本批实际结果的后续提交，也不是实际发布、部署或用户验收证据。

本目录除4份明确派生投影外，安全来源均逐字节复制。两个 CLI intent 只投影路径；两个只读调用 receipt 省略原工具/传输 argv、保留原 bytes/SHA 及安全观察字段。远端只取6份白名单安全JSON；前4份与冻结 reader 哈希引用一致，额外 tagabsence/pushintent 由 [只读提取安全回执](sources/remote/safe-record-retrieval.safe.json) 独立绑定。完整 envelope 和提取 helper 仅在 result 中绑定原哈希，不重复发布其 raw/base64。没有发布 raw inspect/config/Env/认证输出或 Registry credential response body。

本地 staging 是可审归档，尚未声称本次结果已提交/推送。独立公开评审可放在本清单之外，避免循环哈希。
