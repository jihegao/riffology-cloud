# Trusted Pi a946 固定镜像发布准备证据 — 2026-10-17

这是同一 JHG-46 Goal 的本地准备，尚未获本批新授权，未执行远端操作。
完整范围见[可审发布包](../../../docs/project-view-trusted-pi-image-publication-packet-20261017.md)。

- [8 项操作清单](operations-manifest.json)固定 scope、入口、远端执行器、原始 OCI 校验器、fake 和操作/合并合同。
- [操作 fake 回执](checks.json)：9 项通过；[独立 reader fixture 回执](independent-reader-checks.json)：6 项通过。保存对应源码和原 stdout/stderr，按回执字节/SHA复核；未重跑真实服务。
- [独立只读 reader](independent-cleanup-readonly.py)单独冻结，发布及清理成功后才运行；当前没有实际清理观察。
- [独立静态评审](independent-review.json)：最终清单986c2d6e…无 must-fix。旧3f7d…缺最终ACK门禁的问题已修复；[旧 manifest](history/manifest-3f7d6860/operations-manifest.json)和[旧 fake 回执](history/manifest-3f7d6860/checks.json)保留，旧版未执行，不声称保留其完整旧源码副本。
- [旧 OAuth 安全观察](sources/old-oauth-scopes-safe.json)仅有既有scope/正常续期元数据，不含 token，不证明当前认证有效或 REST 权限足够。
- [完整文件 inventory](inventory.json)逐项列出本目录公开字节与 SHA。没有人类私有答复/grant、凭据、原始Env/config、SSH配置或账单。

本地 fake/审阅不证明 Registry 或 daemon 支持、实际发布、凭据到期/撤销、远端释放或线上用户验收。请求c3e04c41…尚未执行；a946是本地index，不是已知Registry platform/config digest。无应用rollout、Gateway/门禁写入或真实项目/模型/Turn/Run。
