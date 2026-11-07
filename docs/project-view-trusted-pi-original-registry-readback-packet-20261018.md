# JHG-46：原 c263 Registry 完整回读候选

当前仅为未执行准备，尚未取得本批新授权，也未调用 OAuth、SSH、Registry 或 Docker。原 c263 恢复的 push CLI 已在2026-10-18 20:36:38.892（上海）exit0，并输出唯一原 runnable digest/size；但远端总终态为 `unknown-stopped/publication-local-error`，原 `registry-readback.json` 缺失，本机 SSH255。原导出/完整归档校验各一次及push一次均已消费，不能重放。本候选只补完整 Registry 回读；不把 CLI0、digest行或旧POST201当 Registry 成功。 [本次实际停止结果](https://github.com/jihegao/riffology-cloud/blob/41054fedc2089ad520d654a9a1dc35733145676e/docs/project-view-trusted-pi-native-resource-snapshot-host-publication-wire-repair-stop-result-20261018.md)保留原失败及独立清理证据。

新候选固定于同一 request `c263a2f3-f445-430e-b562-2e48f1eeb637`、parent `695e8875-459a-41b3-a148-2e228f2c3727`，原ROOT不变，只可新增其 `registry-readback-recovery-v1` 审计子目录和新一次锁。原执行源码、锁、records、archive与tag均不修改。

固定输入：

- source index `sha256:0bb9af7a5909c41187cf56402a21420100c72a8de0025b0a7152f8804e85d191` /856B。
- runnable `sha256:ec8dbe9efe229a1626ea3202b618653f82f8d29d9da8b19310c3b3838f2a2623` /9585B；config `sha256:cea60e390b6726ec0147153e1318b3655c8386460e98d02e35bb571768e49da5` /19067B。
- 原archive407961600B / `deddc21059715d3d63fc9c652e84e510be7117cda315102c3b1fd0f0bcf2f6d8`；53blobs/49diffID。原verification10398B / `76a53be45c5cd33a5b322bd5dd3dabc6b49f64aa53b739b38a6331cbe998beca`。49层只能从这份固定原件派生。
- 原intent608B / `e88f19dbef175057711eeb65a9f47bce5592b18eace8260d448e277d2a016d24`；原unknown terminal689B / `e6c592fa8d9bccc4dea9ac102fd8c21bdfb0aa4f8e70e97ba3e4848d562d3110`。root已将这份terminal与原观测事件、verification与原Ready做全JSON相等核对；原18安全records与进程清理结果分别保留，不改成成功。

准备包：[执行合同](../evidence/releases/project-view-trusted-pi-original-registry-readback-preparation-20261018/EXECUTION.md)、[新增授权字段](../evidence/releases/project-view-trusted-pi-original-registry-readback-preparation-20261018/AUTHORIZATION.md)、[scope](../evidence/releases/project-view-trusted-pi-original-registry-readback-preparation-20261018/scope.json)、[8核心+4附加操作件](../evidence/releases/project-view-trusted-pi-original-registry-readback-preparation-20261018/operations-manifest.json)、[全部16输入与回执绑定](../evidence/releases/project-view-trusted-pi-original-registry-readback-preparation-20261018/complete-source-binding.json)。ops SHA `59fd2dd0f464e38b50b56e7c1d65229b6d81d86b12c935a822d5eeefead74342`；complete16 SHA `1dc5e1dbadd9c7496a2f6ac0ed609240df1f9fc48f486c2d4e43445eb76488ab`。所有可执行入口、独立reader、原verification和normal-renewal来源合同均被绑定。后续新grant必须重新绑定本ops SHA，不能沿用旧0b632 grant。

一次执行的顺序为：额外一次既有同用户同六scope正常token/必要同scope refresh（不login/consent）及固定identity核对 → 一次临时loopback反向路由 → 原归档只读完整复验一次（不export）并收到Ready → 一次15分钟账户级 **pull only** credential经SSHstdin → 固定52GET。OAuth不离机，Registry凭据仅内存，不写Docker/config。 `credentialMemoryCleared`只记录finally释放引用；它不证明Python内存物理擦除、JWT撤销或自然到期，独立进程终止与路由核对另行完成。原normal-auth、route及旧push实际历史均保留，新增次数不覆盖或清零它们。固定仓库和tag只读，credential本身并非repo-scoped。[官方credential接口](https://developers.cloudflare.com/api/resources/containers/subresources/registries/subresources/credentials/methods/generate/) 支持permission数组和TTL；既有CLI scopes不构成新REST授权证明，任何拒绝即停。

固定52GET槽位仅为原tag manifest、runnable digest manifest、config、49layer；总GET≤12分钟并在15分钟JWT内，每槽一次、禁redirect/retry/fallback。每GET先落safe intent，失败/完成后落status、捕获byte/hash、phase和白名单异常类，成功proof逐项保存。两个manifest header必须匹配，manifest/config须与归档原字节相同。不得记录原body、任意错误文本、原headers或auth。

只有52完整proof、唯一成功ACK、本机原SSH回收和独立supervisor/路由/无凭据文件核对均成立，root才可按既定条件普通合并PR253固定head `0a10da572264470aaac111e6f5da2bd20b2f2c45`，并先fresh核该head的CI/review。独立reader仅证明记录/清理，固定 `publicationVerified:false`、`localOriginalAckStillRequired:true`，不能自行补造Mac ACK。未知或部分回读保持原pending和新锁，不自动重试或再发credential。

本地验证分别为作者11个新fixture和独立reader作者11个新fixture，均只用合成响应/内存及临时本地目录，未重跑旧17/11套件。作者首轮2个fixture因macOS `/tmp` 别名与resolve检查不符而失败，原失败回执保留；仅fixture改为resolve后通过，生产guard未放宽。最终作者11项在21:00:18（上海）完成；源与原stdout/stderr哈希见[作者安全回执](../evidence/releases/project-view-trusted-pi-original-registry-readback-preparation-20261018/offline-checks.safe.json)，reader另见[安全回执](../evidence/releases/project-view-trusted-pi-original-registry-readback-preparation-20261018/reader-offline-checks.safe.json)。unchanged OCI及8个既有normal-auth/http/SSH/stop函数逐字绑定见[复用合同](../evidence/releases/project-view-trusted-pi-original-registry-readback-preparation-20261018/source-reuse-contract.json)。[最终独立源码审阅](../evidence/releases/project-view-trusted-pi-original-registry-readback-preparation-20261018/reviews/readback-only-independent-review.json)已完成，`mustFix=[]`，原件8416B / SHA `64df4cc5e56a3d2d02dc7ac22a03a65f1f5ea435250fb1cfe3553ad94ba72c61`。独审只读核源码/来源，未重跑fixture或执行服务；新增授权和实际回读仍pending，不将作者检查自称独审。

这不授权Docker/Tag/Push/Export/Build/Pull/Load、容器、provider、模型、Turn/Run、rollout、应用/Gateway门禁或支付/订阅修改。不部署新镜像，不延长旧真实验收窗口，不挪用未执行的旧Turn。无费用上限/欠费通知政策沿用，费用未知不记零；普通用户project_write、T1/R1及JHG46/JHG56验收仍各按原证据边界。
