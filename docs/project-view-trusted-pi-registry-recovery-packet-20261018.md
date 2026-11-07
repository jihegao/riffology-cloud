# TrustedPi Registry 恢复固定包 — 2026-10-18

本包属于同一 JHG-46 Goal，状态为**准备完成、尚未授权执行**。前批 c3e 已完成一次原镜像导出及完整原始校验，但唯一 Registry 凭据 POST 返回 HTTP 403，未发送可用凭据、未 tag/push/Registry 镜像回读/合并；原进程、临时认证目录及路由已独立确认释放。[前批固定实际结果](https://github.com/jihegao/riffology-cloud/blob/94b4adb6d68bfa124e10af3e628cc8336a97a96b/docs/project-view-trusted-pi-image-publication-result-20261017.md)保留，不复用其一次授权、请求锁或 POST。

本批仅拟：**一次明确的本机 OAuth 同用户授权，追加持续的 `containers:write` → 只读复用原归档并重新校验 → 一次新 15 分钟 Registry 凭据 → 既有仓库/固定新 tag 的一次平台推送及全部原始字节回读 → 原进程、凭据副本、路由清理与独立核对**。追加 OAuth 权限不会随 Registry 凭据的 15 分钟期限失效；它的可访问资源由 Cloudflare 同意界面和用户权限决定，没有本任务账户/仓库的 OAuth 资源过滤。冻结执行器只允许下表的账户、仓库和 tag。该追加不保证解决 403。

本批不导出、build/pull/load 或启动容器，不合并 #239，不 rollout、不改应用/Gateway/assets/bindings/policy/门禁，不创建或保存项目，不执行真实模型/Turn/Run。原归档、请求锁、版本、镜像、资源、费用和失败记录全部保留。

## 固定身份和输入

| 项目 | 固定值 |
| --- | --- |
| 新请求／父请求 | `9ec39434-0856-4ee7-af30-adf3dd5b5df4` ／ `c3e04c41-72da-409b-a2b1-f924e6cc67fa` |
| AMD128 新目录 | `/tmp/riffoid-jhg46-image-20261017.AU613w/pi-registry-recovery-v1` |
| 只读原归档 | 原 c3e 目录中的 `original.oci.tar`，407,955,456 B，SHA256 `83b81e553a9c4e885299650c31cd179e126168c4da50b2dfd3ed1d8ffe5e0b51` |
| 原本地 Engine/index | `sha256:a946b164d10d074fcc9859f6c54c3b65d1901b41696c5ee8d8e31e275ddd1593`，856 B |
| 原 linux/amd64 manifest | `sha256:f18a826d40b2fd60e2cf8c49d7f7b8f595fa609fe2be4c28593479ae846960ea`，9,396 B |
| 原 config | `sha256:07c199e17490cc4fdf3e8027770f8a7413090d4e7c3a1f44aa9064e115641059`，18,775 B |
| 唯一目的仓库 | `registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-issue165-trusted-pi` |
| 唯一新 tag | `jhg46-pi-resource-compat-20261017-a946b164`；须重新权威核对不存在，不覆盖 |
| 8 项操作源码 | 共 72,306 B；[操作清单](../evidence/releases/project-view-trusted-pi-registry-recovery-preparation-20261018/operations-manifest.json) 1,313 B，SHA256 `3779af353a82fa334fc805a54ff02fe91a2f905d2cc9daf4733b1fd92189589c` |
| 独立只读 reader | [independent-cleanup-readonly.py](../evidence/releases/project-view-trusted-pi-registry-recovery-preparation-20261018/independent-cleanup-readonly.py)，9,057 B，SHA256 `3fe998b9a38a48f445e03ea16431fc0b71cfa98973707d1819427ddd1929e70d` |

这些是原本地归档的身份，尚不是本批实际 Registry 发布结果。八份源码及单独 reader/fixture、回执、评审和脱敏事实均列在[公开 inventory](../evidence/releases/project-view-trusted-pi-registry-recovery-preparation-20261018/inventory.json)，不包含归档本体、凭据、OAuth 配置或私有人类授权。

## OAuth 和短期 Registry 凭据

此前授权只允许原五项 OAuth scope 的正常续期，明确不允许新登录或扩权；本批因此需要新的完整人类授权。[原脱敏身份观察](../evidence/releases/project-view-trusted-pi-registry-recovery-preparation-20261018/parent-normal-login-identity-safe.json)只证明当时的账户、五项 scope 和同用户 hash，不证明当前有效期。

固定使用已安装 Wrangler 4.129.0，`cli.js` SHA256 `0a7bc2107ca92b2cc6db58b6a36d38d44b549eebd7db7ec34c36db9da7a91264`。一次正常 `login --scopes` 明确请求 `user:read account:read workers:write workers_scripts:write containers:write`，固定客户端自动追加 `offline_access`。最终元数据必须恰为这六项，少项、多项或用户/账户不符即停止；不使用默认全部 scope 登录，不使用其它身份、账户、API token 或连接器 fallback。选择 `containers:write` 是已安装 Containers 客户端的权限合同，**不是 REST 最小权限已证实，也不是原 403 原因已查明**。[官方 Wrangler 登录](https://developers.cloudflare.com/workers/wrangler/commands/general/#login) · [Containers 命令](https://developers.cloudflare.com/workers/wrangler/commands/containers/)。

该 OAuth 授权持续保存在本机，正常同六项 scope 续期仍可延长其效力；它不是只准推送一次的仓库权限，也不保证只覆盖这个 Personal 账户。正常 scope 请求没有账户/仓库资源过滤，实际权限范围以同意界面及用户可访问资源为准。清除临时 Registry 配置不会撤销 OAuth、恢复五项 scope 或证明服务端凭据过期；后续减权需新的同意流程。

两个固定 CLI 调用均带全局 `--env-file /dev/null`，避免默认加载 `.env/.env.local` 引入其它 token/认证端点；允许列表环境排除其它凭据覆盖，并设置 `WRANGLER_WRITE_LOGS=false`。正常登录会使用系统浏览器及本机 `localhost:8976` 回调；OAuth/token/授权 URL 输出仅保留在有界内存，不写日志、不传 AMD。执行器先校验新的人类答复绑定和清单，再读取本机认证；OAuth 同意后须用 `/user` hash 和固定账户回读确认同一用户，才允许 SSH/Registry 凭据请求。必要的同六项 scope 正常续期可包含在本次新授权中；不自动再做一次 consent 或扩大范围。

唯一新凭据 POST 固定目标账户，参数 `expiration_minutes=15`、`permissions=["push","pull"]`。API 未提供单仓库权限字段，**短期凭据是账户 Registry push/pull 权限**，只由冻结脚本限制目的仓库。仅接受 HTTP 200 或 201 且 `success===true`、精确账户/host 和四个有界结果字段；200 来自当前官方 HTML 示例，201 来自已核对的解析 schema，两者差异保留。其它状态或无效响应立即停止，不重试或换 token；只保留安全状态/大小/hash/整数错误码，不保存原始响应体或 message。[官方凭据接口](https://developers.cloudflare.com/api/resources/containers/subresources/registries/subresources/credentials/methods/generate/)。

只有成功获得的 username/password 通过 SSH stdin 传 AMD，写专用 0700 目录中的 0600 Docker 配置；OAuth 不传 AMD，凭据不写 argv、环境、仓库或日志。若传输中断，发送完成标志不能单独证明远端未收字节，须沿原请求核对。请求 15 分钟及删除本机副本不等于服务端撤销/到期证据。

## 原归档复用、推送与收尾

仅建立本批拥有的一条 loopback 转发 `AMD 127.0.0.1:7897 → 本机既有 127.0.0.1:7892`；禁用 agent forwarding、继承额外转发和共享控制连接，终态清理原进程/路由并独立回读。

原 c3e 归档只读打开，核对权限、所有者、普通文件/无链接和稳定身份，再重新校验全部 52 个原始 blob、唯一 linux/amd64 manifest、48 个运行层 diffID 及原 image Config/RootFS。归档及解压运行层累计各上限 4 GiB。两次原镜像 inspect 和全部校验记录写入新目录；不写原 c3e 目录、归档、锁或终态。固定 verifier 不重新打包或转换镜像。

远端 ready 先以安全记录落盘，才尝试唯一新凭据 POST。拿到凭据后须权威确认 Registry 和本地固定 tag 都不存在，才允许一次打 tag 和一次 `docker image push --platform linux/amd64`。一次指一个 Docker CLI 调用，不声称控制 daemon 内部 HTTP 重试。随后逐项原始回读 tag/digest manifest、config 和所有 layer，与原归档逐字节大小/SHA 及必要 digest header 匹配。index/attestation 留作本地构建证据，不声称已上传或有签名。

成功须有唯一完整 final ACK，绑定原归档/平台/config、零 export、一次校验/一次 push 和临时认证清理。缺失、重复、冲突或截断均保留为 unknown，不能仅凭 SSH exit 0 宣称成功；拒绝、未知或超时按本次 9ec 原身份停止，不自动 POST/push/retry/rollback，不改原记录。

固定独立 reader 包含完整成功路径，以及严格限定的「已验证归档和两次 inspect、凭据输入前 EOF、零 push」停止路径。它确认原 supervisor/CLI PID/startTicks 及记录链、临时认证目录和 7897 释放；后者只确认停止/清理，不称发布成功。其它缺失或不明记录保持 pending。reader 不重复 Docker/Registry 操作、不写远端、不读 OAuth；root 另确认本机 OAuth/SSH 本批原始子进程均回收及当前不存在。正常 OAuth 权限仍保留。

## 已有 CI 修复和验收边界

[只读 current-main 核对](../evidence/releases/project-view-trusted-pi-registry-recovery-preparation-20261018/current-main-reconciliation.json)记录：截至 2026-10-17 16:12:57 UTC，main `638a366d31a37f7bc1d7dcd124e0b5ba753d6401` 已包含 [#243](https://github.com/jihegao/riffology-cloud/pull/243) 测试同步/清理修复及 [#237](https://github.com/jihegao/riffology-cloud/pull/237) 文档修订；其固定 head 的[原自动 CI #39043240194](https://github.com/jihegao/riffology-cloud/actions/runs/39043240194) 和 [#39046248134](https://github.com/jihegao/riffology-cloud/actions/runs/39046248134) 均完整成功。已合并修复不重新排开发。

固定 #239 head `0d23a12d869abccb9515a8e7f8196b0266258226` 的旧红 CI 保留；与上述 main 的只读 merge-tree 无冲突，预览 tree `3b22c10683ad7e0ef75d25b6034e2bcc173ec014` 仅改变原两份 Dockerfile，七项相关测试/runtime/workflow/package blob 与 #243 已过 CI 的 head 相同。这不是 #239 或预览的新 CI，不是合并，不自动清除后续 protected merge 门禁。误建的 [#244](https://github.com/jihegao/riffology-cloud/issues/244) 已按重复项人工 not_planned 关闭并归档其原 Backlog item，[回执](../evidence/releases/project-view-trusted-pi-registry-recovery-preparation-20261018/duplicate244-resolution.json)保留原文/历史，未设 Done、未另写 helper 修复。

#239 合并明确不包含在本次恢复包；其后需根据发布结果和最新 main/review/保护/CI 再具体核对。已知 CI 额度/付款未执行豁免继续有效，不能用于实际技术断言失败。当前 #238 为 In review/P1/blocked，#214/JHG-46 为 Acceptance/P1/blocked；负责人 @jihegao、原生 Milestone #1 保留。#242 仅其离线范围 Done、Issue 仍 open。普通受邀 skill→双页/保存/刷新/离开/冷恢复及完整 JHG-56 尚未验收。

## 准备验证与授权门禁

[16 项操作 fake](../evidence/releases/project-view-trusted-pi-registry-recovery-preparation-20261018/checks.json)、[7 项独立 reader fixture](../evidence/releases/project-view-trusted-pi-registry-recovery-preparation-20261018/independent-reader-checks.json)通过；[独审回执](../evidence/releases/project-view-trusted-pi-registry-recovery-preparation-20261018/independent-review.json)核对固定八份源码、单独 reader、真实已安装公开 CLI 字节和检查流，无 must-fix。准备过程不读取真实 OAuth/凭据、不调用 Wrangler/auth、SSH、Docker 或 Cloudflare 账户 API，未预制执行 grant；这些检查不证明本次登录、tag 不存在、权限足够、发布或远端清理已成功。

执行前须取得针对本固定公开包的**新完整人类授权**。原因是 c3e 唯一 POST 已消费，而旧授权明确禁止新登录/扩权；本包增加持续 OAuth `containers:write`、新请求、新凭据和新 push 尝试，不能视为旧批恢复重试。用户无费用预算上限、明确欠费时通知的规则沿用；403 不作为欠费证据。不改变订阅、付款方式、自动付款或平台额度。任何真实容器 rollout、项目/模型/Turn/Run、门禁扩大和 #239 合并均不由本授权覆盖。
