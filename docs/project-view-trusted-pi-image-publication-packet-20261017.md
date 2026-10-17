# Trusted Pi 固定镜像发布包 — 2026-10-17

本包是同一 JHG-46 Goal 的下一批准备，**尚未执行，等待新的明确授权**。[b093 实际离线结果](project-view-trusted-pi-readable-probe-result-20261017.md)已通过并在 `911e646b278b169dcefcdc3cacf4efdd994f3004` 归档：12 个固定目标、15 项 SDK 检查通过，原容器清理独立确认。该授权仅覆盖一次离线探针，明确排除了本包的导出、Registry 凭据、推送和合并。

本次交付为：**a946 原镜像单次导出及原始字节校验 → 既有仓库单次平台推送及完整回读 → 原凭据副本/进程/路由清理和独立确认 → 满足当前门禁后普通合并 PR #239**。[固定源码、检查与评审](../evidence/releases/project-view-trusted-pi-image-publication-preparation-20261017/README.md)可逐项审阅。不改应用、Gateway、assets、policy、binding 或页面准入，不 rollout、不启动容器或真实项目/模型/Turn/Run；保留全部旧资源、版本、镜像、费用历史及原请求锁。

## 固定身份与输入

| 项目 | 固定值 |
| --- | --- |
| 新请求 | `c3e04c41-72da-409b-a2b1-f924e6cc67fa`，父请求 `b0933502-20df-480a-9a91-d833f5c4358c` |
| AMD128 新目录 | `/tmp/riffoid-jhg46-image-20261017.AU613w/pi-image-publication-v1` |
| 原 local Engine/index | `sha256:a946b164d10d074fcc9859f6c54c3b65d1901b41696c5ee8d8e31e275ddd1593`，OCI index 856 B，linux/amd64 |
| 唯一目的仓库 | `registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-issue165-trusted-pi` |
| 唯一新 tag | `jhg46-pi-resource-compat-20261017-a946b164`；执行时须权威确认尚不存在，不覆盖旧 tag |
| 8 项操作清单 | [operations-manifest.json](../evidence/releases/project-view-trusted-pi-image-publication-preparation-20261017/operations-manifest.json)，1,319 B，SHA256 `986c2d6e12e72785978e0bdfcf6e6357ba82e59cb16c40dc5c1cf8c7530ac4d1` |
| 独立只读 reader | [independent-cleanup-readonly.py](../evidence/releases/project-view-trusted-pi-image-publication-preparation-20261017/independent-cleanup-readonly.py)，7,854 B，SHA256 `2cf04125f41a89804ab284fe378990529b5eb9ad11b76888202b481a45a93ab9` |
| 源码 PR | [#239](https://github.com/jihegao/riffology-cloud/pull/239)，固定 head `0d23a12d869abccb9515a8e7f8196b0266258226`，仅两行 canonical package COPY `--chmod=0444` |

a946 是本地 Engine/index 身份，不能称为 Registry platform manifest 或 config digest。原始导出文件 SHA、平台 manifest/config 与所有 blob 的身份必须由授权后的一次实际导出确定。校验从固定 a946 index 追溯全部可达原始 blob，逐个核对大小/SHA，唯一选出 linux/amd64，核对所有运行层解压 diffID 与原 image RootFS；不构建、不转换、不用重新打包结果代替原图。单个归档和运行层解压累计均上限 4 GiB，格式、空间或支持不符即停止。

## 认证、传输和发布

旧的[脱敏 OAuth 观察](../evidence/releases/project-view-trusted-pi-image-publication-preparation-20261017/sources/old-oauth-scopes-safe.json)仅证明当时已有五项 scope：`user:read`、`offline_access`、`account:read`、`workers:write`、`workers_scripts:write`，不证明当前有效期。本批拟直接使用受支持 REST；只在新授权包含时，通过本机既有 Wrangler 正常续期同账户同 scope。入口重新核对五项 scope、有效期、用户和目标账户；不新增登录或权限，不把本机 OAuth 发送到 AMD。Wrangler CLI 的 `containers:write` 检查不能证明 REST 必须该权限；若服务明确拒绝，原请求停止，不扩权或再次 POST。

固定凭据请求为目标账户的 Registry credentials POST，仅一次，参数 `expiration_minutes=15`、`permissions=["push","pull"]`，仅接受 HTTP 201 及匹配的 `account_id`、`registry_host`、`username`、`password`。API 无单仓库权限字段，**凭据是账户 Registry push/pull 权限**，固定脚本只允许上述目的仓库/tag。凭据只经 SSH stdin 传给已审接收程序，写本批专用 0600 Docker 配置，目录 0700；不写日志、仓库、argv 或环境变量。请求 15 分钟不等于实际到期证明，清除本地配置不等于服务端撤销。[官方凭据 API](https://developers.cloudflare.com/api/resources/containers/subresources/registries/subresources/credentials/methods/generate/) · [官方 Wrangler Registry 文档](https://developers.cloudflare.com/workers/wrangler/commands/containers/)。

只建立一个本批拥有的 loopback SSH 转发 `AMD 127.0.0.1:7897 → 本机既有 127.0.0.1:7892`，禁用 agent forwarding 和共享控制连接，拒绝继承的额外转发。生成凭据前必须确认监听只在 loopback。固定目录是不可复用的尝试锁，实际人类答复绑定的私有 grant 由入口先校验；源码不附预制 grant。

导出及完整原始校验通过后才生成一次短期凭据，再权威核对新 tag 不存在，对原镜像打唯一新 tag，执行一次 `docker image push --platform linux/amd64`。这是一次 CLI 调用，不声称能控制 Docker 内部每次 HTTP 重试。仅推送所选运行平台；index/attestation 保留为原构建证据，不声称其已上传或具有签名。随后回读 tag、精确 digest 的原始 manifest、config 与每一个 layer，逐个匹配原始导出的字节数、SHA 和必要 digest header。

## 终态与合并门禁

完整最终 ACK 必须唯一，绑定原请求、源镜像、目的仓库、平台/config 身份、export/push 各一次和清理成功；缺失、重复、冲突、尾部残片即使 SSH 返回 0 也判 unknown。未知、拒绝、超时或不匹配均保留原身份与锁，不自动再次生成凭据、导出、推送或回滚；无 ACK 不能据此断言 Registry 未产生效果。

终态清除原临时 Docker 配置和目录，记录原 supervisor/CLI 的 PID、startTicks、退出与回收。关闭本批拥有的 SSH 连接后，以另一个会话运行固定只读 reader，核对原发布记录/原始 metadata hash 链、6 个原 CLI 与 supervisor 已不存在、凭据副本不存在、7897 无监听且连接被拒绝。root 另核对原本机 SSH 子进程已回收；本机 SSH 退出不代替远端终态。reader 不写远端、不执行 Docker、不外发原始 config/Env/日志，也不宣称短期凭据已经服务端撤销。

只有实际发布/完整回读/清理/独立确认全部可信，才按[合并门禁](../evidence/releases/project-view-trusted-pi-image-publication-preparation-20261017/merge-guard.md)重新核对 #239 当前 head、两行 diff、main/base、review、保护规则和权威 CI 结论，进行普通合并。沿用用户的额度/付款 CI 豁免；真实技术失败或 generic exit 1 不能自动归为额度，不重跑 CI、不伪造通过、不绕过保护，不使用关闭关键词。脚本本身无合并 API，最终合并需由 root 根据实际证据执行。

## 本地验证与剩余范围

[9 项操作 fake](../evidence/releases/project-view-trusted-pi-image-publication-preparation-20261017/checks.json)及[6 项独立 reader fixture](../evidence/releases/project-view-trusted-pi-image-publication-preparation-20261017/independent-reader-checks.json)通过；[独立评审](../evidence/releases/project-view-trusted-pi-image-publication-preparation-20261017/independent-review.json)确认原缺失最终 ACK 门禁已修复。它们只验证本地控制逻辑；没有读取真实 OAuth、SSH、Docker、凭据 API 或 Registry。当前 daemon/API/平台推送支持、凭据权限是否足够、tag 是否存在、实际原始 digest 链和清理状态均待新授权后的实际证明，不预填成功。

本批不会改变历史观察的 a036/v11/9b76 服务版本。default 应用换镜像需 rollout，可能替换/启动实例，必须另有有界真实容器授权，不能描述成无运行副作用的 image PATCH。[官方 rollout 文档](https://developers.cloudflare.com/containers/configuration/rollouts/)。#238 保持 In review，#214/JHG-46 保持 Acceptance/blocked，#242 仅离线范围 Done、Issue 仍 open；普通受邀 skill→页面/保存/刷新/冷恢复及完整 JHG-56 尚未验收。本次发布或合并本身不构成 Done。

继续沿用无费用预算上限、明确欠费时通知及已知 CI 额度豁免；不变更订阅、付款方式或自动付款。真正授权前不执行本批操作。
