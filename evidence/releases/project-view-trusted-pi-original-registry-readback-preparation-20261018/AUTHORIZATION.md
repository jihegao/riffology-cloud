# 原 c263 Registry 只读回读授权合同（准备稿）

本候选尚未执行，尚无新的人类 grant。保持 request `c263a2f3-f445-430e-b562-2e48f1eeb637`、parent `695e8875-459a-41b3-a148-2e228f2c3727` 和原远端 ROOT。新审计目录仅为原 ROOT 下 `registry-readback-recovery-v1`；它不恢复、删除或替换旧一次锁，不重复原 push。

授权若通过，仅新增一次既有同用户六 scope 的正常 token/必要同 scope refresh（不 login/consent、不扩大 scope），一次 15 分钟、账户级 pull-only Registry credential，经 SSH stdin 交付，以及一次临时反向 loopback 路由 `AMD128 127.0.0.1:7897 → 本机既有127.0.0.1:7892`。OAuth 留在本机。短期 credential 仅内存，不创建 Docker/auth config。该 credential 并非 repo-scoped；脚本把所有请求限制到固定账号、仓库、tag、digest 和 52 个槽位。

`human-grant.json` 必须是本机 owned 0600 无 link、最多32768字节的一条 compact JSON，恰一个末尾 LF、无 CR，producer 字节与远端 readline 字节及授权 SHA 完全一致。`inputs()` 在创建新 STATE、OAuth、进程或网络前完成 wire、完整 source manifest 和 `pub_common.grant()` 校验。批准时间至到期最多1小时；不得填造答复或沿用旧批准。grant 必须满足 `pub_common.py` 的完整固定字段，包括 request/operation/parent、scopeSHA、operationsManifestSHA、source/archive、原ops/grant、same-user policy、pull-only15m、route、operations/excluded 和真实新 humanReplySHA。

新权限不含 Docker、Tag、Push、Export、Build、Pull、Load、容器、模型、Turn、Run、应用/rollout、Gateway、门禁或支付/订阅变更。旧 runtime 验收截止不延长，不授权新 Turn。原无费用预算上限/欠费通知政策保留，不声称零费用或结算。

仅完整52回读、唯一成功 ACK、本机原 SSH 回收及独立原 supervisor/路由/无凭据文件核对完成后，root 才可在原条件下另行普通合并 PR253 固定 head `0a10da572264470aaac111e6f5da2bd20b2f2c45`；执行前仍需权威 exact-head CI/review 检查。AMD 无 GitHub credential 或 merge 入口。任何拒绝、超时、部分结果或未知终态均保留原身份和新一次锁，不自动重试、不切 provider/项目/请求。
