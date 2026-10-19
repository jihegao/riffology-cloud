# 原 c263 Registry 回读准备输入

这些是未执行的固定准备文件。ops SHA `59fd2dd0f464e38b50b56e7c1d65229b6d81d86b12c935a822d5eeefead74342`；complete16 SHA `1dc5e1dbadd9c7496a2f6ac0ed609240df1f9fc48f486c2d4e43445eb76488ab`。

[执行顺序与固定身份](EXECUTION.md)、[新增授权字段](AUTHORIZATION.md)、[8核心+4附加入口](operations-manifest.json)、[全部16文件绑定](complete-source-binding.json)。verification-source.json 是原安全OCI描述符/校验汇总，不含raw config、Env、层body或凭据。

只补固定52GET，不重推/重导出/部署；旧unknown状态和全部一次锁保留。normal-token、pull-only15m credential、SSH-R及52GET仍待明确新授权。两份[作者11项回执](offline-checks.safe.json)/[reader作者11项回执](reader-offline-checks.safe.json)分别记录纯合成fixture；未重复旧17/11套件，原失败raw回执只保本地。[最终独立源码审阅](reviews/readback-only-independent-review.json)已完成，`mustFix=[]`（8416B，SHA `64df4cc5e56a3d2d02dc7ac22a03a65f1f5ea435250fb1cfe3553ad94ba72c61`）；独审未重测或执行服务，不把作者结果自称独审。新增授权和实际执行仍pending。

独立reader本身 `publicationVerified:false`、`localOriginalAckStillRequired:true`；root必须结合Mac唯一完整ACK、52原proof及清理回执才可解除pending/按条件普通合并PR253。任何异常保原身份和锁，不自动retry、再mint、换目录或provider。本目录不含human grant/实际答复、OAuth/JWT、私有原输出/Env/config/OCI body。
